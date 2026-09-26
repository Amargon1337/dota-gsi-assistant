import fs from 'fs';
import path from 'path';

export interface BudgetStatus {
  allowed: boolean;
  reason?: string;
  rpmUsed: number;
  rpmLimit: number;
  rpdUsed: number;
  rpdLimit: number;
}

export class GeminiBudgetManager {
  private static instance: GeminiBudgetManager;
  private rpmLimit = 15;
  private rpdLimit = 500;
  private minuteTimestamps: number[] = [];
  private currentDay = '';
  private dailyCount = 0;
  private persistPath = path.join(__dirname, '../../data/gemini-budget.json');

  private constructor() {
    this.currentDay = this.getTodayKey();
    this.loadPersistedUsage();
  }

  public static getInstance(): GeminiBudgetManager {
    if (!GeminiBudgetManager.instance) {
      GeminiBudgetManager.instance = new GeminiBudgetManager();
    }
    return GeminiBudgetManager.instance;
  }

  private getTodayKey(): string {
    const d = new Date();
    return `${d.getUTCFullYear()}-${(d.getUTCMonth() + 1).toString().padStart(2, '0')}-${d.getUTCDate().toString().padStart(2, '0')}`;
  }

  private loadPersistedUsage(): void {
    try {
      if (fs.existsSync(this.persistPath)) {
        const raw = fs.readFileSync(this.persistPath, 'utf-8');
        const data = JSON.parse(raw);
        if (data.day === this.currentDay) {
          this.dailyCount = Number(data.dailyCount) || 0;
        } else {
          this.dailyCount = 0;
          this.persistUsage();
        }
      }
    } catch {
      this.dailyCount = 0;
    }
  }

  private persistUsage(): void {
    try {
      const dir = path.dirname(this.persistPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(
        this.persistPath,
        JSON.stringify({ day: this.currentDay, dailyCount: this.dailyCount }),
        'utf-8'
      );
    } catch (e) {
      console.error('[Gemini Budget] Ошибка сохранения файла бюджета:', e);
    }
  }

  public setLimits(rpm: number, rpd: number): void {
    if (rpm > 0) this.rpmLimit = rpm;
    if (rpd > 0) this.rpdLimit = rpd;
  }

  public checkBudget(): BudgetStatus {
    const now = Date.now();
    const today = this.getTodayKey();

    if (today !== this.currentDay) {
      this.currentDay = today;
      this.dailyCount = 0;
      this.persistUsage();
    }

    // Filter out requests older than 60s
    this.minuteTimestamps = this.minuteTimestamps.filter((t) => now - t < 60000);

    const rpmUsed = this.minuteTimestamps.length;
    const rpdUsed = this.dailyCount;

    if (rpmUsed >= this.rpmLimit) {
      return {
        allowed: false,
        reason: `Превышен лимит RPM (${rpmUsed}/${this.rpmLimit}). Повторите через несколько секунд.`,
        rpmUsed,
        rpmLimit: this.rpmLimit,
        rpdUsed,
        rpdLimit: this.rpdLimit,
      };
    }

    if (rpdUsed >= this.rpdLimit) {
      return {
        allowed: false,
        reason: `Превышена суточная квота RPD (${rpdUsed}/${this.rpdLimit} вызовов).`,
        rpmUsed,
        rpmLimit: this.rpmLimit,
        rpdUsed,
        rpdLimit: this.rpdLimit,
      };
    }

    return {
      allowed: true,
      rpmUsed,
      rpmLimit: this.rpmLimit,
      rpdUsed,
      rpdLimit: this.rpdLimit,
    };
  }

  public recordUsage(): void {
    const now = Date.now();
    this.minuteTimestamps.push(now);
    this.dailyCount++;
    this.persistUsage();
    console.log(`[Gemini Budget] Вызов учтен: RPM ${this.minuteTimestamps.length}/${this.rpmLimit}, RPD ${this.dailyCount}/${this.rpdLimit}`);
  }

  public getStatus(): BudgetStatus {
    return this.checkBudget();
  }
}
