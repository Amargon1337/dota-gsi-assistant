export type ZoneAllegiance = 'ally' | 'enemy' | 'neutral';
export type ZoneKind = 'base' | 'jungle' | 'triangle' | 'river' | 'lane' | 'roshan' | 'neutral_area';

export type EpistemicStatus = 'KNOWN' | 'UNKNOWN' | 'INFERRED';

export interface MapZoneInfo {
  name: string;
  allegiance: ZoneAllegiance;
  kind: ZoneKind;
  baseRisk: number; // 0.0 to 1.0
}

export type ObservationSource = 'gsi' | 'cv' | 'mock' | 'inferred' | 'unknown';
export type DataFreshness = 'fresh' | 'stale' | 'expired';

export interface AnonymousContact {
  id: string;
  x: number;
  y: number;
  zoneName: string;
  source: 'cv_minimap_dot' | 'cv_contour' | 'inferred';
  confidence: number;
  clockTime: number;
  freshness: DataFreshness;
}

export type NetworthSource =
  | 'gsi_reported'
  | 'buyback_reconstructed'
  | 'earned_gold_fallback'
  | 'current_gold_floor';

export interface NetworthProvenance {
  value: number;
  source: NetworthSource;
  confidence: number; // 1.0 for GSI, 0.7 for buyback, 0.45 for earned, 0.2 for floor
  epistemicStatus: EpistemicStatus;
}

export interface EnemyHeroTracker {
  id?: number;
  name: string;
  heroNameClean: string;
  level: number;
  alive: boolean;
  respawnSeconds: number;
  lastSeenClockTime: number; // clock_time in seconds when last visible
  missingDurationSeconds: number;
  lastKnownLocation: { x: number; y: number; zoneName: string; zoneInfo?: MapZoneInfo };
  lastKnownHpPercent: number;
  lastKnownManaPercent: number;
  items: string[];
  hasBlink: boolean;
  hasBkb: boolean;
  hasShadowBlade: boolean;
  threatScore: number; // 0 to 10
  observationSource: ObservationSource;
  certainty: number; // 0.0 to 1.0
  lastObservedAt: number; // Unix epoch ms
  freshness: DataFreshness;
}

export type PlanStatus =
  | 'created'
  | 'active'
  | 'executing'
  | 'safe'
  | 'compromised'
  | 'objective_achieved'
  | 'completed'
  | 'violated'
  | 'abandoned';

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
  certainty: number;
  status: PlanStatus;
  recommendationSource?: 'd2pt_fresh' | 'd2pt_stale' | 'd2pt_outdated_patch' | 'gemini_strategic' | 'heuristic_default';
  epistemicStatus?: EpistemicStatus;
  violationReason?: string;
  progressPercent?: number;
}

export interface ThreatEvaluation {
  id: string;
  level: 'low' | 'medium' | 'high' | 'critical';
  title: string;
  riskScore: number; // heuristic score for backwards compatibility
  heuristicRiskScore: number; // 0.0 to 1.0 expert heuristic mapping, not a calibrated statistical probability
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
    | 'PLAN_COMPLETED'
    | 'HERO_DEATH'
    | 'ROSHAN_ALERT'
    | 'ZONE_CHANGE';
  severity: 'info' | 'warning' | 'critical';
  description: string;
  identityKey?: string; // used for deduplication & throttling
  payload?: any;
}

export interface EconomicTrends {
  networthNow: number;
  networthDelta5m: number;
  xpDelta5m: number;
  goldPerMinute: number;
  xpPerMinute: number;
  pocketGoldDelta30s: number;
  spendingDetected: number;
  estimatedFarmVelocityPerSec: number; // calculated from Networth growth, not pocket gold
  estimatedNetworthReference: number; // reference curve heuristic
  expectedNetworthBenchmark: number; // legacy field compatibility
  networthDifference: number; // networthNow - estimatedNetworthReference
  deathsLast10m: number;
  killsLast10m: number;
}

export interface PlayerStatusEffects {
  silenced: boolean;
  stunned: boolean;
  disarmed: boolean;
  magicImmune: boolean;
  hexed: boolean;
  muted: boolean;
  breakApplied: boolean;
  smokeActive: boolean;
  hasDebuff: boolean;
}

export interface KeyCooldowns {
  ultimate: { name: string; ready: boolean; cooldown: number; level: number };
  bkb: { owned: boolean; ready: boolean; cooldown: number };
  manta: { owned: boolean; ready: boolean; cooldown: number };
  blink: { owned: boolean; ready: boolean; cooldown: number };
  tp: { ready: boolean; cooldown: number; charges: number };
}

export interface TacticalActionState {
  now: 'RETREAT' | 'FARM_SAFE' | 'PUSH_LANE' | 'TEAMFIGHT' | 'ROSHAN';
  why: string[];
  until: string;
  riskScore: number;
  heuristicRiskScore: number;
}

export interface AdviceOutcomeRecord {
  id: string;
  matchId: string;
  timestamp: number;
  createdAt: number;
  clockTime: number;
  triggerReason: string;
  adviceText: string;
  recommendedAction: string;
  planId?: string;
  initialPlayerState: {
    hpPercent: number;
    zone: string;
    alive: boolean;
    networth: number;
  };
  validUntilClock: number;
  evaluatedAtClock?: number;
  playerFollowedAction?: boolean;
  result?: 'survived' | 'died' | 'farm_accelerated' | 'objective_secured' | 'neutral' | 'expired';
  resultNotes?: string;
}

