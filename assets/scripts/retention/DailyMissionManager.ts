import { _decorator, Component } from 'cc';
import { WeChatService } from '../services/WeChatService';

const { ccclass } = _decorator;

// ------------------------------------------------------------------
// Types
// ------------------------------------------------------------------

export type MissionType =
  | 'catches_today'   // Accumulate catches across all sessions today
  | 'combo_session'   // Best combo reached in any session today
  | 'score_session'   // Best score reached in any session today
  | 'rounds_today'    // Number of rounds played today
  | 'new_highscore';  // Break personal best at least once today

export interface IMissionTemplate {
  type:        MissionType;
  target:      number;
  description: string;   // Chinese copy shown to the player
}

export interface IMission extends IMissionTemplate {
  /** Stable ID for storage: `type_target_YYYY-MM-DD` */
  id:        string;
  current:   number;
  completed: boolean;
}

// ------------------------------------------------------------------
// Mission pool — pick 3 per day ensuring no duplicate types
// ------------------------------------------------------------------

const MISSION_POOL: IMissionTemplate[] = [
  // Catch missions (easy → hard)
  { type: 'catches_today', target: 15,  description: '今天累计捕获15个物品'   },
  { type: 'catches_today', target: 30,  description: '今天累计捕获30个物品'   },
  { type: 'catches_today', target: 50,  description: '今天累计捕获50个物品'   },
  // Combo missions
  { type: 'combo_session', target: 4,   description: '单局达到4连击'           },
  { type: 'combo_session', target: 7,   description: '单局达到7连击'           },
  { type: 'combo_session', target: 10,  description: '单局达到10连击'          },
  // Score missions
  { type: 'score_session', target: 250, description: '单局得分超过250'         },
  { type: 'score_session', target: 500, description: '单局得分超过500'         },
  { type: 'score_session', target: 900, description: '单局得分超过900'         },
  // Round count missions
  { type: 'rounds_today',  target: 3,   description: '今天完成3局游戏'         },
  { type: 'rounds_today',  target: 5,   description: '今天完成5局游戏'         },
  // High-score challenge (binary — counts as completed when isNewHighScore = true)
  { type: 'new_highscore', target: 1,   description: '今天打破个人最佳成绩'    },
];

const MISSIONS_PER_DAY = 3;
const STORAGE_KEY_DATE = 'wg_mission_date';
const STORAGE_KEY_DATA = 'wg_mission_data';

/**
 * Bonus spawns granted when reaching N completed missions.
 * Indexed as "reaching this total triggers this reward once".
 */
const COMPLETION_TIER_REWARDS: Record<number, number> = {
  1: 2,  // Complete 1 mission → +2 bonus spawns
  2: 3,  // Complete 2 missions → +3 more bonus spawns
  3: 5,  // Complete all 3 → +5 more bonus spawns (total 10 for full sweep)
};

// ------------------------------------------------------------------
// Manager
// ------------------------------------------------------------------

/**
 * DailyMissionManager — generates and tracks 3 daily missions.
 *
 * Missions are generated fresh each calendar day and persisted in
 * local storage.  Progress accumulates across sessions within the day.
 *
 * Pattern (same as AchievementManager): `lastSessionCompleted` is a static
 * field set by GameManager in `_onEnterResult()`.  ResultSceneUI reads it
 * after scene load to display mission completion toasts.
 *
 * Reward: completing missions yields bonus spawns via
 * `DailyRewardManager.pendingBonusSpawns`.  Each tier (1/2/3 missions)
 * grants spawns once — GameManager tracks which tiers have been rewarded
 * using `lastRewardedTier`.
 */
@ccclass('DailyMissionManager')
export class DailyMissionManager extends Component {
  private static _instance: DailyMissionManager | null = null;
  private _missions: IMission[] = [];

  /**
   * Newly-completed missions from the last `checkSession()` call.
   * Set by GameManager; read by ResultSceneUI for toast display.
   */
  static lastSessionCompleted: IMission[] = [];

  /**
   * Highest completion tier already rewarded this calendar day.
   * Prevents double-awarding if the player loads the game multiple times.
   * Persisted in memory only (resets when app is killed, which is fine —
   * the per-day flag is recovered by comparing completedCount to this value).
   */
  static lastRewardedTier: number = 0;

  static get instance(): DailyMissionManager | null { return DailyMissionManager._instance; }

