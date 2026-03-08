import {
  _decorator, Component, Node, Label, Button,
  director, tween, Vec3,
} from 'cc';
import { SceneNames } from '../enums/SceneNames';
import { WeChatService } from '../services/WeChatService';
import { AdManager, AdRewardResult } from '../services/AdManager';
import { DailyRewardManager } from '../monetization/DailyRewardManager';
import { AdPlacementManager } from '../monetization/AdPlacementManager';
import { LeaderboardService } from '../social/LeaderboardService';
import { AchievementManager } from '../retention/AchievementManager';
import { DailyMissionManager } from '../retention/DailyMissionManager';
import { STORAGE_KEYS } from '../data/GameConfig';
import { IPlayerData } from '../interfaces/IPlayerData';
import { AnalyticsService } from '../services/AnalyticsService';
import { EventBus, GameEvents } from '../utils/EventBus';
import { FLAG_DAILY_AD_BONUS } from '../data/FeatureFlags';

const { ccclass, property } = _decorator;

// If GameScene hasn't loaded within this many ms, re-enable the play button.
const PLAY_BUTTON_TIMEOUT_MS = 8_000;

/**
 * MainSceneUI — production main menu controller.
 *
 * Handles:
 *  - Personalised high-score + games-played display
 *  - FTUE branch: "First time?" hint for new players
 *  - Retention copy: "Can you beat X today?" for returning players
 *  - Daily reward: free claim + watch-ad-for-bonus (streak-tracked)
 *  - Pre-round bonus ad: once-per-session CTA before tapping Play
 *  - Leaderboard button: opens WeChat Open Data Context friend leaderboard
 *  - Banner ad lifecycle (show after delay, destroy before navigating away)
 *  - BtnPlay guard: lock while scene loads, auto-unlock on timeout
 *  - Scene-load error boundary
 *
 * Node assumptions (Inspector assignment, MainScene/Canvas):
 *   btnPlay            — main CTA
 *   highScoreLabel     — "Best: XXXX" / "Tap to play your first game!"
 *   displayNameLabel   — player nickname
 *   gamesPlayedLabel   — (optional) "N games played"
 *   ftueHintNode       — visible only for brand-new players
 *   dailyHintLabel     — retention copy for returning players
 *   versionLabel       — optional build version
 *
 *   btnDailyReward     — "Claim Daily Bonus" button
 *   dailyRewardBadge   — red dot indicator node (active when reward available)
 *   dailyStreakLabel    — "Day N streak 🔥"
 *   dailyRewardBtnLabel  — changes text based on state
 *
 *   btnPreRoundBonus   — "Watch Ad for Bonus Round" button (hidden after use)
 *   preRoundBonusNode  — container wrapping the above
 *
 *   btnLeaderboard     — opens friend leaderboard panel
 *   leaderboardPanel   — panel node (active = false by default)
 *   btnCloseLeaderboard — close button inside leaderboard panel
 */
@ccclass('MainSceneUI')
export class MainSceneUI extends Component {
  // ----- Core -----
  @property(Button) btnPlay:            Button | null = null;
  @property(Label)  highScoreLabel:     Label  | null = null;
  @property(Label)  displayNameLabel:   Label  | null = null;
  @property(Label)  gamesPlayedLabel:   Label  | null = null;
  @property(Node)   ftueHintNode:       Node   | null = null;
  @property(Label)  dailyHintLabel:     Label  | null = null;
  @property(Label)  versionLabel:       Label  | null = null;

  @property
  versionString: string = '1.0.0';

  /** Show banner on main menu. Toggle in Inspector. */
  @property
  enableBanner: boolean = true;

  /** Delay before banner appears (lets entrance animation finish). */
  @property
  bannerDelaySeconds: number = 1.5;

  // ----- Daily reward -----
  /**
   * Claim daily bonus / watch-ad-for-bonus button.
   * Label text is updated dynamically per state.
   */
  @property(Button) btnDailyReward:     Button | null = null;

