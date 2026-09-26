import test from 'node:test';
import assert from 'node:assert/strict';

import { classifyMapZone, parseTowerCounts, StateEngine, calculateHeuristicNetworthCurve, calculateExpectedNetworth } from '../src/engine/state-engine';
import { D2PTDataStore } from '../src/engine/d2pt-store';
import { ItemIdentity } from '../src/engine/item-identity';
import { GeminiBudgetManager } from '../src/ai/gemini-budget-manager';
import { DecisionRouter, DecisionTrigger } from '../src/ai/decision-router';
import { GeminiGateway } from '../src/ai/gemini-gateway';
import { ObservationCollector } from '../src/gsi/observation-collector';
import { GameSessionManager } from '../src/engine/game-session';
import { StateManager } from '../src/gsi/state-manager';
import { EventEngine } from '../src/engine/event-engine';
import { AdvisorService } from '../src/ai/advisor-service';
import { ConfigManager } from '../src/ai/ai-config';
import { GsiRawPayload } from '../src/types/gsi';
import { createInitialWorldModel, StrategicPlan } from '../src/engine/world-model';

test('A. Map Zone Classification (Allegiance, Kind, Risk)', () => {
  // Radiant player in Radiant Base
  const radBase = classifyMapZone(-6000, -6000, 'radiant');
  assert.equal(radBase.name, 'Radiant Base');
  assert.equal(radBase.allegiance, 'ally');
  assert.equal(radBase.kind, 'base');
  assert.equal(radBase.baseRisk, 0.05);

  // Radiant player in Dire Base -> Enemy territory
  const direBaseAsRad = classifyMapZone(6000, 6000, 'radiant');
  assert.equal(direBaseAsRad.name, 'Dire Base');
  assert.equal(direBaseAsRad.allegiance, 'enemy');
  assert.equal(direBaseAsRad.kind, 'base');
  assert.equal(direBaseAsRad.baseRisk, 0.95);

  // Dire player in Dire Base -> Ally territory
  const direBaseAsDire = classifyMapZone(6000, 6000, 'dire');
  assert.equal(direBaseAsDire.name, 'Dire Base');
  assert.equal(direBaseAsDire.allegiance, 'ally');

  // Radiant player in Dire Triangle -> Enemy triangle
  const direTri = classifyMapZone(2000, 2000, 'radiant');
  assert.equal(direTri.name, 'Dire Triangle');
  assert.equal(direTri.allegiance, 'enemy');
  assert.equal(direTri.kind, 'triangle');
  assert.equal(direTri.baseRisk, 0.75);

  // River
  const river = classifyMapZone(0, 0, 'radiant');
  assert.equal(river.name, 'River');
  assert.equal(river.allegiance, 'neutral');
  assert.equal(river.kind, 'river');
});

test('B. Tower Counting Parser (Allied & Enemy)', () => {
  const sampleBuildings = {
    radiant: {
      dota_goodguys_tower1_top: { health: 1800, max_health: 1800 },
      dota_goodguys_tower2_top: { health: 2000, max_health: 2000 },
      dota_goodguys_tower1_mid: { health: 0, max_health: 1800 }, // destroyed
    },
    dire: {
      dota_badguys_tower1_top: { health: 1800, max_health: 1800 },
      dota_badguys_tower2_top: { health: 0, max_health: 2000 },
    },
  };

  const parsedRad = parseTowerCounts(sampleBuildings, true);
  assert.equal(parsedRad.hasTowerData, true);
  assert.equal(parsedRad.alliedTowers, 2);
  assert.equal(parsedRad.enemyTowers, 1);

  const parsedDire = parseTowerCounts(sampleBuildings, false);
  assert.equal(parsedDire.alliedTowers, 1);
  assert.equal(parsedDire.enemyTowers, 2);
});

