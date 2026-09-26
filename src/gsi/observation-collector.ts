import {
  EnemyHeroTracker,
  ObservationSource,
  DataFreshness,
  MapZoneInfo,
} from '../engine/world-model';
import { classifyMapZone } from '../engine/state-engine';

export interface EnemyObservationInput {
  heroId?: number;
  heroName?: string;
  name?: string;
  alive?: boolean;
  level?: number;
  hpPercent?: number;
  manaPercent?: number;
  items?: string[];
  x?: number;
  y?: number;
  clockTime: number;
  source: ObservationSource;
  certainty?: number;
}

export class ObservationCollector {
  private static instance: ObservationCollector;
  private observations: Map<string, EnemyHeroTracker> = new Map();

  public static getInstance(): ObservationCollector {
    if (!ObservationCollector.instance) {
      ObservationCollector.instance = new ObservationCollector();
    }
    return ObservationCollector.instance;
  }

  public reset(): void {
    this.observations.clear();
    console.log('[OBSERVATION] Хранилище наблюдений за врагами полностью очищено');
  }

  /**
   * Records a confirmed, factual observation of an enemy hero.
   * Source must strictly reflect reality ('gsi', 'mock', 'inferred', 'unknown').
   */
  public observeEnemy(
    input: EnemyObservationInput,
    playerTeam: 'radiant' | 'dire' = 'radiant'
  ): EnemyHeroTracker {
    const rawHeroName = input.heroName || input.name || 'npc_dota_hero_unknown';
    const key = rawHeroName.toLowerCase();
    const x = input.x ?? 0;
    const y = input.y ?? 0;
    const hasCoordinates = input.x !== undefined && input.y !== undefined;
    const zoneInfo = hasCoordinates ? classifyMapZone(x, y, playerTeam) : undefined;
    const zoneName = zoneInfo ? zoneInfo.name : 'Unknown';

    const items = input.items || [];
    const hasBlink = items.some((i) => i.toLowerCase().includes('blink'));
    const hasBkb = items.some((i) => i.toLowerCase().includes('bkb') || i.toLowerCase().includes('black_king_bar'));
    const hasShadowBlade = items.some(
      (i) =>
        i.toLowerCase().includes('invis') ||
        i.toLowerCase().includes('shadow_blade') ||
        i.toLowerCase().includes('silver_edge')
    );

    let threatScore = 3;
    if (hasBlink) threatScore += 3;
    if (hasShadowBlade) threatScore += 2;
    if ((input.level ?? 1) >= 6) threatScore += 2;

    const cleanName = rawHeroName.replace('npc_dota_hero_', '').replace(/_/g, ' ');

    const existing = this.observations.get(key);
    const updatedTracker: EnemyHeroTracker = {
      id: input.heroId ?? existing?.id,
      name: rawHeroName,
      heroNameClean: cleanName,
      level: input.level ?? existing?.level ?? 1,
      alive: input.alive ?? existing?.alive ?? true,
      respawnSeconds: 0,
      lastSeenClockTime: input.clockTime,
      missingDurationSeconds: 0,
      lastKnownLocation: hasCoordinates
        ? { x, y, zoneName, zoneInfo }
        : existing?.lastKnownLocation ?? { x: 0, y: 0, zoneName: 'Unknown' },
      lastKnownHpPercent: input.hpPercent ?? existing?.lastKnownHpPercent ?? 100,
      lastKnownManaPercent: input.manaPercent ?? existing?.lastKnownManaPercent ?? 100,
      items: items.length > 0 ? items : existing?.items ?? [],
      hasBlink,
      hasBkb,
      hasShadowBlade,
      threatScore: Math.min(10, threatScore),
      observationSource: input.source,
      certainty: input.certainty ?? (input.source === 'gsi' ? 0.98 : input.source === 'cv' ? 0.92 : input.source === 'mock' ? 0.95 : 0.6),
      lastObservedAt: Date.now(),
      freshness: 'fresh',
    };

    this.observations.set(key, updatedTracker);
    return updatedTracker;
  }

  /**
   * Marks an enemy as missing, updating elapsed time and freshness.
   */
  public markEnemyMissing(heroName: string, currentClock: number): void {
    const key = heroName.toLowerCase();
    const existing = this.observations.get(key);
    if (!existing) return;

    existing.missingDurationSeconds = Math.max(0, currentClock - existing.lastSeenClockTime);
    this.updateFreshness(existing);
  }

  /**
   * Advances the clock for all enemy observations.
   * If an observation is expired (>60s), flags as expired and lowers certainty.
   */
  public updateClock(currentClock: number): void {
    for (const tracker of this.observations.values()) {
      if (tracker.alive) {
        tracker.missingDurationSeconds = Math.max(0, currentClock - tracker.lastSeenClockTime);
        this.updateFreshness(tracker);
      }
    }
  }

  private updateFreshness(tracker: EnemyHeroTracker): void {
    const missing = tracker.missingDurationSeconds;
    if (missing < 15) {
      tracker.freshness = 'fresh';
    } else if (missing < 60) {
      tracker.freshness = 'stale';
      if (tracker.certainty > 0.6) tracker.certainty = 0.6;
    } else {
      tracker.freshness = 'expired';
      tracker.certainty = 0.2;
    }
  }

  public recordSighting(
    input: EnemyObservationInput,
    playerTeam: 'radiant' | 'dire' = 'radiant'
  ): EnemyHeroTracker {
    return this.observeEnemy(input, playerTeam);
  }

  public getObservations(currentClock?: number): Record<string, EnemyHeroTracker> {
    if (currentClock !== undefined) {
      this.updateClock(currentClock);
    }
    return this.getObservationsRecord();
  }

  public getObservationsRecord(): Record<string, EnemyHeroTracker> {
    const record: Record<string, EnemyHeroTracker> = {};
    for (const [key, tracker] of this.observations.entries()) {
      record[key] = { ...tracker };
    }
    return record;
  }

  public hasAnyObservations(): boolean {
    return this.observations.size > 0;
  }
}
