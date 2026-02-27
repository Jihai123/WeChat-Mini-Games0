import {
  _decorator, Component, Node, Label, Button,
  director, tween, Vec3,
} from 'cc';
import { SceneNames } from '../enums/SceneNames';
import { WeChatService } from '../services/WeChatService';
import { AdManager } from '../services/AdManager';
import { STORAGE_KEYS } from '../data/GameConfig';
import { IPlayerData } from '../interfaces/IPlayerData';

const { ccclass, property } = _decorator;

// If GameScene hasn't loaded within this many ms, re-enable the play button
// so the player can retry — prevents a dead screen on slow devices / networks.
const PLAY_BUTTON_TIMEOUT_MS = 8_000;

/**
 * MainSceneUI — production main menu controller.
 *
 * Handles:
 *  - Personalised high-score + games-played display
 *  - FTUE branch: "First time?" hint for new players
 *  - Retention copy: "Can you beat X today?" for returning players
 *  - Banner ad lifecycle (show after delay, destroy before navigating away)
 *  - BtnPlay guard: lock while scene loads, auto-unlock on timeout
 *  - Scene-load error boundary: catches director.loadScene failures and
 *    re-enables the button so the player is never stuck
 *
 * Node assumptions (Inspector assignment):
 *   btnPlay          — main CTA button
 *   highScoreLabel   — "Best: 1234" or "Tap to play!"
 *   displayNameLabel — player nickname from wx / storage
 *   gamesPlayedLabel — (optional) "12 games played"
 *   ftueHintNode     — visible only when totalGamesPlayed === 0
 *   dailyHintLabel   — retention copy for returning players
 *   versionLabel     — optional build version string
 */
@ccclass('MainSceneUI')
export class MainSceneUI extends Component {
  @property(Button)
  btnPlay: Button | null = null;

  @property(Label)
  highScoreLabel: Label | null = null;

  @property(Label)
  displayNameLabel: Label | null = null;

  /** Shows "N games played" — optional, may be null. */
  @property(Label)
  gamesPlayedLabel: Label | null = null;

  /** Visible only for brand-new players (totalGamesPlayed === 0). */
  @property(Node)
  ftueHintNode: Node | null = null;

  /** Retention copy shown for returning players with a prior high score. */
  @property(Label)
  dailyHintLabel: Label | null = null;

  /** Optional version / build label. */
  @property(Label)
  versionLabel: Label | null = null;

  @property({ type: String })
  versionString: string = '1.0.0';

  /** Show a banner ad on the main menu. Turn off in Inspector if not desired. */
  @property
  enableBanner: boolean = true;

  /** Seconds to wait before showing banner (lets menu entrance animation finish). */
  @property
  bannerDelaySeconds: number = 1.5;

  // ------------------------------------------------------------------
  // Private state
  // ------------------------------------------------------------------
  private _playLocked:    boolean = false;
  private _playLockTimer: number  = 0;

  // ------------------------------------------------------------------
  // Lifecycle
  // ------------------------------------------------------------------

  onLoad(): void {
    this._populateUI();
    this.btnPlay?.node.on(Button.EventType.CLICK, this._onPlayClicked, this);

    if (this.versionLabel) this.versionLabel.string = `v${this.versionString}`;

    // Show banner ad after entrance animation completes
    if (this.enableBanner) {
      this.scheduleOnce(() => AdManager.instance?.showBanner(), this.bannerDelaySeconds);
    }

    // Entrance: scale from 0.85 → 1.0 with spring easing
    this.node.setScale(0.85, 0.85, 1);
    tween(this.node)
      .to(0.35, { scale: new Vec3(1, 1, 1) }, { easing: 'backOut' })
      .start();
  }

  onDestroy(): void {
    this.btnPlay?.node.off(Button.EventType.CLICK, this._onPlayClicked, this);
    // Banner must be destroyed before leaving to prevent wx memory leak
    AdManager.instance?.destroyBanner();
  }

  update(dt: number): void {
    // Timeout watchdog: if scene load stalls, unlock the button
    if (!this._playLocked) return;
    this._playLockTimer += dt * 1000;
    if (this._playLockTimer >= PLAY_BUTTON_TIMEOUT_MS) {
      this._setPlayLocked(false);
      if (this.highScoreLabel) this.highScoreLabel.string = 'Network slow — tap to retry';
    }
  }

  // ------------------------------------------------------------------
  // Population
  // ------------------------------------------------------------------

  private _populateUI(): void {
    const pd          = WeChatService.instance?.loadFromStorage<IPlayerData>(STORAGE_KEYS.PLAYER_DATA);
    const hs          = WeChatService.instance?.loadFromStorage<number>(STORAGE_KEYS.HIGH_SCORE) ?? 0;
    const isFirstTime = !pd || pd.totalGamesPlayed === 0;

    // High score
    if (this.highScoreLabel) {
      this.highScoreLabel.string = hs > 0
        ? `Best: ${hs.toLocaleString()}`
        : 'Tap to play your first game!';
    }

    // Player name (wx profile or stored fallback)
    if (this.displayNameLabel) {
      this.displayNameLabel.string = pd?.displayName ?? 'Player';
    }

    // Games played
    if (this.gamesPlayedLabel) {
      const count = pd?.totalGamesPlayed ?? 0;
      this.gamesPlayedLabel.string = count > 0
        ? `${count} game${count !== 1 ? 's' : ''} played`
        : '';
    }

    // FTUE hint node — visible only for brand-new players
    if (this.ftueHintNode) {
      this.ftueHintNode.active = isFirstTime;
    }

    // Retention copy — only for returning players who have a score to beat
    if (this.dailyHintLabel) {
      const show = !isFirstTime && hs > 0;
      this.dailyHintLabel.node.active = show;
      if (show) this.dailyHintLabel.string = `Can you beat ${hs.toLocaleString()} today?`;
    }
  }

  // ------------------------------------------------------------------
  // Button handler
  // ------------------------------------------------------------------

  private _onPlayClicked(): void {
    if (this._playLocked) return;
    this._setPlayLocked(true);

    // Destroy banner before leaving (prevent it persisting into GameScene)
    AdManager.instance?.destroyBanner();

    // Button press-in feedback, then load
    if (this.btnPlay) {
      tween(this.btnPlay.node)
        .to(0.07, { scale: new Vec3(0.92, 0.92, 1) })
        .to(0.10, { scale: new Vec3(1.00, 1.00, 1) })
        .call(() => this._doLoadGameScene())
        .start();
    } else {
      this._doLoadGameScene();
    }
  }

  private _doLoadGameScene(): void {
    try {
      director.loadScene(SceneNames.GAME, (err) => {
        if (err) {
          // Scene load finished but with an error — re-enable button
          console.error('[MainSceneUI] GameScene load error:', err);
          this._setPlayLocked(false);
          if (this.highScoreLabel) this.highScoreLabel.string = 'Load failed — tap to retry';
        }
        // On success the scene replaces this one; no further action needed
      });
    } catch (e) {
      // Synchronous throw (e.g. scene name not found in build settings)
      console.error('[MainSceneUI] loadScene threw:', e);
      this._setPlayLocked(false);
    }
  }

  private _setPlayLocked(locked: boolean): void {
    this._playLocked    = locked;
    this._playLockTimer = 0;
    if (this.btnPlay) this.btnPlay.interactable = !locked;
  }
}
