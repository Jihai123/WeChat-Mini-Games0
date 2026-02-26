# WeChat Mini Game — Cocos Creator 3.x Architecture

---

## 1. Project Folder Structure

```
WeChat-Mini-Games0/
├── assets/
│   ├── animations/
│   │   ├── hook/
│   │   │   ├── hook_cast.anim
│   │   │   ├── hook_reel.anim
│   │   │   └── hook_idle.anim
│   │   └── objects/
│   │       ├── object_idle.anim
│   │       ├── object_caught.anim
│   │       └── object_spawn.anim
│   │
│   ├── audio/
│   │   ├── bgm/
│   │   │   ├── bgm_main.mp3
│   │   │   └── bgm_game.mp3
│   │   └── sfx/
│   │       ├── sfx_cast.mp3
│   │       ├── sfx_catch.mp3
│   │       ├── sfx_combo.mp3
│   │       ├── sfx_miss.mp3
│   │       └── sfx_result.mp3
│   │
│   ├── fonts/
│   │   ├── font_main.ttf
│   │   └── font_score.ttf
│   │
│   ├── prefabs/
│   │   ├── objects/
│   │   │   ├── CommonObject.prefab
│   │   │   ├── RareObject.prefab
│   │   │   ├── BonusObject.prefab
│   │   │   ├── ObstacleObject.prefab
│   │   │   └── SpecialObject.prefab
│   │   ├── ui/
│   │   │   ├── ScorePopup.prefab
│   │   │   ├── ComboLabel.prefab
│   │   │   └── ResultCard.prefab
│   │   └── effects/
│   │       ├── FX_Catch.prefab
│   │       ├── FX_Combo.prefab
│   │       └── FX_Splash.prefab
│   │
│   ├── resources/
│   │   └── configs/
│   │       ├── game_config.json
│   │       ├── object_database.json
│   │       └── difficulty_config.json
│   │
│   ├── scenes/
│   │   ├── MainScene.scene
│   │   ├── GameScene.scene
│   │   └── ResultScene.scene
│   │
│   ├── scripts/
│   │   ├── core/
│   │   │   ├── GameManager.ts
│   │   │   ├── ScoreManager.ts
│   │   │   └── ComboManager.ts
│   │   │
│   │   ├── gameplay/
│   │   │   ├── HookController.ts
│   │   │   └── ObjectSpawner.ts
│   │   │
│   │   ├── services/
│   │   │   ├── AnalyticsService.ts
│   │   │   └── WeChatService.ts
│   │   │
│   │   ├── ui/
│   │   │   ├── MainSceneUI.ts
│   │   │   ├── GameSceneUI.ts
│   │   │   └── ResultSceneUI.ts
│   │   │
│   │   ├── interfaces/
│   │   │   ├── IGameConfig.ts
│   │   │   ├── IPlayerData.ts
│   │   │   ├── IScoreData.ts
│   │   │   ├── ISpawnObject.ts
│   │   │   ├── IAnalyticsEvent.ts
│   │   │   └── IWeChatAdapter.ts
│   │   │
│   │   ├── enums/
│   │   │   ├── GameState.ts
│   │   │   ├── ObjectType.ts
│   │   │   └── SceneNames.ts
│   │   │
│   │   ├── data/
│   │   │   ├── GameConfig.ts
│   │   │   └── ObjectDatabase.ts
│   │   │
│   │   └── utils/
│   │       ├── EventBus.ts
│   │       └── ObjectPool.ts
│   │
│   ├── textures/
│   │   ├── backgrounds/
│   │   │   ├── bg_main.png
│   │   │   └── bg_game.png
│   │   ├── objects/
│   │   │   ├── obj_common.png
│   │   │   ├── obj_rare.png
│   │   │   ├── obj_bonus.png
│   │   │   ├── obj_obstacle.png
│   │   │   └── obj_special.png
│   │   ├── hook/
│   │   │   ├── hook_line.png
│   │   │   └── hook_tip.png
│   │   └── ui/
│   │       ├── btn_play.png
│   │       ├── btn_retry.png
│   │       ├── btn_share.png
│   │       ├── icon_score.png
│   │       └── icon_combo.png
│   │
│   └── spine/
│       └── effects/
│           └── combo_burst.json
│
├── build-templates/
│   └── wechatgame/
│       ├── game.json
│       └── project.config.json
│
├── extensions/
│
├── profiles/
│   └── v2/
│       └── packages/
│           └── builder.json
│
├── settings/
│   └── v2/
│       ├── packages/
│       │   └── cocos-plugin-facebook.json
│       └── project.json
│
├── ARCHITECTURE.md
└── README.md
```

