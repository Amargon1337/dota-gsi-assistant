import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

export interface AiConfig {
  geminiApiKey: string;
  geminiModel: string;
  autoCoachEnabled: boolean;
  layaUrl: string;
  rateLimitSeconds: number;
  rpmLimit: number;
  rpdLimit: number;
  gsiAuthToken: string;
  dashboardAuthToken: string;
}

export interface SanitizedPublicConfig {
  geminiConfigured: boolean;
  geminiModel: string;
  autoCoachEnabled: boolean;
  layaUrl: string;
  rateLimitSeconds: number;
  rpmLimit: number;
  rpdLimit: number;
  maskedKey: string;
}

const CONFIG_PATH = path.resolve(__dirname, '../../ai-config.json');

const DEFAULT_CONFIG: AiConfig = {
  geminiApiKey: process.env.GEMINI_API_KEY || '',
  geminiModel: process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite',
  autoCoachEnabled: false, // Deprecated: Gemini invocations are strictly manual-only
  layaUrl: process.env.LAYA_URL || 'http://127.0.0.1:8000/v1/systemone',
  rateLimitSeconds: Number(process.env.RATE_LIMIT_SECONDS) || 15,
  rpmLimit: Number(process.env.GEMINI_RPM_LIMIT) || 15,
  rpdLimit: Number(process.env.GEMINI_RPD_LIMIT) || 500,
  gsiAuthToken: process.env.GSI_AUTH_TOKEN || 'dota_assistant_token_77',
  dashboardAuthToken: process.env.DASHBOARD_AUTH_TOKEN || '',
};

export class ConfigManager {
  private static config: AiConfig = { ...DEFAULT_CONFIG };

  public static load(): AiConfig {
    try {
      if (fs.existsSync(CONFIG_PATH)) {
        const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
        const parsed = JSON.parse(raw);
        this.config = this.mergeAndValidate(DEFAULT_CONFIG, parsed);
      } else {
        this.config = { ...DEFAULT_CONFIG };
      }

      // Auto-generate random secure hex token if unconfigured or default
      if (
        !process.env.DASHBOARD_AUTH_TOKEN &&
        (!this.config.dashboardAuthToken || this.config.dashboardAuthToken === 'dashboard_secret_pass')
      ) {
        const randomSecret = crypto.randomBytes(16).toString('hex');
        this.config.dashboardAuthToken = randomSecret;
        this.save({ dashboardAuthToken: randomSecret });
        console.log(`🔑 [Security] Сгенерирован защищенный Dashboard Auth Token: ${randomSecret}`);
      }
    } catch (err) {
      console.error('[CONFIG] Ошибка чтения ai-config.json, используются настройки по умолчанию:', err);
      this.config = { ...DEFAULT_CONFIG };
    }
    return this.config;
  }

  public static get(): AiConfig {
    return this.config;
  }

  public static getPublicConfig(): SanitizedPublicConfig {
    const cfg = this.config;
    const masked = cfg.geminiApiKey
      ? `${cfg.geminiApiKey.substring(0, 6)}...${cfg.geminiApiKey.substring(cfg.geminiApiKey.length - 4)}`
      : '';

    return {
      geminiConfigured: Boolean(cfg.geminiApiKey),
      geminiModel: cfg.geminiModel,
      autoCoachEnabled: cfg.autoCoachEnabled,
      layaUrl: cfg.layaUrl,
      rateLimitSeconds: cfg.rateLimitSeconds,
      rpmLimit: cfg.rpmLimit,
      rpdLimit: cfg.rpdLimit,
      maskedKey: masked,
    };
  }

  public static save(updates: Partial<AiConfig>): AiConfig {
    const validated = this.validateUpdates(updates);
    this.config = { ...this.config, ...validated };

    try {
      fs.writeFileSync(CONFIG_PATH, JSON.stringify(this.config, null, 2), 'utf8');
      console.log('[CONFIG] ai-config.json успешно обновлен');
    } catch (err) {
      console.error('[CONFIG] Не удалось сохранить ai-config.json:', err);
    }
    return this.config;
  }

  private static mergeAndValidate(base: AiConfig, incoming: Record<string, unknown>): AiConfig {
    const result: AiConfig = { ...base };

    if (typeof incoming.geminiApiKey === 'string') result.geminiApiKey = incoming.geminiApiKey.trim();
    if (typeof incoming.geminiModel === 'string' && incoming.geminiModel.trim()) result.geminiModel = incoming.geminiModel.trim();
    if (typeof incoming.autoCoachEnabled === 'boolean') result.autoCoachEnabled = incoming.autoCoachEnabled;
    if (typeof incoming.layaUrl === 'string' && incoming.layaUrl.trim()) result.layaUrl = incoming.layaUrl.trim();
    if (typeof incoming.rateLimitSeconds === 'number' && incoming.rateLimitSeconds > 0) result.rateLimitSeconds = incoming.rateLimitSeconds;
    if (typeof incoming.rpmLimit === 'number' && incoming.rpmLimit > 0) result.rpmLimit = incoming.rpmLimit;
    if (typeof incoming.rpdLimit === 'number' && incoming.rpdLimit > 0) result.rpdLimit = incoming.rpdLimit;
    if (typeof incoming.gsiAuthToken === 'string' && incoming.gsiAuthToken.trim()) result.gsiAuthToken = incoming.gsiAuthToken.trim();
    if (typeof incoming.dashboardAuthToken === 'string' && incoming.dashboardAuthToken.trim()) result.dashboardAuthToken = incoming.dashboardAuthToken.trim();

    return result;
  }

  private static validateUpdates(incoming: Partial<AiConfig>): Partial<AiConfig> {
    const safe: Partial<AiConfig> = {};

    if (typeof incoming.geminiApiKey === 'string') {
      const trimmed = incoming.geminiApiKey.trim();
      if (!trimmed.includes('...')) {
        safe.geminiApiKey = trimmed;
      }
    }
    if (typeof incoming.geminiModel === 'string' && incoming.geminiModel.trim()) {
      safe.geminiModel = incoming.geminiModel.trim();
    }
    if (typeof incoming.autoCoachEnabled === 'boolean') {
      safe.autoCoachEnabled = incoming.autoCoachEnabled;
    }
    if (typeof incoming.layaUrl === 'string' && incoming.layaUrl.trim()) {
      safe.layaUrl = incoming.layaUrl.trim();
    }
    if (typeof incoming.rateLimitSeconds === 'number' && incoming.rateLimitSeconds > 0) {
      safe.rateLimitSeconds = incoming.rateLimitSeconds;
    }
    if (typeof incoming.rpmLimit === 'number' && incoming.rpmLimit > 0) {
      safe.rpmLimit = incoming.rpmLimit;
    }
    if (typeof incoming.rpdLimit === 'number' && incoming.rpdLimit > 0) {
      safe.rpdLimit = incoming.rpdLimit;
    }
    if (typeof incoming.gsiAuthToken === 'string' && incoming.gsiAuthToken.trim()) {
      safe.gsiAuthToken = incoming.gsiAuthToken.trim();
    }
    if (typeof incoming.dashboardAuthToken === 'string' && incoming.dashboardAuthToken.trim()) {
      safe.dashboardAuthToken = incoming.dashboardAuthToken.trim();
    }

    return safe;
  }
}

// Initial load
ConfigManager.load();
