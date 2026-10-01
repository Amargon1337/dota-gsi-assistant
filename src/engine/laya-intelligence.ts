import fs from 'fs';
import path from 'path';
import { SharedWorldModel, SemanticGameEvent } from './world-model';
import { LayaClient, LayaCognitiveResult } from '../ai/laya-client';
import { GameSessionManager, SessionResettable } from './game-session';

interface PlayerPattern {
  games: number;
  deaths: number;
  avoidableDeaths: number;
  repeatedDeathPatterns: number;
  tiltSignals: number;
  lastUpdated: number;
}

interface LayaMemory {
  version: 1;
  heroes: Record<string, PlayerPattern>;
}

export interface IntelligenceState {
  lastInsight: string;
  lastInsightType: 'event' | 'death' | 'tilt' | 'post_game' | 'none';
  lastEventAt: number;
  eventCount: number;
  deathAnalyses: Array<{
    clockTime: number;
    cause: string;
    evidence: string[];
    recommendation: string;
    confidence: number;
  }>;
  tilt: {
    active: boolean;
    score: number;
    signals: string[];
    lastDetectedClock: number;
  };
  gameSummary: {
    generated: boolean;
    clockTime: number;
    deaths: number;
    repeatedPatterns: number;
    topIssues: string[];
    nextGameFocus: string[];
  };
}

const MEMORY_PATH = path.resolve(__dirname, '../../data/laya_memory.json');

export class LayaIntelligenceService implements SessionResettable {
  private static instance: LayaIntelligenceService;
  private memory: LayaMemory = { version: 1, heroes: {} };
  private state: IntelligenceState = {
    lastInsight: '',
    lastInsightType: 'none',
    lastEventAt: 0,
    eventCount: 0,
    deathAnalyses: [],
    tilt: { active: false, score: 0, signals: [], lastDetectedClock: 0 },
    gameSummary: {
      generated: false,
      clockTime: 0,
      deaths: 0,
      repeatedPatterns: 0,
      topIssues: [],
      nextGameFocus: [],
    },
  };
  private deathTimes: number[] = [];
  private recentZones: Array<{ clock: number; zone: string }> = [];
  private recentEvents: SemanticGameEvent[] = [];
  private lastEventInferenceAt = -999;

  private constructor() {
    this.loadMemory();
    GameSessionManager.getInstance().registerComponent(this);
  }

  public static getInstance(): LayaIntelligenceService {
    if (!this.instance) this.instance = new LayaIntelligenceService();
    return this.instance;
  }

  public reset(): void {
    this.state = {
      lastInsight: '',
      lastInsightType: 'none',
      lastEventAt: 0,
      eventCount: 0,
      deathAnalyses: [],
      tilt: { active: false, score: 0, signals: [], lastDetectedClock: 0 },
      gameSummary: {
        generated: false,
        clockTime: 0,
        deaths: 0,
        repeatedPatterns: 0,
        topIssues: [],
        nextGameFocus: [],
      },
    };
    this.deathTimes = [];
    this.recentZones = [];
    this.recentEvents = [];
    this.lastEventInferenceAt = -999;
  }

  public getState(): IntelligenceState {
    return this.state;
  }

  public async handleEvent(model: SharedWorldModel, event: SemanticGameEvent): Promise<void> {
    this.state.eventCount++;
    this.state.lastEventAt = Date.now();
    this.recentEvents.unshift(event);
    this.recentEvents = this.recentEvents.slice(0, 20);
    this.recentZones.push({ clock: model.meta.clockTime, zone: model.player.currentZone });
    this.recentZones = this.recentZones.filter((z) => model.meta.clockTime - z.clock <= 180);

    if (event.type === 'HERO_DEATH') {
      await this.analyzeDeath(model);
      return;
    }

    this.updateTilt(model, event);

    const important = new Set(['PLAN_VIOLATED', 'ROSHAN_ALERT', 'POWER_SPIKE', 'ENEMY_MISSING', 'TOWER_DESTROYED']);
    if (!important.has(event.type)) return;

    // Laya is event-driven for important transitions, but debounced so a noisy GSI feed
    // cannot turn System-1 into a permanent inference loop.
    if (model.meta.clockTime - this.lastEventInferenceAt < 10) return;
    this.lastEventInferenceAt = model.meta.clockTime;

    const result = await LayaClient.evaluateWorldModel(
      model,
      `EVENT: ${event.type}. ${event.description}. Decide whether this event requires an immediate tactical response and what the player should prioritize next.`
    );

    this.applyLayaInsight(result, 'event', model.meta.clockTime);
  }

