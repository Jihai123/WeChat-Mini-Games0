import {
  _decorator, Component, Node, Vec3, Input, input,
  EventTouch, UITransform, tween, Tween,
} from 'cc';
import { GameState } from '../enums/GameState';
import { EventBus, GameEvents } from '../utils/EventBus';
import { SpawnedObjectController } from './SpawnedObjectController';
import {
  DEFAULT_GAME_CONFIG,
  HOOK_LINE_BASE_HEIGHT_PX,
  HOOK_LINE_MIN_LENGTH,
  HOOK_LINE_MAX_LENGTH,
  HOOK_DROP_SPEED,
  HOOK_RETRACT_BASE,
} from '../data/GameConfig';
import { OBJECT_PULL_WEIGHT } from '../data/ObjectDatabase';

const { ccclass, property } = _decorator;

/** Internal hook states — distinct from the global GameState FSM. */
enum HookState {
  SWINGING  = 'SWINGING',
  DROPPING  = 'DROPPING',
  RETRACTING = 'RETRACTING',
  CAUGHT    = 'CAUGHT',
}

/**
 * HookController — pendulum swing, tap-to-drop, and weight-sensitive retraction.
 *
 * Node assumptions (match ARCHITECTURE.md GameScene structure):
 *   this.node          → HookRoot  (anchor at the top-centre of play area)
 *   hookLineNode       → HookLine  (child Sprite, scaleY drives rope length)
 *   hookTipNode        → HookTip   (child node used for world-space collision)
 *
 * Coordinate conventions (CC3 2D):
 *   +X = right, +Y = up, rotation.z = CCW positive.
 *   At angle = 0 the hook points straight down; swinging right = negative angle.
 *
 * Lifecycle:
 *   GameManager enables/disables input by calling setInputEnabled().
 */
@ccclass('HookController')
export class HookController extends Component {
  @property(Node)
  hookLineNode: Node | null = null;

  @property(Node)
  hookTipNode: Node | null = null;

  /** Reference to the SpawnArea node (used for collision queries). */
  @property(Node)
  spawnAreaNode: Node | null = null;

  // ------------------------------------------------------------------
  // Swing state
  // ------------------------------------------------------------------

  private _hookState:      HookState = HookState.SWINGING;
  private _angleRad:       number    = 0;             // current swing angle (radians)
  private _angularVelSign: number    = 1;             // +1 CCW, -1 CW
  private _lineLength:     number    = HOOK_LINE_MIN_LENGTH;
  private _inputEnabled:   boolean   = false;

  /** Object currently on the hook (null when hook is empty). */
  private _caughtController: SpawnedObjectController | null = null;

  /** Current swing speed in radians/second — patched by GameManager for difficulty. */
  private _swingSpeedRad: number = 0;
  private _maxAngleRad:   number = 0;

  // ------------------------------------------------------------------
  // Public API
  // ------------------------------------------------------------------

  get hookState():    HookState { return this._hookState; }
  get isBusy():       boolean   { return this._hookState !== HookState.SWINGING; }
  get currentAngleDeg(): number { return this._angleRad * (180 / Math.PI); }

  onLoad(): void {
    const cfg        = DEFAULT_GAME_CONFIG;
    this._maxAngleRad    = cfg.hookMaxAngleDeg  * (Math.PI / 180);
    this._swingSpeedRad  = cfg.hookBaseSpeed    * (Math.PI / 180);
  }

  onDestroy(): void {
    this._removeInputListeners();
  }

  /** GameManager calls this when GameState transitions to PLAYING. */
  setInputEnabled(enabled: boolean): void {
    this._inputEnabled = enabled;
    if (enabled) {
      input.on(Input.EventType.TOUCH_START, this._onTouchStart, this);
    } else {
      this._removeInputListeners();
    }
  }

  /** Override swing speed (called by GameManager when difficulty ramps up). */
  setSwingSpeed(degPerSec: number): void {
    this._swingSpeedRad = degPerSec * (Math.PI / 180);
  }

  /** Hard reset — returns hook to idle swing position. */
  reset(): void {
    this._hookState      = HookState.SWINGING;
    this._angleRad       = 0;
    this._angularVelSign = 1;
    this._lineLength     = HOOK_LINE_MIN_LENGTH;
    this._caughtController = null;
    this._applyTransform();
  }

  // ------------------------------------------------------------------
  // Update loop
  // ------------------------------------------------------------------

  update(dt: number): void {
    if (!this._inputEnabled) return;

    switch (this._hookState) {
      case HookState.SWINGING:   this._updateSwing(dt);   break;
      case HookState.DROPPING:   this._updateDrop(dt);    break;
      case HookState.RETRACTING:
      case HookState.CAUGHT:     this._updateRetract(dt); break;
    }

    this._applyTransform();
  }

  // ------------------------------------------------------------------
  // State updates
  // ------------------------------------------------------------------

  private _updateSwing(dt: number): void {
    this._angleRad += this._swingSpeedRad * this._angularVelSign * dt;

    if (this._angleRad >=  this._maxAngleRad) {
      this._angleRad       =  this._maxAngleRad;
      this._angularVelSign = -1;
    } else if (this._angleRad <= -this._maxAngleRad) {
      this._angleRad       = -this._maxAngleRad;
      this._angularVelSign =  1;
    }
  }

