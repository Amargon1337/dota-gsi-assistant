"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const http_1 = __importDefault(require("http"));
const path_1 = __importDefault(require("path"));
const os_1 = __importDefault(require("os"));
const cors_1 = __importDefault(require("cors"));
const ws_1 = require("ws");
const state_manager_1 = require("./gsi/state-manager");
const mock_stream_1 = require("./mock/mock-stream");
const ai_config_1 = require("./ai/ai-config");
const advisor_service_1 = require("./ai/advisor-service");
const PORT = 3000;
const app = (0, express_1.default)();
const server = http_1.default.createServer(app);
const wss = new ws_1.WebSocketServer({ server, path: '/ws' });
const stateManager = new state_manager_1.StateManager();
const mockStreamer = new mock_stream_1.MockStreamer(stateManager);
const advisorService = advisor_service_1.AdvisorService.getInstance();
// Connect AdvisorService to State updates
stateManager.on('state', (state) => {
    advisorService.onGameStateUpdate(stateManager.rawState, state).catch((err) => {
        console.error('[Advisor Pipeline Error]', err);
    });
});
// Express middleware
app.use((0, cors_1.default)());
app.use(express_1.default.json({ limit: '10mb' }));
app.use(express_1.default.static(path_1.default.join(__dirname, '../public')));
// GSI Endpoint from Dota 2 Source 2 Engine
app.post('/gsi', (req, res) => {
    // CRITICAL: Immediately send 200 OK so Source 2 HTTP thread is never delayed
    res.status(200).send('OK');
    setImmediate(() => {
        try {
            stateManager.update(req.body);
        }
        catch (err) {
            console.error('[GSI Error] Ошибка обработки пакета:', err);
        }
    });
});
// API endpoints for dashboard
app.get('/api/state', (_req, res) => {
    res.json({
        state: stateManager.getLatestState(),
        worldModel: advisorService.getWorldModel(),
    });
});
app.post('/api/mock/toggle', (_req, res) => {
    if (mockStreamer.isActive()) {
        mockStreamer.stop();
    }
    else {
        mockStreamer.start();
    }
    res.json({ mockActive: mockStreamer.isActive() });
});
// AI Configuration Endpoints
app.get('/api/ai/config', (_req, res) => {
    const cfg = ai_config_1.ConfigManager.get();
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
app.post('/api/ai/config', (req, res) => {
    const { geminiApiKey, geminiModel, autoCoachEnabled } = req.body;
    const updates = {};
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
    const saved = ai_config_1.ConfigManager.save(updates);
    res.json({
        success: true,
        geminiModel: saved.geminiModel,
        hasApiKey: Boolean(saved.geminiApiKey),
        autoCoachEnabled: saved.autoCoachEnabled,
    });
});
// Manual Coach Question Endpoint
app.post('/api/ai/ask', async (req, res) => {
    const question = req.body.question || '';
    const result = await advisorService.askManualQuestion(question);
    res.json(result);
});
// WebSocket broadcasting
function broadcast(data) {
    const json = JSON.stringify(data);
    wss.clients.forEach((client) => {
        if (client.readyState === ws_1.WebSocket.OPEN) {
            client.send(json);
        }
    });
}
wss.on('connection', (ws) => {
    ws.send(JSON.stringify({
        type: 'STATE_UPDATE',
        payload: stateManager.getLatestState(),
        worldModel: advisorService.getWorldModel(),
        mockActive: mockStreamer.isActive(),
        aiConfig: ai_config_1.ConfigManager.get(),
    }));
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
function getLocalIpAddresses() {
    const interfaces = os_1.default.networkInterfaces();
    const addresses = [];
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
