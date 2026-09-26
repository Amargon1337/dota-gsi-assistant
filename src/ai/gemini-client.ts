import { GeminiGateway, StrategicPlanResult, GeminiErrorCode } from './gemini-gateway';
import { SharedWorldModel, StrategicPlan } from '../engine/world-model';

export { StrategicPlanResult, GeminiErrorCode };

export class GeminiClient {
  public static async generateStrategicPlan(
    model: SharedWorldModel,
    triggerReason: string
  ): Promise<StrategicPlanResult> {
    return GeminiGateway.generateStrategicPlan(model, triggerReason);
  }
}
