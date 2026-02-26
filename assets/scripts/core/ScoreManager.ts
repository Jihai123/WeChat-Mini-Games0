import { _decorator, Component } from 'cc';
import { IScoreData, ISessionResult } from '../interfaces/IScoreData';
import { ISpawnObjectInstance } from '../interfaces/ISpawnObject';
import { EventBus, GameEvents } from '../utils/EventBus';
import { WeChatService } from '../services/WeChatService';
import { ComboManager } from './ComboManager';
import { STORAGE_KEYS, NEAR_MISS_RATIO } from '../data/GameConfig';

const { ccclass } = _decorator;

/**
 * ScoreManager — single source of truth for all score arithmetic.
 *
 * Responsibilities:
 *  - Applies combo multiplier to raw object score values
 *  - Tracks session high-water mark and compares against persisted best
 *  - Detects near-miss (within NEAR_MISS_RATIO of personal best) at session end
 *  - Persists new high scores via WeChatService
 *  - Produces the final ISessionResult passed to ResultScene
 */
@ccclass('ScoreManager')
export class ScoreManager extends Component {
  private static _instance: ScoreManager | null = null;

  private _currentScore:    number  = 0;
  private _sessionHighScore: number = 0; // highest score within this session
  private _persistedBest:   number  = 0; // stored high score from previous sessions
  private _isNewHighScore:  boolean = false;
  private _objectsCaught:   number  = 0;
  private _objectsMissed:   number  = 0;
  private _sessionId:       string  = '';
  private _sessionStartMs:  number  = 0;

  static get instance(): ScoreManager | null { return ScoreManager._instance; }

  get currentScore():   number  { return this._currentScore; }
  get persistedBest():  number  { return this._persistedBest; }
  get isNewHighScore(): boolean { return this._isNewHighScore; }
  get objectsCaught():  number  { return this._objectsCaught; }

  onLoad(): void {
    ScoreManager._instance = this;
  }

  onDestroy(): void {
    if (ScoreManager._instance === this) ScoreManager._instance = null;
  }

  /** Initialise for a new game session.  Must be called before gameplay starts. */
  init(sessionId: string): void {
    this._sessionId       = sessionId;
    this._currentScore    = 0;
    this._sessionHighScore = 0;
    this._isNewHighScore  = false;
    this._objectsCaught   = 0;
    this._objectsMissed   = 0;
    this._sessionStartMs  = Date.now();
    this._persistedBest   =
      WeChatService.instance?.loadFromStorage<number>(STORAGE_KEYS.HIGH_SCORE) ?? 0;
  }

  /**
   * Add (or subtract) score for a caught object.
   * The raw baseScoreValue is multiplied by the current combo multiplier.
   * Obstacle values are already negative in ObjectDatabase; the floor
   * prevents going below zero.
   */
  addScore(obj: ISpawnObjectInstance): void {
    const multiplier = ComboManager.instance?.currentMultiplier ?? 1;
    const delta      = Math.round(obj.scoreValue * multiplier);

    this._currentScore = Math.max(0, this._currentScore + delta);

    if (delta >= 0) {
      this._objectsCaught++;
    } else {
      this._objectsMissed++;
    }

    // Live high-score tracking
    if (this._currentScore > this._persistedBest) {
      if (!this._isNewHighScore) {
        this._isNewHighScore   = true;
        this._persistedBest    = this._currentScore; // keep ref in sync
        EventBus.emit(GameEvents.HIGH_SCORE_BEATEN, { score: this._currentScore });
      } else {
        this._persistedBest = this._currentScore;
      }
    }

    if (this._currentScore > this._sessionHighScore) {
      this._sessionHighScore = this._currentScore;
    }

    EventBus.emit(GameEvents.SCORE_UPDATED, {
      score:      this._currentScore,
      delta,
      multiplier,
    });
  }

  /** Increment miss counter without changing score (hook retracted empty). */
  recordMiss(): void {
    this._objectsMissed++;
  }

  /**
   * Finalise the session:
   *  1. Detect near-miss against the pre-session personal best
   *  2. Persist new high score if applicable
   *  3. Return the full ISessionResult for ResultScene
   */
  finalise(playerDisplayName: string, playerAvatarUrl: string): ISessionResult {
    const durationMs = Date.now() - this._sessionStartMs;
    const prevBest   = WeChatService.instance?.loadFromStorage<number>(STORAGE_KEYS.HIGH_SCORE) ?? 0;

    // Near-miss: reached within 5% of the personal best but did NOT beat it
    if (!this._isNewHighScore && prevBest > 0) {
      const ratio = this._currentScore / prevBest;
      if (ratio >= (1 - NEAR_MISS_RATIO)) {
        EventBus.emit(GameEvents.NEAR_MISS, {
          score:     this._currentScore,
          highScore: prevBest,
          ratio,
        });
      }
    }

    if (this._isNewHighScore) {
      WeChatService.instance?.saveToStorage(STORAGE_KEYS.HIGH_SCORE, this._currentScore);
    }

    const scoreData: IScoreData = {
      sessionId:       this._sessionId,
      currentScore:    this._currentScore,
      highScore:       Math.max(this._currentScore, prevBest),
      comboCount:      ComboManager.instance?.comboCount      ?? 0,
      maxComboReached: ComboManager.instance?.maxComboReached ?? 0,
      objectsCaught:   this._objectsCaught,
      objectsMissed:   this._objectsMissed,
      sessionDurationMs: durationMs,
    };

    return {
      scoreData,
      isNewHighScore:    this._isNewHighScore,
      playerDisplayName,
      playerAvatarUrl,
    };
  }
}
