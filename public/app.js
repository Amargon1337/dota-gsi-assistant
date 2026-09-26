// Dota 2 AI Tactical Co-Pilot Client (Shared World Model)
let ws = null;
let voiceEnabled = true;
let audioContext = null;
let lastSpokenThreatId = '';

// DOM Elements - Headers & Clock
const connStatus = document.getElementById('connStatus');
const statusDot = connStatus.querySelector('.status-dot');
const statusText = connStatus.querySelector('.status-text');
const gameClock = document.getElementById('gameClock');
const dayNightIcon = document.getElementById('dayNightIcon');
const dayNightCountdown = document.getElementById('dayNightCountdown');
const toggleMockBtn = document.getElementById('toggleMockBtn');
const toggleVoiceBtn = document.getElementById('toggleVoiceBtn');
const testVoiceBtn = document.getElementById('testVoiceBtn');
const alertBannerContainer = document.getElementById('alertBannerContainer');

// DOM Elements - Threat Alert Box (Leya System-1)
const threatAlertBox = document.getElementById('threatAlertBox');
const threatBadge = document.getElementById('threatBadge');
const threatTitle = document.getElementById('threatTitle');
const threatConfidenceVal = document.getElementById('threatConfidenceVal');
const threatConfFill = document.getElementById('threatConfFill');
const threatEvidenceList = document.getElementById('threatEvidenceList');
const threatActionText = document.getElementById('threatActionText');

// DOM Elements - Strategic Plan (Gemini System-2 ⇄ Leya)
const activeModelBadge = document.getElementById('activeModelBadge');
const planStatusBadge = document.getElementById('planStatusBadge');
const planPriorityTitle = document.getElementById('planPriorityTitle');
const planTargetItem = document.getElementById('planTargetItem');
const planAvoidZones = document.getElementById('planAvoidZones');
const planSafeZones = document.getElementById('planSafeZones');
const coachAdviceText = document.getElementById('coachAdviceText');
const askCoachQuickBtn = document.getElementById('askCoachQuickBtn');
const askCoachForm = document.getElementById('askCoachForm');
const coachQuestionInput = document.getElementById('coachQuestionInput');

// DOM Elements - Semantic Events
const eventStream = document.getElementById('eventStream');

// DOM Elements - Economy & Velocity
const netWorthVal = document.getElementById('netWorthVal');
const nwDiffVal = document.getElementById('nwDiffVal');
const benchmarkTag = document.getElementById('benchmarkTag');
const nwDelta5mVal = document.getElementById('nwDelta5mVal');
const goldVelocityVal = document.getElementById('goldVelocityVal');
const expectedNwVal = document.getElementById('expectedNwVal');
const gpmVal = document.getElementById('gpmVal');

// DOM Elements - AI Settings Modal
const openAiSettingsBtn = document.getElementById('openAiSettingsBtn');
const closeAiModalBtn = document.getElementById('closeAiModalBtn');
const aiSettingsModal = document.getElementById('aiSettingsModal');
const geminiApiKeyInput = document.getElementById('geminiApiKeyInput');
const toggleApiKeyVisibility = document.getElementById('toggleApiKeyVisibility');
const modelSelect = document.getElementById('modelSelect');
const customModelGroup = document.getElementById('customModelGroup');
const customModelInput = document.getElementById('customModelInput');
const autoCoachCheckbox = document.getElementById('autoCoachCheckbox');
const modalGeminiStatus = document.getElementById('modalGeminiStatus');
const modalLayaStatus = document.getElementById('modalLayaStatus');
const saveAiSettingsBtn = document.getElementById('saveAiSettingsBtn');
const dashboardTokenInput = document.getElementById('dashboardTokenInput');

// DOM Elements - Enemy Tracking & Day/Night
const dayNightStatusVal = document.getElementById('dayNightStatusVal');
const enemyTrackingContainer = document.getElementById('enemyTrackingContainer');
const enemyEmptyState = document.getElementById('enemyEmptyState');
const enemyCardsGrid = document.getElementById('enemyCardsGrid');
const enemyTrackCountBadge = document.getElementById('enemyTrackCountBadge');
const enemySetupInput = document.getElementById('enemySetupInput');
const enemySetupBtn = document.getElementById('enemySetupBtn');

