import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';

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
import { LayaClient } from '../src/ai/laya-client';
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

test('K. Decision Router Invariant: Strictly rejects all non-MANUAL triggers', () => {
  const router = DecisionRouter.getInstance();
  router.reset();

  const currentMatch = GameSessionManager.getInstance().getCurrentMatchId();

  const categories: Array<DecisionTrigger['category']> = [
    'plan_violated',
    'hero_death',
    'plan_completed',
    'roshan',
    'tactical_escalation',
    'item_power_spike',
  ];

  // All automated / non-manual triggers must be rejected unconditionally
  for (const cat of categories) {
    const trigger: DecisionTrigger = {
      id: `trig_${cat}`,
      priority: cat === 'plan_violated' ? 'CRITICAL' : 'HIGH',
      category: cat,
      reason: `Automated event for ${cat}`,
      clockTime: 300,
      matchId: currentMatch,
    };
    const evaluation = router.evaluateTrigger(trigger);
    assert.equal(evaluation.allowed, false);
    assert.equal(evaluation.reason, 'Gemini is manual-only');
  }

  // Cross-match manual trigger rejected
  const crossMatchTrigger: DecisionTrigger = {
    id: 'trig_wrong_match',
    priority: 'MANUAL',
    category: 'manual',
    reason: 'Manual request from previous match',
    clockTime: 300,
    matchId: 'stale_match_9999',
  };
  const evalStale = router.evaluateTrigger(crossMatchTrigger);
  assert.equal(evalStale.allowed, false);
  assert.ok(evalStale.reason?.includes('stale match'));
});

