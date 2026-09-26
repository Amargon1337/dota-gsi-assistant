import { D2PTDataStore, D2PTItemTiming, D2PTHeroMeta } from './d2pt-store';

export type ProItemTiming = D2PTItemTiming;
export type ProHeroBuild = D2PTHeroMeta;

export class ProTrackerService {
  public static normalizeHeroName(rawName: string): string {
    return D2PTDataStore.normalizeHeroName(rawName);
  }

  public static isItemPurchased(itemIdentifier: string, inventory: string[]): boolean {
    return D2PTDataStore.isItemPurchased(itemIdentifier, inventory);
  }

  public static getHeroBuild(cleanHeroName: string): ProHeroBuild | null {
    return D2PTDataStore.getHeroMeta(cleanHeroName);
  }

  public static determineNextTargetItem(
    heroName: string,
    inventory: string[],
    currentGold: number,
    gameClockSeconds: number
  ) {
    return D2PTDataStore.determineNextTargetItem(heroName, inventory, currentGold, gameClockSeconds);
  }

  public static buildProTrackerContextPrompt(
    heroName: string,
    inventory: string[],
    currentGold: number,
    gameClockSeconds: number
  ): string {
    return D2PTDataStore.buildD2PTContextPrompt(heroName, inventory, currentGold, gameClockSeconds);
  }
}
