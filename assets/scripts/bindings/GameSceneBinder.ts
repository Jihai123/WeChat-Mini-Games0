import {
  _decorator, Component, Node, Button, director,
} from 'cc';
import { GameState } from '../enums/GameState';
import { SceneNames } from '../enums/SceneNames';
import { EventBus, GameEvents } from '../utils/EventBus';
import { GameManager } from '../core/GameManager';
import { AnalyticsService } from '../services/AnalyticsService';

const { ccclass, property } = _decorator;

const SCENE_LOAD_TIMEOUT_MS = 10_000;

/**
 * GameSceneBinder — attach to the GameScene root node.
 * Wires state changes to panel visibility, pause buttons, and analytics.
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

  @property(Node)
  pauseOverlayBg: Node | null = null;

  private _gameStartFired: boolean = false;
  private _sceneLoadTimer: number  = 0;
  private _awaitingScene:  boolean = false;

  onLoad(): void {
    EventBus.on(GameEvents.GAME_STATE_CHANGE, this._onStateChange, this);
    EventBus.on(GameEvents.FTUE_COMPLETE,     this._onFTUEComplete, this);
    EventBus.on(GameEvents.SCENE_LOAD_START,  this._onSceneLoadStart, this);

    this.btnResume?.node.on(Button.EventType.CLICK, this._onResume, this);
    this.btnQuitGame?.node.on(Button.EventType.CLICK, this._onQuit, this);

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
      try { director.loadScene(SceneNames.MAIN); } catch (e) { console.error(e); }
    }
  }

  private _onStateChange(payload: { prev: GameState; next: GameState }): void {
    const { prev, next } = payload;
    switch (next) {
      case GameState.LOADING:
        if (this.loadingPanel) this.loadingPanel.active = true;
        this._setPausePanel(false);
        break;
      case GameState.PLAYING:
        if (this.loadingPanel) this.loadingPanel.active = false;
        this._setPausePanel(false);
        if (prev === GameState.LOADING && !this._gameStartFired) {
          this._gameStartFired = true;
          const pd = GameManager.playerData;
          AnalyticsService.instance?.track('game_start', {
            gamesPlayed: pd?.totalGamesPlayed ?? 0,
            isFTUE:      (pd?.totalGamesPlayed ?? 0) === 0,
          });
        }
        break;
      case GameState.PAUSED:
        this._setPausePanel(true);
        EventBus.emit(GameEvents.PAUSE_SHOW, undefined);
        break;
      case GameState.RESULT:
        this._setPausePanel(false);
        if (this.loadingPanel) this.loadingPanel.active = false;
        const result = GameManager.lastSessionResult;
        if (result) {
          AnalyticsService.instance?.track('level_end', {
            score:     result.scoreData.currentScore,
            highScore: result.scoreData.highScore,
            isNewBest: result.isNewHighScore,
            maxCombo:  result.scoreData.maxComboReached,
          });
        }
        this._awaitingScene  = true;
        this._sceneLoadTimer = 0;
        EventBus.emit(GameEvents.SCENE_LOAD_START, { sceneName: SceneNames.RESULT });
        break;
    }
  }

  private _onResume(): void {
    GameManager.instance?.resume();
    EventBus.emit(GameEvents.PAUSE_HIDE, undefined);
  }

  private _onQuit(): void {
    AnalyticsService.instance?.flush();
    try { director.loadScene(SceneNames.MAIN); } catch (e) { console.error(e); }
  }

  private _onFTUEComplete(): void {
    AnalyticsService.instance?.flush();
  }

  private _onSceneLoadStart(_payload: { sceneName: string }): void {
    this._sceneLoadTimer = 0;
  }

  private _setPausePanel(visible: boolean): void {
    if (this.pausePanel)     this.pausePanel.active     = visible;
    if (this.pauseOverlayBg) this.pauseOverlayBg.active = visible;
  }
}
