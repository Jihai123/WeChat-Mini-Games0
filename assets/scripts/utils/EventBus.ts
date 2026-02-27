import { EventTarget } from 'cc';

// Global event bus — lazy-initialised so that the EventTarget is only
// constructed after the Cocos engine is ready, avoiding the
// "Cannot set properties of null (setting '_sealed')" error that can
// occur when modules are evaluated before the engine bootstraps.
let _bus: EventTarget | null = null;

function getBus(): EventTarget {
  if (!_bus) _bus = new EventTarget();
  return _bus;
}

// Proxy object that forwards on/off/emit to the lazily-created EventTarget.
export const EventBus = {
  on<T>(event: string, cb: (arg: T) => void, target?: unknown): void {
    getBus().on(event, cb, target);
  },
  off<T>(event: string, cb: (arg: T) => void, target?: unknown): void {
    getBus().off(event, cb, target);
  },
  emit<T>(event: string, arg: T): void {
    getBus().emit(event, arg);
  },
  once<T>(event: string, cb: (arg: T) => void, target?: unknown): void {
    getBus().once(event, cb, target);
  },
};

export const GameEvents = {
  // --- Core gameplay ---
  HOOK_CATCH:         'HOOK_CATCH',         // payload: { obj: ISpawnObjectInstance, node: Node }
  HOOK_MISS:          'HOOK_MISS',          // payload: { angle: number }
  SCORE_UPDATED:      'SCORE_UPDATED',      // payload: { score, delta, multiplier }
  COMBO_UPDATED:      'COMBO_UPDATED',      // payload: { combo, multiplier, label }
  COMBO_RESET:        'COMBO_RESET',        // payload: { consecutiveFailures }
  GAME_STATE_CHANGE:  'GAME_STATE_CHANGE',  // payload: { prev: GameState, next: GameState }
  SESSION_END:        'SESSION_END',        // payload: IScoreData
  HIGH_SCORE_BEATEN:  'HIGH_SCORE_BEATEN',  // payload: { score }
  NEAR_MISS:          'NEAR_MISS',          // payload: { score, highScore, ratio }
  TIMER_TICK:         'TIMER_TICK',         // payload: { remaining, total }
  FORCE_BONUS_SPAWN:  'FORCE_BONUS_SPAWN',  // no payload — rhythm feedback trigger
  FAIL_SOFT_ACTIVE:   'FAIL_SOFT_ACTIVE',   // payload: { active: boolean }
  FTUE_CATCH:         'FTUE_CATCH',         // payload: { remaining: number }
  // --- Commercialisation ---
  AD_REWARD_GRANTED:  'AD_REWARD_GRANTED',  // payload: { source: string }
  AD_REWARD_DENIED:   'AD_REWARD_DENIED',   // payload: { reason: 'skipped' | 'failed' }
  // --- Scene & UI lifecycle ---
  PAUSE_SHOW:         'PAUSE_SHOW',         // no payload
  PAUSE_HIDE:         'PAUSE_HIDE',         // no payload
  SCENE_LOAD_START:   'SCENE_LOAD_START',   // payload: { sceneName: string }
  // --- FTUE progression ---
  FTUE_STEP:                  'FTUE_STEP',                  // payload: { step: number, hint: string }
  FTUE_COMPLETE:              'FTUE_COMPLETE',              // no payload
  // --- Monetisation & Growth ---
  DAILY_REWARD_CLAIMED:       'DAILY_REWARD_CLAIMED',       // payload: { streak, bonusSpawns, isAdBonus?: boolean }
  SCORE_DOUBLED:              'SCORE_DOUBLED',              // payload: { original: number, doubled: number }
  INTERSTITIAL_SHOWN:         'INTERSTITIAL_SHOWN',         // no payload
  LEADERBOARD_OPEN:           'LEADERBOARD_OPEN',           // no payload
  PRE_ROUND_BONUS_ACTIVATED:  'PRE_ROUND_BONUS_ACTIVATED',  // payload: { bonusSpawns: number }
  // --- Retention: achievements & missions ---
  ACHIEVEMENT_UNLOCKED:       'ACHIEVEMENT_UNLOCKED',       // payload: { id, title, icon, rewardSpawns }
  MISSION_COMPLETED:          'MISSION_COMPLETED',          // payload: { description, completedCount }
  ALL_MISSIONS_DONE:          'ALL_MISSIONS_DONE',          // payload: { bonusSpawns: number }
} as const;

export type GameEventName = typeof GameEvents[keyof typeof GameEvents];
