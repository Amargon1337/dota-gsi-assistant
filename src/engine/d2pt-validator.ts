export const CURRENT_APPLICATION_PATCH = '7.41f';
export const D2PT_MAX_FRESH_DAYS = 7;

export interface D2PTValidationResult {
  valid: boolean;
  isStale: boolean;
  ageDays: number;
  errors: string[];
}

export class D2PTValidator {
  public static validateHeroMeta(meta: unknown): D2PTValidationResult {
    const errors: string[] = [];

    if (!meta || typeof meta !== 'object') {
      return { valid: false, isStale: true, ageDays: 999, errors: ['Файл меты пуст или не является JSON-объектом'] };
    }

    const m = meta as Record<string, unknown>;

    // 1. Basic Identity
    if (typeof m.hero !== 'string' || !m.hero.trim()) {
      errors.push('Поле "hero" должно быть непустой строкой');
    }

    if (typeof m.heroKey !== 'string' || !m.heroKey.trim()) {
      errors.push('Поле "heroKey" должно быть непустой строкой');
    }

    if (m.source !== 'dota2protracker') {
      errors.push('Поле "source" должно быть строго "dota2protracker"');
    }

    if (typeof m.datasetVersion !== 'string' || !m.datasetVersion.trim()) {
      errors.push('Поле "datasetVersion" обязательно');
    }

    if (m.sourceUrl !== undefined && (typeof m.sourceUrl !== 'string' || !m.sourceUrl.startsWith('http'))) {
      errors.push('Поле "sourceUrl" должно быть валидным HTTP(S) URL');
    }

    if (m.extractionMethod !== undefined && typeof m.extractionMethod !== 'string') {
      errors.push('Поле "extractionMethod" должно быть строкой');
    }

    // 2. Provenance & Freshness (fetchedAt & age)
    let ageDays = 0;
    if (typeof m.fetchedAt !== 'string') {
      errors.push('Поле "fetchedAt" обязательно и должно быть строкой ISO 8601');
    } else {
      const fetchedTime = Date.parse(m.fetchedAt);
      if (isNaN(fetchedTime)) {
        errors.push('Поле "fetchedAt" содержит невалидный формат даты ISO 8601');
      } else if (fetchedTime > Date.now() + 86400000) {
        errors.push('Поле "fetchedAt" не может быть датой из будущего');
      } else {
        ageDays = Math.max(0, Math.floor((Date.now() - fetchedTime) / (1000 * 3600 * 24)));
      }
    }

    // 3. Patch & Statistical ranges
    if (typeof m.patch !== 'string') {
      errors.push('Поле "patch" обязательно');
    }

    if (typeof m.sampleSize !== 'number' || m.sampleSize < 100) {
      errors.push('Поле "sampleSize" должно быть числом >= 100');
    }

    if (typeof m.overallWinrate !== 'number' || m.overallWinrate < 30 || m.overallWinrate > 70) {
      errors.push('Поле "overallWinrate" должно быть реалистичным процентом побед (от 30% до 70%)');
    }

    // 4. Facets Validation
    if (Array.isArray(m.facets)) {
      m.facets.forEach((f, idx) => {
        if (!f || typeof f !== 'object') {
          errors.push(`facets[${idx}] некорректен`);
        } else {
          const facet = f as Record<string, unknown>;
          if (typeof facet.name !== 'string' || !facet.name) errors.push(`facets[${idx}].name обязателен`);
          if (typeof facet.winrate !== 'number' || facet.winrate < 0 || facet.winrate > 100) {
            errors.push(`facets[${idx}].winrate должен быть от 0 до 100`);
          }
          if (typeof facet.pickrate !== 'number' || facet.pickrate < 0 || facet.pickrate > 100) {
            errors.push(`facets[${idx}].pickrate должен быть от 0 до 100`);
          }
        }
      });
    }

    // 5. Core Build Validation
    if (!Array.isArray(m.coreBuild) || m.coreBuild.length === 0) {
      errors.push('Поле "coreBuild" должно быть непустым массивом предметов');
    } else {
      m.coreBuild.forEach((item, idx) => {
        if (!item || typeof item !== 'object') {
          errors.push(`coreBuild[${idx}] некорректен`);
        } else {
          const it = item as Record<string, unknown>;
          if (typeof it.name !== 'string' || !it.name) errors.push(`coreBuild[${idx}].name обязателен`);
          if (typeof it.cleanName !== 'string' || !it.cleanName) errors.push(`coreBuild[${idx}].cleanName обязателен`);
          if (typeof it.cost !== 'number' || it.cost <= 0) errors.push(`coreBuild[${idx}].cost должен быть > 0`);
          if (typeof it.expectedMinute !== 'number' || it.expectedMinute < 0) {
            errors.push(`coreBuild[${idx}].expectedMinute должен быть >= 0`);
          }
          if (it.winrate !== undefined && (typeof it.winrate !== 'number' || it.winrate < 0 || it.winrate > 100)) {
            errors.push(`coreBuild[${idx}].winrate должен быть от 0 до 100`);
          }
        }
      });
    }

    // Data is stale if patch differs from current app patch OR age exceeds rolling window (7 days)
    const isPatchMatch = m.patch === CURRENT_APPLICATION_PATCH;
    const isStale = !isPatchMatch || ageDays >= D2PT_MAX_FRESH_DAYS;

    return {
      valid: errors.length === 0,
      isStale,
      ageDays,
      errors,
    };
  }
}