  public async buildPostGameSummary(model: SharedWorldModel): Promise<IntelligenceState['gameSummary']> {
    if (this.state.gameSummary.generated) return this.state.gameSummary;

    const deaths = model.player.kda.deaths;
    const repeatedPatterns = this.countRepeatedDeathPatterns();
    const issues: string[] = [];

    if (deaths >= 8) issues.push(`Слишком много смертей: ${deaths}`);
    if (repeatedPatterns > 0) issues.push(`Повторяющийся паттерн смертей: ${repeatedPatterns} раз`);
    if (this.state.tilt.active) issues.push('После смертей обнаружены признаки импульсивной игры');
    if (model.trends.networthDifference < -500) issues.push('Темп net worth заметно ниже ориентирной кривой');
    if (model.trends.deathsLast10m >= 3) issues.push('Высокая частота смертей в последнем отрезке');

    if (!issues.length) issues.push('Явного доминирующего провала по доступному GSI-контексту не обнаружено');

    const nextGameFocus = [
      repeatedPatterns > 0 ? 'После смерти менять маршрут и не повторять тот же вход в опасную зону' : 'Сохранять безопасный маршрут после смертей',
      model.trends.networthDifference < -500 ? 'Сократить пустые перемещения и стабилизировать фарм' : 'Поддерживать текущий темп фарма',
      this.state.tilt.active ? 'После смерти делать короткую паузу перед следующей агрессивной попыткой' : 'Продолжать принимать решения по информации о карте',
    ];

    // One final System-1 pass turns the raw telemetry into a compact next-game focus.
    const result = await LayaClient.evaluateWorldModel(
      model,
      `POST-GAME REVIEW. Deaths: ${deaths}. Repeated patterns: ${repeatedPatterns}. Issues: ${issues.join('; ')}. Give a compact classification of the most important improvement focus for the next game.`
    );

    if (result.available) {
      const raw = result.raw || {};
      const focus = raw.next_game_focus?.choice;
      if (typeof focus === 'string' && focus.trim()) nextGameFocus.unshift(focus.trim());
    }

    this.state.gameSummary = {
      generated: true,
      clockTime: model.meta.clockTime,
      deaths,
      repeatedPatterns,
      topIssues: issues.slice(0, 5),
      nextGameFocus: Array.from(new Set(nextGameFocus)).slice(0, 4),
    };

    this.persistHeroPattern(model, repeatedPatterns);
    return this.state.gameSummary;
  }

  private async analyzeDeath(model: SharedWorldModel): Promise<void> {
    const clock = model.meta.clockTime;
    this.deathTimes.push(clock);
    this.deathTimes = this.deathTimes.filter((t) => clock - t <= 120);

    const p = model.player;
    const evidence: string[] = [];
    let cause = 'unknown';

    const missing = Object.values(model.enemies).filter((e) => e.alive && e.missingDurationSeconds >= 15);
    const dangerous = p.zoneInfo.allegiance === 'enemy' || p.zoneInfo.baseRisk >= 0.6;

    if (dangerous) {
      cause = 'positioning';
      evidence.push(`Смерть в опасной зоне «${p.currentZone}»`);
    }
    if (missing.length >= 2) {
      cause = cause === 'unknown' ? 'missing_information' : cause;
      evidence.push(`${missing.length} врага не были видны перед смертью`);
    }
    if (p.keyCooldowns.bkb.owned && !p.keyCooldowns.bkb.ready) evidence.push('BKB была на перезарядке');
    if (p.hpPercent < 45) evidence.push(`HP был низким: ${p.hpPercent}%`);
    if (!evidence.length) {
      cause = 'mechanical_or_unobserved';
      evidence.push('GSI не содержит достаточного контекста для точного определения причины');
    }

    const repeated = this.hasRepeatedDeathRoute(model);
    if (repeated) evidence.push('Похожий маршрут/зона уже присутствовали перед недавней смертью');

    const result = await LayaClient.evaluateWorldModel(
      model,
      `DEATH ANALYSIS. Determine the primary cause category: positioning, missing_information, resource_timing, mechanical_or_unobserved. Evidence from deterministic telemetry: ${evidence.join('; ')}. Also classify whether this looks like a repeated pattern and choose one concise recommendation.`
    );

    const raw = result.raw || {};
    const layaCause = raw.death_cause?.choice;
    if (typeof layaCause === 'string' && layaCause.trim()) cause = layaCause;

    const recommendation =
      typeof raw.death_recommendation?.choice === 'string'
        ? raw.death_recommendation.choice
        : cause === 'positioning'
        ? 'Перед следующим заходом дождаться информации о пропавших врагах и выбрать более глубокую безопасную точку.'
        : cause === 'missing_information'
        ? 'Не заходить в туман при двух и более пропавших героях без необходимости.'
        : 'Проверить тайминги ключевых ресурсов перед повторной попыткой.';

    this.state.deathAnalyses.unshift({
      clockTime: clock,
      cause,
      evidence: evidence.slice(0, 6),
      recommendation,
      confidence: result.certainty,
    });
    this.state.deathAnalyses = this.state.deathAnalyses.slice(0, 10);

    this.updateTilt(model, {
      id: `death_${clock}`,
      clockTime: clock,
      formattedTime: model.meta.formattedClock,
      type: 'HERO_DEATH',
      severity: 'critical',
      description: 'Hero death',
    });
    this.state.lastInsight = `Смерть ${model.meta.formattedClock}: ${cause}. ${recommendation}`;
    this.state.lastInsightType = 'death';
  }

