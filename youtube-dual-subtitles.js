// ==UserScript==
// @name         YouTube Dual Subtitles
// @namespace    http://tampermonkey.net/
// @version      1.2
// @description  Show English and Chinese subtitles together on YouTube
// @author       Vinh Nguyen
// @match        https://www.youtube.com/watch*
// @grant        none
// ==/UserScript==

// Based on https://github.com/vinh-ntuan/youtube-dual-subtitles

(function () {
    "use strict";

    const TARGET_LANGUAGES = {
        english: "en",
        chinese: "zh-Hans",
    };

    let cleanupCurrentVideo = () => {};
    let initializationTimer = null;
    let initializationGeneration = 0;
    let activeAbortController = null;

    function pause(milliseconds) {
        return new Promise((resolve) => setTimeout(resolve, milliseconds));
    }

    function throwIfAborted(signal) {
        if (signal.aborted) {
            throw new DOMException("Subtitle loading was superseded", "AbortError");
        }
    }

    function getCaptionRenderer(player) {
        return player
            .getPlayerResponse()
            ?.captions
            ?.playerCaptionsTracklistRenderer;
    }

    function languageFamily(languageCode) {
        const normalized = languageCode.toLowerCase();
        if (normalized === "en" || normalized.startsWith("en-")) return "english";
        if (
            normalized === "zh"
            || normalized.startsWith("zh-")
            || normalized === "cmn"
            || normalized.startsWith("cmn-")
        ) {
            return "chinese";
        }
        return null;
    }

    function languagePreferenceScore(track, family) {
        const code = track.languageCode.toLowerCase();
        const preferences = family === "english"
            ? ["en", "en-us", "en-gb"]
            : ["zh-hans", "zh-cn", "zh", "cmn-hans", "cmn", "zh-hant", "zh-tw"];
        const index = preferences.indexOf(code);
        return index === -1 ? preferences.length : index;
    }

    function findPreferredTrack(tracks, family, isAsr) {
        return tracks
            .filter((track) => languageFamily(track.languageCode) === family)
            .filter((track) => (track.kind === "asr") === isAsr)
            .sort((a, b) => languagePreferenceScore(a, family) - languagePreferenceScore(b, family))[0];
    }

    function getTranslationLanguageCode(renderer, family) {
        const available = renderer.translationLanguages ?? [];
        const matching = available
            .map((language) => language.languageCode)
            .filter((languageCode) => languageFamily(languageCode) === family)
            .map((languageCode) => ({
                languageCode,
                score: languagePreferenceScore({ languageCode }, family),
            }))
            .sort((a, b) => a.score - b.score)[0];

        return matching?.languageCode ?? TARGET_LANGUAGES[family];
    }

    function trackLabel(track) {
        return track.name?.simpleText
            ?? track.name?.runs?.map((run) => run.text).join("")
            ?? track.languageCode;
    }

    function findTimedTextUrl(videoId) {
        const entries = performance.getEntriesByType("resource").slice().reverse();
        for (const entry of entries) {
            if (!entry.name.includes("timedtext")) continue;

            const url = new URL(entry.name);
            if (!url.searchParams.has("pot")) continue;
            if (videoId && url.searchParams.get("v") !== videoId) continue;
            return url;
        }
        return null;
    }

    async function setSubtitleButtonState(subtitleButton, enabled, signal) {
        const expectedValue = enabled ? "true" : "false";
        if (subtitleButton.getAttribute("aria-pressed") === expectedValue) return;

        subtitleButton.click();
        for (let attempt = 0; attempt < 20; attempt++) {
            await pause(100);
            throwIfAborted(signal);
            if (subtitleButton.getAttribute("aria-pressed") === expectedValue) return;
        }
        throw new Error(`Subtitle button did not change to aria-pressed=${expectedValue}`);
    }

    // Returns a recent timedtext request containing the PO token. YouTube's
    // caption-track baseUrl is still used for the actual track selection.
    async function extractTimedTextUrl(signal, maxRetries = 3) {
        const subtitleButton = document.querySelector(".ytp-subtitles-button");
        if (!subtitleButton) {
            throw new Error("Subtitle button not found");
        }

        const videoId = new URL(location.href).searchParams.get("v");
        const existingUrl = findTimedTextUrl(videoId);
        if (existingUrl) {
            console.log("Found an existing timedtext request with a PO token");
            return existingUrl;
        }

        const captionsInitiallyEnabled = subtitleButton.getAttribute("aria-pressed") === "true";
        for (let attempt = 0; attempt < maxRetries; attempt++) {
            throwIfAborted(signal);
            console.log(`Trying to trigger a timedtext request. Try ${attempt + 1}/${maxRetries}`);

            try {
                // YouTube may debounce consecutive clicks in Firefox. Wait for
                // each aria-pressed transition before restoring the original state.
                await setSubtitleButtonState(subtitleButton, !captionsInitiallyEnabled, signal);
                await pause(250);
                await setSubtitleButtonState(subtitleButton, captionsInitiallyEnabled, signal);
                await pause(750);
            } finally {
                if (!signal.aborted) {
                    await setSubtitleButtonState(subtitleButton, captionsInitiallyEnabled, signal);
                }
            }

            const url = findTimedTextUrl(videoId);
            if (url) {
                console.log("Found matching timedtext request with a PO token");
                return url;
            }
        }

        console.warn("No timedtext request with a PO token was found; trying track baseUrls directly");
        return null;
    }

    function buildSubtitleUrl(authenticatedUrl, sourceTrack, translatedLanguage) {
        const url = new URL(sourceTrack.baseUrl, location.origin);
        const trackSelectionParameters = new Set(["fmt", "kind", "lang", "name", "tlang"]);

        // Add request-only parameters such as the PO token without replacing the
        // signature and track identity already present in the track's baseUrl.
        if (authenticatedUrl) {
            for (const [key, value] of authenticatedUrl.searchParams) {
                if (!trackSelectionParameters.has(key) && !url.searchParams.has(key)) {
                    url.searchParams.append(key, value);
                }
            }
        }

        url.searchParams.set("fmt", "json3");
        if (translatedLanguage) {
            url.searchParams.set("tlang", translatedLanguage);
        } else {
            url.searchParams.delete("tlang");
        }
        return url;
    }

    function normalizeCueText(text) {
        return text
            .replace(/[\u200B-\u200D\uFEFF]/g, "")
            .replace(/\s+/g, " ")
            .trim();
    }

    function parseJson3Cues(data) {
        return (data.events ?? [])
            .filter((event) => event.segs?.length && event.dDurationMs > 0)
            .map((event) => ({
                start: Number(event.tStartMs),
                end: Number(event.tStartMs) + Number(event.dDurationMs),
                text: normalizeCueText(event.segs.map((segment) => segment.utf8 ?? "").join("")),
            }))
            .filter((cue) => Number.isFinite(cue.start) && Number.isFinite(cue.end) && cue.text);
    }

    async function fetchSubtitleCues(authenticatedUrl, candidate, signal) {
        const subtitleUrl = buildSubtitleUrl(
            authenticatedUrl,
            candidate.sourceTrack,
            candidate.translatedLanguage,
        );
        const response = await fetch(subtitleUrl, {
            credentials: "include",
            signal,
        });
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        const responseText = await response.text();
        if (!responseText.trim()) {
            throw new Error("empty response");
        }

        const cues = parseJson3Cues(JSON.parse(responseText));
        if (cues.length === 0) {
            throw new Error("response contains no subtitle cues");
        }
        return cues;
    }

    function translatedCandidate(sourceTrack, translatedLanguage) {
        return {
            sourceTrack,
            translatedLanguage,
            description: `auto-translated from ${trackLabel(sourceTrack)}`,
        };
    }

    function directCandidate(sourceTrack, description) {
        return { sourceTrack, translatedLanguage: null, description };
    }

    function buildLanguageCandidates(renderer, family) {
        const tracks = renderer.captionTracks;
        const nativeTrack = findPreferredTrack(tracks, family, false);
        const asrTrack = findPreferredTrack(tracks, family, true);
        const oppositeFamily = family === "english" ? "chinese" : "english";
        const oppositeNativeTrack = findPreferredTrack(tracks, oppositeFamily, false);
        const translatedLanguage = getTranslationLanguageCode(renderer, family);
        const candidates = [];

        // 1. Prefer an authored track in the requested language.
        if (nativeTrack) {
            candidates.push(directCandidate(nativeTrack, `native ${trackLabel(nativeTrack)}`));
        }

        // 2. If that is absent or fails, auto-translate an authored track. The
        // opposite half of the English/Chinese pair is the most stable source.
        const authoredSources = [
            oppositeNativeTrack,
            ...tracks.filter((track) => track.kind !== "asr"),
        ];
        for (const sourceTrack of authoredSources) {
            if (!sourceTrack || sourceTrack === nativeTrack || sourceTrack.isTranslatable === false) continue;
            if (languageFamily(sourceTrack.languageCode) === family) continue;
            candidates.push(translatedCandidate(sourceTrack, translatedLanguage));
        }

        // 3. Videos without authored captions may only have automatic captions.
        // Translate those before falling back to using a same-language ASR track.
        for (const sourceTrack of tracks.filter((track) => track.kind === "asr")) {
            if (sourceTrack.isTranslatable === false) continue;
            if (languageFamily(sourceTrack.languageCode) === family) continue;
            candidates.push(translatedCandidate(sourceTrack, translatedLanguage));
        }
        if (asrTrack) {
            candidates.push(directCandidate(asrTrack, `automatic ${trackLabel(asrTrack)}`));
        }

        // Avoid retrying duplicate source/translation combinations.
        return candidates.filter((candidate, index, allCandidates) => (
            allCandidates.findIndex((other) => (
                other.sourceTrack === candidate.sourceTrack
                && other.translatedLanguage === candidate.translatedLanguage
            )) === index
        ));
    }

    async function resolveSubtitleLanguage(authenticatedUrl, candidates, family, signal) {
        const failures = [];
        for (const candidate of candidates) {
            throwIfAborted(signal);
            try {
                const cues = await fetchSubtitleCues(authenticatedUrl, candidate, signal);
                console.log(`Loaded ${family} subtitles: ${candidate.description}`);
                return { cues, description: candidate.description };
            } catch (error) {
                if (error.name === "AbortError") throw error;
                failures.push(`${candidate.description}: ${error.message}`);
            }
        }

        throw new Error(`Unable to load ${family} subtitles. ${failures.join("; ")}`);
    }

    function cueOverlap(first, second) {
        return Math.max(0, Math.min(first.end, second.end) - Math.max(first.start, second.start));
    }

    function findCueText(cues, start, end) {
        const interval = { start, end };
        const activeCues = cues.filter((cue) => cueOverlap(interval, cue) > 0);
        if (activeCues.length > 0) {
            return [...new Set(activeCues.map((cue) => cue.text))].join(" ");
        }

        // Independently authored tracks can differ slightly at cue boundaries.
        // Use the closest cue so every displayed interval still has both languages.
        const intervalCenter = (start + end) / 2;
        return cues
            .map((cue) => ({
                text: cue.text,
                distance: Math.abs((cue.start + cue.end) / 2 - intervalCenter),
            }))
            .sort((a, b) => a.distance - b.distance)[0]
            ?.text ?? "";
    }

    function mergeBilingualCues(englishCues, chineseCues) {
        const boundaries = [...new Set([
            ...englishCues.flatMap((cue) => [cue.start, cue.end]),
            ...chineseCues.flatMap((cue) => [cue.start, cue.end]),
        ])].sort((a, b) => a - b);
        const merged = [];

        for (let index = 0; index < boundaries.length - 1; index++) {
            const start = boundaries[index];
            const end = boundaries[index + 1];
            if (end <= start) continue;

            const hasEnglish = englishCues.some((cue) => cueOverlap({ start, end }, cue) > 0);
            const hasChinese = chineseCues.some((cue) => cueOverlap({ start, end }, cue) > 0);
            if (!hasEnglish && !hasChinese) continue;

            const cue = {
                start,
                end,
                english: findCueText(englishCues, start, end),
                chinese: findCueText(chineseCues, start, end),
            };
            if (!cue.english || !cue.chinese) {
                throw new Error("Could not create a subtitle interval containing both languages");
            }

            const previous = merged.at(-1);
            if (
                previous
                && previous.end === cue.start
                && previous.english === cue.english
                && previous.chinese === cue.chinese
            ) {
                previous.end = cue.end;
            } else {
                merged.push(cue);
            }
        }

        return merged;
    }

    function findCueIndexAtTime(cues, timeMilliseconds) {
        let low = 0;
        let high = cues.length - 1;
        while (low <= high) {
            const middle = Math.floor((low + high) / 2);
            const cue = cues[middle];
            if (timeMilliseconds < cue.start) {
                high = middle - 1;
            } else if (timeMilliseconds >= cue.end) {
                low = middle + 1;
            } else {
                return middle;
            }
        }
        return -1;
    }

    function createSubtitleOverlay(player) {
        const overlay = document.createElement("div");
        overlay.className = "dual-subtitles-overlay";
        overlay.setAttribute("aria-live", "off");

        const englishLine = document.createElement("div");
        englishLine.className = "dual-subtitles-line dual-subtitles-english";
        const chineseLine = document.createElement("div");
        chineseLine.className = "dual-subtitles-line dual-subtitles-chinese";
        overlay.append(englishLine, chineseLine);
        player.appendChild(overlay);
        return { overlay, englishLine, chineseLine };
    }

    function ensureCaptionStyle() {
        if (document.querySelector("#dual-subtitles-style")) return;

        const style = document.createElement("style");
        style.id = "dual-subtitles-style";
        style.textContent = `
            #movie_player.dual-subtitles-active .ytp-caption-window-container {
                display: none !important;
            }

            #movie_player .dual-subtitles-overlay {
                position: absolute;
                z-index: 40;
                left: 5%;
                right: 5%;
                bottom: 7%;
                display: none;
                pointer-events: none;
                text-align: center;
                color: white;
                font-family: "YouTube Noto", Roboto, Arial, sans-serif;
                font-size: clamp(18px, 2.7vw, 40px);
                line-height: 1.25;
                text-shadow:
                    -2px -2px 2px #000,
                    2px -2px 2px #000,
                    -2px 2px 2px #000,
                    2px 2px 2px #000;
            }

            #movie_player.dual-subtitles-active .dual-subtitles-overlay.dual-subtitles-has-cue {
                display: block;
            }

            #movie_player.ytp-autohide .dual-subtitles-overlay,
            #movie_player.ytp-fullscreen .dual-subtitles-overlay {
                bottom: 8%;
            }

            #movie_player .dual-subtitles-line {
                width: fit-content;
                max-width: 100%;
                margin: 0 auto 0.12em;
                padding: 0.04em 0.22em;
                background: rgb(8 8 8 / 74%);
                white-space: pre-wrap;
                overflow-wrap: anywhere;
            }

            #movie_player .dual-subtitles-chinese {
                font-size: 0.92em;
            }
        `;
        document.head.appendChild(style);
    }

    function menuItemContent(status) {
        return `
            <div class="ytp-menuitem-icon"><svg height="24" viewBox="0 0 24 24" width="24"><path d="M21.20 3.01L21 3H3L2.79 3.01C2.30 3.06 1.84 3.29 1.51 3.65C1.18 4.02 .99 4.50 1 5V19L1.01 19.20C1.05 19.66 1.26 20.08 1.58 20.41C1.91 20.73 2.33 20.94 2.79 20.99L3 21H21L21.20 20.98C21.66 20.94 22.08 20.73 22.1 20.41C22.73 20.08 22.94 19.66 22.99 19.20L23 19V5C23.00 4.50 22.81 4.02 22.48 3.65C22.15 3.29 21.69 3.06 21.20 3.01ZM3 19V5H21V19H3ZM6.97 8.34C6.42 8.64 5.96 9.09 5.64 9.63L5.50 9.87C5.16 10.53 4.99 11.26 5 12L5.00 12.27C5.04 12.92 5.21 13.55 5.50 14.12L5.64 14.36C5.96 14.90 6.42 15.35 6.97 15.65L7.21 15.77C7.79 16.01 8.43 16.06 9.03 15.91L9.29 15.83C9.88 15.61 10.39 15.23 10.77 14.73C10.93 14.53 11.00 14.27 10.97 14.02C10.94 13.77 10.82 13.53 10.63 13.37C10.44 13.20 10.19 13.11 9.93 13.12C9.68 13.13 9.44 13.24 9.26 13.43L9.19 13.50C9.05 13.70 8.85 13.85 8.62 13.94L8.54 13.97C8.35 14.02 8.16 14.00 7.99 13.92L7.91 13.88C7.67 13.75 7.48 13.56 7.35 13.32L7.28 13.20C7.11 12.88 7.02 12.52 7.00 12.16L7 12C6.99 11.58 7.09 11.16 7.28 10.79L7.35 10.67C7.48 10.43 7.67 10.24 7.91 10.11C8.10 10.00 8.32 9.97 8.54 10.02L8.62 10.05C8.81 10.12 8.98 10.24 9.11 10.39L9.19 10.49L9.26 10.57C9.43 10.74 9.66 10.85 9.91 10.87C10.15 10.89 10.40 10.81 10.59 10.66C10.79 10.51 10.92 10.29 10.96 10.05C11.01 9.80 10.96 9.55 10.83 9.34L10.77 9.26L10.60 9.05C10.24 8.65 9.79 8.35 9.29 8.16L9.03 8.08C8.34 7.91 7.60 8.00 6.97 8.34ZM14.97 8.34C14.42 8.64 13.96 9.09 13.64 9.63L13.50 9.87C13.16 10.53 12.99 11.26 13 12L13.00 12.27C13.04 12.92 13.21 13.55 13.50 14.12L13.64 14.36C13.96 14.90 14.42 15.35 14.97 15.65L15.21 15.77C15.79 16.01 16.43 16.06 17.03 15.91L17.29 15.83C17.88 15.61 18.39 15.23 18.77 14.73C18.93 14.53 19.00 14.27 18.97 14.02C18.94 13.77 18.82 13.53 18.63 13.37C18.44 13.20 18.19 13.11 17.93 13.12C17.68 13.13 17.44 13.24 17.26 13.43L17.19 13.50C17.05 13.70 16.85 13.85 16.62 13.94L16.54 13.97C16.35 14.02 16.16 14.00 15.99 13.92L15.91 13.88C15.67 13.75 15.48 13.56 15.35 13.32L15.28 13.20C15.11 12.88 15.02 12.52 15.00 12.16L15 12C14.99 11.58 15.09 11.16 15.28 10.79L15.35 10.67C15.48 10.43 15.67 10.24 15.91 10.11C16.10 10.00 16.32 9.97 16.54 10.02L16.62 10.05C16.81 10.12 16.98 10.24 17.11 10.39L17.19 10.49L17.26 10.57L17.43 10.74C17.66 10.89 17.91 10.87 18.15 10.89C18.40 10.81 18.59 10.66 18.79 10.51C18.92 10.29 18.96 10.05 19.01 9.80C18.96 9.55 18.83 9.34 18.77 9.26L18.60 9.05C18.24 8.65 17.79 8.35 17.29 8.16L17.03 8.08C16.34 7.91 15.60 8.00 14.97 8.34Z" fill="white"></path></svg></div>
            <div class="ytp-menuitem-label">Dual Subtitles/CC</div>
            <div class="ytp-menuitem-content dual-subtitles-status">${status}</div>
        `;
    }

    async function placeMenuItem(menuitem) {
        const settingsButton = document.querySelector(".ytp-settings-button");
        if (!settingsButton) throw new Error("Settings button not found");

        // YouTube lazily creates the settings menu.
        settingsButton.click();
        await pause(100);
        const menu = document.querySelector(".ytp-panel-menu");
        settingsButton.click();
        if (!menu) throw new Error("Settings menu not found");

        const subtitlesItem = [...menu.querySelectorAll(".ytp-menuitem")].find((item) => {
            const label = item.querySelector(".ytp-menuitem-label")?.textContent ?? "";
            return label.includes("Subtitles") || label.includes("字幕");
        });
        if (!subtitlesItem) throw new Error("Could not find original subtitles menu item");

        subtitlesItem.after(menuitem);
    }

    async function waitForPlayer(signal, maxAttempts = 30) {
        for (let attempt = 0; attempt < maxAttempts; attempt++) {
            throwIfAborted(signal);
            const player = document.querySelector("#movie_player");
            const video = player?.querySelector("video") ?? document.querySelector("video");
            const subtitleButton = player?.querySelector(".ytp-subtitles-button");
            const renderer = player && getCaptionRenderer(player);
            if (player && video && subtitleButton && renderer?.captionTracks?.length) {
                return { player, video, subtitleButton, renderer };
            }
            await pause(500);
        }
        throw new Error("YouTube player or subtitle tracks did not become ready");
    }

    function installOverlayRenderer(player, video, subtitleButton, bilingualCues) {
        const { overlay, englishLine, chineseLine } = createSubtitleOverlay(player);
        let currentCueIndex = -2;
        let captionsVisible = subtitleButton.getAttribute("aria-pressed") === "true";
        let animationFrame = null;

        const render = (force = false) => {
            const cueIndex = findCueIndexAtTime(bilingualCues, video.currentTime * 1000);
            if (force || cueIndex !== currentCueIndex) {
                currentCueIndex = cueIndex;
                const cue = cueIndex >= 0 ? bilingualCues[cueIndex] : null;
                englishLine.textContent = cue?.english ?? "";
                chineseLine.textContent = cue?.chinese ?? "";
            }
            overlay.classList.toggle(
                "dual-subtitles-has-cue",
                captionsVisible && currentCueIndex >= 0,
            );
        };

        const animationTick = () => {
            render();
            if (!video.paused && !video.ended) {
                animationFrame = requestAnimationFrame(animationTick);
            } else {
                animationFrame = null;
            }
        };
        const startAnimation = () => {
            if (animationFrame === null) {
                animationFrame = requestAnimationFrame(animationTick);
            }
        };
        const stopAnimation = () => {
            if (animationFrame !== null) {
                cancelAnimationFrame(animationFrame);
                animationFrame = null;
            }
            render(true);
        };
        const renderImmediately = () => render(true);
        const setVisibility = (visible) => {
            captionsVisible = visible;
            player.classList.toggle("dual-subtitles-active", visible);
            render(true);
        };

        const subtitleButtonObserver = new MutationObserver((mutations) => {
            if (mutations.some((mutation) => mutation.attributeName === "aria-pressed")) {
                setVisibility(subtitleButton.getAttribute("aria-pressed") === "true");
            }
        });
        subtitleButtonObserver.observe(subtitleButton, {
            attributes: true,
            attributeFilter: ["aria-pressed"],
        });

        video.addEventListener("play", startAnimation);
        video.addEventListener("playing", startAnimation);
        video.addEventListener("pause", stopAnimation);
        video.addEventListener("ended", stopAnimation);
        video.addEventListener("seeking", renderImmediately);
        video.addEventListener("timeupdate", render);

        setVisibility(captionsVisible);
        if (!video.paused && !video.ended) startAnimation();

        return () => {
            subtitleButtonObserver.disconnect();
            if (animationFrame !== null) cancelAnimationFrame(animationFrame);
            video.removeEventListener("play", startAnimation);
            video.removeEventListener("playing", startAnimation);
            video.removeEventListener("pause", stopAnimation);
            video.removeEventListener("ended", stopAnimation);
            video.removeEventListener("seeking", renderImmediately);
            video.removeEventListener("timeupdate", render);
            player.classList.remove("dual-subtitles-active");
            overlay.remove();
        };
    }

    async function addMenuItem(player, generation, english, chinese) {
        const menuitem = document.createElement("div");
        menuitem.className = "ytp-menuitem dual-subtitles-menuitem";
        menuitem.setAttribute("role", "menuitem");
        menuitem.setAttribute("tabindex", "0");
        menuitem.innerHTML = menuItemContent("English + 中文");
        menuitem.title = `English: ${english.description}; Chinese: ${chinese.description}`;

        try {
            await placeMenuItem(menuitem);
            if (generation !== initializationGeneration || !player.isConnected) {
                menuitem.remove();
                return null;
            }
            return menuitem;
        } catch (error) {
            menuitem.remove();
            console.warn("Dual subtitles loaded, but the settings menu item could not be added", error);
            return null;
        }
    }

    async function main(generation, abortController, retryAttempt) {
        try {
            const signal = abortController.signal;
            const { player, video, subtitleButton, renderer } = await waitForPlayer(signal);
            throwIfAborted(signal);

            ensureCaptionStyle();
            document.querySelectorAll(
                ".dual-subtitles-menuitem, .dual-subtitles-overlay, .dual-subtitle-track",
            ).forEach((element) => element.remove());

            const authenticatedUrl = await extractTimedTextUrl(signal);
            const [english, chinese] = await Promise.all([
                resolveSubtitleLanguage(
                    authenticatedUrl,
                    buildLanguageCandidates(renderer, "english"),
                    "English",
                    signal,
                ),
                resolveSubtitleLanguage(
                    authenticatedUrl,
                    buildLanguageCandidates(renderer, "chinese"),
                    "Chinese",
                    signal,
                ),
            ]);
            throwIfAborted(signal);
            if (generation !== initializationGeneration) return;

            const bilingualCues = mergeBilingualCues(english.cues, chinese.cues);
            if (bilingualCues.length === 0) {
                throw new Error("No bilingual subtitle cues were produced");
            }

            const removeOverlayRenderer = installOverlayRenderer(
                player,
                video,
                subtitleButton,
                bilingualCues,
            );
            let menuitem = null;
            cleanupCurrentVideo = () => {
                removeOverlayRenderer();
                menuitem?.remove();
                cleanupCurrentVideo = () => {};
            };

            menuitem = await addMenuItem(player, generation, english, chinese);
            console.log(
                `Dual subtitles active for ${new URL(location.href).searchParams.get("v")}: `
                + `English=${english.description}; Chinese=${chinese.description}`,
            );
        } catch (error) {
            if (error.name === "AbortError") return;
            console.error("Failed to load English + Chinese subtitles", error);
            if (generation === initializationGeneration && retryAttempt < 2) {
                scheduleMain(3000, retryAttempt + 1);
            }
        }
    }

    function scheduleMain(delay = 1500, retryAttempt = 0) {
        if (initializationTimer !== null) clearTimeout(initializationTimer);
        initializationTimer = null;
        initializationGeneration++;
        const generation = initializationGeneration;

        activeAbortController?.abort();
        activeAbortController = new AbortController();
        cleanupCurrentVideo();

        initializationTimer = setTimeout(() => {
            initializationTimer = null;
            main(generation, activeAbortController, retryAttempt);
        }, delay);
    }

    document.addEventListener("yt-navigate-start", () => {
        if (initializationTimer !== null) clearTimeout(initializationTimer);
        initializationGeneration++;
        activeAbortController?.abort();
        cleanupCurrentVideo();
    });
    document.addEventListener("yt-navigate-finish", () => scheduleMain());

    // The initial yt-navigate-finish event can fire before a document-idle
    // userscript is installed, so always initialize the current page too.
    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", () => scheduleMain(), { once: true });
    } else {
        scheduleMain();
    }
})();
