import { Node, Prefab, instantiate } from 'cc';

/**
 * Generic node pool. CC3 removed the built-in NodePool, so we manage
 * a typed free-list per object type. Caller is responsible for resetting
 * node state (position, active children, etc.) before returning to the pool.
 */
export class ObjectPool {
  private _free: Node[]  = [];
  private _prefab: Prefab;
  private _parent: Node;
  private _maxSize: number;

  constructor(prefab: Prefab, parent: Node, initialSize: number = 8, maxSize: number = 24) {
    this._prefab  = prefab;
    this._parent  = parent;
    this._maxSize = maxSize;
    this._prewarm(initialSize);
  }

  private _prewarm(count: number): void {
    for (let i = 0; i < count; i++) {
      const node = instantiate(this._prefab);
      node.setParent(this._parent);
      node.active = false;
      this._free.push(node);
    }
  }

  /** Acquire an active node from the pool (instantiates if the free list is empty). */
  acquire(): Node {
    let node = this._free.pop();
    if (!node) {
      node = instantiate(this._prefab);
      node.setParent(this._parent);
    }
    node.active = true;
    return node;
  }

  /** Return a node to the pool. Deactivates it immediately. */
  release(node: Node): void {
    if (!node) return;
    node.active = false;
    if (this._free.length < this._maxSize) {
      this._free.push(node);
    } else {
      node.destroy(); // Prevent unbounded growth
    }
  }

  /** How many nodes are currently sitting in the free list. */
  get freeCount(): number { return this._free.length; }

  /** Destroy all pooled nodes — call on scene unload. */
  dispose(): void {
    this._free.forEach(n => n.destroy());
    this._free = [];
  }
}
