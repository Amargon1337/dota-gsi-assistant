import { EventEmitter } from 'events';
import {
  SharedWorldModel,
  SemanticGameEvent,
  ThreatEvaluation,
  StrategicPlan,
  TacticalActionState,
} from './world-model';

export class EventEngine extends EventEmitter {
  private lastPlayerZone = '';
  private lastHeroAlive = true;
  private lastTowersAlive = 11;
  private alertedMissingEnemies: Set<string> = new Set();
  private knownPlayerItems: Set<string> = new Set();
  private eventCooldowns: Map<string, number> = new Map();
  private lastRoshanStatus = 'alive';

  public evaluate(model: SharedWorldModel): void {
    const clock = model.meta.clockTime;
    const formatted = model.meta.formattedClock;
    const zoneInfo = model.player.zoneInfo;
    const currentZone = zoneInfo.name;

    // 1. Zone Change Detection with Deduplication & Cooldown
    if (this.lastPlayerZone && this.lastPlayerZone !== currentZone) {
      const isDangerousZone = zoneInfo.allegiance === 'enemy' || zoneInfo.baseRisk >= 0.60;
      const zoneEventKey = `zone_change_${currentZone}`;
      const lastZoneEmit = this.eventCooldowns.get(zoneEventKey) ?? -999;

      if (clock - lastZoneEmit >= 10 || isDangerousZone) {
        this.eventCooldowns.set(zoneEventKey, clock);
        this.pushEvent(model, {
          id: `zone_${clock}`,
          clockTime: clock,
          formattedTime: formatted,
          type: 'ZONE_CHANGE',
          severity: isDangerousZone ? 'warning' : 'info',
          description: `Смена позиции: перешел в зону «${currentZone}» (${
            zoneInfo.allegiance === 'enemy' ? 'Вражеская' : zoneInfo.allegiance === 'ally' ? 'Союзная' : 'Нейтральная'
          })`,
          identityKey: `zone_${currentZone}`,
        });
      }

      // Check if current active plan is violated by this zone
      if (model.strategy.activePlan && model.strategy.activePlan.status === 'active') {
        const plan = model.strategy.activePlan;
        const enteredForbidden =
          plan.avoidZones.some((z) => currentZone.toLowerCase().includes(z.toLowerCase())) ||
          (zoneInfo.allegiance === 'enemy' && plan.avoidZones.some((z) => z.toLowerCase().includes('враж')));

        if (enteredForbidden) {
          plan.status = 'violated';
          plan.violationReason = `Игрок вошел в опасную вражескую зону «${currentZone}».`;

          this.pushEvent(model, {
            id: `plan_violation_${clock}`,
            clockTime: clock,
            formattedTime: formatted,
            type: 'PLAN_VIOLATED',
            severity: 'critical',
            description: `⚠️ План «${plan.priority}» нарушен! Вы вошли в опасную зону ${currentZone}`,
          });

          this.emit('plan_violated', plan);
        }
      }
    }
    this.lastPlayerZone = currentZone;

    // 2. Hero Death Detection
    if (this.lastHeroAlive && !model.player.alive) {
      this.pushEvent(model, {
        id: `hero_death_${clock}`,
        clockTime: clock,
        formattedTime: formatted,
        type: 'HERO_DEATH',
        severity: 'critical',
        description: `☠️ Герой погиб! Таймер возрождения: ${model.player.respawnSeconds}с. Выкуп: ${
          model.player.buyback.canBuyback ? 'ГОТОВ' : 'НЕДОСТУПЕН'
        }`,
      });
      this.emit('hero_death', { clock, respawnSeconds: model.player.respawnSeconds });
    }
    this.lastHeroAlive = model.player.alive;

    // 3. Plan Objective Completed Check (e.g. Target Item Purchased)
    if (model.strategy.activePlan && model.strategy.activePlan.status === 'active') {
      const plan = model.strategy.activePlan;
      const targetClean = plan.targetItem.toLowerCase().replace(/[^a-z0-9]/g, '');
      const itemAcquired = model.player.inventory.some((i) =>
        targetClean.includes(i.toLowerCase()) || i.toLowerCase().includes(targetClean)
      );

      if (itemAcquired) {
        plan.status = 'completed';
        this.pushEvent(model, {
          id: `plan_done_${clock}`,
          clockTime: clock,
          formattedTime: formatted,
          type: 'PLAN_COMPLETED',
          severity: 'info',
          description: `🎯 Цель достигнута! Собран ключевой артефакт: ${plan.targetItem}`,
        });
        this.emit('plan_completed', plan);
      }
    }

    // 4. Tower Destruction Detection
    if (this.lastTowersAlive > model.mapControl.alliedTowersAlive) {
      const diff = this.lastTowersAlive - model.mapControl.alliedTowersAlive;
      this.pushEvent(model, {
        id: `tower_down_${clock}`,
        clockTime: clock,
        formattedTime: formatted,
        type: 'TOWER_DESTROYED',
        severity: 'warning',
        description: `Потеряно союзных вышек: ${diff}. Контроль карты смещен к базе.`,
      });
      this.emit('tower_destroyed', { diff, remaining: model.mapControl.alliedTowersAlive });
    }
    this.lastTowersAlive = model.mapControl.alliedTowersAlive;

    // 5. New Item Power Spike
    for (const item of model.player.inventory) {
      if (!this.knownPlayerItems.has(item)) {
        this.knownPlayerItems.add(item);
        if (this.isPowerSpikeItem(item)) {
          this.pushEvent(model, {
            id: `spike_${item}_${clock}`,
            clockTime: clock,
            formattedTime: formatted,
            type: 'POWER_SPIKE',
            severity: 'info',
            description: `⚡ Пауэр-спайк! Получен артефакт: ${item.toUpperCase()}`,
          });
          this.emit('power_spike', { item });
        }
      }
    }

    // 6. Roshan Status Alert
    if (this.lastRoshanStatus !== model.mapControl.roshanStatus) {
      if (model.mapControl.roshanStatus === 'dead') {
        this.pushEvent(model, {
          id: `roshan_killed_${clock}`,
          clockTime: clock,
          formattedTime: formatted,
          type: 'ROSHAN_ALERT',
          severity: 'warning',
          description: '🐉 Рошан повержен! Аегис активен, таймер респавна запущен.',
        });
      }
      this.lastRoshanStatus = model.mapControl.roshanStatus;
    }

    // 7. Missing Enemy Detection
    for (const enemyKey of Object.keys(model.enemies)) {
      const enemy = model.enemies[enemyKey];
      if (enemy.missingDurationSeconds >= 20 && !this.alertedMissingEnemies.has(enemy.name)) {
        this.alertedMissingEnemies.add(enemy.name);
        this.pushEvent(model, {
          id: `missing_${enemy.name}_${clock}`,
          clockTime: clock,
          formattedTime: formatted,
          type: 'ENEMY_MISSING',
          severity: enemy.hasBlink ? 'critical' : 'warning',
          description: `⚠️ ${enemy.heroNameClean} не виден на карте уже ${enemy.missingDurationSeconds} сек! ${
            enemy.hasBlink ? '(замечен Blink Dagger!)' : ''
          }`,
        });
      } else if (enemy.missingDurationSeconds === 0 && this.alertedMissingEnemies.has(enemy.name)) {
        this.alertedMissingEnemies.delete(enemy.name);
        this.pushEvent(model, {
          id: `visible_${enemy.name}_${clock}`,
          clockTime: clock,
          formattedTime: formatted,
          type: 'ENEMY_VISIBLE',
          severity: 'info',
          description: `👁️ ${enemy.heroNameClean} снова виден в зоне ${enemy.lastKnownLocation.zoneName}`,
        });
      }
    }

    // 8. Synthesize Threats & Tactical Action State
    this.synthesizeThreats(model);
  }

