import { _decorator, Component } from 'cc';
import { WeChatService } from '../services/WeChatService';
import { AnalyticsService } from '../services/AnalyticsService';
import { EventBus, GameEvents } from '../utils/EventBus';

const { ccclass } = _decorator;

// Storage keys — all prefixed with 'wg_' per project convention
const DAILY_TS_KEY    = 'wg_daily_ts';     // timestamp of last FREE claim
const DAILY_STREAK_KEY = 'wg_daily_streak'; // current consecutive streak (number)
const DAILY_AD_TS_KEY  = 'wg_daily_ad_ts'; // timestamp of last AD BONUS claim

const ONE_DAY_MS   = 86_400_000;
const TWO_DAYS_MS  = ONE_DAY_MS * 2; // Grace window: streak breaks only if >2 days missed

// Bonus spawns granted per claim type
const FREE_BONUS_SPAWNS    = 5;  // Free daily claim: 5 extra bonus-gold spawns in next round
const AD_BONUS_SPAWNS      = 5;  // Ad bonus: +5 more (10 total for the day if both claimed)

export interface IDailyRewardState {
  /** Free daily reward available (not yet claimed today). */
  canClaimFree:    boolean;
  /** Ad bonus available (free claim done, ad not yet watched today). */
  canClaimAdBonus: boolean;
  /** Current consecutive login streak in days. */
  streakDays:      number;
  /** Bonus spawns currently queued for the next round. */
  bonusSpawnsPending: number;
  /** Milliseconds until the next daily reset (local midnight). */
  msUntilReset:    number;
}

/**
 * DailyRewardManager — daily login streak & bonus spawn injection system.
 *
 * Design:
 *  - "Day" is defined by local calendar date (midnight reset).
 *  - Streak increments each day a claim is made; breaks if >2 days are missed.
 *  - Two claim tiers per day:
 *      1. FREE:      claimDailyReward()  → +5 bonus_gold spawns next round
 *      2. AD BONUS:  claimAdBonus()      → +5 more (requires watching rewarded ad)
 *  - Bonus spawns are stored in `pendingBonusSpawns` (static, survives scene loads).
 *  - GameManager._onEnterPlaying() consumes them via consumePendingSpawns() and
 *    injects them as staggered FORCE_BONUS_SPAWN events during the round.
 *
 * Node assumptions: add as component on a persistent scene node (e.g. Canvas root).
 * MainSceneUI reads getState() to populate daily reward UI.
 */
@ccclass('DailyRewardManager')
export class DailyRewardManager extends Component {
  private static _instance: DailyRewardManager | null = null;

  /**
   * Bonus spawns queued for the next round.
   * Static so it survives scene transitions (MAIN → GAME).
   */
  static pendingBonusSpawns: number = 0;

  static get instance(): DailyRewardManager | null { return DailyRewardManager._instance; }

  onLoad(): void  { DailyRewardManager._instance = this; }
  onDestroy(): void {
    if (DailyRewardManager._instance === this) DailyRewardManager._instance = null;
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /** Return the current daily reward state for UI rendering. */
  getState(): IDailyRewardState {
    const now        = Date.now();
    const lastFreeTs = this._load<number>(DAILY_TS_KEY)    ?? 0;
    const lastAdTs   = this._load<number>(DAILY_AD_TS_KEY) ?? 0;
    const streak     = this._load<number>(DAILY_STREAK_KEY) ?? 0;
    const todayStart = this._todayStartMs();

    return {
      canClaimFree:       lastFreeTs  < todayStart,
      canClaimAdBonus:    lastFreeTs  >= todayStart && lastAdTs < todayStart,
      streakDays:         streak,
      bonusSpawnsPending: DailyRewardManager.pendingBonusSpawns,
      msUntilReset:       todayStart + ONE_DAY_MS - now,
    };
  }

  /**
   * Claim the free daily reward.
   * @returns true if successfully claimed, false if already claimed today.
   */
  claimDailyReward(): boolean {
    if (!this.getState().canClaimFree) return false;

    const now      = Date.now();
    const lastTs   = this._load<number>(DAILY_TS_KEY)    ?? 0;
    const streak   = this._load<number>(DAILY_STREAK_KEY) ?? 0;

    // Increment streak if claimed within grace window, else reset to 1
    const daysSinceLast = (now - lastTs) / ONE_DAY_MS;
    const newStreak     = (lastTs > 0 && now - lastTs <= TWO_DAYS_MS) ? streak + 1 : 1;

    this._save(DAILY_TS_KEY,     now);
    this._save(DAILY_STREAK_KEY, newStreak);

    DailyRewardManager.pendingBonusSpawns += FREE_BONUS_SPAWNS;

    AnalyticsService.instance?.track('daily_reward_claimed', {
      streak:      newStreak,
      bonusSpawns: FREE_BONUS_SPAWNS,
    });
    EventBus.emit(GameEvents.DAILY_REWARD_CLAIMED, {
      streak:      newStreak,
      bonusSpawns: FREE_BONUS_SPAWNS,
    });

    return true;
  }

  /**
   * Claim the ad bonus (call AFTER the rewarded ad returns GRANTED).
   * @returns true if successfully claimed, false if unavailable today.
   */
  claimAdBonus(): boolean {
    if (!this.getState().canClaimAdBonus) return false;

    this._save(DAILY_AD_TS_KEY, Date.now());
    DailyRewardManager.pendingBonusSpawns += AD_BONUS_SPAWNS;

    AnalyticsService.instance?.track('daily_ad_bonus_claimed', {
      bonusSpawns: AD_BONUS_SPAWNS,
    });
    EventBus.emit(GameEvents.DAILY_REWARD_CLAIMED, {
      isAdBonus:   true,
      bonusSpawns: AD_BONUS_SPAWNS,
    });

    return true;
  }

  /**
   * Consume all pending bonus spawns.
   * GameManager calls this at round start and schedules corresponding
   * FORCE_BONUS_SPAWN events into the new round.
   * @returns number of bonus spawns to inject.
   */
  static consumePendingSpawns(): number {
    const n = DailyRewardManager.pendingBonusSpawns;
    DailyRewardManager.pendingBonusSpawns = 0;
    return n;
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  /** Local-time midnight (00:00:00.000) for today as a timestamp. */
  private _todayStartMs(): number {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }

  private _load<T>(key: string): T | null {
    return WeChatService.instance?.loadFromStorage<T>(key) ?? null;
  }

  private _save(key: string, value: unknown): void {
    WeChatService.instance?.saveToStorage(key, value);
  }
}
