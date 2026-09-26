"""
Dota 2 Computer Vision Agent (VAC-Safe Screen Ingestion)
Monitors Dota 2 Top Bar and Minimap via OS Screen Duplication API.
Transmits detected enemy hero picks and real-time minimap sightings
to the local assistant server via /api/vision/* endpoints.
"""

import os
import sys
import time
import json
import ctypes
from ctypes import wintypes
import urllib.request
import urllib.error
import threading
from PIL import ImageGrab
import numpy as np
import cv2

# Configuration
SERVER_BASE = 'http://127.0.0.1:3000'
DATA_DIR = os.path.join(os.path.dirname(__file__), 'data')
ICONS_DIR = os.path.join(DATA_DIR, 'hero_icons')
PORTRAITS_DIR = os.path.join(DATA_DIR, 'hero_portraits')
ITEM_ICONS_DIR = os.path.join(DATA_DIR, 'item_icons')
HEROES_JSON = os.path.join(DATA_DIR, 'heroes.json')

# Windows Desktop API
user32 = getattr(ctypes, 'windll', None).user32 if hasattr(ctypes, 'windll') else None

def attach_thread_desktop():
    if not user32:
        return False
    try:
        hdesk = user32.OpenInputDesktop(0, False, 0x01FF)
        if hdesk:
            user32.SetThreadDesktop(hdesk)
            return True
    except Exception:
        pass
    return False

def get_dota_window_rect():
    """Finds Dota 2 window client bounds, or defaults to 1920x1080 on primary monitor."""
    if not user32:
        return (0, 0, 1920, 1080, False)

    hwnd = user32.FindWindowW('Valve001', 'Dota 2')
    if not hwnd:
        hwnd = user32.FindWindowW(None, 'Dota 2')
    
    if hwnd and user32.IsWindowVisible(hwnd):
        rect = wintypes.RECT()
        if user32.GetClientRect(hwnd, ctypes.byref(rect)):
            pt = wintypes.POINT(0, 0)
            user32.ClientToScreen(hwnd, ctypes.byref(pt))
            w = rect.right - rect.left
            h = rect.bottom - rect.top
            if w >= 800 and h >= 600:
                return (pt.x, pt.y, w, h, True)

    # Fallback to primary display
    w = user32.GetSystemMetrics(0) or 1920
    h = user32.GetSystemMetrics(1) or 1080
    return (0, 0, w, h, False)

class TemplateManager:
    """Caches hero and item templates for fast NCC matching."""
    def __init__(self):
        self.portraits = {}     # name -> np.ndarray (66x38 BGR)
        self.icons = {}         # name -> (bgr, alpha_mask)
        self.items = {}         # item_key -> np.ndarray (40x28 BGR)
        self.levels = {}        # level (1-30) -> np.ndarray (26x24 gray)
        self.hero_metadata = {}
        self.load_metadata()
        self.load_templates()

    def load_metadata(self):
        if os.path.exists(HEROES_JSON):
            try:
                with open(HEROES_JSON, 'r', encoding='utf-8') as f:
                    self.hero_metadata = json.load(f)
            except Exception as e:
                print(f'[VISION] Error loading heroes.json: {e}', flush=True)

    def load_templates(self):
        print('[VISION] Loading hero and item template cache...', flush=True)
        # 1. Portraits for Top Bar
        if os.path.exists(PORTRAITS_DIR):
            for file in os.listdir(PORTRAITS_DIR):
                if file.endswith('.png'):
                    clean_name = file[:-4]
                    p = os.path.join(PORTRAITS_DIR, file)
                    img = cv2.imread(p, cv2.IMREAD_COLOR)
                    if img is not None:
                        h, w = img.shape[:2]
                        crop = img[:, int(w*0.08):int(w*0.92)]
                        resized = cv2.resize(crop, (66, 38))
                        self.portraits[clean_name] = resized

        # 2. Icons for Minimap
        if os.path.exists(ICONS_DIR):
            for file in os.listdir(ICONS_DIR):
                if file.endswith('.png'):
                    clean_name = file[:-4]
                    p = os.path.join(ICONS_DIR, file)
                    img = cv2.imread(p, cv2.IMREAD_UNCHANGED)
                    if img is not None and img.shape[2] == 4:
                        icon_small = cv2.resize(img, (24, 24))
                        b, g, r, a = cv2.split(icon_small)
                        bgr = cv2.merge([b, g, r])
                        self.icons[clean_name] = (bgr, a)

        # 3. Item Icons for Scoreboard Tracking (28 Threat Items)
        if os.path.exists(ITEM_ICONS_DIR):
            for file in os.listdir(ITEM_ICONS_DIR):
                if file.endswith('.png'):
                    item_key = file[:-4]
                    p = os.path.join(ITEM_ICONS_DIR, file)
                    img = cv2.imread(p, cv2.IMREAD_COLOR)
                    if img is not None:
                        self.items[item_key] = cv2.resize(img, (40, 28))

        # 4. Pre-rendered Level Templates (1 to 30) for Instant OCR
        from PIL import Image, ImageDraw
        for lvl in range(1, 31):
            t = Image.new('L', (26, 24), color=0)
            tdraw = ImageDraw.Draw(t)
            txt = str(lvl)
            x_pos = 9 if len(txt) == 1 else 5
            tdraw.text((x_pos, 4), txt, fill=255)
            self.levels[lvl] = np.array(t)

        print(f'[VISION] Loaded {len(self.portraits)} portraits, {len(self.icons)} minimap icons, {len(self.items)} item templates, and 30 level templates.', flush=True)

    def get_clean_name(self, hero_name: str) -> str:
        return hero_name.replace('npc_dota_hero_', '').lower()

