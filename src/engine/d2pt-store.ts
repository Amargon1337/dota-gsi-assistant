import fs from 'fs';
import path from 'path';
import { ItemIdentity } from './item-identity';
import { D2PTValidator } from './d2pt-validator';

export interface D2PTFacet {
  name: string;
  winrate: number;
  pickrate: number;
  description: string;
}

export interface D2PTItemTiming {
  name: string;
  cleanName: string;
  cost: number;
  expectedMinute: number;
  winrate?: number;
  rationale: string;
}

export interface D2PTNeutralTier {
  tier: number;
  recommended: string[];
}

export interface D2PTHeroMeta {
  hero: string;
  heroKey: string;
  source: string;
  sourceUrl?: string;
  fetchedAt: string;
  dataAgeDays?: number;
  extractionMethod?: string;
  confidenceNotes?: string;
  datasetVersion: string;
  dotaId?: number;
  patch: string;
  sampleSize: number;
  overallWinrate: number;
  roles: string[];
  facets: D2PTFacet[];
  startingItems: string[];
  coreBuild: D2PTItemTiming[];
  situationalItems: D2PTItemTiming[];
  neutralItems?: D2PTNeutralTier[];
  isStale?: boolean;
}

export class D2PTDataStore {
  private static metaCache: Map<string, D2PTHeroMeta> = new Map();
  private static dataLoaded = false;
  private static dataDir = path.join(__dirname, '../../data/d2pt');

  public static loadAllMetaFiles(): void {
    if (this.dataLoaded) return;

    try {
      if (!fs.existsSync(this.dataDir)) {
        fs.mkdirSync(this.dataDir, { recursive: true });
      }

      const files = fs.readdirSync(this.dataDir);
      for (const file of files) {
        if (file.endsWith('.json')) {
          const filePath = path.join(this.dataDir, file);
          try {
            const raw = fs.readFileSync(filePath, 'utf-8');
            const parsed = JSON.parse(raw);
            const validation = D2PTValidator.validateHeroMeta(parsed);

            if (validation.valid) {
              const meta = parsed as D2PTHeroMeta;
              meta.isStale = validation.isStale;
              meta.dataAgeDays = validation.ageDays;
              const key = this.normalizeHeroName(meta.heroKey);
              this.metaCache.set(key, meta);
            } else {
              console.warn(`[D2PT] Файл ${file} не прошел валидацию схемы:`, validation.errors);
            }
          } catch (e) {
            console.error(`[D2PT] Ошибка загрузки файла ${file}:`, e);
          }
        }
      }
      this.dataLoaded = true;
      console.log(`[D2PT] Загружено валидированных снапшотов героев из data/d2pt: ${this.metaCache.size}`);
    } catch (err) {
      console.error('[D2PT] Ошибка инициализации хранилища:', err);
    }
  }

  public static normalizeHeroName(rawName: string): string {
    const clean = rawName
      .toLowerCase()
      .replace(/^npc_dota_hero_/, '')
      .replace(/[^a-z0-9_]/g, '')
      .trim();

    const aliases: Record<string, string> = {
      sf: 'nevermore',
      shadow_fiend: 'nevermore',
      shadowfiend: 'nevermore',
      am: 'antimage',
      anti_mage: 'antimage',
      pa: 'phantom_assassin',
      phantomassassin: 'phantom_assassin',
      fv: 'faceless_void',
      facelessvoid: 'faceless_void',
      jug: 'juggernaut',
      jugg: 'juggernaut',
      pl: 'phantom_lancer',
      sk: 'sand_king',
      od: 'obsidian_destroyer',
      es: 'earthshaker',
      tb: 'terrorblade',
      qop: 'queenofpain',
      wr: 'windrunner',
    };

    return aliases[clean] || clean;
  }

  /**
   * Returns factual D2PT meta snapshot or null if unavailable.
   * NEVER fabricates synthetic data.
   */
  public static getHeroMeta(heroName: string): D2PTHeroMeta | null {
    this.loadAllMetaFiles();
    const key = this.normalizeHeroName(heroName);
    return this.metaCache.get(key) || null;
  }

  public static isItemPurchased(itemIdentifier: string, inventory: string[]): boolean {
    return ItemIdentity.isExactItemPurchased(itemIdentifier, inventory);
  }

