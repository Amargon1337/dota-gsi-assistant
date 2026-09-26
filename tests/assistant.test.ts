import test from 'node:test';
import assert from 'node:assert/strict';

import { classifyMapZone, parseTowerCounts, StateEngine } from '../src/engine/state-engine';
import { D2PTDataStore } from '../src/engine/d2pt-store';
import { GeminiBudgetManager } from '../src/ai/gemini-budget-manager';
import { StateManager } from '../src/gsi/state-manager';
import { GsiRawPayload } from '../src/types/gsi';

test('1. Map Zone Classification (Allegiance, Kind, Risk)', () => {
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

test('2. Tower Counting Parser', () => {
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

test('3. Roshan State Synchronization', () => {
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

test('4. D2PT Resolver & Anti-Duplicate Protection (7.41f)', () => {
  D2PTDataStore.loadAllMetaFiles();
  const meta = D2PTDataStore.getHeroMeta('juggernaut');
  assert.equal(meta.hero, 'Juggernaut');
  assert.equal(meta.patch, '7.41f');
  assert.ok(meta.coreBuild.length >= 4);

  // If player owns Phase Boots and Battle Fury, next should be Manta Style
  const res1 = D2PTDataStore.determineNextTargetItem(
    'juggernaut',
    ['item_phase_boots', 'item_battlefury'],
    2000,
    900
  );
  assert.equal(res1.targetItem.cleanName, 'Manta Style');
  assert.ok(res1.alreadyPurchased.includes('Power Treads')); // Phase Boots satisfied boots
  assert.ok(res1.alreadyPurchased.includes('Battle Fury'));

  // If player already has BKB, it must NEVER recommend BKB
  const isBkbPurchased = D2PTDataStore.isItemPurchased('black_king_bar', ['item_black_king_bar']);
  assert.equal(isBkbPurchased, true);

  const isBkbPurchasedByShortName = D2PTDataStore.isItemPurchased('bkb', ['black_king_bar']);
  assert.equal(isBkbPurchasedByShortName, true);
});

test('5. Gemini Budget Manager (RPM & RPD limits)', () => {
  const bm = GeminiBudgetManager.getInstance();
  bm.setLimits(3, 10);

  const status1 = bm.checkBudget();
  assert.equal(status1.allowed, true);

  bm.recordUsage();
  bm.recordUsage();
  bm.recordUsage();

  const statusBlocked = bm.checkBudget();
  assert.equal(statusBlocked.allowed, false);
  assert.ok(statusBlocked.reason?.includes('RPM'));

  // Reset limits to standard
  bm.setLimits(15, 500);
});

test('6. Enemy Observation & Freshness Classification', () => {
  const engine = new StateEngine();
  const manager = new StateManager();

  engine.registerEnemySighting(
    'npc_dota_hero_lion',
    2500,
    2200,
    ['item_tranquil_boots', 'item_blink'],
    9,
    300,
    'gsi',
    0.95
  );

  const rawState: GsiRawPayload = {
    map: { clock_time: 310, game_state: 'DOTA_GAMERULES_STATE_GAME_IN_PROGRESS' },
    player: { team_name: 'radiant', gold: 1000 },
    hero: { alive: true },
  };

  manager.update(rawState);
  const model = engine.process(rawState, manager.getLatestState());

  const enemy = model.enemies['npc_dota_hero_lion'];
  assert.ok(enemy);
  assert.equal(enemy.observationSource, 'gsi');
  assert.equal(enemy.missingDurationSeconds, 10);
  assert.equal(enemy.freshness, 'fresh');
  assert.equal(enemy.hasBlink, true);
});