test('C. Roshan State Transitions (alive -> dead -> alive)', () => {
  const engine = new StateEngine();
  const manager = new StateManager();

  const rawAlive: GsiRawPayload = {
    map: {
      clock_time: 600,
      roshan_state: 'alive',
      game_state: 'DOTA_GAMERULES_STATE_GAME_IN_PROGRESS',
    },
    player: { team_name: 'radiant', gold: 1000 },
    hero: { alive: true, health: 1000, max_health: 1000 },
  };

  manager.update(rawAlive);
  const modelAlive = engine.process(rawAlive, manager.getLatestState());
  assert.equal(modelAlive.mapControl.roshanStatus, 'alive');
  assert.equal(modelAlive.mapControl.roshanTimerSeconds, 0);

  const rawDead: GsiRawPayload = {
    map: {
      clock_time: 750,
      roshan_state: 'respawn_base',
      roshan_state_end_seconds: 280,
      game_state: 'DOTA_GAMERULES_STATE_GAME_IN_PROGRESS',
    },
    player: { team_name: 'radiant', gold: 1000 },
    hero: { alive: true, health: 1000, max_health: 1000 },
  };

  manager.update(rawDead);
  const modelDead = engine.process(rawDead, manager.getLatestState());
  assert.equal(modelDead.mapControl.roshanStatus, 'dead');
  assert.equal(modelDead.mapControl.roshanTimerSeconds, 280);
});

test('D. Factual D2PT Resolver & Honest Availability (7.41f)', () => {
  D2PTDataStore.loadAllMetaFiles();
  const meta = D2PTDataStore.getHeroMeta('juggernaut');
  assert.ok(meta !== null);
  assert.equal(meta.hero, 'Juggernaut');
  assert.equal(meta.patch, '7.41f');
  assert.ok(meta.coreBuild.length >= 4);
  assert.ok(meta.sourceUrl?.startsWith('https://dota2protracker.com'));
  assert.equal(meta.extractionMethod, 'static_snapshot');
  assert.ok(typeof meta.dataAgeDays === 'number');

  // Honest fallback: Non-existent hero returns null
  const missingHero = D2PTDataStore.getHeroMeta('non_existent_hero_xyz');
  assert.equal(missingHero, null);

  const fallback = D2PTDataStore.determineNextTargetItem(
    'non_existent_hero_xyz',
    ['item_boots'],
    1000,
    600
  );
  assert.equal(fallback.d2ptAvailable, false);
  assert.equal(fallback.targetItem, null);
  assert.equal(fallback.recommendationSource, 'none');
  assert.equal(fallback.timingStatus, null);
});

test('E. Item Identity & Distinct Boots (Phase != Treads, Upgrades Fulfill)', () => {
  // CRITICAL RULE: Boots are distinct!
  assert.equal(ItemIdentity.isExactItemPurchased('power_treads', ['item_phase_boots']), false);
  assert.equal(ItemIdentity.isExactItemPurchased('phase_boots', ['item_power_treads']), false);
  assert.equal(ItemIdentity.isExactItemPurchased('tranquil_boots', ['item_power_treads']), false);
  assert.equal(ItemIdentity.isExactItemPurchased('travel_boots', ['item_power_treads']), false);

  // Exact match and aliases
  assert.equal(ItemIdentity.isExactItemPurchased('power_treads', ['item_power_treads']), true);
  assert.equal(ItemIdentity.isExactItemPurchased('pt', ['power_treads']), true);
  assert.equal(ItemIdentity.isExactItemPurchased('bkb', ['item_black_king_bar']), true);

  // Upgraded items fulfill component requirement (e.g. Manta fulfills Yasha)
  assert.equal(ItemIdentity.isExactItemPurchased('yasha', ['item_manta']), true);
  assert.equal(ItemIdentity.isExactItemPurchased('dragon_lance', ['item_hurricane_pike']), true);
  assert.equal(ItemIdentity.isExactItemPurchased('blink', ['item_swift_blink']), true);

  // Strict distinction: ownsExactItem vs satisfiesRequirement
  assert.equal(ItemIdentity.satisfiesRequirement('yasha', ['item_manta']), true);
  assert.equal(ItemIdentity.ownsExactItem('yasha', ['item_manta']), false);
  assert.equal(ItemIdentity.ownsExactItem('manta', ['item_manta']), true);
  assert.equal(ItemIdentity.satisfiesRequirement('blink', ['item_swift_blink']), true);
  assert.equal(ItemIdentity.ownsExactItem('blink', ['item_swift_blink']), false);
});