window.spotEnemy = async function(heroName, zoneName) {
  try {
    await authFetch('/api/enemies/spot', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ heroName, zoneName }),
    });
  } catch (err) {
    console.error('Ошибка отметки врага:', err);
  }
};

window.toggleEnemyThreat = async function(heroName, threatKey, currentValue) {
  try {
    const body = { heroName };
    if (threatKey === 'blink') body.hasBlink = !currentValue;
    if (threatKey === 'bkb') body.hasBkb = !currentValue;
    if (threatKey === 'invis') body.hasShadowBlade = !currentValue;

    await authFetch('/api/enemies/spot', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (err) {
    console.error('Ошибка обновления угроз врага:', err);
  }
};

function getDashboardToken() {
  return localStorage.getItem('dota_dashboard_token') || '';
}

function setDashboardToken(token) {
  if (token) {
    localStorage.setItem('dota_dashboard_token', token.trim());
  } else {
    localStorage.removeItem('dota_dashboard_token');
  }
}

async function authFetch(url, options = {}) {
  const token = getDashboardToken();
  const headers = {
    ...(options.headers || {}),
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  return fetch(url, { ...options, headers });
}

function formatSeconds(secs) {
  if (secs === null || secs === undefined || isNaN(secs)) return '--:--';
  const m = Math.floor(secs / 60);
  const s = Math.abs(secs % 60);
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

function playChime(freq = 440, duration = 0.15) {
  try {
    if (!audioContext) {
      audioContext = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (audioContext.state === 'suspended') {
      audioContext.resume();
    }
    const osc = audioContext.createOscillator();
    const gain = audioContext.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, audioContext.currentTime);
    gain.gain.setValueAtTime(0.1, audioContext.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audioContext.currentTime + duration);
    osc.connect(gain);
    gain.connect(audioContext.destination);
    osc.start();
    osc.stop(audioContext.currentTime + duration);
  } catch (e) {}
}

function speakText(text) {
  if (!voiceEnabled || !window.speechSynthesis) return;

  playChime(660, 0.1);
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = 'ru-RU';
  utterance.rate = 1.05;
  utterance.pitch = 1.1;

  const voices = window.speechSynthesis.getVoices();
  const ruFemaleVoice = voices.find(v => v.lang.startsWith('ru') && (
    v.name.toLowerCase().includes('female') ||
    v.name.toLowerCase().includes('женск') ||
    v.name.toLowerCase().includes('svetlana') ||
    v.name.toLowerCase().includes('tatyana') ||
    v.name.toLowerCase().includes('milena') ||
    v.name.toLowerCase().includes('victoria') ||
    v.name.toLowerCase().includes('irina') ||
    v.name.toLowerCase().includes('alisa') ||
    v.name.toLowerCase().includes('alysa') ||
    v.name.toLowerCase().includes('google русский')
  ));
  const ruVoice = ruFemaleVoice || voices.find(v => v.lang.startsWith('ru'));
  if (ruVoice) utterance.voice = ruVoice;

  window.speechSynthesis.speak(utterance);
}

document.body.addEventListener('click', () => {
  if (!audioContext) {
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (audioContext && audioContext.state === 'suspended') {
    audioContext.resume();
  }
}, { once: true });

function connectWebSocket() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const token = getDashboardToken();
  const wsUrl = `${protocol}//${window.location.host}/ws`;

  // Prefer Sec-WebSocket-Protocol ['dota-auth', token] so credentials are in headers, not exposed in query URL
  try {
    ws = token ? new WebSocket(wsUrl, ['dota-auth', token]) : new WebSocket(wsUrl);
  } catch (err) {
    ws = new WebSocket(`${wsUrl}?token=${encodeURIComponent(token)}`);
  }

  ws.onopen = () => {
    statusDot.className = 'status-dot connected';
    statusText.textContent = 'Подключено к World Model';
  };

  ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);

      if (data.type === 'STATE_UPDATE') {
        if (data.mockActive) {
          toggleMockBtn.classList.add('active');
          toggleMockBtn.textContent = '🧪 Стоп Демо';
        } else {
          toggleMockBtn.classList.remove('active');
          toggleMockBtn.textContent = '🧪 Демо-режим';
        }
        if (data.worldModel) {
          renderWorldModel(data.worldModel);
        }
      } else if (data.type === 'WORLD_MODEL_UPDATE') {
        renderWorldModel(data.model);
      } else if (data.type === 'ITEM_SPIKE') {
        handleItemSpike(data);
      } else if (data.type === 'LEVEL_SPIKE') {
        handleLevelSpike(data);
      } else if (data.type === 'STRATEGIC_PLAN') {
        renderStrategicPlan(data.planData);
      } else if (data.type === 'SEMANTIC_EVENT') {
        prependSemanticEvent(data.event);
      } else if (data.type === 'VOICE_ALERT') {
        playNeuralVoice(data.alert.text);
      }
    } catch (e) {
      console.error('Ошибка WebSocket message:', e);
    }
  };

  ws.onclose = (event) => {
    statusDot.className = 'status-dot';
    if (event.code === 4401) {
      statusText.textContent = 'Ошибка: неверный Dashboard токен';
    } else {
      statusText.textContent = 'Переподключение к World Model...';
    }
    setTimeout(connectWebSocket, 2000);
  };
}

// Render Shared World Model
function renderWorldModel(model) {
  if (!model) return;

  // 1. Meta & Clock
  if (model.meta) {
    gameClock.textContent = model.meta.formattedClock || '00:00';
    if (model.meta.isDaytime) {
      dayNightIcon.textContent = '☀️';
      dayNightCountdown.textContent = `ночь через ${formatSeconds(model.meta.dayNightCountdown)}`;
      if (dayNightStatusVal) dayNightStatusVal.textContent = '☀️ День (обзор 1800)';
    } else {
      dayNightIcon.textContent = '🌙';
      dayNightCountdown.textContent = `день через ${formatSeconds(model.meta.dayNightCountdown)}`;
      if (dayNightStatusVal) dayNightStatusVal.textContent = '🌙 Ночь (обзор 800 - высокий риск)';
    }
  }

  // 2. Economy & True Net Worth
  if (model.player) {
    const p = model.player;
    const nw = p.networth || p.gold || 0;
    netWorthVal.textContent = nw.toLocaleString();
  }

  // 3. Trends & Economic Velocity
  if (model.trends) {
    const t = model.trends;
    const nwDelta = t.networthDelta5m || 0;
    nwDelta5mVal.textContent = `${nwDelta >= 0 ? '+' : ''}${nwDelta.toLocaleString()}g`;
    goldVelocityVal.textContent = `${t.estimatedFarmVelocityPerSec ?? t.goldVelocityPerSec ?? 0} g/s`;
    expectedNwVal.textContent = `${(t.expectedNetworthBenchmark || t.estimatedNetworthReference || 0).toLocaleString()}g`;
    gpmVal.textContent = `${t.goldPerMinute || 0}`;

    const nwDiff = t.networthDifference ?? 0;
    if (nwDiff >= 0) {
      nwDiffVal.textContent = `+${nwDiff.toLocaleString()}g (в темпе)`;
      nwDiffVal.style.color = '#7bed9f';
      nwDiffVal.style.borderColor = '#2ecc71';
      benchmarkTag.textContent = 'ТЕМП ВЫШЕ ЭТАЛОНА';
      benchmarkTag.style.color = '#7bed9f';
    } else {
      nwDiffVal.textContent = `${nwDiff.toLocaleString()}g (отставание)`;
      nwDiffVal.style.color = '#ff6b81';
      nwDiffVal.style.borderColor = '#ff4757';
      benchmarkTag.textContent = 'ОТСТАВАНИЕ ОТ ЭТАЛОНА';
      benchmarkTag.style.color = '#ff6b81';
    }
  }

  // 4. Enemy Memory & Intelligence (Где и когда был враг)
  renderEnemies(model.enemies);

  // 5. Threat Evaluation & Tactical Action State (NOW / WHY / UNTIL)
  if (model.threats && model.threats.length > 0) {
    const topThreat = model.threats[0];
    threatAlertBox.style.display = 'block';
    threatBadge.textContent = topThreat.level.toUpperCase();
    threatTitle.textContent = topThreat.title;
    const score = topThreat.riskScore ?? topThreat.confidence ?? 0.5;
    const pct = Math.round(score * 100);
    threatConfidenceVal.textContent = `${pct}%`;
    threatConfFill.style.width = `${pct}%`;

    const actionState = model.tacticalActionState;
    if (actionState) {
      threatActionText.textContent = `${actionState.now}: ${topThreat.recommendedAction} (Цель: ${actionState.until})`;
    } else {
      threatActionText.textContent = topThreat.recommendedAction;
    }

    threatEvidenceList.innerHTML = '';
    (actionState?.why || topThreat.evidence).forEach(ev => {
      const tag = document.createElement('span');
      tag.className = 'evidence-tag';
      tag.textContent = `✔ ${ev}`;
      threatEvidenceList.appendChild(tag);
    });

    if (topThreat.id !== lastSpokenThreatId && score >= 0.75) {
      lastSpokenThreatId = topThreat.id;
      playNeuralVoice(`${topThreat.title}. ${topThreat.recommendedAction}`);
    }
  } else {
    threatAlertBox.style.display = 'none';
  }

  // 6. Active Strategic Plan (Gemini System-2 ⇄ D2PT)
  if (model.strategy?.activePlan) {
    const plan = model.strategy.activePlan;
    planPriorityTitle.textContent = plan.priority.toUpperCase();
    planTargetItem.textContent = `${plan.targetItem} (нужно ${plan.goldNeededForItem.toLocaleString()}g)`;
    planAvoidZones.textContent = plan.avoidZones.join(', ') || 'Нет';
    planSafeZones.textContent = plan.safeZones.join(', ') || 'Свой лес, база';

    if (plan.status === 'completed') {
      planStatusBadge.className = 'plan-status-badge active';
      planStatusBadge.style.borderColor = '#f6c042';
      planStatusBadge.style.color = '#f6c042';
      planStatusBadge.textContent = 'ЦЕЛЬ ВЫПОЛНЕНА 🎯';
    } else if (plan.status === 'violated') {
      planStatusBadge.className = 'plan-status-badge violated';
      planStatusBadge.textContent = '⚠️ ПЛАН НАРУШЕН (ОПАСНАЯ ЗОНА)';
    } else {
      planStatusBadge.className = 'plan-status-badge active';
      planStatusBadge.textContent = 'СОБЛЮДАЕТСЯ ✅';
    }

    if (plan.guidanceText) {
      coachAdviceText.textContent = plan.guidanceText;
    }
  }

  // 7. Event Stream
  if (model.recentEvents && model.recentEvents.length > 0) {
    eventStream.innerHTML = '';
    model.recentEvents.slice(0, 10).forEach(ev => {
      const row = document.createElement('div');
      row.className = `event-row ${ev.severity}`;
      row.innerHTML = `
        <span class="event-time">${ev.formattedTime}</span>
        <span class="event-desc">${ev.description}</span>
      `;
      eventStream.appendChild(row);
    });
  }
}

// 4. Render Enemy Tracking Cards (OBSERVED / INFERRED / UNKNOWN)
function renderEnemies(enemiesRecord) {
  if (!enemyCardsGrid || !enemyEmptyState || !enemyTrackCountBadge) return;

  const enemies = enemiesRecord ? Object.values(enemiesRecord) : [];
  enemyTrackCountBadge.textContent = `${enemies.length} ${enemies.length === 1 ? 'враг' : 'врагов'}`;

  if (enemies.length === 0) {
    enemyEmptyState.style.display = 'block';
    enemyCardsGrid.style.display = 'none';
    return;
  }

  enemyEmptyState.style.display = 'none';
  enemyCardsGrid.style.display = 'grid';
  enemyCardsGrid.innerHTML = '';

  // Sort: observed (fresh) -> inferred (stale) -> unknown (expired)
  enemies.sort((a, b) => {
    const scoreA = a.freshness === 'fresh' ? 3 : a.freshness === 'stale' ? 2 : 1;
    const scoreB = b.freshness === 'fresh' ? 3 : b.freshness === 'stale' ? 2 : 1;
    if (scoreA !== scoreB) return scoreB - scoreA;
    return (a.missingDurationSeconds || 0) - (b.missingDurationSeconds || 0);
  });

  for (const e of enemies) {
    const card = document.createElement('div');
    const freshness = e.freshness || 'unknown';
    card.className = `enemy-card ${freshness}`;

    let statusLabel = 'UNKNOWN';
    let statusClass = 'unknown';
    let timeText = 'В тумане войны';

    if (freshness === 'fresh') {
      statusLabel = 'OBSERVED';
      statusClass = 'observed';
      timeText = (e.missingDurationSeconds || 0) < 3 ? '⚡ На карте прямо сейчас' : `⏱️ Замечен ${e.missingDurationSeconds}с назад`;
    } else if (freshness === 'stale') {
      statusLabel = 'INFERRED';
      statusClass = 'inferred';
      timeText = `⏱️ Пропал ${e.missingDurationSeconds}с назад`;
    } else {
      statusLabel = 'UNKNOWN';
      statusClass = 'unknown';
      timeText = e.missingDurationSeconds ? `⏱️ Нет вижена >${e.missingDurationSeconds}с` : 'Точная позиция неизвестна';
    }

    const zone = e.lastKnownLocation?.zoneName || 'Неизвестно';
    const rawHeroName = e.name || '';
    const cleanHeroName = e.heroNameClean || e.name;
    const cleanHeroKey = rawHeroName.replace('npc_dota_hero_', '').toLowerCase();
    const hasBlink = Boolean(e.hasBlink);
    const hasBkb = Boolean(e.hasBkb);

    const lvl = e.level || 1;
    const lvlBadge = lvl >= 6
      ? `<span class="lvl-spike-badge" title="Доступен ультимейт">⚡ Lvl ${lvl}</span>`
      : `<small style="color: #a4b0be; font-size: 11px;">(Lvl ${lvl})</small>`;

    const inventoryHtml = renderInventorySlots(e.items);

    card.innerHTML = `
      <div class="enemy-card-header">
        <div style="display: flex; align-items: center; gap: 6px;">
          <img src="/data/hero_icons/${cleanHeroKey}.png" onerror="this.style.display='none'" style="width: 20px; height: 20px; border-radius: 50%;" />
          <span class="enemy-hero-name">${cleanHeroName}</span>
          ${lvlBadge}
        </div>
        <span class="enemy-status-badge ${statusClass}">${statusLabel}</span>
      </div>
      <div class="enemy-card-location">
        <span>Зона:</span>
        <span class="zone-tag">📍 ${zone}</span>
      </div>
      <div class="enemy-card-time">${timeText}</div>
      <div class="enemy-inventory-grid">
        ${inventoryHtml}
      </div>
      <div class="enemy-spot-actions">
        <span class="spot-title">Отметить позицию:</span>
        <div class="spot-buttons-row">
          <button class="btn-spot" onclick="window.spotEnemy('${rawHeroName}', 'Река')">Река</button>
          <button class="btn-spot" onclick="window.spotEnemy('${rawHeroName}', 'Мид')">Мид</button>
          <button class="btn-spot" onclick="window.spotEnemy('${rawHeroName}', 'Треугольник')">Треугольник</button>
          <button class="btn-spot" onclick="window.spotEnemy('${rawHeroName}', 'Рошан')">Рошан</button>
          <button class="btn-spot" onclick="window.spotEnemy('${rawHeroName}', 'Лес')">Лес</button>
          <button class="btn-threat-pill ${hasBlink ? 'active' : ''}" onclick="window.toggleEnemyThreat('${rawHeroName}', 'blink', ${hasBlink})">⚡ Blink</button>
          <button class="btn-threat-pill ${hasBkb ? 'active' : ''}" onclick="window.toggleEnemyThreat('${rawHeroName}', 'bkb', ${hasBkb})">🛡️ BKB</button>
        </div>
      </div>
    `;

    enemyCardsGrid.appendChild(card);
  }
}

// Critical Threat Items Catalog for client-side highlighting
const CRITICAL_THREAT_ITEMS = new Set([
  'sheepstick', 'abyssal_blade', 'bloodthorn', 'orchid', 'blink',
  'swift_blink', 'arcane_blink', 'overwhelming_blink', 'invis_sword',
  'silver_edge', 'rapier'
]);
const HIGH_THREAT_ITEMS = new Set([
  'black_king_bar', 'aeon_disk', 'wind_waker', 'cyclone', 'sphere',
  'lotus_orb', 'gleipnir', 'rod_of_atos', 'diffusal_blade', 'disperser',
  'heavens_halberd', 'nullifier', 'basher', 'radiance', 'refresher', 'spirit_vessel'
]);

function renderInventorySlots(items) {
  const safeItems = Array.isArray(items) ? items : [];
  let html = '';
  for (let i = 0; i < 6; i++) {
    const raw = safeItems[i];
    if (raw) {
      const clean = String(raw).toLowerCase().replace(/^item_/, '').trim();
      let threatClass = '';
      if (CRITICAL_THREAT_ITEMS.has(clean)) {
        threatClass = 'threat-critical';
      } else if (HIGH_THREAT_ITEMS.has(clean)) {
        threatClass = 'threat-high';
      }
      const displayName = clean.replace(/_/g, ' ');
      html += `
        <div class="item-slot ${threatClass}" title="${displayName}">
          <img src="/data/item_icons/${clean}.png" onerror="this.style.display='none'" alt="${displayName}" />
        </div>
      `;
    } else {
      html += `<div class="item-slot empty" title="Пустой слот"></div>`;
    }
  }
  return html;
}

// Neural Voice Player (Edge-TTS via server proxy, with instant Web Speech fallback)
async function playNeuralVoice(text) {
  if (!voiceEnabled || !text) return;

  try {
    const res = await authFetch('/api/tts/speak', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, voice: 'ru-RU-SvetlanaNeural' }),
    });
    if (res.ok) {
      const data = await res.json();
      if (data.audioUrl) {
        const audio = new Audio(data.audioUrl);
        audio.play().catch(() => speakText(text));
        return;
      }
    }
  } catch (err) {
    console.warn('[Neural TTS Fallback to WebSpeech]', err);
  }

  // Fallback to offline Web Speech API
  speakText(text);
}

