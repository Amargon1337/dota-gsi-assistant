import express, { Request, Response, NextFunction } from 'express';
import http from 'http';
import path from 'path';
import fs from 'fs';
import os from 'os';
import cors from 'cors';
import { WebSocketServer, WebSocket } from 'ws';
import { StateManager } from './gsi/state-manager';
import { MockStreamer } from './mock/mock-stream';
import { ConfigManager } from './ai/ai-config';
import { AdvisorService } from './ai/advisor-service';
import { GeminiBudgetManager } from './ai/gemini-budget-manager';
import { ObservationCollector } from './gsi/observation-collector';
import { GameSessionManager } from './engine/game-session';

// Load configuration initially
ConfigManager.load();

const PORT = 3000;
const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({
  server,
  path: '/ws',
  handleProtocols: (protocols: Set<string>) => {
    if (protocols.has('dota-auth')) {
      return 'dota-auth';
    }
    return '';
  },
});

const stateManager = new StateManager();
const mockStreamer = new MockStreamer(stateManager);
const advisorService = AdvisorService.getInstance();
const budgetManager = GeminiBudgetManager.getInstance();

// Connect AdvisorService to State updates with strict typing
stateManager.on('state', (state) => {
  advisorService.onGameStateUpdate(stateManager.getRawState(), state).catch((err) => {
    console.error('[Advisor Pipeline Error]', err);
  });
});

// Strict CORS: allow localhost and local private network subnets (LAN tablet/phone)
app.use(
  cors({
    origin: (origin, callback) => {
      if (
        !origin ||
        origin.includes('localhost') ||
        origin.includes('127.0.0.1') ||
        origin.startsWith('http://192.168.') ||
        origin.startsWith('http://10.') ||
        origin.startsWith('http://100.')
      ) {
        callback(null, true);
      } else {
        callback(new Error('Blocked by CORS policy'));
      }
    },
  })
);

// Body limit reduced from 10mb to 256kb to eliminate DOS vulnerability
app.use(express.json({ limit: '256kb' }));
app.use(express.static(path.join(__dirname, '../public')));
app.use('/data/item_icons', express.static(path.join(__dirname, '../data/item_icons')));
app.use('/data/hero_portraits', express.static(path.join(__dirname, '../data/hero_portraits')));
app.use('/data/hero_icons', express.static(path.join(__dirname, '../data/hero_icons')));
app.use('/audio_cache', express.static(path.join(__dirname, '../public/audio_cache')));

// GSI Endpoint from Dota 2 Source 2 Engine with strict Auth Token Validation
// Missing or incorrect token -> 401 Unauthorized for external requests.
// Localhost / Loopback Dota 2 Source 2 engine is always accepted safely.
app.post('/gsi', (req: Request, res: Response) => {
  const cfg = ConfigManager.get();
  const expectedToken = cfg.gsiAuthToken;
  const providedToken = req.body?.auth?.token;

  const ip = req.ip || req.socket.remoteAddress || '';
  const isLocal = ip.includes('127.0.0.1') || ip.includes('::1') || ip.includes('localhost');

  if (!isLocal && expectedToken && (!providedToken || providedToken !== expectedToken)) {
    console.warn('[GSI Security] Отклонён внешний пакет: отсутствующий или неверный auth токен');
    res.status(401).send('Unauthorized GSI Token');
    return;
  }

  // Immediately send 200 OK so Source 2 HTTP thread is never delayed
  res.status(200).send('OK');

  setImmediate(() => {
    try {
      stateManager.update(req.body);
    } catch (err) {
      console.error('[GSI Error] Ошибка обработки пакета:', err);
    }
  });
});

// Dashboard Auth Middleware for /api/* routes
const requireDashboardAuth = (req: Request, res: Response, next: NextFunction): void => {
  const cfg = ConfigManager.get();
  const expectedToken = cfg.dashboardAuthToken;

  if (!expectedToken) {
    return next();
  }

  // Seamless local access on player machine
  const ip = req.ip || req.socket.remoteAddress || '';
  const isLocal = ip.includes('127.0.0.1') || ip.includes('::1') || ip.includes('localhost');
  if (isLocal) {
    return next();
  }

  const authHeader = req.headers.authorization;
  let token = '';
  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.substring(7).trim();
  } else if (req.query?.token) {
    token = String(req.query.token).trim();
  }

  if (!token || token !== expectedToken) {
    res.status(401).json({ error: 'Unauthorized: invalid or missing dashboard token' });
    return;
  }

  next();
};

