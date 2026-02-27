import { _decorator, Component } from 'cc';
import { WeChatService } from '../services/WeChatService';

const { ccclass } = _decorator;

// ------------------------------------------------------------------
// Types
// ------------------------------------------------------------------

export type AchievementMetric =
  | 'total_catches'   // Cumulative across all sessions
  | 'max_combo'       // Best single-session combo ever achieved
  | 'score'           // Best single-session score ever achieved
  | 'games_played'    // Cumulative games played (from playerData)
  | 'streak_days';    // Current daily login streak

export interface IAchievementDef {
  id:           string;
  title:        string;        // Display name (Chinese)
  description:  string;        // One-line requirement (Chinese)
  icon:         string;        // Emoji for result screen toast
  type:         'cumulative' | 'single_session';
  metric:       AchievementMetric;
  target:       number;
  /** Bonus spawns injected into DailyRewardManager.pendingBonusSpawns on unlock. */
  rewardSpawns: number;
}

export interface IAchievementState {
  current:     number;
  unlocked:    boolean;
  unlockedAt?: number;  // unix timestamp ms
}

// ------------------------------------------------------------------
// Achievement catalogue (12 total)
// ------------------------------------------------------------------

export const ACHIEVEMENTS: readonly IAchievementDef[] = [
  // Cumulative catch milestones
  { id: 'catches_50',   title: '初入江湖',   description: '累计捕获50个物品',    icon: '🎣', type: 'cumulative',     metric: 'total_catches', target: 50,   rewardSpawns: 3  },
  { id: 'catches_500',  title: '百战老兵',   description: '累计捕获500个物品',   icon: '🎣', type: 'cumulative',     metric: 'total_catches', target: 500,  rewardSpawns: 5  },
  { id: 'catches_2000', title: '钓鱼传说',   description: '累计捕获2000个物品',  icon: '🏅', type: 'cumulative',     metric: 'total_catches', target: 2000, rewardSpawns: 10 },
  // Games played milestones
  { id: 'games_10',     title: '入门选手',   description: '累计完成10局游戏',    icon: '🎮', type: 'cumulative',     metric: 'games_played',  target: 10,   rewardSpawns: 3  },
  { id: 'games_50',     title: '资深玩家',   description: '累计完成50局游戏',    icon: '🎮', type: 'cumulative',     metric: 'games_played',  target: 50,   rewardSpawns: 5  },
  // Login streak milestones
  { id: 'streak_3',     title: '签到达人',   description: '连续签到3天',         icon: '📅', type: 'cumulative',     metric: 'streak_days',   target: 3,    rewardSpawns: 3  },
  { id: 'streak_7',     title: '坚持不懈',   description: '连续签到7天',         icon: '🔥', type: 'cumulative',     metric: 'streak_days',   target: 7,    rewardSpawns: 10 },
  // Single-session combo milestones
  { id: 'combo_5',      title: '连击新星',   description: '单局达到5连击',       icon: '⚡', type: 'single_session', metric: 'max_combo',     target: 5,    rewardSpawns: 3  },
  { id: 'combo_10',     title: '连击王者',   description: '单局达到10连击',      icon: '💫', type: 'single_session', metric: 'max_combo',     target: 10,   rewardSpawns: 5  },
  // Single-session score milestones
  { id: 'score_300',    title: '初窥门径',   description: '单局得分超过300',     icon: '⭐', type: 'single_session', metric: 'score',         target: 300,  rewardSpawns: 3  },
  { id: 'score_800',    title: '分数大师',   description: '单局得分超过800',     icon: '🌟', type: 'single_session', metric: 'score',         target: 800,  rewardSpawns: 5  },
  { id: 'score_1500',   title: '传奇得分手', description: '单局得分超过1500',    icon: '👑', type: 'single_session', metric: 'score',         target: 1500, rewardSpawns: 10 },
];

const STORAGE_KEY = 'wg_ach_v1';

// ------------------------------------------------------------------
// Manager
// ------------------------------------------------------------------