---

## 2. Scene Structure

### MainScene
```
MainScene (Node)
└── Canvas
    ├── Background (Sprite)
    ├── UI_Root (Node)
    │   ├── Logo (Sprite)
    │   ├── BtnPlay (Button)
    │   ├── BtnLeaderboard (Button)
    │   ├── PlayerInfo (Node)
    │   │   ├── AvatarFrame (Sprite)
    │   │   └── DisplayName (Label)
    │   └── HighScoreLabel (Label)
    └── MainSceneUI (Component: MainSceneUI)
```

### GameScene
```
GameScene (Node)
└── Canvas
    ├── Background (Sprite)
    ├── GameRoot (Node)
    │   ├── SpawnArea (Node)
    │   │   └── [Spawned Objects — dynamic]
    │   ├── HookRoot (Node)
    │   │   ├── HookLine (Sprite)
    │   │   └── HookTip (Sprite)
    │   └── EffectsLayer (Node)
    │       └── [Particle / FX — dynamic]
    ├── UI_Root (Node)
    │   ├── ScoreDisplay (Node)
    │   │   ├── ScoreIcon (Sprite)
    │   │   └── ScoreLabel (Label)
    │   ├── ComboDisplay (Node)
    │   │   ├── ComboLabel (Label)
    │   │   └── ComboMultiplierLabel (Label)
    │   ├── TimerBar (ProgressBar)
    │   └── BtnPause (Button)
    ├── GameManager (Component: GameManager)
    ├── HookController (Component: HookController)
    ├── ObjectSpawner (Component: ObjectSpawner)
    ├── ScoreManager (Component: ScoreManager)
    ├── ComboManager (Component: ComboManager)
    ├── AnalyticsService (Component: AnalyticsService)
    ├── WeChatService (Component: WeChatService)
    └── GameSceneUI (Component: GameSceneUI)
```

### ResultScene
```
ResultScene (Node)
└── Canvas
    ├── Background (Sprite)
    ├── ResultCard (Node)
    │   ├── FinalScoreLabel (Label)
    │   ├── HighScoreLabel (Label)
    │   ├── MaxComboLabel (Label)
    │   ├── BtnRetry (Button)
    │   ├── BtnShare (Button)
    │   └── BtnHome (Button)
    └── ResultSceneUI (Component: ResultSceneUI)
```

---

## 3. Component Architecture

### GameManager
- **Node**: GameScene root
- **Responsibilities**:
  - Owns and drives global `GameState` FSM (`IDLE → LOADING → PLAYING → PAUSED → RESULT`)
  - Orchestrates scene lifecycle (init, start, pause, resume, end)
  - Holds references to all sibling manager components
  - Listens to `EventBus` for cross-component state transitions
  - Passes `ISessionResult` to `ResultScene` via scene loading params
- **Dependencies**: ScoreManager, ComboManager, HookController, ObjectSpawner, AnalyticsService, WeChatService

---

### HookController
- **Node**: HookRoot
- **Responsibilities**:
  - Controls hook position, angle, and movement along a defined arc
  - Detects collision with spawned objects via trigger callbacks
  - Emits `HOOK_CATCH` / `HOOK_MISS` events to `EventBus`
  - Manages hook animation states: `idle`, `casting`, `reeling`
  - Exposes `HookState` for query by `GameManager`
- **Dependencies**: EventBus

---

### ObjectSpawner
- **Node**: SpawnArea
- **Responsibilities**:
  - Manages `ObjectPool` instances per `ObjectType`
  - Reads spawn schedule from `IGameConfig` (rate, weights, difficulty curve)
  - Assigns movement paths, speeds, and scale to spawned objects
  - Returns objects to pool on despawn or catch event
  - Pauses/resumes spawning on `GameState` change