function handleItemSpike(spike) {
  const bannerContainer = document.getElementById('alertBannerContainer');
  if (bannerContainer) {
    const banner = document.createElement('div');
    banner.className = 'alert-banner threat-banner-spike';
    banner.innerHTML = `
      <div style="display: flex; align-items: center; gap: 8px;">
        <span style="font-size: 20px;">⚠️</span>
        <div>
          <strong style="color: #ff4757; text-transform: uppercase;">[${spike.severity || 'КРИТИЧЕСКИЙ'}] АРТЕФАКТ:</strong>
          У <strong>${spike.heroName}</strong> появился <strong>${spike.itemName}</strong>!
          <div style="font-size: 11px; color: #dfe4ea; margin-top: 2px;">💡 ${spike.counterAdvice}</div>
        </div>
      </div>
    `;
    bannerContainer.prepend(banner);
    setTimeout(() => banner.remove(), 12000);
  }

  const voiceMsg = `Внимание! У ${spike.heroName} готов ${spike.itemName}! ${spike.counterAdvice}`;
  playNeuralVoice(voiceMsg);

  prependSemanticEvent({
    type: 'ENEMY_ITEM_POWER_SPIKE',
    category: 'threat',
    description: `Враг ${spike.heroName} приобрёл ${spike.itemName}: ${spike.counterAdvice}`,
    severity: spike.severity === 'CRITICAL' ? 'critical' : 'warning',
    gameTime: spike.clockTime || 0,
  });
}