/**
 * AchievementManager — tracks player achievement progress across sessions.
 *
 * Pattern: static `lastSessionUnlocked` holds newly-unlocked defs from the
 * most recent call to `checkSession()`.  ResultSceneUI reads this list after
 * the scene loads to show staggered unlock toasts without relying on EventBus
 * timing across scene boundaries.
 *
 * Storage: single JSON blob `wg_ach_v1` → Map<achievementId, IAchievementState>
 *
 * Node placement: MainScene root (persists via DontDestroyOnLoad equivalent —
 * or attach to a permanent node in each scene if using simple scene management).
 */
@ccclass('AchievementManager')
export class AchievementManager extends Component {
  private static _instance: AchievementManager | null = null;
  private _state: Map<string, IAchievementState> = new Map();

  /**
   * Newly-unlocked achievements from the last `checkSession()` call.
   * Set by GameManager in _onEnterResult(); read by ResultSceneUI on load.
   */
  static lastSessionUnlocked: IAchievementDef[] = [];

  static get instance(): AchievementManager | null { return AchievementManager._instance; }

  onLoad(): void {
    AchievementManager._instance = this;
    this._loadState();
  }

  onDestroy(): void {
    if (AchievementManager._instance === this) AchievementManager._instance = null;
  }

  /** Total number of achievements unlocked so far (for UI badge). */
  get unlockedCount(): number {
    let n = 0;
    for (const s of this._state.values()) if (s.unlocked) n++;
    return n;
  }

  /** Current progress state for a single achievement (safe default if not started). */
  getState(id: string): IAchievementState {
    return this._state.get(id) ?? { current: 0, unlocked: false };
  }

  /**
   * Evaluate progress after a game session.  Returns defs for every achievement
   * newly unlocked this session (may be empty).
   *
   * @param sessionCatches  objectsCaught this session
   * @param sessionMaxCombo maxComboReached this session
   * @param sessionScore    currentScore this session
   * @param totalGamesPlayed  pd.totalGamesPlayed AFTER incrementing for this round
   * @param streakDays      current login streak from DailyRewardManager
   */
  checkSession(
    sessionCatches:    number,
    sessionMaxCombo:   number,
    sessionScore:      number,
    totalGamesPlayed:  number,
    streakDays:        number,
  ): IAchievementDef[] {
    const unlocked: IAchievementDef[] = [];

    for (const def of ACHIEVEMENTS) {
      const s = this._ensureState(def.id);
      if (s.unlocked) continue;

      // Update the metric tracking this achievement
      switch (def.metric) {
        case 'total_catches':
          // Accumulate: add this session's catches to the running total
          s.current += sessionCatches;
          break;
        case 'max_combo':
          // Best single-session value ever
          s.current = Math.max(s.current, sessionMaxCombo);
          break;
        case 'score':
          // Best single-session score ever
          s.current = Math.max(s.current, sessionScore);
          break;
        case 'games_played':
          // Authoritative cumulative counter from playerData
          s.current = totalGamesPlayed;
          break;
        case 'streak_days':
          // Current streak (can drop if the player skips a day)
          s.current = streakDays;
          break;
      }

      if (s.current >= def.target) {
        s.unlocked   = true;
        s.unlockedAt = Date.now();
        unlocked.push(def);
      }
    }

    this._saveState();
    return unlocked;
  }

  // ------------------------------------------------------------------
  // Private
  // ------------------------------------------------------------------

  private _ensureState(id: string): IAchievementState {
    if (!this._state.has(id)) this._state.set(id, { current: 0, unlocked: false });
    return this._state.get(id)!;
  }

  private _loadState(): void {
    const raw = WeChatService.instance
      ?.loadFromStorage<Record<string, IAchievementState>>(STORAGE_KEY);
    if (!raw) return;
    for (const [id, s] of Object.entries(raw)) {
      this._state.set(id, s);
    }
  }

  private _saveState(): void {
    const obj: Record<string, IAchievementState> = {};
    for (const [id, s] of this._state.entries()) obj[id] = s;
    WeChatService.instance?.saveToStorage(STORAGE_KEY, obj);
  }
}
