import { StateManager } from '../gsi/state-manager';
import { AdvisorService } from '../ai/advisor-service';
import { GsiRawPayload } from '../types/gsi';

export type MockScenario = 'default' | 'gank' | 'death' | 'roshan' | 'violation' | 'completion';

export class MockStreamer {
  private timer: NodeJS.Timeout | null = null;
  private currentClock: number = 330; // Starts at 5:30
  private isRunning: boolean = false;
  private scenario: MockScenario = 'default';

  constructor(private stateManager: StateManager, defaultScenario: MockScenario = 'default') {
    this.scenario = defaultScenario;
  }

  public setScenario(scenario: MockScenario): void {
    this.scenario = scenario;
  }

  public start(scenario?: MockScenario): void {
    if (this.isRunning) return;
    if (scenario) this.scenario = scenario;

    this.isRunning = true;
    this.currentClock = 335; // 5:35

    console.log(`🧪 [Mock] Запущена симуляция матча (Сценарий: ${this.scenario.toUpperCase()})...`);

    // Seed mock enemies in StateEngine with observationSource: 'mock'
    const stateEngine = AdvisorService.getInstance().getStateEngine();
    stateEngine.registerEnemySighting(
      'npc_dota_hero_sven',
      2800,
      1500,
      ['item_blink', 'item_echo_sabre', 'item_power_treads'],
      11,
      310,
      'mock',
      0.95
    );
    stateEngine.registerEnemySighting(
      'npc_dota_hero_lion',
      2500,
      2200,
      ['item_tranquil_boots', 'item_blink'],
      9,
      320,
      'mock',
      0.95
    );

    this.timer = setInterval(() => {
      this.currentClock += 1;
      const payload = this.generatePayload(this.currentClock);
      this.stateManager.update(payload);

      // Periodically refresh sightings for Sven and Lion in mock simulation
      if (this.currentClock % 10 === 0 || this.currentClock === 336) {
        const stateEngine = AdvisorService.getInstance().getStateEngine();
        stateEngine.registerEnemySighting(
          'npc_dota_hero_sven',
          2800,
          1500,
          ['item_blink', 'item_echo_sabre', 'item_power_treads'],
          11,
          this.currentClock,
          'mock',
          0.95
        );
        stateEngine.registerEnemySighting(
          'npc_dota_hero_lion',
          2500,
          2200,
          ['item_tranquil_boots', 'item_blink'],
          9,
          this.currentClock - 3,
          'mock',
          0.95
        );
      }
    }, 1000);
  }

  public stop(): void {
    if (!this.isRunning) return;
    this.isRunning = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    console.log('🛑 [Mock] Симуляция матча остановлена.');
  }

  public isActive(): boolean {
    return this.isRunning;
  }