function handleLevelSpike(spike) {
  const bannerContainer = document.getElementById('alertBannerContainer');
  if (bannerContainer) {
    const banner = document.createElement('div');
    banner.className = 'alert-banner';
    banner.style.border = '1px solid #f1c40f';
    banner.style.background = 'rgba(241, 196, 15, 0.15)';
    banner.innerHTML = `
      <div style="display: flex; align-items: center; gap: 8px;">
        <span style="font-size: 20px;">⚡</span>
        <div>
          <strong style="color: #f1c40f;">СПАЙК УРОВНЯ:</strong>
          ${spike.callout}
        </div>
      </div>
    `;
    bannerContainer.prepend(banner);
    setTimeout(() => banner.remove(), 10000);
  }

  playNeuralVoice(spike.callout);

  prependSemanticEvent({
    type: 'ENEMY_LEVEL_SPIKE',
    category: 'threat',
    description: spike.callout,
    severity: 'warning',
    gameTime: spike.clockTime || 0,
  });
}

function renderStrategicPlan(planData) {
  if (!planData || !planData.plan) return;
  const plan = planData.plan;
  planPriorityTitle.textContent = plan.priority.toUpperCase();
  planTargetItem.textContent = `${plan.targetItem} (нужно ${plan.goldNeededForItem.toLocaleString()}g)`;
  planAvoidZones.textContent = plan.avoidZones.join(', ');
  planSafeZones.textContent = plan.safeZones.join(', ');
  planStatusBadge.className = 'plan-status-badge active';
  planStatusBadge.textContent = 'СОБЛЮДАЕТСЯ ✅';

  if (planData.guidanceText) {
    coachAdviceText.textContent = planData.guidanceText;
    const voiceMsg = `${plan.priority}. Цель: ${plan.targetItem}.`;
    playNeuralVoice(voiceMsg);
  }
}

