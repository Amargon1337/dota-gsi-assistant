import { StateManager } from '../gsi/state-manager';
import { MockStreamer } from './mock-stream';

const stateManager = new StateManager();
const streamer = new MockStreamer(stateManager);

stateManager.on('state', (state) => {
  console.log(`[${state.calculated.formattedClock}] HP: ${state.hero.health}/${state.hero.max_health} | Руна через: ${state.calculated.timers.powerRune}s | Стак через: ${state.calculated.timers.stackAlert}s`);
});

stateManager.on('voice_alert', (alert) => {
  console.log(`🔊 [ГОЛОСОВОЕ ОПОВЕЩЕНИЕ]: "${alert.text}"`);
});

streamer.start();

console.log('Нажмите Ctrl+C для выхода.');
