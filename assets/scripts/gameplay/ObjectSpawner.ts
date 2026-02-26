import { _decorator, Component, Node, Prefab, Vec3 } from 'cc';
import { ISpawnObjectConfig } from '../interfaces/ISpawnObject';
import { ISpawnObjectInstance } from '../interfaces/ISpawnObject';
import { ObjectType } from '../enums/ObjectType';
import { ObjectPool } from '../utils/ObjectPool';
import { EventBus, GameEvents } from '../utils/EventBus';
import { SpawnedObjectController } from './SpawnedObjectController';
import {
  DEFAULT_GAME_CONFIG,
  FTUE_GUARANTEED_CATCHES,
  REWARD_RHYTHM_INTERVAL_S,
} from '../data/GameConfig';
import {
  OBJECT_DATABASE,
  FTUE_OBJECT_CONFIG,
  FAIL_SOFT_WEIGHT_OVERRIDE,
  rollRandomObject,
} from '../data/ObjectDatabase';
import { IDifficultyLevel } from '../interfaces/IGameConfig';

const { ccclass, property } = _decorator;

/**
 * Spawn lane Y-positions in the SpawnArea's local space.
 * Objects in lower lanes (more negative Y) move slower and are worth more.
 */
const SPAWN_LANES_Y = [-80, -190, -310] as const;

/** Half-width of the spawn area (object bounces between ±this value). */
const SPAWN_HALF_WIDTH = 440;

/**
 * ObjectSpawner — manages object pools per type and drives the spawn schedule.
 *
 * Key features:
 *  - Per-type ObjectPool (one pool per prefab)
 *  - Difficulty curve: spawn interval shrinks as game progresses
 *  - FTUE mode: forces 3 bonus_gold spawns for brand-new players
 *  - Fail-soft mode: biases weights toward easy objects, removes obstacles
 *  - Reward rhythm: if ≥ 9 s pass without a catch, force-spawn a catchable bonus
 *
 * Prefabs must be assigned in the Cocos Creator Inspector (one per ObjectType).
 * The order of the prefabs array must match PREFAB_TYPE_ORDER below.
 */
@ccclass('ObjectSpawner')
export class ObjectSpawner extends Component {
  /** Assign prefabs in Inspector: [CommonObject, RareObject, BonusObject, ObstacleObject, SpecialObject] */
  @property([Prefab])
  objectPrefabs: Prefab[] = [];

  /** Reference to SpawnArea node (parent of all spawned nodes). */
  @property(Node)
  spawnAreaNode: Node | null = null;

  // ------------------------------------------------------------------
  // Internal state
  // ------------------------------------------------------------------

  private _pools:            Map<string, ObjectPool> = new Map();
  private _activeControllers: SpawnedObjectController[] = [];

  private _spawnTimer:       number  = 0;
  private _spawnInterval:    number  = DEFAULT_GAME_CONFIG.baseSpawnIntervalMs / 1000;
  private _isRunning:        boolean = false;
  private _speedMultiplier:  number  = 1;

  // FTUE
  private _ftueMode:         boolean = false;
  private _ftueRemaining:    number  = 0;

  // Fail-soft (driven by FAIL_SOFT_ACTIVE event)
  private _failSoftActive:   boolean = false;

  // Reward rhythm
  private _timeSinceLastCatch: number = 0;

  // Maps prefab slot → ObjectType id string for pool key
  private static readonly PREFAB_TYPE_ORDER: string[] = [
    'common_small',  // slot 0
    'rare_gem',      // slot 1
    'bonus_gold',    // slot 2
    'obstacle_rock', // slot 3
    'special_star',  // slot 4
  ];

  // ------------------------------------------------------------------
  // Lifecycle
  // ------------------------------------------------------------------

  onLoad(): void {
    EventBus.on(GameEvents.HOOK_CATCH,      this._onHookCatch,    this);
    EventBus.on(GameEvents.HOOK_MISS,       this._onHookMiss,     this);
    EventBus.on(GameEvents.FAIL_SOFT_ACTIVE, this._onFailSoft,    this);
    EventBus.on(GameEvents.FORCE_BONUS_SPAWN, this._forceBonus,   this);
  }

