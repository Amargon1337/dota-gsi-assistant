import { ConfigManager } from './ai-config';
import { SharedWorldModel } from '../engine/world-model';
import { ContextBuilder } from '../engine/context-builder';

export type GankRiskLevel = 'safe' | 'caution' | 'dangerous' | 'critical';

export const VALID_TACTICAL_ACTIONS = ['farm_safe', 'push_lane', 'roshan', 'teamfight', 'retreat'] as const;
export const VALID_GANK_RISKS = ['safe', 'caution', 'dangerous', 'critical'] as const;
export const VALID_PLAN_SAFETIES = ['safe', 'compromised', 'critical_violation'] as const;

export interface LayaCognitiveResult {
  available: boolean;
  latencyMs: number;
  gankRiskLevel: GankRiskLevel;
  riskScore: number;
  heuristicRiskScore: number;
  tacticalAction: 'farm_safe' | 'push_lane' | 'roshan' | 'teamfight' | 'retreat';
  certainty: number;
  planSafety: 'safe' | 'compromised' | 'critical_violation';
  raw?: any;
}

export class LayaClient {
  public static async evaluateWorldModel(model: SharedWorldModel, focus?: string): Promise<LayaCognitiveResult> {
    const config = ConfigManager.get();
    const startTime = Date.now();
    const document = ContextBuilder.buildLayaDocument(model);

    const questions: Record<string, any> = {
      tactical_action: {
        type: 'choice',
        instructions: focus
          ? `Immediate response to this event: ${focus}`
          : 'What is the immediate optimal macro action for the hero?',
        criteria: ['farm_safe', 'push_lane', 'roshan', 'teamfight', 'retreat'],
      },
      gank_risk: {
        type: 'choice',
        instructions: 'Assess immediate gank risk from supplied telemetry only. Never invent unseen heroes.',
        criteria: ['safe', 'caution', 'dangerous', 'critical'],
      },
      plan_safety: {
        type: 'choice',
        instructions: 'Is the current strategic plan still safe given supplied enemy and player data?',
        criteria: ['safe', 'compromised', 'critical_violation'],
      },
    };

    if (focus?.includes('DEATH ANALYSIS')) {
      questions.death_cause = {
        type: 'choice',
        instructions: 'Classify the most likely death cause from supplied telemetry.',
        criteria: ['positioning', 'missing_information', 'resource_timing', 'mechanical_or_unobserved'],
      };
      questions.death_recommendation = {
        type: 'choice',
        instructions: 'Give one concise corrective action for the next attempt.',
        criteria: [
          'wait_for_information',
          'change_route',
          'respect_cooldowns',
          'reduce_aggression',
          'review_mechanics',
        ],
      };
    }

    if (focus?.includes('POST-GAME REVIEW')) {
      questions.next_game_focus = {
        type: 'choice',
        instructions: 'Choose one highest-value improvement focus for the next game.',
        criteria: [
          'positioning',
          'map_information',
          'farm_efficiency',
          'resource_timing',
          'death_discipline',
        ],
      };
    }

    const payload = {
      state: { document },
      questions,
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

      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const json = await response.json();
      const answers = json.answers || {};

      const rawTactical = answers.tactical_action?.choice;
      const tacticalAction = (VALID_TACTICAL_ACTIONS as readonly string[]).includes(rawTactical)
        ? rawTactical as LayaCognitiveResult['tacticalAction']
        : 'farm_safe';

      const rawGank = answers.gank_risk?.choice;
      const gankChoice: GankRiskLevel = (VALID_GANK_RISKS as readonly string[]).includes(rawGank)
        ? rawGank as GankRiskLevel
        : 'safe';

      const rawSafety = answers.plan_safety?.choice;
      const planSafety = (VALID_PLAN_SAFETIES as readonly string[]).includes(rawSafety)
        ? rawSafety as LayaCognitiveResult['planSafety']
        : 'safe';

      const actionConfidence = Number(
        answers.tactical_action?.answer_confidence ?? answers.tactical_action?.confidence ?? 0.85
      );
      const gankProbabilities = answers.gank_risk?.probabilities || {};

      let calculatedRiskScore = 0.15;
      if (gankChoice === 'critical') calculatedRiskScore = 0.70 + (gankProbabilities.critical ?? 0.2) * 0.29;
      else if (gankChoice === 'dangerous') calculatedRiskScore = 0.50 + (gankProbabilities.dangerous ?? 0.1) * 0.20;
      else if (gankChoice === 'caution') calculatedRiskScore = 0.30 + (gankProbabilities.caution ?? 0.1) * 0.19;
      else calculatedRiskScore = Math.max(0.05, (1 - (gankProbabilities.safe ?? 0.9)) * 0.3);

      const certainty = Math.max(0, Math.min(1, Math.round(actionConfidence * 100) / 100));
      const finalRisk = Math.round(calculatedRiskScore * 100) / 100;

      return {
        available: true,
        latencyMs: Date.now() - startTime,
        gankRiskLevel: gankChoice,
        riskScore: finalRisk,
        heuristicRiskScore: finalRisk,
        tacticalAction,
        certainty,
        planSafety,
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
    let tacticalAction: LayaCognitiveResult['tacticalAction'] = 'farm_safe';
    let planSafety: LayaCognitiveResult['planSafety'] = 'safe';

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
      heuristicRiskScore: riskScore,
      tacticalAction,
      certainty: 0.80,
      planSafety,
    };
  }
}
