// ==UserScript==
// @name         Remove UTM Tracking Parameters
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  自动识别并移除 URL 中的 utm_ 后缀（以及其他常见的追踪参数）
// @author       You
// @match        *://*/*
// @run-at       document-start
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    // 获取当前完整的 URL
    const currentUrl = new URL(window.location.href);
    const params = currentUrl.searchParams;
    let hasUtm = false;

    // 收集所有需要删除的参数键名
    // 注意：不能在迭代 params.keys() 的同时直接删除，所以先保存到一个数组中
    const keysToDelete = [];
    for (const key of params.keys()) {
        // 将键名转换为小写，匹配以 "utm_" 开头的参数
        if (key.toLowerCase().startsWith('utm_')) {
            keysToDelete.push(key);
        }

        // 【可选】如果你还想删除其他的追踪参数，可以去掉下面这行的注释
        // if (['gclid', 'fbclid', 'ref'].includes(key.toLowerCase())) keysToDelete.push(key);
    }

    // 如果找到了 utm 参数，执行删除操作
    if (keysToDelete.length > 0) {
        keysToDelete.forEach(key => {
            params.delete(key);
        });
        hasUtm = true;
    }

    // 如果 URL 被修改了，则更新浏览器的地址栏
    if (hasUtm) {
        // history.replaceState 不会触发页面刷新，只会静默改变地址栏 URL
        window.history.replaceState(null, '', currentUrl.toString());
    }
})();
