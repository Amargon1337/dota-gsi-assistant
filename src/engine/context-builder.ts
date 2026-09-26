import { SharedWorldModel, StrategicPlan } from './world-model';
import { D2PTDataStore } from './d2pt-store';

export class ContextBuilder {
  public static buildLayaDocument(model: SharedWorldModel): string {
    const p = model.player;
    const m = model.meta;
    const t = model.trends;
    const z = p.zoneInfo;

    const enemiesSummary = Object.values(model.enemies)
      .filter((e) => e.alive)
      .map((e) => `${e.heroNameClean}: missing ${e.missingDurationSeconds}s ${e.hasBlink ? '(Blink)' : ''} [${e.freshness}]`)
      .join(', ');

    const ultText = p.keyCooldowns.ultimate.ready
      ? `${p.keyCooldowns.ultimate.name || 'Ult'}: READY`
      : `${p.keyCooldowns.ultimate.name || 'Ult'}: ${p.keyCooldowns.ultimate.cooldown}s`;

    const bkbText = p.keyCooldowns.bkb.owned
      ? p.keyCooldowns.bkb.ready
        ? 'BKB: READY'
        : `BKB: ${p.keyCooldowns.bkb.cooldown}s`
      : 'No BKB';

    const debuffText = p.statusEffects.stunned
      ? 'STUNNED'
      : p.statusEffects.silenced
      ? 'SILENCED'
      : p.statusEffects.hexed
      ? 'HEXED'
      : p.statusEffects.magicImmune
      ? 'SPELL IMMUNE'
      : 'Normal';

    const planStatus = model.strategy.activePlan
      ? `Plan: ${model.strategy.activePlan.priority} (${model.strategy.activePlan.status})`
      : 'No active plan';

    return [
      `Clock: ${m.formattedClock} (${m.isDaytime ? 'Day' : 'Night'}).`,
      `Hero: ${p.heroCleanName} Lvl ${p.level}, Status: ${p.alive ? 'ALIVE' : 'DEAD'}, State: ${debuffText}.`,
      `Zone: «${z.name}» (allegiance: ${z.allegiance}, kind: ${z.kind}, baseRisk: ${(z.baseRisk * 100).toFixed(0)}%).`,
      `HP: ${p.hpPercent}%, Mana: ${p.manaPercent}%. Spells: [${ultText}, ${bkbText}].`,
      `Economy: Networth ${p.networth}g (diff ${t.networthDifference > 0 ? '+' : ''}${t.networthDifference}g vs benchmark), Farm: ${t.estimatedFarmVelocityPerSec} g/s.`,
      `Enemies: [${enemiesSummary || 'All visible or passive'}].`,
      `${planStatus}.`,
    ].join(' ');
  }

