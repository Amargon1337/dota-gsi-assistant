import { EventEmitter } from 'events';
import { ConfigManager } from './ai-config';
import { StateEngine } from '../engine/state-engine';
import { EventEngine } from '../engine/event-engine';
import { WorldModelStore, SharedWorldModel, StrategicPlan, AdviceOutcomeRecord } from '../engine/world-model';
import { LayaClient, LayaCognitiveResult } from './laya-client';
import { GeminiGateway, StrategicPlanResult } from './gemini-gateway';
import { GeminiBudgetManager } from './gemini-budget-manager';
import { DecisionRouter, DecisionTrigger } from './decision-router';
import { GameSessionManager, SessionResettable } from '../engine/game-session';
import { ProcessedGameState, GsiRawPayload } from '../types/gsi';

export class AdvisorService extends EventEmitter implements SessionResettable {
  private static instance: AdvisorService;
  private stateEngine = new StateEngine();
  private eventEngine = new EventEngine();
  private worldModelStore = WorldModelStore.getInstance();
  private budgetManager = GeminiBudgetManager.getInstance();
  private decisionRouter = DecisionRouter.getInstance();

  private lastGeminiCallTime = 0;
  private isEvaluatingLaya = false;
  private lastLayaEvaluationTime = 0;
  private pendingOutcomes: AdviceOutcomeRecord[] = [];

  constructor() {
    super();

    // Register with GameSessionManager for atomic resets across matches
    GameSessionManager.getInstance().registerComponent(this);

    // Wire EventEngine semantic events for dashboard stream (NOT for Gemini)
    this.eventEngine.on('event', (ev) => {
      this.emit('semantic_event', ev);
    });
  }

  public static getInstance(): AdvisorService {
    if (!AdvisorService.instance) {
      AdvisorService.instance = new AdvisorService();
    }
    return AdvisorService.instance;
  }

  public getStateEngine(): StateEngine {
    return this.stateEngine;
  }

  public getDecisionRouter(): DecisionRouter {
    return this.decisionRouter;
  }

  public async onGameStateUpdate(raw: GsiRawPayload, processed: ProcessedGameState): Promise<SharedWorldModel> {
    // 1. State Engine Update (< 0.2ms)
    const model = this.stateEngine.process(raw, processed);

    // 2. Event Engine Evaluation (updates world model & produces dashboard semantic events)
    this.eventEngine.evaluate(model);

    // 3. System-1 Realtime Cognition via Laya (strictly local inference, throttled to 2.5s, NEVER calls Gemini)
    const now = Date.now();
    if (!this.isEvaluatingLaya && now - this.lastLayaEvaluationTime > 2500) {
      this.isEvaluatingLaya = true;
      this.lastLayaEvaluationTime = now;

      LayaClient.evaluateWorldModel(model)
        .then((layaResult: LayaCognitiveResult) => {
          model.leyaState = {
            lastInferenceLatencyMs: layaResult.latencyMs,
            operationalPicture:
              layaResult.planSafety === 'critical_violation'
                ? 'Критический риск! План скомпрометирован'
                : layaResult.gankRiskLevel === 'critical' || layaResult.gankRiskLevel === 'dangerous'
                ? 'Повышенная угроза ганка'
                : 'Штатное развитие игры',
            immediateAction: layaResult.tacticalAction,
            riskScore: layaResult.riskScore,
          };

          // Laya runs 100% autonomously: NEVER triggers Gemini
          this.emit('laya_cognition', layaResult);
        })
        .catch((err) => {
          console.error('[Laya Background Error]', err);
        })
        .finally(() => {
          this.isEvaluatingLaya = false;
        });
    }

    // 4. Outcome Tracking Evaluation Loop (evaluates player trajectory after manual plans)
    this.evaluateOutcomes(model);

    // 5. Broadcast updated World Model
    this.emit('world_update', model);
    return model;
  }

