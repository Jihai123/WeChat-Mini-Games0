export interface IComboTier {
  minCombo: number;
  multiplier: number;
  label: string;
}

export interface IDifficultyLevel {
  id: string;
  spawnRateMultiplier: number;
  hookSpeedMultiplier: number;
  objectSpeedMultiplier: number;
  obstacleWeightBonus: number;
}

export interface IGameConfig {
  sessionDurationSeconds: number;
  baseSpawnIntervalMs: number;
  maxActiveObjects: number;
  hookBaseSpeed: number;
  hookMaxAngleDeg: number;
  comboTiers: IComboTier[];
  difficultyLevels: IDifficultyLevel[];
  objectPoolSize: number;
}