- **Dependencies**: ObjectPool, ObjectDatabase, EventBus, GameConfig

---

### ScoreManager
- **Node**: GameScene root
- **Responsibilities**:
  - Accumulates score from caught object base values and combo multiplier
  - Tracks session high score vs. persisted high score
  - Exposes `IScoreData` snapshot at any point
  - Persists high score via `WeChatService`
  - Publishes `SCORE_UPDATED` event after each change
- **Dependencies**: ComboManager, WeChatService, EventBus

---

### ComboManager
- **Node**: GameScene root
- **Responsibilities**:
  - Tracks consecutive successful catches without misses
  - Defines combo tier thresholds and corresponding multipliers
  - Resets combo count on a miss or obstacle hit
  - Publishes `COMBO_UPDATED` and `COMBO_RESET` events
  - Exposes current multiplier to `ScoreManager`
- **Dependencies**: EventBus

---

### AnalyticsService
- **Node**: GameScene root
- **Responsibilities**:
  - Implements adapter over WeChat's `wx.reportEvent` / `wx.reportMonitor`
  - Queues `IAnalyticsEvent` objects and flushes on batch threshold or scene end
  - Tracks: `session_start`, `session_end`, `level_complete`, `combo_milestone`, `share_clicked`
  - Sanitizes and validates event payloads before dispatch
- **Dependencies**: WeChatService

---

### WeChatService (Adapter Pattern)
- **Node**: GameScene root
- **Responsibilities**:
  - Single boundary between game logic and WeChat Mini Game JS API
  - Implements `IWeChatAdapter` interface
  - Wraps: `wx.getUserInfo`, `wx.shareAppMessage`, `wx.showInterstitialAd`, `wx.createBannerAd`
  - Wraps: `wx.setStorageSync` / `wx.getStorageSync` for persistence
  - Wraps: `wx.vibrateShort` / `wx.vibrateLong`
  - Provides typed, Promise-based methods regardless of underlying wx callback style
  - Enables mock injection for editor/desktop testing
- **Dependencies**: IWeChatAdapter

---

## 4. Data Models and Interfaces

> All interfaces are defined in `assets/scripts/interfaces/`.

### IGameConfig.ts
```typescript
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

export interface IComboTier {
  minCombo: number;
  multiplier: number;
  label: string;
}
```

### IPlayerData.ts
```typescript
export interface IPlayerData {
  playerId: string;
  displayName: string;
  avatarUrl: string;
  highScore: number;
  totalGamesPlayed: number;
  lastPlayedTimestamp: number;
}
```

### IScoreData.ts
```typescript
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
```

### ISpawnObject.ts
```typescript
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
```

### IAnalyticsEvent.ts
```typescript
export type AnalyticsEventName =
  | 'session_start'
  | 'session_end'
  | 'object_caught'
  | 'combo_milestone'
  | 'obstacle_hit'
  | 'share_clicked'
  | 'ad_shown'
  | 'high_score_beaten';

export interface IAnalyticsEvent {
  eventName: AnalyticsEventName;
  timestamp: number;
  sessionId: string;
  params: Record<string, string | number | boolean>;
}
```

### IWeChatAdapter.ts
```typescript
export interface IUserInfoResult {
  nickName: string;
  avatarUrl: string;
  gender: number;
  city: string;
  province: string;
  country: string;
}

export interface IShareOptions {
  title: string;
  imageUrl?: string;
  query?: string;
}

export interface IWeChatAdapter {
  getUserInfo(): Promise<IUserInfoResult>;
  shareAppMessage(options: IShareOptions): void;
  showInterstitialAd(adUnitId: string): Promise<void>;
  createBannerAd(adUnitId: string, style: object): void;
  destroyBannerAd(): void;
  saveToStorage(key: string, data: unknown): void;
  loadFromStorage<T>(key: string): T | null;
  removeFromStorage(key: string): void;
  vibrateShort(): void;
  vibrateLong(): void;
  reportEvent(eventId: string, data: Record<string, string | number>): void;
  getSystemInfo(): Promise<Record<string, unknown>>;
}
```

### Enums

#### GameState.ts
```typescript
export enum GameState {
  IDLE      = 'IDLE',
  LOADING   = 'LOADING',
  PLAYING   = 'PLAYING',
  PAUSED    = 'PAUSED',
  RESULT    = 'RESULT',
}
```

