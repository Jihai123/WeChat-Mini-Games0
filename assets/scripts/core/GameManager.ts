import { _decorator, Component, director } from 'cc';
import { GameState } from '../enums/GameState';
import { SceneNames } from '../enums/SceneNames';
import { IPlayerData } from '../interfaces/IPlayerData';
import { ISessionResult } from '../interfaces/IScoreData';
import { IDifficultyLevel } from '../interfaces/IGameConfig';
import { EventBus, GameEvents } from '../utils/EventBus';
import { ScoreManager } from './ScoreManager';
import { ComboManager } from './ComboManager';
import { HookController } from '../gameplay/HookController';
import { ObjectSpawner } from '../gameplay/ObjectSpawner';
import { AnalyticsService } from '../services/AnalyticsService';
import { WeChatService } from '../services/WeChatService';
import { PrivacyManager } from '../services/PrivacyManager';
import { DailyRewardManager } from '../monetization/DailyRewardManager';
import { AdPlacementManager } from '../monetization/AdPlacementManager';
import { LeaderboardService } from '../social/LeaderboardService';
import { AchievementManager } from '../retention/AchievementManager';
import { DailyMissionManager } from '../retention/DailyMissionManager';
import {
  DEFAULT_GAME_CONFIG,
  STORAGE_KEYS,
  DIFFICULTY_TIME_BRACKETS,
} from '../data/GameConfig';
import { ISpawnObjectInstance } from '../interfaces/ISpawnObject';

const { ccclass, property } = _decorator;

/**
 * GameManager — top-level FSM and session orchestrator.
 *
 * FSM:  IDLE ──► LOADING ──► PLAYING ──⇄ PAUSED
 *                                 └──► RESULT
 *
 * Responsibilities:
 *  - Drive GameState transitions and broadcast GAME_STATE_CHANGE
 *  - Manage the countdown timer
 *  - Apply difficulty tier progression (easy→normal→hard) by time bracket
 *  - Coordinate FTUE detection (totalGamesPlayed === 0)
 *  - React to HOOK_CATCH / HOOK_MISS to update ComboManager + ScoreManager
 *  - Transition to ResultScene with the final ISessionResult
 *
 * All sibling component references are resolved via getComponent on the same
 * node, matching the GameScene root layout in ARCHITECTURE.md.
 */
@ccclass('GameManager')
export class GameManager extends Component {
  private static _instance: GameManager | null = null;

  /** Shared across scene loads so ResultScene can read the final result. */
  static lastSessionResult: ISessionResult | null = null;

  /** Shared player data loaded at the start of each session. */
  static playerData: IPlayerData | null = null;

  // ------------------------------------------------------------------
  // Inspector refs (assigned at design time or found at runtime)
  // ------------------------------------------------------------------

  @property(HookController)
  hookController: HookController | null = null;

  @property(ObjectSpawner)
  objectSpawner: ObjectSpawner | null = null;

  // ------------------------------------------------------------------
  // Internal state
  // ------------------------------------------------------------------

  private _state:               GameState = GameState.IDLE;
  private _sessionId:           string    = '';
  private _totalTime:           number    = DEFAULT_GAME_CONFIG.sessionDurationSeconds;
  private _timeLeft:            number    = 0;
  private _diffIdx:             number    = 0; // index into difficultyLevels[]
  private _pendingBonusSpawns:  number    = 0; // bonus spawns from DailyRewardManager to inject

  static get instance(): GameManager | null { return GameManager._instance; }
  get state():   GameState { return this._state; }
  get timeLeft(): number   { return this._timeLeft; }

  // ------------------------------------------------------------------
  // Lifecycle
  // ------------------------------------------------------------------

  onLoad(): void {
    GameManager._instance = this;

    EventBus.on(GameEvents.HOOK_CATCH, this._onHookCatch, this);
    EventBus.on(GameEvents.HOOK_MISS,  this._onHookMiss,  this);

    // Auto-start once the scene is fully loaded
    this._transitionTo(GameState.LOADING);
  }

