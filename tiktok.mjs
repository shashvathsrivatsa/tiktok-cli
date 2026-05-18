import { launch, page, download } from './utils.mjs';
import { readFileSync, writeFileSync, existsSync } from 'fs';

const WATCH_HISTORY_PATH = 'watchHistory.json';
const WATCH_BUFFER_PATH = 'watchHistoryBuffer.json';

// ─── Watch history ────────────────────────────────────────────────────────────

function readHistory() {
    return existsSync(WATCH_HISTORY_PATH) ? JSON.parse(readFileSync(WATCH_HISTORY_PATH, 'utf8')) : [];
}

function writeHistory(history) {
    writeFileSync(WATCH_HISTORY_PATH, JSON.stringify(history, null, 2));
}

function readBuffer() {
    return existsSync(WATCH_BUFFER_PATH) ? JSON.parse(readFileSync(WATCH_BUFFER_PATH, 'utf8')) : [];
}

function writeBuffer(buf) {
    writeFileSync(WATCH_BUFFER_PATH, JSON.stringify(buf, null, 2));
}

function setPlaytime(id, playtime) {
    const buf = readBuffer();
    const bufItem = buf.find(v => v.id === id);
    if (bufItem) { bufItem.playtime = playtime; bufItem.playtime_max = Math.max(bufItem.playtime_max, playtime); writeBuffer(buf); return; }
    const h = readHistory();
    const item = h.find(v => v.id === id);
    if (item) { item.playtime = playtime; item.playtime_max = Math.max(item.playtime_max, playtime); writeHistory(h); }
}

function setFinished(id, value) {
    const buf = readBuffer();
    const bufItem = buf.find(v => v.id === id);
    if (bufItem) { bufItem.is_finished = value; writeBuffer(buf); return; }
    const h = readHistory();
    const item = h.find(v => v.id === id);
    if (item) { item.is_finished = value; writeHistory(h); }
}

function setLiked(id, value) {
    const buf = readBuffer();
    const bufItem = buf.find(v => v.id === id);
    if (bufItem) { bufItem.is_liked = value; writeBuffer(buf); return; }
    const h = readHistory();
    const item = h.find(v => v.id === id);
    if (item) { item.is_liked = value; writeHistory(h); }
}

function setSkipped(id, value) {
    const buf = readBuffer();
    const bufItem = buf.find(v => v.id === id);
    if (bufItem) { bufItem.is_skipped = value; writeBuffer(buf); return; }
    const h = readHistory();
    const item = h.find(v => v.id === id);
    if (item) { item.is_skipped = value; writeHistory(h); }
}



// ─── FYP API call ─────────────────────────────────────────────────────────────

async function fetchItemList(pullType, sessionVNum, consumptionItems) {
    const count = pullType === 1 ? 6 : 12;

    const data = await page.evaluate(
        async ({ watchHistory: wh, pullType, count, sessionVNum }) => {
            const params = new URLSearchParams({
                WebIdLastTime: '',
                aid: '1988',
                app_language: 'en',
                app_name: 'tiktok_web',
                browser_language: navigator.language || 'en-US',
                browser_name: 'Mozilla',
                browser_online: 'true',
                browser_platform: navigator.platform || 'MacIntel',
                browser_version: navigator.userAgent,
                channel: 'tiktok_web',
                cookie_enabled: 'true',
                count: String(count),
                coverFormat: '2',
                cpu_core_number: String(navigator.hardwareConcurrency || 7),
                dark_mode: 'false',
                data_collection_enabled: 'true',
                day_of_week: String(new Date().getDay()),
                device_id: '',
                device_platform: 'web_pc',
                device_score: '6.64',
                device_type: 'web_h265',
                enable_cache: 'false',
                focus_state: 'true',
                from_page: 'fyp',
                history_len: String(window.history.length),
                isNonPersonalized: 'false',
                is_fullscreen: 'false',
                is_new_user: 'false',
                is_page_visible: 'true',
                language: 'en',
                launch_mode: 'direct',
                os: 'mac',
                priority_region: 'US',
                pullType: String(pullType),
                referer: '',
                region: 'US',
                screen_height: String(screen.height),
                screen_width: String(screen.width),
                showAboutThisAd: 'true',
                showAds: 'true',
                time_of_day: String(new Date().getHours()),
                tz_name: Intl.DateTimeFormat().resolvedOptions().timeZone,
                video_encoding: 'dash',
                vv_count: String(sessionVNum + count),
                vv_count_fyp: String(sessionVNum + count),
                webcast_language: 'en',
                window_height: String(window.innerHeight),
                window_width: String(window.innerWidth),
            });

            const existingScript = document.getElementById('__UNIVERSAL_DATA_FOR_REHYDRATION__');
            if (existingScript) {
                try {
                    const hydration = JSON.parse(existingScript.textContent);
                    const scope = hydration?.['__DEFAULT_SCOPE__'] ?? {};
                    const webapp = scope['webapp.app-context'] ?? {};
                    if (webapp.wid) params.set('device_id', webapp.wid);
                    if (webapp.odinId) params.set('odinId', webapp.odinId);
                    if (webapp.WebIdLastTime) params.set('WebIdLastTime', webapp.WebIdLastTime);
                } catch {}
            }

            const url = `/api/recommend/item_list/?${params.toString()}`;
            const body = JSON.stringify({
                realTimeClientInfo: {
                    consumption_data: { consumption_items: wh },
                },
            });

            const res = await fetch(url, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body,
            });

            if (!res.ok) return { error: res.status };
            return res.json();
        },
        { watchHistory: consumptionItems, pullType, count, sessionVNum }
    );

    return data;
}