function prependSemanticEvent(ev) {
  const row = document.createElement('div');
  row.className = `event-row ${ev.severity}`;
  row.innerHTML = `
    <span class="event-time">${ev.formattedTime}</span>
    <span class="event-desc">${ev.description}</span>
  `;
  eventStream.insertBefore(row, eventStream.firstChild);
  if (eventStream.children.length > 12) {
    eventStream.removeChild(eventStream.lastChild);
  }
}

// Ask Coach Action
async function askCoach(question = '') {
  coachAdviceText.textContent = '⏳ Gemini формирует стратегический план...';
  try {
    const res = await authFetch('/api/ai/ask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question }),
    });
    const data = await res.json();
    if (data.success && data.plan) {
      renderStrategicPlan({ plan: data.plan, guidanceText: data.guidanceText });
    } else {
      coachAdviceText.textContent = data.guidanceText || 'Ошибка формирования плана.';
    }
  } catch (err) {
    coachAdviceText.textContent = 'Сетевая ошибка связи с сервером.';
  }
}

askCoachQuickBtn.addEventListener('click', () => {
  askCoach('Сформируй обновленный стратегический план и приоритет на ближайшие минуты.');
});

askCoachForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const q = coachQuestionInput.value.trim();
  if (q) {
    askCoach(q);
    coachQuestionInput.value = '';
  }
});

