#!/usr/bin/env node
'use strict';

/**
 * Antigravity Custom Theme Daemon (Windows / macOS / Linux)
 * Connects to Antigravity CDP (DevToolsActivePort), injects dist/theme_payload.js,
 * persists user theme preferences in theme_config.json, and hot-reloads on rebuild.
 */

const { spawn } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

if (typeof globalThis.WebSocket !== 'function') {
    console.error('[theme-daemon] Node.js >= 22 with built-in WebSocket is required.');
    process.exit(1);
}

const ROOT_DIR = path.resolve(__dirname, '..');
const PID_FILE = process.env.AGY_PID_FILE || path.join(ROOT_DIR, 'daemon.pid');
const CONFIG_FILE = process.env.AGY_CONFIG_PATH || path.join(ROOT_DIR, 'theme_config.json');
const DIST_DIR = path.join(ROOT_DIR, 'dist');
const PAYLOAD_PATH = path.join(DIST_DIR, 'theme_payload.js');
const LOG_FILE = process.env.AGY_LOG_FILE || path.join(ROOT_DIR, 'daemon.log');
const FACE_ENGINE_PY = path.join(__dirname, 'face_engine.py');
const FACE_PROFILE_FILE = process.env.AGY_FACE_PROFILE_PATH || path.join(ROOT_DIR, 'face_profile.json');
const VAULT_FILE = process.env.AGY_VAULT_PATH || path.join(ROOT_DIR, 'auth_vault.json');
const DAEMON_API_TOKEN = process.env.AGY_TEST_API_TOKEN || crypto.randomBytes(32).toString('hex');
const DEFAULT_CONFIG = {};

const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1 };
const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_DURATIONS_MS = [30 * 1000, 60 * 1000, 300 * 1000];
const ADMIN_TICKET_TTL_MS = 5 * 60 * 1000;
const UNLOCK_PROOF_TTL_MS = 60 * 1000;

const adminTickets = new Map(); // ticketHex -> expiryEpochMs
const unlockProofs = new Map(); // proofHex -> expiryEpochMs
let serverFaceMatchStreak = 0;

function scryptHashHex(secret, saltHex) {
    const saltBuf = Buffer.from(saltHex, 'hex');
    return crypto.scryptSync(String(secret), saltBuf, 64, SCRYPT_PARAMS).toString('hex');
}

function timingSafeHexEqual(hexA, hexB) {
    if (typeof hexA !== 'string' || typeof hexB !== 'string' || hexA.length !== hexB.length || hexA.length % 2 !== 0) {
        return false;
    }
    try {
        const a = Buffer.from(hexA, 'hex');
        const b = Buffer.from(hexB, 'hex');
        if (a.length !== b.length || a.length === 0) return false;
        return crypto.timingSafeEqual(a, b);
    } catch (_) {
        return false;
    }
}

function timingSafeTokenEqual(a, b) {
    if (typeof a !== 'string' || typeof b !== 'string') return false;
    const bufA = Buffer.from(a, 'utf8');
    const bufB = Buffer.from(b, 'utf8');
    if (bufA.length !== bufB.length || bufA.length === 0) return false;
    return crypto.timingSafeEqual(bufA, bufB);
}

function createDefaultVault() {
    const pinSalt = crypto.randomBytes(16).toString('hex');
    const passSalt = crypto.randomBytes(16).toString('hex');
    return {
        version: 1,
        authLock: true,
        pinSalt,
        pinScrypt: scryptHashHex('123456', pinSalt),
        passSalt,
        passScrypt: scryptHashHex('binhphan', passSalt),
        chordSalt: '',
        chordScrypt: '',
        failedAttempts: 0,
        escalationLevel: 0,
        lockoutUntil: 0,
    };
}

function readVault() {
    try {
        if (fs.existsSync(VAULT_FILE)) {
            const parsed = JSON.parse(fs.readFileSync(VAULT_FILE, 'utf8'));
            if (parsed && typeof parsed === 'object' && parsed.pinScrypt && parsed.passScrypt) {
                return {
                    version: 1,
                    authLock: parsed.authLock !== false,
                    pinSalt: String(parsed.pinSalt || ''),
                    pinScrypt: String(parsed.pinScrypt || ''),
                    passSalt: String(parsed.passSalt || ''),
                    passScrypt: String(parsed.passScrypt || ''),
                    chordSalt: String(parsed.chordSalt || ''),
                    chordScrypt: String(parsed.chordScrypt || ''),
                    failedAttempts: Number(parsed.failedAttempts) || 0,
                    escalationLevel: Number(parsed.escalationLevel) || 0,
                    lockoutUntil: Number(parsed.lockoutUntil) || 0,
                };
            }
        }
    } catch (_) {}
    const fresh = createDefaultVault();
    saveVault(fresh);
    return fresh;
}

function saveVault(vaultObj) {
    try {
        fs.writeFileSync(VAULT_FILE, JSON.stringify(vaultObj, null, 2), { encoding: 'utf8', mode: 0o600 });
    } catch (err) {
        log(`Vault write error: ${err.message}`);
    }
}

function issueAuthGrants() {
    const now = Date.now();
    for (const [k, exp] of adminTickets.entries()) {
        if (exp <= now) adminTickets.delete(k);
    }
    for (const [k, exp] of unlockProofs.entries()) {
        if (exp <= now) unlockProofs.delete(k);
    }
    const adminTicket = crypto.randomBytes(32).toString('hex');
    const unlockProof = crypto.randomBytes(32).toString('hex');
    adminTickets.set(adminTicket, now + ADMIN_TICKET_TTL_MS);
    unlockProofs.set(unlockProof, now + UNLOCK_PROOF_TTL_MS);
    return { adminTicket, unlockProof };
}

function validateAdminTicket(ticket) {
    if (typeof ticket !== 'string' || ticket.length !== 64) return false;
    const now = Date.now();
    for (const [stored, exp] of adminTickets.entries()) {
        if (exp <= now) {
            adminTickets.delete(stored);
            continue;
        }
        if (timingSafeHexEqual(stored, ticket)) {
            return true;
        }
    }
    return false;
}

