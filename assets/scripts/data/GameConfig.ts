import { IGameConfig } from '../interfaces/IGameConfig';

/** Default runtime configuration. Override via resources/configs/game_config.json at runtime. */
export const DEFAULT_GAME_CONFIG: IGameConfig = {
  sessionDurationSeconds: 45,
  baseSpawnIntervalMs:    1200,
  maxActiveObjects:       8,
  hookBaseSpeed:          70,     // degrees per second of pendulum swing
  hookMaxAngleDeg:        60,
  comboTiers: [
    { minCombo: 1,  multiplier: 1.0, label: '' },
    { minCombo: 3,  multiplier: 1.5, label: 'GOOD!' },
    { minCombo: 5,  multiplier: 2.0, label: 'GREAT!' },
    { minCombo: 8,  multiplier: 3.0, label: 'AMAZING!' },
    { minCombo: 12, multiplier: 4.0, label: 'INSANE!' },
  ],
  difficultyLevels: [
    // Applied at 0 s, 15 s, 30 s respectively
    { id: 'easy',   spawnRateMultiplier: 1.0, hookSpeedMultiplier: 1.0, objectSpeedMultiplier: 1.0,  obstacleWeightBonus: 0.00 },
    { id: 'normal', spawnRateMultiplier: 1.3, hookSpeedMultiplier: 1.1, objectSpeedMultiplier: 1.25, obstacleWeightBonus: 0.05 },
    { id: 'hard',   spawnRateMultiplier: 1.6, hookSpeedMultiplier: 1.2, objectSpeedMultiplier: 1.55, obstacleWeightBonus: 0.10 },
  ],
  objectPoolSize: 12,
};

/** Session duration brackets (seconds) that determine difficulty tier index. */
export const DIFFICULTY_TIME_BRACKETS = [0, 15, 30] as const;

/** Reward rhythm: if no successful catch within this many seconds, force a bonus spawn. */
export const REWARD_RHYTHM_INTERVAL_S = 9;

/** Fail-soft: trigger boost after this many consecutive misses. */
export const FAIL_SOFT_THRESHOLD = 2;

/** FTUE: guarantee this many big-gold catches for brand-new players (totalGamesPlayed === 0). */
export const FTUE_GUARANTEED_CATCHES = 3;

/** Near-miss: within this fraction of personal-best score triggers special feedback. */
export const NEAR_MISS_RATIO = 0.05;

/** Pixel base-height of the HookLine sprite at scale = 1 (set to match art asset). */
export const HOOK_LINE_BASE_HEIGHT_PX = 100;

/** Minimum / maximum line extension in pixels. */
export const HOOK_LINE_MIN_LENGTH = 20;
export const HOOK_LINE_MAX_LENGTH = 520;

/** Drop / retract speeds in pixels per second. */
export const HOOK_DROP_SPEED    = 340;
export const HOOK_RETRACT_BASE  = 220; // Slowed by caught-object weight factor

/** Catch detection radius (pixels) at object scale = 1.0. */
export const CATCH_RADIUS_BASE  = 48;

/** LocalStorage / wx.Storage keys — all prefixed to avoid collisions. */
export const STORAGE_KEYS = {
  PLAYER_DATA:       'wg_player_data',
  HIGH_SCORE:        'wg_high_score',
  GAMES_PLAYED:      'wg_games_played',
  LAST_SESSION_RESULT: 'wg_last_result',
} as const;
