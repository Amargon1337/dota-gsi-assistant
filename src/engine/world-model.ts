export interface EnemyHeroTracker {
  id?: number;
  name: string;
  heroNameClean: string;
  level: number;
  alive: boolean;
  respawnSeconds: number;
  lastSeenClockTime: number; // clock_time in seconds when last visible
  missingDurationSeconds: number;
  lastKnownLocation: { x: number; y: number; zoneName: string };
  lastKnownHpPercent: number;
  lastKnownManaPercent: number;
  items: string[];
  hasBlink: boolean;
  hasBkb: boolean;
  hasShadowBlade: boolean;
  threatScore: number; // 0 to 10
}

export interface StrategicPlan {
  id: string;
  createdAtClock: number;
  priority: string;
  targetObjective: string;
  targetItem: string;
  goldNeededForItem: number;
  avoidZones: string[];
  safeZones: string[];
  guidanceText: string;
  confidence: number;
  status: 'active' | 'violated' | 'completed' | 'abandoned';
  violationReason?: string;
}

export interface ThreatEvaluation {
  id: string;
  level: 'low' | 'medium' | 'high' | 'critical';
  title: string;
  confidence: number; // 0.0 to 1.0 (calibrated)
  recommendedAction: string;
  evidence: string[];
  timestampClock: number;
}

export interface SemanticGameEvent {
  id: string;
  clockTime: number;
  formattedTime: string;
  type:
    | 'ENEMY_MISSING'
    | 'ENEMY_VISIBLE'
    | 'POWER_SPIKE'
    | 'TOWER_DESTROYED'
    | 'PLAN_VIOLATED'
    | 'PLAN_CREATED'
    | 'HERO_DEATH'
    | 'ROSHAN_ALERT'
    | 'ZONE_CHANGE';
  severity: 'info' | 'warning' | 'critical';
  description: string;
  payload?: any;
}

export interface EconomicTrends {
  networthNow: number;
  networthDelta5m: number;
  xpDelta5m: number;
  goldPerMinute: number;
  goldVelocityPerSec: number; // calculated over last 30s
  expectedNetworthBenchmark: number; // expected benchmark for minute X
  networthDifference: number; // now - expected
  deathsLast10m: number;
  killsLast10m: number;
}

export interface SharedWorldModel {
  meta: {
    matchId: string;
    serverTime: number;
    clockTime: number;
    formattedClock: string;
    gamePhase: string;
    isDaytime: boolean;
    dayNightCountdown: number;
  };
  player: {
    heroName: string;
    heroCleanName: string;
    level: number;
    alive: boolean;
    respawnSeconds: number;
    hp: number;
    maxHp: number;
    hpPercent: number;
    mana: number;
    maxMana: number;
    manaPercent: number;
    gold: number;
    networth: number;
    kda: { kills: number; deaths: number; assists: number };
    lastHits: number;
    denies: number;
    currentZone: string;
    coordinates: { x: number; y: number };
    inventory: string[];
    abilities: Array<{ name: string; level: number; cooldown: number; canCast: boolean; isUlt: boolean }>;
    buyback: {
      canBuyback: boolean;
      cost: number;
      cooldown: number;
      surplus: number;
    };
  };
  trends: EconomicTrends;
  enemies: Record<string, EnemyHeroTracker>;
  mapControl: {
    alliedTowersAlive: number;
    enemyTowersAlive: number;
    roshanStatus: string;
    roshanSpawnWindow?: { minTime: number; maxTime: number };
    currentSafeFarmZones: string[];
    dangerousZones: string[];
  };
  threats: ThreatEvaluation[];
  strategy: {
    activePlan: StrategicPlan | null;
    previousPlans: StrategicPlan[];
    lastGeminiAnalysisTime: number;
  };
  recentEvents: SemanticGameEvent[];
  leyaState: {
    lastInferenceLatencyMs: number;
    operationalPicture: string;
    immediateAction: string;
    confidence: number;
  };
}

export function createInitialWorldModel(): SharedWorldModel {
  return {
    meta: {
      matchId: '',
      serverTime: Date.now(),
      clockTime: -90,
      formattedClock: '-01:30',
      gamePhase: 'INIT',
      isDaytime: true,
      dayNightCountdown: 0,
    },
    player: {
      heroName: '',
      heroCleanName: 'Выбор героя',
      level: 1,
      alive: true,
      respawnSeconds: 0,
      hp: 1000,
      maxHp: 1000,
      hpPercent: 100,
      mana: 500,
      maxMana: 500,
      manaPercent: 100,
      gold: 600,
      networth: 600,
      kda: { kills: 0, deaths: 0, assists: 0 },
      lastHits: 0,
      denies: 0,
      currentZone: 'Base',
      coordinates: { x: 0, y: 0 },
      inventory: [],
      abilities: [],
      buyback: {
        canBuyback: true,
        cost: 0,
        cooldown: 0,
        surplus: 600,
      },
    },
    trends: {
      networthNow: 600,
      networthDelta5m: 0,
      xpDelta5m: 0,
      goldPerMinute: 0,
      goldVelocityPerSec: 0,
      expectedNetworthBenchmark: 600,
      networthDifference: 0,
      deathsLast10m: 0,
      killsLast10m: 0,
    },
    enemies: {},
    mapControl: {
      alliedTowersAlive: 11,
      enemyTowersAlive: 11,
      roshanStatus: 'alive',
      currentSafeFarmZones: ['Our Safe Jungle', 'Base'],
      dangerousZones: ['River', 'Enemy Triangle', 'Enemy Jungle'],
    },
    threats: [],
    strategy: {
      activePlan: null,
      previousPlans: [],
      lastGeminiAnalysisTime: 0,
    },
    recentEvents: [],
    leyaState: {
      lastInferenceLatencyMs: 0,
      operationalPicture: 'Ожидание начала матча',
      immediateAction: 'farm_safe',
      confidence: 0.9,
    },
  };
}

export class WorldModelStore {
  private static instance: WorldModelStore;
  private model: SharedWorldModel = createInitialWorldModel();

  public static getInstance(): WorldModelStore {
    if (!WorldModelStore.instance) {
      WorldModelStore.instance = new WorldModelStore();
    }
    return WorldModelStore.instance;
  }

  public getModel(): SharedWorldModel {
    return this.model;
  }

  public updateModel(updater: (model: SharedWorldModel) => void): SharedWorldModel {
    updater(this.model);
    return this.model;
  }

  public reset(matchId: string = ''): void {
    this.model = createInitialWorldModel();
    this.model.meta.matchId = matchId;
  }
}