  private synthesizeThreats(model: SharedWorldModel): void {
    const threats: ThreatEvaluation[] = [];
    const clock = model.meta.clockTime;
    const zoneInfo = model.player.zoneInfo;
    const isNight = !model.meta.isDaytime;
    const p = model.player;

    const missingDangerousEnemies: string[] = [];
    let threatScore = 0;
    const evidenceList: string[] = [];

    // Evaluate Missing Enemies
    for (const enemyKey of Object.keys(model.enemies)) {
      const enemy = model.enemies[enemyKey];
      if (enemy.missingDurationSeconds >= 15 && enemy.alive) {
        missingDangerousEnemies.push(enemy.heroNameClean);
        threatScore += enemy.hasBlink ? 30 : 18;
        evidenceList.push(
          `${enemy.heroNameClean} отсутствует ${enemy.missingDurationSeconds} сек ${
            enemy.hasBlink ? '(Blink Dagger)' : ''
          }`
        );
      }
    }

    // Zone Risk Evaluation using structured MapZoneInfo
    if (zoneInfo.allegiance === 'enemy') {
      threatScore += 35;
      evidenceList.push(`Вражеская территория («${zoneInfo.name}», базовый риск ${(zoneInfo.baseRisk * 100).toFixed(0)}%)`);
    } else if (zoneInfo.kind === 'river' || zoneInfo.kind === 'roshan') {
      threatScore += 25;
      evidenceList.push(`Открытая позиция на реке («${zoneInfo.name}»)`);
    }

    // Daylight factor
    if (isNight) {
      threatScore += 15;
      evidenceList.push('Ночное время (обзор 800 - высокий риск внезапной атаки)');
    }

    // Hero Vitals and Cooldowns
    if (p.hpPercent < 45) {
      threatScore += 25;
      evidenceList.push(`Критический уровень здоровья (${p.hpPercent}%)`);
    }

    if (p.keyCooldowns.bkb.owned && !p.keyCooldowns.bkb.ready) {
      threatScore += 15;
      evidenceList.push(`BKB на перезарядке (${p.keyCooldowns.bkb.cooldown}с)`);
    }

    if (p.statusEffects.silenced || p.statusEffects.stunned) {
      threatScore += 40;
      evidenceList.push('Под действием сайленса / стана!');
    }

    // Normalizing calibrated risk score to [0.0, 1.0]
    const riskScore = Math.min(0.99, Math.round((threatScore / 100) * 100) / 100);

    // Formulate Action State: NOW, WHY, UNTIL
    let nowAction: 'RETREAT' | 'FARM_SAFE' | 'PUSH_LANE' | 'TEAMFIGHT' | 'ROSHAN' = 'FARM_SAFE';
    let untilCondition = 'До получения ключевого артефакта';

    if (riskScore >= 0.70 || (zoneInfo.allegiance === 'enemy' && isNight)) {
      nowAction = 'RETREAT';
      untilCondition = 'До достижения союзного леса или тир-вышеки';
      threats.push({
        id: `threat_critical_${clock}`,
        level: 'critical',
        title: `Опасность перехвата (${missingDangerousEnemies.join(', ') || 'Вражеская зона'})`,
        riskScore,
        recommendedAction: 'Немедленно отступите в безопасный союзный лес под вышки',
        evidence: evidenceList,
        timestampClock: clock,
      });
    } else if (riskScore >= 0.40) {
      nowAction = 'FARM_SAFE';
      untilCondition = 'Пока враги не покажутся на линиях';
      threats.push({
        id: `threat_high_${clock}`,
        level: 'high',
        title: 'Повышенный тактический риск позиции',
        riskScore,
        recommendedAction: 'Держитесь ближе к союзным вышкам и не углубляйтесь вслепую',
        evidence: evidenceList,
        timestampClock: clock,
      });
    } else {
      nowAction = p.keyCooldowns.ultimate.ready && p.hpPercent > 80 ? 'TEAMFIGHT' : 'FARM_SAFE';
      untilCondition = 'До следующего спайка силы или ротации команды';
    }

    model.threats = threats;
    model.tacticalActionState = {
      now: nowAction,
      why: evidenceList.slice(0, 5),
      until: untilCondition,
      riskScore,
    };
  }

  private isPowerSpikeItem(itemName: string): boolean {
    const spikes = [
      'blink',
      'black_king_bar',
      'orchid',
      'manta',
      'battlefury',
      'radiance',
      'desolator',
      'scythe',
      'butterfly',
      'satanic',
      'abyssal_blade',
      'harpoon',
    ];
    return spikes.some((s) => itemName.toLowerCase().includes(s));
  }

  private pushEvent(model: SharedWorldModel, event: SemanticGameEvent): void {
    model.recentEvents.unshift(event);
    if (model.recentEvents.length > 30) {
      model.recentEvents.pop();
    }
    this.emit('event', event);
  }
}
