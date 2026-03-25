// ==UserScript==
// @name         GitHub Notifications Auto Fill + Bulk
// @namespace    https://github.com/notifications
// @version      0.2.0
// @description  Auto append pages to reach target count and batch bulk actions.
// @match        https://github.com/notifications*
// @run-at       document-idle
// @grant        none
// @license MIT
// @downloadURL https://update.greasyfork.org/scripts/569781/GitHub%20Notifications%20Auto%20Fill%20%2B%20Bulk.user.js
// @updateURL https://update.greasyfork.org/scripts/569781/GitHub%20Notifications%20Auto%20Fill%20%2B%20Bulk.meta.js
// ==/UserScript==

(function () {
  "use strict";

  const config = {
    targetCount: 100,
    bulkBatchSize: 25,
    maxPages: 4,
    bulkParallelism: 2
  };

  let bulkHandlerInstalled = false;
  let selectAllHandlerInstalled = false;
  let appendInFlight = false;
  let appendScheduled = false;
  let appendDisabled = false;
  let observer = null;

  function getList() {
    return document.querySelector(".js-notifications-list .Box-body > ul");
  }

  function getNextUrl(doc = document) {
    const next = doc.querySelector('nav.paginate-container a[aria-label="Next"]');
    return next ? next.href : null;
  }

  function countItems(root = document) {
    return root.querySelectorAll(".js-notifications-list-item").length;
  }

  function getIds(root = document) {
    const ids = new Set();
    root.querySelectorAll(".js-notifications-list-item").forEach((li) => {
      if (li.dataset.notificationId) ids.add(li.dataset.notificationId);
    });
    return ids;
  }

  function getAllIds() {
    const ids = [];
    document.querySelectorAll(".js-notifications-list-item").forEach((li) => {
      if (li.dataset.notificationId) ids.push(li.dataset.notificationId);
    });
    return ids;
  }

  function getSelectedIds() {
    const selectAll = document.querySelector(".js-notifications-mark-all-prompt");
    if (selectAll && selectAll.checked) {
      return getAllIds();
    }

    const ids = [];
    document
      .querySelectorAll(".js-notification-bulk-action-check-item:checked")
      .forEach((input) => {
        if (input.value) ids.push(input.value);
      });
    return ids;
  }

  function chunkIds(ids, size) {
    const chunks = [];
    for (let i = 0; i < ids.length; i += size) {
      chunks.push(ids.slice(i, i + size));
    }
    return chunks;
  }

  function getAuthToken(form) {
    const tokenInput = form.querySelector('input[name="authenticity_token"]');
    return tokenInput ? tokenInput.value : "";
  }

  async function submitBulkAction(form, ids) {
    const action = form.getAttribute("action") || "";
    const token = getAuthToken(form);
    if (!action || !token) return;

    const batches = chunkIds(ids, config.bulkBatchSize);
    const parallel = Math.max(1, config.bulkParallelism | 0);
    let index = 0;

    async function runNext() {
      while (index < batches.length) {
        const batch = batches[index];
        index += 1;
        const body = new URLSearchParams();
        body.set("authenticity_token", token);
        batch.forEach((id) => body.append("notification_ids[]", id));
        await fetch(action, {
          method: "POST",
          credentials: "same-origin",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8"
          },
          body: body.toString()
        });
      }
    }

    const workers = [];
    for (let i = 0; i < parallel; i += 1) {
      workers.push(runNext());
    }
    await Promise.all(workers);
  }

  function installBulkActionOverride() {
    if (bulkHandlerInstalled) return;
    bulkHandlerInstalled = true;

    document.addEventListener(
      "submit",
      (event) => {
        const form = event.target;
        if (!(form instanceof HTMLFormElement)) return;
        const action = form.getAttribute("action") || "";
        if (!/\/notifications\/beta\/(mark|unmark|archive|unarchive)$/.test(action)) {
          return;
        }

        const ids = getSelectedIds();
        if (!ids.length) return;

        event.preventDefault();
        event.stopPropagation();

        submitBulkAction(form, ids).then(() => {
          location.reload();
        });
      },
      true
    );
  }

  function updateSelectedCount() {
    const count = document.querySelectorAll(
      ".js-notification-bulk-action-check-item:checked"
    ).length;
    const countTarget = document.querySelector("[data-check-all-count]");
    if (countTarget) countTarget.textContent = String(count);
  }

  function installSelectAllOverride() {
    if (selectAllHandlerInstalled) return;
    selectAllHandlerInstalled = true;

    document.addEventListener("change", (event) => {
      const target = event.target;
      if (!(target instanceof HTMLInputElement)) return;
      if (!target.classList.contains("js-notifications-mark-all-prompt")) return;

      const checked = target.checked;
      document
        .querySelectorAll(".js-notification-bulk-action-check-item")
        .forEach((input) => {
          input.checked = checked;
        });
      updateSelectedCount();
    });
  }

  function shouldAppend() {
    if (appendDisabled) return false;
    return Boolean(getList() && getNextUrl() && countItems() < config.targetCount);
  }

  async function appendUntilTarget() {
    if (appendInFlight || !shouldAppend()) return;
    appendInFlight = true;

    try {
      const list = getList();
      if (!list) return;

      const seen = getIds();
      const visited = new Set();
      let nextUrl = getNextUrl();
      let lastCount = countItems();
      let progressed = false;
      let pagesFetched = 0;

      while (nextUrl && countItems() < config.targetCount) {
        if (pagesFetched >= config.maxPages) break;
        if (visited.has(nextUrl)) break;
        visited.add(nextUrl);

        const res = await fetch(nextUrl, { credentials: "same-origin" });
        const html = await res.text();
        const doc = new DOMParser().parseFromString(html, "text/html");

        let added = 0;
        doc.querySelectorAll(".js-notifications-list-item").forEach((li) => {
          if (countItems() >= config.targetCount) return;
          const id = li.dataset.notificationId;
          if (id && seen.has(id)) return;
          if (id) seen.add(id);
          list.appendChild(li);
          added += 1;
        });

        nextUrl = getNextUrl(doc);
        if (added > 0) progressed = true;
        if (added === 0 && countItems() === lastCount) break;
        lastCount = countItems();
        pagesFetched += 1;
      }

      if (countItems() > config.targetCount) {
        const items = list.querySelectorAll(".js-notifications-list-item");
        for (let i = config.targetCount; i < items.length; i += 1) {
          items[i].remove();
        }
      }

      if (document.querySelector(".js-notifications-mark-all-prompt:checked")) {
        document
          .querySelectorAll(".js-notification-bulk-action-check-item")
          .forEach((input) => {
            input.checked = true;
          });
        updateSelectedCount();
      }

      if (
        !getNextUrl() ||
        countItems() >= config.targetCount ||
        !progressed ||
        pagesFetched >= config.maxPages
      ) {
        appendDisabled = true;
        if (observer) observer.disconnect();
      }
    } finally {
      appendInFlight = false;
    }
  }

  function scheduleAppend() {
    if (appendScheduled) return;
    appendScheduled = true;
    setTimeout(() => {
      appendScheduled = false;
      appendUntilTarget().catch(() => { });
    }, 50);
  }

  function init() {
    appendDisabled = false;
    appendInFlight = false;
    appendScheduled = false;
    installBulkActionOverride();
    installSelectAllOverride();
    scheduleAppend();
  }

  init();
  document.addEventListener("turbo:load", init);

  observer = new MutationObserver(() => {
    if (shouldAppend()) scheduleAppend();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
})();
