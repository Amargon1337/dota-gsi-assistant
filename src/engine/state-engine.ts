import { ProcessedGameState, GsiRawPayload } from '../types/gsi';
import {
  WorldModelStore,
  SharedWorldModel,
  EnemyHeroTracker,
  MapZoneInfo,
  ObservationSource,
  PlayerStatusEffects,
  KeyCooldowns,
  ZoneAllegiance,
  ZoneKind,
} from './world-model';

interface HistorySnapshot {
  clockTime: number;
  networth: number;
  xp: number;
  gold: number;
  kills: number;
  deaths: number;
  assists: number;
  x: number;
  y: number;
}

export function classifyMapZone(
  x: number,
  y: number,
  playerTeam: 'radiant' | 'dire' = 'radiant'
): MapZoneInfo {
  const isRadiant = playerTeam === 'radiant';

  // 1. Bases
  if (x < -5000 && y < -5000) {
    return {
      name: 'Radiant Base',
      allegiance: isRadiant ? 'ally' : 'enemy',
      kind: 'base',
      baseRisk: isRadiant ? 0.05 : 0.95,
    };
  }
  if (x > 5000 && y > 5000) {
    return {
      name: 'Dire Base',
      allegiance: isRadiant ? 'enemy' : 'ally',
      kind: 'base',
      baseRisk: isRadiant ? 0.95 : 0.05,
    };
  }

  // 2. River and Roshan Pit
  const riverDist = Math.abs(x + y);
  if (riverDist < 1200 && Math.abs(x) < 4000) {
    if ((x < -1500 && y < 1500) || (x > 1500 && y > -1500)) {
      return {
        name: 'Roshan Pit Area (River)',
        allegiance: 'neutral',
        kind: 'roshan',
        baseRisk: 0.65,
      };
    }
    return {
      name: 'River',
      allegiance: 'neutral',
      kind: 'river',
      baseRisk: 0.55,
    };
  }

  // 3. Triangles
  if (x < -1000 && x > -4500 && y < 0 && y > -4500) {
    return {
      name: 'Radiant Triangle',
      allegiance: isRadiant ? 'ally' : 'enemy',
      kind: 'triangle',
      baseRisk: isRadiant ? 0.15 : 0.75,
    };
  }
  if (x > 1000 && x < 4500 && y > 0 && y < 4500) {
    return {
      name: 'Dire Triangle',
      allegiance: isRadiant ? 'enemy' : 'ally',
      kind: 'triangle',
      baseRisk: isRadiant ? 0.75 : 0.15,
    };
  }

  // 4. Main Jungles
  if (x > 0 && x < 5000 && y < 0 && y > -6000) {
    return {
      name: 'Radiant Main Jungle',
      allegiance: isRadiant ? 'ally' : 'enemy',
      kind: 'jungle',
      baseRisk: isRadiant ? 0.20 : 0.70,
    };
  }
  if (x < 0 && x > -5000 && y > 0 && y < 6000) {
    return {
      name: 'Dire Main Jungle',
      allegiance: isRadiant ? 'enemy' : 'ally',
      kind: 'jungle',
      baseRisk: isRadiant ? 0.70 : 0.20,
    };
  }

  // 5. Lanes
  if (Math.abs(x - y) < 1500) {
    return {
      name: 'Mid Lane',
      allegiance: 'neutral',
      kind: 'lane',
      baseRisk: 0.40,
    };
  }
  if (y > 4500) {
    return {
      name: 'Top Lane',
      allegiance: 'neutral',
      kind: 'lane',
      baseRisk: 0.45,
    };
  }
  if (y < -4500) {
    return {
      name: 'Bottom Lane',
      allegiance: 'neutral',
      kind: 'lane',
      baseRisk: 0.45,
    };
  }

  return {
    name: 'Neutral Map Area',
    allegiance: 'neutral',
    kind: 'neutral_area',
    baseRisk: 0.35,
  };
}

export function determineMapZone(x: number, y: number, team: string = 'radiant'): string {
  const normTeam = team.toLowerCase().includes('dire') ? 'dire' : 'radiant';
  return classifyMapZone(x, y, normTeam).name;
}

/**
 * Author heuristic reference curve for core heroes (NOT an official Valve/D2PT benchmark).
 * Provides a rough baseline for evaluating farm progression over game time.
 */
