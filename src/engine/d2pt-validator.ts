import { D2PTHeroMeta } from './d2pt-store';

export const CURRENT_APPLICATION_PATCH = '7.41f';

export interface D2PTValidationResult {
  valid: boolean;
  isStale: boolean;
  errors: string[];
}

export class D2PTValidator {
  public static validateHeroMeta(meta: unknown): D2PTValidationResult {
    const errors: string[] = [];

    if (!meta || typeof meta !== 'object') {
      return { valid: false, isStale: true, errors: ['Файл меты пуст или не является JSON-объектом'] };
    }

    const m = meta as Record<string, unknown>;

    if (typeof m.hero !== 'string' || !m.hero.trim()) {
      errors.push('Поле "hero" должно быть непустой строкой');
    }

    if (typeof m.heroKey !== 'string' || !m.heroKey.trim()) {
      errors.push('Поле "heroKey" должно быть непустой строкой');
    }

    if (typeof m.patch !== 'string') {
      errors.push('Поле "patch" обязательно');
    }

    if (typeof m.sampleSize !== 'number' || m.sampleSize <= 0) {
      errors.push('Поле "sampleSize" должно быть положительным числом');
    }

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
          if (typeof it.cost !== 'number') errors.push(`coreBuild[${idx}].cost обязателен`);
          if (typeof it.expectedMinute !== 'number') errors.push(`coreBuild[${idx}].expectedMinute обязателен`);
        }
      });
    }

    const isPatchMatch = m.patch === CURRENT_APPLICATION_PATCH;
    const isStale = !isPatchMatch;

    return {
      valid: errors.length === 0,
      isStale,
      errors,
    };
  }
}
