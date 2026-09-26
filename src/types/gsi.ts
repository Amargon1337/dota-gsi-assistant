export interface GsiProvider {
  name: string;
  appid: number;
  version: number;
  timestamp: number;
}

export interface GsiMap {
  name?: string;
  matchid?: string;
  game_time?: number;
  clock_time?: number;
  daytime?: boolean;
  nightstalker_night?: boolean;
  game_state?: string;
  paused?: boolean;
  win_team?: string;
  customgamename?: string;
  ward_purchase_cooldown?: number;
  roshan_state?: string;
  roshan_state_end_seconds?: number;
}

export interface GsiPlayer {
  steamid?: string;
  name?: string;
  activity?: string;
  kills?: number;
  deaths?: number;
  assists?: number;
  last_hits?: number;
  denies?: number;
  kill_streak?: number;
  commands_issued?: number;
  kill_list?: Record<string, number>;
  team_name?: 'radiant' | 'dire' | string;
  gold?: number;
  gold_reliable?: number;
  gold_unreliable?: number;
  gold_from_hero_kills?: number;
  gold_from_creep_kills?: number;
  gold_from_income?: number;
  gold_from_shared?: number;
  gpm?: number;
  xpm?: number;
  net_worth?: number;
}

export interface GsiHero {
  id?: number;
  name?: string;
  level?: number;
  alive?: boolean;
  respawn_seconds?: number;
  buyback_cost?: number;
  buyback_cooldown?: number;
  health?: number;
  max_health?: number;
  health_percent?: number;
  mana?: number;
  max_mana?: number;
  mana_percent?: number;
  silenced?: boolean;
  stunned?: boolean;
  disarmed?: boolean;
  magicimmune?: boolean;
  hexed?: boolean;
  muted?: boolean;
  break?: boolean;
  has_debuff?: boolean;
  xpos?: number;
  ypos?: number;
  facet?: number;
  aghanims_scepter?: boolean;
  aghanims_shard?: boolean;
  smoke?: boolean;
  selected_unit?: boolean;
}

export interface GsiAbility {
  name: string;
  level: number;
  can_cast: boolean;
  passive: boolean;
  ability_active?: boolean;
  cooldown: number;
  ultimate: boolean;
  charges?: number;
  max_charges?: number;
  charge_cooldown?: number;
}

export interface GsiItem {
  name: string;
  purchaser?: number;
  item_level?: number;
  contains_rune?: string;
  can_cast?: boolean;
  cooldown?: number;
  passive?: boolean;
  charges?: number;
}

export interface GsiBuildingHealth {
  health: number;
  max_health: number;
}

export interface GsiRawPayload {
  provider?: GsiProvider;
  map?: GsiMap;
  player?: GsiPlayer;
  hero?: GsiHero;
  abilities?: Record<string, GsiAbility>;
  items?: Record<string, GsiItem>;
  buildings?: Record<string, any>;
  auth?: {
    token?: string;
  };
}

export interface TimedEventAlert {
  id: string;
  name: string;
  secondsRemaining: number;
  targetClockTime: number;
  alertType: 'info' | 'warning' | 'critical';
  voiceSpoken?: boolean;
}

export interface ProcessedGameState {
  connected: boolean;
  lastUpdated: number;
  map: GsiMap;
  player: GsiPlayer;
  hero: GsiHero;
  abilities: Record<string, GsiAbility>;
  items: Record<string, GsiItem>;
  calculated: {
    formattedClock: string;
    isPreGame: boolean;
    isInProgress: boolean;
    isDaytime: boolean;
    nextDayNightSeconds: number;
    buyback: {
      hasGold: boolean;
      isOnCooldown: boolean;
      canBuyback: boolean;
      goldSurplus: number;
    };
    timers: {
      powerRune: number;
      waterRune: number | null;
      bountyRune: number;
      wisdomRune: number;
      lotusPool: number;
      stackAlert: number;
      tormentor: number | null;
      neutralTier: {
        currentTier: number;
        nextTier: number | null;
        secondsUntilNextTier: number | null;
      };
    };
    activeAlerts: Array<{
      id: string;
      title: string;
      message: string;
      secondsLeft: number;
      severity: 'low' | 'medium' | 'high';
    }>;
  };
}