export function calculateHeuristicNetworthCurve(clockSeconds: number): number {
  if (clockSeconds <= 0) return 600;
  const mins = clockSeconds / 60;
  if (mins < 10) {
    return Math.round(600 + mins * 400); // 400 GPM early
  } else if (mins < 20) {
    return Math.round(4600 + (mins - 10) * 650); // 650 GPM midgame spike
  } else {
    return Math.round(11100 + (mins - 20) * 850); // 850 GPM lategame farming
  }
}

// Backwards compatibility alias
export const calculateExpectedNetworth = calculateHeuristicNetworthCurve;

export function parseTowerCounts(
  buildings: any,
  isRadiantPlayer: boolean
): { alliedTowers: number; enemyTowers: number; hasTowerData: boolean } {
  let radiant = 0;
  let dire = 0;
  let foundAnyTower = false;

  if (!buildings || typeof buildings !== 'object') {
    return { alliedTowers: 11, enemyTowers: 11, hasTowerData: false };
  }

  function scan(node: any, currentTeam?: 'radiant' | 'dire') {
    if (!node || typeof node !== 'object') return;

    for (const [key, val] of Object.entries(node)) {
      const lower = key.toLowerCase();
      let team = currentTeam;
      if (lower === 'radiant' || lower.includes('goodguys')) team = 'radiant';
      if (lower === 'dire' || lower.includes('badguys')) team = 'dire';

      if (lower.includes('tower') && typeof val === 'object' && val !== null) {
        foundAnyTower = true;
        const b = val as { health?: number; max_health?: number };
        const isAlive = b.health === undefined || b.health > 0;
        if (isAlive) {
          if (team === 'dire') {
            dire++;
          } else {
            radiant++;
          }
        }
      } else if (typeof val === 'object' && val !== null) {
        scan(val, team);
      }
    }
  }

  scan(buildings);

  if (!foundAnyTower) {
    return { alliedTowers: 11, enemyTowers: 11, hasTowerData: false };
  }

  return {
    alliedTowers: isRadiantPlayer ? radiant : dire,
    enemyTowers: isRadiantPlayer ? dire : radiant,
    hasTowerData: true,
  };
}

import { GameSessionManager } from './game-session';
import { ObservationCollector } from '../gsi/observation-collector';

export class StateEngine {
  private history: HistorySnapshot[] = [];
  private lastSampleClockTime = -999;
  private lastGoldPocket = 600;
  private worldModelStore = WorldModelStore.getInstance();

  constructor() {
    GameSessionManager.getInstance().registerComponent(this);
  }

