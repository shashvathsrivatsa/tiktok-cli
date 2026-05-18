import { createConnection } from 'net';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { setLiked, setFinished, setSkipped } from './tiktok.mjs';

const SOCKET_PATH = '/tmp/mpv-socket';
const STATE_PATH = 'state.json';
const WATCH_HISTORY_PATH = 'watchHistory.json';

let client;
let outputDir = 'vids';

function readState() {
    return JSON.parse(readFileSync(STATE_PATH, 'utf8'));
}

function writeState(state) {
    writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
}

function currentVideoId() {
    const state = readState();
    const history = JSON.parse(readFileSync(WATCH_HISTORY_PATH, 'utf8'));
    return history[state.currentVideo - 1]?.id ?? null;
}

function mpvCommand(cmd) {
    const msg = JSON.stringify({ command: cmd }) + '\n';
    console.error('[mpv cmd]', msg.trim());
    client?.write(msg, err => { if (err) console.error('[mpv write error]', err.message); });
}

function loadVideo(n) {
    const history = JSON.parse(readFileSync(WATCH_HISTORY_PATH, 'utf8'));
    const entry = history[n - 1];
    console.error('[loadVideo] n=%d entry=%s', n, entry?.id);
    if (!entry) { console.error('[loadVideo] no entry'); return; }
    const filename = resolve(`${outputDir}/${n}. ${entry.id}.mp4`);
    console.error('[loadVideo] path=%s exists=%s', filename, existsSync(filename));
    if (!existsSync(filename)) return;
    mpvCommand(['loadfile', filename]);
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
                if (msg.event === 'client-message') handleMessage(msg.args);
            } catch {}
        }
    });

    client.on('error', e => console.error('[socket] error:', e.message));
}

function handleMessage(args) {
    const state = readState();

    switch (args[0]) {
        case 'liked':    { const id = currentVideoId(); if (id) { setLiked(id, true);   console.error('[mpv] liked',    id); } break; }
        case 'finished': { const id = currentVideoId(); if (id) { setFinished(id, true); console.error('[mpv] finished', id); } break; }
        case 'next': {
            const history = JSON.parse(readFileSync(WATCH_HISTORY_PATH, 'utf8'));
            if (state.currentVideo >= history.length) break;
            state.currentVideo++;
            writeState(state);
            loadVideo(state.currentVideo);
            console.error('[mpv] next →', state.currentVideo);
            break;
        }
        case 'prev': {
            if (state.currentVideo <= 1) break;
            state.currentVideo--;
            writeState(state);
            loadVideo(state.currentVideo);
            console.error('[mpv] prev →', state.currentVideo);
            break;
        }
    }
}