#### ObjectType.ts
```typescript
export enum ObjectType {
  COMMON   = 'COMMON',
  RARE     = 'RARE',
  BONUS    = 'BONUS',
  OBSTACLE = 'OBSTACLE',
  SPECIAL  = 'SPECIAL',
}
```

#### SceneNames.ts
```typescript
export enum SceneNames {
  MAIN   = 'MainScene',
  GAME   = 'GameScene',
  RESULT = 'ResultScene',
}
```

---

## 5. Scene Flow Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                        APP LAUNCH                           │
└───────────────────────────┬─────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                       MainScene                             │
│                                                             │
│  ┌──────────────┐     ┌──────────────┐                      │
│  │  WeChatService│────▶│  PlayerData  │                      │
│  │  getUserInfo  │     │  (load HS)   │                      │
│  └──────────────┘     └──────────────┘                      │
│                                                             │
│   [BtnPlay tapped]                                          │
└───────────────────────────┬─────────────────────────────────┘
                            │ director.loadScene(GameScene)
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                       GameScene                             │
│                                                             │
│  GameState: LOADING                                         │
│  ├── WeChatService.loadFromStorage() → restore PlayerData   │
│  ├── ObjectDatabase.load()                                  │
│  ├── ObjectPool.init() per ObjectType                       │
│  └── GameConfig resolved                                    │
│                            │                               │
│  GameState: PLAYING        │ onReady()                     │
│  ├── ObjectSpawner.start() ◀┘                              │
│  ├── HookController.enable()                                │
│  ├── ComboManager.reset()                                   │
│  ├── ScoreManager.reset()                                   │
│  └── AnalyticsService.track(session_start)                  │
│                                                             │
│  ── [Game Loop] ─────────────────────────────────────────── │
│  │  HookController ──HOOK_CATCH──▶ ObjectSpawner.despawn()  │
│  │                            ├──▶ ComboManager.increment() │
│  │                            └──▶ ScoreManager.add()       │
│  │  HookController ──HOOK_MISS───▶ ComboManager.reset()     │
│  │  ScoreManager   ──SCORE_UPDATED▶ GameSceneUI.refresh()   │
│  │  ComboManager   ──COMBO_UPDATED▶ GameSceneUI.refresh()   │
│  └────────────────────────────────────────────────────────  │
│                                                             │
│  GameState: RESULT  (timer expires or stop condition)       │
│  ├── HookController.disable()                               │
│  ├── ObjectSpawner.stop()                                   │
│  ├── ScoreManager.persist() via WeChatService               │
│  └── AnalyticsService.track(session_end) + flush()          │
│                                                             │
└───────────────────────────┬─────────────────────────────────┘
                            │ director.loadScene(ResultScene, IScoreData)
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                      ResultScene                            │
│                                                             │
│  ├── Display IScoreData (score, highScore, maxCombo)        │
│  ├── BtnRetry  ──▶ loadScene(GameScene)                     │
│  ├── BtnShare  ──▶ WeChatService.shareAppMessage()          │
│  │               └─▶ AnalyticsService.track(share_clicked)  │
│  └── BtnHome   ──▶ loadScene(MainScene)                     │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## 6. EventBus Event Catalogue

| Event Name        | Publisher         | Subscribers                          |
|-------------------|-------------------|--------------------------------------|
| `HOOK_CATCH`      | HookController    | ObjectSpawner, ComboManager, ScoreManager, AnalyticsService |
| `HOOK_MISS`       | HookController    | ComboManager, AnalyticsService       |
| `SCORE_UPDATED`   | ScoreManager      | GameSceneUI                          |
| `COMBO_UPDATED`   | ComboManager      | ScoreManager, GameSceneUI            |
| `COMBO_RESET`     | ComboManager      | ScoreManager, GameSceneUI            |
| `GAME_STATE_CHANGE` | GameManager     | All components                       |
| `SESSION_END`     | GameManager       | ScoreManager, AnalyticsService, GameSceneUI |
| `HIGH_SCORE_BEATEN` | ScoreManager    | AnalyticsService, GameSceneUI        |
