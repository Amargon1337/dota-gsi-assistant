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

const PORT = 3000;
const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

const stateManager = new StateManager();
const mockStreamer = new MockStreamer(stateManager);
const advisorService = AdvisorService.getInstance();

// Connect AdvisorService to State updates
stateManager.on('state', (state) => {
  advisorService.onGameStateUpdate((stateManager as any).rawState, state).catch((err) => {
    console.error('[Advisor Pipeline Error]', err);
  });
});

// Express middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, '../public')));

// GSI Endpoint from Dota 2 Source 2 Engine
app.post('/gsi', (req: Request, res: Response) => {
  // CRITICAL: Immediately send 200 OK so Source 2 HTTP thread is never delayed
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

app.post('/api/mock/toggle', (_req: Request, res: Response) => {
  if (mockStreamer.isActive()) {
    mockStreamer.stop();
  } else {
    mockStreamer.start();
  }
  res.json({ mockActive: mockStreamer.isActive() });
});

// AI Configuration Endpoints
app.get('/api/ai/config', (_req: Request, res: Response) => {
  const cfg = ConfigManager.get();
  const maskedKey = cfg.geminiApiKey
    ? `${cfg.geminiApiKey.substring(0, 6)}...${cfg.geminiApiKey.substring(cfg.geminiApiKey.length - 4)}`
    : '';

  res.json({
    geminiApiKey: maskedKey,
    hasApiKey: Boolean(cfg.geminiApiKey),
    geminiModel: cfg.geminiModel,
    autoCoachEnabled: cfg.autoCoachEnabled,
    layaUrl: cfg.layaUrl,
    rateLimitSeconds: cfg.rateLimitSeconds,
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

wss.on('connection', (ws: WebSocket) => {
  ws.send(
    JSON.stringify({
      type: 'STATE_UPDATE',
      payload: stateManager.getLatestState(),
      worldModel: advisorService.getWorldModel(),
      mockActive: mockStreamer.isActive(),
      aiConfig: ConfigManager.get(),
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
    for (const iface of interfaces[name] || []) {
      if (iface.family === 'IPv4' && !iface.internal) {
        addresses.push(iface.address);
      }
    }
  }
  return addresses;
}

server.listen(PORT, '0.0.0.0', () => {
  const lanIps = getLocalIpAddresses();

  console.log('\n======================================================');
  console.log('🛡️  DOTA 2 SHARED WORLD MODEL & COGNITIVE CO-PILOT 🛡️');
  console.log('🧠  Laya (System-1) + Gemini Flash Lite (Strategic Model)');
  console.log('======================================================');
  console.log(`\n📍 Локальный доступ: http://localhost:${PORT}`);
  if (lanIps.length > 0) {
    console.log(`📱 Смартфон / Планшет: http://${lanIps[0]}:${PORT}`);
  }
  console.log(`🎮 GSI Endpoint: http://127.0.0.1:${PORT}/gsi\n`);
});
