import { StateManager } from '../gsi/state-manager';
import { MockStreamer, MockScenario } from './mock-stream';

const stateManager = new StateManager();

// Parse --scenario argument if provided
let selectedScenario: MockScenario = 'default';
for (const arg of process.argv) {
  if (arg.startsWith('--scenario=')) {
    const sc = arg.split('=')[1] as MockScenario;
    if (['default', 'gank', 'death', 'roshan', 'violation', 'completion'].includes(sc)) {
      selectedScenario = sc;
    }
  }
}

const streamer = new MockStreamer(stateManager, selectedScenario);

stateManager.on('state', (state) => {
  console.log(
    `[${state.calculated.formattedClock}] HP: ${state.hero.health}/${state.hero.max_health} | Зона: ${state.calculated.mapZone || 'Unknown'} | NW: ${state.player.net_worth}`
  );
});

stateManager.on('voice_alert', (alert) => {
  console.log(`🔊 [ГОЛОСОВОЕ ОПОВЕЩЕНИЕ]: "${alert.text}"`);
});

streamer.start();

console.log(`Симуляция запущена со сценарием [${selectedScenario}]. Нажмите Ctrl+C для выхода.`);
