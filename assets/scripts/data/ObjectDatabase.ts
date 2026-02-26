import { ISpawnObjectConfig } from '../interfaces/ISpawnObject';
import { ObjectType } from '../enums/ObjectType';

/**
 * Master catalogue of every spawnable item.
 * spawnWeight values are relative — ObjectSpawner normalises them before rolling.
 * baseScoreValue for obstacles is negative (penalty on catch);
 * obstacles also set isObstacle = true, which resets the combo.
 */
export const OBJECT_DATABASE: ISpawnObjectConfig[] = [
  {
    id:             'common_small',
    type:           ObjectType.COMMON,
    prefabPath:     'prefabs/objects/CommonObject',
    baseScoreValue: 10,
    spawnWeight:    0.30,
    moveSpeedMin:   80,
    moveSpeedMax:   130,
    scaleMin:       0.8,
    scaleMax:       1.0,
    isObstacle:     false,
  },
  {
    id:             'common_large',
    type:           ObjectType.COMMON,
    prefabPath:     'prefabs/objects/CommonObject',
    baseScoreValue: 25,
    spawnWeight:    0.20,
    moveSpeedMin:   55,
    moveSpeedMax:   85,
    scaleMin:       1.1,
    scaleMax:       1.4,
    isObstacle:     false,
  },
  {
    id:             'rare_gem',
    type:           ObjectType.RARE,
    prefabPath:     'prefabs/objects/RareObject',
    baseScoreValue: 60,
    spawnWeight:    0.18,
    moveSpeedMin:   90,
    moveSpeedMax:   145,
    scaleMin:       0.7,
    scaleMax:       0.9,
    isObstacle:     false,
  },
  {
    id:             'bonus_gold',
    type:           ObjectType.BONUS,
    prefabPath:     'prefabs/objects/BonusObject',
    baseScoreValue: 100,
    spawnWeight:    0.12,
    moveSpeedMin:   45,
    moveSpeedMax:   75,
    scaleMin:       1.2,
    scaleMax:       1.5,
    isObstacle:     false,
  },
  {
    id:             'obstacle_rock',
    type:           ObjectType.OBSTACLE,
    prefabPath:     'prefabs/objects/ObstacleObject',
    baseScoreValue: -30,
    spawnWeight:    0.12,
    moveSpeedMin:   65,
    moveSpeedMax:   110,
    scaleMin:       0.9,
    scaleMax:       1.2,
    isObstacle:     true,
  },
  {
    id:             'special_star',
    type:           ObjectType.SPECIAL,
    prefabPath:     'prefabs/objects/SpecialObject',
    baseScoreValue: 200,
    spawnWeight:    0.08,
    moveSpeedMin:   38,
    moveSpeedMax:   65,
    scaleMin:       1.0,
    scaleMax:       1.2,
    isObstacle:     false,
  },
];

/**
 * FTUE override: the big-gold object guaranteed for first-time players.
 * Slow, large, very high value — impossible to miss if hook is reasonably aimed.
 */
export const FTUE_OBJECT_ID = 'bonus_gold';
export const FTUE_OBJECT_CONFIG = OBJECT_DATABASE.find(o => o.id === FTUE_OBJECT_ID)!;

/**
 * Fail-soft overlay: applied additively on top of normal weights when
 * consecutive failures exceed the threshold.  Reduces obstacle weight
 * and boosts easy/bonus items so the player gets breathing room.
 */
export const FAIL_SOFT_WEIGHT_OVERRIDE: Partial<Record<string, number>> = {
  common_small:  0.40, // more commons
  bonus_gold:    0.30, // more big gold
  obstacle_rock: 0.00, // no obstacles during fail-soft
  rare_gem:      0.20,
  common_large:  0.08,
  special_star:  0.02,
};

/**
 * Pull-weight factor per object id.
 * Higher = slower retraction.  Used by HookController to scale retract speed.
 */
export const OBJECT_PULL_WEIGHT: Record<string, number> = {
  common_small:  1.0,
  common_large:  1.7,
  rare_gem:      1.3,
  bonus_gold:    2.2,
  obstacle_rock: 1.5,
  special_star:  1.9,
};

/** Fetch a config by id — throws if id is invalid. */
export function getObjectConfig(id: string): ISpawnObjectConfig {
  const cfg = OBJECT_DATABASE.find(o => o.id === id);
  if (!cfg) throw new Error(`[ObjectDatabase] Unknown object id: ${id}`);
  return cfg;
}

/**
 * Weighted random selection from the database.
 * Pass a weight-override map to apply fail-soft or FTUE adjustments.
 */
export function rollRandomObject(
  weightOverride?: Partial<Record<string, number>>,
): ISpawnObjectConfig {
  const table = OBJECT_DATABASE.map(cfg => ({
    cfg,
    weight: weightOverride?.[cfg.id] ?? cfg.spawnWeight,
  }));
  const total = table.reduce((s, e) => s + e.weight, 0);
  let roll  = Math.random() * total;
  for (const entry of table) {
    roll -= entry.weight;
    if (roll <= 0) return entry.cfg;
  }
  return table[table.length - 1].cfg;
}