// AI Settings Modal
async function loadAiConfig() {
  try {
    if (dashboardTokenInput) {
      dashboardTokenInput.value = getDashboardToken();
    }
    const res = await authFetch('/api/ai/config');
    const cfg = await res.json();
    if (cfg.geminiApiKey) {
      geminiApiKeyInput.value = cfg.geminiApiKey;
      modalGeminiStatus.className = 'status-badge-on';
      modalGeminiStatus.textContent = 'Подключено';
    }
    activeModelBadge.textContent = cfg.geminiModel;

    const matchedOpt = Array.from(modelSelect.options).find(o => o.value === cfg.geminiModel);
    if (matchedOpt) {
      modelSelect.value = cfg.geminiModel;
      customModelGroup.style.display = 'none';
    } else {
      modelSelect.value = 'custom';
      customModelGroup.style.display = 'flex';
      customModelInput.value = cfg.geminiModel;
    }
    autoCoachCheckbox.checked = cfg.autoCoachEnabled;
  } catch (e) {}
}

openAiSettingsBtn.addEventListener('click', () => {
  loadAiConfig();
  aiSettingsModal.classList.add('open');
});

closeAiModalBtn.addEventListener('click', () => {
  aiSettingsModal.classList.remove('open');
});

saveAiSettingsBtn.addEventListener('click', async () => {
  const apiKey = geminiApiKeyInput.value.trim();
  const selectedModel = modelSelect.value === 'custom'
    ? customModelInput.value.trim() || 'gemini-2.0-flash-lite'
    : modelSelect.value;
  const autoCoach = autoCoachCheckbox.checked;

  if (dashboardTokenInput && dashboardTokenInput.value.trim()) {
    setDashboardToken(dashboardTokenInput.value.trim());
  }

  try {
    const res = await authFetch('/api/ai/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        geminiApiKey: apiKey,
        geminiModel: selectedModel,
        autoCoachEnabled: autoCoach,
      }),
    });
    const result = await res.json();
    if (result.success) {
      activeModelBadge.textContent = result.geminiModel;
      aiSettingsModal.classList.remove('open');
      speakText('Настройки сохранены');
    }
  } catch (e) {
    alert('Ошибка сохранения настроек AI.');
  }
});

