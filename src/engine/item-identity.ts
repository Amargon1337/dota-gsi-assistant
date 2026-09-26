export interface ItemDefinition {
  id: string;
  cleanName: string;
  cost: number;
  aliases: string[];
  upgradedFrom?: string[];
}

const ITEM_REGISTRY: Record<string, ItemDefinition> = {
  power_treads: {
    id: 'power_treads',
    cleanName: 'Power Treads',
    cost: 1400,
    aliases: ['pt', 'treads', 'power_treads'],
    upgradedFrom: ['boots'],
  },
  phase_boots: {
    id: 'phase_boots',
    cleanName: 'Phase Boots',
    cost: 1500,
    aliases: ['phase', 'phase_boots'],
    upgradedFrom: ['boots'],
  },
  tranquil_boots: {
    id: 'tranquil_boots',
    cleanName: 'Tranquil Boots',
    cost: 925,
    aliases: ['tranquil', 'tranquils', 'tranquil_boots'],
    upgradedFrom: ['boots'],
  },
  travel_boots: {
    id: 'travel_boots',
    cleanName: 'Boots of Travel',
    cost: 2500,
    aliases: ['travels', 'boots_of_travel', 'travel_boots', 'travel_boots_2'],
    upgradedFrom: ['boots'],
  },
  battlefury: {
    id: 'battlefury',
    cleanName: 'Battle Fury',
    cost: 4100,
    aliases: ['bfury', 'battle_fury', 'battlefury'],
  },
  yasha: {
    id: 'yasha',
    cleanName: 'Yasha',
    cost: 2050,
    aliases: ['yasha'],
  },
  manta: {
    id: 'manta',
    cleanName: 'Manta Style',
    cost: 4600,
    aliases: ['manta', 'manta_style'],
    upgradedFrom: ['yasha'],
  },
  sange_and_yasha: {
    id: 'sange_and_yasha',
    cleanName: 'Sange and Yasha',
    cost: 4100,
    aliases: ['sny', 'sange_and_yasha'],
    upgradedFrom: ['yasha'],
  },
  dragon_lance: {
    id: 'dragon_lance',
    cleanName: 'Dragon Lance',
    cost: 1900,
    aliases: ['lance', 'dragon_lance'],
  },
  hurricane_pike: {
    id: 'hurricane_pike',
    cleanName: 'Hurricane Pike',
    cost: 4450,
    aliases: ['pike', 'hurricane_pike'],
    upgradedFrom: ['dragon_lance', 'force_staff'],
  },
  black_king_bar: {
    id: 'black_king_bar',
    cleanName: 'Black King Bar',
    cost: 4050,
    aliases: ['bkb', 'black_king_bar'],
  },
  butterfly: {
    id: 'butterfly',
    cleanName: 'Butterfly',
    cost: 5450,
    aliases: ['butterfly'],
  },
  satanic: {
    id: 'satanic',
    cleanName: 'Satanic',
    cost: 5050,
    aliases: ['satanic'],
  },
  blink: {
    id: 'blink',
    cleanName: 'Blink Dagger',
    cost: 2250,
    aliases: ['blink', 'blink_dagger'],
  },
  swift_blink: {
    id: 'swift_blink',
    cleanName: 'Swift Blink',
    cost: 6800,
    aliases: ['swift_blink'],
    upgradedFrom: ['blink'],
  },
  overwhelming_blink: {
    id: 'overwhelming_blink',
    cleanName: 'Overwhelming Blink',
    cost: 6800,
    aliases: ['overwhelming_blink'],
    upgradedFrom: ['blink'],
  },
  arcane_blink: {
    id: 'arcane_blink',
    cleanName: 'Arcane Blink',
    cost: 6800,
    aliases: ['arcane_blink'],
    upgradedFrom: ['blink'],
  },
  basher: {
    id: 'basher',
    cleanName: 'Skull Basher',
    cost: 2875,
    aliases: ['basher', 'skull_basher'],
  },
  abyssal_blade: {
    id: 'abyssal_blade',
    cleanName: 'Abyssal Blade',
    cost: 6250,
    aliases: ['abyssal', 'abyssal_blade'],
    upgradedFrom: ['basher'],
  },
  aghanims_scepter: {
    id: 'aghanims_scepter',
    cleanName: "Aghanim's Scepter",
    cost: 4200,
    aliases: ['scepter', 'aghs', 'aghanims_scepter', 'ultimate_scepter'],
  },
  nullifier: {
    id: 'nullifier',
    cleanName: 'Nullifier',
    cost: 4375,
    aliases: ['nullifier'],
  },
  silver_edge: {
    id: 'silver_edge',
    cleanName: 'Silver Edge',
    cost: 5450,
    aliases: ['silver_edge'],
    upgradedFrom: ['shadow_blade'],
  },
  shadow_blade: {
    id: 'shadow_blade',
    cleanName: 'Shadow Blade',
    cost: 3000,
    aliases: ['invis', 'shadow_blade', 'sb'],
  },
  skadi: {
    id: 'skadi',
    cleanName: 'Eye of Skadi',
    cost: 5300,
    aliases: ['skadi', 'eye_of_skadi'],
  },
  harpoon: {
    id: 'harpoon',
    cleanName: 'Harpoon',
    cost: 4500,
    aliases: ['harpoon'],
    upgradedFrom: ['echo_sabre'],
  },
  refresher: {
    id: 'refresher',
    cleanName: 'Refresher Orb',
    cost: 5000,
    aliases: ['refresher', 'refresher_orb'],
  },
  shivas_guard: {
    id: 'shivas_guard',
    cleanName: "Shiva's Guard",
    cost: 5175,
    aliases: ['shiva', 'shivas_guard'],
  },
};

