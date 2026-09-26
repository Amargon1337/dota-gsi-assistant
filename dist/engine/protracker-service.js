"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ProTrackerService = void 0;
const child_process_1 = require("child_process");
const util_1 = __importDefault(require("util"));
const execPromise = util_1.default.promisify(child_process_1.exec);
// Built-in verified Dota2ProTracker 7.41f meta builds
const D2PT_META_741F = {
    nevermore: {
        heroCleanName: 'nevermore',
        d2ptHeroName: 'Shadow Fiend',
        patch: '7.41f',
        role: 'Carry / Mid (Physical Core)',
        coreProgression: [
            { name: 'power_treads', cleanName: 'Power Treads', cost: 1400, expectedMinute: 6, rationale: 'Базовая скорость атаки и статы для фарма' },
            { name: 'dragon_lance', cleanName: 'Dragon Lance', cost: 1900, expectedMinute: 10, rationale: 'Дальность атаки и выживаемость на линии' },
            { name: 'yasha', cleanName: 'Yasha', cost: 2050, expectedMinute: 13, rationale: 'Увеличение мувспида и темпа фарма' },
            { name: 'black_king_bar', cleanName: 'Black King Bar', cost: 4050, expectedMinute: 17, rationale: 'Ключевой спайк силы: неуязвимость к магии в драках' },
            { name: 'manta', cleanName: 'Manta Style', cost: 2550, expectedMinute: 21, rationale: 'Снятие сайленса/дебаффов и сплитпуш' },
            { name: 'satanic', cleanName: 'Satanic', cost: 5050, expectedMinute: 26, rationale: 'Выживаемость в затяжных драках, сброс фокуса' },
            { name: 'butterfly', cleanName: 'Butterfly', cost: 5450, expectedMinute: 31, rationale: 'Уклонение, колоссальный DPS по зданиям и героям' },
            { name: 'swift_blink', cleanName: 'Swift Blink', cost: 6800, expectedMinute: 36, rationale: 'Мгновенное сокращение дистанции и прокаст' },
        ],
        situationalItems: [
            { name: 'silver_edge', cleanName: 'Silver Edge', cost: 5450, expectedMinute: 22, rationale: 'Отключение пассивок (Brilliance/Break против Bristleback/Spectre)' },
            { name: 'skadi', cleanName: 'Eye of Skadi', cost: 5300, expectedMinute: 28, rationale: 'Снижение хила и замедление против танков' },
            { name: 'nullifier', cleanName: 'Nullifier', cost: 4375, expectedMinute: 29, rationale: 'Снятие Ghost Scepter, Glimmer, Force Staff и Aeon Disk' },
        ],
    },
    juggernaut: {
        heroCleanName: 'juggernaut',
        d2ptHeroName: 'Juggernaut',
        patch: '7.41f',
        role: 'Carry (Safe Lane)',
        coreProgression: [
            { name: 'phase_boots', cleanName: 'Phase Boots', cost: 1500, expectedMinute: 6, rationale: 'Мобильность при Blade Fury' },
            { name: 'battlefury', cleanName: 'Battle Fury', cost: 4100, expectedMinute: 13, rationale: 'Ускорение фарма леса' },
            { name: 'manta', cleanName: 'Manta Style', cost: 4600, expectedMinute: 19, rationale: 'Снятие сайленса и сплитпуш' },
            { name: 'diffusal_blade', cleanName: 'Diffusal Blade', cost: 2500, expectedMinute: 17, rationale: 'Сжигание маны под Omnislash' },
            { name: 'aghanims_scepter', cleanName: 'Aghanim Scepter', cost: 4200, expectedMinute: 24, rationale: 'Swiftslash для быстрого убийства саппортов' },
            { name: 'basher', cleanName: 'Skull Basher', cost: 2875, expectedMinute: 27, rationale: 'Контроль сквозь BKB' },
            { name: 'abyssal_blade', cleanName: 'Abyssal Blade', cost: 3375, expectedMinute: 33, rationale: 'Мгновенный стан' },
        ],
        situationalItems: [
            { name: 'butterfly', cleanName: 'Butterfly', cost: 5450, expectedMinute: 28, rationale: 'Уклонение и скорость атаки' },
            { name: 'black_king_bar', cleanName: 'Black King Bar', cost: 4050, expectedMinute: 22, rationale: 'Защита от мгновенного контроля' },
        ],
    },
    pudge: {
        heroCleanName: 'pudge',
        d2ptHeroName: 'Pudge',
        patch: '7.41f',
        role: 'Core / Support',
        coreProgression: [
            { name: 'tranquil_boots', cleanName: 'Tranquil Boots', cost: 925, expectedMinute: 5, rationale: 'Реген здоровья' },
            { name: 'blink', cleanName: 'Blink Dagger', cost: 2250, expectedMinute: 12, rationale: 'Позиционирование и мгновенный Dismember' },
            { name: 'aghanims_scepter', cleanName: 'Aghanim Scepter', cost: 4200, expectedMinute: 18, rationale: 'Rot радиус и урон' },
            { name: 'black_king_bar', cleanName: 'Black King Bar', cost: 4050, expectedMinute: 24, rationale: 'Несбиваемый ульт' },
            { name: 'shivas_guard', cleanName: 'Shiva Guard', cost: 5175, expectedMinute: 30, rationale: 'Броня и снижение хила' },
        ],
        situationalItems: [
            { name: 'pipe', cleanName: 'Pipe of Insight', cost: 3375, expectedMinute: 20, rationale: 'Защита от магического прокаста' },
            { name: 'lotus_orb', cleanName: 'Lotus Orb', cost: 3850, expectedMinute: 25, rationale: 'Отражение таргетных заклинаний' },
        ],
    },
};
const HERO_CLEAN_MAP = {
    nevermore: 'Shadow Fiend',
    shadow_fiend: 'Shadow Fiend',
    juggernaut: 'Juggernaut',
    pudge: 'Pudge',
    antimage: 'Anti-Mage',
    axe: 'Axe',
    faceless_void: 'Faceless Void',
    phantom_assassin: 'Phantom Assassin',
    sniper: 'Sniper',
    slark: 'Slark',
    ursa: 'Ursa',
    morphling: 'Morphling',
    terrorblade: 'Terrorblade',
    lina: 'Lina',
    invoker: 'Invoker',
    tinker: 'Tinker',
    windrunner: 'Windranger',
};
class ProTrackerService {
    static cache = new Map();
    static normalizeHeroName(rawName) {
        const clean = rawName.replace('npc_dota_hero_', '').toLowerCase();
        return clean;
    }
    static getD2ptHeroName(cleanName) {
        return HERO_CLEAN_MAP[cleanName] || cleanName.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
    }
    static isItemPurchased(itemIdentifier, inventory) {
        const cleanId = itemIdentifier.toLowerCase().replace('item_', '');
        const aliases = {
            black_king_bar: ['bkb', 'black_king_bar'],
            bkb: ['bkb', 'black_king_bar'],
            power_treads: ['power_treads', 'pt', 'treads', 'phase_boots', 'travel_boots', 'boots_of_travel', 'tranquil_boots'],
            phase_boots: ['phase_boots', 'phase', 'power_treads', 'travel_boots', 'boots_of_travel'],
            manta: ['manta', 'manta_style'],
            dragon_lance: ['dragon_lance', 'hurricane_pike', 'lance'],
            hurricane_pike: ['hurricane_pike'],
            satanic: ['satanic'],
            butterfly: ['butterfly'],
            swift_blink: ['swift_blink'],
            arcane_blink: ['arcane_blink'],
            overwhelming_blink: ['overwhelming_blink'],
            blink: ['blink', 'blink_dagger', 'swift_blink', 'arcane_blink', 'overwhelming_blink'],
            silver_edge: ['silver_edge'],
            shadow_blade: ['shadow_blade', 'silver_edge'],
            skadi: ['skadi', 'eye_of_skadi'],
            daedalus: ['daedalus', 'greater_crit'],
            nullifier: ['nullifier'],
            yasha: ['yasha', 'manta', 'sange_and_yasha', 'yasha_and_kaya'],
            diffusal_blade: ['diffusal_blade', 'disperser'],
            battlefury: ['battlefury', 'bfury'],
            aghanims_scepter: ['aghanims_scepter', 'ultimate_scepter', 'scepter'],
            basher: ['basher', 'skull_basher', 'abyssal_blade'],
            abyssal_blade: ['abyssal_blade'],
        };
        const targetAliases = aliases[cleanId] || [cleanId];
        return inventory.some((invItem) => {
            const invClean = invItem.toLowerCase().replace('item_', '');
            return targetAliases.some((alias) => invClean.includes(alias));
        });
    }
    static getHeroBuild(cleanHeroName) {
        const norm = this.normalizeHeroName(cleanHeroName);
        if (D2PT_META_741F[norm]) {
            return D2PT_META_741F[norm];
        }
        // Generic high-tier competitive build fallback for patch 7.41f
        const d2ptName = this.getD2ptHeroName(norm);
        return {
            heroCleanName: norm,
            d2ptHeroName: d2ptName,
            patch: '7.41f',
            role: 'Core / Flex',
            coreProgression: [
                { name: 'power_treads', cleanName: 'Power Treads', cost: 1400, expectedMinute: 6, rationale: 'Базовые статы и скорость' },
                { name: 'yasha', cleanName: 'Yasha', cost: 2050, expectedMinute: 12, rationale: 'Скорость фарма и мобильность' },
                { name: 'black_king_bar', cleanName: 'Black King Bar', cost: 4050, expectedMinute: 18, rationale: 'Защита от магии в тимфайтах' },
                { name: 'manta', cleanName: 'Manta Style', cost: 2550, expectedMinute: 23, rationale: 'Сброс дебаффов и урон' },
                { name: 'satanic', cleanName: 'Satanic', cost: 5050, expectedMinute: 29, rationale: 'Живучесть и вампиризм' },
                { name: 'butterfly', cleanName: 'Butterfly', cost: 5450, expectedMinute: 34, rationale: 'Уклонение и высокий DPS' },
            ],
            situationalItems: [
                { name: 'blink', cleanName: 'Blink Dagger', cost: 2250, expectedMinute: 14, rationale: 'Внезапная инициация' },
                { name: 'nullifier', cleanName: 'Nullifier', cost: 4375, expectedMinute: 30, rationale: 'Снятие сейв-предметов' },
            ],
        };
    }
    static determineNextTargetItem(heroName, inventory, currentGold, gameClockSeconds) {
        const build = this.getHeroBuild(heroName);
        const minute = Math.max(0, Math.floor(gameClockSeconds / 60));
        const alreadyPurchased = [];
        let nextItem = null;
        // Check progression in order
        for (const item of build.coreProgression) {
            if (this.isItemPurchased(item.name, inventory)) {
                alreadyPurchased.push(item.cleanName);
            }
            else if (!nextItem) {
                nextItem = item;
            }
        }
        // If core progression is complete, look at situational / luxury
        if (!nextItem) {
            for (const item of build.situationalItems) {
                if (this.isItemPurchased(item.name, inventory)) {
                    alreadyPurchased.push(item.cleanName);
                }
                else if (!nextItem) {
                    nextItem = item;
                }
            }
        }
        // Fallback if full 6-slot
        if (!nextItem) {
            nextItem = {
                name: 'swift_blink',
                cleanName: 'Swift Blink / Moon Shard',
                cost: 6800,
                expectedMinute: 40,
                rationale: 'Ультралейт-апгрейд или съедение Moon Shard',
            };
        }
        const goldRemaining = Math.max(0, nextItem.cost - currentGold);
        let timingStatus = 'on_time';
        if (minute < nextItem.expectedMinute - 2)
            timingStatus = 'ahead';
        else if (minute > nextItem.expectedMinute + 3)
            timingStatus = 'delayed';
        return {
            targetItem: nextItem,
            alreadyPurchased,
            goldRemaining,
            timingStatus,
        };
    }
    static buildProTrackerContextPrompt(heroName, inventory, currentGold, gameClockSeconds) {
        const build = this.getHeroBuild(heroName);
        const nextAnalysis = this.determineNextTargetItem(heroName, inventory, currentGold, gameClockSeconds);
        const minute = Math.max(0, Math.floor(gameClockSeconds / 60));
        return `
[DOTA2PROTRACKER (D2PT) АНАЛИТИКА МЕТЫ — ПАТЧ 7.41f]
- Герой: ${build.d2ptHeroName} (${build.role})
- Текущий патч: 7.41f (актуальный про-ладдер)
- Игровое время: ${minute} мин
- УЖЕ КУПЛЕННЫЕ ПРЕДМЕТЫ В ИНВЕНТАРЕ: [${nextAnalysis.alreadyPurchased.join(', ') || 'нет ключевых'}]
  ⚠️ КРИТИЧЕСКОЕ ПРАВИЛО: Эти предметы УЖЕ КУПЛЕНЫ! НИКОГДА не выбирай их в targetItem!
- РЕКОМЕНДУЕМЫЙ СЛЕДУЮЩИЙ СЛОТ ПО МЕТЕ D2PT: ${nextAnalysis.targetItem.cleanName} (Стоимость: ${nextAnalysis.targetItem.cost}g, тайминг pro-сцены: ~${nextAnalysis.targetItem.expectedMinute} мин)
  Осталось нафармить: ${nextAnalysis.goldRemaining}g
  Обоснование D2PT: ${nextAnalysis.targetItem.rationale}
- Альтернативные метовые опции D2PT: ${build.situationalItems.map((i) => `${i.cleanName} (${i.rationale})`).join('; ')}
`.trim();
    }
}
exports.ProTrackerService = ProTrackerService;
