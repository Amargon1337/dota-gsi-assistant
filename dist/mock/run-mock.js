"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const state_manager_1 = require("../gsi/state-manager");
const mock_stream_1 = require("./mock-stream");
const stateManager = new state_manager_1.StateManager();
const streamer = new mock_stream_1.MockStreamer(stateManager);
stateManager.on('state', (state) => {
    console.log(`[${state.calculated.formattedClock}] HP: ${state.hero.health}/${state.hero.max_health} | Руна через: ${state.calculated.timers.powerRune}s | Стак через: ${state.calculated.timers.stackAlert}s`);
});
stateManager.on('voice_alert', (alert) => {
    console.log(`🔊 [ГОЛОСОВОЕ ОПОВЕЩЕНИЕ]: "${alert.text}"`);
});
streamer.start();
console.log('Нажмите Ctrl+C для выхода.');