function consumeUnlockProof(proof) {
    if (typeof proof !== 'string' || proof.length !== 64) return false;
    const now = Date.now();
    for (const [stored, exp] of unlockProofs.entries()) {
        if (exp <= now) {
            unlockProofs.delete(stored);
            continue;
        }
        if (timingSafeHexEqual(stored, proof)) {
            unlockProofs.delete(stored);
            return true;
        }
    }
    return false;
}

function verifySecretWithRateLimit(kind, candidate) {
    const vault = readVault();
    const now = Date.now();
    if (vault.lockoutUntil > now) {
        const retryAfterSec = Math.max(1, Math.ceil((vault.lockoutUntil - now) / 1000));
        return { ok: true, verified: false, lockedOut: true, retryAfterSec };
    }

    if (typeof candidate !== 'string' || candidate.length === 0 || candidate.length > 128) {
        return { ok: true, verified: false, lockedOut: false, remainingAttempts: Math.max(0, MAX_FAILED_ATTEMPTS - vault.failedAttempts) };
    }

    let matched = false;
    if (kind === 'pin' && /^\d{6}$/.test(candidate)) {
        const computed = scryptHashHex(candidate, vault.pinSalt);
        matched = timingSafeHexEqual(computed, vault.pinScrypt);
    } else if (kind === 'pass') {
        const computed = scryptHashHex(candidate, vault.passSalt);
        matched = timingSafeHexEqual(computed, vault.passScrypt);
    } else if (kind === 'chord' && vault.chordSalt && vault.chordScrypt) {
        const computed = scryptHashHex(candidate, vault.chordSalt);
        matched = timingSafeHexEqual(computed, vault.chordScrypt);
    }

    if (matched) {
        if (vault.failedAttempts !== 0 || vault.lockoutUntil !== 0) {
            vault.failedAttempts = 0;
            vault.lockoutUntil = 0;
            vault.escalationLevel = 0;
            saveVault(vault);
        }
        return { ok: true, verified: true, lockedOut: false, ...issueAuthGrants() };
    }

    vault.failedAttempts += 1;
    if (vault.failedAttempts >= MAX_FAILED_ATTEMPTS) {
        const idx = Math.min(LOCKOUT_DURATIONS_MS.length - 1, vault.escalationLevel);
        const durMs = LOCKOUT_DURATIONS_MS[idx];
        vault.lockoutUntil = now + durMs;
        vault.failedAttempts = 0;
        vault.escalationLevel += 1;
        saveVault(vault);
        return {
            ok: true,
            verified: false,
            lockedOut: true,
            retryAfterSec: Math.ceil(durMs / 1000),
        };
    }
    saveVault(vault);
    return {
        ok: true,
        verified: false,
        lockedOut: false,
        remainingAttempts: Math.max(0, MAX_FAILED_ATTEMPTS - vault.failedAttempts),
    };
}

let faceWorker = null;
let faceWorkerBuf = '';
let faceReqSeq = 1;
const facePending = new Map();

function ensureFaceWorker() {
    if (faceWorker && !faceWorker.killed && faceWorker.exitCode === null) {
        return faceWorker;
    }
    const pyBin = process.platform === 'win32' ? 'python' : 'python3';
    const child = spawn(pyBin, ['-u', FACE_ENGINE_PY], {
        cwd: ROOT_DIR,
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
    });
    faceWorker = child;
    faceWorkerBuf = '';

    child.stdout.on('data', (chunk) => {
        faceWorkerBuf += chunk.toString('utf8');
        let nlIdx;
        while ((nlIdx = faceWorkerBuf.indexOf('\n')) !== -1) {
            const line = faceWorkerBuf.slice(0, nlIdx).trim();
            faceWorkerBuf = faceWorkerBuf.slice(nlIdx + 1);
            if (!line) continue;
            try {
                const msg = JSON.parse(line);
                if (msg.id && facePending.has(msg.id)) {
                    const p = facePending.get(msg.id);
                    facePending.delete(msg.id);
                    clearTimeout(p.timer);
                    p.resolve(msg);
                }
            } catch (_) {}
        }
    });

    const onExit = () => {
        if (faceWorker === child) {
            faceWorker = null;
        }
        for (const [id, p] of facePending.entries()) {
            clearTimeout(p.timer);
            p.reject(new Error('Face engine exited'));
            facePending.delete(id);
        }
    };
    child.on('exit', onExit);
    child.on('error', onExit);
    return child;
}

function callFaceEngine(payload, timeoutMs = 8000) {
    return new Promise((resolve, reject) => {
        if (!fs.existsSync(FACE_ENGINE_PY)) {
            resolve({ ok: false, error: 'face_engine.py not found' });
            return;
        }
        let worker;
        try {
            worker = ensureFaceWorker();
        } catch (err) {
            resolve({ ok: false, error: err.message });
            return;
        }
        const id = faceReqSeq++;
        const timer = setTimeout(() => {
            facePending.delete(id);
            reject(new Error('Face biometric engine timed out'));
        }, timeoutMs);
        facePending.set(id, { resolve, reject, timer });
        try {
            worker.stdin.write(JSON.stringify({ ...payload, id }) + '\n');
        } catch (err) {
            clearTimeout(timer);
            facePending.delete(id);
            reject(err);
        }
    });
}

