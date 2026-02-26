// Extended analytics event catalogue.
// All event names used across the project must be listed here so
// AnalyticsService.track() is fully type-checked at compile time.
export type AnalyticsEventName =
  | 'session_start'        // First event each session, includes FTUE flag
  | 'game_start'           // Fired when PLAYING state enters for the first time
  | 'session_end'          // Fired on session finalise (score, combos, duration)
  | 'level_end'            // Alias / supplemental to session_end for funnel tools
  | 'object_caught'        // Each successful catch (objectId, scoreValue, combo)
  | 'combo_milestone'      // Combo crosses a tier boundary
  | 'obstacle_hit'         // Hook catches an obstacle object
  | 'share_clicked'        // Player tapped the share button (always voluntary)
  | 'ad_shown'             // Rewarded or banner ad became visible
  | 'ad_reward_granted'    // Player watched full rewarded video → reward given
  | 'ad_reward_denied'     // Player closed rewarded video early → no reward
  | 'high_score_beaten'    // Player beat their personal best mid-session
  | 'ftue_complete'        // FTUE tutorial flow finished
  | 'retry_clicked';       // Player tapped Retry (direct, without ad)

export interface IAnalyticsEvent {
  eventName: AnalyticsEventName;
  timestamp: number;
  sessionId: string;
  params: Record<string, string | number | boolean>;
}