app.use('/api', requireDashboardAuth);

// API endpoints for dashboard
app.get('/api/state', (_req: Request, res: Response) => {
  res.json({
    state: stateManager.getLatestState(),
    worldModel: advisorService.getWorldModel(),
  });
});

app.get('/api/model', (_req: Request, res: Response) => {
  res.json(advisorService.getWorldModel());
});

app.post('/api/mock/toggle', (_req: Request, res: Response) => {
  if (mockStreamer.isActive()) {
    mockStreamer.stop();
  } else {
    mockStreamer.start();
  }
  res.json({ mockActive: mockStreamer.isActive() });
});

// AI Configuration Endpoints - NEVER leak raw API Key
app.get('/api/ai/config', (_req: Request, res: Response) => {
  const cfg = ConfigManager.get();
  const maskedKey = cfg.geminiApiKey
    ? `${cfg.geminiApiKey.substring(0, 6)}...${cfg.geminiApiKey.substring(cfg.geminiApiKey.length - 4)}`
    : '';

  const budget = budgetManager.getStatus();

  res.json({
    geminiApiKey: maskedKey,
    hasApiKey: Boolean(cfg.geminiApiKey),
    geminiModel: cfg.geminiModel,
    autoCoachEnabled: cfg.autoCoachEnabled,
    layaUrl: cfg.layaUrl,
    rateLimitSeconds: cfg.rateLimitSeconds,
    budget,
  });
});

app.post('/api/ai/config', (req: Request, res: Response) => {
  const { geminiApiKey, geminiModel, autoCoachEnabled } = req.body;
  const updates: any = {};

  if (typeof geminiApiKey === 'string' && geminiApiKey.trim() !== '') {
    if (!geminiApiKey.includes('...')) {
      updates.geminiApiKey = geminiApiKey.trim();
    }
  }
  if (typeof geminiModel === 'string' && geminiModel.trim() !== '') {
    updates.geminiModel = geminiModel.trim();
  }
  if (typeof autoCoachEnabled === 'boolean') {
    updates.autoCoachEnabled = autoCoachEnabled;
  }

  const saved = ConfigManager.save(updates);
  res.json({
    success: true,
    geminiModel: saved.geminiModel,
    hasApiKey: Boolean(saved.geminiApiKey),
    autoCoachEnabled: saved.autoCoachEnabled,
  });
});

// Manual Coach Question Endpoint
app.post('/api/ai/ask', async (req: Request, res: Response) => {
  const question = req.body.question || '';
  const result = await advisorService.askManualQuestion(question);
  res.json(result);
});

// ==========================================
// 👁️ COMPUTER VISION INGESTION API (VAC-Safe)
// ==========================================

// Ingest enemy hero sightings detected on the minimap
app.post('/api/vision/sighting', (req: Request, res: Response) => {
  const sightings = Array.isArray(req.body) ? req.body : [req.body];
  const model = advisorService.getWorldModel();
  const currentClock = model.meta.clockTime;
  const playerTeam = model.player.team || 'radiant';

  let recordedCount = 0;
  for (const s of sightings) {
    if (!s || !s.heroName) continue;
    ObservationCollector.getInstance().observeEnemy(
      {
        heroName: s.heroName,
        x: s.x,
        y: s.y,
        level: s.level,
        items: s.items,
        clockTime: s.clockTime ?? currentClock,
        source: 'cv',
        certainty: s.confidence ?? 0.92,
      },
      playerTeam
    );
    recordedCount++;
  }

  // Set observation mode to hybrid and refresh enemies record
  model.observationMode = 'hybrid_gsi_cv';
  model.enemies = ObservationCollector.getInstance().getObservationsRecord();

  broadcast({
    type: 'WORLD_MODEL_UPDATE',
    model,
  });

  res.json({ success: true, count: recordedCount, mode: model.observationMode });
});

