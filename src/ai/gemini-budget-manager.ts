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

export interface ReservationResult {
  allowed: boolean;
  reservationId?: string;
  reason?: string;
}

interface ActiveReservation {
  id: string;
  timestamp: number;
  reason: string;
}

export class GeminiBudgetManager {
  private static instance: GeminiBudgetManager;
  private rpmLimit = 15;
  private rpdLimit = 500;
  private minuteTimestamps: number[] = [];
  private currentDay = '';
  private dailyCount = 0;
  private activeReservations: Map<string, ActiveReservation> = new Map();
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
      console.error('[BUDGET] Ошибка сохранения файла бюджета:', e);
    }
  }

  public setLimits(rpm: number, rpd: number): void {
    if (rpm > 0) this.rpmLimit = rpm;
    if (rpd > 0) this.rpdLimit = rpd;
  }

  /**
   * Atomic slot reservation.
   * Checks both RPM and RPD limits, reserves a slot atomically,
   * eliminating any check-then-act race conditions.
   */
  public reserveSlot(reason: string): ReservationResult {
    const now = Date.now();
    const today = this.getTodayKey();

    if (today !== this.currentDay) {
      this.currentDay = today;
      this.dailyCount = 0;
      this.persistUsage();
    }

    // Filter timestamps older than 60s
    this.minuteTimestamps = this.minuteTimestamps.filter((t) => now - t < 60000);

    const currentRpm = this.minuteTimestamps.length;
    if (currentRpm >= this.rpmLimit) {
      return {
        allowed: false,
        reason: `Превышен лимит запросов в минуту (${currentRpm}/${this.rpmLimit} RPM).`,
      };
    }

    if (this.dailyCount >= this.rpdLimit) {
      return {
        allowed: false,
        reason: `Превышена суточная квота запросов (${this.dailyCount}/${this.rpdLimit} RPD).`,
      };
    }

    const reservationId = `res_${now}_${Math.random().toString(36).substring(2, 7)}`;
    this.minuteTimestamps.push(now);
    this.dailyCount++;
    this.activeReservations.set(reservationId, { id: reservationId, timestamp: now, reason });
    this.persistUsage();

    console.log(`[BUDGET] Слот атомарно зарезервирован [${reservationId}] ("${reason}"). RPM: ${this.minuteTimestamps.length}/${this.rpmLimit}, RPD: ${this.dailyCount}/${this.rpdLimit}`);
    return {
      allowed: true,
      reservationId,
    };
  }

  /**
   * Accurately releases a specific reservation when a request fails or times out.
   * Removes the EXACT timestamp associated with this reservation, preventing
   * race condition corruption of RPM accounting during concurrent requests.
   */
  public releaseReservation(reservationId: string): void {
    const reservation = this.activeReservations.get(reservationId);
    if (!reservation) {
      return;
    }

    this.activeReservations.delete(reservationId);
    if (this.dailyCount > 0) this.dailyCount--;

    // Remove the exact timestamp associated with this reservation
    const idx = this.minuteTimestamps.indexOf(reservation.timestamp);
    if (idx !== -1) {
      this.minuteTimestamps.splice(idx, 1);
    }

    this.persistUsage();
    console.log(`[BUDGET] Слот [${reservationId}] освобожден из-за ошибки/отмены (timestamp: ${reservation.timestamp})`);
  }

  /**
   * Commits the reservation when a request succeeds.
   * Keeps the consumed quota in dailyCount and minuteTimestamps,
   * and removes the entry from activeReservations.
   */
  public commitReservation(reservationId: string): void {
    this.activeReservations.delete(reservationId);
  }

  public checkBudget(): BudgetStatus {
    const now = Date.now();
    const today = this.getTodayKey();

    if (today !== this.currentDay) {
      this.currentDay = today;
      this.dailyCount = 0;
      this.persistUsage();
    }

    this.minuteTimestamps = this.minuteTimestamps.filter((t) => now - t < 60000);
    const rpmUsed = this.minuteTimestamps.length;
    const rpdUsed = this.dailyCount;

    if (rpmUsed >= this.rpmLimit) {
      return {
        allowed: false,
        reason: `Превышен лимит RPM (${rpmUsed}/${this.rpmLimit})`,
        rpmUsed,
        rpmLimit: this.rpmLimit,
        rpdUsed,
        rpdLimit: this.rpdLimit,
      };
    }

    if (rpdUsed >= this.rpdLimit) {
      return {
        allowed: false,
        reason: `Превышен суточный лимит RPD (${rpdUsed}/${this.rpdLimit})`,
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

  public getStatus(): BudgetStatus {
    return this.checkBudget();
  }

  public reset(rpm: number = 15, rpd: number = 500): void {
    this.minuteTimestamps = [];
    this.dailyCount = 0;
    this.activeReservations.clear();
    this.rpmLimit = rpm;
    this.rpdLimit = rpd;
    this.persistUsage();
  }
}
