import { EventTarget } from 'cc';

// Global event bus — single channel for all cross-component communication.
// Components emit and subscribe here rather than holding direct references to
// each other, keeping coupling strictly one-way through this bus.
export const EventBus = new EventTarget();

export const GameEvents = {
  HOOK_CATCH:         'HOOK_CATCH',         // payload: { obj: ISpawnObjectInstance, node: Node }
  HOOK_MISS:          'HOOK_MISS',          // payload: { angle: number }
  SCORE_UPDATED:      'SCORE_UPDATED',      // payload: { score, delta, multiplier }
  COMBO_UPDATED:      'COMBO_UPDATED',      // payload: { combo, multiplier, label }
  COMBO_RESET:        'COMBO_RESET',        // payload: { consecutiveFailures }
  GAME_STATE_CHANGE:  'GAME_STATE_CHANGE',  // payload: { prev, next }
  SESSION_END:        'SESSION_END',        // payload: IScoreData
  HIGH_SCORE_BEATEN:  'HIGH_SCORE_BEATEN',  // payload: { score }
  NEAR_MISS:          'NEAR_MISS',          // payload: { score, highScore, ratio }
  TIMER_TICK:         'TIMER_TICK',         // payload: { remaining, total }
  FORCE_BONUS_SPAWN:  'FORCE_BONUS_SPAWN',  // no payload — rhythm feedback trigger
  FAIL_SOFT_ACTIVE:   'FAIL_SOFT_ACTIVE',   // payload: { active: boolean }
  FTUE_CATCH:         'FTUE_CATCH',         // payload: { remaining }
} as const;

export type GameEventName = typeof GameEvents[keyof typeof GameEvents];
