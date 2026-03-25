// ==UserScript==
// @name         Gmail 方向键切换邮件 (Gmail Arrow Key Navigation)
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  使用左右方向键在 Gmail 中切换上一封/下一封邮件
// @author       You
// @match        https://mail.google.com/*
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  document.addEventListener('keydown', function (e) {
    // 排除在输入框、搜索框或写邮件的富文本窗口中按键，以免影响正常打字
    const el = e.target;
    if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable) {
      return;
    }

    // 如果按下了组合键(Shift, Ctrl, Alt 等)，不触发脚本
    if (e.shiftKey || e.ctrlKey || e.altKey || e.metaKey) {
      return;
    }

    let targetKey = null;

    // 左方向键：上一封/较新的邮件 (对应 Gmail 快捷键 k)
    if (e.key === 'ArrowLeft') {
      targetKey = 'k';
    }
    // 右方向键：下一封/较旧的邮件 (对应 Gmail 快捷键 j)
    else if (e.key === 'ArrowRight') {
      targetKey = 'j';
    }

    if (targetKey) {
      e.preventDefault(); // 阻止方向键可能导致的页面水平滚动

      // 模拟触发 Gmail 的原生快捷键
      // 现代浏览器支持 KeyboardEvent 构造函数
      const keydownEvent = new KeyboardEvent('keydown', {
        key: targetKey,
        keyCode: targetKey === 'j' ? 74 : 75,
        which: targetKey === 'j' ? 74 : 75,
        bubbles: true,
        cancelable: true
      });

      const keypressEvent = new KeyboardEvent('keypress', {
        key: targetKey,
        keyCode: targetKey === 'j' ? 106 : 107,
        which: targetKey === 'j' ? 106 : 107,
        bubbles: true,
        cancelable: true
      });

      document.dispatchEvent(keydownEvent);
      document.dispatchEvent(keypressEvent);
    }
  }, true);
})();
