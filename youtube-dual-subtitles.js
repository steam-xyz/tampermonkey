// ==UserScript==
// @name         YouTube Dual Subtitles
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  Add dual subtitles to YouTube
// @author       Vinh Nguyen
// @match        https://www.youtube.com/watch*
// @grant        none
// ==/UserScript==

// https://github.com/vinh-ntuan/youtube-dual-subtitles

(function () {
    "use strict";

    // Change this to switch dual subtitle language
    const DEFAULT_LANG = "en";
    const FALLBACK_LANG = "en-asr"

    // Returns url for YouTube Subtitle API: youtube.com/api/timedtext...
    // including PO Token, without which fetching subtitle returns empty string. Should look something like
    // pot=<PO_TOKEN>&fmt=json3&xorb=2&xobt=3&xovt=3&cbr=Firefox&cplatform=DESKTOP
    // See https://github.com/yt-dlp/yt-dlp/wiki/PO-Token-Guide for more info
    async function extractTimedTextUrl(maxRetries = 5) {
        const subtitleButtonSelector = ".ytp-subtitles-button";
        const subtitleButton = document.querySelector(subtitleButtonSelector);
        if (!subtitleButton) {
            throw new Error("Subtitle button not found");
        }

        let timedTextUrl = null;
        // Do this multiple times since the first time often fails (at least in Firefox)
        let retries = maxRetries;
        while (retries > 0) {
            console.log("Trying to find timedtext URL. Try " + retries + "/" + maxRetries)
            // Toggle button twice to trigger timedtext request
            subtitleButton.click();
            subtitleButton.click();

            await pause(500);


            // Look for HTTP requests in performances entries
            const entries = performance.getEntriesByType("resource");
            for (const entry of entries) {
                const isTimedText = entry.name.includes("timedtext");
                const hasPot = entry.name.includes("&pot=");

                if (isTimedText && hasPot) {
                    console.log("Found matching timedtext request with &pot= parameter!");
                    timedTextUrl = new URL(entry.name);
                    timedTextUrl.searchParams.set("fmt", "vtt"); // track elems require vtt format
                    timedTextUrl.searchParams.delete("tlang"); // tlang links are for auto-translated subs
                    timedTextUrl.searchParams.delete("kind");
                    break;
                }
            }

            if (timedTextUrl) {
                console.log("Timed text url: " + timedTextUrl);
                break;
            } else {
                console.log("No timedtext URL / requests with &pot= parameter found");
                retries--;
            }
        }

        return timedTextUrl;
    }

    // Returns subtitle data in URI form + vtt format, to use in track element
    // Expected language code: en, zh-CN, ...
    async function fetchSubtitleData(baseUrl, language, isAsr=false) {
        let subtitleUrl = new URL(baseUrl);
        subtitleUrl.searchParams.set("lang", language);
        if (isAsr) {
            subtitleUrl.searchParams.set("kind", "asr");
        }
        const response = await fetch(subtitleUrl);

        if (!response.ok) {
            throw new Error("Couldn't fetch subtitle data with language " + language);
        }

        console.log("Successfully fetched subtitle for language " + language);
        const responseText = await response.text();
        return "data:text/vtt," + encodeURIComponent(responseText);
    }

    // Fills the selector with available languages
    function populateLanguageSelector(selector){
        const captionTracks = document.querySelector("#movie_player")
            .getPlayerResponse()
            .captions
            .playerCaptionsTracklistRenderer
            .captionTracks;

        for (const track of captionTracks) {
            const isAsr = track.kind === "asr";
            const languageCode = track.languageCode;
            const languageName = track.name.simpleText;

            const opt = document.createElement("option");
            opt.value = isAsr ? languageCode + "-asr" : languageCode;
            opt.textContent = languageName

            selector.appendChild(opt);
        }
    }

    // Load the subtitle with the given language to the track element
    // languageCode may contains "-asr" to indicate auto-subtitles, e.g "en-asr"
    async function loadSubtitle(track, baseTimedTextUrl, languageCode){
        // handles codes containing asr, e.g "en-asr"
        let isAsr = languageCode.endsWith("-asr");
        let language = isAsr ? languageCode.slice(0,-4) : languageCode;

        let subtitleData = await fetchSubtitleData(baseTimedTextUrl, language, isAsr);
        console.log("Changing secondary subtitle to language " + language);
        track.src = subtitleData;
    }

    function pause (milliseconds) {
        return new Promise((resolve) => setTimeout(resolve, milliseconds));
    }

    // HTML for the menuitem for selecting secondary subtitle language
    const menuItemContent = `
    <div class="ytp-menuitem-icon"><svg height="24" viewBox="0 0 24 24" width="24"><path d="M21.20 3.01L21 3H3L2.79 3.01C2.30 3.06 1.84 3.29 1.51 3.65C1.18 4.02 .99 4.50 1 5V19L1.01 19.20C1.05 19.66 1.26 20.08 1.58 20.41C1.91 20.73 2.33 20.94 2.79 20.99L3 21H21L21.20 20.98C21.66 20.94 22.08 20.73 22.1 20.41C22.73 20.08 22.94 19.66 22.99 19.20L23 19V5C23.00 4.50 22.81 4.02 22.48 3.65C22.15 3.29 21.69 3.06 21.20 3.01ZM3 19V5H21V19H3ZM6.97 8.34C6.42 8.64 5.96 9.09 5.64 9.63L5.50 9.87C5.16 10.53 4.99 11.26 5 12L5.00 12.27C5.04 12.92 5.21 13.55 5.50 14.12L5.64 14.36C5.96 14.90 6.42 15.35 6.97 15.65L7.21 15.77C7.79 16.01 8.43 16.06 9.03 15.91L9.29 15.83C9.88 15.61 10.39 15.23 10.77 14.73C10.93 14.53 11.00 14.27 10.97 14.02C10.94 13.77 10.82 13.53 10.63 13.37C10.44 13.20 10.19 13.11 9.93 13.12C9.68 13.13 9.44 13.24 9.26 13.43L9.19 13.50C9.05 13.70 8.85 13.85 8.62 13.94L8.54 13.97C8.35 14.02 8.16 14.00 7.99 13.92L7.91 13.88C7.67 13.75 7.48 13.56 7.35 13.32L7.28 13.20C7.11 12.88 7.02 12.52 7.00 12.16L7 12C6.99 11.58 7.09 11.16 7.28 10.79L7.35 10.67C7.48 10.43 7.67 10.24 7.91 10.11C8.10 10.00 8.32 9.97 8.54 10.02L8.62 10.05C8.81 10.12 8.98 10.24 9.11 10.39L9.19 10.49L9.26 10.57C9.43 10.74 9.66 10.85 9.91 10.87C10.15 10.89 10.40 10.81 10.59 10.66C10.79 10.51 10.92 10.29 10.96 10.05C11.01 9.80 10.96 9.55 10.83 9.34L10.77 9.26L10.60 9.05C10.24 8.65 9.79 8.35 9.29 8.16L9.03 8.08C8.34 7.91 7.60 8.00 6.97 8.34ZM14.97 8.34C14.42 8.64 13.96 9.09 13.64 9.63L13.50 9.87C13.16 10.53 12.99 11.26 13 12L13.00 12.27C13.04 12.92 13.21 13.55 13.50 14.12L13.64 14.36C13.96 14.90 14.42 15.35 14.97 15.65L15.21 15.77C15.79 16.01 16.43 16.06 17.03 15.91L17.29 15.83C17.88 15.61 18.39 15.23 18.77 14.73C18.93 14.53 19.00 14.27 18.97 14.02C18.94 13.77 18.82 13.53 18.63 13.37C18.44 13.20 18.19 13.11 17.93 13.12C17.68 13.13 17.44 13.24 17.26 13.43L17.19 13.50C17.05 13.70 16.85 13.85 16.62 13.94L16.54 13.97C16.35 14.02 16.16 14.00 15.99 13.92L15.91 13.88C15.67 13.75 15.48 13.56 15.35 13.32L15.28 13.20C15.11 12.88 15.02 12.52 15.00 12.16L15 12C14.99 11.58 15.09 11.16 15.28 10.79L15.35 10.67C15.48 10.43 15.67 10.24 15.91 10.11C16.10 10.00 16.32 9.97 16.54 10.02L16.62 10.05C16.81 10.12 16.98 10.24 17.11 10.39L17.19 10.49L17.26 10.57C17.43 10.74 17.66 10.85 17.91 10.87C18.15 10.89 18.40 10.81 18.59 10.66C18.79 10.51 18.92 10.29 18.96 10.05C19.01 9.80 18.96 9.55 18.83 9.34L18.77 9.26L18.60 9.05C18.24 8.65 17.79 8.35 17.29 8.16L17.03 8.08C16.34 7.91 15.60 8.00 14.97 8.34Z" fill="white"></path></svg></div>
    <div class="ytp-menuitem-label">Second Subtitles/CC</div>
    <div class="ytp-menuitem-content">
        <select name="subtitle2-language">
        </select>
    </div>
    `;

    // Places the given menuitem after the original YouTube Subtitles MenuItem
    async function placeMenuItem(menuitem){
        const menu = document.querySelector(".ytp-panel-menu");

        // Toggle settings button to trigger menu creation
        // YouTube properly lazy-initializes this
        const settingsButton = document.querySelector((".ytp-settings-button"));
        settingsButton.click()
        settingsButton.click()
        await pause(500);

        const items = menu.querySelectorAll(".ytp-menuitem");
        let subtitlesItem = null;
        // Looks for the menuitem containing text "Subtitles"
        for (const item of items) {
            const label = item.querySelector(".ytp-menuitem-label");
            if (!label) continue;

            if (label.textContent.includes("Subtitles")) {
                subtitlesItem = item;
                break;
            }
        }

        if (!subtitlesItem){
            throw new Error("Couldn't find original subtitles menu item");
        }
        subtitlesItem.after(menuitem);
    }

    async function main(){
        try {
            // Sets up UI
            // Secondary subtitle using the track element
            const video = document.querySelector("video");
            const track = document.createElement("track");
            track.className = "dual-subtitle-track"
            video.appendChild(track);

            const youtubeMenu = document.querySelector(".ytp-panel-menu");
            // Sets up our menu item for language selection
            // Removes old language menu item if Youtube retains it while switching videos
            youtubeMenu.querySelector(".dual-subtitles-menuitem")?.remove();
            const languageSelectMenuItem = document.createElement("div");
            languageSelectMenuItem.className = "ytp-menuitem dual-subtitles-menuitem";
            languageSelectMenuItem.setAttribute("role", "menuitem");
            languageSelectMenuItem.setAttribute("tabindex", "0");
            languageSelectMenuItem.innerHTML = menuItemContent;

            // Place our menuitem after the YouTube subtitle language selection
            await placeMenuItem(languageSelectMenuItem)

            const languageSelect = languageSelectMenuItem.querySelector("select");
            languageSelect.style.background = "transparent";
            languageSelect.style.border = "none";
            languageSelect.style.color = "inherit";
            languageSelect.style.textAlign = "right";
            // Not bothered enough for proper font size and aligning the select

            populateLanguageSelector(languageSelect);

            // Checking available languages
            const availableLanguages = [...languageSelect.options].map(o => o.value);
            if (availableLanguages.length < 2){
                console.log("Less than two languages detected. Exiting.")
                return;
            }

            // Load subtitle with default language
            let initialSubLang;
            if (availableLanguages.includes(DEFAULT_LANG)){
                initialSubLang = DEFAULT_LANG;
            } else if (availableLanguages.includes(FALLBACK_LANG)){
                initialSubLang = FALLBACK_LANG;
            } else {
                initialSubLang = languageSelect.value;
            }
            languageSelect.value = initialSubLang;

            // Base timetext URL is used to fetch subs by changing the lang query parameter
            let baseTimedTextUrl = await extractTimedTextUrl();
            await loadSubtitle(track, baseTimedTextUrl, initialSubLang);
            console.log("Loaded initial sub with language " + initialSubLang);

            // Change subtitle when language select element is changed
            languageSelect.addEventListener("change", () => {
                const languageCode = languageSelect.value;
                loadSubtitle(track, baseTimedTextUrl, languageCode);
            })

            // Toggle showing secondary subtitle with YouTube subtitle button
            // Watch for changes to ariaPressed, since pressing C or clicking can toggle the button
            const subtitleButton = document.querySelector(".ytp-subtitles-button");
            const observer = new MutationObserver((mutations) => {
                for (const m of mutations) {
                    if (m.attributeName === "aria-pressed") {
                        if (subtitleButton.ariaPressed === "true"){
                            track.track.mode = "showing";
                        } else {
                            track.track.mode = "hidden";
                        }
                    }
                }
            });

            observer.observe(subtitleButton, {
                attributes: true,
                attributeFilter: ["aria-pressed"]
            });

            // Show the track if subtitle button is enabled by default
            if (subtitleButton.ariaPressed === "true"){
                track.track.mode = "showing";
            }
        } catch(e) {
            console.error(e);
        }
    }

    document.addEventListener("yt-navigate-finish", () => {
        setTimeout(main, 5000)
    });
})();
