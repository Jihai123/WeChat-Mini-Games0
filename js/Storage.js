'use strict';
// Storage.js — thin wrapper around wx.getStorageSync / wx.setStorageSync

const Storage = {
  /**
   * Read a value from wx storage.
   * @param {string} key
   * @param {*} defaultVal — returned when key is absent or on error
   */
  get(key, defaultVal) {
    if (defaultVal === undefined) defaultVal = null;
    try {
      const val = wx.getStorageSync(key);
      return (val !== '' && val !== null && val !== undefined) ? val : defaultVal;
    } catch (e) {
      return defaultVal;
    }
  },

  /**
   * Write a value to wx storage (synchronous, fire-and-forget on error).
   */
  set(key, val) {
    try {
      wx.setStorageSync(key, val);
    } catch (e) {
      console.warn('[Storage] setStorageSync failed:', key, e);
    }
  },
};

module.exports = Storage;
