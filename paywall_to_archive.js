// ==UserScript==
// @name         Paywall to Archive (Universal)
// @namespace    http://tampermonkey.net/
// @version      2.0
// @description  在各大付费新闻网站添加悬浮按钮，一键跳转到Archive.today阅读全文
// @author       FeathamityTTO
// @match        https://www.wsj.com/*
// @match        https://www.ft.com/*
// @match        https://www.nytimes.com/*
// @match        https://www.washingtonpost.com/*
// @match        https://www.economist.com/*
// @match        https://www.bloomberg.com/*
// @match        https://www.theatlantic.com/*
// @match        https://www.wired.com/*
// @match        https://www.newyorker.com/*
// @match        https://www.telegraph.co.uk/*
// @match        https://www.thetimes.co.uk/*
// @match        https://www.latimes.com/*
// @match        https://www.bostonglobe.com/*
// @match        https://www.chicagotribune.com/*
// @match        https://www.seattletimes.com/*
// @match        https://www.nature.com/*
// @match        https://www.scientificamerican.com/*
// @match        https://www.thelancet.com/*
// @match        https://www.cell.com/*
// @match        https://www.science.org/*
// @match        https://www.pnas.org/*
// @match        https://www.theinformation.com/*
// @match        https://www.vanityfair.com/*
// @match        https://www.barrons.com/*
// @match        https://www.forbes.com/*
// @match        https://www.inc.com/*
// @match        https://qz.com/*
// @match        https://www.independent.co.uk/*
// @match        https://www.smh.com.au/*
// @match        https://www.theaustralian.com.au/*
// @match        https://www.torontostar.com/*
// @match        https://nationalpost.com/*
// @match        https://www.nzherald.co.nz/*
// @match        https://www.japantimes.co.jp/*
// @match        https://www.thehindu.com/*
// @match        https://www.spectator.co.uk/*
// @match        https://www.newstatesman.com/*
// @grant        none
// @downloadURL https://update.greasyfork.org/scripts/566424/Paywall%20to%20Archive%20%28Universal%29.user.js
// @updateURL https://update.greasyfork.org/scripts/566424/Paywall%20to%20Archive%20%28Universal%29.meta.js
// ==/UserScript==

(function () {
    'use strict';

    // 网站配置 - 可以为特定网站自定义按钮文本
    const siteConfig = {
        'wsj.com': { name: 'WSJ', color: '#222' },
        'ft.com': { name: 'FT', color: '#2e6e9e' },
        'nytimes.com': { name: 'NYT', color: '#000' },
        'washingtonpost.com': { name: 'WaPo', color: '#222' },
        'economist.com': { name: 'Economist', color: '#e3120b' },
        'bloomberg.com': { name: 'Bloomberg', color: '#000' },
        'default': { name: 'Article', color: '#222' }
    };

    // 获取当前站点配置
    const hostname = window.location.hostname;
    let config = siteConfig.default;
    for (let domain in siteConfig) {
        if (hostname.includes(domain)) {
            config = siteConfig[domain];
            break;
        }
    }

    // 创建悬浮按钮
    const btn = document.createElement('button');
    btn.innerHTML = `📖 Read Free<br><small style="font-size:10px;opacity:0.8">(Archive)</small>`;

    // 设置按钮样式
    Object.assign(btn.style, {
        position: 'fixed',
        bottom: '20px',
        right: '20px',
        zIndex: '999999',
        padding: '12px 16px',
        backgroundColor: config.color,
        color: '#fff',
        border: 'none',
        borderRadius: '8px',
        cursor: 'pointer',
        boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
        fontSize: '13px',
        fontFamily: 'system-ui, -apple-system, sans-serif',
        fontWeight: '600',
        lineHeight: '1.4',
        textAlign: 'center',
        transition: 'all 0.2s ease',
        opacity: '0.85'
    });

    // 鼠标悬停效果
    btn.onmouseover = function () {
        btn.style.opacity = '1';
        btn.style.transform = 'scale(1.05)';
        btn.style.boxShadow = '0 6px 16px rgba(0,0,0,0.4)';
    };
    btn.onmouseout = function () {
        btn.style.opacity = '0.85';
        btn.style.transform = 'scale(1)';
        btn.style.boxShadow = '0 4px 12px rgba(0,0,0,0.3)';
    };

    // 点击事件
    btn.onclick = function () {
        // 清理URL参数和锚点
        let url = window.location.href;
        url = url.split('?')[0];  // 移除查询参数
        url = url.split('#')[0];  // 移除锚点

        // 特殊处理某些网站的URL
        // 例如 NYT 有时会有 /live/ 这种动态URL，可能需要特殊处理
        // 这里暂时使用通用逻辑

        // 构建Archive链接
        const archiveUrl = 'https://archive.today/latest/' + url;

        // 在新标签页打开
        window.open(archiveUrl, '_blank');

        // 可选：按钮点击反馈
        btn.innerHTML = '✓ Opened!';
        setTimeout(() => {
            btn.innerHTML = `📖 Read Free<br><small style="font-size:10px;opacity:0.8">(Archive)</small>`;
        }, 1500);
    };

    // 等待页面加载完成后添加按钮
    if (document.body) {
        document.body.appendChild(btn);
    } else {
        window.addEventListener('load', () => {
            document.body.appendChild(btn);
        });
    }

    // 键盘快捷键 (可选)：按 Alt+A 快速跳转
    document.addEventListener('keydown', function (e) {
        if (e.altKey && e.key === 'a') {
            e.preventDefault();
            btn.click();
        }
    });

})();
