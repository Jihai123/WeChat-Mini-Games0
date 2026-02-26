import { _decorator, Component } from 'cc';
import { IComboTier } from '../interfaces/IGameConfig';
import { EventBus, GameEvents } from '../utils/EventBus';
import { DEFAULT_GAME_CONFIG, FAIL_SOFT_THRESHOLD } from '../data/GameConfig';

const { ccclass } = _decorator;

/**
 * ComboManager — tracks consecutive successful catches and resolves the
 * current score multiplier from the configured combo tiers.
 *
 * State it owns:
 *  _comboCount          — catches in a row without a miss
 *  _maxComboReached     — session high-water mark
 *  _consecutiveFailures — resets on any successful catch; drives fail-soft
 *
 * Emits:
 *  COMBO_UPDATED  — after every successful catch
 *  COMBO_RESET    — when a miss/obstacle breaks a combo streak
 *  FAIL_SOFT_ACTIVE — when failures cross the fail-soft threshold
 */
@ccclass('ComboManager')
export class ComboManager extends Component {
  private static _instance: ComboManager | null = null;

  private _comboCount:          number    = 0;
  private _maxComboReached:     number    = 0;
  private _consecutiveFailures: number    = 0;
  private _currentTier:         IComboTier = DEFAULT_GAME_CONFIG.comboTiers[0];
  private _failSoftActive:      boolean   = false;

  static get instance(): ComboManager | null { return ComboManager._instance; }

  get comboCount():          number { return this._comboCount; }
  get maxComboReached():     number { return this._maxComboReached; }
  get currentMultiplier():   number { return this._currentTier.multiplier; }
  get consecutiveFailures(): number { return this._consecutiveFailures; }
  get failSoftActive():      boolean { return this._failSoftActive; }

  onLoad(): void {
    ComboManager._instance = this;
    this._currentTier = DEFAULT_GAME_CONFIG.comboTiers[0];
  }

  onDestroy(): void {
    if (ComboManager._instance === this) ComboManager._instance = null;
  }

  reset(): void {
    this._comboCount          = 0;
    this._maxComboReached     = 0;
    this._consecutiveFailures = 0;
    this._failSoftActive      = false;
    this._currentTier         = DEFAULT_GAME_CONFIG.comboTiers[0];
  }

  /** Called by GameManager after a confirmed successful catch. */
  onSuccessfulCatch(): void {
    this._comboCount++;
    this._consecutiveFailures = 0;

    if (this._comboCount > this._maxComboReached) {
      this._maxComboReached = this._comboCount;
    }

    // Deactivate fail-soft the moment the player lands a catch
    if (this._failSoftActive) {
      this._failSoftActive = false;
      EventBus.emit(GameEvents.FAIL_SOFT_ACTIVE, { active: false });
    }

    const tier = this._resolveTier(this._comboCount);
    this._currentTier = tier;
    EventBus.emit(GameEvents.COMBO_UPDATED, {
      combo:      this._comboCount,
      multiplier: tier.multiplier,
      label:      tier.label,
    });
  }

  /** Called by GameManager when the hook retracts empty or hits an obstacle. */
  onMiss(): void {
    const hadCombo = this._comboCount >= 3; // Only reset label if it was meaningful
    this._comboCount  = 0;
    this._currentTier = DEFAULT_GAME_CONFIG.comboTiers[0];
    this._consecutiveFailures++;

    // Activate fail-soft boost after FAIL_SOFT_THRESHOLD consecutive misses
    if (
      this._consecutiveFailures >= FAIL_SOFT_THRESHOLD &&
      !this._failSoftActive
    ) {
      this._failSoftActive = true;
      EventBus.emit(GameEvents.FAIL_SOFT_ACTIVE, { active: true });
    }

    if (hadCombo) {
      EventBus.emit(GameEvents.COMBO_RESET, {
        consecutiveFailures: this._consecutiveFailures,
      });
    }
  }

  // ------------------------------------------------------------------
  // Private helpers
  // ------------------------------------------------------------------

  private _resolveTier(combo: number): IComboTier {
    const tiers   = DEFAULT_GAME_CONFIG.comboTiers;
    let resolved  = tiers[0];
    for (const tier of tiers) {
      if (combo >= tier.minCombo) resolved = tier;
    }
    return resolved;
  }
}