class VisionAgent:
    def __init__(self):
        self.templates = TemplateManager()
        self.running = True
        self.last_match_id = None
        self.current_enemies = []       # list of clean names, e.g. ['pudge', 'lion', ...]
        self.player_team = 'radiant'
        self.clock_time = 0
        self.game_state = 'INIT'
        self.last_sightings = {}        # hero_name -> (x, y, timestamp)
        self.fps = 0.0
        self.dota_found = False

    def query_server_state(self):
        """Fetches the latest GSI & WorldModel state from local server."""
        try:
            req = urllib.request.Request(f'{SERVER_BASE}/api/state')
            with urllib.request.urlopen(req, timeout=1.0) as resp:
                data = json.loads(resp.read().decode('utf-8'))
                state = data.get('state', {})
                model = data.get('worldModel', {})

                gsi_map = state.get('map', {})
                self.clock_time = gsi_map.get('clock_time', 0)
                self.game_state = gsi_map.get('game_state', 'INIT')
                current_match = gsi_map.get('matchid', '')

                if current_match and current_match != self.last_match_id:
                    print(f'[VISION] Match changed ({self.last_match_id} -> {current_match}). Resetting enemies.', flush=True)
                    self.last_match_id = current_match
                    self.current_enemies = []
                    self.last_sightings.clear()

                player_obj = model.get('player', {})
                if player_obj.get('team'):
                    self.player_team = player_obj.get('team', 'radiant').lower()

                # Sync any existing enemies from model
                existing_enemies = model.get('enemies', {})
                if existing_enemies and not self.current_enemies:
                    self.current_enemies = [
                        e.replace('npc_dota_hero_', '').lower()
                        for e in existing_enemies.keys()
                    ][:5]
        except Exception:
            pass

    def send_enemies_setup(self, heroes):
        """Sends detected draft / top bar heroes to server."""
        payload = json.dumps({'heroes': heroes}).encode('utf-8')
        try:
            req = urllib.request.Request(
                f'{SERVER_BASE}/api/enemies/setup',
                data=payload,
                headers={'Content-Type': 'application/json'}
            )
            urllib.request.urlopen(req, timeout=1.0)
            print(f'[VISION] Successfully established enemy team: {heroes}', flush=True)
        except Exception as e:
            print(f'[VISION] Failed to setup enemies on server: {e}', flush=True)

    def send_sightings(self, sightings=None, anonymous_contacts=None):
        """Sends minimap sightings and anonymous contacts to server."""
        if not sightings and not anonymous_contacts:
            return
        payload = json.dumps({
            'sightings': sightings or [],
            'anonymousContacts': anonymous_contacts or []
        }).encode('utf-8')
        try:
            req = urllib.request.Request(
                f'{SERVER_BASE}/api/vision/sightings',
                data=payload,
                headers={'Content-Type': 'application/json'}
            )
            urllib.request.urlopen(req, timeout=1.0)
        except Exception:
            pass

    def send_heartbeat(self):
        """Sends heartbeat every 2s so dashboard shows active vision status."""
        while self.running:
            try:
                payload = json.dumps({
                    'fps': round(self.fps, 1),
                    'dotaFound': self.dota_found
                }).encode('utf-8')
                req = urllib.request.Request(
                    f'{SERVER_BASE}/api/vision/heartbeat',
                    data=payload,
                    headers={'Content-Type': 'application/json'}
                )
                urllib.request.urlopen(req, timeout=1.0)
            except Exception:
                pass
            time.sleep(2.0)

    def detect_top_bar_enemies(self, win_x, win_y, win_w, win_h):
        """Scans the top bar enemy hero slots to identify 5 enemy heroes."""
        # Top bar normalized span
        # If player is Radiant, enemies are Dire (slots 0-4 on the right: ~0.518 to ~0.720)
        # If player is Dire, enemies are Radiant (slots 0-4 on the left: ~0.280 to ~0.482)
        is_radiant = (self.player_team == 'radiant')
        x_start_ratio = 0.518 if is_radiant else 0.280
        x_end_ratio = 0.720 if is_radiant else 0.482
        y_start_ratio = 0.002
        y_end_ratio = 0.040

        left = int(win_x + x_start_ratio * win_w)
        top = int(win_y + y_start_ratio * win_h)
        width = int((x_end_ratio - x_start_ratio) * win_w)
        height = int((y_end_ratio - y_start_ratio) * win_h)

        if width <= 50 or height <= 15:
            return

        try:
            grab = ImageGrab.grab(bbox=(left, top, left + width, top + height), all_screens=True)
            top_bar_bgr = cv2.cvtColor(np.array(grab), cv2.COLOR_RGB2BGR)
        except Exception:
            return

        slot_w = width / 5.0
        detected = []

        for i in range(5):
            sx1 = int(i * slot_w)
            sx2 = int((i + 1) * slot_w)
            slot = top_bar_bgr[:, sx1:sx2]
            if slot.shape[0] < 10 or slot.shape[1] < 10:
                continue

            slot_resized = cv2.resize(slot, (66, 38))
            best_score = -1.0
            best_hero = None

            for h_name, tmpl in self.templates.portraits.items():
                res = cv2.matchTemplate(slot_resized, tmpl, cv2.TM_CCOEFF_NORMED)
                score = res[0][0]
                if score > best_score:
                    best_score = score
                    best_hero = h_name

            # Acceptance threshold for top bar hero match
            if best_hero and best_score >= 0.48:
                detected.append(best_hero)

        # If at least 3 distinct enemies detected, commit them!
        distinct = []
        for d in detected:
            if d not in distinct:
                distinct.append(d)

        if len(distinct) >= 3 and distinct != self.current_enemies:
            print(f'[VISION] Top bar detection identified {len(distinct)} enemies: {distinct}', flush=True)
            self.current_enemies = distinct
            self.send_enemies_setup(self.current_enemies)

    def scan_minimap_sightings(self, win_x, win_y, win_w, win_h):
        """Scans the minimap ROI for active enemy hero icons or color pings."""
        # Minimap normalized ROI (bottom-left standard)
        mx1 = int(win_x + 0.005 * win_w)
        mx2 = int(win_x + 0.155 * win_w)
        my1 = int(win_y + 0.740 * win_h)
        my2 = int(win_y + 0.995 * win_h)

        mw = mx2 - mx1
        mh = my2 - my1
        if mw < 50 or mh < 50:
            return

        try:
            grab = ImageGrab.grab(bbox=(mx1, my1, mx2, my2), all_screens=True)
            minimap_bgr = cv2.cvtColor(np.array(grab), cv2.COLOR_RGB2BGR)
        except Exception:
            return

        sightings = []
        now = time.time()

        # 1. Exact Hero Icon Match for active enemy heroes
        for h_name in self.current_enemies:
            if h_name not in self.templates.icons:
                continue
            icon_bgr, alpha_mask = self.templates.icons[h_name]
            
            # Match with alpha mask
            res = cv2.matchTemplate(minimap_bgr, icon_bgr, cv2.TM_CCORR_NORMED, mask=alpha_mask)
            min_val, max_val, min_loc, max_loc = cv2.minMaxLoc(res)

            if max_val >= 0.72:
                # Center of matched icon
                u = max_loc[0] + 12
                v = max_loc[1] + 12
                # Project to Source 2 World Units [-8200, 8200]
                world_x = round(-8200 + (u / mw) * 16400)
                world_y = round(8200 - (v / mh) * 16400)

                # Deduplicate: check if moved or 1s elapsed
                last = self.last_sightings.get(h_name)
                if not last or (now - last[2] >= 1.0) or (abs(world_x - last[0]) > 250 or abs(world_y - last[1]) > 250):
                    self.last_sightings[h_name] = (world_x, world_y, now)
                    full_name = f'npc_dota_hero_{h_name}'
                    sightings.append({
                        'heroName': full_name,
                        'x': world_x,
                        'y': world_y,
                        'confidence': round(float(max_val), 2),
                        'clockTime': self.clock_time
                    })

        # 2. Color Segmentation for Dire / Enemy Red dots (Anonymous Contacts)
        # Never arbitrarily assign an anonymous blip to a missing hero identity!
        anonymous_contacts = []
        hsv = cv2.cvtColor(minimap_bgr, cv2.COLOR_BGR2HSV)
        # Red color range (Dota enemy dots / hero arrows)
        m1 = cv2.inRange(hsv, np.array([0, 120, 120]), np.array([10, 255, 255]))
        m2 = cv2.inRange(hsv, np.array([170, 120, 120]), np.array([180, 255, 255]))
        red_mask = m1 | m2

        contours, _ = cv2.findContours(red_mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        for c in contours:
            area = cv2.contourArea(c)
            if 12 <= area <= 200: # Filter noise and huge UI frames
                M = cv2.moments(c)
                if M['m00'] > 0:
                    cx = int(M['m10'] / M['m00'])
                    cy = int(M['m01'] / M['m00'])
                    world_x = round(-8200 + (cx / mw) * 16400)
                    world_y = round(8200 - (cy / mh) * 16400)

                    # Do not duplicate if already matched as a known hero icon
                    is_near_identified = any(
                        abs(world_x - s['x']) <= 350 and abs(world_y - s['y']) <= 350
                        for s in sightings
                    )
                    if not is_near_identified:
                        anon_id = f'anon_{round(world_x / 400)}_{round(world_y / 400)}'
                        anonymous_contacts.append({
                            'id': anon_id,
                            'x': world_x,
                            'y': world_y,
                            'confidence': 0.75,
                            'clockTime': self.clock_time,
                            'source': 'cv_minimap_dot'
                        })

        if sightings or anonymous_contacts:
            self.send_sightings(sightings, anonymous_contacts)

    def send_scoreboard_update(self, updates):
        """Sends detected scoreboard items and levels to server."""
        if not updates:
            return
        payload = json.dumps(updates).encode('utf-8')
        try:
            req = urllib.request.Request(
                f'{SERVER_BASE}/api/vision/scoreboard',
                data=payload,
                headers={'Content-Type': 'application/json'}
            )
            urllib.request.urlopen(req, timeout=1.0)
        except Exception:
            pass

    def scan_scoreboard(self, win_x, win_y, win_w, win_h):
        """Scans the Dota 2 Scoreboard (Tab) to extract enemy items and levels."""
        now = time.time()
        if now - self.last_scoreboard_scan < 0.35:
            return
        self.last_scoreboard_scan = now

        # Crop central scoreboard region
        sb_x1 = int(win_x + 0.22 * win_w)
        sb_x2 = int(win_x + 0.78 * win_w)
        sb_y1 = int(win_y + 0.20 * win_h)
        sb_y2 = int(win_y + 0.80 * win_h)

        sb_w = sb_x2 - sb_x1
        sb_h = sb_y2 - sb_y1
        if sb_w < 400 or sb_h < 300:
            return

        try:
            grab = ImageGrab.grab(bbox=(sb_x1, sb_y1, sb_x2, sb_y2), all_screens=True)
            sb_bgr = cv2.cvtColor(np.array(grab), cv2.COLOR_RGB2BGR)
        except Exception:
            return

        is_radiant = (self.player_team == 'radiant')
        # Dire enemies in bottom rows (y ~ 54% to 84%), Radiant in top rows (y ~ 16% to 46%)
        y_start_ratio = 0.54 if is_radiant else 0.16
        y_end_ratio = 0.84 if is_radiant else 0.46
        row_span_h = (y_end_ratio - y_start_ratio) * sb_h
        row_h = row_span_h / 5.0

        updates = []

        for i in range(5):
            r_top = int(y_start_ratio * sb_h + i * row_h)
            r_bottom = int(r_top + row_h)
            if r_bottom > sb_h:
                break

            row_img = sb_bgr[r_top:r_bottom, :]
            if row_img.shape[0] < 15 or row_img.shape[1] < 200:
                continue

            hero_name = self.current_enemies[i] if i < len(self.current_enemies) else None
            if not hero_name:
                continue

            # 1. Level recognition (1 to 30)
            lvl_x1 = int(0.035 * sb_w)
            lvl_x2 = int(0.080 * sb_w)
            lvl_crop = row_img[:, lvl_x1:lvl_x2]
            detected_level = self.known_enemy_levels.get(hero_name, 1)

            if lvl_crop.shape[0] >= 16 and lvl_crop.shape[1] >= 16:
                lvl_gray = cv2.cvtColor(lvl_crop, cv2.COLOR_BGR2GRAY)
                lvl_resized = cv2.resize(lvl_gray, (26, 24))
                best_lvl = -1
                best_score = -1.0
                for l_val, l_tmpl in self.templates.levels.items():
                    res = cv2.matchTemplate(lvl_resized, l_tmpl, cv2.TM_CCOEFF_NORMED)
                    if res[0][0] > best_score:
                        best_score = res[0][0]
                        best_lvl = l_val
                if best_lvl > 0 and best_score >= 0.55:
                    detected_level = best_lvl
                    self.known_enemy_levels[hero_name] = detected_level

            # 2. 6 Item Slots
            items_x1 = int(0.38 * sb_w)
            items_x2 = int(0.62 * sb_w)
            items_w = items_x2 - items_x1
            slot_w = items_w / 6.0

            row_items = []
            for s in range(6):
                sx1 = int(items_x1 + s * slot_w)
                sx2 = int(items_x1 + (s + 1) * slot_w)
                slot = row_img[:, sx1:sx2]
                if slot.shape[0] < 10 or slot.shape[1] < 10:
                    continue

                if np.std(slot) < 18 or np.mean(slot) < 22:
                    continue

                slot_resized = cv2.resize(slot, (40, 28))
                best_item = None
                best_score = -1.0

                for item_key, tmpl in self.templates.items.items():
                    res = cv2.matchTemplate(slot_resized, tmpl, cv2.TM_CCOEFF_NORMED)
                    score = res[0][0]
                    if score > best_score:
                        best_score = score
                        best_item = item_key

                if best_item and best_score >= 0.60:
                    row_items.append(best_item)

            updates.append({
                'heroName': hero_name,
                'level': detected_level,
                'items': row_items,
                'clockTime': self.clock_time
            })

        if updates:
            self.send_scoreboard_update(updates)

    def run(self):
        print('[VISION] Starting VAC-Safe Dota 2 Vision Service...', flush=True)
        attach_thread_desktop()

        # Start background heartbeat thread
        hb_thread = threading.Thread(target=self.send_heartbeat, daemon=True)
        hb_thread.start()

        frame_count = 0
        fps_timer = time.time()
        state_poll_timer = 0

        while self.running:
            loop_start = time.perf_counter()
            attach_thread_desktop()

            # Poll GSI state from assistant server every 1.5s
            if time.time() - state_poll_timer > 1.5:
                self.query_server_state()
                state_poll_timer = time.time()

            # Locate Dota 2 window
            win_x, win_y, win_w, win_h, found = get_dota_window_rect()
            self.dota_found = found

            is_active_game = self.game_state in (
                'DOTA_GAMERULES_STATE_GAME_IN_PROGRESS',
                'DOTA_GAMERULES_STATE_PRE_GAME',
                'DOTA_GAMERULES_STATE_HERO_SELECTION'
            )

            # 1. Top Bar Hero Detection (Draft & in-game)
            if len(self.current_enemies) < 5 or self.game_state == 'DOTA_GAMERULES_STATE_HERO_SELECTION':
                self.detect_top_bar_enemies(win_x, win_y, win_w, win_h)

            # 2. Minimap Sightings Scan (during active game)
            if is_active_game and self.current_enemies:
                self.scan_minimap_sightings(win_x, win_y, win_w, win_h)

            # 3. Scoreboard Scan (triggered by Tab or periodic)
            tab_held = bool(user32.GetAsyncKeyState(0x09) & 0x8000)
            if is_active_game and self.current_enemies and (tab_held or (time.time() - self.last_scoreboard_scan > 6.0)):
                self.scan_scoreboard(win_x, win_y, win_w, win_h)

            frame_count += 1
            if time.time() - fps_timer >= 2.0:
                self.fps = frame_count / (time.time() - fps_timer)
                frame_count = 0
                fps_timer = time.time()

            # Throttle loop: ~3.5 FPS during match, ~1 FPS idle
            target_interval = 0.28 if is_active_game else 1.0
            elapsed = time.perf_counter() - loop_start
            sleep_duration = max(0.01, target_interval - elapsed)
            time.sleep(sleep_duration)

if __name__ == '__main__':
    agent = VisionAgent()
    try:
        agent.run()
    except KeyboardInterrupt:
        print('[VISION] Stopping Vision Service.', flush=True)
        agent.running = False