export class ItemIdentity {
  public static normalizeItemId(raw: string): string {
    const clean = raw
      .toLowerCase()
      .replace(/^item_/, '')
      .replace(/[^a-z0-9_]/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_|_$/g, '')
      .trim();

    // Check registry directly or through aliases
    if (ITEM_REGISTRY[clean]) return ITEM_REGISTRY[clean].id;

    for (const def of Object.values(ITEM_REGISTRY)) {
      if (def.aliases.includes(clean)) return def.id;
    }

    return clean;
  }

  public static getCleanName(raw: string): string {
    const id = this.normalizeItemId(raw);
    if (ITEM_REGISTRY[id]) return ITEM_REGISTRY[id].cleanName;
    return id
      .replace(/_/g, ' ')
      .replace(/\b\w/g, (c) => c.toUpperCase());
  }

  public static getItemCost(raw: string): number {
    const id = this.normalizeItemId(raw);
    return ITEM_REGISTRY[id]?.cost ?? 2000;
  }

  /**
   * Strictly determines if a target item (e.g. 'black_king_bar' or 'BKB')
   * is present in the player's inventory.
   *
   * CRITICAL DOMAIN RULE:
   * Phase Boots != Power Treads
   * Tranquil Boots != Power Treads
   * Travel Boots != Power Treads
   * Items are distinct and not artificially equated!
   */
  public static isExactItemPurchased(targetItem: string, inventory: string[]): boolean {
    const targetId = this.normalizeItemId(targetItem);
    const targetDef = ITEM_REGISTRY[targetId];

    const targetAliases = targetDef ? targetDef.aliases : [targetId];

    return inventory.some((invItem) => {
      const invId = this.normalizeItemId(invItem);
      if (invId === targetId) return true;

      const invDef = ITEM_REGISTRY[invId];
      if (invDef && targetAliases.some((alias) => invDef.aliases.includes(alias))) {
        return true;
      }

      // If inventory contains an upgraded version of the target item (e.g. Manta Style contains Yasha,
      // Hurricane Pike contains Dragon Lance, Abyssal contains Basher, Swift Blink contains Blink)
      if (invDef?.upgradedFrom?.includes(targetId)) {
        return true;
      }

      return false;
    });
  }
}
