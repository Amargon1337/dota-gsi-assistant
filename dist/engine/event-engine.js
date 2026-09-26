"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.EventEngine = void 0;
const events_1 = require("events");
class EventEngine extends events_1.EventEmitter {
    lastPlayerZone = '';
    lastTowersAlive = 11;
    alertedMissingEnemies = new Set();
    knownPlayerItems = new Set();
    evaluate(model) {
        const clock = model.meta.clockTime;
        const formatted = model.meta.formattedClock;
        // 1. Zone Change Detection
        const currentZone = model.player.currentZone;
        if (this.lastPlayerZone && this.lastPlayerZone !== currentZone) {
            this.pushEvent(model, {
                id: `zone_${clock}`,
                clockTime: clock,
                formattedTime: formatted,
                type: 'ZONE_CHANGE',
                severity: currentZone.includes('Enemy') || currentZone.includes('River') ? 'warning' : 'info',
                description: `Смена позиции: перешел в зону «${currentZone}»`,
            });
            // Check if current active plan is violated by this zone
            if (model.strategy.activePlan && model.strategy.activePlan.status === 'active') {
                const plan = model.strategy.activePlan;
                const enteredForbidden = plan.avoidZones.some((z) => currentZone.toLowerCase().includes(z.toLowerCase()));
                if (enteredForbidden) {
                    plan.status = 'violated';
                    plan.violationReason = `Игрок зашел в опасную зону «${currentZone}», нарушив текущий план.`;
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
        // 2. Tower Destruction Detection
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
        }
        this.lastTowersAlive = model.mapControl.alliedTowersAlive;
        // 3. New Item Power Spike
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
                }
            }
        }
        // 4. Missing Enemy Detection
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
                    description: `⚠️ ${enemy.heroNameClean} не виден на карте уже ${enemy.missingDurationSeconds} сек! ${enemy.hasBlink ? '(Есть Blink Dagger!)' : ''}`,
                });
            }
            else if (enemy.missingDurationSeconds === 0 && this.alertedMissingEnemies.has(enemy.name)) {
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
        // 5. Threat Synthesis with Calibrated Confidence & Evidence
        this.synthesizeThreats(model);
    }
    synthesizeThreats(model) {
        const threats = [];
        const clock = model.meta.clockTime;
        const currentZone = model.player.currentZone;
        const isNight = !model.meta.isDaytime;
        // Evaluate Gank Threat
        const missingDangerousEnemies = [];
        let threatScore = 0;
        const evidenceList = [];
        for (const enemyKey of Object.keys(model.enemies)) {
            const enemy = model.enemies[enemyKey];
            if (enemy.missingDurationSeconds >= 15) {
                missingDangerousEnemies.push(enemy.heroNameClean);
                threatScore += enemy.hasBlink ? 35 : 20;
                evidenceList.push(`${enemy.heroNameClean} отсутствует ${enemy.missingDurationSeconds} сек ${enemy.hasBlink ? '(замечен Blink Dagger)' : ''}`);
            }
        }
        if (currentZone.includes('Enemy') || currentZone.includes('River')) {
            threatScore += 30;
            evidenceList.push(`Вы находитесь в опасной зоне («${currentZone}»)`);
        }
        if (isNight) {
            threatScore += 15;
            evidenceList.push('Ночное время суток (снижен радиус дневного обзора)');
        }
        if (model.player.hpPercent < 50) {
            threatScore += 15;
            evidenceList.push(`Низкий запас здоровья (${model.player.hpPercent}%)`);
        }
        if (missingDangerousEnemies.length > 0 && threatScore >= 40) {
            const confidence = Math.min(0.96, Math.round((threatScore / 100) * 100) / 100);
            threats.push({
                id: `gank_threat_${clock}`,
                level: confidence > 0.75 ? 'critical' : 'high',
                title: `Опасность внезапного нападения (${missingDangerousEnemies.join(', ')})`,
                confidence,
                evidence: evidenceList,
                recommendedAction: 'Немедленно отойдите в безопасную часть леса под союзные вышки',
                timestampClock: clock,
            });
        }
        else if (threatScore >= 30) {
            // Situational zone / state threat (works in live matchmaking & bot lobbies)
            const confidence = Math.min(0.92, Math.round((threatScore / 80) * 100) / 100);
            let action = 'Отойдите ближе к союзной вышке или союзникам';
            let title = 'Повышенный тактический риск позиции';
            let level = 'medium';
            if (model.player.hpPercent < 45 && (currentZone.includes('River') || currentZone.includes('Enemy') || currentZone.includes('Lane'))) {
                level = 'critical';
                title = 'Критический риск: открытая зона с низким HP';
                action = 'Используйте фласку/стик или немедленно отойдите под вышку!';
            }
            else if (isNight && (currentZone.includes('River') || currentZone.includes('Enemy'))) {
                level = 'high';
                title = 'Опасность перехвата: вражеская территория ночью';
                action = 'Сместитесь в свой треугольник или основной лес под варды';
            }
            else if (threatScore >= 45) {
                level = 'high';
                title = 'Высокий риск внезапного нападения в текущей зоне';
                action = 'Сместитесь на безопасную линию фарма';
            }
            threats.push({
                id: `position_threat_${clock}`,
                level,
                title,
                confidence,
                evidence: evidenceList,
                recommendedAction: action,
                timestampClock: clock,
            });
        }
        model.threats = threats;
    }
    isPowerSpikeItem(itemName) {
        const spikes = ['blink', 'black_king_bar', 'orchid', 'manta', 'battlefury', 'radiance', 'desolator', 'scythe'];
        return spikes.some((s) => itemName.toLowerCase().includes(s));
    }
    pushEvent(model, event) {
        model.recentEvents.unshift(event);
        if (model.recentEvents.length > 30) {
            model.recentEvents.pop();
        }
        this.emit('event', event);
    }
}
exports.EventEngine = EventEngine;