function verifyWindowsHello() {
    return new Promise((resolve) => {
        if (process.platform !== 'win32') {
            resolve({ ok: false, verified: false, error: 'Windows Hello is only supported on Windows.' });
            return;
        }
        const psScript = [
            '$ErrorActionPreference = "Stop"',
            'Add-Type -TypeDefinition @"',
            'using System;',
            'using System.Runtime.InteropServices;',
            'public class Win32Fg { [DllImport("user32.dll")] public static extern bool AllowSetForegroundWindow(int dwProcessId); }',
            '"@ -ErrorAction SilentlyContinue',
            '[Win32Fg]::AllowSetForegroundWindow(-1) | Out-Null',
            '$null = [Windows.Security.Credentials.UI.UserConsentVerifier, Windows.Security.Credentials.UI, ContentType = WindowsRuntime]',
            'Add-Type -AssemblyName System.Runtime.WindowsRuntime',
            '$asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq "AsTask" -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq "IAsyncOperation`1" })[0]',
            '$op = [Windows.Security.Credentials.UI.UserConsentVerifier]::RequestVerificationAsync("Antigravity Studio 2.0 - Verify Identity: Binh Phan")',
            '$task = $asTask.MakeGenericMethod([Windows.Security.Credentials.UI.UserConsentVerificationResult]).Invoke($null, @($op))',
            '$task.Wait()',
            'Write-Output ("RESULT:" + $task.Result.ToString())',
        ].join('\n');

        const child = spawn('powershell.exe', ['-NoProfile', '-WindowStyle', 'Hidden', '-Command', psScript], {
            windowsHide: true,
        });
        let out = '';
        let errOut = '';
        const timer = setTimeout(() => {
            try { child.kill(); } catch (_) {}
            resolve({ ok: false, verified: false, error: 'Windows Hello prompt timed out.' });
        }, 45000);
        child.stdout.on('data', (d) => { out += d.toString('utf8'); });
        child.stderr.on('data', (d) => { errOut += d.toString('utf8'); });
        child.on('close', () => {
            clearTimeout(timer);
            const m = out.match(/RESULT:(\w+)/);
            const status = m ? m[1] : 'Failed';
            resolve({
                ok: true,
                verified: status === 'Verified',
                status,
                error: status === 'Verified' ? '' : (errOut.trim() || status),
            });
        });
        child.on('error', (err) => {
            clearTimeout(timer);
            resolve({ ok: false, verified: false, error: err.message });
        });
    });
}

function readJsonBody(req, res, maxBytes = 8 * 1024 * 1024) {
    return new Promise((resolve) => {
        const chunks = [];
        let total = 0;
        let aborted = false;
        req.on('data', (chunk) => {
            total += chunk.length;
            if (total > maxBytes) {
                aborted = true;
                res.writeHead(413, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ ok: false, error: 'Payload too large' }));
                req.destroy();
                resolve(null);
                return;
            }
            chunks.push(chunk);
        });
        req.on('end', () => {
            if (aborted) return;
            try {
                const raw = Buffer.concat(chunks).toString('utf8');
                resolve(raw ? JSON.parse(raw) : {});
            } catch (err) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ ok: false, error: 'Invalid JSON body' }));
                resolve(null);
            }
        });
    });
}

function resolvePortFile() {
    if (process.env.AGY_PORT_FILE) {
        return process.env.AGY_PORT_FILE;
    }

    const home = os.homedir();
    let candidates;
    if (process.platform === 'win32') {
        const appData = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
        const localAppData = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
        candidates = [
            path.join(appData, 'Antigravity', 'DevToolsActivePort'),
            path.join(appData, 'antigravity', 'DevToolsActivePort'),
            path.join(localAppData, 'Antigravity', 'DevToolsActivePort'),
            path.join(localAppData, 'antigravity', 'DevToolsActivePort'),
            path.join(localAppData, 'Antigravity', 'User Data', 'DevToolsActivePort'),
        ];
    } else if (process.platform === 'darwin') {
        const appSupport = path.join(home, 'Library', 'Application Support');
        candidates = [
            path.join(appSupport, 'antigravity', 'DevToolsActivePort'),
            path.join(appSupport, 'Antigravity', 'DevToolsActivePort'),
        ];
    } else {
        const xdgConfig = process.env.XDG_CONFIG_HOME || path.join(home, '.config');
        candidates = [
            path.join(xdgConfig, 'antigravity', 'DevToolsActivePort'),
            path.join(xdgConfig, 'Antigravity', 'DevToolsActivePort'),
        ];
    }

    return candidates.find((p) => fs.existsSync(p)) || candidates[0];
}

function log(msg) {
    const line = `[${new Date().toISOString()}] ${msg}\n`;
    try {
        if (fs.existsSync(LOG_FILE) && fs.statSync(LOG_FILE).size > 512 * 1024) {
            fs.writeFileSync(LOG_FILE, '');
        }
        fs.appendFileSync(LOG_FILE, line);
    } catch (_) {}
    if (process.stdout.isTTY || process.env.AGY_DAEMON_STDOUT === '1') {
        process.stdout.write(line);
    }
}

function isPidAlive(pid) {
    try {
        process.kill(pid, 0);
        return true;
    } catch (_) {
        return false;
    }
}

function acquirePidLock() {
    if (fs.existsSync(PID_FILE)) {
        const existingPid = parseInt(fs.readFileSync(PID_FILE, 'utf8').trim(), 10);
        if (existingPid && existingPid !== process.pid && isPidAlive(existingPid)) {
            log(`Another daemon instance is already running (PID ${existingPid}). Exiting.`);
            process.exit(0);
        }
    }
    fs.writeFileSync(PID_FILE, String(process.pid), 'utf8');
}

function removePidLock() {
    try {
        if (fs.existsSync(PID_FILE)) {
            const pid = parseInt(fs.readFileSync(PID_FILE, 'utf8').trim(), 10);
            if (pid === process.pid) {
                fs.unlinkSync(PID_FILE);
            }
        }
    } catch (_) {}
}

function readConfig() {
    try {
        if (fs.existsSync(CONFIG_FILE)) {
            const parsed = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
            if (parsed && typeof parsed === 'object') {
                return { ...DEFAULT_CONFIG, ...parsed };
            }
        }
    } catch (err) {
        log(`Failed reading theme_config.json: ${err.message}`);
    }
    return { ...DEFAULT_CONFIG };
}