toggleMockBtn.addEventListener('click', async () => {
  try {
    const res = await authFetch('/api/mock/toggle', { method: 'POST' });
    const data = await res.json();
    if (data.mockActive) {
      toggleMockBtn.classList.add('active');
      toggleMockBtn.textContent = '🧪 Стоп Демо';
    } else {
      toggleMockBtn.classList.remove('active');
      toggleMockBtn.textContent = '🧪 Демо-режим';
    }
  } catch (e) {}
});

toggleVoiceBtn.addEventListener('click', () => {
  voiceEnabled = !voiceEnabled;
  toggleVoiceBtn.classList.toggle('active', voiceEnabled);
  toggleVoiceBtn.textContent = voiceEnabled ? '🔊 Голос: ВКЛ' : '🔇 Голос: ВЫКЛ';
});

testVoiceBtn.addEventListener('click', () => {
  playNeuralVoice('Тест Леи. Голосовой ассистент активен. Все системы работают в штатном режиме.');
});

if (enemySetupBtn && enemySetupInput) {
  enemySetupBtn.addEventListener('click', async () => {
    const text = enemySetupInput.value.trim();
    if (!text) return;
    const heroes = text.split(/[,;]+/).map(s => s.trim()).filter(Boolean);
    if (heroes.length === 0) return;

    try {
      await authFetch('/api/enemies/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ heroes }),
      });
      enemySetupInput.value = '';
    } catch (err) {
      console.error('Ошибка добавления врагов:', err);
    }
  });

  enemySetupInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      enemySetupBtn.click();
    }
  });
}

