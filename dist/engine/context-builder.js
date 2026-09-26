"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ContextBuilder = void 0;
const protracker_service_1 = require("./protracker-service");
class ContextBuilder {
    static buildLayaDocument(model) {
        const p = model.player;
        const m = model.meta;
        const t = model.trends;
        const enemiesSummary = Object.values(model.enemies)
            .map((e) => `${e.heroNameClean}: missing ${e.missingDurationSeconds}s ${e.hasBlink ? '(Blink)' : ''}`)
            .join(', ');
        const recentEventsSummary = model.recentEvents
            .slice(0, 4)
            .map((ev) => ev.description)
            .join('; ');
        const planStatus = model.strategy.activePlan
            ? `Plan: ${model.strategy.activePlan.priority} (${model.strategy.activePlan.status})`
            : 'No active plan';
        return [
            `Clock: ${m.formattedClock} (${m.isDaytime ? 'Day' : 'Night'}).`,
            `Hero: ${p.heroCleanName} Lvl ${p.level}, Zone: «${p.currentZone}».`,
            `HP: ${p.hpPercent}%, Mana: ${p.manaPercent}%. Alive: ${p.alive}.`,
            `Economy: Networth ${p.networth}g (diff ${t.networthDifference > 0 ? '+' : ''}${t.networthDifference}g vs benchmark).`,
            `Trends: 5m NW delta: +${t.networthDelta5m}g, Gold vel: ${t.goldVelocityPerSec}g/s.`,
            `Enemies: [${enemiesSummary || 'All visible or passive'}].`,
            `${planStatus}.`,
            `Recent: [${recentEventsSummary || 'None'}].`,
        ].join(' ');
    }
    static buildGeminiPrompt(model, triggerReason) {
        const p = model.player;
        const m = model.meta;
        const t = model.trends;
        const c = model.mapControl;
        const proTrackerBlock = protracker_service_1.ProTrackerService.buildProTrackerContextPrompt(p.heroName || p.heroCleanName, p.inventory, p.gold, m.clockTime);
        const enemiesDetailed = Object.values(model.enemies)
            .map((e) => `- ${e.heroNameClean} (LVL ${e.level}): Отсутствует: ${e.missingDurationSeconds}с, Последняя локация: ${e.lastKnownLocation.zoneName}, Предметы: [${e.items.join(', ') || 'неизвестно'}]`)
            .join('\n');
        const recentEvents = model.recentEvents
            .slice(0, 6)
            .map((e) => `[${e.formattedTime}] ${e.description}`)
            .join('\n');
        const activePlan = model.strategy.activePlan
            ? `Текущий план: ${model.strategy.activePlan.priority} (Статус: ${model.strategy.activePlan.status})
Целевой предмет плана: ${model.strategy.activePlan.targetItem}
Избегать зон: ${model.strategy.activePlan.avoidZones.join(', ')}
${model.strategy.activePlan.violationReason ? `Причина нарушения: ${model.strategy.activePlan.violationReason}` : ''}`
            : 'Активного плана нет';
        return `
[ВХОДНОЙ СНИМОК ИГРОВОГО МИРА (Dota 2 Shared World Model)]
- Текущий патч: 7.41f
- Игровое время: ${m.formattedClock} (${m.isDaytime ? 'День (обзор 1800)' : 'Ночь (обзор 800 - высокий риск)'})
- Герой игрока: ${p.heroCleanName} (Уровень: ${p.level}), Статус: ${p.alive ? 'ЖИВ' : 'В ТАВЕРНЕ'}
- Текущая зона на карте: «${p.currentZone}» (X: ${p.coordinates.x}, Y: ${p.coordinates.y})
- Ресурсы: HP: ${p.hp}/${p.maxHp} (${p.hpPercent}%), Мана: ${p.mana}/${p.maxMana} (${p.manaPercent}%)
- ТЕКУЩИЙ ИНВЕНТАРЬ И ПРЕДМЕТЫ НА РУКАХ: [${p.inventory.join(', ') || 'пусто'}]
- Золото на руках: ${p.gold}g, Выкуп (Buyback): ${p.buyback.canBuyback ? 'ГОТОВ' : 'НЕ ГОТОВ'} (Стоимость: ${p.buyback.cost}g, Запас/дефицит: ${p.buyback.surplus}g)

${proTrackerBlock}

[ЭКОНОМИКА И ТРЕНДЫ]
- Текущий Net Worth: ${p.networth}g (GPM: ${t.goldPerMinute}, KDA: ${p.kda.kills}/${p.kda.deaths}/${p.kda.assists})
- Дельта Net Worth за 5 минут: ${t.networthDelta5m >= 0 ? '+' : ''}${t.networthDelta5m}g
- Скорость фарма (Gold Velocity): ${t.goldVelocityPerSec} золота/сек
- Ожидаемый эталонный Net Worth для этой минуты: ${t.expectedNetworthBenchmark}g
- Отклонение от темпа: ${t.networthDifference >= 0 ? '+' : ''}${t.networthDifference}g ${t.networthDifference < -500 ? '(ОТСТАВАНИЕ ОТ ТЕМПА)' : '(ОПЕРЕЖЕНИЕ ТЕМПА)'}

[КОНТРОЛЬ КАРТЫ И ВЫШКИ]
- Союзных вышек живо: ${c.alliedTowersAlive} / 11, Вражеских вышек живо: ${c.enemyTowersAlive} / 11
- Рошан: ${c.roshanStatus}

[ВРАЖЕСКАЯ КОМАНДА (ПОСЛЕДНИЕ ДАННЫЕ)]
${enemiesDetailed || 'Нет разведанных данных'}

[СТРАТЕГИЧЕСКИЙ СТАТУС]
${activePlan}

[ПОСЛЕДНИЕ СОБЫТИЯ]
${recentEvents || 'Спокойная обстановка'}

[ЗАПРОС И ВОПРОС ОТ ИГРОКА]
"${triggerReason}"

ЗАДАЧА ТРЕНЕРА (9500 MMR • ПАТЧ 7.41f):
Проведи глубокий, развернутый и конкретный стратегический разбор ситуации для игрока.
КРИТИЧЕСКИ ВАЖНЫЕ ПРАВИЛА:
1. НИКОГДА не выбирай в "targetItem" предмет, который УЖЕ куплен в инвентаре (например, если BKB уже есть, не предлагай BKB)! Выбирай следующий ключевой артефакт по мете Dota2ProTracker на патче 7.41f!
2. В поле "guidanceText" дай МАКСИМАЛЬНО РАЗВЕРНУТЫЙ, структурированный и глубокий ответ (2-3 содержательных абзаца):
   - Раздел 1: Предметный билд и тайминги ProTracker (почему выбран именно этот следующий слот на 7.41f и как его реализовать).
   - Раздел 2: Макро-позиционирование и фарм (по положению вышек и текущей минуте: где фармить безопасно, куда сплитпушить).
   - Раздел 3: Условия драки и Рошан (когда навязывать файт, кого фокусить, когда забирать Рошана и держать ли байбек).

Ответь СТРОГО в формате валидного JSON объекта:
{
  "priority": "краткий емкий заголовок плана (например: Сборка Manta Style и захват треугольника)",
  "targetObjective": "главная стратегическая цель на карте",
  "targetItem": "название СЛЕДУЮЩЕГО артефакта по D2PT (только то, чего еще НЕТ в инвентаре!)",
  "goldNeededForItem": число золота (сколько осталось дособрать),
  "avoidZones": ["список зон, где игроку находиться сейчас смертельно опасно"],
  "safeZones": ["список зон, где рекомендуется безопасно фармить"],
  "guidanceText": "Максимально развернутый, глубокий и полезный текст совета тренера по патчу 7.41f",
  "confidence": число от 0.85 до 0.99
}
`.trim();
    }
}
exports.ContextBuilder = ContextBuilder;