test('F. Gemini Budget Manager (RPM & RPD limits with atomic reserveSlot)', () => {
  const bm = GeminiBudgetManager.getInstance();
  bm.reset(2, 5);

  const res1 = bm.reserveSlot('Test 1');
  assert.equal(res1.allowed, true);
  assert.ok(res1.reservationId);

  const res2 = bm.reserveSlot('Test 2');
  assert.equal(res2.allowed, true);
  assert.ok(res2.reservationId);

  // Third request exceeds RPM limit of 2
  const res3 = bm.reserveSlot('Test 3');
  assert.equal(res3.allowed, false);
  assert.ok(res3.reason?.includes('минуту'));

  // Release reservation
  if (res2.reservationId) {
    bm.releaseReservation(res2.reservationId);
  }

  // Now a slot should be available again
  const resRetry = bm.reserveSlot('Test Retry');
  assert.equal(resRetry.allowed, true);

  // Restore limits
  bm.reset(15, 500);
});

test('G. Observation Collector & Freshness Classification', () => {
  const collector = ObservationCollector.getInstance();
  collector.reset();

  collector.recordSighting({
    name: 'npc_dota_hero_lion',
    x: 2500,
    y: 2200,
    clockTime: 300,
    source: 'gsi',
    level: 9,
    items: ['item_blink', 'item_tranquil_boots'],
    hpPercent: 90,
    manaPercent: 80,
    certainty: 0.95,
  });

  // Fresh observation (< 15s)
  const freshMap = collector.getObservations(305);
  assert.ok(freshMap['npc_dota_hero_lion']);
  assert.equal(freshMap['npc_dota_hero_lion'].freshness, 'fresh');
  assert.equal(freshMap['npc_dota_hero_lion'].observationSource, 'gsi');

  // Stale observation (15-60s)
  const staleMap = collector.getObservations(330);
  assert.ok(staleMap['npc_dota_hero_lion']);
  assert.equal(staleMap['npc_dota_hero_lion'].freshness, 'stale');

  // Expired observation (> 60s)
  const expiredMap = collector.getObservations(375);
  assert.ok(expiredMap['npc_dota_hero_lion']);
  assert.equal(expiredMap['npc_dota_hero_lion'].freshness, 'expired');
});

test('H. Game Session Manager Atomic Reset on Match Change', () => {
  const session = GameSessionManager.getInstance();
  const collector = ObservationCollector.getInstance();

  session.fullReset('match_1001');
  assert.equal(session.getCurrentMatchId(), 'match_1001');

  collector.recordSighting({
    name: 'npc_dota_hero_sven',
    x: 1000,
    y: 1000,
    clockTime: 200,
    source: 'gsi',
    level: 10,
    items: ['item_blink'],
    hpPercent: 100,
    manaPercent: 100,
    certainty: 0.9,
  });

  assert.ok(collector.getObservations(205)['npc_dota_hero_sven']);

  // Match change triggers full reset
  session.update('match_1002', 'DOTA_GAMERULES_STATE_PRE_GAME', 10);
  assert.equal(session.getCurrentMatchId(), 'match_1002');

  // Observation collector must be clean
  const observationsAfterReset = collector.getObservations(15);
  assert.equal(Object.keys(observationsAfterReset).length, 0);
});

test('I. State Manager getRawState() and Payload Extraction', () => {
  const manager = new StateManager();
  const raw: GsiRawPayload = {
    provider: { name: 'Dota 2', appid: 570, version: 1, timestamp: 123456 },
    map: { clock_time: 420, matchid: '555', game_state: 'DOTA_GAMERULES_STATE_GAME_IN_PROGRESS' },
    player: { team_name: 'radiant', gold: 2500, net_worth: 8000 },
    hero: { name: 'npc_dota_hero_juggernaut', level: 12, alive: true, health: 1500, max_health: 1500 },
  };

  manager.update(raw);
  const retrievedRaw = manager.getRawState();
  assert.equal(retrievedRaw.map?.matchid, '555');
  assert.equal(retrievedRaw.player?.gold, 2500);

  const processed = manager.getLatestState();
  assert.equal(processed.hero.name, 'npc_dota_hero_juggernaut');
  assert.equal(processed.calculated.formattedClock, '07:00');
});

