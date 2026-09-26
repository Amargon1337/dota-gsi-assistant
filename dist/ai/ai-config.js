"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ConfigManager = void 0;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const CONFIG_PATH = path_1.default.resolve(__dirname, '../../ai-config.json');
const DEFAULT_CONFIG = {
    geminiApiKey: '',
    geminiModel: 'gemini-2.0-flash-lite',
    autoCoachEnabled: false,
    layaUrl: 'http://127.0.0.1:8000/v1/systemone',
    rateLimitSeconds: 30, // Safe throttle to easily stay under 500 RPD
};
class ConfigManager {
    static config = { ...DEFAULT_CONFIG };
    static load() {
        try {
            if (fs_1.default.existsSync(CONFIG_PATH)) {
                const raw = fs_1.default.readFileSync(CONFIG_PATH, 'utf8');
                const parsed = JSON.parse(raw);
                this.config = { ...DEFAULT_CONFIG, ...parsed };
            }
        }
        catch (err) {
            console.error('[Config] Ошибка чтения ai-config.json, используются настройки по умолчанию:', err);
        }
        return this.config;
    }
    static get() {
        return this.config;
    }
    static save(newConfig) {
        this.config = { ...this.config, ...newConfig };
        try {
            fs_1.default.writeFileSync(CONFIG_PATH, JSON.stringify(this.config, null, 2), 'utf8');
        }
        catch (err) {
            console.error('[Config] Не удалось сохранить ai-config.json:', err);
        }
        return this.config;
    }
}
exports.ConfigManager = ConfigManager;
// Initial load
ConfigManager.load();
