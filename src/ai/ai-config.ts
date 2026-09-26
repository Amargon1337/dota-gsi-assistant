import fs from 'fs';
import path from 'path';

export interface AiConfig {
  geminiApiKey: string;
  geminiModel: string;
  autoCoachEnabled: boolean;
  layaUrl: string;
  rateLimitSeconds: number;
}

const CONFIG_PATH = path.resolve(__dirname, '../../ai-config.json');

const DEFAULT_CONFIG: AiConfig = {
  geminiApiKey: '',
  geminiModel: 'gemini-2.0-flash-lite',
  autoCoachEnabled: false,
  layaUrl: 'http://127.0.0.1:8000/v1/systemone',
  rateLimitSeconds: 30, // Safe throttle to easily stay under 500 RPD
};

export class ConfigManager {
  private static config: AiConfig = { ...DEFAULT_CONFIG };

  public static load(): AiConfig {
    try {
      if (fs.existsSync(CONFIG_PATH)) {
        const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
        const parsed = JSON.parse(raw);
        this.config = { ...DEFAULT_CONFIG, ...parsed };
      }
    } catch (err) {
      console.error('[Config] Ошибка чтения ai-config.json, используются настройки по умолчанию:', err);
    }
    return this.config;
  }

  public static get(): AiConfig {
    return this.config;
  }

  public static save(newConfig: Partial<AiConfig>): AiConfig {
    this.config = { ...this.config, ...newConfig };
    try {
      fs.writeFileSync(CONFIG_PATH, JSON.stringify(this.config, null, 2), 'utf8');
    } catch (err) {
      console.error('[Config] Не удалось сохранить ai-config.json:', err);
    }
    return this.config;
  }
}

// Initial load
ConfigManager.load();
