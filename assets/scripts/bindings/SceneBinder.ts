import {
  _decorator, Component, Node, Button, Label, director, tween, Vec3,
} from 'cc';
import { GameState } from '../enums/GameState';
import { SceneNames } from '../enums/SceneNames';
import { EventBus, GameEvents } from '../utils/EventBus';
import { GameManager } from '../core/GameManager';
import { AnalyticsService } from '../services/AnalyticsService';
import { AdManager, AdRewardResult } from '../services/AdManager';
import { WeChatService } from '../services/WeChatService';

const { ccclass, property } = _decorator;

// Scene-load timeout: if director.loadScene hasn't fired within this many
// milliseconds, we attempt recovery (navigate to MainScene as a safe fallback).
const SCENE_LOAD_TIMEOUT_MS = 10_000;

// ---------------------------------------------------------------------------
// GameSceneBinder
// ---------------------------------------------------------------------------

/**
 * GameSceneBinder — attach to the GameScene root node.
 *
 * Wires:
 *  - GameManager state changes → panel visibility (Loading, Pause)
 *  - Pause panel buttons → GameManager.pause() / resume() / quit
 *  - Analytics: game_start (first LOADING→PLAYING), level_end (PLAYING→RESULT)
 *  - FTUE completion → analytics flush
 *  - Scene-load timeout safety net
 *
 * Node assumptions (assign in Inspector):
 *   loadingPanel   — shown during GameState.LOADING
 *   pausePanel     — shown during GameState.PAUSED; has Resume + Quit buttons
 *   btnResume      — Button inside pausePanel
 *   btnQuitGame    — Button inside pausePanel (returns to MainScene)
 *   pauseOverlayBg — Semi-transparent blocker behind pausePanel
 */
@ccclass('GameSceneBinder')
export class GameSceneBinder extends Component {
  @property(Node)
  loadingPanel: Node | null = null;

  @property(Node)
  pausePanel: Node | null = null;

  @property(Button)
  btnResume: Button | null = null;

  @property(Button)
  btnQuitGame: Button | null = null;

  /** Optional: click-blocker background behind the pause card */
  @property(Node)
  pauseOverlayBg: Node | null = null;

  // ------------------------------------------------------------------
  // Internal
  // ------------------------------------------------------------------

  private _gameStartFired: boolean = false;
  private _sceneLoadTimer: number  = 0;
  private _awaitingScene:  boolean = false;

  // ------------------------------------------------------------------
  // Lifecycle
  // ------------------------------------------------------------------

  onLoad(): void {
    EventBus.on(GameEvents.GAME_STATE_CHANGE, this._onStateChange, this);
    EventBus.on(GameEvents.FTUE_COMPLETE,     this._onFTUEComplete, this);
    EventBus.on(GameEvents.SCENE_LOAD_START,  this._onSceneLoadStart, this);

    // Wire pause panel buttons
    this.btnResume?.node.on(Button.EventType.CLICK, this._onResume, this);
    this.btnQuitGame?.node.on(Button.EventType.CLICK, this._onQuit, this);

    // Initial panel state
    this._setPausePanel(false);
    if (this.loadingPanel) this.loadingPanel.active = true;
  }

  onDestroy(): void {
    EventBus.off(GameEvents.GAME_STATE_CHANGE, this._onStateChange, this);
    EventBus.off(GameEvents.FTUE_COMPLETE,     this._onFTUEComplete, this);
    EventBus.off(GameEvents.SCENE_LOAD_START,  this._onSceneLoadStart, this);

    this.btnResume?.node.off(Button.EventType.CLICK, this._onResume, this);
    this.btnQuitGame?.node.off(Button.EventType.CLICK, this._onQuit, this);
  }

  update(dt: number): void {
    if (!this._awaitingScene) return;
    this._sceneLoadTimer += dt * 1000;
    if (this._sceneLoadTimer >= SCENE_LOAD_TIMEOUT_MS) {
      this._awaitingScene  = false;
      this._sceneLoadTimer = 0;
      console.error('[GameSceneBinder] Scene load timed out — recovering to MainScene');
      try {
        director.loadScene(SceneNames.MAIN);
      } catch (e) {
        console.error('[GameSceneBinder] Recovery load also failed:', e);
      }
    }
  }

  // ------------------------------------------------------------------
  // State change handler
  // ------------------------------------------------------------------

  private _onStateChange(payload: { prev: GameState; next: GameState }): void {
    const { prev, next } = payload;

    switch (next) {
      case GameState.LOADING: {
        if (this.loadingPanel) this.loadingPanel.active = true;
        this._setPausePanel(false);
        break;
      }

      case GameState.PLAYING: {
        if (this.loadingPanel) this.loadingPanel.active = false;
        this._setPausePanel(false);

        // Fire game_start analytics only on the first LOADING→PLAYING transition
        if (prev === GameState.LOADING && !this._gameStartFired) {
          this._gameStartFired = true;
          const pd = GameManager.playerData;
          AnalyticsService.instance?.track('game_start', {
            gamesPlayed: pd?.totalGamesPlayed ?? 0,
            isFTUE:      (pd?.totalGamesPlayed ?? 0) === 0,
          });
        }
        break;
      }

      case GameState.PAUSED: {
        this._setPausePanel(true);
        EventBus.emit(GameEvents.PAUSE_SHOW, undefined);
        break;
      }

      case GameState.RESULT: {
        this._setPausePanel(false);
        if (this.loadingPanel) this.loadingPanel.active = false;

        // Fire level_end analytics here (GameManager fires session_end separately)
        const result = GameManager.lastSessionResult;
        if (result) {
          AnalyticsService.instance?.track('level_end', {
            score:      result.scoreData.currentScore,
            highScore:  result.scoreData.highScore,
            isNewBest:  result.isNewHighScore,
            maxCombo:   result.scoreData.maxComboReached,
          });
        }

        // Start scene-load timeout watch
        this._awaitingScene  = true;
        this._sceneLoadTimer = 0;
        EventBus.emit(GameEvents.SCENE_LOAD_START, { sceneName: SceneNames.RESULT });
        break;
      }
    }
  }