  onDestroy(): void {
    EventBus.off(GameEvents.HOOK_CATCH,       this._onHookCatch,  this);
    EventBus.off(GameEvents.HOOK_MISS,        this._onHookMiss,   this);
    EventBus.off(GameEvents.FAIL_SOFT_ACTIVE, this._onFailSoft,   this);
    EventBus.off(GameEvents.FORCE_BONUS_SPAWN, this._forceBonus,  this);
    this._disposePools();
  }

  // ------------------------------------------------------------------
  // Public API
  // ------------------------------------------------------------------

  /**
   * Initialise pools and start spawning.
   * @param isFTUE   true when this is the player's very first game
   * @param difficulty initial difficulty level
   */
  init(isFTUE: boolean, difficulty: IDifficultyLevel): void {
    this._buildPools();
    this._applyDifficulty(difficulty);

    this._ftueMode      = isFTUE;
    this._ftueRemaining = isFTUE ? FTUE_GUARANTEED_CATCHES : 0;
    this._failSoftActive = false;
    this._timeSinceLastCatch = 0;
    this._spawnTimer    = 0;
    this._activeControllers = [];
    this._isRunning     = true;
  }

  stop(): void {
    this._isRunning = false;
    this._despawnAll();
  }

  applyDifficulty(difficulty: IDifficultyLevel): void {
    this._applyDifficulty(difficulty);
  }

  // ------------------------------------------------------------------
  // Update
  // ------------------------------------------------------------------

  update(dt: number): void {
    if (!this._isRunning) return;

    this._timeSinceLastCatch += dt;

    // Reward rhythm: force a bonus object if player hasn't caught anything
    // in REWARD_RHYTHM_INTERVAL_S seconds (strong positive feedback guarantee)
    if (this._timeSinceLastCatch >= REWARD_RHYTHM_INTERVAL_S) {
      this._timeSinceLastCatch = 0;
      EventBus.emit(GameEvents.FORCE_BONUS_SPAWN, undefined);
    }

    this._spawnTimer += dt;
    if (this._spawnTimer >= this._spawnInterval) {
      this._spawnTimer = 0;
      this._trySpawn();
    }
  }

  // ------------------------------------------------------------------
  // Spawning logic
  // ------------------------------------------------------------------

  private _trySpawn(): void {
    if (!this.spawnAreaNode) return;
    if (this._activeControllers.length >= DEFAULT_GAME_CONFIG.maxActiveObjects) return;

    let cfg: ISpawnObjectConfig;

    if (this._ftueMode && this._ftueRemaining > 0) {
      // FTUE override: always spawn a big-gold object, moving slowly,
      // entering from the left so the player has plenty of time to catch it
      cfg = FTUE_OBJECT_CONFIG;
    } else if (this._failSoftActive) {
      cfg = rollRandomObject(FAIL_SOFT_WEIGHT_OVERRIDE);
    } else {
      cfg = rollRandomObject();
    }

    this._spawnObject(cfg, this._ftueMode && this._ftueRemaining > 0);
  }

  private _forceBonus(): void {
    if (!this._isRunning) return;
    this._spawnObject(FTUE_OBJECT_CONFIG, false);
  }

  private _spawnObject(cfg: ISpawnObjectConfig, isFTUE: boolean): void {
    const pool = this._poolForConfig(cfg);
    if (!pool) return;

    const node = pool.acquire();
    const ctrl = node.getComponent(SpawnedObjectController);
    if (!ctrl) { pool.release(node); return; }

    // Randomise within the object's speed and scale ranges
    const speed = cfg.moveSpeedMin +
      Math.random() * (cfg.moveSpeedMax - cfg.moveSpeedMin);
    const scale = cfg.scaleMin +
      Math.random() * (cfg.scaleMax - cfg.scaleMin);

    const instance: ISpawnObjectInstance = {
      configId:  cfg.id,
      type:      cfg.type,
      scoreValue: cfg.baseScoreValue,
      moveSpeed:  isFTUE ? Math.min(speed, 60) : speed * this._speedMultiplier,
      scale,
      isActive:  true,
    };

    // Pick a random lane; FTUE objects always spawn in the easiest (top) lane
    const laneIndex  = isFTUE ? 0 : Math.floor(Math.random() * SPAWN_LANES_Y.length);
    const laneY      = SPAWN_LANES_Y[laneIndex];
    const startDir   = Math.random() > 0.5 ? 1 : -1;
    const startX     = -startDir * SPAWN_HALF_WIDTH; // enter from the opposite edge

    ctrl.configure(instance, startX, laneY, SPAWN_HALF_WIDTH, startDir, isFTUE);
    node.setParent(this.spawnAreaNode!);

    // Listen for self-despawn signal (fired when FTUE object exits the play area)
    node.on('despawn', this._onSelfDespawn, this);

    this._activeControllers.push(ctrl);
  }

