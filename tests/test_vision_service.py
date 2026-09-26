import unittest
import numpy as np
import cv2
import os
import sys

# Add root to sys.path
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
from vision_service import TemplateManager, get_dota_window_rect

class TestVisionService(unittest.TestCase):
    def setUp(self):
        self.tm = TemplateManager()

    def test_templates_loaded(self):
        self.assertGreater(len(self.tm.portraits), 100, "Portraits should be loaded for 100+ heroes")
        self.assertGreater(len(self.tm.icons), 100, "Icons should be loaded for 100+ heroes")

    def test_minimap_projection_formula(self):
        # mw = 270, mh = 270
        mw = 270
        mh = 270

        # Center should map to (0, 0)
        u_center = mw / 2
        v_center = mh / 2
        world_x = round(-8200 + (u_center / mw) * 16400)
        world_y = round(8200 - (v_center / mh) * 16400)
        self.assertEqual(world_x, 0)
        self.assertEqual(world_y, 0)

        # Radiant base (bottom-left): u=0, v=mh
        u_rad = 0
        v_rad = mh
        world_x_rad = round(-8200 + (u_rad / mw) * 16400)
        world_y_rad = round(8200 - (v_rad / mh) * 16400)
        self.assertEqual(world_x_rad, -8200)
        self.assertEqual(world_y_rad, -8200)

        # Dire base (top-right): u=mw, v=0
        u_dire = mw
        v_dire = 0
        world_x_dire = round(-8200 + (u_dire / mw) * 16400)
        world_y_dire = round(8200 - (v_dire / mh) * 16400)
        self.assertEqual(world_x_dire, 8200)
        self.assertEqual(world_y_dire, 8200)

    def test_minimap_synthetic_icon_detection(self):
        # Create a mock minimap canvas
        minimap = np.full((270, 270, 3), 35, dtype=np.uint8)

        # Select a hero icon
        hero = 'pudge'
        self.assertIn(hero, self.tm.icons)
        icon_bgr, alpha_mask = self.tm.icons[hero]

        # Place icon at (120, 90)
        u_target = 120
        v_target = 90
        roi = minimap[v_target:v_target+24, u_target:u_target+24]
        mask_norm = alpha_mask / 255.0
        for c in range(3):
            roi[:, :, c] = (roi[:, :, c] * (1 - mask_norm) + icon_bgr[:, :, c] * mask_norm).astype(np.uint8)
        minimap[v_target:v_target+24, u_target:u_target+24] = roi

        # Run template match with alpha mask
        res = cv2.matchTemplate(minimap, icon_bgr, cv2.TM_CCORR_NORMED, mask=alpha_mask)
        _, max_val, _, max_loc = cv2.minMaxLoc(res)

        self.assertGreaterEqual(max_val, 0.70)
        self.assertEqual(max_loc[0], u_target)
        self.assertEqual(max_loc[1], v_target)

    def test_item_templates_loaded(self):
        self.assertGreaterEqual(len(self.tm.items), 27, "Threat items should be loaded for 27+ key items")
        self.assertIn('orchid', self.tm.items)
        self.assertIn('blink', self.tm.items)
        self.assertIn('black_king_bar', self.tm.items)

    def test_level_templates_loaded(self):
        self.assertEqual(len(self.tm.levels), 30, "Pre-rendered templates must cover levels 1 to 30")
        self.assertIn(6, self.tm.levels)
        self.assertIn(12, self.tm.levels)
        self.assertIn(18, self.tm.levels)

    def test_item_synthetic_matching(self):
        orchid_tmpl = self.tm.items['orchid']
        best_item = None
        best_score = -1.0
        for name, tmpl in self.tm.items.items():
            res = cv2.matchTemplate(orchid_tmpl, tmpl, cv2.TM_CCOEFF_NORMED)
            if res[0][0] > best_score:
                best_score = res[0][0]
                best_item = name
        self.assertEqual(best_item, 'orchid')
        self.assertGreaterEqual(best_score, 0.99)

    def test_level_synthetic_matching(self):
        lvl6_tmpl = self.tm.levels[6]
        best_lvl = -1
        best_score = -1.0
        for lvl, tmpl in self.tm.levels.items():
            res = cv2.matchTemplate(lvl6_tmpl, tmpl, cv2.TM_CCOEFF_NORMED)
            if res[0][0] > best_score:
                best_score = res[0][0]
                best_lvl = lvl
        self.assertEqual(best_lvl, 6)
        self.assertGreaterEqual(best_score, 0.99)

    def test_window_rect_does_not_crash(self):
        rect = get_dota_window_rect()
        self.assertEqual(len(rect), 5)
        self.assertGreaterEqual(rect[2], 800)
        self.assertGreaterEqual(rect[3], 600)

    def test_minimap_red_dot_anonymous_contact(self):
        # Create a synthetic minimap with a bright red blip
        minimap = np.full((270, 270, 3), 35, dtype=np.uint8)
        # Draw a 6x6 red dot at (150, 150)
        cv2.circle(minimap, (150, 150), 3, (0, 0, 255), -1)

        # Run red segmentation logic matching vision_service.py
        hsv = cv2.cvtColor(minimap, cv2.COLOR_BGR2HSV)
        m1 = cv2.inRange(hsv, np.array([0, 120, 120]), np.array([10, 255, 255]))
        m2 = cv2.inRange(hsv, np.array([170, 120, 120]), np.array([180, 255, 255]))
        red_mask = m1 | m2

        contours, _ = cv2.findContours(red_mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        anonymous_contacts = []
        mw, mh = 270, 270

        for c in contours:
            area = cv2.contourArea(c)
            if 12 <= area <= 200:
                M = cv2.moments(c)
                if M['m00'] > 0:
                    cx = int(M['m10'] / M['m00'])
                    cy = int(M['m01'] / M['m00'])
                    world_x = round(-8200 + (cx / mw) * 16400)
                    world_y = round(8200 - (cy / mh) * 16400)
                    anon_id = f'anon_{round(world_x / 400)}_{round(world_y / 400)}'
                    anonymous_contacts.append({
                        'id': anon_id,
                        'x': world_x,
                        'y': world_y,
                        'confidence': 0.75,
                        'source': 'cv_minimap_dot'
                    })

        self.assertEqual(len(anonymous_contacts), 1)
        self.assertEqual(anonymous_contacts[0]['confidence'], 0.75)
        self.assertEqual(anonymous_contacts[0]['source'], 'cv_minimap_dot')
        self.assertNotIn('heroName', anonymous_contacts[0])

if __name__ == '__main__':
    unittest.main()
