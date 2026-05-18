import { createConnection } from 'net';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { setLiked, setFinished, setSkipped, setPlaytime, fetchMore } from './tiktok.mjs';

const SOCKET_PATH = '/tmp/mpv-socket';
const STATE_PATH = 'state.json';
const WATCH_HISTORY_PATH = 'watchHistory.json';
const WATCH_BUFFER_PATH = 'watchHistoryBuffer.json';

let client;
let outputDir = 'vids';
let videoStartTime = Date.now();
let fetching = false;
let pendingReset = false;

function readState() {
    return JSON.parse(readFileSync(STATE_PATH, 'utf8'));
}

function writeState(state) {
    writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
}

function fullHistory() {
    const h = JSON.parse(readFileSync(WATCH_HISTORY_PATH, 'utf8'));
    const buf = existsSync(WATCH_BUFFER_PATH) ? JSON.parse(readFileSync(WATCH_BUFFER_PATH, 'utf8')) : [];
    return [...h, ...buf];
}

function currentVideoId() {
    const state = readState();
    return fullHistory()[state.currentVideo - 1]?.id ?? null;
}

function sendLikedStatus(videoNum) {
    const entry = fullHistory()[videoNum - 1];
    mpvCommand(['script-message', 'set-liked', entry?.is_liked ? 'true' : 'false', 'instant']);
}

function mpvCommand(cmd) {
    const msg = JSON.stringify({ command: cmd }) + '\n';
    console.error('[mpv cmd]', msg.trim());
    client?.write(msg, err => { if (err) console.error('[mpv write error]', err.message); });
}

function loadVideo(n) {
    const history = fullHistory();
    const entry = history[n - 1];
    console.error('[loadVideo] n=%d entry=%s', n, entry?.id);
    if (!entry) { console.error('[loadVideo] no entry'); return; }
    const filename = resolve(`${outputDir}/${n}_${entry.id}.mp4`);
    console.error('[loadVideo] path=%s exists=%s', filename, existsSync(filename));
    if (!existsSync(filename)) return;
    mpvCommand(['loadfile', filename]);
}

function recordDeparture(videoNum) {
    const elapsed = Date.now() - videoStartTime;
    const entry = fullHistory()[videoNum - 1];
    if (!entry) return;
    setPlaytime(entry.id, elapsed);
    setFinished(entry.id, elapsed >= entry.duration);
    setSkipped(entry.id, elapsed < 2000);
}

export function startListener(dir = 'vids') {
    outputDir = dir;
    client = createConnection(SOCKET_PATH);
    let buf = '';

    client.on('data', chunk => {
        buf += chunk.toString();
        const lines = buf.split('\n');
        buf = lines.pop();

        for (const line of lines) {
            if (!line) continue;
            console.error('[mpv raw]', line);
            try {
                const msg = JSON.parse(line);
                if (msg.event === 'file-loaded') pendingReset = true;
                if (msg.event === 'playback-restart') {
                    if (pendingReset) {
                        videoStartTime = Date.now();
                        pendingReset = false;
                        sendLikedStatus(readState().currentVideo);
                    }
                }
                if (msg.event === 'client-message') handleMessage(msg.args);
            } catch {}
        }
    });

    client.on('error', e => console.error('[socket] error:', e.message));
}

function handleMessage(args) {
    const state = readState();

    switch (args[0]) {
        case 'liked': {
            const history = fullHistory();
            const entry = history[state.currentVideo - 1];
            if (entry) {
                const newVal = !entry.is_liked;
                setLiked(entry.id, newVal);
                mpvCommand(['script-message', 'set-liked', newVal ? 'true' : 'false']);
                console.error('[mpv] liked →', newVal, entry.id);
            }
            break;
        }
        case 'finished': { const id = currentVideoId(); if (id) { setFinished(id, true); console.error('[mpv] finished', id); } break; }
        case 'next': {
            const history = fullHistory();
            if (state.currentVideo >= history.length) break;
            recordDeparture(state.currentVideo);
            state.currentVideo++;
            writeState(state);
            loadVideo(state.currentVideo);
            console.error('[mpv] next →', state.currentVideo);
            if (!fetching && state.currentVideo >= history.length - 3) {
                fetching = true;
                console.error('[fetch] triggering fetchMore');
                const fetchTimeout = setTimeout(() => { fetching = false; console.error('[fetch] timed out'); }, 60_000);
                fetchMore(10, outputDir)
                    .then(() => { fetching = false; clearTimeout(fetchTimeout); console.error('[fetch] done'); })
                    .catch(e => { fetching = false; clearTimeout(fetchTimeout); console.error('[fetch] error:', e.message); });
            }
            break;
        }
        case 'prev': {
            if (state.currentVideo <= 1) break;
            recordDeparture(state.currentVideo);
            state.currentVideo--;
            writeState(state);
            loadVideo(state.currentVideo);
            console.error('[mpv] prev →', state.currentVideo);
            break;
        }
    }
}
