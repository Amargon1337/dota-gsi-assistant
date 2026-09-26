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

    // Wire EventEngine semantic events
    this.eventEngine.on('event', (ev) => {
      this.emit('semantic_event', ev);
    });

    // Wire Decision Router events for autonomous coaching
    this.eventEngine.on('plan_violated', (plan: StrategicPlan) => {
      const model = this.worldModelStore.getModel();
      const trigger: DecisionTrigger = {
        id: `violation_${Date.now()}`,
        priority: 'CRITICAL',
        category: 'plan_violated',
        reason: `План «${plan.priority}» нарушен! Причина: ${plan.violationReason || 'опасная зона'}`,
        clockTime: model.meta.clockTime,
        matchId: model.meta.matchId,
        metadata: { planId: plan.id },
      };
      this.handleRouterTrigger(trigger);
    });

    this.eventEngine.on('hero_death', (deathInfo: { clock: number; respawnSeconds: number }) => {
      const model = this.worldModelStore.getModel();
      const trigger: DecisionTrigger = {
        id: `death_${Date.now()}`,
        priority: 'CRITICAL',
        category: 'hero_death',
        reason: `Герой погиб на ${Math.floor(deathInfo.clock / 60)} мин (возрождение ${deathInfo.respawnSeconds}с). Нужен план выкупа и действий после возрождения.`,
        clockTime: deathInfo.clock,
        matchId: model.meta.matchId,
        metadata: deathInfo,
      };
      this.handleRouterTrigger(trigger);
    });

    this.eventEngine.on('plan_completed', (plan: StrategicPlan) => {
      const model = this.worldModelStore.getModel();
      const trigger: DecisionTrigger = {
        id: `completed_${Date.now()}`,
        priority: 'NORMAL',
        category: 'plan_completed',
        reason: `Предыдущая цель «${plan.targetItem}» достигнута! Сформируй следующий стратегический артефакт и вектор движения.`,
        clockTime: model.meta.clockTime,
        matchId: model.meta.matchId,
        metadata: { planId: plan.id, targetItem: plan.targetItem },
      };
      this.handleRouterTrigger(trigger);
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

    // 2. Event Engine Evaluation
    this.eventEngine.evaluate(model);

    // 3. System-1 Realtime Cognition via Laya (asynchronous, throttled to 2.5s)
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

          // Decision Router: Escalation from Laya System-1 to Gemini System-2
          if (layaResult.escalateToGemini) {
            const trigger: DecisionTrigger = {
              id: `laya_escalation_${Date.now()}`,
              priority: 'HIGH',
              category: 'tactical_escalation',
              reason: layaResult.escalationReason || 'Laya System-1 зафиксировала критическую угрозу позиции.',
              clockTime: model.meta.clockTime,
              matchId: model.meta.matchId,
            };
            this.handleRouterTrigger(trigger);
          }

          this.emit('laya_cognition', layaResult);
        })
        .catch((err) => {
          console.error('[Laya Background Error]', err);
        })
        .finally(() => {
          this.isEvaluatingLaya = false;
        });
    }

    // 4. Outcome Tracking Evaluation Loop
    this.evaluateOutcomes(model);

    // 5. Broadcast updated World Model
    this.emit('world_update', model);
    return model;
  }

  private handleRouterTrigger(trigger: DecisionTrigger): void {
    const evaluation = this.decisionRouter.evaluateTrigger(trigger);
    if (!evaluation.allowed) {
      console.log(`[Decision Router Rejected] ${trigger.category}: ${evaluation.reason}`);
      return;
    }

    this.decisionRouter.recordTriggerAccepted(trigger);
    this.executeReplanning(trigger.reason, trigger.category, trigger.metadata?.planId);
  }

  private async executeReplanning(reason: string, category: string, planId?: string): Promise<void> {
    const now = Date.now();
    this.lastGeminiCallTime = now;
    const model = this.worldModelStore.getModel();

    console.log(`🧠 [Decision Router -> Gemini Gateway] Запрос стратегического плана: "${reason}"`);
    const result = await GeminiGateway.generateStrategicPlan(model, reason);

    if (result.success && result.plan) {
      if (model.strategy.activePlan) {
        model.strategy.previousPlans.unshift(model.strategy.activePlan);
        if (model.strategy.previousPlans.length > 5) model.strategy.previousPlans.pop();
      }

      model.strategy.activePlan = result.plan;
      model.strategy.lastGeminiAnalysisTime = now;

      // Register new advice outcome for tracking
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
        timestamp: now,
      });

      this.emit('world_update', model);
    }
  }

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

    const result = await GeminiGateway.generateStrategicPlan(model, reason);

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
