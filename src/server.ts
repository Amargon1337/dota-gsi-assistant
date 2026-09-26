import express, { Request, Response } from 'express';
import http from 'http';
import path from 'path';
import os from 'os';
import cors from 'cors';
import { WebSocketServer, WebSocket } from 'ws';
import { StateManager } from './gsi/state-manager';
import { MockStreamer } from './mock/mock-stream';
import { ConfigManager } from './ai/ai-config';
import { AdvisorService } from './ai/advisor-service';
import { GeminiBudgetManager } from './ai/gemini-budget-manager';

const PORT = 3000;
const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

const stateManager = new StateManager();
const mockStreamer = new MockStreamer(stateManager);
const advisorService = AdvisorService.getInstance();
const budgetManager = GeminiBudgetManager.getInstance();

// Connect AdvisorService to State updates
stateManager.on('state', (state) => {
  advisorService.onGameStateUpdate((stateManager as any).rawState, state).catch((err) => {
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

// GSI Endpoint from Dota 2 Source 2 Engine with Auth Token Validation
app.post('/gsi', (req: Request, res: Response) => {
  const cfg = ConfigManager.get();
  const expectedToken = (cfg as any).gsiAuthToken || 'dota_assistant_token_77';
  const providedToken = req.body?.auth?.token;

  // Validate GSI auth token if configured
  if (expectedToken && providedToken && providedToken !== expectedToken) {
    console.warn('[GSI Security] Отклонён пакет: неверный auth токен');
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

// WebSocket broadcasting
function broadcast(data: any): void {
  const json = JSON.stringify(data);
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(json);
    }
  });
}

// WebSocket Connection - Send ONLY Sanitized Config without API key
wss.on('connection', (ws: WebSocket) => {
  const cfg = ConfigManager.get();
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