test('J. Continuous Plan Evaluation (detects standing in danger zone on tick)', () => {
  const eventEngine = new EventEngine();
  const model = createInitialWorldModel();

  // Create an active plan that forbids 'Dire Triangle'
  const plan: StrategicPlan = {
    id: 'plan_test_violation',
    createdAtClock: 300,
    priority: 'Безопасный фарм BKB',
    targetObjective: 'Фарм своего леса',
    targetItem: 'Black King Bar',
    goldNeededForItem: 1500,
    avoidZones: ['Dire Triangle', 'River'],
    safeZones: ['Radiant Main Jungle'],
    guidanceText: 'Избегайте вражеского треугольника',
    certainty: 0.9,
    status: 'active',
  };
  model.strategy.activePlan = plan;

  // Player stands inside forbidden Dire Triangle
  model.player.currentZone = 'Dire Triangle';
  model.meta.clockTime = 310;

  let violationDetected = false;
  eventEngine.on('plan_violated', (violatedPlan) => {
    violationDetected = true;
    assert.equal(violatedPlan.id, 'plan_test_violation');
  });

  // Continuous evaluation on tick
  eventEngine.evaluate(model);
  assert.equal(violationDetected, true);
  assert.equal(plan.status, 'violated');
});

test('K. Decision Router Priority Tiers & Category Cooldowns', () => {
  const router = DecisionRouter.getInstance();
  router.reset();

  const cfg = ConfigManager.get();
  cfg.autoCoachEnabled = true;

  const trigger1: DecisionTrigger = {
    id: 'trig_1',
    priority: 'CRITICAL',
    category: 'plan_violated',
    reason: 'План нарушен',
    clockTime: 300,
    matchId: GameSessionManager.getInstance().getCurrentMatchId(),
  };

  // 1st trigger should be accepted
  const eval1 = router.evaluateTrigger(trigger1);
  assert.equal(eval1.allowed, true);
  router.recordTriggerAccepted(trigger1);

  // Rapid 2nd trigger of same category should be blocked by cooldown
  const trigger2: DecisionTrigger = {
    id: 'trig_2',
    priority: 'CRITICAL',
    category: 'plan_violated',
    reason: 'План снова нарушен',
    clockTime: 305,
    matchId: GameSessionManager.getInstance().getCurrentMatchId(),
  };

  const eval2 = router.evaluateTrigger(trigger2);
  assert.equal(eval2.allowed, false);
  assert.ok(eval2.reason?.includes('cooldown'));
});

test('L. Decision Router autoCoachEnabled Gating', () => {
  const router = DecisionRouter.getInstance();
  router.reset();

  const cfg = ConfigManager.get();
  cfg.autoCoachEnabled = false; // Autonomous coach disabled

  const autoTrigger: DecisionTrigger = {
    id: 'auto_trig',
    priority: 'HIGH',
    category: 'roshan',
    reason: 'Рошан пал',
    clockTime: 500,
    matchId: GameSessionManager.getInstance().getCurrentMatchId(),
  };

  const evalAuto = router.evaluateTrigger(autoTrigger);
  assert.equal(evalAuto.allowed, false);
  assert.ok(evalAuto.reason?.includes('disabled'));

  // Manual trigger must be allowed even when autoCoach is false
  const manualTrigger: DecisionTrigger = {
    id: 'manual_trig',
    priority: 'MANUAL',
    category: 'manual',
    reason: 'Игрок нажал кнопку',
    clockTime: 500,
    matchId: GameSessionManager.getInstance().getCurrentMatchId(),
  };

  const evalManual = router.evaluateTrigger(manualTrigger);
  assert.equal(evalManual.allowed, true);

  // Restore
  cfg.autoCoachEnabled = true;
});

test('M. Gemini Gateway Schema Validator', () => {
  const validPlan = {
    priority: 'Сборка BKB',
    targetObjective: 'Контроль карты',
    targetItem: 'Black King Bar',
    goldNeededForItem: 1200,
    avoidZones: ['Вражеский лес'],
    safeZones: ['Свой лес'],
    guidanceText: 'Фармите осторожно.',
    certainty: 0.95,
  };

  const validationSuccess = GeminiGateway.validatePlanSchema(validPlan);
  assert.equal(validationSuccess.valid, true);
  assert.equal(validationSuccess.errors.length, 0);

  const invalidPlan = {
    priority: '',
    goldNeededForItem: 'not_a_number',
  };

  const validationFailure = GeminiGateway.validatePlanSchema(invalidPlan);
  assert.equal(validationFailure.valid, false);
  assert.ok(validationFailure.errors.length > 0);
});

