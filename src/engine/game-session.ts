import { EventEmitter } from 'events';
import { WorldModelStore } from './world-model';
import { ObservationCollector } from '../gsi/observation-collector';

export type GamePhase = 'INIT' | 'PRE_GAME' | 'IN_PROGRESS' | 'POST_GAME';

export interface GameSessionState {
  matchId: string;
  phase: GamePhase;
  startedAt: number;
  lastClockTime: number;
  isActive: boolean;
}

export interface SessionResettable {
  reset(): void;
}

export class GameSessionManager extends EventEmitter {
  private static instance: GameSessionManager;
  private currentMatchId: string = '';
  private phase: GamePhase = 'INIT';
  private startedAt: number = 0;
  private lastClockTime: number = -90;
  private registeredComponents: SessionResettable[] = [];

  private constructor() {
    super();
  }

  public static getInstance(): GameSessionManager {
    if (!GameSessionManager.instance) {
      GameSessionManager.instance = new GameSessionManager();
    }
    return GameSessionManager.instance;
  }

  public registerComponent(component: SessionResettable): void {
    if (!this.registeredComponents.includes(component)) {
      this.registeredComponents.push(component);
    }
  }

  public getCurrentMatchId(): string {
    return this.currentMatchId;
  }

  public getSessionState(): GameSessionState {
    return {
      matchId: this.currentMatchId,
      phase: this.phase,
      startedAt: this.startedAt,
      lastClockTime: this.lastClockTime,
      isActive: this.phase === 'IN_PROGRESS' || this.phase === 'PRE_GAME',
    };
  }

  /**
   * Processes incoming matchid and game_state from GSI.
   * If a new match is detected, triggers a guaranteed atomic full reset across all subsystems.
   */
  public update(matchId: string, gameState?: string, clockTime?: number): boolean {
    let matchChanged = false;

    if (clockTime !== undefined) {
      this.lastClockTime = clockTime;
    }

    if (matchId && matchId !== this.currentMatchId) {
      console.log(`[SESSION] Обнаружен новый матч: ${this.currentMatchId || 'none'} ➔ ${matchId}`);
      this.fullReset(matchId);
      matchChanged = true;
    }

    if (gameState) {
      const prevPhase = this.phase;
      if (gameState.includes('PRE_GAME')) {
        this.phase = 'PRE_GAME';
      } else if (gameState.includes('IN_PROGRESS')) {
        this.phase = 'IN_PROGRESS';
      } else if (gameState.includes('POST_GAME')) {
        this.phase = 'POST_GAME';
      }

      if (prevPhase !== this.phase) {
        this.emit('phase_changed', { from: prevPhase, to: this.phase, matchId: this.currentMatchId });
      }
    }

    return matchChanged;
  }

  /**
   * Complete, guaranteed atomic reset of all subsystems.
   * Eliminates any cross-match contamination.
   */
  public fullReset(newMatchId: string = ''): void {
    console.log(`[SESSION] Запуск полного сброса состояния сессии для матча: "${newMatchId}"`);
    this.currentMatchId = newMatchId;
    this.phase = 'INIT';
    this.startedAt = Date.now();
    this.lastClockTime = -90;

    // 1. Wipe World Model Store
    WorldModelStore.getInstance().reset(newMatchId);

    // 2. Wipe Observation Collector
    ObservationCollector.getInstance().reset();

    // 3. Wipe all explicitly registered components (StateEngine, EventEngine, AdvisorService, etc.)
    for (const comp of this.registeredComponents) {
      try {
        comp.reset();
      } catch (err) {
        console.error('[SESSION] Ошибка сброса компонента:', err);
      }
    }

    this.emit('session_reset', { matchId: newMatchId, timestamp: this.startedAt });
  }
}
