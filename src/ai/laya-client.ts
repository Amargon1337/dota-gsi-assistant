import { ConfigManager } from './ai-config';
import { SharedWorldModel } from '../engine/world-model';
import { ContextBuilder } from '../engine/context-builder';

export type GankRiskLevel = 'safe' | 'caution' | 'dangerous' | 'critical';

export interface LayaCognitiveResult {
  available: boolean;
  latencyMs: number;
  gankRiskLevel: GankRiskLevel;
  riskScore: number; // 0.0 to 1.0 derived from model distribution
  tacticalAction: 'farm_safe' | 'push_lane' | 'roshan' | 'teamfight' | 'retreat';
  certainty: number; // 0.0 to 1.0
  planSafety: 'safe' | 'compromised' | 'critical_violation';
  escalateToGemini: boolean;
  escalationReason?: string;
  raw?: any;
}

export class LayaClient {
  public static async evaluateWorldModel(model: SharedWorldModel): Promise<LayaCognitiveResult> {
    const config = ConfigManager.get();
    const startTime = Date.now();

    const document = ContextBuilder.buildLayaDocument(model);

    const payload = {
      state: {
        document,
      },
      questions: {
        tactical_action: {
          type: 'choice',
          instructions: 'What is the immediate optimal macro action for the hero?',
          criteria: ['farm_safe', 'push_lane', 'roshan', 'teamfight', 'retreat'],
        },
        gank_risk: {
          type: 'choice',
          instructions: 'Assess the immediate gank risk level for the player based on missing enemies, hero status, position, and daylight.',
          criteria: ['safe', 'caution', 'dangerous', 'critical'],
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
      const gankChoice: GankRiskLevel = answers.gank_risk?.choice ?? 'safe';
      const planSafety = answers.plan_safety?.choice ?? 'safe';

      const actionConfidence = answers.tactical_action?.answer_confidence ?? answers.tactical_action?.confidence ?? 0.85;
      const gankProbabilities = answers.gank_risk?.probabilities || {};

      // Calculate model-grounded riskScore from probability distribution
      let calculatedRiskScore = 0.15;
      if (gankChoice === 'critical') {
        calculatedRiskScore = 0.70 + (gankProbabilities.critical ?? 0.2) * 0.29;
      } else if (gankChoice === 'dangerous') {
        calculatedRiskScore = 0.50 + (gankProbabilities.dangerous ?? 0.1) * 0.20;
      } else if (gankChoice === 'caution') {
        calculatedRiskScore = 0.30 + (gankProbabilities.caution ?? 0.1) * 0.19;
      } else {
        calculatedRiskScore = Math.max(0.05, (1 - (gankProbabilities.safe ?? 0.9)) * 0.3);
      }

      const certainty = Math.round(actionConfidence * 100) / 100;
      const shouldEscalate = planSafety === 'critical_violation' || gankChoice === 'critical';
      const escalationReason = shouldEscalate
        ? planSafety === 'critical_violation'
          ? 'Laya зафиксировала критическое нарушение текущего стратегического плана.'
          : 'Laya зафиксировала критический риск ганка вражеской командой.'
        : undefined;

      return {
        available: true,
        latencyMs: Date.now() - startTime,
        gankRiskLevel: gankChoice,
        riskScore: Math.round(calculatedRiskScore * 100) / 100,
        tacticalAction,
        certainty,
        planSafety,
        escalateToGemini: shouldEscalate,
        escalationReason,
        raw: answers,
      };
    } catch {
      return this.heuristicFallback(model, Date.now() - startTime);
    }
  }

  private static heuristicFallback(model: SharedWorldModel, latencyMs: number): LayaCognitiveResult {
    const zoneInfo = model.player.zoneInfo;
    const isNight = !model.meta.isDaytime;
    let riskScore = zoneInfo.baseRisk;

    if (isNight) riskScore += 0.15;
    if (model.player.hpPercent < 45) riskScore += 0.25;

    const missingBlinkEnemies = Object.values(model.enemies).filter(
      (e) => e.hasBlink && e.missingDurationSeconds >= 20 && e.alive
    );
    if (missingBlinkEnemies.length > 0) riskScore += 0.25;

    riskScore = Math.min(0.99, Math.round(riskScore * 100) / 100);

    let gankRiskLevel: GankRiskLevel = 'safe';
    let tacticalAction: 'farm_safe' | 'push_lane' | 'roshan' | 'teamfight' | 'retreat' = 'farm_safe';
    let planSafety: 'safe' | 'compromised' | 'critical_violation' = 'safe';

    if (riskScore >= 0.70) {
      gankRiskLevel = 'critical';
      tacticalAction = 'retreat';
      planSafety = 'critical_violation';
    } else if (riskScore >= 0.50) {
      gankRiskLevel = 'dangerous';
      tacticalAction = 'retreat';
      planSafety = 'compromised';
    } else if (riskScore >= 0.30) {
      gankRiskLevel = 'caution';
      tacticalAction = 'farm_safe';
    }

    return {
      available: false,
      latencyMs,
      gankRiskLevel,
      riskScore,
      tacticalAction,
      certainty: 0.80,
      planSafety,
      escalateToGemini: planSafety === 'critical_violation',
      escalationReason: planSafety === 'critical_violation' ? 'Критический эвристический риск ганка' : undefined,
    };
  }
}
