import urllib.request
import json
import os

req = urllib.request.Request(
    'https://api.opendota.com/api/constants/items',
    headers={'User-Agent': 'Mozilla/5.0'}
)
with urllib.request.urlopen(req, timeout=10) as resp:
    items = json.loads(resp.read().decode('utf-8'))

# Categorize items by tactical threat and counter-strategy in current patch
threat_categories = {
    'INSTANT_DISABLE_AND_HEX': {
        'title': 'Инстант-дисейбл и Хекс (Instant Disables)',
        'items': ['sheepstick', 'abyssal_blade', 'bloodthorn', 'orchid'],
        'counter': 'Требуется Linken\'s Sphere, Lotus Orb, BKB до инициации или вижн/контр-позиция',
        'severity': 'CRITICAL'
    },
    'INITIATION_AND_MOBILITY': {
        'title': 'Инициация и внезапное перемещение (Initiation & Mobility)',
        'items': ['blink', 'swift_blink', 'arcane_blink', 'overwhelming_blink', 'invis_sword', 'silver_edge'],
        'counter': 'Не ходить в одиночку без вижна, не стоять скученно, носить Sentries / Dust of Appearance',
        'severity': 'CRITICAL'
    },
    'SPELL_IMMUNITY_AND_DISPELS': {
        'title': 'Магический иммунитет и Сейв (Spell Immunity & Dispel)',
        'items': ['black_king_bar', 'aeon_disk', 'wind_waker', 'cyclone', 'sphere', 'lotus_orb'],
        'counter': 'Отслеживать кулдауны BKB/Aeon Disk, байтить перед решающим файтом, не сливать ключевые ульты в BKB',
        'severity': 'HIGH'
    },
    'ROOT_AND_SLOW_LOCKDOWN': {
        'title': 'Рут, Замедление и Локдаун (Catch & Lockdown)',
        'items': ['gleipnir', 'rod_of_atos', 'diffusal_blade', 'disperser', 'heavens_halberd', 'nullifier', 'basher'],
        'counter': 'Manta Style, BKB, Eul / Wind Waker для сброса замедлений; против Nullifier нужен BKB до диспела',
        'severity': 'HIGH'
    },
    'GAME_CHANGING_MACRO': {
        'title': 'Макро-переломные артефакты (Game-Changing / Vision)',
        'items': ['rapier', 'gem', 'radiance', 'refresher', 'spirit_vessel'],
        'counter': 'Фокус носителя Рапиры / Гема, сброс зарядов Vessel через Lotus/Eul/BKB',
        'severity': 'CRITICAL'
    }
}

item_catalog = {}
for cat_id, cat_info in threat_categories.items():
    for item_key in cat_info['items']:
        raw = items.get(item_key, {})
        item_catalog[item_key] = {
            'id': raw.get('id'),
            'key': item_key,
            'name': raw.get('dname', item_key),
            'cost': raw.get('cost', 0),
            'category': cat_id,
            'category_title': cat_info['title'],
            'severity': cat_info['severity'],
            'counter_advice': cat_info['counter'],
            'img_url': f"https://cdn.cloudflare.steamstatic.com/apps/dota2/images/dota_react/items/{item_key}.png",
            'notes': raw.get('hint', [''])[0] if raw.get('hint') else ''
        }

out_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'data', 'threat_items.json')
with open(out_path, 'w', encoding='utf-8') as f:
    json.dump(item_catalog, f, indent=2, ensure_ascii=False)

print(f"Catalog of {len(item_catalog)} critical threat items saved to {out_path}!")
for k, v in list(item_catalog.items())[:15]:
    print(f"[{v['severity']}] {v['name']} ({v['cost']}g) -> {v['category_title']}")