  onDestroy(): void {
    if (GameManager._instance === this) GameManager._instance = null;
    EventBus.off(GameEvents.HOOK_CATCH, this._onHookCatch, this);
    EventBus.off(GameEvents.HOOK_MISS,  this._onHookMiss,  this);
  }

  // ------------------------------------------------------------------
  // Update
  // ------------------------------------------------------------------

  update(dt: number): void {
    if (this._state !== GameState.PLAYING) return;

    this._timeLeft -= dt;
    EventBus.emit(GameEvents.TIMER_TICK, {
      remaining: Math.max(0, this._timeLeft),
      total:     this._totalTime,
    });

    this._checkDifficultyRamp();

    if (this._timeLeft <= 0) {
      this._transitionTo(GameState.RESULT);
    }
  }

  // ------------------------------------------------------------------
  // FSM transitions
  // ------------------------------------------------------------------

  private _transitionTo(next: GameState): void {
    const prev = this._state;
    this._state = next;
    EventBus.emit(GameEvents.GAME_STATE_CHANGE, { prev, next });

    switch (next) {
      case GameState.LOADING:  this._onEnterLoading(); break;
      case GameState.PLAYING:  this._onEnterPlaying(); break;
      case GameState.PAUSED:   this._onEnterPaused();  break;
      case GameState.RESULT:   this._onEnterResult();  break;
      default: break;
    }
  }

  // ---------- LOADING ----------

  private async _onEnterLoading(): Promise<void> {
    this._sessionId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    this._diffIdx   = 0;

    // Count this as a new round for ad placement gating
    AdPlacementManager.recordRoundStart();

    // Load persisted player data (or create defaults for first-time player)
    let playerData = WeChatService.instance?.loadFromStorage<IPlayerData>(STORAGE_KEYS.PLAYER_DATA);
    if (!playerData) {
      playerData = {
        playerId:            this._sessionId,
        displayName:         'Player',
        avatarUrl:           '',
        highScore:           0,
        totalGamesPlayed:    0,
        lastPlayedTimestamp: Date.now(),
      };
    }

    // Validate numeric fields to guard against corrupted storage data (MED-03)
    if (typeof playerData.highScore !== 'number' || !isFinite(playerData.highScore) || playerData.highScore < 0) {
      playerData.highScore = 0;
    }
    if (typeof playerData.totalGamesPlayed !== 'number' || !isFinite(playerData.totalGamesPlayed) || playerData.totalGamesPlayed < 0) {
      playerData.totalGamesPlayed = 0;
    }

    // Obtain WeChat privacy consent before accessing any personal data (REJECT-03).
    // Required since 2023-09-15 — automatic rejection if skipped.
    const consentGranted = await PrivacyManager.ensureConsent();
    if (!this.isValid) return; // Scene may have been unloaded during the consent popup

    // Attempt to refresh display name / avatar from WeChat (non-blocking)
    if (consentGranted) {
      try {
        const info = await WeChatService.instance?.getUserInfo();
        if (!this.isValid) return; // Guard after async call
        if (info) {
          playerData.displayName = info.nickName;
          playerData.avatarUrl   = info.avatarUrl;
        }
      } catch { /* permission denied — use stored name */ }
    }

    GameManager.playerData = playerData;

    // Initialise subsystems
    AnalyticsService.instance?.init(this._sessionId);
    ScoreManager.instance?.init(this._sessionId);
    ComboManager.instance?.reset();

    const isFTUE     = playerData.totalGamesPlayed === 0;
    const difficulty = DEFAULT_GAME_CONFIG.difficultyLevels[0];
    this.objectSpawner?.init(isFTUE, difficulty);

    // Consume bonus spawns from DailyRewardManager (claimed on main menu).
    // They will be injected as staggered FORCE_BONUS_SPAWN events in _onEnterPlaying.
    this._pendingBonusSpawns = DailyRewardManager.consumePendingSpawns();

    // sessionId omitted from params — it is a pseudonymous ID and logging it
    // in event params may create a cross-session tracking vector (MED-04)
    AnalyticsService.instance?.track('session_start', {
      isFTUE:       isFTUE,
      gamesPlayed:  playerData.totalGamesPlayed,
      bonusSpawns:  this._pendingBonusSpawns,
    });

    // Short artificial delay so the loading UI can display
    this.scheduleOnce(() => this._transitionTo(GameState.PLAYING), 0.3);
  }

