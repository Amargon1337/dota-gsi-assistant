import {
  EnemyHeroTracker,
  ObservationSource,
  DataFreshness,
  MapZoneInfo,
  AnonymousContact,
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

const SOURCE_PRIORITY: Record<ObservationSource, number> = {
  gsi: 4,
  cv: 3,
  mock: 2,
  inferred: 1,
  unknown: 0,
};

export class ObservationCollector {
  private static instance: ObservationCollector;
  private observations: Map<string, EnemyHeroTracker> = new Map();
  private anonymousContacts: Map<string, AnonymousContact> = new Map();

  public static getInstance(): ObservationCollector {
    if (!ObservationCollector.instance) {
      ObservationCollector.instance = new ObservationCollector();
    }
    return ObservationCollector.instance;
  }

  public reset(): void {
    this.observations.clear();
    this.anonymousContacts.clear();
    console.log('[OBSERVATION] Хранилище наблюдений за врагами и анонимных контактов полностью очищено');
  }

  /**
   * Records a confirmed, factual observation of an enemy hero.
   * Source must strictly reflect reality ('gsi', 'cv', 'mock', 'inferred', 'unknown').
   */
  public observeEnemy(
    input: EnemyObservationInput,
    playerTeam: 'radiant' | 'dire' = 'radiant'
  ): EnemyHeroTracker {
    const rawHeroName = input.heroName || input.name || 'npc_dota_hero_unknown';
    const key = rawHeroName.toLowerCase();
    const existing = this.observations.get(key);

    // 1. Out-of-Order Sighting Protection:
    // If an incoming async observation has an older clockTime than existing knowledge, ignore it.
    if (existing && input.clockTime < existing.lastSeenClockTime) {
      return existing;
    }

    // 2. Source Priority Protection:
    // If clock times match, do not let lower-priority sources overwrite higher-priority factual GSI/CV data.
    if (
      existing &&
      input.clockTime === existing.lastSeenClockTime &&
      SOURCE_PRIORITY[input.source] < SOURCE_PRIORITY[existing.observationSource]
    ) {
      return existing;
    }

    const x = input.x ?? 0;
    const y = input.y ?? 0;
    const hasCoordinates = input.x !== undefined && input.y !== undefined;
    const zoneInfo = hasCoordinates ? classifyMapZone(x, y, playerTeam) : undefined;
    const zoneName = zoneInfo ? zoneInfo.name : 'Unknown';

    // 3. Merged Inventory Resolution BEFORE Derived Fields:
    // Guarantees hasBlink / hasBkb / hasShadowBlade match the actual effective inventory.
    const incomingItems = input.items && input.items.length > 0 ? input.items : [];
    const effectiveItems = incomingItems.length > 0 ? incomingItems : existing?.items ?? [];

    const hasBlink = effectiveItems.some((i) => i.toLowerCase().includes('blink'));
    const hasBkb = effectiveItems.some(
      (i) => i.toLowerCase().includes('bkb') || i.toLowerCase().includes('black_king_bar')
    );
    const hasShadowBlade = effectiveItems.some(
      (i) =>
        i.toLowerCase().includes('invis') ||
        i.toLowerCase().includes('shadow_blade') ||
        i.toLowerCase().includes('silver_edge')
    );

    let threatScore = 3;
    if (hasBlink) threatScore += 3;
    if (hasShadowBlade) threatScore += 2;
    if ((input.level ?? existing?.level ?? 1) >= 6) threatScore += 2;

    const cleanName = rawHeroName.replace('npc_dota_hero_', '').replace(/_/g, ' ');

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
      items: effectiveItems,
      hasBlink,
      hasBkb,
      hasShadowBlade,
      threatScore: Math.min(10, threatScore),
      observationSource: input.source,
      certainty:
        input.certainty ??
        (input.source === 'gsi' ? 0.98 : input.source === 'cv' ? 0.92 : input.source === 'mock' ? 0.95 : 0.6),
      lastObservedAt: Date.now(),
      freshness: 'fresh',
    };

    this.observations.set(key, updatedTracker);
    return updatedTracker;
  }

  /**
   * Tracks an anonymous enemy contact (e.g. unclassified red blip on minimap).
   * Does NOT assign identity to an arbitrary missing hero.
   */
  public observeAnonymousContact(
    input: {
      id?: string;
      x: number;
      y: number;
      clockTime: number;
      source?: 'cv_minimap_dot' | 'cv_contour' | 'inferred';
      confidence?: number;
    },
    playerTeam: 'radiant' | 'dire' = 'radiant'
  ): AnonymousContact {
    const zoneInfo = classifyMapZone(input.x, input.y, playerTeam);
    const id = input.id || `anon_${Math.round(input.x / 400)}_${Math.round(input.y / 400)}`;
    const contact: AnonymousContact = {
      id,
      x: input.x,
      y: input.y,
      zoneName: zoneInfo.name,
      source: input.source || 'cv_minimap_dot',
      confidence: input.confidence ?? 0.75,
      clockTime: input.clockTime,
      freshness: 'fresh',
    };
    this.anonymousContacts.set(id, contact);
    return contact;
  }

  public getAnonymousContacts(): AnonymousContact[] {
    return Array.from(this.anonymousContacts.values());
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
   * Advances the clock for all enemy observations and anonymous contacts.
   * If an observation is expired (>60s), flags as expired and lowers certainty.
   */
  public updateClock(currentClock: number): void {
    for (const tracker of this.observations.values()) {
      if (tracker.alive) {
        tracker.missingDurationSeconds = Math.max(0, currentClock - tracker.lastSeenClockTime);
        this.updateFreshness(tracker);
      }
    }

    // Clean up or stale anonymous contacts (stale >10s, expired/remove >30s)
    for (const [id, c] of this.anonymousContacts.entries()) {
      const age = currentClock - c.clockTime;
      if (age > 30) {
        this.anonymousContacts.delete(id);
      } else if (age > 10) {
        c.freshness = 'stale';
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