  // ------------------------------------------------------------------
  // Event handlers
  // ------------------------------------------------------------------

  private _onHookCatch(payload: { obj: ISpawnObjectInstance; node: Node }): void {
    this._timeSinceLastCatch = 0; // Reset rhythm timer on every catch

    if (this._ftueMode && this._ftueRemaining > 0 &&
        payload.obj.type === ObjectType.BONUS) {
      this._ftueRemaining--;
      EventBus.emit(GameEvents.FTUE_CATCH, { remaining: this._ftueRemaining });
      if (this._ftueRemaining === 0) this._ftueMode = false;
    }

    // Remove the caught controller from active list
    const ctrl = payload.node.getComponent(SpawnedObjectController);
    if (ctrl) this._removeController(ctrl);
  }

  private _onHookMiss(_payload: unknown): void {
    // Misses do not trigger a re-spawn; the natural timer handles it
  }

  private _onFailSoft(payload: { active: boolean }): void {
    this._failSoftActive = payload.active;
  }

  private _onSelfDespawn(ctrl: SpawnedObjectController): void {
    this._removeController(ctrl);
    const pool = this._poolForConfig(
      OBJECT_DATABASE.find(c => c.id === ctrl.data?.configId) ?? OBJECT_DATABASE[0]
    );
    pool?.release(ctrl.node);
    ctrl.node.off('despawn', this._onSelfDespawn, this);
  }

  // ------------------------------------------------------------------
  // Pool helpers
  // ------------------------------------------------------------------

  private _buildPools(): void {
    if (!this.spawnAreaNode) {
      console.error('[ObjectSpawner] spawnAreaNode is not assigned!');
      return;
    }
    ObjectSpawner.PREFAB_TYPE_ORDER.forEach((id, index) => {
      const prefab = this.objectPrefabs[index];
      if (!prefab) {
        console.warn(`[ObjectSpawner] Prefab for slot ${index} (${id}) not assigned.`);
        return;
      }
      const pool = new ObjectPool(
        prefab,
        this.spawnAreaNode!,
        DEFAULT_GAME_CONFIG.objectPoolSize,
      );
      this._pools.set(id, pool);
    });
  }

  private _poolForConfig(cfg: ISpawnObjectConfig): ObjectPool | null {
    // Map multi-variant configs (e.g., common_large → same pool as common_small)
    const poolKey = this._resolvePoolKey(cfg.id);
    return this._pools.get(poolKey) ?? null;
  }

  private _resolvePoolKey(id: string): string {
    // common_large uses the same CommonObject prefab as common_small
    if (id === 'common_large') return 'common_small';
    return id;
  }

  private _removeController(ctrl: SpawnedObjectController): void {
    const idx = this._activeControllers.indexOf(ctrl);
    if (idx >= 0) this._activeControllers.splice(idx, 1);
  }

  private _despawnAll(): void {
    for (const ctrl of [...this._activeControllers]) {
      ctrl.deactivate();
      const cfg = OBJECT_DATABASE.find(c => c.id === ctrl.data?.configId);
      if (cfg) {
        const pool = this._poolForConfig(cfg);
        pool?.release(ctrl.node);
      }
    }
    this._activeControllers = [];
  }

  private _disposePools(): void {
    this._pools.forEach(pool => pool.dispose());
    this._pools.clear();
  }

  private _applyDifficulty(d: IDifficultyLevel): void {
    this._spawnInterval   =
      (DEFAULT_GAME_CONFIG.baseSpawnIntervalMs / 1000) / d.spawnRateMultiplier;
    this._speedMultiplier = d.objectSpeedMultiplier;
  }
}
