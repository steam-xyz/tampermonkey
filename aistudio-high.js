// ==UserScript==
// @name         Google AI Studio: Auto Set Thinking Level to High
// @namespace    https://aistudio.google.com/
// @version      1.2
// @description  Автоматически выставляет Thinking Level на High при переходе между чатами и моделями в Google AI Studio
// @author       torch
// @match        https://aistudio.google.com/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==
// https://greasyfork.org/en/scripts/591319-google-ai-studio-auto-set-thinking-level-to-high

(function () {
  'use strict';

  let isBusy = false;
  let busyTimer = null;

  function setBusy(val) {
    isBusy = val;
    clearTimeout(busyTimer);
    if (val) {
      // Защита: сброс блокировки через 2 секунды в любом случае
      busyTimer = setTimeout(() => { isBusy = false; }, 2000);
    }
  }

  function simulateClick(element) {
    if (!element) return;
    ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach(type => {
      element.dispatchEvent(new MouseEvent(type, {
        bubbles: true,
        cancelable: true,
        view: window,
        composed: true,
        buttons: 1
      }));
    });
    if (typeof element.click === 'function') {
      element.click();
    }
  }

  function checkAndSetHigh() {
    if (isBusy) return;

    // 1. Ищем контейнер Thinking level
    const container = document.querySelector('ms-thinking-level-setting');
    if (!container) return;

    const select = container.querySelector('mat-select');
    if (!select) return;

    // Получаем текущее значение
    const valueText = select.querySelector('.mat-mdc-select-value-text, .mat-select-value-text')?.textContent?.trim() || '';

    // Если уже High или значение еще не отрисовалось — ничего не делаем
    if (!valueText || valueText.toLowerCase() === 'high') {
      return;
    }

    setBusy(true);

    // 2. Открываем меню
    const trigger = select.querySelector('.mat-mdc-select-trigger, .mat-select-trigger') || select;
    simulateClick(trigger);

    // 3. Ищем опцию High в оверлее
    let attempts = 0;
    const maxAttempts = 25;

    const interval = setInterval(() => {
      attempts++;
      const options = Array.from(document.querySelectorAll('.cdk-overlay-container mat-option, .cdk-overlay-container [role="option"], mat-option'));

      const highOption = options.find(opt => {
        const txt = (opt.innerText || opt.textContent || '').trim().toLowerCase();
        return txt === 'high' || txt.startsWith('high\n') || txt.startsWith('high ');
      });

      if (highOption) {
        clearInterval(interval);

        const primaryText = highOption.querySelector('.mdc-list-item__primary-text') || highOption;
        simulateClick(highOption);
        simulateClick(primaryText);

        setTimeout(() => {
          setBusy(false);
        }, 300);
      } else if (attempts >= maxAttempts) {
        clearInterval(interval);
        // Закрываем меню клавишей Escape, если пункт не найден
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        setTimeout(() => {
          setBusy(false);
        }, 300);
      }
    }, 50);
  }

  // Дебаунсер вызовов
  let debounceTimer = null;
  function scheduleCheck(delay = 150) {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(checkAndSetHigh, delay);
  }

  // Функция для серии проверок (на случай долгой подгрузки чата)
  function triggerCheckSequence() {
    scheduleCheck(200);
    setTimeout(checkAndSetHigh, 600);
    setTimeout(checkAndSetHigh, 1200);
  }

  // 1. Отслеживание внутренней навигации (смена URL без перезагрузки)
  const originalPushState = history.pushState;
  history.pushState = function (...args) {
    originalPushState.apply(this, args);
    triggerCheckSequence();
  };

  const originalReplaceState = history.replaceState;
  history.replaceState = function (...args) {
    originalReplaceState.apply(this, args);
    triggerCheckSequence();
  };

  window.addEventListener('popstate', triggerCheckSequence);

  // 2. Отслеживание кликов по боковому меню (список чатов, New prompt и т.д.)
  document.addEventListener('click', (e) => {
    if (e.target.closest('nav, aside, button, a, ms-navigation-item, .nav-item')) {
      triggerCheckSequence();
    }
  }, true);

  // 3. Отслеживание динамических изменений страницы
  const observer = new MutationObserver(() => {
    scheduleCheck(200);
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true
  });

  // 4. Резервный таймер
  setInterval(checkAndSetHigh, 2000);
})();