test('N. Deterministic Outcome Tracking (matchId & validUntilClock)', async () => {
  GameSessionManager.getInstance().fullReset('match_outcome_test');
  const advisor = AdvisorService.getInstance();

  const model = advisor.getWorldModel();
  model.meta.matchId = 'match_outcome_test';
  model.meta.clockTime = 400;
  model.player.alive = true;
  model.player.networth = 5000;

  // Record an advice outcome directly
  const record = advisor.recordAdviceOutcome(
    model,
    'Фармить безопасный треугольник',
    'FARM_SAFE',
    'Manual prompt'
  );

  const outcomes = model.outcomeHistory;
  assert.ok(outcomes.length > 0);
  assert.equal(record.matchId, 'match_outcome_test');
  assert.equal(record.clockTime, 400);
  assert.equal(record.validUntilClock, 460); // 60s horizon

  // Simulate hero death before horizon
  model.player.alive = false;
  model.meta.clockTime = 430;

  const rawState: GsiRawPayload = {
    map: { clock_time: 430, matchid: 'match_outcome_test', game_state: 'DOTA_GAMERULES_STATE_GAME_IN_PROGRESS' },
    player: { team_name: 'radiant', gold: 2000, net_worth: 5000 },
    hero: { alive: false, health: 0, max_health: 1500 },
  };

  const stateManager = new StateManager();
  stateManager.update(rawState);
  await advisor.onGameStateUpdate(rawState, stateManager.getLatestState());

  assert.equal(record.result, 'died');
  assert.ok(record.resultNotes?.includes('погиб'));
});

test('O. Security Tokens Configuration Integrity', () => {
  const cfg = ConfigManager.get();
  assert.ok(cfg.gsiAuthToken.length > 0);
  assert.ok(cfg.dashboardAuthToken.length > 0);

  const publicCfg = ConfigManager.getPublicConfig();
  // Secret tokens and raw API keys MUST NEVER be in public config
  assert.equal((publicCfg as any).geminiApiKey, undefined);
  assert.equal((publicCfg as any).gsiAuthToken, undefined);
  assert.equal((publicCfg as any).dashboardAuthToken, undefined);
  assert.ok(publicCfg.maskedKey !== undefined);
});

test('P. Concurrent Budget Reservation Release Precision', () => {
  const bm = GeminiBudgetManager.getInstance();
  bm.reset(5, 10);

  // Reserve slot 1
  const r1 = bm.reserveSlot('Request 1');
  assert.ok(r1.allowed && r1.reservationId);

  // Reserve slot 2
  const r2 = bm.reserveSlot('Request 2');
  assert.ok(r2.allowed && r2.reservationId);

  // Reserve slot 3
  const r3 = bm.reserveSlot('Request 3');
  assert.ok(r3.allowed && r3.reservationId);

  // Status should show 3 requests used
  assert.equal(bm.getStatus().rpmUsed, 3);

  // Release middle reservation r2
  bm.releaseReservation(r2.reservationId);
  assert.equal(bm.getStatus().rpmUsed, 2);

  // Release r1
  bm.releaseReservation(r1.reservationId);
  assert.equal(bm.getStatus().rpmUsed, 1);

  // Releasing non-existent reservation is a safe no-op
  bm.releaseReservation('invalid_reservation_id');
  assert.equal(bm.getStatus().rpmUsed, 1);

  // Release r3
  bm.releaseReservation(r3.reservationId);
  assert.equal(bm.getStatus().rpmUsed, 0);

  // Restore limits
  bm.reset(15, 500);
});

