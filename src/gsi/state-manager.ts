import { EventEmitter } from 'events';
import { GsiRawPayload, ProcessedGameState, GsiMap, GsiPlayer, GsiHero, GsiAbility, GsiItem } from '../types/gsi';

function deepMerge<T>(target: any, source: any): T {
  if (!source) return target;
  if (!target) return source;

  const output = { ...target };
  for (const key of Object.keys(source)) {
    const sourceVal = source[key];
    const targetVal = target[key];

    if (
      sourceVal !== null &&
      typeof sourceVal === 'object' &&
      !Array.isArray(sourceVal) &&
      typeof targetVal === 'object' &&
      !Array.isArray(targetVal)
    ) {
      output[key] = deepMerge(targetVal, sourceVal);
    } else {
      output[key] = sourceVal;
    }
  }
  return output as T;
}

import { GameSessionManager } from '../engine/game-session';

export class StateManager extends EventEmitter {
  private rawState: GsiRawPayload = {};
  private lastUpdateTimestamp: number = 0;
  private spokenAlerts: Set<string> = new Set();

  constructor() {
    super();
    GameSessionManager.getInstance().registerComponent(this);
  }

  public update(payload: GsiRawPayload): ProcessedGameState {
    this.lastUpdateTimestamp = Date.now();

    // Notify GameSessionManager of incoming match id and state
    if (payload.map?.matchid) {
      GameSessionManager.getInstance().update(
        payload.map.matchid,
        payload.map.game_state,
        payload.map.clock_time
      );
    }

    // Merge incoming delta
    this.rawState = deepMerge<GsiRawPayload>(this.rawState, payload);

    // Process state
    const processed = this.processState(this.rawState);

    // Emit live update
    this.emit('state', processed);

    return processed;
  }

  public getRawState(): GsiRawPayload {
    return JSON.parse(JSON.stringify(this.rawState));
  }

  public getLatestState(): ProcessedGameState {
    return this.processState(this.rawState);
  }

  public reset(): void {
    this.rawState = {};
    this.spokenAlerts.clear();
    this.lastUpdateTimestamp = 0;
    this.emit('state', this.getLatestState());
  }