  // ------------------------------------------------------------------
  // Button handlers
  // ------------------------------------------------------------------

  private _onResume(): void {
    GameManager.instance?.resume();
    EventBus.emit(GameEvents.PAUSE_HIDE, undefined);
  }

  private _onQuit(): void {
    // Flush analytics before abandoning session
    AnalyticsService.instance?.flush();
    try {
      director.loadScene(SceneNames.MAIN);
    } catch (e) {
      console.error('[GameSceneBinder] loadScene(Main) failed:', e);
    }
  }

  // ------------------------------------------------------------------
  // Other events
  // ------------------------------------------------------------------

  private _onFTUEComplete(): void {
    AnalyticsService.instance?.flush();
  }

  private _onSceneLoadStart(_payload: { sceneName: string }): void {
    // Scene-load started — reset timeout watch
    this._sceneLoadTimer = 0;
  }

  // ------------------------------------------------------------------
  // Helpers
  // ------------------------------------------------------------------

  private _setPausePanel(visible: boolean): void {
    if (this.pausePanel)     this.pausePanel.active    = visible;
    if (this.pauseOverlayBg) this.pauseOverlayBg.active = visible;
  }
}

// ---------------------------------------------------------------------------
// ResultSceneBinder
// ---------------------------------------------------------------------------

/**
 * ResultSceneBinder — attach to the ResultScene root node.
 *
 * Wires:
 *  - Shows banner ad after a short delay (non-intrusive placement)
 *  - Destroys banner on scene exit (prevents wx memory leak)
 *  - Retry analytics hook
 *  - Scene-load timeout safety net for retry / home navigation
 *
 * AdManager must be present in the scene (or carried over as a persistent node).
 *
 * Node assumptions:
 *   Attach to ResultScene root or Canvas root.
 *   All UI wiring (score, buttons) is handled by ResultSceneUI; this class
 *   only handles the ad + safety layer.
 */
@ccclass('ResultSceneBinder')
export class ResultSceneBinder extends Component {
  /** Delay (seconds) after result screen loads before banner is displayed.
   *  Gives score animation time to play first. */
  @property({ type: Number, tooltip: 'Seconds before banner appears' })
  bannerDelaySeconds: number = 2.0;

  /** Whether to show a banner ad at all on this result screen. */
  @property
  enableBanner: boolean = true;

  private _sceneLoadTimer: number  = 0;
  private _awaitingScene:  boolean = false;

  // ------------------------------------------------------------------
  // Lifecycle
  // ------------------------------------------------------------------

  onLoad(): void {
    EventBus.on(GameEvents.SCENE_LOAD_START, this._onSceneLoadStart, this);

    // Show banner after delay — non-blocking, non-intrusive
    if (this.enableBanner) {
      this.scheduleOnce(() => {
        AdManager.instance?.showBanner();
      }, this.bannerDelaySeconds);
    }
  }

  onDestroy(): void {
    EventBus.off(GameEvents.SCENE_LOAD_START, this._onSceneLoadStart, this);
    // Destroy banner to free wx memory — critical for review compliance
    AdManager.instance?.destroyBanner();
  }

  update(dt: number): void {
    if (!this._awaitingScene) return;
    this._sceneLoadTimer += dt * 1000;
    if (this._sceneLoadTimer >= SCENE_LOAD_TIMEOUT_MS) {
      this._awaitingScene  = false;
      this._sceneLoadTimer = 0;
      console.error('[ResultSceneBinder] Scene load timed out — returning to Main');
      try {
        director.loadScene(SceneNames.MAIN);
      } catch (e) {
        console.error('[ResultSceneBinder] Recovery also failed:', e);
      }
    }
  }

  // ------------------------------------------------------------------
  // Public — called by ResultSceneUI before navigating away
  // ------------------------------------------------------------------

  /** Call before any director.loadScene() to start the timeout watchdog. */
  beginSceneTransition(targetScene: string): void {
    AdManager.instance?.destroyBanner(); // Always destroy before leaving
    this._awaitingScene  = true;
    this._sceneLoadTimer = 0;
    EventBus.emit(GameEvents.SCENE_LOAD_START, { sceneName: targetScene });
  }

  // ------------------------------------------------------------------
  // Handlers
  // ------------------------------------------------------------------

  private _onSceneLoadStart(_payload: { sceneName: string }): void {
    this._sceneLoadTimer = 0;
  }
}