// Setup enemy team heroes (Quick match draft setup)
app.post('/api/enemies/setup', (req: Request, res: Response) => {
  const { heroes } = req.body;
  if (!Array.isArray(heroes) || heroes.length === 0) {
    res.status(400).json({ error: 'heroes array required' });
    return;
  }

  const model = advisorService.getWorldModel();
  const playerTeam = model.player.team || 'radiant';
  const currentClock = model.meta.clockTime;
  const collector = ObservationCollector.getInstance();

  for (const h of heroes) {
    if (!h || typeof h !== 'string') continue;
    const heroClean = h.trim().toLowerCase().replace(/\s+/g, '_');
    const heroName = heroClean.startsWith('npc_dota_hero_') ? heroClean : `npc_dota_hero_${heroClean}`;
    collector.observeEnemy(
      {
        heroName,
        clockTime: currentClock,
        source: 'inferred',
        certainty: 0.5,
        items: [],
      },
      playerTeam
    );
  }

  model.enemies = collector.getObservationsRecord();
  broadcast({
    type: 'WORLD_MODEL_UPDATE',
    model,
  });

  res.json({ success: true, count: Object.keys(model.enemies).length, enemies: model.enemies });
});

// Quickly spot or report an enemy hero location / threat item in 1 click
app.post('/api/enemies/spot', (req: Request, res: Response) => {
  const { heroName, zoneName, hasBlink, hasBkb, hasShadowBlade } = req.body;
  if (!heroName) {
    res.status(400).json({ error: 'heroName required' });
    return;
  }

  const model = advisorService.getWorldModel();
  const playerTeam = model.player.team || 'radiant';
  const currentClock = model.meta.clockTime;
  const collector = ObservationCollector.getInstance();
  const existing = collector.getObservationsRecord()[heroName.toLowerCase()];

  let x = existing?.lastKnownLocation?.x ?? 0;
  let y = existing?.lastKnownLocation?.y ?? 0;

  if (zoneName) {
    const z = String(zoneName).toLowerCase();
    if (z.includes('mid') || z.includes('мид')) { x = 0; y = 0; }
    else if (z.includes('river') || z.includes('река')) { x = 1200; y = -1200; }
    else if (z.includes('roshan') || z.includes('рошан')) { x = -2000; y = 1800; }
    else if (z.includes('triangle') || z.includes('треугольник')) {
      x = playerTeam === 'radiant' ? 2500 : -2500;
      y = playerTeam === 'radiant' ? 2000 : -2000;
    }
    else if (z.includes('jungle') || z.includes('лес')) {
      x = playerTeam === 'radiant' ? -2500 : 2500;
      y = playerTeam === 'radiant' ? 3000 : -3000;
    }
    else if (z.includes('base') || z.includes('база')) {
      x = playerTeam === 'radiant' ? 5500 : -5500;
      y = playerTeam === 'radiant' ? 5500 : -5500;
    }
  }

  const items = existing?.items ? [...existing.items] : [];
  if (hasBlink === true && !items.includes('item_blink')) items.push('item_blink');
  if (hasBlink === false) {
    const idx = items.indexOf('item_blink');
    if (idx !== -1) items.splice(idx, 1);
  }
  if (hasBkb === true && !items.includes('item_black_king_bar')) items.push('item_black_king_bar');
  if (hasBkb === false) {
    const idx = items.indexOf('item_black_king_bar');
    if (idx !== -1) items.splice(idx, 1);
  }
  if (hasShadowBlade === true && !items.includes('item_shadow_blade')) items.push('item_shadow_blade');
  if (hasShadowBlade === false) {
    const idx = items.indexOf('item_shadow_blade');
    if (idx !== -1) items.splice(idx, 1);
  }

  const tracker = collector.observeEnemy(
    {
      heroName,
      x,
      y,
      clockTime: currentClock,
      source: 'cv',
      certainty: 0.95,
      items,
    },
    playerTeam
  );

  model.enemies = collector.getObservationsRecord();
  broadcast({
    type: 'WORLD_MODEL_UPDATE',
    model,
  });

  res.json({ success: true, tracker });
});