  private processState(raw: GsiRawPayload): ProcessedGameState {
    const map: GsiMap = raw.map || {};
    const player: GsiPlayer = raw.player || {};
    const hero: GsiHero = raw.hero || {};
    const abilities: Record<string, GsiAbility> = raw.abilities || {};
    const items: Record<string, GsiItem> = raw.items || {};

    const clockTime = map.clock_time ?? -90;
    const isPreGame = map.game_state === 'DOTA_GAMERULES_STATE_PRE_GAME' || clockTime < 0;
    const isInProgress = map.game_state === 'DOTA_GAMERULES_STATE_GAME_IN_PROGRESS';
    const isDaytime = map.daytime ?? true;

    // Formatting clock time: e.g. -01:15 or 24:35
    const absSeconds = Math.abs(clockTime);
    const mins = Math.floor(absSeconds / 60);
    const secs = absSeconds % 60;
    const sign = clockTime < 0 ? '-' : '';
    const formattedClock = `${sign}${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;

    // Buyback calculations
    const currentGold = player.gold ?? 0;
    const buybackCost = hero.buyback_cost ?? 0;
    const buybackCooldown = hero.buyback_cooldown ?? 0;
    const hasGold = currentGold >= buybackCost;
    const isOnCooldown = buybackCooldown > 0;
    const canBuyback = (hero.alive === false || hero.respawn_seconds! > 0)
      ? (hasGold && !isOnCooldown)
      : (hasGold && !isOnCooldown);
    const goldSurplus = currentGold - buybackCost;

    // Day/Night: changes every 300 seconds (5 min) starting at 0:00
    let nextDayNightSeconds = 0;
    if (clockTime >= 0) {
      nextDayNightSeconds = 300 - (clockTime % 300);
      if (nextDayNightSeconds === 300) nextDayNightSeconds = 0;
    }

    // Macro Timers
    // 1. Water Runes (minutes 2 and 4, i.e. 120s and 240s)
    let waterRune: number | null = null;
    if (clockTime >= 0 && clockTime < 120) {
      waterRune = 120 - clockTime;
    } else if (clockTime >= 120 && clockTime < 240) {
      waterRune = 240 - clockTime;
    }

    // 2. Power Runes (every 2m starting at 6:00 = 360s)
    let powerRune = 0;
    if (clockTime < 360) {
      powerRune = 360 - clockTime;
    } else {
      const rem = clockTime % 120;
      powerRune = rem === 0 ? 120 : 120 - rem;
    }

    // 3. Bounty Runes (every 3m = 180s: 0, 180, 360, 540...)
    let bountyRune = 0;
    if (clockTime < 0) {
      bountyRune = Math.abs(clockTime);
    } else {
      const rem = clockTime % 180;
      bountyRune = rem === 0 ? 180 : 180 - rem;
    }

    // 4. Wisdom Runes (every 7m = 420s: 420, 840, 1260...)
    let wisdomRune = 0;
    if (clockTime < 420) {
      wisdomRune = 420 - clockTime;
    } else {
      const rem = clockTime % 420;
      wisdomRune = rem === 0 ? 420 : 420 - rem;
    }

    // 5. Lotus Pool (every 3m = 180s starting at 3:00 = 180s)
    let lotusPool = 0;
    if (clockTime < 180) {
      lotusPool = 180 - clockTime;
    } else {
      const rem = clockTime % 180;
      lotusPool = rem === 0 ? 180 : 180 - rem;
    }

    // 6. Creep Camp Stacking (alert at :53 of each minute)
    let stackAlert = 0;
    if (clockTime >= 0) {
      const secInMin = clockTime % 60;
      if (secInMin <= 53) {
        stackAlert = 53 - secInMin;
      } else {
        stackAlert = 60 - secInMin + 53;
      }
    }

    // 7. Tormentor (spawns at 20:00 = 1200s)
    let tormentor: number | null = null;
    if (clockTime < 1200) {
      tormentor = 1200 - clockTime;
    }

    // 8. Neutral Item Tiers (7:00=420s, 17:00=1020s, 27:00=1620s, 37:00=2220s, 60:00=3600s)
    const tiers = [
      { tier: 1, time: 420 },
      { tier: 2, time: 1020 },
      { tier: 3, time: 1620 },
      { tier: 4, time: 2220 },
      { tier: 5, time: 3600 },
    ];
    let currentTier = 0;
    let nextTier: number | null = null;
    let secondsUntilNextTier: number | null = null;

    if (clockTime >= 0) {
      for (const t of tiers) {
        if (clockTime >= t.time) {
          currentTier = t.tier;
        } else {
          nextTier = t.tier;
          secondsUntilNextTier = t.time - clockTime;
          break;
        }
      }
    }

    // Generate active alerts
    const activeAlerts: Array<{
      id: string;
      title: string;
      message: string;
      secondsLeft: number;
      severity: 'low' | 'medium' | 'high';
    }> = [];

    // Trigger alerts during active match
    if (isInProgress && clockTime >= 0) {
      // Power rune alert at 15s
      if (clockTime >= 345 && powerRune > 0 && powerRune <= 20) {
        activeAlerts.push({
          id: `power_rune_${Math.floor((clockTime + powerRune) / 60)}`,
          title: 'Активная руна',
          message: `Руна появится через ${powerRune} сек`,
          secondsLeft: powerRune,
          severity: powerRune <= 10 ? 'high' : 'medium',
        });
        this.checkVoiceTrigger(`power_rune_${Math.floor((clockTime + powerRune) / 60)}`, powerRune, 15, 'Активная руна через пятнадцать секунд');
      }

      // Water rune alert
      if (waterRune !== null && waterRune <= 20 && waterRune > 0) {
        activeAlerts.push({
          id: `water_rune_${waterRune <= 20 ? 1 : 2}`,
          title: 'Водные руны',
          message: `Водные руны через ${waterRune} сек`,
          secondsLeft: waterRune,
          severity: 'medium',
        });
        this.checkVoiceTrigger(`water_rune_${Math.floor((clockTime + waterRune) / 60)}`, waterRune, 15, 'Водные руны через пятнадцать секунд');
      }

      // Wisdom rune alert at 25s
      if (wisdomRune > 0 && wisdomRune <= 25) {
        activeAlerts.push({
          id: `wisdom_rune_${Math.floor((clockTime + wisdomRune) / 60)}`,
          title: 'Руна мудрости',
          message: `Руна мудрости через ${wisdomRune} сек`,
          secondsLeft: wisdomRune,
          severity: 'high',
        });
        this.checkVoiceTrigger(`wisdom_${Math.floor((clockTime + wisdomRune) / 60)}`, wisdomRune, 20, 'Руна мудрости через двадцать секунд');
      }

      // Stacking alert at 7s before :53 (i.e. stackAlert <= 7)
      if (stackAlert <= 7 && stackAlert > 0) {
        activeAlerts.push({
          id: `stack_${Math.floor(clockTime / 60)}`,
          title: 'Стак крипов',
          message: `Отводите крипов через ${stackAlert} сек!`,
          secondsLeft: stackAlert,
          severity: 'high',
        });
        this.checkVoiceTrigger(`stack_${Math.floor(clockTime / 60)}`, stackAlert, 5, 'Приготовьтесь стакать лагерь');
      }

      // Tormentor alert
      if (tormentor !== null && tormentor <= 30 && tormentor > 0) {
        activeAlerts.push({
          id: 'tormentor_spawn',
          title: 'Терзатель',
          message: `Терзатель появится через ${tormentor} сек`,
          secondsLeft: tormentor,
          severity: 'medium',
        });
        this.checkVoiceTrigger('tormentor_20m', tormentor, 20, 'Терзатель появится через двадцать секунд');
      }

      // Neutral tier alert
      if (secondsUntilNextTier !== null && secondsUntilNextTier <= 30 && secondsUntilNextTier > 0) {
        activeAlerts.push({
          id: `neutral_tier_${nextTier}`,
          title: `Нейтралки Tier ${nextTier}`,
          message: `Доступны через ${secondsUntilNextTier} сек`,
          secondsLeft: secondsUntilNextTier,
          severity: 'medium',
        });
        this.checkVoiceTrigger(`neutral_tier_${nextTier}`, secondsUntilNextTier, 20, `Нейтральные предметы ${nextTier} тира через двадцать секунд`);
      }
    }

    const isConnected = Date.now() - this.lastUpdateTimestamp < 15000;

    return {
      connected: isConnected,
      lastUpdated: this.lastUpdateTimestamp,
      map,
      player,
      hero,
      abilities,
      items,
      calculated: {
        formattedClock,
        isPreGame,
        isInProgress,
        isDaytime,
        nextDayNightSeconds,
        buyback: {
          hasGold,
          isOnCooldown,
          canBuyback,
          goldSurplus,
        },
        timers: {
          powerRune,
          waterRune,
          bountyRune,
          wisdomRune,
          lotusPool,
          stackAlert,
          tormentor,
          neutralTier: {
            currentTier,
            nextTier,
            secondsUntilNextTier,
          },
        },
        activeAlerts,
      },
    };
  }

  private checkVoiceTrigger(alertKey: string, currentSeconds: number, targetThreshold: number, speechText: string): void {
    if (currentSeconds <= targetThreshold && !this.spokenAlerts.has(alertKey)) {
      this.spokenAlerts.add(alertKey);
      this.emit('voice_alert', {
        key: alertKey,
        text: speechText,
      });
    }
  }
}
