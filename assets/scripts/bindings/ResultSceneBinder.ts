import { _decorator, CCFloat, Component, director } from 'cc';
import { SceneNames } from '../enums/SceneNames';
import { EventBus, GameEvents } from '../utils/EventBus';
import { AdManager } from '../services/AdManager';

const { ccclass, property } = _decorator;

const SCENE_LOAD_TIMEOUT_MS = 10_000;

/**
 * ResultSceneBinder — attach to the ResultScene root node.
 * Handles banner ad lifecycle and scene-transition safety timeout.
 */
@ccclass('ResultSceneBinder')
export class ResultSceneBinder extends Component {
  @property({ type: CCFloat, tooltip: 'Seconds before banner appears' })
  bannerDelaySeconds: number = 2.0;

  @property
  enableBanner: boolean = true;

  private _sceneLoadTimer: number  = 0;
  private _awaitingScene:  boolean = false;

  onLoad(): void {
    EventBus.on(GameEvents.SCENE_LOAD_START, this._onSceneLoadStart, this);
    if (this.enableBanner) {
      this.scheduleOnce(() => { AdManager.instance?.showBanner(); }, this.bannerDelaySeconds);
    }
  }

  onDestroy(): void {
    EventBus.off?.(GameEvents.SCENE_LOAD_START, this._onSceneLoadStart, this);
    AdManager.instance?.destroyBanner();
  }

  update(dt: number): void {
    if (!this._awaitingScene) return;
    this._sceneLoadTimer += dt * 1000;
    if (this._sceneLoadTimer >= SCENE_LOAD_TIMEOUT_MS) {
      this._awaitingScene  = false;
      this._sceneLoadTimer = 0;
      console.error('[ResultSceneBinder] Scene load timed out — returning to Main');
      try { director.loadScene(SceneNames.MAIN); } catch (e) { console.error(e); }
    }
  }

  beginSceneTransition(targetScene: string): void {
    AdManager.instance?.destroyBanner();
    this._awaitingScene  = true;
    this._sceneLoadTimer = 0;
    EventBus.emit(GameEvents.SCENE_LOAD_START, { sceneName: targetScene });
  }

  private _onSceneLoadStart(_payload: { sceneName: string }): void {
    this._sceneLoadTimer = 0;
  }
}
