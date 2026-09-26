"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AdvisorService = void 0;
const events_1 = require("events");
const ai_config_1 = require("./ai-config");
const state_engine_1 = require("../engine/state-engine");
const event_engine_1 = require("../engine/event-engine");
const world_model_1 = require("../engine/world-model");
const laya_client_1 = require("./laya-client");
const gemini_client_1 = require("./gemini-client");
class AdvisorService extends events_1.EventEmitter {
    static instance;
    stateEngine = new state_engine_1.StateEngine();
    eventEngine = new event_engine_1.EventEngine();
    worldModelStore = world_model_1.WorldModelStore.getInstance();
    lastGeminiCallTime = 0;
    lastHeroAlive = true;
    isEvaluatingLaya = false;
    lastLayaEvaluationTime = 0;
    constructor() {
        super();
        this.eventEngine.on('event', (ev) => {
            this.emit('semantic_event', ev);
        });
    }
    static getInstance() {
        if (!AdvisorService.instance) {
            AdvisorService.instance = new AdvisorService();
        }
        return AdvisorService.instance;
    }
    getStateEngine() {
        return this.stateEngine;
    }
    async onGameStateUpdate(raw, processed) {
        // 1. Process State & History Buffer (instantaneous, < 0.2ms)
        const model = this.stateEngine.process(raw, processed);
        // 2. Evaluate Semantic Events & Threats
        this.eventEngine.evaluate(model);
        // 3. System-1 Realtime Cognition via Laya (asynchronous, throttled to 2.5s, non-blocking)
        const now = Date.now();
        if (!this.isEvaluatingLaya && (now - this.lastLayaEvaluationTime > 2500)) {
            this.isEvaluatingLaya = true;
            this.lastLayaEvaluationTime = now;
            laya_client_1.LayaClient.evaluateWorldModel(model)
                .then((layaResult) => {
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
    async triggerGeminiReplanning(reason) {
        const config = ai_config_1.ConfigManager.get();
        const now = Date.now();
        const throttleMs = config.rateLimitSeconds * 1000;
        if (now - this.lastGeminiCallTime < throttleMs) {
            console.log(`[Gemini Throttle] Пропуск автовызова (прошло меньше ${config.rateLimitSeconds}с)`);
            return;
        }
        this.lastGeminiCallTime = now;
        const model = this.worldModelStore.getModel();
        console.log(`🧠 [Gemini System-2] Запрос стратегического плана: "${reason}"`);
        const result = await gemini_client_1.GeminiClient.generateStrategicPlan(model, reason);
        if (result.success && result.plan) {
            // Archive previous plan
            if (model.strategy.activePlan) {
                model.strategy.previousPlans.unshift(model.strategy.activePlan);
                if (model.strategy.previousPlans.length > 5)
                    model.strategy.previousPlans.pop();
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
    async askManualQuestion(question) {
        const model = this.worldModelStore.getModel();
        const reason = question.trim() || 'Игрок запросил экспресс-совет по текущей ситуации.';
        this.lastGeminiCallTime = Date.now();
        const result = await gemini_client_1.GeminiClient.generateStrategicPlan(model, reason);
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
    getWorldModel() {
        return this.worldModelStore.getModel();
    }
}
exports.AdvisorService = AdvisorService;