  public process(raw: GsiRawPayload, processed: ProcessedGameState): SharedWorldModel {
    const clock = raw.map?.clock_time ?? 0;
    const player = raw.player || {};
    const hero = raw.hero || {};
    const map = raw.map || {};

    const model = this.worldModelStore.getModel();

    // 0. Observation Mode: Mock simulation vs Valve GSI solo-player Fog of War restricted
    const isMock = raw.provider?.name === 'mock' || Object.values(model.enemies).some((e) => e.observationSource === 'mock');
    model.observationMode = isMock ? 'mock_simulation' : 'player_gsi_fow_restricted';

    // 1. Update Meta
    model.meta.matchId = map.matchid || model.meta.matchId;
    model.meta.serverTime = Date.now();
    model.meta.clockTime = clock;
    model.meta.formattedClock = processed.calculated.formattedClock;
    model.meta.gamePhase = map.game_state || 'INIT';
    model.meta.isDaytime = map.daytime ?? true;
    model.meta.dayNightCountdown = processed.calculated.nextDayNightSeconds;

    // 2. Team and Zone Classification
    const teamName: 'radiant' | 'dire' = (player.team_name || 'radiant').toLowerCase().includes('dire')
      ? 'dire'
      : 'radiant';
    model.player.team = teamName;

    const x = hero.xpos ?? 0;
    const y = hero.ypos ?? 0;
    const zoneInfo = classifyMapZone(x, y, teamName);
    model.player.currentZone = zoneInfo.name;
    model.player.zoneInfo = zoneInfo;
    model.player.coordinates = { x, y };

    // 3. True Net Worth Calculation
    const bbCost = hero.buyback_cost ?? 0;
    let trueNetworth = 0;
    if (bbCost >= 200) {
      trueNetworth = (bbCost - 200) * 13;
    } else {
      const earned =
        (player.gold_from_hero_kills ?? 0) +
        (player.gold_from_creep_kills ?? 0) +
        (player.gold_from_income ?? 0) +
        (player.gold_from_shared ?? 0);
      trueNetworth = earned > 0 ? earned : (player.gold ?? 0);
    }
    if (player.net_worth) trueNetworth = player.net_worth;
    if ((player as any).networth) trueNetworth = (player as any).networth;
    if ((player.gold ?? 0) > trueNetworth) {
      trueNetworth = player.gold ?? 0;
    }

    model.player.heroName = hero.name || '';
    model.player.heroCleanName = hero.name ? hero.name.replace('npc_dota_hero_', '').replace(/_/g, ' ') : 'Не выбран';
    model.player.level = hero.level || 1;
    model.player.alive = hero.alive ?? true;
    model.player.respawnSeconds = hero.respawn_seconds ?? 0;
    model.player.hp = hero.health ?? 0;
    model.player.maxHp = hero.max_health ?? 1;
    model.player.hpPercent = hero.health_percent ?? 100;
    model.player.mana = hero.mana ?? 0;
    model.player.maxMana = hero.max_mana ?? 1;
    model.player.manaPercent = hero.mana_percent ?? 100;
    model.player.gold = player.gold ?? 0;
    model.player.networth = trueNetworth;
    model.player.kda = {
      kills: player.kills ?? 0,
      deaths: player.deaths ?? 0,
      assists: player.assists ?? 0,
    };
    model.player.lastHits = player.last_hits ?? 0;
    model.player.denies = player.denies ?? 0;

    // 4. Status Effects from GSI
    model.player.statusEffects = {
      silenced: Boolean(hero.silenced),
      stunned: Boolean(hero.stunned),
      disarmed: Boolean(hero.disarmed),
      magicImmune: Boolean(hero.magicimmune),
      hexed: Boolean(hero.hexed),
      muted: Boolean(hero.muted),
      breakApplied: Boolean(hero.break),
      smokeActive: Boolean(hero.smoke),
      hasDebuff: Boolean(hero.has_debuff),
    };

    // 5. Inventory & Key Item Cooldowns
    const rawItems = Object.values(raw.items || {}).filter((i) => i.name && i.name !== 'empty');
    model.player.inventory = rawItems.map((i) => i.name.replace('item_', ''));

    // Key Cooldowns
    const bkbItem = rawItems.find((i) => i.name.includes('black_king_bar'));
    const mantaItem = rawItems.find((i) => i.name.includes('manta'));
    const blinkItem = rawItems.find((i) => i.name.includes('blink'));
    const tpItem = rawItems.find((i) => i.name.includes('tpscroll') || i.name.includes('travel_boots'));

    const rawAbilities = Object.values(raw.abilities || {}).filter((a) => a.name);
    model.player.abilities = rawAbilities.map((a) => ({
      name: a.name.replace(/^[a-z]+_/, ''),
      level: a.level,
      cooldown: a.cooldown,
      canCast: a.can_cast,
      isUlt: Boolean(a.ultimate),
    }));

    const ultAbility = rawAbilities.find((a) => a.ultimate);

    model.player.keyCooldowns = {
      ultimate: {
        name: ultAbility ? ultAbility.name.replace(/^[a-z]+_/, '') : '',
        ready: ultAbility ? ultAbility.can_cast : false,
        cooldown: ultAbility ? ultAbility.cooldown : 0,
        level: ultAbility ? ultAbility.level : 0,
      },
      bkb: {
        owned: Boolean(bkbItem),
        ready: bkbItem ? (bkbItem.cooldown ?? 0) === 0 : false,
        cooldown: bkbItem?.cooldown ?? 0,
      },
      manta: {
        owned: Boolean(mantaItem),
        ready: mantaItem ? (mantaItem.cooldown ?? 0) === 0 : false,
        cooldown: mantaItem?.cooldown ?? 0,
      },
      blink: {
        owned: Boolean(blinkItem),
        ready: blinkItem ? (blinkItem.cooldown ?? 0) === 0 : false,
        cooldown: blinkItem?.cooldown ?? 0,
      },
      tp: {
        ready: tpItem ? (tpItem.cooldown ?? 0) === 0 : true,
        cooldown: tpItem?.cooldown ?? 0,
        charges: tpItem?.charges ?? 1,
      },
    };

    // 6. Buyback Status
    model.player.buyback = {
      canBuyback: processed.calculated.buyback.canBuyback,
      cost: hero.buyback_cost ?? 0,
      cooldown: hero.buyback_cooldown ?? 0,
      surplus: processed.calculated.buyback.goldSurplus,
    };

    // 7. Roshan Status from GSI
    const roshanStateRaw = map.roshan_state;
    if (roshanStateRaw === 'alive') {
      model.mapControl.roshanStatus = 'alive';
      model.mapControl.roshanTimerSeconds = 0;
    } else if (roshanStateRaw === 'respawn_base' || roshanStateRaw === 'respawn_variable') {
      model.mapControl.roshanStatus = 'dead';
      model.mapControl.roshanTimerSeconds = map.roshan_state_end_seconds ?? 0;
    } else {
      model.mapControl.roshanStatus = 'alive';
    }

    // 8. Sliding History & Economic Velocity Calculation
    if (clock - this.lastSampleClockTime >= 2) {
      this.lastSampleClockTime = clock;
      this.history.push({
        clockTime: clock,
        networth: trueNetworth,
        xp: player.xpm ? player.xpm * (Math.max(1, clock) / 60) : 0,
        gold: player.gold ?? 0,
        kills: player.kills ?? 0,
        deaths: player.deaths ?? 0,
        assists: player.assists ?? 0,
        x,
        y,
      });

      if (this.history.length > 300) {
        this.history.shift();
      }
    }

    this.updateTrends(model, clock, player, trueNetworth);

    // 9. Update Towers and Map Control
    const isRadiant = teamName === 'radiant';
    if (raw.buildings) {
      const towerStats = parseTowerCounts(raw.buildings, isRadiant);
      if (towerStats.hasTowerData) {
        model.mapControl.alliedTowersAlive = towerStats.alliedTowers;
        model.mapControl.enemyTowersAlive = towerStats.enemyTowers;
      }
    }

    if (isRadiant) {
      model.mapControl.currentSafeFarmZones = ['Radiant Base', 'Radiant Triangle', 'Radiant Main Jungle'];
      model.mapControl.dangerousZones = ['Dire Base', 'Dire Triangle', 'Dire Main Jungle', 'Roshan Pit Area (River)'];
    } else {
      model.mapControl.currentSafeFarmZones = ['Dire Base', 'Dire Triangle', 'Dire Main Jungle'];
      model.mapControl.dangerousZones = ['Radiant Base', 'Radiant Triangle', 'Radiant Main Jungle', 'Roshan Pit Area (River)'];
    }

    // 10. Update Enemy Trackers via ObservationCollector & Ingest Draft Heroes
    const collector = ObservationCollector.getInstance();

    if (raw.draft) {
      const enemyDraft = isRadiant ? (raw.draft.team3 || raw.draft.dire) : (raw.draft.team2 || raw.draft.radiant);
      if (enemyDraft && typeof enemyDraft === 'object') {
        for (const key of Object.keys(enemyDraft)) {
          if (key.startsWith('hero') || key.startsWith('pick')) {
            const val = (enemyDraft as any)[key];
            const heroName = typeof val === 'string' ? val : val?.name || val?.heroName;
            if (heroName && typeof heroName === 'string') {
              const fullHeroName = heroName.startsWith('npc_dota_hero_') ? heroName : `npc_dota_hero_${heroName.toLowerCase()}`;
              const existing = collector.getObservationsRecord()[fullHeroName.toLowerCase()];
              if (!existing) {
                collector.observeEnemy(
                  {
                    heroName: fullHeroName,
                    clockTime: clock,
                    source: 'inferred',
                    certainty: 0.5,
                    items: [],
                  },
                  teamName
                );
              }
            }
          }
        }
      }
    }

    if (model.visionDraft) {
      const enemyDraftHeroes = isRadiant ? model.visionDraft.direHeroes : model.visionDraft.radiantHeroes;
      if (Array.isArray(enemyDraftHeroes)) {
        for (const h of enemyDraftHeroes) {
          if (h && typeof h === 'string') {
            const fullHeroName = h.startsWith('npc_dota_hero_') ? h : `npc_dota_hero_${h.toLowerCase()}`;
            const existing = collector.getObservationsRecord()[fullHeroName.toLowerCase()];
            if (!existing) {
              collector.observeEnemy(
                {
                  heroName: fullHeroName,
                  clockTime: clock,
                  source: 'cv',
                  certainty: 0.85,
                  items: [],
                },
                teamName
              );
            }
          }
        }
      }
    }

    collector.updateClock(clock);
    model.enemies = collector.getObservationsRecord();

    return model;
  }

