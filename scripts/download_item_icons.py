import os
import json
import urllib.request
from concurrent.futures import ThreadPoolExecutor

DATA_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'data')
ITEM_ICONS_DIR = os.path.join(DATA_DIR, 'item_icons')
os.makedirs(ITEM_ICONS_DIR, exist_ok=True)

with open(os.path.join(DATA_DIR, 'threat_items.json'), 'r', encoding='utf-8') as f:
    items = json.load(f)

def download_item(entry):
    key, info = entry
    icon_path = os.path.join(ITEM_ICONS_DIR, f"{key}.png")
    if os.path.exists(icon_path) and os.path.getsize(icon_path) > 300:
        return True
    url = info.get('img_url')
    if not url:
        return False
    try:
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req, timeout=5) as resp:
            content = resp.read()
            if len(content) > 100:
                with open(icon_path, 'wb') as f:
                    f.write(content)
                return True
    except Exception:
        pass
    return False

def main():
    print(f"[ITEMS] Downloading icons for {len(items)} threat items...", flush=True)
    with ThreadPoolExecutor(max_workers=10) as executor:
        list(executor.map(download_item, items.items()))
    count = len([f for f in os.listdir(ITEM_ICONS_DIR) if f.endswith('.png')])
    print(f"[ITEMS] Done! Cached {count}/{len(items)} threat item icons in {ITEM_ICONS_DIR}", flush=True)

if __name__ == '__main__':
    main()