  // ---------- PLAYING ----------

  private _onEnterPlaying(): void {
    this._timeLeft  = this._totalTime;
    this.hookController?.reset();
    this.hookController?.setInputEnabled(true);

    // Inject daily-bonus spawns as staggered FORCE_BONUS_SPAWN events.
    // First spawn at 3s (let the player see the round start), then every 4s.
    // Guard: only emit if still in PLAYING state (not paused/ended).
    if (this._pendingBonusSpawns > 0) {
      for (let i = 0; i < this._pendingBonusSpawns; i++) {
        this.scheduleOnce(() => {
          if (this._state === GameState.PLAYING) {
            EventBus.emit(GameEvents.FORCE_BONUS_SPAWN, undefined);
          }
        }, 3.0 + i * 4.0);
      }
      this._pendingBonusSpawns = 0;
    }
  }

  // ---------- PAUSED ----------

  private _onEnterPaused(): void {
    this.hookController?.setInputEnabled(false);
  }

  /** Resume from pause (called by PauseUI button). */
  resume(): void {
    if (this._state !== GameState.PAUSED) return;
    this.hookController?.setInputEnabled(true);
    this._transitionTo(GameState.PLAYING);
  }

  /** Pause (called by BtnPause). */
  pause(): void {
    if (this._state !== GameState.PLAYING) return;
    this._transitionTo(GameState.PAUSED);
  }

  // ---------- RESULT ----------

  private _onEnterResult(): void {
    this.hookController?.setInputEnabled(false);
    this.objectSpawner?.stop();

    const pd = GameManager.playerData!;
    const result = ScoreManager.instance?.finalise(pd.displayName, pd.avatarUrl)
      ?? { scoreData: { sessionId: '', currentScore: 0, highScore: 0, comboCount: 0, maxComboReached: 0, objectsCaught: 0, objectsMissed: 0, sessionDurationMs: 0 }, isNewHighScore: false, playerDisplayName: pd.displayName, playerAvatarUrl: pd.avatarUrl };

    GameManager.lastSessionResult = result;

    // Persist updated player data
    pd.totalGamesPlayed++;
    pd.lastPlayedTimestamp = Date.now();
    if (result.isNewHighScore) pd.highScore = result.scoreData.currentScore;
    WeChatService.instance?.saveToStorage(STORAGE_KEYS.PLAYER_DATA, pd);

    // ── Achievements ────────────────────────────────────────────────
    // Check and surface newly-unlocked achievements.
    // streakDays comes from DailyRewardManager state (already persisted).
    const streakDays     = DailyRewardManager.instance?.getState().streakDays ?? 0;
    const newAchievements = AchievementManager.instance?.checkSession(
      result.scoreData.objectsCaught,
      result.scoreData.maxComboReached,
      result.scoreData.currentScore,
      pd.totalGamesPlayed,   // already incremented above
      streakDays,
    ) ?? [];
    AchievementManager.lastSessionUnlocked = newAchievements;

    // ── Daily Missions ───────────────────────────────────────────────
    const newMissions = DailyMissionManager.instance?.checkSession(
      result.scoreData.objectsCaught,
      result.scoreData.maxComboReached,
      result.scoreData.currentScore,
      result.isNewHighScore,
    ) ?? [];
    DailyMissionManager.lastSessionCompleted = newMissions;

    // ── Bonus Spawns from achievements + missions ───────────────────
    let bonusFromRetention = 0;
    for (const ach of newAchievements) {
      bonusFromRetention += ach.rewardSpawns;
      AnalyticsService.instance?.track('achievement_unlocked', {
        achievementId: ach.id,
        title: ach.title,
      });
    }
    // Collect mission tier rewards (prevents double-counting on re-launch)
    const missionBonus = DailyMissionManager.instance?.collectNewTierRewards() ?? 0;
    bonusFromRetention += missionBonus;
    if (newMissions.length > 0) {
      for (const m of newMissions) {
        AnalyticsService.instance?.track('mission_completed', {
          missionType: m.type,
          target: m.target,
        });
      }
      if (DailyMissionManager.instance?.allCompleted) {
        AnalyticsService.instance?.track('all_missions_completed', {
          bonusSpawns: missionBonus,
        });
        EventBus.emit(GameEvents.ALL_MISSIONS_DONE, { bonusSpawns: missionBonus });
      }
    }
    if (bonusFromRetention > 0) {
      DailyRewardManager.pendingBonusSpawns += bonusFromRetention;
    }
    // ────────────────────────────────────────────────────────────────

    AnalyticsService.instance?.track('session_end', {
      score:       result.scoreData.currentScore,
      maxCombo:    result.scoreData.maxComboReached,
      caught:      result.scoreData.objectsCaught,
      isNewBest:   result.isNewHighScore,
      durationMs:  result.scoreData.sessionDurationMs,
    });
    AnalyticsService.instance?.flush();

    // Post score to WeChat cloud storage for the leaderboard (non-blocking)
    LeaderboardService.instance?.postScore(
      result.scoreData.currentScore,
      pd.displayName,
      pd.avatarUrl,
    );

    EventBus.emit(GameEvents.SESSION_END, result.scoreData);

    // Brief delay so SESSION_END listeners (UI) can animate before scene swap
    this.scheduleOnce(() => {
      director.loadScene(SceneNames.RESULT);
    }, 1.5);
  }

