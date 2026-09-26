import os
import json
import urllib.request
from concurrent.futures import ThreadPoolExecutor

DATA_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'data')
ICONS_DIR = os.path.join(DATA_DIR, 'hero_icons')
PORTRAITS_DIR = os.path.join(DATA_DIR, 'hero_portraits')

os.makedirs(ICONS_DIR, exist_ok=True)
os.makedirs(PORTRAITS_DIR, exist_ok=True)

HEROES_JSON_PATH = os.path.join(DATA_DIR, 'heroes.json')

def fetch_heroes():
    if os.path.exists(HEROES_JSON_PATH) and os.path.getsize(HEROES_JSON_PATH) > 1000:
        with open(HEROES_JSON_PATH, 'r', encoding='utf-8') as f:
            return json.load(f)

    print('[ASSETS] Fetching hero constants from OpenDota API...', flush=True)
    req = urllib.request.Request(
        'https://api.opendota.com/api/constants/heroes',
        headers={'User-Agent': 'Mozilla/5.0'}
    )
    with urllib.request.urlopen(req, timeout=10) as resp:
        data = json.loads(resp.read().decode('utf-8'))

    with open(HEROES_JSON_PATH, 'w', encoding='utf-8') as f:
        json.dump(data, f, indent=2)

    print(f'[ASSETS] Saved metadata for {len(data)} heroes to {HEROES_JSON_PATH}', flush=True)
    return data

def download_file(url, target_path):
    if os.path.exists(target_path) and os.path.getsize(target_path) > 300:
        return True
    try:
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req, timeout=8) as resp:
            content = resp.read()
            if len(content) > 100:
                with open(target_path, 'wb') as f:
                    f.write(content)
                return True
    except Exception as e:
        pass
    return False

def download_hero_item(item):
    name = item.get('name', '')
    clean = name.replace('npc_dota_hero_', '')
    icon_url = f'https://cdn.cloudflare.steamstatic.com/apps/dota2/images/dota_react/heroes/icons/{clean}.png'
    icon_path = os.path.join(ICONS_DIR, f'{clean}.png')
    download_file(icon_url, icon_path)

    portrait_url = f'https://cdn.cloudflare.steamstatic.com/apps/dota2/images/dota_react/heroes/{clean}.png'
    portrait_path = os.path.join(PORTRAITS_DIR, f'{clean}.png')
    download_file(portrait_url, portrait_path)

def download_all_assets():
    heroes = fetch_heroes()
    items = list(heroes.values())
    total = len(items)
    print(f'[ASSETS] Multithreaded download for {total} heroes...', flush=True)

    with ThreadPoolExecutor(max_workers=20) as executor:
        list(executor.map(download_hero_item, items))

    icons_count = len([f for f in os.listdir(ICONS_DIR) if f.endswith('.png')])
    portraits_count = len([f for f in os.listdir(PORTRAITS_DIR) if f.endswith('.png')])
    print(f'[ASSETS] Done! Total cached icons: {icons_count}, portraits: {portraits_count}', flush=True)

if __name__ == '__main__':
    download_all_assets()