  public static determineNextTargetItem(
    heroName: string,
    inventory: string[],
    currentGold: number,
    gameClockSeconds: number
  ): {
    targetItem: D2PTItemTiming | null;
    alreadyPurchased: string[];
    goldRemaining: number;
    timingStatus: 'ahead' | 'on_time' | 'delayed' | null;
    d2ptAvailable: boolean;
    recommendationSource: 'd2pt_fresh' | 'd2pt_stale' | 'd2pt_outdated_patch' | 'none';
  } {
    const meta = this.getHeroMeta(heroName);
    const minute = Math.max(0, Math.floor(gameClockSeconds / 60));

    if (!meta) {
      // Honest fallback when hero is not in D2PT snapshot
      return {
        targetItem: null,
        alreadyPurchased: [],
        goldRemaining: 0,
        timingStatus: null,
        d2ptAvailable: false,
        recommendationSource: 'none',
      };
    }

    const alreadyPurchased: string[] = [];
    let nextItem: D2PTItemTiming | null = null;

    // Check core build order using strict ItemIdentity
    for (const item of meta.coreBuild) {
      if (ItemIdentity.isExactItemPurchased(item.name, inventory)) {
        alreadyPurchased.push(item.cleanName);
      } else if (!nextItem) {
        nextItem = item;
      }
    }

    // Check situational if core is complete
    if (!nextItem) {
      for (const item of meta.situationalItems) {
        if (ItemIdentity.isExactItemPurchased(item.name, inventory)) {
          alreadyPurchased.push(item.cleanName);
        } else if (!nextItem) {
          nextItem = item;
        }
      }
    }

    if (!nextItem) {
      return {
        targetItem: null,
        alreadyPurchased,
        goldRemaining: 0,
        timingStatus: null,
        d2ptAvailable: true,
        recommendationSource: meta.isStale ? 'd2pt_stale' : 'd2pt_fresh',
      };
    }

    const goldRemaining = Math.max(0, nextItem.cost - currentGold);
    let timingStatus: 'ahead' | 'on_time' | 'delayed' = 'on_time';
    if (minute < nextItem.expectedMinute - 2) timingStatus = 'ahead';
    else if (minute > nextItem.expectedMinute + 3) timingStatus = 'delayed';

    const recSource: 'd2pt_fresh' | 'd2pt_stale' | 'd2pt_outdated_patch' | 'none' =
      meta.isStale ? 'd2pt_stale' : 'd2pt_fresh';

    return {
      targetItem: nextItem,
      alreadyPurchased,
      goldRemaining,
      timingStatus,
      d2ptAvailable: true,
      recommendationSource: recSource,
    };
  }

  public static buildD2PTContextPrompt(
    heroName: string,
    inventory: string[],
    currentGold: number,
    gameClockSeconds: number
  ): string {
    const meta = this.getHeroMeta(heroName);
    const nextAnalysis = this.determineNextTargetItem(heroName, inventory, currentGold, gameClockSeconds);
    const minute = Math.max(0, Math.floor(gameClockSeconds / 60));

    if (!meta) {
      return `
[DOTA2PROTRACKER (D2PT) СТАТУС]:
- Для героя "${heroName}" проверенный снапшот D2PT в локальной базе отсутствует (D2PT Unavailable).
- Тренеру следует опираться на актуальную соревновательную мету патча 7.41f и текущий инвентарь игрока.
- УЖЕ СОБРАНО: [${inventory.join(', ') || 'нет'}] (НИКОГДА не предлагай то, что уже куплено!)
`.trim();
    }

    const facetsStr = meta.facets
      ? meta.facets.map((f) => `${f.name} (WR: ${f.winrate}%, Pick: ${f.pickrate}%) - ${f.description}`).join('; ')
      : 'Не указаны';
    const situationalStr = meta.situationalItems
      ? meta.situationalItems.map((i) => `${i.cleanName} (~${i.expectedMinute} мин: ${i.rationale})`).join('; ')
      : 'Стандартные';

    const targetItemStr = nextAnalysis.targetItem
      ? `  * Артефакт: ${nextAnalysis.targetItem.cleanName}\n  * Стоимость: ${nextAnalysis.targetItem.cost}g (осталось добрать: ${nextAnalysis.goldRemaining}g)\n  * Эталонный тайминг Pro-сцены: ~${nextAnalysis.targetItem.expectedMinute} мин (Статус темпа: ${nextAnalysis.timingStatus?.toUpperCase() || 'ON_TIME'})\n  * Обоснование D2PT: ${nextAnalysis.targetItem.rationale}`
      : '  * Все основные и ситуативные артефакты из снапшота уже собраны. Выбирайте ситуативный лейт-артефакт.';

    return `
[DOTA2PROTRACKER (D2PT) СНАПШОТ — ПАТЧ ${meta.patch}]
- Источник: ${meta.source} ${meta.sourceUrl ? `(${meta.sourceUrl})` : ''}
- Снапшот от: ${meta.fetchedAt} (возраст данных: ${meta.dataAgeDays ?? 0} дн, метод: ${meta.extractionMethod || 'static_snapshot'})
- Герой: ${meta.hero} (${meta.roles.join(', ')}), Статус снапшота: ${meta.isStale ? '⚠️ УСТАРЕЛ' : 'АКТУАЛЕН (7.41f)'}
- Выборка D2PT: ${meta.sampleSize} матчей Immortal/Pro, средний Winrate: ${meta.overallWinrate}%
${meta.confidenceNotes ? `- Примечания выборки: ${meta.confidenceNotes}\n` : ''}- Аспекты (Facets): ${facetsStr}
- Текущая минута: ${minute} мин
- УЖЕ СОБРАННЫЕ АРТЕФАКТЫ: [${nextAnalysis.alreadyPurchased.join(', ') || 'нет ключевых'}]
  ⚠️ ЖЕСТКОЕ ПРАВИЛО: Эти слоты УЖЕ куплены. Никогда не выбирай их в targetItem!
- РЕКОМЕНДУЕМЫЙ СЛЕДУЮЩИЙ СЛОТ ПО СТАТИСТИКЕ D2PT:
${targetItemStr}
- Ситуативные метовые альтернативы D2PT: ${situationalStr}
`.trim();
  }
}