// Initialize
connectWebSocket();
loadAiConfig();

// Poll Vision Agent Status
async function updateVisionStatus() {
  const badge = document.getElementById('visionStatusBadge');
  const dot = document.getElementById('visionDot');
  const text = document.getElementById('visionStatusText');
  if (!badge || !dot || !text) return;

  try {
    const res = await authFetch('/api/vision/status');
    const data = await res.json();
    if (data.serviceRunning) {
      dot.style.background = '#2ecc71';
      dot.style.boxShadow = '0 0 8px #2ecc71';
      const dotaState = data.dotaFound ? 'Dota 2 окно' : 'Экран';
      const enemyInfo = data.cvEnemiesCount > 0 ? ` • ${data.cvEnemiesCount} врагов` : '';
      text.textContent = `👁️ Vision: АКТИВЕН (${data.fps} FPS) [${dotaState}${enemyInfo}]`;
      text.style.color = '#2ecc71';
    } else {
      dot.style.background = '#e67e22';
      dot.style.boxShadow = 'none';
      text.textContent = '👁️ Vision: Ожидание подключения...';
      text.style.color = '#e67e22';
    }
  } catch (e) {
    if (dot) dot.style.background = '#7f8c8d';
    if (text) {
      text.textContent = '👁️ Vision: Оффлайн';
      text.style.color = '#95a5a6';
    }
  }
}

setInterval(updateVisionStatus, 2500);
updateVisionStatus();