  /** Red-dot badge: visible when a claim is available. */
  @property(Node)   dailyRewardBadge:   Node   | null = null;

  /** "Day N streak 🔥" text displayed above the daily button. */
  @property(Label)  dailyStreakLabel:   Label  | null = null;

  /** The label node on btnDailyReward (updated dynamically). */
  @property(Label)  dailyRewardBtnLabel: Label | null = null;

  // ----- Pre-round bonus -----
  /**
   * Container node for the pre-round bonus ad offer.
   * Hidden after used or when not applicable.
   */
  @property(Node)   preRoundBonusNode: Node   | null = null;
  @property(Button) btnPreRoundBonus:  Button | null = null;

  // ----- Leaderboard -----
  @property(Button) btnLeaderboard:        Button | null = null;
  @property(Node)   leaderboardPanel:      Node   | null = null;
  @property(Button) btnCloseLeaderboard:   Button | null = null;

  // ----- Daily Missions -----
  /**
   * "X/3 任务" progress label on the main menu.
   * Updated on scene load so the player immediately sees their daily progress.
   */
  @property(Label)  missionProgressLabel:  Label  | null = null;

  /** Red-dot badge: visible when at least one mission is not yet completed. */
  @property(Node)   missionBadge:          Node   | null = null;

  /** Optional button to open a full missions panel (Inspector wirable). */
  @property(Button) btnMissions:           Button | null = null;

  /** Panel node listing mission descriptions (hidden by default). */
  @property(Node)   missionsPanel:         Node   | null = null;

  /** Close button inside the missions panel. */
  @property(Button) btnCloseMissions:      Button | null = null;

  // ----- Achievements -----
  /** "成就 X/12" summary label — glanceable progress on the main menu. */
  @property(Label)  achievementSummaryLabel: Label | null = null;

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
    this._populateDailyReward();
    this._populatePreRoundBonus();
    this._populateMissions();
    this._populateAchievements();

    this.btnPlay?.node.on(Button.EventType.CLICK,              this._onPlayClicked,        this);
    this.btnDailyReward?.node.on(Button.EventType.CLICK,       this._onDailyRewardClicked, this);
    this.btnPreRoundBonus?.node.on(Button.EventType.CLICK,     this._onPreRoundBonus,      this);
    this.btnLeaderboard?.node.on(Button.EventType.CLICK,       this._onLeaderboardClicked, this);
    this.btnCloseLeaderboard?.node.on(Button.EventType.CLICK,  this._onCloseLeaderboard,   this);
    this.btnMissions?.node.on(Button.EventType.CLICK,          this._onMissionsClicked,    this);
    this.btnCloseMissions?.node.on(Button.EventType.CLICK,     this._onCloseMissions,      this);

    if (this.versionLabel) this.versionLabel.string = `v${this.versionString}`;

    // Show banner ad after entrance animation completes, then track the impression
    if (this.enableBanner) {
      this.scheduleOnce(() => {
        AdManager.instance?.showBanner();
        AnalyticsService.instance?.track('banner_shown', { placement: 'main_menu' });
      }, this.bannerDelaySeconds);
    }

    // Leaderboard panel starts hidden
    if (this.leaderboardPanel) this.leaderboardPanel.active = false;

    // Entrance animation: scale from 0.85 → 1.0
    this.node.setScale(0.85, 0.85, 1);
    tween(this.node)
      .to(0.35, { scale: new Vec3(1, 1, 1) }, { easing: 'backOut' })
      .start();