  private updateTrends(model: SharedWorldModel, currentClock: number, player: any, currentNw: number): void {
    if (this.history.length === 0) return;

    const currentXp = player.xpm ? player.xpm * (Math.max(1, currentClock) / 60) : 0;
    const currentGold = player.gold ?? 0;
    const currentDeaths = player.deaths ?? 0;
    const currentKills = player.kills ?? 0;

    const targetClock5m = currentClock - 300;
    const snapshot5m = this.findClosestSnapshot(targetClock5m) || this.history[0];

    const targetClock30s = currentClock - 30;
    const snapshot30s = this.findClosestSnapshot(targetClock30s) || this.history[0];

    const targetClock10m = currentClock - 600;
    const snapshot10m = this.findClosestSnapshot(targetClock10m) || this.history[0];

    const networthDelta5m = currentNw - snapshot5m.networth;
    const xpDelta5m = Math.round(currentXp - snapshot5m.xp);

    const secondsDiff30s = Math.max(1, currentClock - snapshot30s.clockTime);
    const pocketGoldDelta30s = currentGold - snapshot30s.gold;

    // Detect item purchases (spending)
    let spendingDetected = 0;
    if (currentGold < this.lastGoldPocket - 250 && currentDeaths === snapshot30s.deaths) {
      spendingDetected = this.lastGoldPocket - currentGold;
    }
    this.lastGoldPocket = currentGold;

    // Estimated Farm Velocity: calculated from TRUE Net Worth growth rate, NOT volatile pocket gold!
    const estimatedFarmVelocityPerSec = Math.max(0, Math.round(((currentNw - snapshot30s.networth) / secondsDiff30s) * 10) / 10);

    const heuristicBenchmark = calculateHeuristicNetworthCurve(currentClock);
    const networthDiff = currentNw - heuristicBenchmark;

    model.trends = {
      networthNow: currentNw,
      networthDelta5m,
      xpDelta5m,
      goldPerMinute: player.gpm ?? 0,
      xpPerMinute: player.xpm ?? 0,
      pocketGoldDelta30s,
      spendingDetected,
      estimatedFarmVelocityPerSec,
      estimatedNetworthReference: heuristicBenchmark,
      expectedNetworthBenchmark: heuristicBenchmark,
      networthDifference: networthDiff,
      deathsLast10m: currentDeaths - snapshot10m.deaths,
      killsLast10m: currentKills - snapshot10m.kills,
    };
  }

  private findClosestSnapshot(targetClock: number): HistorySnapshot | null {
    if (this.history.length === 0) return null;
    let closest = this.history[0];
    let minDiff = Math.abs(closest.clockTime - targetClock);

    for (const snap of this.history) {
      const diff = Math.abs(snap.clockTime - targetClock);
      if (diff < minDiff) {
        minDiff = diff;
        closest = snap;
      }
    }
    return closest;
  }

  public registerEnemySighting(
    heroName: string,
    x: number,
    y: number,
    items: string[],
    level: number,
    clockTime: number,
    source: ObservationSource = 'mock',
    certainty: number = 0.95
  ): void {
    const model = this.worldModelStore.getModel();
    ObservationCollector.getInstance().observeEnemy(
      {
        heroName,
        x,
        y,
        items,
        level,
        clockTime,
        source,
        certainty,
      },
      model.player.team
    );
    model.enemies = ObservationCollector.getInstance().getObservationsRecord();
  }

  public reset(): void {
    this.history = [];
    this.lastSampleClockTime = -999;
    this.lastGoldPocket = 600;
    console.log('[STATE] Состояние StateEngine и история снапшотов сброшены');
  }
}