  public generatePayload(clock: number): GsiRawPayload {
    const isDay = Math.floor(clock / 300) % 2 === 0;
    const hpVariation = Math.sin(clock / 5) * 200;
    const manaVariation = Math.cos(clock / 4) * 150;

    let playerX = clock > 350 ? 1800 : -1500;
    let playerY = clock > 350 ? 2200 : -1200;
    let heroAlive = true;
    let respawnSeconds = 0;
    let currentHp = Math.max(500, Math.floor(1420 + hpVariation));
    let roshanState: 'alive' | 'respawn_base' | 'respawn_variable' = 'alive';
    let roshanEndSeconds = 0;

    const inventorySlots: Record<string, any> = {
      slot0: { name: 'item_phase_boots', can_cast: true, cooldown: 0, passive: false },
      slot1: { name: 'item_manta', can_cast: true, cooldown: 0, passive: false },
      slot2: { name: 'item_magic_wand', can_cast: true, cooldown: 0, charges: 17, passive: false },
      slot3: { name: 'item_ogre_axe', can_cast: false, passive: true },
      teleport0: { name: 'item_tpscroll', can_cast: true, cooldown: 0, charges: 2 },
      neutral0: { name: 'item_duelist_gloves', can_cast: false, passive: true },
    };

    // Scenario Modifiers
    switch (this.scenario) {
      case 'gank':
        // Sven and Lion suddenly appear close to player in River
        playerX = 0;
        playerY = 0;
        currentHp = Math.max(150, 800 - (clock - 335) * 25);
        break;

      case 'death':
        // Hero dies after clock 340
        if (clock >= 340) {
          heroAlive = false;
          respawnSeconds = Math.max(0, 42 - (clock - 340));
          currentHp = 0;
        }
        break;

      case 'roshan':
        // Roshan dies at clock 345
        if (clock >= 345) {
          roshanState = 'respawn_base';
          roshanEndSeconds = Math.max(0, 480 - (clock - 345));
        }
        break;

      case 'violation':
        // Player enters forbidden Dire Triangle (x: 2000, y: 2000)
        playerX = 2500;
        playerY = 2200;
        break;

      case 'completion':
        // Player completed BKB
        inventorySlots.slot3 = { name: 'item_black_king_bar', can_cast: true, cooldown: 0, passive: false };
        break;

      default:
        break;
    }

    return {
      provider: {
        name: 'Dota 2',
        appid: 570,
        version: 5000,
        timestamp: Math.floor(Date.now() / 1000),
      },
      map: {
        name: 'dota',
        matchid: '7999888123',
        game_time: clock + 90,
        clock_time: clock,
        daytime: isDay,
        nightstalker_night: false,
        game_state: 'DOTA_GAMERULES_STATE_GAME_IN_PROGRESS',
        paused: false,
        win_team: 'none',
        ward_purchase_cooldown: Math.max(0, 45 - (clock % 60)),
        roshan_state: roshanState,
        roshan_state_end_seconds: roshanEndSeconds,
      },
      player: {
        steamid: '76561198000000000',
        name: 'ProCarryPlayer',
        activity: 'playing',
        kills: 4,
        deaths: heroAlive ? 1 : 2,
        assists: 3,
        last_hits: 78 + Math.floor(clock / 12),
        denies: 11,
        kill_streak: heroAlive ? 3 : 0,
        team_name: 'radiant',
        gold: 1450 + clock * 4,
        gold_reliable: 600,
        gold_unreliable: 850 + clock * 4,
        gpm: 610,
        xpm: 660,
        net_worth: 9200 + clock * 7,
      },
      hero: {
        id: 8,
        name: 'npc_dota_hero_juggernaut',
        level: 11,
        alive: heroAlive,
        respawn_seconds: respawnSeconds,
        buyback_cost: 1100 + Math.floor(clock * 0.8),
        buyback_cooldown: 0,
        health: currentHp,
        max_health: 1680,
        health_percent: Math.floor((currentHp / 1680) * 100),
        mana: Math.max(100, Math.floor(520 + manaVariation)),
        max_mana: 680,
        mana_percent: Math.floor(((520 + manaVariation) / 680) * 100),
        silenced: false,
        stunned: false,
        disarmed: false,
        magicimmune: false,
        xpos: playerX,
        ypos: playerY,
        selected_unit: true,
      },
      abilities: {
        ability0: {
          name: 'juggernaut_blade_fury',
          level: 4,
          can_cast: heroAlive,
          passive: false,
          cooldown: 0,
          ultimate: false,
        },
        ability1: {
          name: 'juggernaut_healing_ward',
          level: 2,
          can_cast: heroAlive,
          passive: false,
          cooldown: 0,
          ultimate: false,
        },
        ability2: {
          name: 'juggernaut_blade_dance',
          level: 4,
          can_cast: false,
          passive: true,
          cooldown: 0,
          ultimate: false,
        },
        ability5: {
          name: 'juggernaut_omislash',
          level: 2,
          can_cast: heroAlive && clock % 70 > 10,
          passive: false,
          cooldown: clock % 70 <= 10 ? 10 - (clock % 70) : 0,
          ultimate: true,
        },
      },
      items: inventorySlots,
      buildings: {
        dota_goodguys_tower1_mid: { health: 1300, max_health: 1800 },
        dota_goodguys_tower2_mid: { health: 2000, max_health: 2000 },
        dota_goodguys_tower3_mid: { health: 2000, max_health: 2000 },
        dota_badguys_tower1_mid: { health: clock > 350 ? 0 : 500, max_health: 1800 },
      },
      draft: {
        team3: {
          hero0: { name: 'npc_dota_hero_sven' },
          hero1: { name: 'npc_dota_hero_lion' },
          hero2: { name: 'npc_dota_hero_axe' },
          hero3: { name: 'npc_dota_hero_pudge' },
          hero4: { name: 'npc_dota_hero_crystal_maiden' },
        },
      },
      auth: {
        token: 'dota_assistant_token_77',
      },
    };
  }
}
