import { ObjectType } from '../enums/ObjectType';

export interface ISpawnObjectConfig {
  id: string;
  type: ObjectType;
  prefabPath: string;
  baseScoreValue: number;
  spawnWeight: number;
  moveSpeedMin: number;
  moveSpeedMax: number;
  scaleMin: number;
  scaleMax: number;
  isObstacle: boolean;
}

export interface ISpawnObjectInstance {
  configId: string;
  type: ObjectType;
  scoreValue: number;
  moveSpeed: number;
  scale: number;
  isActive: boolean;
}
