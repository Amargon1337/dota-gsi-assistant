import { EventEmitter } from 'events';
import { ConfigManager } from './ai-config';
import { StateEngine } from '../engine/state-engine';
import { EventEngine } from '../engine/event-engine';
import { WorldModelStore, SharedWorldModel, StrategicPlan } from '../engine/world-model';
import { LayaClient, LayaCognitiveResult } from './laya-client';
import { GeminiClient } from './gemini-client';
import { ProcessedGameState, GsiRawPayload } from '../types/gsi';

export class AdvisorService extends EventEmitter {
  private static instance: AdvisorService;
  private stateEngine = new StateEngine();
  private eventEngine = new EventEngine();
  private worldModelStore = WorldModelStore.getInstance();

  private lastGeminiCallTime = 0;
  private lastHeroAlive = true;
  private isEvaluatingLaya = false;
  private lastLayaEvaluationTime = 0;

  constructor() {
    super();

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

  public async onGameStateUpdate(raw: GsiRawPayload, processed: ProcessedGameState): Promise<SharedWorldModel> {
    // 1. Process State & History Buffer (instantaneous, < 0.2ms)
    const model = this.stateEngine.process(raw, processed);

    // 2. Evaluate Semantic Events & Threats
    this.eventEngine.evaluate(model);

    // 3. System-1 Realtime Cognition via Laya (asynchronous, throttled to 2.5s, non-blocking)
    const now = Date.now();
    if (!this.isEvaluatingLaya && (now - this.lastLayaEvaluationTime > 2500)) {
      this.isEvaluatingLaya = true;
      this.lastLayaEvaluationTime = now;

      LayaClient.evaluateWorldModel(model)
        .then((layaResult: LayaCognitiveResult) => {
          model.leyaState = {
            lastInferenceLatencyMs: layaResult.latencyMs,
            operationalPicture: layaResult.planSafety === 'critical_violation' ? 'Опасность! План скомпрометирован' : 'Штатное развитие игры',
            immediateAction: layaResult.tacticalAction,
            confidence: layaResult.confidence,
          };

          this.emit('laya_cognition', layaResult);
        })
        .catch((err) => {
          console.error('[Laya Background Error]', err);
        })
        .finally(() => {
          this.isEvaluatingLaya = false;
        });
    }

    this.lastHeroAlive = model.player.alive;

    // 4. Broadcast full World Model update to WebSocket clients
    this.emit('world_update', model);
    return model;
  }

  public async triggerGeminiReplanning(reason: string): Promise<void> {
    const config = ConfigManager.get();
    const now = Date.now();
    const throttleMs = config.rateLimitSeconds * 1000;

    if (now - this.lastGeminiCallTime < throttleMs) {
      console.log(`[Gemini Throttle] Пропуск автовызова (прошло меньше ${config.rateLimitSeconds}с)`);
      return;
    }

    this.lastGeminiCallTime = now;
    const model = this.worldModelStore.getModel();

    console.log(`🧠 [Gemini System-2] Запрос стратегического плана: "${reason}"`);
    const result = await GeminiClient.generateStrategicPlan(model, reason);

    if (result.success && result.plan) {
      // Archive previous plan
      if (model.strategy.activePlan) {
        model.strategy.previousPlans.unshift(model.strategy.activePlan);
        if (model.strategy.previousPlans.length > 5) model.strategy.previousPlans.pop();
      }

      model.strategy.activePlan = result.plan;
      model.strategy.lastGeminiAnalysisTime = now;

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

  public getWorldModel(): SharedWorldModel {
    return this.worldModelStore.getModel();
  }
}
