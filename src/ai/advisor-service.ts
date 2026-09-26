import { EventEmitter } from 'events';
import { ConfigManager } from './ai-config';
import { StateEngine } from '../engine/state-engine';
import { EventEngine } from '../engine/event-engine';
import { WorldModelStore, SharedWorldModel, StrategicPlan, AdviceOutcomeRecord } from '../engine/world-model';
import { LayaClient, LayaCognitiveResult } from './laya-client';
import { GeminiClient } from './gemini-client';
import { GeminiBudgetManager } from './gemini-budget-manager';
import { ProcessedGameState, GsiRawPayload } from '../types/gsi';

export class AdvisorService extends EventEmitter {
  private static instance: AdvisorService;
  private stateEngine = new StateEngine();
  private eventEngine = new EventEngine();
  private worldModelStore = WorldModelStore.getInstance();
  private budgetManager = GeminiBudgetManager.getInstance();

  private lastGeminiCallTime = 0;
  private isEvaluatingLaya = false;
  private lastLayaEvaluationTime = 0;
  private pendingOutcomes: AdviceOutcomeRecord[] = [];

  constructor() {
    super();

    // Wire EventEngine semantic events to AdvisorService
    this.eventEngine.on('event', (ev) => {
      this.emit('semantic_event', ev);
    });

    // Wire Decision Router events for autoCoach
    this.eventEngine.on('plan_violated', (plan: StrategicPlan) => {
      this.handleAutonomousDecision(
        `План «${plan.priority}» нарушен! Причина: ${plan.violationReason || 'опасная позиция'}`
      );
    });

    this.eventEngine.on('hero_death', (deathInfo: { clock: number; respawnSeconds: number }) => {
      this.handleAutonomousDecision(
        `Герой погиб на ${Math.floor(deathInfo.clock / 60)} мин (возрождение ${deathInfo.respawnSeconds}с). Нужен план выкупа и действий после возрождения.`
      );
    });

    this.eventEngine.on('plan_completed', (plan: StrategicPlan) => {
      this.handleAutonomousDecision(
        `Предыдущая цель «${plan.targetItem}» достигнута! Сформируй следующий стратегический артефакт и вектор движения.`
      );
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
            this.handleAutonomousDecision(
              layaResult.escalationReason || 'Laya System-1 зафиксировала критическую угрозу.'
            );
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

  private handleAutonomousDecision(reason: string): void {
    const config = ConfigManager.get();
    if (!config.autoCoachEnabled) {
      return; // Autonomous coach is disabled, manual mode only
    }

    this.triggerGeminiReplanning(reason);
  }

  public async triggerGeminiReplanning(reason: string): Promise<void> {
    const config = ConfigManager.get();
    const now = Date.now();
    const throttleMs = (config.rateLimitSeconds || 15) * 1000;

    // Enforce minimal time interval between calls
    if (now - this.lastGeminiCallTime < throttleMs) {
      console.log(`[Decision Router] Пропуск автовызова Gemini (прошло меньше ${config.rateLimitSeconds}с)`);
      return;
    }

    // Enforce Budget Manager Quotas (RPM & RPD)
    const budget = this.budgetManager.checkBudget();
    if (!budget.allowed) {
      console.warn(`[Decision Router] Gemini заблокирован квотой: ${budget.reason}`);
      return;
    }

    this.lastGeminiCallTime = now;
    const model = this.worldModelStore.getModel();

    console.log(`🧠 [Decision Router -> Gemini] Запрос стратегического плана: "${reason}"`);
    const result = await GeminiClient.generateStrategicPlan(model, reason);

    if (result.success && result.plan) {
      if (model.strategy.activePlan) {
        model.strategy.previousPlans.unshift(model.strategy.activePlan);
        if (model.strategy.previousPlans.length > 5) model.strategy.previousPlans.pop();
      }

      model.strategy.activePlan = result.plan;
      model.strategy.lastGeminiAnalysisTime = now;

      // Register new advice outcome for tracking
      this.recordAdviceOutcome(model, result.plan.guidanceText, result.plan.priority);

      this.emit('strategic_plan', {
        plan: result.plan,
        guidanceText: result.guidanceText,
        model: result.modelUsed,
        timestamp: now,
      });

      this.emit('world_update', model);
    }
  }

  public async askManualQuestion(question: string): Promise<any> {
    const model = this.worldModelStore.getModel();
    const reason = question.trim() || 'Игрок запросил экспресс-совет по текущей ситуации.';
    this.lastGeminiCallTime = Date.now();

    const result = await GeminiClient.generateStrategicPlan(model, reason);

    if (result.success && result.plan) {
      model.strategy.activePlan = result.plan;
      this.recordAdviceOutcome(model, result.plan.guidanceText, result.plan.priority);

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

  private recordAdviceOutcome(model: SharedWorldModel, adviceText: string, action: string): void {
    const outcomeRecord: AdviceOutcomeRecord = {
      id: `outcome_${Date.now()}`,
      timestamp: Date.now(),
      clockTime: model.meta.clockTime,
      adviceText,
      recommendedAction: action,
      initialPlayerState: {
        hpPercent: model.player.hpPercent,
        zone: model.player.currentZone,
        alive: model.player.alive,
        networth: model.player.networth,
      },
    };

    this.pendingOutcomes.push(outcomeRecord);
    model.outcomeHistory.unshift(outcomeRecord);
    if (model.outcomeHistory.length > 20) model.outcomeHistory.pop();
  }

  private evaluateOutcomes(model: SharedWorldModel): void {
    const currentClock = model.meta.clockTime;
    const resolved: AdviceOutcomeRecord[] = [];

    for (const pending of this.pendingOutcomes) {
      // Evaluate outcome after 45 seconds or if hero died
      if (currentClock - pending.clockTime >= 45 || !model.player.alive) {
        pending.evaluatedAtClock = currentClock;

        if (!model.player.alive && pending.initialPlayerState.alive) {
          pending.result = 'died';
          pending.resultNotes = 'Герой погиб в течение 45 сек после совета.';
        } else if (model.player.networth >= pending.initialPlayerState.networth + 400) {
          pending.result = 'farm_accelerated';
          pending.resultNotes = `Успешный фарм: +${model.player.networth - pending.initialPlayerState.networth}g за 45 сек.`;
        } else {
          pending.result = 'survived';
          pending.resultNotes = 'Позиция удержана без потерь.';
        }

        resolved.push(pending);
      }
    }

    // Remove resolved outcomes from pending queue
    if (resolved.length > 0) {
      this.pendingOutcomes = this.pendingOutcomes.filter((p) => !resolved.includes(p));
    }
  }

  public getWorldModel(): SharedWorldModel {
    return this.worldModelStore.getModel();
  }
}