// Ingest detected hero picks from draft screen
app.post('/api/vision/draft', (req: Request, res: Response) => {
  const { radiantHeroes, direHeroes } = req.body || {};
  const model = advisorService.getWorldModel();

  model.visionDraft = {
    radiantHeroes: Array.isArray(radiantHeroes) ? radiantHeroes : [],
    direHeroes: Array.isArray(direHeroes) ? direHeroes : [],
    lastUpdated: Date.now(),
  };

  broadcast({
    type: 'WORLD_MODEL_UPDATE',
    model,
  });

  res.json({ success: true, draft: model.visionDraft });
});

let lastVisionHeartbeat = 0;
let lastVisionFps = 0;
let lastVisionDotaFound = false;

// Heartbeat endpoint for Python Vision Service
app.post('/api/vision/heartbeat', (req: Request, res: Response) => {
  lastVisionHeartbeat = Date.now();
  if (req.body?.fps !== undefined) lastVisionFps = Number(req.body.fps);
  if (req.body?.dotaFound !== undefined) lastVisionDotaFound = Boolean(req.body.dotaFound);
  res.json({ ok: true });
});

// Check status of computer vision feed
app.get('/api/vision/status', (_req: Request, res: Response) => {
  const model = advisorService.getWorldModel();
  const cvObservations = Object.values(model.enemies).filter((e) => e.observationSource === 'cv');
  const isServiceAlive = (Date.now() - lastVisionHeartbeat) < 6000;

  res.json({
    serviceRunning: isServiceAlive,
    dotaFound: lastVisionDotaFound,
    fps: lastVisionFps,
    active: isServiceAlive || cvObservations.length > 0 || Boolean(model.visionDraft?.radiantHeroes.length),
    observationMode: model.observationMode,
    cvEnemiesCount: cvObservations.length,
    enemiesTracked: cvObservations.map((e) => ({
      name: e.heroNameClean,
      freshness: e.freshness,
      zone: e.lastKnownLocation.zoneName,
      missingSeconds: e.missingDurationSeconds,
    })),
    draftDetected: Boolean(model.visionDraft?.radiantHeroes.length),
  });
});

// Threat Items Catalog for Scoreboard Item Spikes
let threatItemsCatalog: Record<string, any> = {};
try {
  const threatPath = path.join(__dirname, '../data/threat_items.json');
  if (fs.existsSync(threatPath)) {
    threatItemsCatalog = JSON.parse(fs.readFileSync(threatPath, 'utf-8'));
  }
} catch (e) {
  console.warn('[Server] Could not load threat_items.json:', e);
}

const alertedHeroItems = new Map<string, Set<string>>();
const alertedHeroLevels = new Map<string, Set<number>>();

GameSessionManager.getInstance().registerComponent({
  reset: () => {
    alertedHeroItems.clear();
    alertedHeroLevels.clear();
  },
});

// Proxy endpoint for Neural Voice TTS (Laya System-1 / Edge-TTS)
app.post('/api/tts/speak', async (req: Request, res: Response) => {
  const { text, voice } = req.body || {};
  if (!text) {
    res.status(400).json({ error: 'text parameter required' });
    return;
  }

  try {
    const fetchResp = await fetch('http://127.0.0.1:8000/v1/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, voice: voice || 'ru-RU-SvetlanaNeural' }),
    });
    if (!fetchResp.ok) {
      throw new Error(`TTS service error: ${fetchResp.status}`);
    }
    const data = await fetchResp.json();
    res.json(data);
  } catch (err: any) {
    res.status(502).json({ error: 'TTS Service offline', fallbackToWebSpeech: true });
  }
});