  // ------------------------------------------------------------------
  // Event handlers
  // ------------------------------------------------------------------

  private _onHookCatch(payload: { obj: ISpawnObjectInstance }): void {
    if (this._state !== GameState.PLAYING) return;

    ComboManager.instance?.onSuccessfulCatch();
    ScoreManager.instance?.addScore(payload.obj);

    WeChatService.instance?.vibrateShort();

    AnalyticsService.instance?.track('object_caught', {
      objectId:   payload.obj.configId,
      scoreValue: payload.obj.scoreValue,
      combo:      ComboManager.instance?.comboCount ?? 0,
    });

    // Milestone analytics: combo hits a new tier boundary
    const combo = ComboManager.instance?.comboCount ?? 0;
    const isNewTier = DEFAULT_GAME_CONFIG.comboTiers.some(t => t.minCombo === combo);
    if (isNewTier && combo > 1) {
      AnalyticsService.instance?.track('combo_milestone', { combo });
    }
  }

  private _onHookMiss(_payload: unknown): void {
    if (this._state !== GameState.PLAYING) return;
    ComboManager.instance?.onMiss();
    ScoreManager.instance?.recordMiss();
  }

  // ------------------------------------------------------------------
  // Difficulty ramp
  // ------------------------------------------------------------------

  private _checkDifficultyRamp(): void {
    const elapsed  = this._totalTime - this._timeLeft;
    const brackets = DIFFICULTY_TIME_BRACKETS;
    let   newIdx   = 0;

    for (let i = 0; i < brackets.length; i++) {
      if (elapsed >= brackets[i]) newIdx = i;
    }

    if (newIdx !== this._diffIdx) {
      this._diffIdx = newIdx;
      const diff    = DEFAULT_GAME_CONFIG.difficultyLevels[this._diffIdx];
      this.objectSpawner?.applyDifficulty(diff);
      this.hookController?.setSwingSpeed(
        DEFAULT_GAME_CONFIG.hookBaseSpeed * diff.hookSpeedMultiplier,
      );
    }
  }
}
