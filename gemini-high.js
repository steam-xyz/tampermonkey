// ==UserScript==
// @name         Google Gemini: Auto Set Thinking Level to High
// @namespace    https://gemini.google.com/
// @version      1.0.0
// @description  Keep Gemini's native Thinking level set to High across chats and models.
// @match        https://gemini.google.com/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(() => {
  'use strict';

  const PICKER = '[data-test-id="bard-mode-menu-button"]';
  const THINKING = '[role="menuitem"][value="thinking_level"]';
  const HIGH = /^(high|高|高等|高い)$/i;
  let busy = false;
  let timer;
  let checkedPicker;
  let checkedKey = '';
  let retryAfter = 0;
  let attemptedPicker;
  let attemptedKey = '';
  let failures = 0;

  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const expanded = element => element?.getAttribute('aria-expanded') === 'true';
  const enabled = element => element && !element.disabled &&
    element.getAttribute('aria-disabled') !== 'true';
  const visible = element => element?.isConnected && element.getClientRects().length > 0;
  const menuFor = element => document.getElementById(element?.getAttribute('aria-controls'));
  const selected = element => element?.classList.contains('selected') ||
    element?.getAttribute('aria-checked') === 'true';
  const keyFor = picker => `${location.pathname}|${picker.textContent.trim()}`;

  function highOption(thinking) {
    return Array.from(menuFor(thinking)?.querySelectorAll('[role="menuitem"]') || [])
      .find(item => HIGH.test(item.querySelector('.label')?.textContent.trim() || ''));
  }

  function schedule(delay = 200) {
    // Do not let continuous response rendering postpone a check indefinitely.
    if (!timer) timer = setTimeout(() => {
      timer = undefined;
      void check();
    }, delay);
  }

  async function waitFor(find, valid) {
    for (let attempt = 0; attempt < 20 && valid(); attempt++) {
      const result = find();
      if (result) return result;
      await sleep(50);
    }
    return null;
  }

  async function check() {
    if (busy || document.hidden || !/^\/(?:u\/\d+\/)?app(?:\/|$)/.test(location.pathname)) return;
    const picker = document.querySelector(PICKER);
    if (!visible(picker) || !enabled(picker)) return;
    const key = keyFor(picker);
    if (picker !== attemptedPicker || key !== attemptedKey) {
      attemptedPicker = picker;
      attemptedKey = key;
      checkedKey = '';
      failures = 0;
      retryAfter = 0;
    }
    if (picker === checkedPicker && key === checkedKey) return;
    if (failures >= 2 || Date.now() < retryAfter) return;
    // Let the user finish interacting with an already open menu or dialog.
    if (expanded(picker) || Array.from(document.querySelectorAll('[role="dialog"], [aria-modal="true"]')).some(visible)) return;

    busy = true;
    const previousFocus = document.activeElement;
    let interrupted = false;
    const interrupt = event => { if (event.isTrusted) interrupted = true; };
    document.addEventListener('pointerdown', interrupt, true);
    document.addEventListener('keydown', interrupt, true);
    const valid = () => !interrupted && visible(picker) && keyFor(picker) === key;
    try {
      picker.click();
      const thinking = await waitFor(() => menuFor(picker)?.querySelector(THINKING), valid);
      if (!thinking || !enabled(thinking) || !valid()) return;
      if (!expanded(thinking)) thinking.click();
      const high = await waitFor(() => {
        const option = highOption(thinking);
        return visible(option) && option;
      }, valid);
      if (!high || !enabled(high) || !valid()) return;
      if (!selected(high)) {
        high.click();
        // Selection closes the menu. Reopen it to verify actual application state.
        await sleep(100);
        if (!valid()) return;
        if (!expanded(picker)) picker.click();
        const verifyThinking = await waitFor(() => menuFor(picker)?.querySelector(THINKING), valid);
        if (!verifyThinking || !valid()) return;
        if (!expanded(verifyThinking)) verifyThinking.click();
        const verified = await waitFor(() => {
          const option = highOption(verifyThinking);
          return selected(option) && option;
        }, valid);
        if (!verified || !valid()) return;
      }
      checkedPicker = picker;
      checkedKey = key;
      failures = 0;
    } catch (error) {
      console.warn('[Gemini High] Could not select High.', error);
    } finally {
      document.removeEventListener('pointerdown', interrupt, true);
      document.removeEventListener('keydown', interrupt, true);
      // Only close menus we opened, and avoid taking focus after user input.
      if (!interrupted && picker.isConnected) {
        if (expanded(picker)) picker.click();
        if (previousFocus?.isConnected && previousFocus !== document.body) {
          previousFocus.focus({ preventScroll: true });
        }
      }
      retryAfter = Date.now() + 5000;
      if (!interrupted && checkedKey !== key && ++failures === 2) {
        console.warn('[Gemini High] High is unavailable or did not stay selected. Retry after changing chat or model.');
      }
      busy = false;
    }
  }

  document.addEventListener('click', event => {
    if (busy) return;
    const item = event.target.closest?.('[role="menuitem"]');
    // Recheck after model or thinking-level selection, including a manual downgrade.
    if (item && (item.closest('[data-test-id="gem-mode-menu"]') ||
      Array.from(document.querySelectorAll(THINKING)).some(thinking => menuFor(thinking)?.contains(item)))) {
      checkedKey = '';
      retryAfter = 0;
      failures = 0;
      schedule();
    }
  }, true);

  new MutationObserver(() => { if (!busy) schedule(); }).observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true,
  });
  window.addEventListener('popstate', () => schedule());
  document.addEventListener('visibilitychange', () => schedule());
  setInterval(() => schedule(), 2000);
  schedule();
})();