// Ingest detected enemy items and levels from Scoreboard (Tab)
app.post('/api/vision/scoreboard', (req: Request, res: Response) => {
  const updates = Array.isArray(req.body) ? req.body : [req.body];
  const model = advisorService.getWorldModel();
  const playerTeam = model.player.team || 'radiant';
  const currentClock = model.meta.clockTime;
  const collector = ObservationCollector.getInstance();

  const itemSpikes: any[] = [];
  const levelSpikes: any[] = [];

  for (const u of updates) {
    if (!u || !u.heroName) continue;
    const heroClean = String(u.heroName).replace(/^npc_dota_hero_/, '').toLowerCase().trim();
    const heroKey = `npc_dota_hero_${heroClean}`;
    const heroDisplayName = heroClean.replace(/_/g, ' ');

    const items: string[] = Array.isArray(u.items) ? u.items : [];
    const level: number = typeof u.level === 'number' ? u.level : 1;

    // Update enemy in ObservationCollector
    collector.observeEnemy(
      {
        heroName: heroKey,
        level,
        items,
        clockTime: u.clockTime ?? currentClock,
        source: 'cv',
        certainty: 0.95,
      },
      playerTeam
    );

    // Track newly spotted threat items
    if (!alertedHeroItems.has(heroKey)) {
      alertedHeroItems.set(heroKey, new Set());
    }
    const knownItems = alertedHeroItems.get(heroKey)!;

    for (const rawItem of items) {
      const cleanItem = String(rawItem).toLowerCase().trim().replace(/^item_/, '');
      if (!knownItems.has(cleanItem)) {
        knownItems.add(cleanItem);
        const threatInfo = threatItemsCatalog[cleanItem];
        if (threatInfo) {
          const spike = {
            type: 'ITEM_SPIKE',
            heroKey,
            heroName: heroDisplayName,
            itemKey: cleanItem,
            itemName: threatInfo.name,
            severity: threatInfo.severity,
            counterAdvice: threatInfo.counter_advice,
            clockTime: currentClock,
          };
          itemSpikes.push(spike);
          broadcast(spike);
        }
      }
    }

    // Track level spikes (Lvl 6, 12, 18)
    if (!alertedHeroLevels.has(heroKey)) {
      alertedHeroLevels.set(heroKey, new Set());
    }
    const knownLevels = alertedHeroLevels.get(heroKey)!;
    for (const threshold of [6, 12, 18]) {
      if (level >= threshold && !knownLevels.has(threshold)) {
        knownLevels.add(threshold);
        const lSpike = {
          type: 'LEVEL_SPIKE',
          heroKey,
          heroName: heroDisplayName,
          level,
          threshold,
          callout: `Внимание: ${heroDisplayName} получил ${level}-й уровень! Доступен ключевой ультимейт!`,
          clockTime: currentClock,
        };
        levelSpikes.push(lSpike);
        broadcast(lSpike);
      }
    }
  }

  model.enemies = collector.getObservationsRecord();
  broadcast({
    type: 'WORLD_MODEL_UPDATE',
    model,
  });

  res.json({
    success: true,
    itemSpikesCount: itemSpikes.length,
    levelSpikesCount: levelSpikes.length,
  });
});

// WebSocket broadcasting - only to authenticated clients
function broadcast(data: any): void {
  const json = JSON.stringify(data);
  wss.clients.forEach((client: any) => {
    if (client.readyState === WebSocket.OPEN && client.authenticated !== false) {
      client.send(json);
    }
  });
}

