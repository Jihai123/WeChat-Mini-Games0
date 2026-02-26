export interface IScoreData {
  sessionId: string;
  currentScore: number;
  highScore: number;
  comboCount: number;
  maxComboReached: number;
  objectsCaught: number;
  objectsMissed: number;
  sessionDurationMs: number;
}

export interface ISessionResult {
  scoreData: IScoreData;
  isNewHighScore: boolean;
  playerDisplayName: string;
  playerAvatarUrl: string;
}
