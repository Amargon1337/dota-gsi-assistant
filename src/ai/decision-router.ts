import { EventEmitter } from 'events';
import { ConfigManager } from './ai-config';
import { GeminiBudgetManager } from './gemini-budget-manager';
import { GameSessionManager, SessionResettable } from '../engine/game-session';
import { SharedWorldModel, StrategicPlan } from '../engine/world-model';

export type TriggerPriority = 'CRITICAL' | 'HIGH' | 'NORMAL' | 'MANUAL';

export interface DecisionTrigger {
  id: string;
  priority: TriggerPriority;
  category:
    | 'plan_violated'
    | 'hero_death'
    | 'plan_completed'
    | 'roshan'
    | 'manual'
    | 'tactical_escalation'
    | 'item_power_spike';
  reason: string;
  clockTime: number;
  matchId: string;
  metadata?: Record<string, any>;
}

export interface RoutingEvaluation {
  allowed: boolean;
  reason?: string;
  trigger?: DecisionTrigger;
}

export class DecisionRouter extends EventEmitter implements SessionResettable {
  private static instance: DecisionRouter;
  private lastCategoryTimes: Map<string, number> = new Map();
  private lastGlobalCallTime = 0;
  private currentMatchId = '';

  // Cooldown durations per category (in seconds)
  private categoryCooldowns: Record<string, number> = {
    plan_violated: 30,
    hero_death: 45,
    plan_completed: 15,
    roshan: 60,
    tactical_escalation: 30,
    item_power_spike: 30,
    manual: 0,
  };

  private constructor() {
    super();
    GameSessionManager.getInstance().registerComponent(this);
  }

  public static getInstance(): DecisionRouter {
    if (!DecisionRouter.instance) {
      DecisionRouter.instance = new DecisionRouter();
    }
    return DecisionRouter.instance;
  }

  public evaluateTrigger(trigger: DecisionTrigger): RoutingEvaluation {
    const now = Date.now();
    const currentSessionMatchId = GameSessionManager.getInstance().getCurrentMatchId();

    // 1. HARD POLICY INVARIANT: Gemini is strictly manual-only.
    // Every trigger that is not priority === 'MANUAL' and category === 'manual' is rejected unconditionally.
    if (trigger.priority !== 'MANUAL' || trigger.category !== 'manual') {
      return {
        allowed: false,
        reason: 'Gemini is manual-only',
        trigger,
      };
    }

    // 2. Stale / cross-match check: ensure trigger belongs to active match
    if (trigger.matchId && currentSessionMatchId && trigger.matchId !== currentSessionMatchId) {
      return {
        allowed: false,
        reason: `Trigger belongs to stale match (${trigger.matchId} != ${currentSessionMatchId})`,
        trigger,
      };
    }

    // 3. Debounce rapid manual spam clicks (min 2 seconds between clicks)
    const elapsedSinceGlobal = (now - this.lastGlobalCallTime) / 1000;
    if (elapsedSinceGlobal < 2) {
      return {
        allowed: false,
        reason: `Manual request rate limit active (${elapsedSinceGlobal.toFixed(1)}s < 2.0s)`,
        trigger,
      };
    }

    return {
      allowed: true,
      trigger,
    };
  }

  public recordTriggerAccepted(trigger: DecisionTrigger): void {
    const now = Date.now();
    this.lastGlobalCallTime = now;
    this.lastCategoryTimes.set(trigger.category, now);
    this.emit('trigger_dispatched', trigger);
  }

  public reset(): void {
    this.lastCategoryTimes.clear();
    this.lastGlobalCallTime = 0;
    this.currentMatchId = GameSessionManager.getInstance().getCurrentMatchId();
    console.log('[DecisionRouter] Сброс состояния и кулдаунов');
  }

  public getStatus(): {
    lastGlobalCallTime: number;
    categoryCooldowns: Record<string, number>;
    cooldownRemaining: Record<string, number>;
  } {
    const now = Date.now();
    const cooldownRemaining: Record<string, number> = {};

    for (const [cat, cooldownSec] of Object.entries(this.categoryCooldowns)) {
      const last = this.lastCategoryTimes.get(cat) || 0;
      const elapsed = (now - last) / 1000;
      cooldownRemaining[cat] = Math.max(0, Math.round(cooldownSec - elapsed));
    }

    return {
      lastGlobalCallTime: this.lastGlobalCallTime,
      categoryCooldowns: this.categoryCooldowns,
      cooldownRemaining,
    };
  }
}
