import { chromium } from 'playwright';
import { createWriteStream, copyFileSync } from 'fs';
import { pipeline } from 'stream/promises';
import { Readable } from 'stream';
import { execSync } from 'child_process';
import { createDecipheriv, pbkdf2Sync } from 'crypto';
import Database from 'better-sqlite3';
import { tmpdir } from 'os';
import { join } from 'path';

const FYP_URL = 'https://www.tiktok.com/foryou';
const BRAVE_COOKIES_PATH = `${process.env.HOME}/Library/Application Support/BraveSoftware/Brave-Browser/Default/Cookies`;

// ─── Brave cookie extraction ──────────────────────────────────────────────────

function loadBraveCookies() {
    const password = execSync(
        `security find-generic-password -w -s "Brave Safe Storage" -a "Brave"`,
        { encoding: 'utf8' }
    ).trim();
    const key = pbkdf2Sync(password, 'saltysalt', 1003, 16, 'sha1');

    const tmp = join(tmpdir(), 'tiktok-brave-cookies.db');
    copyFileSync(BRAVE_COOKIES_PATH, tmp);
    const db = new Database(tmp, { readonly: true });
    const rows = db.prepare(
        `SELECT host_key, name, encrypted_value, path, expires_utc, is_secure, is_httponly, samesite
         FROM cookies WHERE host_key LIKE '%tiktok.com'`
    ).all();
    db.close();

    return rows.map(row => {
        const raw = row.encrypted_value;
        let value = '';
        if (raw && raw.length >= 4 && raw.slice(0, 3).toString() === 'v10') {
            const iv = Buffer.alloc(16, ' ');
            const decipher = createDecipheriv('aes-128-cbc', key, iv);
            decipher.setAutoPadding(true);
            const out = Buffer.concat([decipher.update(raw.slice(3)), decipher.final()]);
            value = out.slice(32).toString('utf8');
        } else if (raw) {
            value = raw.toString('utf8');
        }
        const expires = row.expires_utc
            ? Math.floor((row.expires_utc / 1e6) - 11644473600)
            : undefined;
        return {
            name: row.name,
            value,
            domain: row.host_key,
            path: row.path,
            expires,
            secure: !!row.is_secure,
            httpOnly: !!row.is_httponly,
            sameSite: row.samesite === 0 ? 'Lax' : row.samesite === 1 ? 'Strict' : 'None',
        };
    });
}

// ─── Browser bootstrap ────────────────────────────────────────────────────────

let browser;
export let page;

export async function launch() {
    const cookies = loadBraveCookies();
    console.error(`[bootstrap] loaded ${cookies.length} TikTok cookies from Brave`);

    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
        userAgent:
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36',
        locale: 'en-US',
    });
    await context.addCookies(cookies);
    page = await context.newPage();

    console.error('[bootstrap] loading tiktok.com/foryou ...');
    await page.goto(FYP_URL, { waitUntil: 'networkidle', timeout: 30_000 });
    await page.waitForFunction(() => !!window.byted_acrawler?.frontierSign, { timeout: 10_000 });
    console.error('[bootstrap] ready');
}

export async function close() {
    await browser?.close();
}

// ─── Video download ───────────────────────────────────────────────────────────

export async function download(url, destPath) {
    const res = await page.request.get(url, {
        headers: {
            referer: 'https://www.tiktok.com/',
            'user-agent':
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36',
        },
    });
    if (!res.ok()) throw new Error(`download HTTP ${res.status()}`);
    const buf = await res.body();
    const out = createWriteStream(destPath);
    await pipeline(Readable.from(buf), out);
}