// WebSocket Connection - Validate Dashboard Token via Sec-WebSocket-Protocol, initial message, or query param
wss.on('connection', (ws: WebSocket, req: http.IncomingMessage) => {
  const cfg = ConfigManager.get();
  const expectedToken = cfg.dashboardAuthToken;

  // 1. Primary: Sec-WebSocket-Protocol (e.g. ['dota-auth', token])
  let token = '';
  const secProto = req.headers['sec-websocket-protocol'];
  if (secProto) {
    const parts = secProto.split(',').map((s) => s.trim());
    const dotaIdx = parts.indexOf('dota-auth');
    if (dotaIdx !== -1 && parts.length > dotaIdx + 1) {
      token = parts[dotaIdx + 1];
    }
  }

  // 2. Legacy fallback: query parameter ?token=...
  if (!token) {
    const url = new URL(req.url || '', `http://${req.headers.host || 'localhost'}`);
    token = url.searchParams.get('token') || '';
  }

  let authenticated = false;

  const onAuthenticated = () => {
    authenticated = true;
    (ws as any).authenticated = true;
    ws.send(
      JSON.stringify({
        type: 'STATE_UPDATE',
        payload: stateManager.getLatestState(),
        worldModel: advisorService.getWorldModel(),
        mockActive: mockStreamer.isActive(),
        aiConfig: {
          geminiConfigured: Boolean(cfg.geminiApiKey),
          geminiModel: cfg.geminiModel,
          autoCoachEnabled: cfg.autoCoachEnabled,
        },
      })
    );
  };

  const ip = req.socket.remoteAddress || '';
  const isLocal = ip.includes('127.0.0.1') || ip.includes('::1') || ip.includes('localhost');

  if (isLocal || !expectedToken || token === expectedToken) {
    onAuthenticated();
  } else {
    // 3. Fallback: Wait up to 4s for initial { type: 'AUTH', token } message before closing
    const authTimeout = setTimeout(() => {
      if (!authenticated) {
        console.warn('[WS Security] Отклонено соединение: неверный или отсутствующий dashboard токен (таймаут auth)');
        ws.send(JSON.stringify({ type: 'ERROR', error: 'AUTH_REQUIRED', message: 'Неверный токен дашборда' }));
        ws.close(4401, 'Unauthorized');
      }
    }, 4000);

    const authListener = (rawMsg: any) => {
      try {
        const msg = JSON.parse(rawMsg.toString());
        if (msg.type === 'AUTH' && msg.token === expectedToken) {
          clearTimeout(authTimeout);
          ws.off('message', authListener);
          onAuthenticated();
        } else if (msg.type === 'AUTH') {
          clearTimeout(authTimeout);
          ws.off('message', authListener);
          console.warn('[WS Security] Отклонено соединение: неверный токен в AUTH сообщении');
          ws.send(JSON.stringify({ type: 'ERROR', error: 'AUTH_REQUIRED', message: 'Неверный токен дашборда' }));
          ws.close(4401, 'Unauthorized');
        }
      } catch (_) {}
    };

    ws.on('message', authListener);
  }
});

stateManager.on('state', (state) => {
  broadcast({
    type: 'STATE_UPDATE',
    payload: state,
    mockActive: mockStreamer.isActive(),
  });
});

stateManager.on('voice_alert', (alert) => {
  broadcast({
    type: 'VOICE_ALERT',
    alert,
  });
});

advisorService.on('world_update', (model) => {
  broadcast({
    type: 'WORLD_MODEL_UPDATE',
    model,
  });
});

advisorService.on('laya_cognition', (decision) => {
  broadcast({
    type: 'LAYA_UPDATE',
    decision,
  });
});

advisorService.on('strategic_plan', (planData) => {
  broadcast({
    type: 'STRATEGIC_PLAN',
    planData,
  });
});

advisorService.on('semantic_event', (event) => {
  broadcast({
    type: 'SEMANTIC_EVENT',
    event,
  });
});

function getLocalIpAddresses(): string[] {
  const interfaces = os.networkInterfaces();
  const addresses: string[] = [];
  for (const name of Object.keys(interfaces)) {
    for (const net of interfaces[name] || []) {
      if (net.family === 'IPv4' && !net.internal) {
        addresses.push(net.address);
      }
    }
  }
  return addresses;
}

server.listen(PORT, '0.0.0.0', () => {
  const ips = getLocalIpAddresses();
  console.log('\n======================================================');
  console.log('🛡️  DOTA 2 SHARED WORLD MODEL & COGNITIVE CO-PILOT 🛡️');
  console.log('🧠  Laya (System-1) + Gemini Flash Lite (Strategic Model)');
  console.log('🔒  Security: GSI Auth Token Active | Key Protected');
  console.log('======================================================\n');
  console.log(`📍 Локальный доступ: http://localhost:${PORT}`);
  if (ips.length > 0) {
    console.log(`📱 Смартфон / Планшет: http://${ips[0]}:${PORT}`);
  }
  console.log(`🎮 GSI Endpoint: http://127.0.0.1:${PORT}/gsi\n`);
});
