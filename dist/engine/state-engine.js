"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.StateEngine = void 0;
exports.determineMapZone = determineMapZone;
exports.parseTowerCounts = parseTowerCounts;
const world_model_1 = require("./world-model");
function determineMapZone(x, y, team = 'radiant') {
    // Approximate Dota 2 map zones based on source 2 coordinates [-8000, +8000]
    if (x < -5000 && y < -5000)
        return 'Radiant Base';
    if (x > 5000 && y > 5000)
        return 'Dire Base';
    // River runs roughly from top-left to bottom-right
    const riverDist = Math.abs(x + y);
    if (riverDist < 1200 && Math.abs(x) < 4000) {
        if (x < -1500 && y < 1500)
            return 'Roshan Pit Area (River)';
        return 'River';
    }
    // Triangles
    if (x < -1000 && x > -4500 && y < 0 && y > -4500)
        return 'Radiant Triangle';
    if (x > 1000 && x < 4500 && y > 0 && y < 4500)
        return 'Dire Triangle';
    // Jungles
    if (x > 0 && x < 5000 && y < 0 && y > -6000)
        return 'Radiant Main Jungle';
    if (x < 0 && x > -5000 && y > 0 && y < 6000)
        return 'Dire Main Jungle';
    // Lanes
    if (Math.abs(x - y) < 1500)
        return 'Mid Lane';
    if (y > 4500)
        return 'Top Lane';
    if (y < -4500)
        return 'Bottom Lane';
    return 'Neutral Map Area';
}
function calculateExpectedNetworth(clockSeconds) {
    if (clockSeconds <= 0)
        return 600;
    const mins = clockSeconds / 60;
    // Dynamic benchmark curve for competitive core
    if (mins < 10) {
        return Math.round(600 + mins * 400); // 400 GPM early
    }
    else if (mins < 20) {
        return Math.round(4600 + (mins - 10) * 650); // 650 GPM midgame spike
    }
    else {
        return Math.round(11100 + (mins - 20) * 850); // 850 GPM lategame farming
    }
}
function parseTowerCounts(buildings, isRadiantPlayer) {
    let radiant = 0;
    let dire = 0;
    let foundAnyTower = false;
    if (!buildings || typeof buildings !== 'object') {
        return { alliedTowers: 11, enemyTowers: 11, hasTowerData: false };
    }
    function scan(node, currentTeam) {
        if (!node || typeof node !== 'object')
            return;
        for (const [key, val] of Object.entries(node)) {
            const lower = key.toLowerCase();
            let team = currentTeam;
            if (lower === 'radiant' || lower.includes('goodguys'))
                team = 'radiant';
            if (lower === 'dire' || lower.includes('badguys'))
                team = 'dire';
            if (lower.includes('tower') && typeof val === 'object' && val !== null) {
                foundAnyTower = true;
                const b = val;
                const isAlive = b.health === undefined || b.health > 0;
                if (isAlive) {
                    if (team === 'dire') {
                        dire++;
                    }
                    else {
                        radiant++;
                    }
                }
            }
            else if (typeof val === 'object' && val !== null) {
                scan(val, team);
            }
        }
    }
    scan(buildings);
    if (!foundAnyTower) {
        return { alliedTowers: 11, enemyTowers: 11, hasTowerData: false };
    }
    return {
        alliedTowers: isRadiantPlayer ? radiant : dire,
        enemyTowers: isRadiantPlayer ? dire : radiant,
        hasTowerData: true,
    };
}
class StateEngine {
    history = [];
    lastSampleClockTime = -999;
    worldModelStore = world_model_1.WorldModelStore.getInstance();
    process(raw, processed) {
        const clock = raw.map?.clock_time ?? 0;
        const player = raw.player || {};
        const hero = raw.hero || {};
        const map = raw.map || {};
        const model = this.worldModelStore.getModel();
        // 1. Update Meta
        model.meta.matchId = map.matchid || model.meta.matchId;
        model.meta.serverTime = Date.now();
        model.meta.clockTime = clock;
        model.meta.formattedClock = processed.calculated.formattedClock;
        model.meta.gamePhase = map.game_state || 'INIT';
        model.meta.isDaytime = map.daytime ?? true;
        model.meta.dayNightCountdown = processed.calculated.nextDayNightSeconds;
        // 2. Update Player
        const x = hero.xpos ?? 0;
        const y = hero.ypos ?? 0;
        const currentZone = determineMapZone(x, y, player.team_name || 'radiant');
        // Calculate true Net Worth in Dota 2:
        // Valve's buyback formula: buyback_cost = 200 + Math.floor(networth / 13) => networth = (buyback_cost - 200) * 13
        const bbCost = hero.buyback_cost ?? 0;
        let trueNetworth = 0;
        if (bbCost >= 200) {
            trueNetworth = (bbCost - 200) * 13;
        }
        else {
            const earned = (player.gold_from_hero_kills ?? 0) +
                (player.gold_from_creep_kills ?? 0) +
                (player.gold_from_income ?? 0) +
                (player.gold_from_shared ?? 0);
            trueNetworth = earned > 0 ? earned : (player.gold ?? 0);
        }
        if (player.net_worth)
            trueNetworth = player.net_worth;
        if (player.networth)
            trueNetworth = player.networth;
        // Net worth can never be strictly lower than current gold
        if ((player.gold ?? 0) > trueNetworth) {
            trueNetworth = player.gold ?? 0;
        }
        model.player.heroName = hero.name || '';
        model.player.heroCleanName = hero.name ? hero.name.replace('npc_dota_hero_', '').replace(/_/g, ' ') : 'Не выбран';
        model.player.level = hero.level || 1;
        model.player.alive = hero.alive ?? true;
        model.player.respawnSeconds = hero.respawn_seconds ?? 0;
        model.player.hp = hero.health ?? 0;
        model.player.maxHp = hero.max_health ?? 1;
        model.player.hpPercent = hero.health_percent ?? 100;
        model.player.mana = hero.mana ?? 0;
        model.player.maxMana = hero.max_mana ?? 1;
        model.player.manaPercent = hero.mana_percent ?? 100;
        model.player.gold = player.gold ?? 0;
        model.player.networth = trueNetworth;
        model.player.kda = {
            kills: player.kills ?? 0,
            deaths: player.deaths ?? 0,
            assists: player.assists ?? 0,
        };
        model.player.lastHits = player.last_hits ?? 0;
        model.player.denies = player.denies ?? 0;
        model.player.currentZone = currentZone;
        model.player.coordinates = { x, y };
        // Inventory strings
        model.player.inventory = Object.values(raw.items || {})
            .filter((i) => i.name && i.name !== 'empty')
            .map((i) => i.name.replace('item_', ''));
        // Abilities list
        model.player.abilities = Object.values(raw.abilities || {})
            .filter((a) => a.name)
            .map((a) => ({
            name: a.name.replace(/^[a-z]+_/, ''),
            level: a.level,
            cooldown: a.cooldown,
            canCast: a.can_cast,
            isUlt: Boolean(a.ultimate),
        }));
        // Buyback
        model.player.buyback = {
            canBuyback: processed.calculated.buyback.canBuyback,
            cost: hero.buyback_cost ?? 0,
            cooldown: hero.buyback_cooldown ?? 0,
            surplus: processed.calculated.buyback.goldSurplus,
        };
        // 3. Sliding History & Trend Calculations
        if (clock - this.lastSampleClockTime >= 2) {
            this.lastSampleClockTime = clock;
            this.history.push({
                clockTime: clock,
                networth: trueNetworth,
                xp: player.xpm ? player.xpm * (Math.max(1, clock) / 60) : 0,
                gold: player.gold ?? 0,
                kills: player.kills ?? 0,
                deaths: player.deaths ?? 0,
                assists: player.assists ?? 0,
                x,
                y,
            });
            // Keep up to 10 mins of history (300 snapshots)
            if (this.history.length > 300) {
                this.history.shift();
            }
        }
        // Calculate trends from history buffer
        this.updateTrends(model, clock, player, trueNetworth);
        // 4. Update Buildings & Tower Counts
        const isRadiant = (player.team_name || 'radiant').toLowerCase() !== 'dire';
        if (raw.buildings) {
            const towerStats = parseTowerCounts(raw.buildings, isRadiant);
            if (towerStats.hasTowerData) {
                model.mapControl.alliedTowersAlive = towerStats.alliedTowers;
                model.mapControl.enemyTowersAlive = towerStats.enemyTowers;
            }
        }
        // Set dynamic map control safe/danger zones based on team
        if (isRadiant) {
            model.mapControl.currentSafeFarmZones = ['Radiant Base', 'Radiant Triangle', 'Radiant Main Jungle'];
            model.mapControl.dangerousZones = ['Dire Base', 'Dire Triangle', 'Dire Main Jungle', 'Roshan Pit Area (River)'];
        }
        else {
            model.mapControl.currentSafeFarmZones = ['Dire Base', 'Dire Triangle', 'Dire Main Jungle'];
            model.mapControl.dangerousZones = ['Radiant Base', 'Radiant Triangle', 'Radiant Main Jungle', 'Roshan Pit Area (River)'];
        }
        // 5. Update Enemy Missing Durations
        for (const enemyKey of Object.keys(model.enemies)) {
            const enemy = model.enemies[enemyKey];
            if (clock > enemy.lastSeenClockTime) {
                enemy.missingDurationSeconds = clock - enemy.lastSeenClockTime;
            }
        }
        return model;
    }
    updateTrends(model, currentClock, player, currentNw) {
        if (this.history.length === 0)
            return;
        const currentXp = player.xpm ? player.xpm * (Math.max(1, currentClock) / 60) : 0;
        const currentGold = player.gold ?? 0;
        const currentDeaths = player.deaths ?? 0;
        const currentKills = player.kills ?? 0;
        // Snapshot from 5 mins ago (approx 300 seconds)
        const targetClock5m = currentClock - 300;
        const snapshot5m = this.findClosestSnapshot(targetClock5m) || this.history[0];
        // Snapshot from 30 secs ago for velocity
        const targetClock30s = currentClock - 30;
        const snapshot30s = this.findClosestSnapshot(targetClock30s) || this.history[0];
        // Snapshot from 10 mins ago (600 seconds)
        const targetClock10m = currentClock - 600;
        const snapshot10m = this.findClosestSnapshot(targetClock10m) || this.history[0];
        const networthDelta5m = currentNw - snapshot5m.networth;
        const xpDelta5m = Math.round(currentXp - snapshot5m.xp);
        const secondsDiff30s = Math.max(1, currentClock - snapshot30s.clockTime);
        const goldVelocityPerSec = Math.round(((currentGold - snapshot30s.gold) / secondsDiff30s) * 10) / 10;
        const expectedBenchmark = calculateExpectedNetworth(currentClock);
        const networthDiff = currentNw - expectedBenchmark;
        model.trends = {
            networthNow: currentNw,
            networthDelta5m,
            xpDelta5m,
            goldPerMinute: player.gpm ?? 0,
            goldVelocityPerSec,
            expectedNetworthBenchmark: expectedBenchmark,
            networthDifference: networthDiff,
            deathsLast10m: currentDeaths - snapshot10m.deaths,
            killsLast10m: currentKills - snapshot10m.kills,
        };
    }
    findClosestSnapshot(targetClock) {
        if (this.history.length === 0)
            return null;
        let closest = this.history[0];
        let minDiff = Math.abs(closest.clockTime - targetClock);
        for (const snap of this.history) {
            const diff = Math.abs(snap.clockTime - targetClock);
            if (diff < minDiff) {
                minDiff = diff;
                closest = snap;
            }
        }
        return closest;
    }
    registerEnemySighting(heroName, x, y, items, level, clockTime) {
        const model = this.worldModelStore.getModel();
        const zone = determineMapZone(x, y);
        const hasBlink = items.some((i) => i.toLowerCase().includes('blink'));
        const hasBkb = items.some((i) => i.toLowerCase().includes('bkb') || i.toLowerCase().includes('black_king_bar'));
        const hasShadowBlade = items.some((i) => i.toLowerCase().includes('invis') || i.toLowerCase().includes('shadow_blade') || i.toLowerCase().includes('silver_edge'));
        let threatScore = 3;
        if (hasBlink)
            threatScore += 3;
        if (hasShadowBlade)
            threatScore += 2;
        if (level >= 6)
            threatScore += 2;
        model.enemies[heroName] = {
            name: heroName,
            heroNameClean: heroName.replace('npc_dota_hero_', '').replace(/_/g, ' '),
            level,
            alive: true,
            respawnSeconds: 0,
            lastSeenClockTime: clockTime,
            missingDurationSeconds: 0,
            lastKnownLocation: { x, y, zoneName: zone },
            lastKnownHpPercent: 100,
            lastKnownManaPercent: 100,
            items,
            hasBlink,
            hasBkb,
            hasShadowBlade,
            threatScore: Math.min(10, threatScore),
        };
    }
    reset() {
        this.history = [];
        this.lastSampleClockTime = -999;
        this.worldModelStore.reset();
    }
}
exports.StateEngine = StateEngine;
