import {
  _decorator, Component, Node, Label, Button, director, tween, Vec3,
} from 'cc';
import { SceneNames } from '../enums/SceneNames';
import { GameManager } from '../core/GameManager';
import { WeChatService } from '../services/WeChatService';
import { AnalyticsService } from '../services/AnalyticsService';
import { ISessionResult } from '../interfaces/IScoreData';

const { ccclass, property } = _decorator;

/**
 * ResultSceneUI — displays final session stats, near-miss banner,
 * new-high-score celebration, and navigation buttons.
 *
 * Data source: GameManager.lastSessionResult (static, survives scene load).
 *
 * Node path assumptions (ARCHITECTURE.md ResultScene):
 *   ResultCard/FinalScoreLabel   → finalScoreLabel
 *   ResultCard/HighScoreLabel    → highScoreLabel
 *   ResultCard/MaxComboLabel     → maxComboLabel
 *   ResultCard/BtnRetry          → btnRetry
 *   ResultCard/BtnShare          → btnShare
 *   ResultCard/BtnHome           → btnHome
 *   NearMissBanner               → nearMissBanner (hidden by default)
 *   NewHighScoreFX               → newHighScoreFX (hidden by default)
 */
@ccclass('ResultSceneUI')
export class ResultSceneUI extends Component {
  @property(Label)
  finalScoreLabel: Label | null = null;

  @property(Label)
  highScoreLabel: Label | null = null;

  @property(Label)
  maxComboLabel: Label | null = null;

  @property(Button)
  btnRetry: Button | null = null;

  @property(Button)
  btnShare: Button | null = null;

  @property(Button)
  btnHome: Button | null = null;

  /** Node with a "So Close!" label/animation — shown on near-miss. */
  @property(Node)
  nearMissBanner: Node | null = null;

  /** Particle or animation node for new-high-score celebration. */
  @property(Node)
  newHighScoreFX: Node | null = null;

  // ------------------------------------------------------------------
  // Lifecycle
  // ------------------------------------------------------------------

  onLoad(): void {
    this._populateStats();
    this._wireButtons();
  }

  onDestroy(): void {
    this.btnRetry?.node.off(Button.EventType.CLICK, this._onRetry, this);
    this.btnShare?.node.off(Button.EventType.CLICK, this._onShare, this);
    this.btnHome?.node.off(Button.EventType.CLICK,  this._onHome,  this);
  }

  // ------------------------------------------------------------------
  // Populate
  // ------------------------------------------------------------------

  private _populateStats(): void {
    const result: ISessionResult | null = GameManager.lastSessionResult;

    if (!result) {
      // Fallback: nothing to show — return to main menu
      director.loadScene(SceneNames.MAIN);
      return;
    }

    const sd = result.scoreData;

    if (this.finalScoreLabel) {
      this.finalScoreLabel.string = sd.currentScore.toString();
    }
    if (this.highScoreLabel) {
      this.highScoreLabel.string = `Best: ${sd.highScore}`;
    }
    if (this.maxComboLabel) {
      this.maxComboLabel.string = sd.maxComboReached > 1
        ? `Max Combo ×${sd.maxComboReached}`
        : '';
    }

    // Entrance animation for the score number (count-up)
    this._animateCountUp(sd.currentScore);

    // Near-miss feedback — shown only when player didn't beat the record
    // but came within 5% (NEAR_MISS event already emitted by ScoreManager)
    if (!result.isNewHighScore && sd.highScore > 0) {
      const ratio = sd.currentScore / sd.highScore;
      if (ratio >= 0.95) {
        this._showNearMiss(sd.currentScore, sd.highScore);
      }
    }

    // New high-score celebration
    if (result.isNewHighScore) {
      this._celebrateNewHighScore();
    }
  }

  // ------------------------------------------------------------------
  // Special feedback
  // ------------------------------------------------------------------

  private _showNearMiss(score: number, highScore: number): void {
    if (!this.nearMissBanner) return;
    this.nearMissBanner.active = true;

    // Find and update the label inside the banner if it exists
    const label = this.nearMissBanner.getComponentInChildren(Label);
    if (label) {
      const gap = highScore - score;
      label.string = `So close! Only ${gap} pts away from your best!`;
    }

    // Slide in from top
    const start = this.nearMissBanner.position.clone();
    this.nearMissBanner.setPosition(start.x, start.y + 200, 0);
    tween(this.nearMissBanner)
      .to(0.4, { position: start }, { easing: 'backOut' })
      .start();
  }

  private _celebrateNewHighScore(): void {
    if (this.newHighScoreFX) {
      this.newHighScoreFX.active = true;
    }
    // Pulse the score label
    if (this.finalScoreLabel) {
      tween(this.finalScoreLabel.node)
        .to(0.12, { scale: new Vec3(1.5, 1.5, 1) })
        .to(0.20, { scale: new Vec3(1.0, 1.0, 1) })
        .to(0.08, { scale: new Vec3(1.2, 1.2, 1) })
        .to(0.12, { scale: new Vec3(1.0, 1.0, 1) })
        .start();
    }
  }

  /**
   * Animated count-up from 0 to finalScore over ~1.2 s.
   * Gives the player a satisfying moment to read their score.
   */
  private _animateCountUp(finalScore: number): void {
    if (!this.finalScoreLabel) return;
    const DURATION = 1.2;
    let   elapsed  = 0;
    const label    = this.finalScoreLabel;

    this.schedule((dt: number) => {
      elapsed += dt;
      const t = Math.min(elapsed / DURATION, 1);
      // Ease-out cubic
      const eased  = 1 - Math.pow(1 - t, 3);
      label.string = Math.floor(eased * finalScore).toString();
      if (t >= 1) this.unscheduleAllCallbacks();
    }, 0 /* every frame */);
  }

  // ------------------------------------------------------------------
  // Button wiring
  // ------------------------------------------------------------------

  private _wireButtons(): void {
    this.btnRetry?.node.on(Button.EventType.CLICK, this._onRetry, this);
    this.btnShare?.node.on(Button.EventType.CLICK, this._onShare, this);
    this.btnHome?.node.on(Button.EventType.CLICK,  this._onHome,  this);
  }

  private _onRetry(): void {
    director.loadScene(SceneNames.GAME);
  }

  private _onShare(): void {
    const score = GameManager.lastSessionResult?.scoreData.currentScore ?? 0;
    WeChatService.instance?.shareAppMessage({
      title: `I scored ${score} pts! Can you beat me?`,
      query: `score=${score}`,
    });
    AnalyticsService.instance?.track('share_clicked', { score });
    AnalyticsService.instance?.flush();
  }

  private _onHome(): void {
    director.loadScene(SceneNames.MAIN);
  }
}