function saveConfig(next) {
    try {
        const sanitized = { ...(next && typeof next === 'object' ? next : {}) };
        // Never allow client theme_config.json binding to store or override security credentials
        delete sanitized.authLock;
        delete sanitized.authPinHash;
        delete sanitized.authPassHash;
        const curr = readConfig();
        delete curr.authLock;
        delete curr.authPinHash;
        delete curr.authPassHash;
        const merged = { ...curr, ...sanitized };
        fs.writeFileSync(CONFIG_FILE, JSON.stringify(merged, null, 2), 'utf8');
        return merged;
    } catch (err) {
        log(`Failed saving theme_config.json: ${err.message}`);
        return null;
    }
}

const THEMES_ASSETS_DIR = path.join(ROOT_DIR, 'themes', 'assets');
const USER_MEDIA_DIR = path.join(ROOT_DIR, 'themes', 'user_media');
let mediaServer = null;
let mediaPort = 0;

const IMAGE_EXTS = new Set(['.webp', '.png', '.jpg', '.jpeg', '.gif', '.svg', '.bmp']);
const VIDEO_EXTS = new Set(['.mp4', '.webm', '.mov', '.m4v']);
const AUDIO_EXTS = new Set(['.mp3', '.ogg', '.wav', '.m4a', '.aac', '.flac']);
const md5Cache = new Map();

function getMediaKind(fileName) {
    const ext = path.extname(String(fileName || '')).toLowerCase();
    if (IMAGE_EXTS.has(ext)) return 'image';
    if (VIDEO_EXTS.has(ext)) return 'video';
    if (AUDIO_EXTS.has(ext)) return 'audio';
    return null;
}

function stripMediaTimestamp(fileName) {
    return String(fileName || '').replace(/^\d{10,}_/, '');
}

