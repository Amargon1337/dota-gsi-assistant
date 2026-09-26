"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LayaClient = void 0;
const ai_config_1 = require("./ai-config");
const context_builder_1 = require("../engine/context-builder");
class LayaClient {
    static async evaluateWorldModel(model) {
        const config = ai_config_1.ConfigManager.get();
        const startTime = Date.now();
        const document = context_builder_1.ContextBuilder.buildLayaDocument(model);
        const payload = {
            state: {
                document,
            },
            questions: {
                tactical_action: {
                    type: 'choice',
                    instructions: 'What is the immediate optimal macro action?',
                    criteria: ['farm_safe', 'push_lane', 'roshan', 'teamfight', 'retreat'],
                },
                plan_safety: {
                    type: 'choice',
                    instructions: 'Is the current strategic plan still safe given enemy missing status and player location?',
                    criteria: ['safe', 'compromised', 'critical_violation'],
                },
            },
        };
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 15000);
            const response = await fetch(config.layaUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
                signal: controller.signal,
            });
            clearTimeout(timeoutId);
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }
            const json = await response.json();
            const answers = json.answers || {};
            const tacticalAction = answers.tactical_action?.choice ?? 'farm_safe';
            const confidence = answers.tactical_action?.answer_confidence ?? answers.tactical_action?.confidence ?? 0.82;
            const planSafety = answers.plan_safety?.choice ?? 'safe';
            const gankRisk = planSafety === 'critical_violation' ? 0.85 : (planSafety === 'compromised' ? 0.50 : 0.15);
            return {
                available: true,
                latencyMs: Date.now() - startTime,
                gankRisk,
                tacticalAction,
                confidence: Math.round(confidence * 100) / 100,
                planSafety,
                escalateToGemini: planSafety === 'critical_violation',
                raw: answers,
            };
        }
        catch {
            return this.heuristicFallback(model, Date.now() - startTime);
        }
    }
    static heuristicFallback(model, latencyMs) {
        let gankRisk = 0.15;
        const currentZone = model.player.currentZone;
        const isNight = !model.meta.isDaytime;
        if (isNight)
            gankRisk += 0.2;
        if (currentZone.includes('Enemy') || currentZone.includes('River'))
            gankRisk += 0.35;
        if (model.player.hpPercent < 45)
            gankRisk += 0.25;
        // Check missing enemies with blink
        const missingBlinkEnemies = Object.values(model.enemies).filter((e) => e.hasBlink && e.missingDurationSeconds >= 20);
        if (missingBlinkEnemies.length > 0)
            gankRisk += 0.3;
        let tacticalAction = 'farm_safe';
        let planSafety = 'safe';
        if (gankRisk > 0.75) {
            tacticalAction = 'retreat';
            planSafety = 'critical_violation';
        }
        else if (gankRisk > 0.5) {
            planSafety = 'compromised';
        }
        return {
            available: false,
            latencyMs,
            gankRisk: Math.min(0.98, Math.round(gankRisk * 100) / 100),
            tacticalAction,
            confidence: 0.75,
            planSafety,
            escalateToGemini: planSafety === 'critical_violation',
        };
    }
}
exports.LayaClient = LayaClient;