test('Q. Gemini Gateway Fail-Closed on Malformed JSON & Schema Errors', async () => {
  const originalFetch = global.fetch;
  const bm = GeminiBudgetManager.getInstance();
  bm.reset(10, 50);

  const cfg = ConfigManager.get();
  const originalKey = cfg.geminiApiKey;
  // Ensure an API key is set so it doesn't fail on missing API key check
  cfg.geminiApiKey = 'test_api_key_mocked';

  const model = createInitialWorldModel();
  model.player.heroCleanName = 'Juggernaut';
  model.player.inventory = ['item_boots', 'item_manta'];

  try {
    const initialUsed = bm.getStatus().rpmUsed;

    // 1. Mock fetch returning broken JSON
    global.fetch = (async () => {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          candidates: [{ content: { parts: [{ text: 'Broken JSON: { priority: "Push", targetObjective: ' }] } }],
        }),
      } as any;
    }) as any;

    const brokenJsonResult = await GeminiGateway.generateStrategicPlan(model, 'Test broken JSON');
    assert.equal(brokenJsonResult.success, false);
    assert.equal(brokenJsonResult.error, 'INVALID_MODEL_OUTPUT');
    // Verify budget reservation was released
    assert.equal(bm.getStatus().rpmUsed, initialUsed);

    // 2. Mock fetch returning valid JSON but missing required fields
    global.fetch = (async () => {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          candidates: [{ content: { parts: [{ text: JSON.stringify({ priority: 12345, goldNeededForItem: 'invalid' }) }] } }],
        }),
      } as any;
    }) as any;

    const schemaFailResult = await GeminiGateway.generateStrategicPlan(model, 'Test invalid schema');
    assert.equal(schemaFailResult.success, false);
    assert.equal(schemaFailResult.error, 'INVALID_MODEL_OUTPUT');
    // Verify budget reservation was released
    assert.equal(bm.getStatus().rpmUsed, initialUsed);

    // 3. Mock fetch returning plan that recommends an item already owned in inventory ('Manta Style')
    global.fetch = (async () => {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: JSON.stringify({
                      priority: 'Сборка Manta',
                      targetObjective: 'Сплитпуш',
                      targetItem: 'Manta Style',
                      goldNeededForItem: 0,
                      avoidZones: ['Enemy Jungle'],
                      safeZones: ['Radiant Main Jungle'],
                      guidanceText: 'Купите Манту для пуша линий',
                      certainty: 0.9,
                    }),
                  },
                ],
              },
            },
          ],
        }),
      } as any;
    }) as any;

    const ownedItemResult = await GeminiGateway.generateStrategicPlan(model, 'Test already owned');
    assert.equal(ownedItemResult.success, false);
    assert.equal(ownedItemResult.error, 'INVALID_MODEL_OUTPUT');
    assert.ok(ownedItemResult.guidanceText?.includes('уже есть в инвентаре'));
    // Verify budget reservation was released
    assert.equal(bm.getStatus().rpmUsed, initialUsed);
  } finally {
    global.fetch = originalFetch;
    cfg.geminiApiKey = originalKey;
    bm.reset(15, 500);
  }
});

test('R. SharedWorldModel observationMode & Heuristic Networth Curve Baseline', () => {
  const model = createInitialWorldModel();
  assert.equal(model.observationMode, 'player_gsi_fow_restricted');

  // Verify StateEngine sets observationMode correctly
  const engine = new StateEngine();
  const stateMgr = new StateManager();

  const normalPayload: GsiRawPayload = {
    provider: { name: 'Dota 2', appid: 570, version: 1, timestamp: 123456 },
    map: { clock_time: 120, game_state: 'DOTA_GAMERULES_STATE_GAME_IN_PROGRESS' },
    player: { team_name: 'radiant', gold: 1000, net_worth: 1000 },
    hero: { name: 'npc_dota_hero_juggernaut', level: 3, alive: true, health: 800, max_health: 800 },
  };

  stateMgr.update(normalPayload);
  const updatedModel = engine.process(normalPayload, stateMgr.getLatestState());
  assert.equal(updatedModel.observationMode, 'player_gsi_fow_restricted');

  // Heuristic Networth Curve testing
  assert.equal(calculateHeuristicNetworthCurve(0), 600);
  assert.equal(calculateHeuristicNetworthCurve(300), 2600); // 5 min: 600 + 5 * 400
  assert.equal(calculateHeuristicNetworthCurve(900), 7850); // 15 min: 4600 + 5 * 650
  assert.equal(calculateHeuristicNetworthCurve(1500), 15350); // 25 min: 11100 + 5 * 850

  // Alias equivalence
  assert.equal(calculateExpectedNetworth(300), calculateHeuristicNetworthCurve(300));
  assert.equal(calculateExpectedNetworth(900), calculateHeuristicNetworthCurve(900));
});