function normalizeUserMediaFileName(urlOrName) {
    if (!urlOrName) return '';
    let s = String(urlOrName).trim();
    if (!s) return '';
    const match = s.match(/(?:^|\/)user_media\/([^?#]+)/i);
    if (match) {
        s = match[1];
    }
    try {
        s = decodeURIComponent(s);
    } catch (_) {}
    const base = path.basename(s);
    if (!base || base === '.' || base === '..') return '';
    return base;
}

function getFileMd5(filePath, stat) {
    const cacheKey = `${filePath}:${stat.size}:${stat.mtimeMs}`;
    const cached = md5Cache.get(cacheKey);
    if (cached) return cached;
    const hash = crypto.createHash('md5').update(fs.readFileSync(filePath)).digest('hex');
    if (md5Cache.size > 500) md5Cache.clear();
    md5Cache.set(cacheKey, hash);
    return hash;
}

function scanUserMedia() {
    const images = [];
    const videos = [];
    const audios = [];
    if (!fs.existsSync(USER_MEDIA_DIR)) {
        return { images, videos, audios };
    }

    const cfg = readConfig();
    const activeWpFile = normalizeUserMediaFileName(cfg.customWp);
    const activeVidFile = normalizeUserMediaFileName(cfg.customVideo);
    const activeVoiceFile = normalizeUserMediaFileName(cfg.customVoice);

    let entries = [];
    try {
        entries = fs.readdirSync(USER_MEDIA_DIR, { withFileTypes: true });
    } catch (_) {
        return { images, videos, audios };
    }

    const byHash = new Map();
    for (const entry of entries) {
        if (!entry.isFile()) continue;
        const kind = getMediaKind(entry.name);
        if (!kind) continue;
        const fullPath = path.join(USER_MEDIA_DIR, entry.name);
        let stat;
        try {
            stat = fs.statSync(fullPath);
        } catch (_) {
            continue;
        }
        const md5 = getFileMd5(fullPath, stat);
        const item = {
            url: `user_media/${encodeURIComponent(entry.name)}`,
            fileName: entry.name,
            name: stripMediaTimestamp(entry.name),
            kind,
            size: stat.size,
            addedAt: Math.round(stat.mtimeMs),
            md5,
        };
        const isActive = entry.name === activeWpFile || entry.name === activeVidFile || entry.name === activeVoiceFile;
        const existing = byHash.get(md5);
        if (!existing) {
            byHash.set(md5, { item, isActive });
        } else if (isActive && !existing.isActive) {
            byHash.set(md5, { item, isActive: true });
        } else if (!existing.isActive && item.addedAt > existing.item.addedAt) {
            byHash.set(md5, { item, isActive: false });
        }
    }

    for (const { item } of byHash.values()) {
        const clean = {
            url: item.url,
            fileName: item.fileName,
            name: item.name,
            kind: item.kind,
            size: item.size,
            addedAt: item.addedAt,
        };
        if (item.kind === 'image') images.push(clean);
        else if (item.kind === 'video') videos.push(clean);
        else audios.push(clean);
    }

    images.sort((a, b) => b.addedAt - a.addedAt);
    videos.sort((a, b) => b.addedAt - a.addedAt);
    audios.sort((a, b) => b.addedAt - a.addedAt);
    return { images, videos, audios };
}

const MEDIA_MIME = {
    '.mp4': 'video/mp4',
    '.webm': 'video/webm',
    '.mov': 'video/quicktime',
    '.m4v': 'video/mp4',
    '.mp3': 'audio/mpeg',
    '.ogg': 'audio/ogg',
    '.wav': 'audio/wav',
    '.m4a': 'audio/mp4',
    '.aac': 'audio/aac',
    '.flac': 'audio/flac',
    '.webp': 'image/webp',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.bmp': 'image/bmp',
};

function isAllowedLocalOrigin(originHeader) {
    if (!originHeader || originHeader === 'null') return true;
    return /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/i.test(String(originHeader));
}

function startMediaServer() {
    mediaServer = http.createServer((req, res) => {
        const origin = req.headers.origin;
        if (!isAllowedLocalOrigin(origin)) {
            res.writeHead(403, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: false, error: 'Cross-origin access denied' }));
            return;
        }
        if (origin) {
            res.setHeader('Access-Control-Allow-Origin', origin);
            res.setHeader('Vary', 'Origin');
        } else {
            res.setHeader('Access-Control-Allow-Origin', 'http://127.0.0.1');
        }
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Range, X-Agy-Token');

        if (req.method === 'OPTIONS') {
            res.writeHead(204);
            res.end();
            return;
        }

        let pathname = '/';
        const reqUrl = new URL(req.url || '/', 'http://127.0.0.1');
        try {
            pathname = decodeURIComponent(reqUrl.pathname || '/');
        } catch (_) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: false, error: 'Malformed URI' }));
            return;
        }

        // Enforce cryptographic per-daemon token on all API / mutating routes
        const isProtectedApi =
            pathname.startsWith('/auth/') ||
            pathname === '/upload' ||
            pathname === '/delete_media' ||
            pathname === '/user_media_list';
        if (isProtectedApi) {
            const clientTok = String(req.headers['x-agy-token'] || '');
            if (!timingSafeTokenEqual(clientTok, DAEMON_API_TOKEN)) {
                res.writeHead(403, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ ok: false, error: 'Invalid or missing X-Agy-Token' }));
                return;
            }
        }

        if (req.method === 'GET' && pathname === '/auth/status') {
            let source = 'none';
            let enrolled = false;
            try {
                if (fs.existsSync(FACE_PROFILE_FILE)) {
                    const fp = JSON.parse(fs.readFileSync(FACE_PROFILE_FILE, 'utf8'));
                    enrolled = Array.isArray(fp.embedding) && fp.embedding.length === 128;
                    source = fp.source || 'webcam_hd';
                }
            } catch (_) {}
            const vault = readVault();
            const now = Date.now();
            const lockedOut = vault.lockoutUntil > now;
            const retryAfterSec = lockedOut ? Math.max(1, Math.ceil((vault.lockoutUntil - now) / 1000)) : 0;
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                ok: true,
                authLock: vault.authLock,
                enrolled,
                source,
                hasKeyChord: Boolean(vault.chordScrypt),
                lockedOut,
                retryAfterSec,
                winHelloSupported: process.platform === 'win32',
            }));
            return;
        }

        if (req.method === 'POST' && (pathname === '/auth/verify-pin' || pathname === '/auth/verify-pass' || pathname === '/auth/verify-chord')) {
            readJsonBody(req, res, 16 * 1024).then((body) => {
                if (!body) return;
                const kind = pathname === '/auth/verify-pin' ? 'pin' : (pathname === '/auth/verify-pass' ? 'pass' : 'chord');
                const secret = typeof body.secret === 'string' ? body.secret : '';
                const result = verifySecretWithRateLimit(kind, secret);
                res.writeHead(result.lockedOut ? 429 : 200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify(result));
            });
            return;
        }

        if (req.method === 'POST' && pathname === '/auth/confirm-unlock') {
            readJsonBody(req, res, 8 * 1024).then((body) => {
                if (!body) return;
                const valid = consumeUnlockProof(body.unlockProof);
                res.writeHead(valid ? 200 : 401, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ ok: valid, unlocked: valid }));
            });
            return;
        }

        if (req.method === 'POST' && pathname === '/auth/face-verify') {
            readJsonBody(req, res, 6 * 1024 * 1024).then(async (body) => {
                if (!body) return;
                try {
                    const result = await callFaceEngine({ cmd: 'verify', image: body.image || '' }, 10000);
                    if (result && result.ok && result.matched && !result.staticReplay && !result.tooSmall) {
                        serverFaceMatchStreak += 1;
                    } else {
                        serverFaceMatchStreak = 0;
                    }
                    const streakConfirmed = serverFaceMatchStreak >= 3;
                    const grants = streakConfirmed ? issueAuthGrants() : {};
                    if (streakConfirmed) {
                        serverFaceMatchStreak = 0;
                    }
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({
                        ...result,
                        matchStreak: streakConfirmed ? 3 : serverFaceMatchStreak,
                        streakConfirmed,
                        ...grants,
                    }));
                } catch (err) {
                    serverFaceMatchStreak = 0;
                    res.writeHead(500, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ ok: false, error: 'Face verification unavailable' }));
                }
            });
            return;
        }

        if (req.method === 'POST' && (pathname === '/auth/face-enroll' || pathname === '/auth/face-reset')) {
            readJsonBody(req, res, 12 * 1024 * 1024).then(async (body) => {
                if (!body) return;
                if (!validateAdminTicket(body.adminTicket)) {
                    res.writeHead(401, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ ok: false, error: 'Verification ticket required. Verify current PIN or Windows Hello first.' }));
                    return;
                }
                try {
                    const cmd = pathname === '/auth/face-enroll'
                        ? { cmd: 'enroll', images: Array.isArray(body.images) ? body.images : [] }
                        : { cmd: 'reset' };
                    const result = await callFaceEngine(cmd, 15000);
                    const grants = result && result.ok ? issueAuthGrants() : {};
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ ...result, ...grants }));
                } catch (err) {
                    res.writeHead(500, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ ok: false, error: 'Biometric update failed' }));
                }
            });
            return;
        }

        if (req.method === 'POST' && pathname === '/auth/update-settings') {
            readJsonBody(req, res, 32 * 1024).then((body) => {
                if (!body) return;
                if (!validateAdminTicket(body.adminTicket)) {
                    res.writeHead(401, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ ok: false, error: 'Verification required. Verify current PIN, Passphrase, or Windows Hello first.' }));
                    return;
                }
                const vault = readVault();
                if (typeof body.authLock === 'boolean') {
                    vault.authLock = body.authLock;
                }
                if (typeof body.newPin === 'string' && body.newPin.length > 0) {
                    if (!/^\d{6}$/.test(body.newPin)) {
                        res.writeHead(400, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ ok: false, error: 'PIN must be exactly 6 digits (0-9).' }));
                        return;
                    }
                    vault.pinSalt = crypto.randomBytes(16).toString('hex');
                    vault.pinScrypt = scryptHashHex(body.newPin, vault.pinSalt);
                }
                if (typeof body.newPass === 'string' && body.newPass.length > 0) {
                    if (body.newPass.length < 4 || body.newPass.length > 128) {
                        res.writeHead(400, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ ok: false, error: 'Passphrase must be 4-128 characters.' }));
                        return;
                    }
                    vault.passSalt = crypto.randomBytes(16).toString('hex');
                    vault.passScrypt = scryptHashHex(body.newPass, vault.passSalt);
                }
                if (typeof body.newChord === 'string') {
                    if (body.newChord === '') {
                        vault.chordSalt = '';
                        vault.chordScrypt = '';
                    } else if (body.newChord.length >= 6 && body.newChord.length <= 128) {
                        vault.chordSalt = crypto.randomBytes(16).toString('hex');
                        vault.chordScrypt = scryptHashHex(body.newChord, vault.chordSalt);
                    } else {
                        res.writeHead(400, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ ok: false, error: 'Secret key chord is too short.' }));
                        return;
                    }
                }
                vault.failedAttempts = 0;
                vault.lockoutUntil = 0;
                vault.escalationLevel = 0;
                saveVault(vault);
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                    ok: true,
                    authLock: vault.authLock,
                    hasKeyChord: Boolean(vault.chordScrypt),
                }));
            });
            return;
        }

        if (req.method === 'POST' && pathname === '/auth/windows-hello') {
            verifyWindowsHello().then((result) => {
                const grants = result && result.verified ? issueAuthGrants() : {};
                if (result && result.verified) {
                    const vault = readVault();
                    if (vault.failedAttempts !== 0 || vault.lockoutUntil !== 0) {
                        vault.failedAttempts = 0;
                        vault.lockoutUntil = 0;
                        vault.escalationLevel = 0;
                        saveVault(vault);
                    }
                }
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ ...result, ...grants }));
            });
            return;
        }

        if (req.method === 'GET' && pathname === '/user_media_list') {
            try {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ ok: true, ...scanUserMedia() }));
            } catch (err) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: err.message }));
            }
            return;
        }

        if (req.method === 'POST' && pathname === '/delete_media') {
            const chunks = [];
            let total = 0;
            const MAX_JSON = 64 * 1024;
            req.on('data', (chunk) => {
                total += chunk.length;
                if (total > MAX_JSON) {
                    res.writeHead(413, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Payload too large' }));
                    req.destroy();
                    return;
                }
                chunks.push(chunk);
            });
            req.on('end', () => {
                if (total > MAX_JSON) return;
                try {
                    let targetInput = reqUrl.searchParams.get('name') || '';
                    if (!targetInput && chunks.length > 0) {
                        const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
                        targetInput = body.url || body.fileName || body.name || '';
                    }
                    const fileName = normalizeUserMediaFileName(targetInput);
                    if (!fileName) {
                        res.writeHead(400, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ error: 'Invalid media target' }));
                        return;
                    }
                    const baseDir = path.resolve(USER_MEDIA_DIR);
                    const resolved = path.resolve(baseDir, fileName);
                    if (!resolved.startsWith(baseDir + path.sep)) {
                        res.writeHead(403, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ error: 'Forbidden path' }));
                        return;
                    }

                    const deletedFiles = [];
                    if (fs.existsSync(resolved) && fs.statSync(resolved).isFile()) {
                        const targetStat = fs.statSync(resolved);
                        const targetMd5 = getFileMd5(resolved, targetStat);
                        for (const entry of fs.readdirSync(baseDir, { withFileTypes: true })) {
                            if (!entry.isFile()) continue;
                            const candidatePath = path.join(baseDir, entry.name);
                            try {
                                const cStat = fs.statSync(candidatePath);
                                if (candidatePath === resolved || (cStat.size === targetStat.size && getFileMd5(candidatePath, cStat) === targetMd5)) {
                                    fs.unlinkSync(candidatePath);
                                    deletedFiles.push(entry.name);
                                }
                            } catch (_) {}
                        }
                    }

                    const deletedSet = new Set(deletedFiles.concat(fileName));
                    const cfg = readConfig();
                    const patch = {};
                    if (deletedSet.has(normalizeUserMediaFileName(cfg.customWp))) {
                        patch.customWp = '';
                    }
                    if (deletedSet.has(normalizeUserMediaFileName(cfg.customVideo))) {
                        patch.customVideo = '';
                    }
                    if (Array.isArray(cfg.savedImages)) {
                        patch.savedImages = cfg.savedImages.filter((it) => !deletedSet.has(normalizeUserMediaFileName(it && it.url)));
                    }
                    if (Array.isArray(cfg.savedVideos)) {
                        patch.savedVideos = cfg.savedVideos.filter((it) => !deletedSet.has(normalizeUserMediaFileName(it && it.url)));
                    }
                    if (Array.isArray(cfg.taskVoices)) {
                        patch.taskVoices = cfg.taskVoices.filter((it) => !deletedSet.has(normalizeUserMediaFileName(it && it.url)));
                    }
                    if (Object.keys(patch).length > 0) {
                        saveConfig(patch);
                    }

                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ ok: true, deleted: deletedFiles, media: scanUserMedia() }));
                } catch (err) {
                    res.writeHead(500, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: err.message }));
                }
            });
            return;
        }

        if (req.method === 'POST' && pathname === '/upload') {
            const rawName = String(reqUrl.searchParams.get('name') || 'custom_media.bin');
            const safeBase = path.basename(rawName).replace(/[^a-zA-Z0-9._-]/g, '_') || 'media.bin';
            const uploadExt = path.extname(safeBase).toLowerCase();
            const uploadKind = getMediaKind(safeBase);
            if (!uploadKind || uploadExt === '.svg') {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ ok: false, error: 'Unsupported media file extension' }));
                req.resume();
                return;
            }
            const fileName = `${Date.now()}_${safeBase}`;
            const chunks = [];
            let total = 0;
            const MAX_BYTES = 100 * 1024 * 1024;

            req.on('data', (chunk) => {
                total += chunk.length;
                if (total > MAX_BYTES) {
                    res.writeHead(413, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'File too large (max 100MB)' }));
                    req.destroy();
                    return;
                }
                chunks.push(chunk);
            });
            req.on('end', () => {
                if (total > MAX_BYTES) return;
                try {
                    fs.mkdirSync(USER_MEDIA_DIR, { recursive: true });
                    const buf = Buffer.concat(chunks);
                    const uploadMd5 = crypto.createHash('md5').update(buf).digest('hex');

                    for (const entry of fs.readdirSync(USER_MEDIA_DIR, { withFileTypes: true })) {
                        if (!entry.isFile()) continue;
                        const existingPath = path.join(USER_MEDIA_DIR, entry.name);
                        try {
                            const stat = fs.statSync(existingPath);
                            if (stat.size === buf.length && getFileMd5(existingPath, stat) === uploadMd5) {
                                res.writeHead(200, { 'Content-Type': 'application/json' });
                                res.end(JSON.stringify({
                                    ok: true,
                                    duplicate: true,
                                    url: `user_media/${encodeURIComponent(entry.name)}`,
                                    fileName: entry.name,
                                    name: stripMediaTimestamp(entry.name),
                                    kind: getMediaKind(entry.name) || 'image',
                                }));
                                return;
                            }
                        } catch (_) {}
                    }

                    const dest = path.join(USER_MEDIA_DIR, fileName);
                    fs.writeFileSync(dest, buf);
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({
                        ok: true,
                        duplicate: false,
                        url: `user_media/${encodeURIComponent(fileName)}`,
                        fileName,
                        name: stripMediaTimestamp(fileName),
                        kind: getMediaKind(fileName) || 'image',
                    }));
                } catch (err) {
                    res.writeHead(500, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: err.message }));
                }
            });
            return;
        }

        let baseDir = null;
        let relPath = '';
        if (pathname.startsWith('/assets/')) {
            baseDir = path.resolve(THEMES_ASSETS_DIR);
            relPath = pathname.slice('/assets/'.length);
        } else if (pathname.startsWith('/user_media/')) {
            baseDir = path.resolve(USER_MEDIA_DIR);
            relPath = pathname.slice('/user_media/'.length);
        } else {
            res.writeHead(404);
            res.end('Not found');
            return;
        }

        const resolved = path.resolve(baseDir, relPath);
        if (!resolved.startsWith(baseDir + path.sep) || !fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
            res.writeHead(404);
            res.end('Not found');
            return;
        }

        const stat = fs.statSync(resolved);
        const ext = path.extname(resolved).toLowerCase();
        const mime = MEDIA_MIME[ext] || 'application/octet-stream';
        const range = req.headers.range;
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self' data:; media-src 'self'; style-src 'unsafe-inline'");

        if (range) {
            const parts = range.replace(/bytes=/, '').split('-');
            const start = parseInt(parts[0], 10);
            const end = parts[1] ? parseInt(parts[1], 10) : stat.size - 1;
            if (Number.isNaN(start) || start >= stat.size || end >= stat.size) {
                res.writeHead(416, { 'Content-Range': `bytes */${stat.size}` });
                res.end();
                return;
            }
            res.writeHead(206, {
                'Content-Range': `bytes ${start}-${end}/${stat.size}`,
                'Accept-Ranges': 'bytes',
                'Content-Length': end - start + 1,
                'Content-Type': mime,
            });
            fs.createReadStream(resolved, { start, end }).pipe(res);
            return;
        }

        res.writeHead(200, {
            'Content-Length': stat.size,
            'Content-Type': mime,
            'Accept-Ranges': 'bytes',
        });
        fs.createReadStream(resolved).pipe(res);
    });

    mediaServer.listen(0, '127.0.0.1', () => {
        const addr = mediaServer.address();
        mediaPort = addr && typeof addr === 'object' ? addr.port : 0;
        if (process.env.AGY_TEST_PORT_FILE && mediaPort > 0) {
            try { fs.writeFileSync(process.env.AGY_TEST_PORT_FILE, String(mediaPort), 'utf8'); } catch (_) {}
        }
        log(`Local media server listening on http://127.0.0.1:${mediaPort}`);
    });
}

