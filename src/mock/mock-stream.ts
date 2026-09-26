import { StateManager } from '../gsi/state-manager';
import { AdvisorService } from '../ai/advisor-service';
import { GsiRawPayload } from '../types/gsi';

export class MockStreamer {
  private timer: NodeJS.Timeout | null = null;
  private currentClock: number = 330; // Starts at 5:30 (approaching 6:00 rune and 5:53 stack)
  private isRunning: boolean = false;

  constructor(private stateManager: StateManager) {}

  public start(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    this.currentClock = 335; // 5:35

    console.log('🧪 [Mock] Запущена расширенная симуляция матча (включая трекер врагов Sven и Lion)...');

    // Seed mock enemies in StateEngine
    const stateEngine = AdvisorService.getInstance().getStateEngine();
    stateEngine.registerEnemySighting('npc_dota_hero_sven', 2800, 1500, ['item_blink', 'item_echo_sabre', 'item_power_treads'], 11, 310);
    stateEngine.registerEnemySighting('npc_dota_hero_lion', 2500, 2200, ['item_tranquil_boots', 'item_blink'], 9, 320);

    this.timer = setInterval(() => {
      this.currentClock += 1;
      const payload = this.generatePayload(this.currentClock);
      this.stateManager.update(payload);
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

  private generatePayload(clock: number): GsiRawPayload {
    const isDay = Math.floor(clock / 300) % 2 === 0;
    const hpVariation = Math.sin(clock / 5) * 200;
    const manaVariation = Math.cos(clock / 4) * 150;

    // Simulate player wandering towards River / Enemy Triangle at clock 350+
    const playerX = clock > 350 ? 1800 : -1500;
    const playerY = clock > 350 ? 2200 : -1200;

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
        roshan_state: 'alive',
      },
      player: {
        steamid: '76561198000000000',
        name: 'ProCarryPlayer',
        activity: 'playing',
        kills: 4,
        deaths: 1,
        assists: 3,
        last_hits: 78 + Math.floor(clock / 12),
        denies: 11,
        kill_streak: 3,
        team_name: 'radiant',
        gold: 1450 + (clock * 4),
        gold_reliable: 600,
        gold_unreliable: 850 + (clock * 4),
        gpm: 610,
        xpm: 660,
        net_worth: 9200 + (clock * 7),
      },
      hero: {
        id: 8,
        name: 'npc_dota_hero_juggernaut',
        level: 11,
        alive: true,
        respawn_seconds: 0,
        buyback_cost: 1100 + Math.floor(clock * 0.8),
        buyback_cooldown: 0,
        health: Math.max(500, Math.floor(1420 + hpVariation)),
        max_health: 1680,
        health_percent: Math.floor(((1420 + hpVariation) / 1680) * 100),
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
          can_cast: true,
          passive: false,
          cooldown: 0,
          ultimate: false,
        },
        ability1: {
          name: 'juggernaut_healing_ward',
          level: 2,
          can_cast: true,
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
          can_cast: clock % 70 > 10,
          passive: false,
          cooldown: clock % 70 <= 10 ? 10 - (clock % 70) : 0,
          ultimate: true,
        },
      },
      items: {
        slot0: {
          name: 'item_phase_boots',
          can_cast: true,
          cooldown: 0,
          passive: false,
        },
        slot1: {
          name: 'item_manta',
          can_cast: true,
          cooldown: 0,
          passive: false,
        },
        slot2: {
          name: 'item_magic_wand',
          can_cast: true,
          cooldown: 0,
          charges: 17,
          passive: false,
        },
        slot3: {
          name: 'item_ogre_axe', // Building BKB!
          can_cast: false,
          passive: true,
        },
        teleport0: {
          name: 'item_tpscroll',
          can_cast: true,
          cooldown: 0,
          charges: 2,
        },
        neutral0: {
          name: 'item_duelist_gloves',
          can_cast: false,
          passive: true,
        },
      },
      buildings: {
        dota_goodguys_tower1_mid: { health: 1300, max_health: 1800 },
        dota_goodguys_tower2_mid: { health: 2000, max_health: 2000 },
        dota_goodguys_tower3_mid: { health: 2000, max_health: 2000 },
        dota_badguys_tower1_mid: { health: clock > 350 ? 0 : 500, max_health: 1800 },
      },
      auth: {
        token: 'dota_assistant_token_77',
      },
    };
  }
}