  onLoad(): void {
    DailyMissionManager._instance = this;
    this._loadOrGenerate();
  }

  onDestroy(): void {
    if (DailyMissionManager._instance === this) DailyMissionManager._instance = null;
  }

  get missions(): readonly IMission[] { return this._missions; }

  get completedCount(): number {
    return this._missions.filter(m => m.completed).length;
  }

  get allCompleted(): boolean {
    return this._missions.every(m => m.completed);
  }

  /**
   * Returns the bonus spawns earned by newly-completed tiers since the last
   * reward was given.  Advances `lastRewardedTier` so the same tier is never
   * double-counted even across multiple sessions on the same day.
   */
  collectNewTierRewards(): number {
    const current = this.completedCount;
    let total = 0;
    for (let tier = DailyMissionManager.lastRewardedTier + 1; tier <= current; tier++) {
      total += COMPLETION_TIER_REWARDS[tier] ?? 0;
    }
    DailyMissionManager.lastRewardedTier = Math.max(DailyMissionManager.lastRewardedTier, current);
    return total;
  }

  /**
   * Called at session end.  Returns array of IMission newly completed this
   * session (may be empty).  Saves progress to storage.
   *
   * @param sessionCatches   objectsCaught this session
   * @param sessionMaxCombo  maxComboReached this session
   * @param sessionScore     currentScore this session
   * @param isNewHighScore   whether player beat personal best this session
   */
  checkSession(
    sessionCatches:   number,
    sessionMaxCombo:  number,
    sessionScore:     number,
    isNewHighScore:   boolean,
  ): IMission[] {
    const newlyCompleted: IMission[] = [];

    for (const m of this._missions) {
      if (m.completed) continue;

      switch (m.type) {
        case 'catches_today':
          m.current += sessionCatches;
          break;
        case 'combo_session':
          m.current = Math.max(m.current, sessionMaxCombo);
          break;
        case 'score_session':
          m.current = Math.max(m.current, sessionScore);
          break;
        case 'rounds_today':
          m.current += 1;
          break;
        case 'new_highscore':
          if (isNewHighScore) m.current = 1;
          break;
        default: {
          // Exhaustive check: TypeScript will error here if a new MissionType is
          // added to the union without a corresponding case.
          const _check: never = m.type;
          console.warn('[DailyMissionManager] Unhandled mission type:', _check);
        }
      }

      if (!m.completed && m.current >= m.target) {
        m.completed = true;
        newlyCompleted.push(m);
      }
    }

    this._saveData();
    return newlyCompleted;
  }

  // ------------------------------------------------------------------
  // Private
  // ------------------------------------------------------------------

  private _loadOrGenerate(): void {
    const todayStr   = this._todayDateStr();
    const storedDate = WeChatService.instance?.loadFromStorage<string>(STORAGE_KEY_DATE);

    if (storedDate === todayStr) {
      const data = WeChatService.instance?.loadFromStorage<IMission[]>(STORAGE_KEY_DATA);
      if (data && data.length === MISSIONS_PER_DAY) {
        this._missions = data;
        // Sync lastRewardedTier to the already-completed count on re-launch
        DailyMissionManager.lastRewardedTier = this._missions.filter(m => m.completed).length;
        return;
      }
    }

    // New calendar day — generate fresh missions
    this._missions = this._generate(todayStr);
    DailyMissionManager.lastRewardedTier = 0;
    WeChatService.instance?.saveToStorage(STORAGE_KEY_DATE, todayStr);
    this._saveData();
  }

  private _generate(dateStr: string): IMission[] {
    // Shuffle pool and pick MISSIONS_PER_DAY with no duplicate types
    const shuffled   = [...MISSION_POOL].sort(() => Math.random() - 0.5);
    const picked: IMission[] = [];
    const usedTypes  = new Set<MissionType>();

    for (const tpl of shuffled) {
      if (usedTypes.has(tpl.type)) continue;
      usedTypes.add(tpl.type);
      picked.push({
        ...tpl,
        id:        `${tpl.type}_${tpl.target}_${dateStr}`,
        current:   0,
        completed: false,
      });
      if (picked.length >= MISSIONS_PER_DAY) break;
    }

    return picked;
  }

  private _saveData(): void {
    WeChatService.instance?.saveToStorage(STORAGE_KEY_DATA, this._missions);
  }

  private _todayDateStr(): string {
    const d = new Date();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${d.getFullYear()}-${m}-${day}`;
  }
}