let missingPayloadLogged = false;
function buildInjectedSource() {
    if (!fs.existsSync(PAYLOAD_PATH)) {
        if (!missingPayloadLogged) {
            log(`Payload not built yet (${PAYLOAD_PATH}). Run: python scripts/build_payload.py`);
            missingPayloadLogged = true;
        }
        return null;
    }
    missingPayloadLogged = false;

    const vault = readVault();
    const cfgJson = JSON.stringify(readConfig());
    const mediaListJson = JSON.stringify(scanUserMedia());
    const mediaBase = mediaPort ? `http://127.0.0.1:${mediaPort}` : '';
    const payloadCode = fs.readFileSync(PAYLOAD_PATH, 'utf8');
    return `window.__AGY_MEDIA_BASE_URL__ = ${JSON.stringify(mediaBase)};\nwindow.__AGY_API_TOKEN__ = ${JSON.stringify(DAEMON_API_TOKEN)};\nwindow.__AGY_AUTH_LOCK__ = ${Boolean(vault.authLock)};\nwindow.__AGY_HAS_CHORD__ = ${Boolean(vault.chordScrypt)};\nwindow.__AGY_INITIAL_CONFIG__ = ${cfgJson};\nwindow.__AGY_USER_MEDIA__ = ${mediaListJson};\n${payloadCode}`;
}