  public static buildGeminiPrompt(model: SharedWorldModel, triggerReason: string): string {
    const p = model.player;
    const m = model.meta;
    const t = model.trends;
    const c = model.mapControl;
    const z = p.zoneInfo;

    const proTrackerBlock = D2PTDataStore.buildD2PTContextPrompt(
      p.heroName || p.heroCleanName,
      p.inventory,
      p.gold,
      m.clockTime
    );

    const enemiesDetailed = Object.values(model.enemies)
      .map(
        (e) =>
          `- ${e.heroNameClean} (LVL ${e.level}): Отсутствует: ${e.missingDurationSeconds}с, Локация: ${
            e.lastKnownLocation.zoneName
          } (${e.observationSource}, свежесть: ${e.freshness}), Предметы: [${e.items.join(', ') || 'неизвестно'}]`
      )
      .join('\n');

    const recentEvents = model.recentEvents
      .slice(0, 6)
      .map((e) => `[${e.formattedTime}] ${e.description}`)
      .join('\n');

    const statusEffectsList = [
      p.statusEffects.silenced ? 'Сайленс' : '',
      p.statusEffects.stunned ? 'Стан' : '',
      p.statusEffects.disarmed ? 'Обезоружен' : '',
      p.statusEffects.magicImmune ? 'Невосприимчивость к магии' : '',
      p.statusEffects.hexed ? 'Хекс' : '',
      p.statusEffects.breakApplied ? 'Отключение пассивок (Break)' : '',
    ]
      .filter(Boolean)
      .join(', ');

    const keySpells = [
      `Ультимейт (${p.keyCooldowns.ultimate.name || 'Ult'}): ${p.keyCooldowns.ultimate.ready ? 'ГОТОВ' : `${p.keyCooldowns.ultimate.cooldown}с перезарядка`}`,
      p.keyCooldowns.bkb.owned ? `BKB: ${p.keyCooldowns.bkb.ready ? 'ГОТОВ' : `${p.keyCooldowns.bkb.cooldown}с`}` : 'BKB нет',
      p.keyCooldowns.manta.owned ? `Manta: ${p.keyCooldowns.manta.ready ? 'ГОТОВА' : `${p.keyCooldowns.manta.cooldown}с`}` : '',
      p.keyCooldowns.blink.owned ? `Blink: ${p.keyCooldowns.blink.ready ? 'ГОТОВ' : `${p.keyCooldowns.blink.cooldown}с`}` : '',
      `TP скролл: ${p.keyCooldowns.tp.ready ? 'ГОТОВ' : `${p.keyCooldowns.tp.cooldown}с`}`,
    ]
      .filter(Boolean)
      .join(' | ');

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
- Герой игрока: ${p.heroCleanName} (Уровень: ${p.level}), Сторона: ${p.team.toUpperCase()}, Статус: ${p.alive ? 'ЖИВ' : 'В ТАВЕРНЕ'}
- Текущая зона на карте: «${z.name}» (Принадлежность: ${z.allegiance === 'enemy' ? 'ВРАЖЕСКАЯ ⚠️' : z.allegiance === 'ally' ? 'СОЮЗНАЯ ✅' : 'НЕЙТРАЛЬНАЯ'}, Тип: ${z.kind})
- Ресурсы: HP: ${p.hp}/${p.maxHp} (${p.hpPercent}%), Мана: ${p.mana}/${p.maxMana} (${p.manaPercent}%)
- Состояние героя (Status Effects): ${statusEffectsList || 'В норме (дебаффов нет)'}
- Готовность ключевых заклинаний и артефактов: ${keySpells}
- ТЕКУЩИЙ ИНВЕНТАРЬ НА РУКАХ: [${p.inventory.join(', ') || 'пусто'}]
- Золото на руках: ${p.gold}g, Выкуп (Buyback): ${p.buyback.canBuyback ? 'ГОТОВ' : 'НЕ ГОТОВ'} (Стоимость: ${p.buyback.cost}g, Запас/дефицит: ${p.buyback.surplus}g)

${proTrackerBlock}

[ЭКОНОМИКА И ТРЕНДЫ]
- Текущий Net Worth: ${p.networth}g (GPM: ${t.goldPerMinute}, XPM: ${t.xpPerMinute}, KDA: ${p.kda.kills}/${p.kda.deaths}/${p.kda.assists})
- Дельта Net Worth за 5 минут: ${t.networthDelta5m >= 0 ? '+' : ''}${t.networthDelta5m}g
- Скорость фарма (Farm Velocity): ${t.estimatedFarmVelocityPerSec} золота/сек (на основе чистого прироста ценности)
- Ожидаемый эталонный Net Worth для этой минуты: ${t.expectedNetworthBenchmark}g
- Отклонение от темпа: ${t.networthDifference >= 0 ? '+' : ''}${t.networthDifference}g ${
      t.networthDifference < -500 ? '(ОТСТАВАНИЕ ОТ ТЕМПА)' : '(ОПЕРЕЖЕНИЕ ТЕМПА)'
    }

[КОНТРОЛЬ КАРТЫ И ВЫШКИ]
- Союзных вышек живо: ${c.alliedTowersAlive} / 11, Вражеских вышек живо: ${c.enemyTowersAlive} / 11
- Рошан: ${c.roshanStatus.toUpperCase()} ${c.roshanTimerSeconds > 0 ? `(респавн через ~${c.roshanTimerSeconds}с)` : ''}

[ВРАЖЕСКАЯ КОМАНДА]
${enemiesDetailed || 'Нет данных разведки'}

[СТРАТЕГИЧЕСКИЙ СТАТУС]
${activePlan}

[ПОСЛЕДНИЕ СОБЫТИЯ]
${recentEvents || 'Спокойная обстановка'}

[ЗАПРОС И ТРИГГЕР ОТ ИГРОКА / СИСТЕМЫ]
"${triggerReason}"

ЗАДАЧА ТРЕНЕРА (9500 MMR • ПАТЧ 7.41f):
Проведи глубокий, развернутый и конкретный стратегический разбор ситуации для игрока.
КРИТИЧЕСКИ ВАЖНЫЕ ПРАВИЛА:
1. НИКОГДА не выбирай в "targetItem" предмет, который УЖЕ куплен в инвентаре (например, если BKB или Manta уже есть, не предлагай их)! Выбирай следующий ключевой артефакт по мете Dota2ProTracker на патче 7.41f!
2. В поле "guidanceText" дай МАКСИМАЛЬНО РАЗВЕРНУТЫЙ, структурированный и глубокий ответ (2-3 содержательных абзаца):
   - Раздел 1: Предметный билд и тайминги ProTracker (почему выбран именно этот следующий слот на 7.41f, с учетом текущих кулдаунов и состояния).
   - Раздел 2: Макро-позиционирование и фарм (по положению вышек, дню/ночи и текущей минуте: где фармить безопасно, куда сплитпушить).
   - Раздел 3: Условия драки и Рошан (когда навязывать файт с учетом готовности ультимейта и BKB, кого фокусить, когда забирать Рошана и держать ли байбек).

Ответь СТРОГО в формате валидного JSON объекта:
{
  "priority": "краткий емкий заголовок плана (например: Сборка Butterfly и сплитпуш)",
  "targetObjective": "главная стратегическая цель на карте",
  "targetItem": "название СЛЕДУЮЩЕГО артефакта по D2PT (только то, чего еще НЕТ в инвентаре!)",
  "goldNeededForItem": число золота (сколько осталось дособрать),
  "avoidZones": ["список зон, где игроку находиться сейчас смертельно опасно"],
  "safeZones": ["список зон, где рекомендуется безопасно фармить"],
  "guidanceText": "Максимально развернутый, глубокий и полезный текст совета тренера по патчу 7.41f",
  "certainty": число от 0.85 до 0.99
}
`.trim();
  }
}
