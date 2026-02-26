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

  private _state:        GameState = GameState.IDLE;
  private _sessionId:    string    = '';
  private _totalTime:    number    = DEFAULT_GAME_CONFIG.sessionDurationSeconds;
  private _timeLeft:     number    = 0;
  private _diffIdx:      number    = 0; // index into difficultyLevels[]

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

    // Load persisted player data (or create defaults for first-time player)
    let playerData = WeChatService.instance?.loadFromStorage<IPlayerData>(STORAGE_KEYS.PLAYER_DATA);
    if (!playerData) {
      playerData = {
        playerId:         this._sessionId,
        displayName:      'Player',
        avatarUrl:        '',
        highScore:        0,
        totalGamesPlayed: 0,
        lastPlayedTimestamp: Date.now(),
      };
    }

    // Attempt to refresh display name / avatar from WeChat (non-blocking)
    try {
      const info = await WeChatService.instance?.getUserInfo();
      if (info) {
        playerData.displayName = info.nickName;
        playerData.avatarUrl   = info.avatarUrl;
      }
    } catch { /* editor / permission denied — use stored name */ }

    GameManager.playerData = playerData;

    // Initialise subsystems
    AnalyticsService.instance?.init(this._sessionId);
    ScoreManager.instance?.init(this._sessionId);
    ComboManager.instance?.reset();

    const isFTUE     = playerData.totalGamesPlayed === 0;
    const difficulty = DEFAULT_GAME_CONFIG.difficultyLevels[0];
    this.objectSpawner?.init(isFTUE, difficulty);

    AnalyticsService.instance?.track('session_start', {
      sessionId:    this._sessionId,
      isFTUE:       isFTUE,
      gamesPlayed:  playerData.totalGamesPlayed,
    });

    // Short artificial delay so the loading UI can display
    this.scheduleOnce(() => this._transitionTo(GameState.PLAYING), 0.3);
  }

  // ---------- PLAYING ----------

  private _onEnterPlaying(): void {
    this._timeLeft  = this._totalTime;
    this.hookController?.reset();
    this.hookController?.setInputEnabled(true);
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

    AnalyticsService.instance?.track('session_end', {
      score:       result.scoreData.currentScore,
      maxCombo:    result.scoreData.maxComboReached,
      caught:      result.scoreData.objectsCaught,
      isNewBest:   result.isNewHighScore,
      durationMs:  result.scoreData.sessionDurationMs,
    });
    AnalyticsService.instance?.flush();

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
