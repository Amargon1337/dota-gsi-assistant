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

// DOM Elements - Buyback
const buybackWidget = document.getElementById('buybackWidget');
const bbStatusText = document.getElementById('bbStatusText');
const bbBadge = document.getElementById('bbBadge');
const bbCostVal = document.getElementById('bbCostVal');
const currentGoldVal = document.getElementById('currentGoldVal');
const bbSurplusVal = document.getElementById('bbSurplusVal');

// DOM Elements - Map Intelligence & Zone Safety
const currentZoneVal = document.getElementById('currentZoneVal');
const zoneRiskBadge = document.getElementById('zoneRiskBadge');
const safeZonesList = document.getElementById('safeZonesList');
const dangerZonesList = document.getElementById('dangerZonesList');
const towersStatusVal = document.getElementById('towersStatusVal');
const dayNightStatusVal = document.getElementById('dayNightStatusVal');

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

function getDashboardToken() {
  return localStorage.getItem('dota_dashboard_token') || 'dashboard_secret_pass';
}

function setDashboardToken(token) {
  if (token) {
    localStorage.setItem('dota_dashboard_token', token.trim());
  }
}

async function authFetch(url, options = {}) {
  const token = getDashboardToken();
  const headers = {
    ...(options.headers || {}),
    'Authorization': `Bearer ${token}`,
  };

  const response = await fetch(url, { ...options, headers });
  if (response.status === 401) {
    const entered = prompt('Требуется токен авторизации (DASHBOARD_AUTH_TOKEN):', token);
    if (entered) {
      setDashboardToken(entered);
      headers['Authorization'] = `Bearer ${getDashboardToken()}`;
      return fetch(url, { ...options, headers });
    }
  }
  return response;
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
  utterance.pitch = 1.0;

  const voices = window.speechSynthesis.getVoices();
  const ruVoice = voices.find(v => v.lang.startsWith('ru'));
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
  const token = encodeURIComponent(getDashboardToken());
  const wsUrl = `${protocol}//${window.location.host}/ws?token=${token}`;

  ws = new WebSocket(wsUrl);

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
      } else if (data.type === 'STRATEGIC_PLAN') {
        renderStrategicPlan(data.planData);
      } else if (data.type === 'SEMANTIC_EVENT') {
        prependSemanticEvent(data.event);
      } else if (data.type === 'VOICE_ALERT') {
        speakText(data.alert.text);
      }
    } catch (e) {
      console.error('Ошибка WebSocket message:', e);
    }
  };

  ws.onclose = (event) => {
    statusDot.className = 'status-dot';
    if (event.code === 4401) {
      statusText.textContent = 'Ошибка: неверный Dashboard токен';
      const entered = prompt('Токен авторизации дашборда не подошел. Введите верный DASHBOARD_AUTH_TOKEN:');
      if (entered) {
        setDashboardToken(entered);
      }
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
    gameClock.textContent = model.meta.formattedClock;
    if (model.meta.isDaytime) {
      dayNightIcon.textContent = '☀️';
      dayNightCountdown.textContent = `ночь через ${formatSeconds(model.meta.dayNightCountdown)}`;
      dayNightStatusVal.textContent = '☀️ День (обзор 1800)';
    } else {
      dayNightIcon.textContent = '🌙';
      dayNightCountdown.textContent = `день через ${formatSeconds(model.meta.dayNightCountdown)}`;
      dayNightStatusVal.textContent = '🌙 Ночь (обзор 800 - высокий риск)';
    }
  }

  // 2. Economy & True Net Worth
  if (model.player) {
    const p = model.player;
    const nw = p.networth || p.gold || 0;
    netWorthVal.textContent = nw.toLocaleString();
    currentGoldVal.textContent = `${(p.gold || 0).toLocaleString()}g`;

    // Buyback metrics
    if (p.buyback) {
      bbCostVal.textContent = `${(p.buyback.cost || 0).toLocaleString()}g`;
      if (p.buyback.cooldown > 0) {
        buybackWidget.className = 'buyback-widget';
        bbBadge.textContent = `ОТКАТ ${p.buyback.cooldown}s`;
        bbStatusText.textContent = 'ВЫКУП НА КУЛДАУНЕ';
        bbSurplusVal.textContent = `${p.buyback.surplus >= 0 ? '+' : ''}${(p.buyback.surplus || 0).toLocaleString()}g`;
      } else if (p.buyback.canBuyback) {
        buybackWidget.className = 'buyback-widget ready';
        bbBadge.textContent = 'ГОТОВ';
        bbStatusText.textContent = 'ВЫКУП ДОСТУПЕН';
        bbSurplusVal.textContent = `+${(p.buyback.surplus || 0).toLocaleString()}g`;
      } else {
        buybackWidget.className = 'buyback-widget deficit';
        bbBadge.textContent = 'НЕ ХВАТАЕТ';
        bbStatusText.textContent = 'НЕТ ДЕНЕГ НА ВЫКУП';
        bbSurplusVal.textContent = `${(p.buyback.surplus || 0).toLocaleString()}g`;
      }
    }

    // Map position & current zone
    if (p.currentZone) {
      currentZoneVal.textContent = p.currentZone;
      const zLow = p.currentZone.toLowerCase();
      if (zLow.includes('enemy') || zLow.includes('river') || zLow.includes('roshan')) {
        zoneRiskBadge.className = 'zone-risk-badge danger';
        zoneRiskBadge.textContent = 'ОПАСНАЯ ЗОНА ⚠️';
      } else if (zLow.includes('lane') || zLow.includes('neutral')) {
        zoneRiskBadge.className = 'zone-risk-badge caution';
        zoneRiskBadge.textContent = 'ОСТОРОЖНО ⚠️';
      } else {
        zoneRiskBadge.className = 'zone-risk-badge safe';
        zoneRiskBadge.textContent = 'БЕЗОПАСНО ✅';
      }
    }
  }

  // 3. Trends & Economic Velocity
  if (model.trends) {
    const t = model.trends;
    nwDelta5mVal.textContent = `${t.networthDelta5m >= 0 ? '+' : ''}${t.networthDelta5m.toLocaleString()}g`;
    goldVelocityVal.textContent = `${t.estimatedFarmVelocityPerSec ?? t.goldVelocityPerSec ?? 0} g/s`;
    expectedNwVal.textContent = `${t.expectedNetworthBenchmark.toLocaleString()}g`;
    gpmVal.textContent = `${t.goldPerMinute || 0}`;

    if (t.networthDifference >= 0) {
      nwDiffVal.textContent = `+${t.networthDifference.toLocaleString()}g (в темпе)`;
      nwDiffVal.style.color = '#7bed9f';
      nwDiffVal.style.borderColor = '#2ecc71';
      benchmarkTag.textContent = 'ТЕМП ВЫШЕ ЭТАЛОНА';
      benchmarkTag.style.color = '#7bed9f';
    } else {
      nwDiffVal.textContent = `${t.networthDifference.toLocaleString()}g (отставание)`;
      nwDiffVal.style.color = '#ff6b81';
      nwDiffVal.style.borderColor = '#ff4757';
      benchmarkTag.textContent = 'ОТСТАВАНИЕ ОТ ЭТАЛОНА';
      benchmarkTag.style.color = '#ff6b81';
    }
  }

  // 4. Map Control & Towers
  if (model.mapControl) {
    const mc = model.mapControl;
    towersStatusVal.textContent = `${mc.alliedTowersAlive ?? 11} / ${mc.enemyTowersAlive ?? 11}`;
    if (mc.currentSafeFarmZones && mc.currentSafeFarmZones.length > 0) {
      safeZonesList.textContent = mc.currentSafeFarmZones.join(', ');
    }
    if (mc.dangerousZones && mc.dangerousZones.length > 0) {
      dangerZonesList.textContent = mc.dangerousZones.join(', ');
    }
  }

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
      speakText(`${topThreat.title}. ${topThreat.recommendedAction}`);
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
    speakText(voiceMsg);
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
  speakText('Тест World Model. Повышенный риск на реке в ночное время. Отойдите под вышку.');
});

// Initialize
connectWebSocket();
loadAiConfig();
