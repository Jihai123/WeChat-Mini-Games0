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
