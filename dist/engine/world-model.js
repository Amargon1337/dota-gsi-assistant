"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WorldModelStore = void 0;
exports.createInitialWorldModel = createInitialWorldModel;
function createInitialWorldModel() {
    return {
        meta: {
            matchId: '',
            serverTime: Date.now(),
            clockTime: -90,
            formattedClock: '-01:30',
            gamePhase: 'INIT',
            isDaytime: true,
            dayNightCountdown: 0,
        },
        player: {
            heroName: '',
            heroCleanName: 'Выбор героя',
            level: 1,
            alive: true,
            respawnSeconds: 0,
            hp: 1000,
            maxHp: 1000,
            hpPercent: 100,
            mana: 500,
            maxMana: 500,
            manaPercent: 100,
            gold: 600,
            networth: 600,
            kda: { kills: 0, deaths: 0, assists: 0 },
            lastHits: 0,
            denies: 0,
            currentZone: 'Base',
            coordinates: { x: 0, y: 0 },
            inventory: [],
            abilities: [],
            buyback: {
                canBuyback: true,
                cost: 0,
                cooldown: 0,
                surplus: 600,
            },
        },
        trends: {
            networthNow: 600,
            networthDelta5m: 0,
            xpDelta5m: 0,
            goldPerMinute: 0,
            goldVelocityPerSec: 0,
            expectedNetworthBenchmark: 600,
            networthDifference: 0,
            deathsLast10m: 0,
            killsLast10m: 0,
        },
        enemies: {},
        mapControl: {
            alliedTowersAlive: 11,
            enemyTowersAlive: 11,
            roshanStatus: 'alive',
            currentSafeFarmZones: ['Our Safe Jungle', 'Base'],
            dangerousZones: ['River', 'Enemy Triangle', 'Enemy Jungle'],
        },
        threats: [],
        strategy: {
            activePlan: null,
            previousPlans: [],
            lastGeminiAnalysisTime: 0,
        },
        recentEvents: [],
        leyaState: {
            lastInferenceLatencyMs: 0,
            operationalPicture: 'Ожидание начала матча',
            immediateAction: 'farm_safe',
            confidence: 0.9,
        },
    };
}
class WorldModelStore {
    static instance;
    model = createInitialWorldModel();
    static getInstance() {
        if (!WorldModelStore.instance) {
            WorldModelStore.instance = new WorldModelStore();
        }
        return WorldModelStore.instance;
    }
    getModel() {
        return this.model;
    }
    updateModel(updater) {
        updater(this.model);
        return this.model;
    }
    reset(matchId = '') {
        this.model = createInitialWorldModel();
        this.model.meta.matchId = matchId;
    }
}
exports.WorldModelStore = WorldModelStore;