  /**
   * Sole manual entry point for invoking Gemini System-2.
   * Triggered only when the user explicitly clicks the ask button or submits a manual question.
   */
  public async askManualQuestion(question: string): Promise<StrategicPlanResult> {
    const model = this.worldModelStore.getModel();
    const reason = question.trim() || 'Игрок запросил экспресс-совет по текущей ситуации.';

    const trigger: DecisionTrigger = {
      id: `manual_${Date.now()}`,
      priority: 'MANUAL',
      category: 'manual',
      reason,
      clockTime: model.meta.clockTime,
      matchId: model.meta.matchId,
    };

    const evaluation = this.decisionRouter.evaluateTrigger(trigger);
    if (!evaluation.allowed) {
      return {
        success: false,
        guidanceText: `⚠️ Запрос отклонён: ${evaluation.reason}`,
        modelUsed: ConfigManager.get().geminiModel,
        latencyMs: 0,
        error: 'QUOTA_EXCEEDED',
      };
    }

    this.decisionRouter.recordTriggerAccepted(trigger);
    this.lastGeminiCallTime = Date.now();

    // Invocation is strictly typed as 'manual'
    const result = await GeminiGateway.generateStrategicPlan(model, reason, 'manual');

    if (result.success && result.plan) {
      if (model.strategy.activePlan) {
        model.strategy.previousPlans.unshift(model.strategy.activePlan);
        if (model.strategy.previousPlans.length > 5) model.strategy.previousPlans.pop();
      }

      model.strategy.activePlan = result.plan;
      model.strategy.lastGeminiAnalysisTime = Date.now();

      this.recordAdviceOutcome(
        model,
        result.plan.guidanceText,
        result.plan.priority,
        reason,
        result.plan.id
      );

      this.emit('strategic_plan', {
        plan: result.plan,
        guidanceText: result.guidanceText,
        model: result.modelUsed,
        timestamp: Date.now(),
      });
      this.emit('world_update', model);
    }

    return result;
  }

  public recordAdviceOutcome(
    model: SharedWorldModel,
    adviceText: string,
    action: string,
    triggerReason: string,
    planId?: string
  ): AdviceOutcomeRecord {
    const outcomeRecord: AdviceOutcomeRecord = {
      id: `outcome_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      matchId: model.meta.matchId,
      timestamp: Date.now(),
      createdAt: Date.now(),
      clockTime: model.meta.clockTime,
      triggerReason,
      adviceText,
      recommendedAction: action,
      planId,
      initialPlayerState: {
        hpPercent: model.player.hpPercent,
        zone: model.player.currentZone,
        alive: model.player.alive,
        networth: model.player.networth,
      },
      validUntilClock: model.meta.clockTime + 60, // 60s deterministic evaluation horizon
    };

    this.pendingOutcomes.push(outcomeRecord);
    model.outcomeHistory.unshift(outcomeRecord);
    if (model.outcomeHistory.length > 20) model.outcomeHistory.pop();
    return outcomeRecord;
  }

  private evaluateOutcomes(model: SharedWorldModel): void {
    const currentClock = model.meta.clockTime;
    const currentMatchId = model.meta.matchId;
    const resolved: AdviceOutcomeRecord[] = [];

    for (const pending of this.pendingOutcomes) {
      // Discard outcomes belonging to a previous match
      if (pending.matchId && currentMatchId && pending.matchId !== currentMatchId) {
        resolved.push(pending);
        continue;
      }

      // Evaluate outcome if hero died or horizon reached
      if (currentClock >= pending.validUntilClock || !model.player.alive) {
        pending.evaluatedAtClock = currentClock;

        if (!model.player.alive && pending.initialPlayerState.alive) {
          pending.result = 'died';
          pending.resultNotes = 'Герой погиб в течение периода выполнения совета.';
        } else if (model.player.networth >= pending.initialPlayerState.networth + 350) {
          pending.result = 'farm_accelerated';
          pending.resultNotes = `Успешный фарм: +${model.player.networth - pending.initialPlayerState.networth}g за период.`;
        } else {
          pending.result = 'survived';
          pending.resultNotes = 'Позиция удержана без критических потерь.';
        }

        resolved.push(pending);
      }
    }

    if (resolved.length > 0) {
      this.pendingOutcomes = this.pendingOutcomes.filter((p) => !resolved.includes(p));
    }
  }

  public reset(): void {
    console.log('[AdvisorService] Сброс состояния для нового матча');
    this.pendingOutcomes = [];
    this.lastGeminiCallTime = 0;
    this.isEvaluatingLaya = false;
    this.lastLayaEvaluationTime = 0;
    this.stateEngine.reset();
    this.eventEngine.reset();
    this.decisionRouter.reset();
  }

  public getWorldModel(): SharedWorldModel {
    return this.worldModelStore.getModel();
  }
}
