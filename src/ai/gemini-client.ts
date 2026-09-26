import { ConfigManager } from './ai-config';
import { SharedWorldModel, StrategicPlan } from '../engine/world-model';
import { ContextBuilder } from '../engine/context-builder';
import { D2PTDataStore } from '../engine/d2pt-store';
import { GeminiBudgetManager } from './gemini-budget-manager';

export interface StrategicPlanResult {
  success: boolean;
  plan?: StrategicPlan;
  guidanceText: string;
  modelUsed: string;
  latencyMs: number;
  error?: string;
}

export class GeminiClient {
  public static async generateStrategicPlan(
    model: SharedWorldModel,
    triggerReason: string
  ): Promise<StrategicPlanResult> {
    const config = ConfigManager.get();
    const startTime = Date.now();

    if (!config.geminiApiKey) {
      return {
        success: false,
        guidanceText: '⚠️ Укажите Gemini API ключ в настройках (кнопка вверху).',
        modelUsed: config.geminiModel,
        latencyMs: 0,
        error: 'NO_API_KEY',
      };
    }

    // 1. Enforce Gemini Budget (RPM 15, RPD 500)
    const budgetManager = GeminiBudgetManager.getInstance();
    const budgetCheck = budgetManager.checkBudget();
    if (!budgetCheck.allowed) {
      console.warn(`[Gemini Budget Blocked] ${budgetCheck.reason}`);
      return {
        success: false,
        guidanceText: `⚠️ Запрос отклонён менеджером квоты: ${budgetCheck.reason}`,
        modelUsed: config.geminiModel,
        latencyMs: 0,
        error: 'QUOTA_EXCEEDED',
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
Отвечай СТРОГО в формате валидного JSON объекта.`;

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
      config.geminiModel
    )}:generateContent?key=${encodeURIComponent(config.geminiApiKey)}`;

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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

      const latencyMs = Date.now() - startTime;

      if (!response.ok) {
        const errText = await response.text();
        console.error('[Gemini API Error]', response.status, errText);
        return {
          success: false,
          guidanceText: `Ошибка Gemini (${response.status}): проверьте ключ и модель.`,
          modelUsed: config.geminiModel,
          latencyMs,
          error: `HTTP_${response.status}`,
        };
      }

      // Record successful budget consumption
      budgetManager.recordUsage();

      const json = await response.json();
      const rawText = json.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '{}';

      // Parse JSON from model
      let parsedPlan: any = {};
      try {
        parsedPlan = JSON.parse(rawText.replace(/```json/g, '').replace(/```/g, '').trim());
      } catch {
        console.error('[Gemini JSON Parse Error] Raw text was:', rawText);
        const fallbackAnalysis = D2PTDataStore.determineNextTargetItem(
          model.player.heroName || model.player.heroCleanName,
          model.player.inventory,
          model.player.gold,
          model.meta.clockTime
        );

        parsedPlan = {
          priority: `Фарм ${fallbackAnalysis.targetItem.cleanName} по мете 7.41f`,
          targetObjective: 'Контроль своей половины карты и безопасный фарм',
          targetItem: fallbackAnalysis.targetItem.cleanName,
          goldNeededForItem: fallbackAnalysis.goldRemaining,
          avoidZones: ['Вражеский лес', 'Река'],
          safeZones: ['Свой треугольник', 'Свой лес'],
          guidanceText:
            rawText.length > 50
              ? rawText
              : `Следующий ключевой слот по D2PT: ${fallbackAnalysis.targetItem.cleanName}. Дофармливайте его в безопасных зонах.`,
          certainty: 0.9,
        };
      }

      // Safeguard targetItem against already owned items
      let targetItem = parsedPlan.targetItem || 'Следующий ключевой слот';
      let goldNeeded = Number(parsedPlan.goldNeededForItem) || 1500;

      if (D2PTDataStore.isItemPurchased(targetItem, model.player.inventory)) {
        const nextFix = D2PTDataStore.determineNextTargetItem(
          model.player.heroName || model.player.heroCleanName,
          model.player.inventory,
          model.player.gold,
          model.meta.clockTime
        );
        targetItem = nextFix.targetItem.cleanName;
        goldNeeded = nextFix.goldRemaining;
      }

      const strategicPlan: StrategicPlan = {
        id: `plan_${Date.now()}`,
        createdAtClock: model.meta.clockTime,
        priority: parsedPlan.priority || `Сборка ${targetItem} (Патч 7.41f)`,
        targetObjective: parsedPlan.targetObjective || 'Контроль карты и фарм таймингов',
        targetItem,
        goldNeededForItem: goldNeeded,
        avoidZones: Array.isArray(parsedPlan.avoidZones) ? parsedPlan.avoidZones : ['Вражеская половина', 'Река ночью'],
        safeZones: Array.isArray(parsedPlan.safeZones) ? parsedPlan.safeZones : ['Свой треугольник', 'Основной лес'],
        guidanceText: parsedPlan.guidanceText || 'Соблюдайте тайминги и избегайте необоснованных смертей без байбека.',
        certainty: Number(parsedPlan.certainty ?? parsedPlan.confidence) || 0.92,
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
      console.error('[Gemini Request Error]', err);
      return {
        success: false,
        guidanceText: `Сетевая ошибка: ${err.message}`,
        modelUsed: config.geminiModel,
        latencyMs: Date.now() - startTime,
        error: err.message,
      };
    }
  }
}
