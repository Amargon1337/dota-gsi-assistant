import * as fs from 'fs';
import * as path from 'path';

// Valid Valve KeyValues format with strict double quotes on header and keys
const CFG_CONTENT = `"Dota 2 Integration Configuration"
{
    "uri"           "http://127.0.0.1:3000/gsi"
    "timeout"       "5.0"
    "buffer"        "0.1"
    "throttle"      "0.1"
    "heartbeat"     "30.0"
    "data"
    {
        "provider"      "1"
        "map"           "1"
        "player"        "1"
        "hero"          "1"
        "abilities"     "1"
        "items"         "1"
        "draft"         "1"
        "wearables"     "0"
        "buildings"     "1"
    }
    "auth"
    {
        "token"         "dota_assistant_token_77"
    }
}
`;

function findSteamLibraries(): string[] {
  const commonSteamPaths = [
    'C:\\Program Files (x86)\\Steam',
    'C:\\Program Files\\Steam',
    'D:\\Steam',
    'D:\\SteamLibrary',
    'E:\\SteamLibrary',
    'F:\\SteamLibrary',
    'G:\\SteamLibrary',
  ];

  const libraries: Set<string> = new Set();

  for (const steamPath of commonSteamPaths) {
    if (fs.existsSync(steamPath)) {
      libraries.add(steamPath);
      const vdfPath = path.join(steamPath, 'steamapps', 'libraryfolders.vdf');
      if (fs.existsSync(vdfPath)) {
        try {
          const content = fs.readFileSync(vdfPath, 'utf8');
          const pathMatches = content.matchAll(/"path"\s+"([^"]+)"/g);
          for (const match of pathMatches) {
            const libPath = match[1].replace(/\\\\/g, '\\');
            if (fs.existsSync(libPath)) {
              libraries.add(libPath);
            }
          }
        } catch {
          // ignore vdf parsing errors
        }
      }
    }
  }

  return Array.from(libraries);
}

function installConfig(): void {
  console.log('\n======================================================');
  console.log('🎮 [Dota 2 GSI Assistant] Установка конфигурации GSI');
  console.log('======================================================\n');

  // 1. Save local copy in project root
  const localCopyPath = path.resolve(__dirname, '../../gamestate_integration_assistant.cfg');
  fs.writeFileSync(localCopyPath, CFG_CONTENT, { encoding: 'utf8', flag: 'w' });
  console.log(`✅ Создан локальный файл: ${localCopyPath}`);

  // 2. Search for Dota 2 installation
  const steamLibraries = findSteamLibraries();
  let installedCount = 0;

  for (const lib of steamLibraries) {
    const dotaBase = path.join(lib, 'steamapps', 'common', 'dota 2 beta');
    const dotaCfgDir = path.join(dotaBase, 'game', 'dota', 'cfg');

    if (fs.existsSync(dotaCfgDir)) {
      // 1. Place directly in game/dota/cfg/ (MAIN SOURCE 2 PATH)
      const targetMain = path.join(dotaCfgDir, 'gamestate_integration_assistant.cfg');
      fs.writeFileSync(targetMain, CFG_CONTENT, { encoding: 'utf8', flag: 'w' });
      console.log(`🚀 УСТАНОВЛЕНО (основной каталог):`);
      console.log(`   👉 ${targetMain}`);
      installedCount++;

      // 2. Place in game/dota/cfg/gamestate_integration/ (SUBDIRECTORY FALLBACK)
      const subDir = path.join(dotaCfgDir, 'gamestate_integration');
      if (!fs.existsSync(subDir)) {
        fs.mkdirSync(subDir, { recursive: true });
      }
      const targetSub = path.join(subDir, 'gamestate_integration_assistant.cfg');
      fs.writeFileSync(targetSub, CFG_CONTENT, { encoding: 'utf8', flag: 'w' });
      console.log(`🚀 УСТАНОВЛЕНО (подпапка gamestate_integration):`);
      console.log(`   👉 ${targetSub}`);
      installedCount++;
    }

    // Also check game/core/cfg/
    const coreCfgDir = path.join(dotaBase, 'game', 'core', 'cfg');
    if (fs.existsSync(coreCfgDir)) {
      const targetCore = path.join(coreCfgDir, 'gamestate_integration_assistant.cfg');
      fs.writeFileSync(targetCore, CFG_CONTENT, { encoding: 'utf8', flag: 'w' });
      console.log(`🚀 УСТАНОВЛЕНО (core cfg):`);
      console.log(`   👉 ${targetCore}`);
      installedCount++;
    }
  }

  if (installedCount === 0) {
    console.log('\n⚠️ Папка Dota 2 не была найдена автоматически.');
    console.log('Пожалуйста, вручную скопируйте созданный файл в:');
    console.log('<Папка_Steam>\\steamapps\\common\\dota 2 beta\\game\\dota\\cfg\\gamestate_integration_assistant.cfg\n');
  } else {
    console.log('\n✨ Конфигурация успешно установлена во все целевые папки!');
    console.log('\n📋 ПАРАМЕТРЫ ЗАПУСКА STEAM:');
    console.log('1. В Steam нажмите правой кнопкой на Dota 2 -> «Свойства» (Properties).');
    console.log('2. Во вкладке «Общие» (General) найдите поле «Параметры запуска» (Launch Options).');
    console.log('3. Пропишите:');
    console.log('   -gamestateintegration -console');
    console.log('\n4. Если игра уже запущена, введите в консоль:');
    console.log('   reload_gsiconfig');
    console.log('======================================================\n');
  }
}

installConfig();
