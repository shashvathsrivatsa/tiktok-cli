import { fyp } from './tiktok.mjs';
import { close } from './utils.mjs';
import { startListener } from './listener.mjs';
import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { spawn } from 'child_process';

const outputDir = 'vids';
rmSync(outputDir, { recursive: true, force: true });
mkdirSync(outputDir);
writeFileSync('state.json', JSON.stringify({ currentVideo: 1 }, null, 2));
writeFileSync('watchHistory.json', '[]');
writeFileSync('watchHistoryBuffer.json', '[]');

process.on('SIGINT', async () => { await close(); process.exit(0); });

//  Running

await fyp(10, outputDir, (filename) => {
    spawn('mpv', ['--loop', '--no-osc', '--ontop', '--no-border', '--input-ipc-server=/tmp/mpv-socket', '--no-auto-window-resize', '--autofit=844x1835', filename], { detached: true, stdio: 'ignore' }).unref();
    setTimeout(() => startListener(outputDir), 500);
});

await close();