function getPortInfo() {
    const portFile = resolvePortFile();
    if (!fs.existsSync(portFile)) return null;
    const lines = fs
        .readFileSync(portFile, 'utf8')
        .trim()
        .split(/\r?\n/)
        .map((s) => s.trim())
        .filter(Boolean);
    const port = parseInt(lines[0], 10);
    if (!Number.isFinite(port) || port <= 0) return null;
    return { port, token: lines[1] || '' };
}

function fetchJson(url) {
    return new Promise((resolve, reject) => {
        const req = http.get(url, { timeout: 2000 }, (res) => {
            let body = '';
            res.on('data', (chunk) => {
                body += chunk;
            });
            res.on('end', () => {
                try {
                    resolve(JSON.parse(body));
                } catch (err) {
                    reject(err);
                }
            });
        });
        req.on('timeout', () => req.destroy(new Error('HTTP timeout')));
        req.on('error', reject);
    });
}

const sessions = new Map();
let lastPort = null;
let reloadTimer = null;

function createSession(target) {
    const ws = new globalThis.WebSocket(target.webSocketDebuggerUrl);
    let nextId = 1;
    const pending = new Map();
    const session = { id: target.id, ws, target };
    sessions.set(target.id, session);

    function send(method, params = {}) {
        return new Promise((resolve, reject) => {
            if (ws.readyState !== 1) {
                reject(new Error('WebSocket is not open'));
                return;
            }
            const id = nextId++;
            pending.set(id, { resolve, reject });
            ws.send(JSON.stringify({ id, method, params }));
        });
    }

    session.reinject = async () => {
        const src = buildInjectedSource();
        if (!src) return;
        try {
            await send('Runtime.evaluate', { expression: src, awaitPromise: false });
        } catch (_) {}
    };

    ws.addEventListener('message', async (event) => {
        let msg;
        try {
            msg = JSON.parse(String(event.data));
        } catch (_) {
            return;
        }

        if (msg.id && pending.has(msg.id)) {
            const p = pending.get(msg.id);
            pending.delete(msg.id);
            if (msg.error) p.reject(new Error(msg.error.message || 'CDP error'));
            else p.resolve(msg.result);
            return;
        }

        if (msg.method === 'Runtime.bindingCalled' && msg.params && msg.params.name === 'agySaveThemeConfig') {
            try {
                const payload = JSON.parse(msg.params.payload || '{}');
                saveConfig(payload);
                for (const other of sessions.values()) {
                    if (other.id !== target.id) {
                        other.reinject();
                    }
                }
            } catch (err) {
                log(`Config binding error: ${err.message}`);
            }
            return;
        }

        if (msg.method === 'Page.frameNavigated' && msg.params && msg.params.frame && !msg.params.frame.parentId) {
            await session.reinject();
        }
    });

    ws.addEventListener('open', async () => {
        try {
            await send('Page.enable');
            await send('Runtime.enable');
            try {
                await send('Page.setBypassCSP', { enabled: true });
            } catch (_) {}
            try {
                const origin = new URL(target.url).origin;
                if (origin && origin !== 'null') {
                    await send('Browser.grantPermissions', {
                        permissions: ['videoCapture', 'audioCapture'],
                        origin,
                    });
                }
            } catch (_) {}
            try {
                await send('Runtime.addBinding', { name: 'agySaveThemeConfig' });
            } catch (_) {}

            const src = buildInjectedSource();
            if (src) {
                await send('Page.addScriptToEvaluateOnNewDocument', { source: src });
                await send('Runtime.evaluate', { expression: src, awaitPromise: false });
            }
            log(`Attached target ${target.id} (${target.url})`);
        } catch (err) {
            log(`Attach error for ${target.id}: ${err.message}`);
        }
    });

    const cleanup = () => {
        for (const p of pending.values()) {
            p.reject(new Error('WebSocket closed'));
        }
        pending.clear();
        sessions.delete(target.id);
    };
    ws.addEventListener('close', cleanup);
    ws.addEventListener('error', cleanup);
}

