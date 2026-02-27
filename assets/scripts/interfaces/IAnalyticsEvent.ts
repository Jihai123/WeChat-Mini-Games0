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
  | 'ad_reward_denied'         // Player closed rewarded video early → no reward
  | 'interstitial_shown'       // Interstitial ad displayed at round break
  | 'high_score_beaten'        // Player beat their personal best mid-session
  | 'ftue_complete'            // FTUE tutorial flow finished
  | 'retry_clicked'            // Player tapped Retry (direct, without ad)
  | 'score_doubled'            // Player watched ad and doubled their score
  | 'daily_reward_claimed'     // Player claimed the free daily bonus
  | 'daily_ad_bonus_claimed'   // Player watched ad for extra daily bonus spawns
  | 'pre_round_bonus_accepted' // Player watched ad for pre-round bonus spawns
  | 'leaderboard_viewed'       // Player opened the friend leaderboard
  | 'rewarded_btn_shown'       // Ad-retry button became visible (CTR denominator)
  | 'banner_shown';            // Banner ad impression logged (placement tagged)

export interface IAnalyticsEvent {
  eventName: AnalyticsEventName;
  timestamp: number;
  sessionId: string;
  params: Record<string, string | number | boolean>;
}