  private updateTilt(model: SharedWorldModel, event: SemanticGameEvent): void {
    const clock = model.meta.clockTime;
    const recentDeaths = this.deathTimes.filter((t) => clock - t <= 90).length;
    const repeated = this.countRepeatedDeathPatterns();
    const signals: string[] = [];

    if (recentDeaths >= 2) signals.push(`${recentDeaths} смерти за 90 секунд`);
    if (repeated > 0) signals.push('повторяется похожий маршрут перед смертью');
    if (event.type === 'HERO_DEATH' && model.player.buyback.canBuyback) signals.push('после смерти доступен buyback');
    if (model.player.zoneInfo.allegiance === 'enemy' && recentDeaths >= 2) signals.push('агрессивная позиция сразу после серии смертей');

    const score = Math.min(1, recentDeaths * 0.25 + repeated * 0.2 + (signals.length >= 3 ? 0.15 : 0));
    this.state.tilt = {
      active: score >= 0.5,
      score: Math.round(score * 100) / 100,
      signals,
      lastDetectedClock: score >= 0.5 ? clock : this.state.tilt.lastDetectedClock,
    };

    if (this.state.tilt.active) {
      this.state.lastInsight = `Похоже на tilt-паттерн: ${signals.join('; ')}`;
      this.state.lastInsightType = 'tilt';
    }
  }

  private hasRepeatedDeathRoute(model: SharedWorldModel): boolean {
    const zone = model.player.currentZone;
    const recent = this.recentZones.filter((z) => z.zone === zone && model.meta.clockTime - z.clock <= 120);
    return recent.length >= 2;
  }

  private countRepeatedDeathPatterns(): number {
    const analyses = this.state.deathAnalyses;
    const counts = new Map<string, number>();
    for (const a of analyses) counts.set(a.cause, (counts.get(a.cause) || 0) + 1);
    return Array.from(counts.values()).filter((n) => n >= 2).reduce((sum, n) => sum + n - 1, 0);
  }

  private applyLayaInsight(result: LayaCognitiveResult, type: 'event', clock: number): void {
    if (!result.available) return;
    const action = result.tacticalAction.replace(/_/g, ' ');
    this.state.lastInsight = `Laya: ${action}; риск ${result.gankRiskLevel}; уверенность ${Math.round(result.certainty * 100)}%`;
    this.state.lastInsightType = type;
    this.state.lastEventAt = Date.now();
  }

  private persistHeroPattern(model: SharedWorldModel, repeatedPatterns: number): void {
    const hero = model.player.heroName || model.player.heroCleanName || 'unknown';
    const current = this.memory.heroes[hero] || {
      games: 0,
      deaths: 0,
      avoidableDeaths: 0,
      repeatedDeathPatterns: 0,
      tiltSignals: 0,
      lastUpdated: 0,
    };

    current.games += 1;
    current.deaths += model.player.kda.deaths;
    current.repeatedDeathPatterns += repeatedPatterns;
    current.avoidableDeaths += this.state.deathAnalyses.filter((d) => d.cause === 'positioning' || d.cause === 'missing_information').length;
    if (this.state.tilt.active) current.tiltSignals += 1;
    current.lastUpdated = Date.now();
    this.memory.heroes[hero] = current;

    try {
      fs.mkdirSync(path.dirname(MEMORY_PATH), { recursive: true });
      fs.writeFileSync(MEMORY_PATH, JSON.stringify(this.memory, null, 2), 'utf8');
    } catch (err) {
      console.warn('[Laya Intelligence] Не удалось сохранить память игрока:', err);
    }
  }

  private loadMemory(): void {
    try {
      if (fs.existsSync(MEMORY_PATH)) {
        const parsed = JSON.parse(fs.readFileSync(MEMORY_PATH, 'utf8'));
        if (parsed && parsed.version === 1 && parsed.heroes) this.memory = parsed;
      }
    } catch (err) {
      console.warn('[Laya Intelligence] Не удалось загрузить память:', err);
    }
  }
}