async function scanPages() {
    const info = getPortInfo();
    if (!info) return;

    if (lastPort !== null && lastPort !== info.port) {
        for (const s of sessions.values()) {
            try {
                s.ws.close();
            } catch (_) {}
        }
        sessions.clear();
    }
    lastPort = info.port;

    let targets;
    try {
        targets = await fetchJson(`http://127.0.0.1:${info.port}/json`);
    } catch (_) {
        return;
    }
    if (!Array.isArray(targets)) return;

    const pages = targets.filter((t) => {
        if (!t || t.type !== 'page' || !t.webSocketDebuggerUrl) return false;
        const url = String(t.url || '');
        if (url.startsWith('devtools://') || url.startsWith('chrome-extension://')) return false;
        return url.includes('127.0.0.1') || url.includes('workbench') || url.includes('launchpad');
    });

    const liveIds = new Set(pages.map((p) => p.id));
    for (const [id, session] of sessions.entries()) {
        if (!liveIds.has(id)) {
            try {
                session.ws.close();
            } catch (_) {}
            sessions.delete(id);
        }
    }

    for (const page of pages) {
        if (!sessions.has(page.id)) {
            createSession(page);
        }
    }
}

function watchPayload() {
    try {
        if (!fs.existsSync(DIST_DIR)) {
            fs.mkdirSync(DIST_DIR, { recursive: true });
        }
        fs.watch(DIST_DIR, (_eventType, filename) => {
            if (filename && filename !== 'theme_payload.js') return;
            clearTimeout(reloadTimer);
            reloadTimer = setTimeout(() => {
                log('Detected dist/theme_payload.js update; hot-reloading attached pages.');
                for (const s of sessions.values()) {
                    s.reinject();
                }
            }, 250);
        });
    } catch (err) {
        log(`fs.watch skipped: ${err.message}`);
    }
}

function shutdown(signal) {
    log(`Shutting down on ${signal}.`);
    if (faceWorker) {
        try {
            faceWorker.kill();
        } catch (_) {}
        faceWorker = null;
    }
    if (mediaServer) {
        try {
            mediaServer.close();
        } catch (_) {}
    }
    for (const s of sessions.values()) {
        try {
            s.ws.close();
        } catch (_) {}
    }
    sessions.clear();
    removePidLock();
    process.exit(0);
}

acquirePidLock();
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('exit', removePidLock);

log(`Theme daemon started (PID ${process.pid}, platform=${process.platform}, portFile=${resolvePortFile()}).`);
startMediaServer();
const readyWait = setInterval(() => {
    if (mediaPort > 0) {
        clearInterval(readyWait);
        watchPayload();
        scanPages();
        setInterval(scanPages, 1500);
    }
}, 25);