test('L. Decision Router Manual Trigger Acceptance & Click Debounce', () => {
  const router = DecisionRouter.getInstance();
  router.reset();

  const currentMatch = GameSessionManager.getInstance().getCurrentMatchId();

  const manualTrigger: DecisionTrigger = {
    id: 'manual_1',
    priority: 'MANUAL',
    category: 'manual',
    reason: 'Игрок нажал кнопку',
    clockTime: 500,
    matchId: currentMatch,
  };

  const evalManual = router.evaluateTrigger(manualTrigger);
  assert.equal(evalManual.allowed, true);
  router.recordTriggerAccepted(manualTrigger);

  // Rapid second click (< 2 seconds) must be debounced
  const rapidClick: DecisionTrigger = {
    id: 'manual_2',
    priority: 'MANUAL',
    category: 'manual',
    reason: 'Быстрый повторный клик',
    clockTime: 501,
    matchId: currentMatch,
  };
  const evalRapid = router.evaluateTrigger(rapidClick);
  assert.equal(evalRapid.allowed, false);
  assert.ok(evalRapid.reason?.includes('rate limit'));
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

    // 1. Mock fetch returning broken JSON (HTTP 200 -> Google billed quota -> reservation committed)
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
    // Verify budget reservation was COMMITTED because HTTP 200 was billed by Google API
    assert.equal(bm.getStatus().rpmUsed, initialUsed + 1);

    // 2. Mock fetch returning valid JSON but missing required fields (HTTP 200 -> committed)
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
    // Verify budget reservation was committed
    assert.equal(bm.getStatus().rpmUsed, initialUsed + 2);

    // 3. Mock fetch returning plan that recommends an item already owned in inventory (HTTP 200 -> committed)
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
    // Verify budget reservation was committed
    assert.equal(bm.getStatus().rpmUsed, initialUsed + 3);

    // 4. Mock fetch returning HTTP 500 error (HTTP !ok -> reservation released)
    global.fetch = (async () => {
      return {
        ok: false,
        status: 500,
        text: async () => 'Internal Server Error',
      } as any;
    }) as any;

    const serverErrorResult = await GeminiGateway.generateStrategicPlan(model, 'Test 500 error');
    assert.equal(serverErrorResult.success, false);
    assert.equal(serverErrorResult.error, 'NETWORK_ERROR');
    // Verify budget reservation was RELEASED (rpmUsed unchanged from +3)
    assert.equal(bm.getStatus().rpmUsed, initialUsed + 3);
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

test('S. Gemini Gateway Invariant: Rejects non-manual invocation (MANUAL_ONLY) without budget or HTTP', async () => {
  const originalFetch = global.fetch;
  let fetchCalled = false;
  global.fetch = (async () => {
    fetchCalled = true;
    return { ok: true, status: 200, json: async () => ({}) } as any;
  }) as any;

  const bm = GeminiBudgetManager.getInstance();
  const initialUsed = bm.getStatus().rpmUsed;
  const model = createInitialWorldModel();

  try {
    // Non-manual invocation rejected immediately
    const autoResult = await GeminiGateway.generateStrategicPlan(model, 'Auto test', 'automated');
    assert.equal(autoResult.success, false);
    assert.equal(autoResult.error, 'MANUAL_ONLY');
    assert.equal(fetchCalled, false);
    assert.equal(bm.getStatus().rpmUsed, initialUsed);

    const eventResult = await GeminiGateway.generateStrategicPlan(model, 'Plan violated', 'plan_violated');
    assert.equal(eventResult.success, false);
    assert.equal(eventResult.error, 'MANUAL_ONLY');
    assert.equal(fetchCalled, false);
    assert.equal(bm.getStatus().rpmUsed, initialUsed);
  } finally {
    global.fetch = originalFetch;
  }
});

test('T. Background Pipeline Invariant: Laya critical risk & game events produce 0 Gemini calls', async () => {
  const originalFetch = global.fetch;
  let geminiCalls = 0;
  let layaCalls = 0;

  // Intercept fetch: Laya endpoint returns critical risk, Gemini endpoint counts calls
  global.fetch = (async (url: string | URL | Request) => {
    const urlStr = url.toString();
    if (urlStr.includes('googleapis.com') || urlStr.includes('generativelanguage')) {
      geminiCalls++;
      return { ok: true, status: 200, json: async () => ({}) } as any;
    }
    // Laya request
    layaCalls++;
    return {
      ok: true,
      status: 200,
      json: async () => ({
        answers: {
          tactical_action: { choice: 'retreat', answer_confidence: 0.95 },
          gank_risk: { choice: 'critical', probabilities: { critical: 0.9, safe: 0.05 } },
          plan_safety: { choice: 'critical_violation' },
        },
      }),
    } as any;
  }) as any;

  try {
    GameSessionManager.getInstance().fullReset('match_zero_gemini');
    const advisor = AdvisorService.getInstance();
    const stateMgr = new StateManager();

    // Set an active plan to test plan violation
    const activePlan: StrategicPlan = {
      id: 'plan_zero_gemini',
      createdAtClock: 100,
      priority: 'Фарм',
      targetObjective: 'Фарм',
      targetItem: 'BKB',
      goldNeededForItem: 2000,
      avoidZones: ['Enemy Triangle'],
      safeZones: ['Base'],
      guidanceText: 'Фармите аккуратно',
      certainty: 0.9,
      status: 'active',
    };
    advisor.getWorldModel().strategy.activePlan = activePlan;

    // Simulate game state where player is in danger zone + died
    const dangerousPayload: GsiRawPayload = {
      provider: { name: 'Dota 2', appid: 570, version: 1, timestamp: 123456 },
      map: { clock_time: 200, matchid: 'match_zero_gemini', game_state: 'DOTA_GAMERULES_STATE_GAME_IN_PROGRESS' },
      player: { team_name: 'radiant', gold: 1000, net_worth: 1000 },
      hero: { name: 'npc_dota_hero_juggernaut', level: 5, alive: false, health: 0, max_health: 1000, xpos: 2000, ypos: 2000 },
    };

    stateMgr.update(dangerousPayload);
    await advisor.onGameStateUpdate(dangerousPayload, stateMgr.getLatestState());

    // Give background promises a microtick to resolve
    await new Promise((r) => setTimeout(r, 60));

    // Zero calls to Gemini API must be made!
    assert.equal(geminiCalls, 0, 'Gemini must never be called on background events or Laya critical risk');
  } finally {
    global.fetch = originalFetch;
  }
});

test('U. High-Volume Invariant: 100 consecutive Laya inferences produce 0 Gemini HTTP requests', async () => {
  const originalFetch = global.fetch;
  let geminiCalls = 0;
  let layaCalls = 0;

  global.fetch = (async (url: string | URL | Request) => {
    const urlStr = url.toString();
    if (urlStr.includes('googleapis.com') || urlStr.includes('generativelanguage')) {
      geminiCalls++;
      return { ok: true, status: 200, json: async () => ({}) } as any;
    }
    layaCalls++;
    return {
      ok: true,
      status: 200,
      json: async () => ({
        answers: {
          tactical_action: { choice: 'farm_safe', answer_confidence: 0.8 },
          gank_risk: { choice: 'safe', probabilities: { safe: 0.85 } },
          plan_safety: { choice: 'safe' },
        },
      }),
    } as any;
  }) as any;

  try {
    const model = createInitialWorldModel();
    model.player.heroCleanName = 'Juggernaut';

    for (let i = 0; i < 100; i++) {
      model.meta.clockTime = 100 + i;
      const result = await LayaClient.evaluateWorldModel(model);
      assert.ok(result.available);
    }

    assert.equal(layaCalls, 100);
    assert.equal(geminiCalls, 0, '100 Laya inferences must produce exactly 0 Gemini requests');
  } finally {
    global.fetch = originalFetch;
  }
});

test('V. AdvisorService.askManualQuestion() operates through manual pipeline', async () => {
  const originalFetch = global.fetch;
  const cfg = ConfigManager.get();
  const origKey = cfg.geminiApiKey;
  cfg.geminiApiKey = 'test_valid_key';

  const bm = GeminiBudgetManager.getInstance();
  bm.reset(15, 500);
  const initialUsed = bm.getStatus().rpmUsed;

  const validPlanPayload = {
    priority: 'Фармить BKB перед Рошаном',
    targetObjective: 'Защита и контест Рошана',
    targetItem: 'Black King Bar',
    goldNeededForItem: 1400,
    avoidZones: ['Enemy Jungle'],
    safeZones: ['Radiant Triangle'],
    guidanceText: 'Сконцентрируйтесь на фарме треугольника для завершения BKB.',
    certainty: 0.9,
  };

  let geminiCalls = 0;
  global.fetch = (async (url: string | URL | Request) => {
    const urlStr = url.toString();
    if (urlStr.includes('googleapis.com') || urlStr.includes('generativelanguage')) {
      geminiCalls++;
      return {
        ok: true,
        status: 200,
        json: async () => ({
          candidates: [
            {
              content: {
                parts: [{ text: JSON.stringify(validPlanPayload) }],
              },
            },
          ],
        }),
      } as any;
    }
    return { ok: true, status: 200, json: async () => ({}) } as any;
  }) as any;

  try {
    GameSessionManager.getInstance().fullReset('match_manual_test');
    const advisor = AdvisorService.getInstance();
    const model = advisor.getWorldModel();
    model.meta.matchId = 'match_manual_test';
    model.meta.clockTime = 600;
    model.player.heroCleanName = 'Juggernaut';
    model.player.inventory = ['item_boots'];

    // Manual call
    const planResult = await advisor.askManualQuestion('Что делать в мидгейме?');
    assert.equal(planResult.success, true);
    assert.equal(geminiCalls, 1);
    assert.equal(bm.getStatus().rpmUsed, initialUsed + 1);

    // Verify model has activePlan updated
    assert.equal(model.strategy.activePlan?.targetItem, 'Black King Bar');
    assert.equal(model.strategy.activePlan?.priority, 'Фармить BKB перед Рошаном');
  } finally {
    global.fetch = originalFetch;
    cfg.geminiApiKey = origKey;
  }
});

test('W. Computer Vision Sightings Ingestion, Zone Mapping & Freshness', () => {
  const collector = ObservationCollector.getInstance();
  collector.reset();

  // Ingest sighting from CV agent: Axe detected at Radiant Triangle coordinates
  const cvTracker = collector.observeEnemy({
    heroName: 'npc_dota_hero_axe',
    x: -3000,
    y: -1500,
    clockTime: 500,
    source: 'cv',
    certainty: 0.94,
    level: 7,
    items: ['item_blink'],
  }, 'radiant');

  assert.equal(cvTracker.observationSource, 'cv');
  assert.equal(cvTracker.certainty, 0.94);
  assert.equal(cvTracker.heroNameClean, 'axe');
  assert.equal(cvTracker.hasBlink, true);
  assert.equal(cvTracker.lastKnownLocation.zoneName, 'Radiant Triangle');
  assert.equal(cvTracker.freshness, 'fresh');
  assert.equal(cvTracker.missingDurationSeconds, 0);

  // Time advances 20s without sighting -> status transitions to stale
  collector.updateClock(520);
  const observations = collector.getObservationsRecord();
  const axeObs = observations['npc_dota_hero_axe'];
  assert.ok(axeObs);
  assert.equal(axeObs.freshness, 'stale');
  assert.equal(axeObs.missingDurationSeconds, 20);
  assert.equal(axeObs.lastKnownLocation.zoneName, 'Radiant Triangle');

  // Time advances 70s -> status transitions to expired
  collector.updateClock(570);
  const expiredObs = collector.getObservationsRecord()['npc_dota_hero_axe'];
  assert.equal(expiredObs.freshness, 'expired');
  assert.equal(expiredObs.missingDurationSeconds, 70);
});

test('X. SharedWorldModel observationMode supports hybrid_gsi_cv and visionDraft', () => {
  const model = createInitialWorldModel();
  assert.equal(model.observationMode, 'player_gsi_fow_restricted');

  // Simulate CV activating hybrid mode
  model.observationMode = 'hybrid_gsi_cv';
  assert.equal(model.observationMode, 'hybrid_gsi_cv');

  // Simulate Draft Vision recognition
  model.visionDraft = {
    radiantHeroes: ['antimage', 'puck', 'lion'],
    direHeroes: ['axe', 'lina', 'slardar'],
    lastUpdated: Date.now(),
  };

  assert.equal(model.visionDraft.radiantHeroes.length, 3);
  assert.equal(model.visionDraft.direHeroes.length, 3);
  assert.ok(model.visionDraft.direHeroes.includes('axe'));
});

test('Y. StateEngine Draft Heroes Ingestion and Enemy Memory Tracking', () => {
  const engine = new StateEngine();
  const rawWithDraft: GsiRawPayload = {
    provider: { name: 'Dota 2', appid: 570, version: 1, timestamp: 100 },
    map: { clock_time: 120, game_state: 'DOTA_GAMERULES_STATE_GAME_IN_PROGRESS', daytime: true },
    player: { team_name: 'radiant', gold: 1200, net_worth: 1200 },
    hero: { xpos: -1000, ypos: -1000, alive: true },
    draft: {
      team3: {
        hero0: { name: 'npc_dota_hero_pudge' },
        hero1: { name: 'npc_dota_hero_shadow_fiend' },
      },
    },
  };

  const processedState = new StateManager().update(rawWithDraft);
  const worldModel = engine.process(rawWithDraft, processedState);

  // Ingested enemy draft heroes must exist in worldModel.enemies
  assert.ok(worldModel.enemies['npc_dota_hero_pudge']);
  assert.ok(worldModel.enemies['npc_dota_hero_shadow_fiend']);
  assert.equal(worldModel.enemies['npc_dota_hero_pudge'].heroNameClean, 'pudge');
  assert.equal(worldModel.enemies['npc_dota_hero_pudge'].observationSource, 'inferred');

  // Verify registering real sighting updates location and zone
  engine.registerEnemySighting('npc_dota_hero_pudge', 2000, -2000, ['item_blink'], 6, 125, 'cv', 0.95);
  const updatedModel = engine.process(rawWithDraft, processedState);
  const pudge = updatedModel.enemies['npc_dota_hero_pudge'];
  assert.equal(pudge.hasBlink, true);
  assert.equal(pudge.lastKnownLocation.zoneName, 'River');
  assert.equal(pudge.freshness, 'fresh');
});

test('Z. Scoreboard Vision Threat Item Spikes and Level Spikes Ingestion', () => {
  const collector = ObservationCollector.getInstance();
  collector.reset();

  // 1. Ingest enemy Storm Spirit with Orchid and Axe with Blink via Scoreboard Vision
  const stormTracker = collector.observeEnemy({
    heroName: 'npc_dota_hero_storm_spirit',
    level: 12,
    items: ['item_orchid', 'item_power_treads', 'item_bottle'],
    clockTime: 840,
    source: 'cv',
    certainty: 0.95,
  }, 'radiant');

  assert.equal(stormTracker.level, 12);
  assert.ok(stormTracker.items.includes('item_orchid'));
  assert.equal(stormTracker.observationSource, 'cv');

  // 2. Verify threat items catalog is loaded and parses correctly
  const threatPath = path.join(__dirname, '../data/threat_items.json');
  assert.ok(fs.existsSync(threatPath));
  const catalog = JSON.parse(fs.readFileSync(threatPath, 'utf-8'));
  assert.ok(catalog['orchid']);
  assert.equal(catalog['orchid'].severity, 'CRITICAL');
  assert.equal(catalog['orchid'].category, 'INSTANT_DISABLE_AND_HEX');
  assert.ok(catalog['blink']);
  assert.equal(catalog['blink'].severity, 'CRITICAL');

  // 3. Verify GameSessionManager reset cleanly wipes enemy observations
  GameSessionManager.getInstance().fullReset('match_scoreboard_test');
  const freshObs = collector.getObservationsRecord();
  assert.equal(Object.keys(freshObs).length, 0);
});

test('AA. Anonymous Contacts Minimap Ingestion & Spatial Tracking', () => {
  const collector = ObservationCollector.getInstance();
  collector.reset();

  // Ingest unidentified red dots as anonymous contacts
  const contact1 = collector.observeAnonymousContact({
    id: 'anon_1',
    x: 1000,
    y: 1000,
    clockTime: 300,
    confidence: 0.75,
  }, 'radiant');

  assert.equal(contact1.id, 'anon_1');
  assert.equal(contact1.source, 'cv_minimap_dot');
  assert.equal(contact1.confidence, 0.75);
  assert.equal(contact1.freshness, 'fresh');
  assert.ok(contact1.zoneName);

  const contacts = collector.getAnonymousContacts();
  assert.equal(contacts.length, 1);
  assert.equal(contacts[0].id, 'anon_1');

  // Verify that anonymous contacts do NOT register as identified enemy heroes
  const heroes = collector.getObservationsRecord();
  assert.equal(Object.keys(heroes).length, 0);

  // Advancing clock by 15s marks contact as stale (>10s)
  collector.updateClock(315);
  const staleContacts = collector.getAnonymousContacts();
  assert.equal(staleContacts.length, 1);
  assert.equal(staleContacts[0].freshness, 'stale');

  // Advancing clock by >30s purges expired anonymous contacts
  collector.updateClock(335);
  const purgedContacts = collector.getAnonymousContacts();
  assert.equal(purgedContacts.length, 0);
});

test('AB. Epistemic Honesty: Missing Towers Are null and Roshan Is unknown', () => {
  const engine = new StateEngine();
  const rawEmptyBuildings: GsiRawPayload = {
    provider: { name: 'Dota 2', appid: 570, version: 1, timestamp: 100 },
    map: { clock_time: 50, game_state: 'DOTA_GAMERULES_STATE_GAME_IN_PROGRESS', daytime: true },
    player: { team_name: 'radiant', gold: 600, net_worth: 600 },
    hero: { xpos: 0, ypos: 0, alive: true },
    // No buildings object and no roshan_state provided
  };

  const processedState = new StateManager().update(rawEmptyBuildings);
  const worldModel = engine.process(rawEmptyBuildings, processedState);

  // Towers must be null (not 11) when data is missing from GSI
  assert.equal(worldModel.mapControl.towerDataAvailable, false);
  assert.equal(worldModel.mapControl.alliedTowersAlive, null);
  assert.equal(worldModel.mapControl.enemyTowersAlive, null);

  // Roshan must be 'unknown' and EpistemicStatus 'UNKNOWN'
  assert.equal(worldModel.mapControl.roshanStatus, 'unknown');
  assert.equal(worldModel.mapControl.roshanStatusEpistemic, 'UNKNOWN');
});

test('AC. Out-of-Order Clock Protection and Source Priority in ObservationCollector', () => {
  const collector = ObservationCollector.getInstance();
  collector.reset();

  // 1. High priority GSI observation at clock 500
  collector.observeEnemy({
    heroName: 'npc_dota_hero_axe',
    clockTime: 500,
    source: 'gsi',
    level: 10,
    items: ['item_blink'],
  });

  const axe = collector.getObservationsRecord()['npc_dota_hero_axe'];
  assert.equal(axe.lastSeenClockTime, 500);
  assert.equal(axe.observationSource, 'gsi');

  // 2. Out-of-order stale CV observation from clock 450 should be IGNORED
  collector.observeEnemy({
    heroName: 'npc_dota_hero_axe',
    clockTime: 450,
    source: 'cv',
    level: 9,
    items: [],
  });

  const axeAfterStale = collector.getObservationsRecord()['npc_dota_hero_axe'];
  assert.equal(axeAfterStale.lastSeenClockTime, 500);
  assert.equal(axeAfterStale.level, 10);
  assert.equal(axeAfterStale.observationSource, 'gsi');

  // 3. Lower priority source at same clock does not overwrite higher priority source
  collector.observeEnemy({
    heroName: 'npc_dota_hero_axe',
    clockTime: 500,
    source: 'inferred',
    level: 8,
    items: [],
  });
  const axePriority = collector.getObservationsRecord()['npc_dota_hero_axe'];
  assert.equal(axePriority.observationSource, 'gsi');
});

test('AD. Honest Financials: Unknown Items Return null and D2PT Freshness', () => {
  // Unknown item should return null instead of a fabricated 2000 gold
  const unknownCost = ItemIdentity.getItemCost('item_completely_unknown_imaginary_item');
  assert.equal(unknownCost, null);

  const blinkCost = ItemIdentity.getItemCost('item_blink');
  assert.equal(blinkCost, 2250);

  // D2PT recommendations distinguish fresh vs stale
  const meta = D2PTDataStore.getHeroMeta('npc_dota_hero_antimage');
  assert.ok(meta);
  const rec = D2PTDataStore.determineNextTargetItem('npc_dota_hero_antimage', [], 1000, 300);
  assert.equal(rec.recommendationSource, 'd2pt_fresh');
});

test('AE. CORS Origin URL Hostname Parsing Security', () => {
  const allowedOrigins = [
    'http://localhost:3000',
    'http://127.0.0.1:8080',
    'http://192.168.1.50:3000',
    'http://10.0.0.5:3000',
    'http://100.64.0.1:3000',
    'http://172.16.0.1:3000',
    'http://172.31.255.255:3000',
  ];

  const blockedOrigins = [
    'http://evil-localhost.com',
    'http://localhost.attacker.com',
    'http://192.168.1.50.attacker.com',
    'http://172.32.0.1:3000',
    'http://attacker.com',
  ];

  const isOriginAllowed = (origin: string): boolean => {
    try {
      const parsed = new URL(origin);
      const host = parsed.hostname;
      const isLocal = host === 'localhost' || host === '127.0.0.1' || host === '::1';
      const isPrivate10 = /^10\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.test(host);
      const isPrivate192 = /^192\.168\.(\d{1,3})\.(\d{1,3})$/.test(host);
      const isPrivate100 = /^100\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.test(host);
      const isPrivate172 = /^172\.(1[6-9]|2[0-9]|3[0-1])\.(\d{1,3})\.(\d{1,3})$/.test(host);
      return isLocal || isPrivate10 || isPrivate192 || isPrivate100 || isPrivate172;
    } catch {
      return false;
    }
  };

  for (const origin of allowedOrigins) {
    assert.equal(isOriginAllowed(origin), true, `Should allow valid origin: ${origin}`);
  }

  for (const origin of blockedOrigins) {
    assert.equal(isOriginAllowed(origin), false, `Should reject suspicious origin: ${origin}`);
  }
});