  private _updateDrop(dt: number): void {
    this._lineLength += HOOK_DROP_SPEED * dt;

    if (this._lineLength >= HOOK_LINE_MAX_LENGTH) {
      // Reached bottom without catching anything — start retracting
      this._lineLength = HOOK_LINE_MAX_LENGTH;
      this._startRetract(false);
    } else {
      this._checkCollisions();
    }
  }

  private _updateRetract(dt: number): void {
    const pullWeight  = this._caughtController
      ? (OBJECT_PULL_WEIGHT[this._caughtController.data.configId] ?? 1)
      : 1;
    const speed       = HOOK_RETRACT_BASE / pullWeight;
    this._lineLength -= speed * dt;

    if (this._lineLength <= HOOK_LINE_MIN_LENGTH) {
      this._lineLength = HOOK_LINE_MIN_LENGTH;
      this._onRetractComplete();
    }
  }

  // ------------------------------------------------------------------
  // Collision detection
  // ------------------------------------------------------------------

  private _checkCollisions(): void {
    if (!this.spawnAreaNode || !this.hookTipNode) return;

    const tipWorld = this.hookTipNode.worldPosition;

    // Iterate every active SpawnedObjectController in the SpawnArea
    for (const child of this.spawnAreaNode.children) {
      if (!child.active) continue;
      const ctrl = child.getComponent(SpawnedObjectController);
      if (!ctrl || !ctrl.data) continue;

      const objWorld = child.worldPosition;
      const dist     = Vec3.distance(tipWorld, objWorld);

      if (dist <= ctrl.catchRadius) {
        this._onCatch(ctrl);
        return; // Only one catch per drop
      }
    }
  }

  // ------------------------------------------------------------------
  // Catch / miss
  // ------------------------------------------------------------------

  private _onCatch(ctrl: SpawnedObjectController): void {
    this._caughtController = ctrl;
    this._hookState        = HookState.CAUGHT;
    ctrl.deactivate();
    // Disable the object's own movement; it will visually follow hook tip
    // (ObjectSpawner handles the node parenting / visual during pull-back)
    EventBus.emit(GameEvents.HOOK_CATCH, { obj: ctrl.data, node: ctrl.node });
  }

  private _startRetract(withCatch: boolean): void {
    if (!withCatch && this._hookState !== HookState.CAUGHT) {
      this._hookState = HookState.RETRACTING;
    }
  }

  private _onRetractComplete(): void {
    if (this._hookState === HookState.CAUGHT) {
      // Scored catch already emitted by _onCatch; nothing extra needed here
    } else {
      // Empty hook returned — this is a miss
      EventBus.emit(GameEvents.HOOK_MISS, { angle: this.currentAngleDeg });
    }

    this._caughtController = null;
    this._hookState        = HookState.SWINGING;
  }

  // ------------------------------------------------------------------
  // Visual transform
  // ------------------------------------------------------------------

  /**
   * Apply angle and line-length to the hook nodes.
   *
   * HookRoot (this.node) is NOT rotated — we calculate the tip position
   * in HookRoot local space and place HookLine/HookTip accordingly.
   * This avoids double-rotation if HookRoot has a non-zero initial rotation.
   *
   * Tip local pos = (sin(angle) * len, -cos(angle) * len)
   */
  private _applyTransform(): void {
    const len = this._lineLength;
    const tx  = Math.sin(this._angleRad) * len;
    const ty  = -Math.cos(this._angleRad) * len;

    if (this.hookTipNode) {
      this.hookTipNode.setPosition(tx, ty, 0);
    }

    if (this.hookLineNode) {
      // Scale the line sprite so it stretches from origin to tip.
      // scaleY = length / base sprite height
      const scaleY = len / HOOK_LINE_BASE_HEIGHT_PX;
      this.hookLineNode.setScale(1, scaleY, 1);
      // Position the midpoint so the sprite spans from 0 to tip
      this.hookLineNode.setPosition(tx * 0.5, ty * 0.5, 0);

      // Rotate the line node to align with the tip direction
      const angleDeg = this._angleRad * (180 / Math.PI);
      this.hookLineNode.setRotationFromEuler(0, 0, -angleDeg);
    }

    // If an object is caught, drag it along the hook tip position
    if (this._caughtController?.node.active) {
      const worldTip = this.hookTipNode?.worldPosition ?? Vec3.ZERO;
      this._caughtController.node.setWorldPosition(worldTip);
    }
  }

  // ------------------------------------------------------------------
  // Input
  // ------------------------------------------------------------------

  private _onTouchStart(_evt: EventTouch): void {
    if (!this._inputEnabled) return;
    if (this._hookState !== HookState.SWINGING) return; // Ignore if busy
    this._hookState = HookState.DROPPING;
  }

  private _removeInputListeners(): void {
    input.off(Input.EventType.TOUCH_START, this._onTouchStart, this);
  }
}
