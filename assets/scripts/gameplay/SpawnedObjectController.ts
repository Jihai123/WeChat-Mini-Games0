import { _decorator, Component, Node, Vec3, UITransform } from 'cc';
import { ISpawnObjectInstance } from '../interfaces/ISpawnObject';
import { ObjectType } from '../enums/ObjectType';
import { CATCH_RADIUS_BASE } from '../data/GameConfig';

const { ccclass, property } = _decorator;

/**
 * SpawnedObjectController — attached to every spawnable object prefab.
 *
 * ObjectSpawner configures this component (via configure()) after acquiring
 * from the pool.  The component then drives its own horizontal movement and
 * exposes the data ObjectSpawner needs for collision and scoring.
 *
 * Movement: ping-pong left ↔ right within spawnAreaHalfWidth bounds.
 * The Y-lane is fixed at spawn time; the object never changes depth.
 */
@ccclass('SpawnedObjectController')
export class SpawnedObjectController extends Component {
  // Set by ObjectSpawner before the node is activated
  public data!: ISpawnObjectInstance;

  /** Horizontal bounds in the SpawnArea's local space (set by ObjectSpawner). */
  public spawnAreaHalfWidth: number = 400;

  /** If true, moves only left-to-right once then self-despawns (FTUE objects). */
  public ftueMode: boolean = false;

  private _direction: number = 1; // +1 = right, -1 = left
  private _active:    boolean = false;

  /** Catch radius in world pixels — scales with the object's visual scale. */
  get catchRadius(): number {
    return CATCH_RADIUS_BASE * this.node.scale.x;
  }

  onLoad(): void {
    this._active = false;
  }

  /** Configure and start this object. Called by ObjectSpawner after pool acquire. */
  configure(
    instance: ISpawnObjectInstance,
    startX: number,
    laneY: number,
    halfWidth: number,
    direction: number = 1,
    ftue: boolean     = false,
  ): void {
    this.data              = instance;
    this.spawnAreaHalfWidth = halfWidth;
    this.ftueMode          = ftue;
    this._direction        = direction;
    this._active           = true;

    this.node.setPosition(startX, laneY, 0);
    this.node.setScale(instance.scale, instance.scale, 1);
  }

  update(dt: number): void {
    if (!this._active || !this.data) return;

    const dx = this.data.moveSpeed * this._direction * dt;
    const cur = this.node.position;
    let   nx  = cur.x + dx;

    if (nx > this.spawnAreaHalfWidth) {
      if (this.ftueMode) {
        // FTUE objects disappear when they exit the right edge (miss is OK —
        // the FTUE guarantee will re-spawn them if player hasn't caught 3 yet)
        this._active = false;
        this.node.emit('despawn', this); // ObjectSpawner listens for this
        return;
      }
      nx             = this.spawnAreaHalfWidth;
      this._direction = -1;
    } else if (nx < -this.spawnAreaHalfWidth) {
      nx             = -this.spawnAreaHalfWidth;
      this._direction = 1;
    }

    this.node.setPosition(nx, cur.y, 0);
  }

  /** Called by ObjectSpawner when this object is caught or force-despawned. */
  deactivate(): void {
    this._active = false;
  }
}
