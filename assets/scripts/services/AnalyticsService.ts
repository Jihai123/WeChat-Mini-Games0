import { _decorator, Component } from 'cc';
import { IAnalyticsEvent, AnalyticsEventName } from '../interfaces/IAnalyticsEvent';
import { WeChatService } from './WeChatService';

const { ccclass } = _decorator;

/** Flush the queue after this many events accumulate (or on session end). */
const BATCH_SIZE = 8;

/**
 * Monetization conversion events that must be flushed immediately.
 * These events are used for revenue attribution — delayed delivery would
 * corrupt funnel metrics if the user closes the app right after the event.
 */
const CRITICAL_EVENTS = new Set<string>([
  'ad_reward_granted',       // Rewarded ad fully watched — highest-value signal
  'ad_shown',                // Any ad impression confirmed visible
  'daily_reward_claimed',    // Free retention action
  'daily_ad_bonus_claimed',  // Paid retention conversion
  'pre_round_bonus_accepted',// Pre-round ad conversion
  'high_score_beaten',       // Engagement peak — useful for cohort analysis
  'session_end',             // Always flush on session boundary
]);

/**
 * AnalyticsService — thin adapter over wx.reportEvent.
 *
 * Events are queued in memory and flushed in batches.  The caller never
 * waits for analytics; failures are swallowed silently to avoid blocking
 * gameplay code paths.
 */
@ccclass('AnalyticsService')
export class AnalyticsService extends Component {
  private static _instance: AnalyticsService | null = null;
  private _queue: IAnalyticsEvent[] = [];
  private _sessionId: string = '';

  static get instance(): AnalyticsService | null { return AnalyticsService._instance; }

  onLoad(): void {
    AnalyticsService._instance = this;
  }

  onDestroy(): void {
    if (AnalyticsService._instance === this) AnalyticsService._instance = null;
  }

  /** Must be called once per session before any track() calls. */
  init(sessionId: string): void {
    this._sessionId = sessionId;
    this._queue     = [];
  }

  /**
   * Enqueue an analytics event.
   * `params` values must be primitive (string | number | boolean).
   */
  track(
    eventName: AnalyticsEventName,
    params: Record<string, string | number | boolean> = {},
  ): void {
    const event: IAnalyticsEvent = {
      eventName,
      timestamp: Date.now(),
      sessionId: this._sessionId,
      params,
    };
    this._queue.push(event);
    // Critical events flush immediately to avoid data loss on app close
    if (CRITICAL_EVENTS.has(eventName) || this._queue.length >= BATCH_SIZE) {
      this.flush();
    }
  }

  /**
   * Dispatch all queued events to wx.reportEvent and clear the queue.
   * Called automatically on batch threshold and by GameManager on session end.
   */
  flush(): void {
    if (!WeChatService.instance || this._queue.length === 0) return;
    for (const evt of this._queue) {
      const flat: Record<string, string | number> = {};
      for (const [k, v] of Object.entries(evt.params)) {
        flat[k] = typeof v === 'boolean' ? (v ? 1 : 0) : v;
      }
      WeChatService.instance.reportEvent(evt.eventName, flat);
    }
    this._queue = [];
  }
}
