'use strict';
// DailyReward.js — daily login streak + bonus-spawn reward system
//
// Logic mirrors the production-audited DailyRewardManager.ts:
//  - "Day" = local calendar date (midnight reset, NOT raw 24 h delta)
//  - Streak increments only when calDayDiff === 1 (exactly yesterday)
//  - Claiming grants FREE_SPAWNS bonus items for the next round

const Storage  = require('./Storage');

const KEY_TS     = 'wg_daily_ts';     // timestamp of last free claim
const KEY_STREAK = 'wg_daily_streak'; // current streak count
const ONE_DAY_MS = 86_400_000;
const FREE_SPAWNS = 5; // bonus items granted per claim

const DailyReward = {
  /**
   * Returns the current state for UI rendering.
   * @returns {{ canClaim:boolean, streak:number, msUntilReset:number }}
   */
  getState() {
    const now       = Date.now();
    const lastTs    = Storage.get(KEY_TS, 0);
    const streak    = Storage.get(KEY_STREAK, 0);
    const todayStart = _todayStart();
    return {
      canClaim:     lastTs < todayStart,
      streak:       streak,
      msUntilReset: todayStart + ONE_DAY_MS - now,
    };
  },

  /**
   * Attempt to claim today's reward.
   * @returns {number|false} new streak count if claimed, false if already claimed today
   */
  claim() {
    if (!this.getState().canClaim) return false;

    const lastTs    = Storage.get(KEY_TS, 0);
    const streak    = Storage.get(KEY_STREAK, 0);

    // Calendar-day diff (safe against timezone / DST edge cases)
    const lastMid   = lastTs > 0 ? _midnight(lastTs) : 0;
    const todayMid  = _todayStart();
    const dayDiff   = lastTs > 0 ? Math.round((todayMid - lastMid) / ONE_DAY_MS) : -1;
    const newStreak = dayDiff === 1 ? streak + 1 : 1;

    Storage.set(KEY_TS,     Date.now());
    Storage.set(KEY_STREAK, newStreak);

    return newStreak; // caller adds FREE_SPAWNS to pending bonus pool
  },

  /** How many bonus spawns a successful claim grants. */
  get spawnsPerClaim() { return FREE_SPAWNS; },
};

function _todayStart() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function _midnight(ts) {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

module.exports = DailyReward;