export interface SharedWorldModel {
  observationMode: 'player_gsi_fow_restricted' | 'spectator_gsi' | 'mock_simulation' | 'hybrid_gsi_cv';
  meta: {
    revision: number;
    matchId: string;
    serverTime: number;
    clockTime: number;
    formattedClock: string;
    gamePhase: string;
    isDaytime: boolean;
    dayNightCountdown: number;
  };
  player: {
    team: 'radiant' | 'dire';
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
    networthDetails?: NetworthProvenance;
    kda: { kills: number; deaths: number; assists: number };
    lastHits: number;
    denies: number;
    currentZone: string;
    zoneInfo: MapZoneInfo;
    coordinates: { x: number; y: number };
    inventory: string[];
    abilities: Array<{ name: string; level: number; cooldown: number; canCast: boolean; isUlt: boolean }>;
    statusEffects: PlayerStatusEffects;
    keyCooldowns: KeyCooldowns;
    buyback: {
      canBuyback: boolean;
      cost: number;
      cooldown: number;
      surplus: number;
    };
  };
  trends: EconomicTrends;
  enemies: Record<string, EnemyHeroTracker>;
  anonymousContacts: AnonymousContact[];
  visionDraft?: {
    radiantHeroes: string[];
    direHeroes: string[];
    lastUpdated: number;
  };
  mapControl: {
    towerDataAvailable: boolean;
    alliedTowersAlive: number | null;
    enemyTowersAlive: number | null;
    roshanStatus: 'alive' | 'dead' | 'respawning' | 'unknown';
    roshanStatusEpistemic: EpistemicStatus;
    roshanTimerSeconds: number;
    roshanSpawnWindow?: { minTime: number; maxTime: number };
    lowerRiskZones: string[];
    currentSafeFarmZones: string[];
    dangerousZones: string[];
  };
  threats: ThreatEvaluation[];
  tacticalActionState: TacticalActionState;
  strategy: {
    activePlan: StrategicPlan | null;
    previousPlans: StrategicPlan[];
    lastGeminiAnalysisTime: number;
  };
  recentEvents: SemanticGameEvent[];
  outcomeHistory: AdviceOutcomeRecord[];
  leyaState: {
    lastInferenceLatencyMs: number;
    operationalPicture: string;
    immediateAction: string;
    riskScore: number;
  };
}

export function createInitialWorldModel(): SharedWorldModel {
  return {
    observationMode: 'player_gsi_fow_restricted',
    meta: {
      revision: 0,
      matchId: '',
      serverTime: Date.now(),
      clockTime: -90,
      formattedClock: '-01:30',
      gamePhase: 'INIT',
      isDaytime: true,
      dayNightCountdown: 0,
    },
    player: {
      team: 'radiant',
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
      networthDetails: {
        value: 600,
        source: 'current_gold_floor',
        confidence: 0.2,
        epistemicStatus: 'INFERRED',
      },
      kda: { kills: 0, deaths: 0, assists: 0 },
      lastHits: 0,
      denies: 0,
      currentZone: 'Radiant Base',
      zoneInfo: {
        name: 'Radiant Base',
        allegiance: 'ally',
        kind: 'base',
        baseRisk: 0.05,
      },
      coordinates: { x: 0, y: 0 },
      inventory: [],
      abilities: [],
      statusEffects: {
        silenced: false,
        stunned: false,
        disarmed: false,
        magicImmune: false,
        hexed: false,
        muted: false,
        breakApplied: false,
        smokeActive: false,
        hasDebuff: false,
      },
      keyCooldowns: {
        ultimate: { name: '', ready: false, cooldown: 0, level: 0 },
        bkb: { owned: false, ready: false, cooldown: 0 },
        manta: { owned: false, ready: false, cooldown: 0 },
        blink: { owned: false, ready: false, cooldown: 0 },
        tp: { ready: true, cooldown: 0, charges: 1 },
      },
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
      xpPerMinute: 0,
      pocketGoldDelta30s: 0,
      spendingDetected: 0,
      estimatedFarmVelocityPerSec: 0,
      estimatedNetworthReference: 600,
      expectedNetworthBenchmark: 600,
      networthDifference: 0,
      deathsLast10m: 0,
      killsLast10m: 0,
    },
    enemies: {},
    anonymousContacts: [],
    mapControl: {
      towerDataAvailable: false,
      alliedTowersAlive: null,
      enemyTowersAlive: null,
      roshanStatus: 'unknown',
      roshanStatusEpistemic: 'UNKNOWN',
      roshanTimerSeconds: 0,
      lowerRiskZones: ['Radiant Base', 'Radiant Triangle', 'Radiant Main Jungle'],
      currentSafeFarmZones: ['Radiant Base', 'Radiant Triangle', 'Radiant Main Jungle'],
      dangerousZones: ['Dire Base', 'Dire Triangle', 'Dire Main Jungle', 'River'],
    },
    threats: [],
    tacticalActionState: {
      now: 'FARM_SAFE',
      why: ['Начальная фаза матча', 'Ожидание первой оценки карты'],
      until: 'Достижение 6 уровня или покупка первого артефакта',
      riskScore: 0.1,
      heuristicRiskScore: 0.1,
    },
    strategy: {
      activePlan: null,
      previousPlans: [],
      lastGeminiAnalysisTime: 0,
    },
    recentEvents: [],
    outcomeHistory: [],
    leyaState: {
      lastInferenceLatencyMs: 0,
      operationalPicture: 'Ожидание начала матча',
      immediateAction: 'farm_safe',
      riskScore: 0.1,
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
    this.model.meta.revision = (this.model.meta.revision ?? 0) + 1;
    updater(this.model);
    return this.model;
  }

  public reset(matchId: string = ''): void {
    this.model = createInitialWorldModel();
    this.model.meta.matchId = matchId;
  }
}
