/**
 * FeatureFlags — single source of truth for V1 / V2 feature gates.
 *
 * All flags are module-level `const` (NOT Inspector properties) so they are
 * baked into the build artifact and can be audited during WeChat review.
 * Do NOT use mutable variables or runtime toggling.
 *
 * V1 defaults (review-safe submission):
 *   FLAG_ADS_ENABLED        = true   ← banner + rewarded ads are active
 *   FLAG_INTERSTITIAL_ADS   = false  ← interstitials need separate review tier
 *   FLAG_DAILY_AD_BONUS     = false  ← watch-ad-for-bonus gated for V2
 *   FLAG_SCORE_DOUBLER      = false  ← score-change-via-ad blocked for V2
 *
 * To enable a V2 feature: flip its flag here and re-submit.
 * Never flip multiple flags in the same build — submit one feature at a time.
 */

// ---------------------------------------------------------------------------
// Global ad master switch
// ---------------------------------------------------------------------------

/**
 * Master switch for all ad surfaces (banner + rewarded + interstitial).
 * Set to false only for internal QA builds where ads should be fully silent.
 * Must be `true` in any build submitted to WeChat review.
 */
export const FLAG_ADS_ENABLED = true;

// ---------------------------------------------------------------------------
// V2 feature gates (all false in V1)
// ---------------------------------------------------------------------------

/**
 * Interstitial ads between rounds.
 * Requires a separate WeChat review approval for the interstitial ad type.
 * Flip to true after approval; AdManager.onLoad() will initialise the instance.
 */
export const FLAG_INTERSTITIAL_ADS = false;

/**
 * Daily watch-ad-for-bonus-spawns tier.
 * The free daily-claim tier remains active regardless of this flag.
 * Flip to true in V2 after review confirms rewarded ad placement policy.
 */
export const FLAG_DAILY_AD_BONUS = false;

/**
 * Score-doubler placement on the result screen (V2).
 * Changes the final session score via a rewarded ad — carries higher review
 * scrutiny. Kept off for V1 to minimise submission risk.
 */
export const FLAG_SCORE_DOUBLER = false;
