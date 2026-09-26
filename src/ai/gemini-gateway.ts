import { ConfigManager } from './ai-config';
import { SharedWorldModel, StrategicPlan } from '../engine/world-model';
import { ContextBuilder } from '../engine/context-builder';
import { ItemIdentity } from '../engine/item-identity';
import { GeminiBudgetManager } from './gemini-budget-manager';

export type GeminiErrorCode =
  | 'NO_API_KEY'
  | 'QUOTA_EXCEEDED'
  | 'RATE_LIMITED'
  | 'AUTH_ERROR'
  | 'TIMEOUT'
  | 'INVALID_MODEL_OUTPUT'
  | 'NETWORK_ERROR';

export interface StrategicPlanResult {
  success: boolean;
  plan?: StrategicPlan;
  guidanceText: string;
  modelUsed: string;
  latencyMs: number;
  error?: GeminiErrorCode;
  errorDetails?: string;
}

export class GeminiGateway {
  private static readonly TIMEOUT_MS = 12000;

  public static async generateStrategicPlan(
    model: SharedWorldModel,
    triggerReason: string
  ): Promise<StrategicPlanResult> {
    const config = ConfigManager.get();
    const startTime = Date.now();

    if (!config.geminiApiKey || config.geminiApiKey.trim() === '') {
      return {
        success: false,
        guidanceText: '⚠️ Укажите Gemini API ключ в настройках (кнопка вверху).',
        modelUsed: config.geminiModel,
        latencyMs: 0,
        error: 'NO_API_KEY',
        errorDetails: 'Gemini API key is not configured',
      };
    }

    // 1. Atomic slot reservation (eliminates check-then-act race conditions)
    const budgetManager = GeminiBudgetManager.getInstance();
    const reservation = budgetManager.reserveSlot(triggerReason);

    if (!reservation.allowed) {
      console.warn(`[Gemini Gateway] Запрос отклонён менеджером квоты: ${reservation.reason}`);
      return {
        success: false,
        guidanceText: `⚠️ Запрос отклонён менеджером квоты: ${reservation.reason}`,
        modelUsed: config.geminiModel,
        latencyMs: 0,
        error: 'QUOTA_EXCEEDED',
        errorDetails: reservation.reason,
      };
    }

    const fullPrompt = ContextBuilder.buildGeminiPrompt(model, triggerReason);

    const systemInstruction = `Ты — элитный профессиональный тренер и аналитик по Dota 2 с рангом Immortal (9500+ MMR), специализирующийся на мете текущего патча 7.41f и данных Dota2ProTracker (D2PT).
Игрок запросил глубокий персональный разбор матча в реальном времени.
Твой ответ в поле "guidanceText" должен быть МАКСИМАЛЬНО РАЗВЕРНУТЫМ, структурированным и профессиональным (2-4 подробных абзаца):
1. Детально объясни билд следующего слота с учетом D2PT, таймингов и текущего инвентаря игрока.
   КРИТИЧЕСКОЕ ПРАВИЛО: НИКОГДА не предлагай предметы, которые УЖЕ куплены в инвентаре игрока!
2. Опиши макро-перемещения, расстановку фарма, сплитпуш и опасные зоны.
3. Опиши условия навязывания тимфайтов, тайминги вражеских ультимейтов, Рошана и байбека.
Отвечай СТРОГО в формате валидного JSON объекта с обязательными полями: priority (string), targetObjective (string), targetItem (string), goldNeededForItem (number), avoidZones (string[]), safeZones (string[]), guidanceText (string), certainty (number).`;

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
      config.geminiModel
    )}:generateContent?key=${encodeURIComponent(config.geminiApiKey)}`;

    const controller = new AbortController();
    const timeoutHandle = setTimeout(() => {
      controller.abort();
    }, this.TIMEOUT_MS);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          systemInstruction: {
            parts: [{ text: systemInstruction }],
          },
          contents: [
            {
              role: 'user',
              parts: [{ text: fullPrompt }],
            },
          ],
          generationConfig: {
            temperature: 0.35,
            maxOutputTokens: 1500,
            responseMimeType: 'application/json',
          },
        }),
      });

      clearTimeout(timeoutHandle);
      const latencyMs = Date.now() - startTime;

      if (!response.ok) {
        if (reservation.reservationId) {
          budgetManager.releaseReservation(reservation.reservationId);
        }

        const errText = await response.text();
        console.error('[Gemini Gateway API Error]', response.status, errText);

        let errorCode: GeminiErrorCode = 'NETWORK_ERROR';
        if (response.status === 401 || response.status === 403) {
          errorCode = 'AUTH_ERROR';
        } else if (response.status === 429) {
          errorCode = 'RATE_LIMITED';
        }

        return {
          success: false,
          guidanceText: `Ошибка Gemini (${response.status}): ${errorCode === 'AUTH_ERROR' ? 'неверный API ключ' : errorCode}`,
          modelUsed: config.geminiModel,
          latencyMs,
          error: errorCode,
          errorDetails: `HTTP ${response.status}: ${errText}`,
        };
      }

      const json = await response.json();
      const rawText = json.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';

      // 2. Strict Fail-Closed JSON Parsing: Never synthesize fake fallback plan on invalid JSON
      let parsedPlan: any = null;
      try {
        parsedPlan = JSON.parse(rawText.replace(/```json/g, '').replace(/```/g, '').trim());
      } catch (parseErr: any) {
        console.error('[Gemini Gateway JSON Parse Error] Raw text was:', rawText);
        if (reservation.reservationId) {
          budgetManager.releaseReservation(reservation.reservationId);
        }
        return {
          success: false,
          guidanceText: '⚠️ Модель Gemini вернула некорректный синтаксис JSON. План отклонён (Fail-Closed).',
          modelUsed: config.geminiModel,
          latencyMs,
          error: 'INVALID_MODEL_OUTPUT',
          errorDetails: `JSON Parse error: ${parseErr.message}. Output was: ${rawText.substring(0, 150)}`,
        };
      }

      // 3. Strict Schema Validation before plan adoption
      const validation = this.validatePlanSchema(parsedPlan);
      if (!validation.valid) {
        console.error('[Gemini Gateway Schema Validation Failed]:', validation.errors);
        if (reservation.reservationId) {
          budgetManager.releaseReservation(reservation.reservationId);
        }
        return {
          success: false,
          guidanceText: `⚠️ Ответ модели не соответствует контракту StrategicPlan: ${validation.errors.join('; ')}`,
          modelUsed: config.geminiModel,
          latencyMs,
          error: 'INVALID_MODEL_OUTPUT',
          errorDetails: `Validation errors: ${validation.errors.join(', ')}`,
        };
      }

      // 4. Verification against already owned inventory items
      if (ItemIdentity.satisfiesRequirement(parsedPlan.targetItem, model.player.inventory)) {
        console.warn(`[Gemini Gateway] Модель предложила уже купленный предмет: "${parsedPlan.targetItem}"`);
        if (reservation.reservationId) {
          budgetManager.releaseReservation(reservation.reservationId);
        }
        return {
          success: false,
          guidanceText: `⚠️ План отклонён: предложенный предмет «${parsedPlan.targetItem}» уже есть в инвентаре игрока.`,
          modelUsed: config.geminiModel,
          latencyMs,
          error: 'INVALID_MODEL_OUTPUT',
          errorDetails: `Model recommended already owned item: ${parsedPlan.targetItem}`,
        };
      }

      // 5. Successful plan creation: commit budget slot consumption
      if (reservation.reservationId) {
        budgetManager.commitReservation(reservation.reservationId);
      }

      const strategicPlan: StrategicPlan = {
        id: `plan_${Date.now()}`,
        createdAtClock: model.meta.clockTime,
        priority: parsedPlan.priority.trim(),
        targetObjective: parsedPlan.targetObjective.trim(),
        targetItem: parsedPlan.targetItem.trim(),
        goldNeededForItem: Number(parsedPlan.goldNeededForItem),
        avoidZones: parsedPlan.avoidZones,
        safeZones: parsedPlan.safeZones,
        guidanceText: parsedPlan.guidanceText.trim(),
        certainty: Number(parsedPlan.certainty ?? 0.9),
        status: 'active',
      };

      return {
        success: true,
        plan: strategicPlan,
        guidanceText: strategicPlan.guidanceText,
        modelUsed: config.geminiModel,
        latencyMs,
      };
    } catch (err: any) {
      clearTimeout(timeoutHandle);
      const latencyMs = Date.now() - startTime;

      if (reservation.reservationId) {
        budgetManager.releaseReservation(reservation.reservationId);
      }

      const isAbort = err.name === 'AbortError' || err.message?.includes('aborted');
      const errorCode: GeminiErrorCode = isAbort ? 'TIMEOUT' : 'NETWORK_ERROR';
      const errorMsg = isAbort
        ? `Таймаут запроса к Gemini (${GeminiGateway.TIMEOUT_MS / 1000}s превышено).`
        : `Сетевая ошибка: ${err.message}`;

      console.error(`[Gemini Gateway Error: ${errorCode}]`, err);

      return {
        success: false,
        guidanceText: errorMsg,
        modelUsed: config.geminiModel,
        latencyMs,
        error: errorCode,
        errorDetails: err.message,
      };
    }
  }

  public static validatePlanSchema(data: any): { valid: boolean; errors: string[] } {
    const errors: string[] = [];
    if (!data || typeof data !== 'object') {
      return { valid: false, errors: ['Plan must be a valid JSON object'] };
    }
    if (typeof data.priority !== 'string' || !data.priority.trim()) {
      errors.push('priority must be a non-empty string');
    }
    if (typeof data.targetObjective !== 'string' || !data.targetObjective.trim()) {
      errors.push('targetObjective must be a non-empty string');
    }
    if (typeof data.targetItem !== 'string' || !data.targetItem.trim()) {
      errors.push('targetItem must be a non-empty string');
    }
    if (typeof data.goldNeededForItem !== 'number' || isNaN(data.goldNeededForItem) || data.goldNeededForItem < 0) {
      errors.push('goldNeededForItem must be a non-negative number');
    }
    if (!Array.isArray(data.avoidZones) || data.avoidZones.length === 0) {
      errors.push('avoidZones must be a non-empty array of strings');
    }
    if (!Array.isArray(data.safeZones) || data.safeZones.length === 0) {
      errors.push('safeZones must be a non-empty array of strings');
    }
    if (typeof data.guidanceText !== 'string' || data.guidanceText.trim().length < 10) {
      errors.push('guidanceText must be a detailed string (at least 10 chars)');
    }
    return {
      valid: errors.length === 0,
      errors,
    };
  }
}