// ─── Shared fetch loop ────────────────────────────────────────────────────────

async function fetchVideos(count, outputDir, { pullType = 2, onFirst = null } = {}) {
    const startIndex = readHistory().length;
    let sessionVNum = startIndex;
    let downloaded = 0;
    let currentPullType = pullType;
    let batches = 0;

    // Flush buffer into watchHistory, then reset buffer for the new batch
    const consumptionItems = readBuffer();
    const archived = readHistory();
    writeHistory([...archived, ...consumptionItems]);
    writeBuffer([]);

    while (downloaded < count) {
        const batchCount = currentPullType === 1 ? 6 : 12;
        console.error(`[api] item_list pullType=${currentPullType} count=${batchCount} batch=${batches}`);

        const data = await fetchItemList(currentPullType, sessionVNum, consumptionItems);

        if (data.error) throw new Error(`item_list HTTP ${data.error}`);
        if (data.status_code !== undefined && data.status_code !== 0) {
            throw new Error(`TikTok error: ${data.status_msg || data.statusMsg}`);
        }

        const items = (data.itemList ?? []).filter(i => i.video?.playAddr);
        console.error(`[api] got ${items.length} videos`);

        if (items.length === 0 && batches > 0) {
            console.error('[api] empty response, stopping');
            break;
        }

        for (const item of items) {
            if (downloaded >= count) break;

            const video = item.video;
            const author = item.author?.uniqueId ?? 'unknown';
            const desc = item.desc ?? '';

            const bestBitrate =
                video.bitrateInfo?.find(b => b.CodecType === 'h264' && b.GearName?.startsWith('normal')) ??
                video.bitrateInfo?.[0];
            const downloadUrl = bestBitrate?.PlayAddr?.UrlList?.[0] ?? video.playAddr;
            if (!downloadUrl) { console.error('[api] no download URL for', item.id, '— skipping'); continue; }

            sessionVNum++;

            const entry = {
                id: item.id,
                author_id: item.author?.id ?? '',
                model_type: 0,
                duration: (video.duration ?? 0) * 1000,
                video_bitrate: video.bitrate ?? 0,
                music_id: item.music?.id ?? '',
                is_ad: !!item.isAd,
                is_ecom: false,
                page_tag: 'homepage_hot',
                is_launch: startIndex === 0 && downloaded === 0,
                is_bytevc1: video.codecType?.includes('265') ?? false,
                video_resolution: `${video.width}*${video.height}`,
                start_playing_timestamp: Date.now(),
                playtime: 0,
                playtime_max: 0,
                playtime_live: -1,
                is_finished: false,
                first_frame_duration: 100,
                block_count: 0,
                block_duration: 0,
                is_followed: false,
                is_liked: false,
                is_favorited: false,
                is_shared: false,
                is_disliked: false,
                is_reported: false,
                is_entered_profile: false,
                is_skipped: false,
                is_commentted: false,
                is_click_cover: false,
                is_click_comment: false,
            };

            const buf = readBuffer();
            buf.push(entry);
            writeBuffer(buf);

            const fileIndex = startIndex + downloaded + 1;
            const filename = `${outputDir}/${fileIndex}_${item.id}.mp4`;
            console.log(`[${fileIndex}] @${author} — ${desc.slice(0, 60)}`);
            console.log(`       ${video.width}x${video.height} ${video.codecType} ${Math.round((video.bitrate ?? 0) / 1000)}kbps`);
            console.log(`       → ${filename}`);
            await download(downloadUrl, filename);
            console.log(`       ✓ saved`);

            if (downloaded === 0 && onFirst) onFirst(filename);
            downloaded++;
        }

        currentPullType = 2;
        batches++;
    }
}



// ─── Exports ──────────────────────────────────────────────────────────────────

export async function fyp(count = 5, outputDir = 'vids', onFirstVideo = null) {
    await launch();
    await fetchVideos(count, outputDir, { pullType: 1, onFirst: onFirstVideo });
}

export async function fetchMore(count = 10, outputDir = 'vids') {
    await fetchVideos(count, outputDir, { pullType: 2 });
}

export { setPlaytime, setFinished, setLiked, setSkipped };