    // Subscribe to daily reward events so UI updates if claimed elsewhere
    EventBus.on(GameEvents.DAILY_REWARD_CLAIMED, this._onDailyRewardGranted, this);
  }

  onDestroy(): void {
    this.btnPlay?.node.off(Button.EventType.CLICK,             this._onPlayClicked,        this);
    this.btnDailyReward?.node.off(Button.EventType.CLICK,      this._onDailyRewardClicked, this);
    this.btnPreRoundBonus?.node.off(Button.EventType.CLICK,    this._onPreRoundBonus,      this);
    this.btnLeaderboard?.node.off(Button.EventType.CLICK,      this._onLeaderboardClicked, this);
    this.btnCloseLeaderboard?.node.off(Button.EventType.CLICK, this._onCloseLeaderboard,   this);

    this.btnMissions?.node.off(Button.EventType.CLICK,          this._onMissionsClicked,    this);
    this.btnCloseMissions?.node.off(Button.EventType.CLICK,     this._onCloseMissions,      this);

    EventBus.off(GameEvents.DAILY_REWARD_CLAIMED, this._onDailyRewardGranted, this);

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
  // Population helpers
  // ------------------------------------------------------------------

  private _populateUI(): void {
    const pd          = WeChatService.instance?.loadFromStorage<IPlayerData>(STORAGE_KEYS.PLAYER_DATA);
    const hs          = WeChatService.instance?.loadFromStorage<number>(STORAGE_KEYS.HIGH_SCORE) ?? 0;
    const isFirstTime = !pd || pd.totalGamesPlayed === 0;

    if (this.highScoreLabel) {
      this.highScoreLabel.string = hs > 0
        ? `Best: ${hs.toLocaleString()}`
        : 'Tap to play your first game!';
    }

    if (this.displayNameLabel) {
      this.displayNameLabel.string = pd?.displayName ?? 'Player';
    }

    if (this.gamesPlayedLabel) {
      const count = pd?.totalGamesPlayed ?? 0;
      this.gamesPlayedLabel.string = count > 0
        ? `${count} game${count !== 1 ? 's' : ''} played`
        : '';
    }

    if (this.ftueHintNode) this.ftueHintNode.active = isFirstTime;

    if (this.dailyHintLabel) {
      const show = !isFirstTime && hs > 0;
      this.dailyHintLabel.node.active = show;
      if (show) this.dailyHintLabel.string = `Can you beat ${hs.toLocaleString()} today?`;
    }
  }

  /** Update the daily reward button label, badge, and streak display. */
  private _populateDailyReward(): void {
    const dr = DailyRewardManager.instance;
    if (!dr || !this.btnDailyReward) return;

    const state = dr.getState();

    // In V1 the ad-bonus tier is disabled; only the free-claim tier is active.
    const adBonusAvailable = FLAG_DAILY_AD_BONUS && state.canClaimAdBonus;

    // Badge: visible when any claim is available
    if (this.dailyRewardBadge) {
      this.dailyRewardBadge.active = state.canClaimFree || adBonusAvailable;
    }

    // Streak label
    if (this.dailyStreakLabel) {
      this.dailyStreakLabel.node.active = state.streakDays > 0;
      this.dailyStreakLabel.string      = state.streakDays > 0
        ? `连续签到 ${state.streakDays} 天`
        : '';
    }

    // Button label + interactability
    if (this.btnDailyReward) {
      if (state.canClaimFree) {
        if (this.dailyRewardBtnLabel) this.dailyRewardBtnLabel.string = '领取每日奖励';
        this.btnDailyReward.interactable = true;
      } else if (adBonusAvailable) {
        if (this.dailyRewardBtnLabel) this.dailyRewardBtnLabel.string = '看广告领加倍奖励';
        this.btnDailyReward.interactable = true;
      } else {
        if (this.dailyRewardBtnLabel) this.dailyRewardBtnLabel.string = '明天再来领';
        this.btnDailyReward.interactable = false;
      }
    }
  }

  /** Show or hide the pre-round bonus offer based on session state. */
  private _populatePreRoundBonus(): void {
    if (!this.preRoundBonusNode) return;
    // Show offer only when: ad is ready AND offer hasn't been used this session
    const adReady = AdManager.instance?.isRewardedAdReady ?? false;
    const showOffer = adReady && AdPlacementManager.preRoundOfferAvailable;
    this.preRoundBonusNode.active = showOffer;
  }

  // ------------------------------------------------------------------
  // Button handlers
  // ------------------------------------------------------------------

  private _onPlayClicked(): void {
    if (this._playLocked) return;
    this._setPlayLocked(true);

    AdManager.instance?.destroyBanner();

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
          console.error('[MainSceneUI] GameScene load error:', err);
          this._setPlayLocked(false);
          if (this.highScoreLabel) this.highScoreLabel.string = 'Load failed — tap to retry';
        }
      });
    } catch (e) {
      console.error('[MainSceneUI] loadScene threw:', e);
      this._setPlayLocked(false);
    }
  }

  /**
   * Daily reward flow.
   *  - canClaimFree:     free claim → grants bonus spawns directly
   *  - canClaimAdBonus:  show rewarded video → grants extra spawns on GRANTED
   */
  private async _onDailyRewardClicked(): Promise<void> {
    const dr = DailyRewardManager.instance;
    if (!dr) return;

    const state = dr.getState();

    if (state.canClaimFree) {
      dr.claimDailyReward();
      this._populateDailyReward();
      this._showRewardToast(`+5 个额外道具，下局生效！`);
      return;
    }

    if (FLAG_DAILY_AD_BONUS && state.canClaimAdBonus) {
      if (this.btnDailyReward) this.btnDailyReward.interactable = false;
      if (this.dailyRewardBtnLabel) this.dailyRewardBtnLabel.string = '广告加载中…';

      const result = await AdManager.instance?.showRewardedAd('daily_bonus')
        ?? AdRewardResult.UNAVAILABLE;

      if (!this.isValid) return;

      if (result === AdRewardResult.GRANTED) {
        dr.claimAdBonus();
        this._populateDailyReward();
        this._showRewardToast('+5 个额外道具，下局生效！');
        AnalyticsService.instance?.track('daily_ad_bonus_claimed', {});
      } else if (result === AdRewardResult.SKIPPED) {
        if (this.dailyRewardBtnLabel) this.dailyRewardBtnLabel.string = '看完广告才能领取！';
        if (this.btnDailyReward) this.btnDailyReward.interactable = true;
      } else {
        if (this.dailyRewardBtnLabel) this.dailyRewardBtnLabel.string = '广告暂不可用';
        if (this.btnDailyReward) this.btnDailyReward.interactable = false;
      }
    }
  }

  /**
   * Pre-round bonus ad offer.
   * Grants 5 bonus spawns for the NEXT round on full ad watch.
   * Once per session — button hides after use.
   */
  private async _onPreRoundBonus(): Promise<void> {
    if (!AdPlacementManager.preRoundOfferAvailable) return;
    if (this.btnPreRoundBonus) this.btnPreRoundBonus.interactable = false;

    const result = await AdManager.instance?.showRewardedAd('pre_round_bonus')
      ?? AdRewardResult.UNAVAILABLE;

    if (!this.isValid) return;

    if (result === AdRewardResult.GRANTED) {
      AdPlacementManager.markPreRoundOfferUsed();
      DailyRewardManager.pendingBonusSpawns += 5;
      if (this.preRoundBonusNode) this.preRoundBonusNode.active = false;
      this._showRewardToast('额外道具已激活，下局生效！');
      EventBus.emit(GameEvents.PRE_ROUND_BONUS_ACTIVATED, { bonusSpawns: 5 });
      AnalyticsService.instance?.track('pre_round_bonus_accepted', {});
    } else if (result === AdRewardResult.SKIPPED) {
      if (this.btnPreRoundBonus) this.btnPreRoundBonus.interactable = true;
    } else {
      if (this.preRoundBonusNode) this.preRoundBonusNode.active = false;
    }
  }

  /** Open the WeChat friend leaderboard panel. */
  private _onLeaderboardClicked(): void {
    if (!this.leaderboardPanel) return;
    this.leaderboardPanel.active = true;
    LeaderboardService.instance?.requestRender('friends');
  }

  private _onCloseLeaderboard(): void {
    if (this.leaderboardPanel) this.leaderboardPanel.active = false;
  }

  // ------------------------------------------------------------------
  // Event bus handlers
  // ------------------------------------------------------------------

  private _onDailyRewardGranted(_payload: unknown): void {
    // Refresh the daily reward UI whenever a claim completes
    this._populateDailyReward();
  }

  // ------------------------------------------------------------------
  // Helpers
  // ------------------------------------------------------------------

  /**
   * Brief animated toast displayed below the daily reward button.
   * Reuses dailyStreakLabel for simplicity (fades back to streak text after 2 s).
   */
  private _showRewardToast(text: string): void {
    if (!this.dailyStreakLabel) return;
    this.dailyStreakLabel.string = text;
    this.dailyStreakLabel.node.active = true;

    // Scale-pulse the label for feedback
    tween(this.dailyStreakLabel.node)
      .to(0.08, { scale: new Vec3(1.2, 1.2, 1) })
      .to(0.12, { scale: new Vec3(1.0, 1.0, 1) })
      .start();

    // Restore streak text after 2 s
    this.scheduleOnce(() => {
      if (!this.isValid) return;
      const dr    = DailyRewardManager.instance;
      const days  = dr?.getState().streakDays ?? 0;
      if (this.dailyStreakLabel) {
        this.dailyStreakLabel.string = days > 0 ? `连续签到 ${days} 天` : '';
      }
    }, 2.0);
  }

  // ------------------------------------------------------------------
  // Missions & achievements population
  // ------------------------------------------------------------------

  /**
   * Refreshes the "X/3 任务" progress label and badge.
   * Called on scene load and whenever missions state changes.
   */
  private _populateMissions(): void {
    const dm = DailyMissionManager.instance;
    if (!dm) return;

    const completed = dm.completedCount;
    const total     = dm.missions.length;

    if (this.missionProgressLabel) {
      this.missionProgressLabel.string = `每日任务 ${completed}/${total}`;
    }
    // Badge: visible while any mission is unfinished
    if (this.missionBadge) {
      this.missionBadge.active = completed < total;
    }
    // Hide panel by default
    if (this.missionsPanel) this.missionsPanel.active = false;
  }

  /** Refreshes the achievement summary label ("成就 X/12"). */
  private _populateAchievements(): void {
    if (!this.achievementSummaryLabel) return;
    const unlocked = AchievementManager.instance?.unlockedCount ?? 0;
    const total    = 12; // matches ACHIEVEMENTS catalogue length
    this.achievementSummaryLabel.string = `成就 ${unlocked}/${total}`;
  }

  /** Open the daily missions panel. */
  private _onMissionsClicked(): void {
    if (!this.missionsPanel || !DailyMissionManager.instance) return;
    this.missionsPanel.active = true;

    // Populate mission labels inside the panel.
    // Expects child Labels named Mission0Label, Mission1Label, Mission2Label
    // (or just iterates all Label children if the naming convention is used).
    const labels = this.missionsPanel.getComponentsInChildren(Label);
    const missions = DailyMissionManager.instance.missions;
    missions.forEach((m, i) => {
      if (labels[i]) {
        const status = m.completed ? '✅' : `${m.current}/${m.target}`;
        labels[i].string = `${m.description}  ${status}`;
      }
    });

    AnalyticsService.instance?.track('leaderboard_viewed', { surface: 'missions_panel' });
  }

  private _onCloseMissions(): void {
    if (this.missionsPanel) this.missionsPanel.active = false;
  }

  private _setPlayLocked(locked: boolean): void {
    this._playLocked    = locked;
    this._playLockTimer = 0;
    if (this.btnPlay) this.btnPlay.interactable = !locked;
  }
}
