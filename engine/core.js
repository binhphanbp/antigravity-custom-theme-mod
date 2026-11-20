(() => {
  const THEMES = /*__THEMES_PLACEHOLDER__*/{};
  const BOOT_ASSETS = /*__BOOT_ASSETS_PLACEHOLDER__*/{};
  const THEME_KEYS = Object.keys(THEMES);
  const DEFAULT_THEME_KEY = THEME_KEYS[0] || 'Default';

  const STORAGE_THEME = 'agy_theme_v3';
  const STORAGE_BUBBLE = 'agy_bubble_v3';
  const STORAGE_INPUT = 'agy_input_v3';
  const STORAGE_DIMMING = 'agy_dimming_v3';
  const STORAGE_WP_ENABLED = 'agy_wp_enabled_v3';
  const STORAGE_WP_MODE = 'agy_wp_mode_v3';
  const STORAGE_CUSTOM_WP = 'agy_custom_wp_v3';
  const STORAGE_CUSTOM_VIDEO = 'agy_custom_video_v3';
  const STORAGE_SAVED_IMAGES = 'agy_saved_images_v3';
  const STORAGE_SAVED_VIDEOS = 'agy_saved_videos_v3';
  const STORAGE_TASK_VOICES = 'agy_task_voices_v3';
  const STORAGE_TASK_VOICE_ENABLED = 'agy_task_voice_enabled_v3';
  const STORAGE_TASK_VOICE_VOL = 'agy_task_voice_vol_v3';
  const STORAGE_CUSTOM_GREETINGS = 'agy_custom_greetings_v3';
  const STORAGE_USER_AVATAR = 'agy_user_avatar_v3';
  const STORAGE_AGENT_AVATAR = 'agy_agent_avatar_v3';
  const STORAGE_GLASS_BLUR = 'agy_glass_blur_v3';
  const STORAGE_AVATAR_SIZE = 'agy_avatar_size_v3';
  const STORAGE_AVATAR_RADIUS = 'agy_avatar_radius_v3';
  const STORAGE_BOOT_INTRO = 'agy_boot_intro_v3';
  const STORAGE_SKETCH_REVEAL = 'agy_sketch_reveal_v3';
  const STORAGE_TAWA_GREETING = 'agy_tawa_greeting_v3';

  // Capture ephemeral CSPRNG daemon API token & server-authoritative vault policy into private closure
  const PRIVATE_API_TOKEN = typeof window.__AGY_API_TOKEN__ === 'string' ? window.__AGY_API_TOKEN__ : '';
  const HAS_VAULT_DAEMON = PRIVATE_API_TOKEN.length === 64;
  let serverAuthLock = HAS_VAULT_DAEMON ? (window.__AGY_AUTH_LOCK__ !== false) : false;
  let serverHasKeyChord = Boolean(window.__AGY_HAS_CHORD__);
  try {
    delete window.__AGY_API_TOKEN__;
    delete window.__AGY_AUTH_LOCK__;
    delete window.__AGY_HAS_CHORD__;
    // Purge any legacy client-side credential artifacts from older versions
    localStorage.removeItem('agy_auth_lock_v1');
    localStorage.removeItem('agy_auth_pin_hash_v1');
    localStorage.removeItem('agy_auth_pass_hash_v1');
  } catch (e) {}

  let sessionAuthenticated = !serverAuthLock;
  let closureBootCompleted = false;
  let isMountingBootOverlay = false;
  let tamperGuardObserver = null;
  let tamperRemountQueued = false;
  let lastAdminTicket = '';
  let lastAdminTicketExp = 0;

  function rememberAdminTicket(ticket) {
    if (typeof ticket === 'string' && ticket.length === 64) {
      lastAdminTicket = ticket;
      lastAdminTicketExp = Date.now() + 4.5 * 60 * 1000;
    }
  }

  function getValidAdminTicket() {
    return (lastAdminTicket && Date.now() < lastAdminTicketExp) ? lastAdminTicket : '';
  }

  function getDaemonBaseUrl() {
    return (typeof window !== 'undefined' && window.__AGY_MEDIA_BASE_URL__)
      ? String(window.__AGY_MEDIA_BASE_URL__).replace(/\/+$/, '')
      : '';
  }

  function daemonFetch(relPath, options = {}) {
    const base = getDaemonBaseUrl();
    const headers = Object.assign(
      {},
      options.headers || {},
      PRIVATE_API_TOKEN ? { 'X-Agy-Token': PRIVATE_API_TOKEN } : {}
    );
    return fetch(`${base}${relPath}`, Object.assign({}, options, { headers }));
  }

  function serializeKeyCombo(e) {
    if (!e || ['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return '';
    const mods = [];
    if (e.ctrlKey) mods.push('Ctrl');
    if (e.altKey) mods.push('Alt');
    if (e.shiftKey) mods.push('Shift');
    if (e.metaKey) mods.push('Meta');
    const code = String(e.code || e.key || '').trim();
    if (!code) return '';
    return [...mods, code].join('+');
  }

  function ensureVaultLockStyle() {
    if (document.getElementById('agy-vault-lock-guard')) return;
    const host = document.head || document.documentElement;
    if (!host) return;
    const st = document.createElement('style');
    st.id = 'agy-vault-lock-guard';
    st.textContent = `
      body[data-agy-mfa-locked="1"] .agy-shell,
      body[data-agy-mfa-locked="1"] .settings-modal-container,
      body[data-agy-mfa-locked="1"] #agy-custom-theme-modal-backdrop {
        opacity: 0 !important;
        pointer-events: none !important;
        user-select: none !important;
      }
    `;
    host.appendChild(st);
  }

  function nudgeComposerLayout() {
    const syncOnce = () => {
      try {
        document.querySelectorAll('.surface-composer-card textarea').forEach((ta) => {
          if (!ta.value && ta.style && ta.style.height && parseFloat(ta.style.height) < 26) {
            ta.style.height = '';
          }
        });
        if (typeof Event === 'function') {
          window.dispatchEvent(new Event('resize'));
        }
      } catch (e) {}
    };
    syncOnce();
    setTimeout(syncOnce, 80);
    setTimeout(syncOnce, 260);
  }

  function enforceWorkspaceLock() {
    if (sessionAuthenticated) return;
    ensureVaultLockStyle();
    if (document.body && document.body.getAttribute('data-agy-mfa-locked') !== '1') {
      document.body.setAttribute('data-agy-mfa-locked', '1');
    }
    document.querySelectorAll('.agy-shell').forEach((sh) => {
      if (!sh.inert) sh.inert = true;
      if (sh.getAttribute('aria-hidden') !== 'true') sh.setAttribute('aria-hidden', 'true');
    });
    if (!tamperGuardObserver && typeof MutationObserver !== 'undefined') {
      tamperGuardObserver = new MutationObserver(() => {
        if (sessionAuthenticated || isMountingBootOverlay) return;
        ensureVaultLockStyle();
        if (document.body && document.body.getAttribute('data-agy-mfa-locked') !== '1') {
          document.body.setAttribute('data-agy-mfa-locked', '1');
        }
        document.querySelectorAll('.agy-shell').forEach((sh) => {
          if (!sh.inert) sh.inert = true;
          if (sh.getAttribute('aria-hidden') !== 'true') sh.setAttribute('aria-hidden', 'true');
        });
        const ov = document.getElementById('agy-boot-overlay');
        const bs = document.getElementById('agy-boot-styles');
        const tampered = !ov || !ov.isConnected || !bs || !bs.isConnected ||
          ov.classList.contains('done') || ov.style.display === 'none' ||
          ov.style.visibility === 'hidden' || ov.style.opacity === '0';
        if (tampered && !tamperRemountQueued) {
          tamperRemountQueued = true;
          queueMicrotask(() => {
            tamperRemountQueued = false;
            if (!sessionAuthenticated) {
              mountBootSequence(true, true);
            }
          });
        }
      });
      const root = document.documentElement || document.body;
      if (root) {
        tamperGuardObserver.observe(root, {
          childList: true,
          subtree: true,
          attributes: true,
          attributeFilter: ['style', 'class', 'inert', 'data-agy-mfa-locked', 'aria-hidden']
        });
      }
    }
  }

  function releaseWorkspaceLock() {
    if (!sessionAuthenticated) return;
    if (tamperGuardObserver) {
      try { tamperGuardObserver.disconnect(); } catch (e) {}
      tamperGuardObserver = null;
    }
    const guardStyle = document.getElementById('agy-vault-lock-guard');
    if (guardStyle) guardStyle.remove();
    if (document.body) {
      document.body.removeAttribute('data-agy-mfa-locked');
    }
    document.querySelectorAll('.agy-shell').forEach((sh) => {
      sh.inert = false;
      sh.removeAttribute('aria-hidden');
    });
    nudgeComposerLayout();
  }

  function stopAuthCamera() {
    if (window.__AGY_FACE_POLL_TIMER__) {
      clearTimeout(window.__AGY_FACE_POLL_TIMER__);
      window.__AGY_FACE_POLL_TIMER__ = null;
    }
    if (window.__AGY_FACE_FALLBACK_TIMER__) {
      clearTimeout(window.__AGY_FACE_FALLBACK_TIMER__);
      window.__AGY_FACE_FALLBACK_TIMER__ = null;
    }
    if (window.__AGY_LOCKOUT_TIMER__) {
      clearInterval(window.__AGY_LOCKOUT_TIMER__);
      window.__AGY_LOCKOUT_TIMER__ = null;
    }
    if (window.__AGY_AUTH_STREAM__) {
      try {
        window.__AGY_AUTH_STREAM__.getTracks().forEach((tr) => tr.stop());
      } catch (e) {}
      window.__AGY_AUTH_STREAM__ = null;
    }
  }
  const GREETING_RX = /^(?:Hey\s+[^,]{1,40},\s+what\s+should\s+we\s+build\s+today\??|Good\s+to\s+see\s+you,\s+[^.]{1,40}\.\s+What'?s\s+next\??|What\s+(?:should|are)\s+we\s+build(?:ing)?\s+today\??|Welcome\s+back[,.!\s]+[^.!?]{0,40}(?:[.!?]\s*(?:Where\s+should\s+we\s+pick\s+up|What'?s\s+next|What\s+should\s+we\s+build)[^.!?]{0,40}[.!?]?)?|Where\s+should\s+we\s+pick\s+up\??|Ready\s+(?:to\s+build|when\s+you\s+are)[,.!\s]*.*)$/i;
  const DEFAULT_CUSTOM_GREETINGS = [
    'Welcome back, Binh Phan.',
    'What shall we architect today, Binh Phan?',
    'Workspace online. Ready when you are, Binh Phan.'
  ];

  const CHECK_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;

  const INPUT_STYLES = {
    'sync': {
      label: 'Synced Ornament Frame',
      desc: 'Follows the active theme borders & decorative SVG ornament'
    },
    'double_gold': {
      label: 'Metallic Amethyst Double Border',
      desc: 'Iridescent chrome-violet double border with corner filigree'
    },
    'glass': {
      label: 'Translucent Crystal Glass',
      desc: 'Lets more of your background artwork shine through'
    },
    'minimal': {
      label: 'Minimal Clean',
      desc: 'Sleek subtle border without top decorative stickers'
    }
  };

  try {
    if (localStorage.getItem('agy_binhphan_mfa_v8') !== '1') {
      localStorage.setItem('agy_binhphan_mfa_v8', '1');
      window.__AGY_BOOT_PLAYED__ = false;
      window.__AGY_REVEAL_DONE_ONCE__ = false;
      window.__AGY_GREETING_NEED_FRESH__ = true;
    }
  } catch (e) {}

  function escapeHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function canonicalMediaKey(urlStr) {
    if (!urlStr) return '';
    const s = String(urlStr).trim();
    if (!s) return '';
    const match = s.match(/(?:^|\/)(user_media\/[^?#]+)/i);
    if (match) {
      try {
        return 'user_media/' + decodeURIComponent(match[1].slice('user_media/'.length));
      } catch (e) {
        return match[1];
      }
    }
    return s;
  }

  function isSameMediaUrl(a, b) {
    const ka = canonicalMediaKey(a);
    const kb = canonicalMediaKey(b);
    return Boolean(ka && kb && ka === kb);
  }

  function deriveMediaName(urlOrName, fallback = 'Custom Media') {
    if (!urlOrName) return fallback;
    const s = String(urlOrName).trim();
    if (!s) return fallback;
    if (s.startsWith('data:')) return fallback;
    const key = canonicalMediaKey(s);
    const tail = key.split('/').pop() || '';
    const cleaned = tail.replace(/^\d{10,}_/, '').trim();
    return cleaned || fallback;
  }

  function normalizeSavedMediaList(list, fallbackLabel) {
    if (!Array.isArray(list)) return [];
    const seen = new Set();
    const out = [];
    for (const raw of list) {
      const url = typeof raw === 'string' ? raw.trim() : (raw && typeof raw.url === 'string' ? raw.url.trim() : '');
      if (!url) continue;
      const key = canonicalMediaKey(url);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      const name = (raw && typeof raw.name === 'string' && raw.name.trim())
        ? raw.name.trim()
        : deriveMediaName(url, fallbackLabel);
      const addedAt = (raw && Number.isFinite(Number(raw.addedAt))) ? Number(raw.addedAt) : 0;
      out.push({ url, name, addedAt });
    }
    return out;
  }

  function readStoredMediaList(storageKey, initList, fallbackLabel) {
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw !== null) {
        return normalizeSavedMediaList(JSON.parse(raw), fallbackLabel);
      }
    } catch (e) {}
    return normalizeSavedMediaList(initList, fallbackLabel);
  }

  function mediaKindMeta(kind) {
    if (kind === 'video') {
      return {
        bucket: 'videos',
        storageKey: STORAGE_SAVED_VIDEOS,
        initListKey: 'savedVideos',
        activeStorageKey: STORAGE_CUSTOM_VIDEO,
        activeInitKey: 'customVideo',
        fallbackLabel: 'Custom Video'
      };
    }
    if (kind === 'audio') {
      return {
        bucket: 'audios',
        storageKey: STORAGE_TASK_VOICES,
        initListKey: 'taskVoices',
        activeStorageKey: '',
        activeInitKey: '',
        fallbackLabel: 'Task Voice'
      };
    }
    return {
      bucket: 'images',
      storageKey: STORAGE_SAVED_IMAGES,
      initListKey: 'savedImages',
      activeStorageKey: STORAGE_CUSTOM_WP,
      activeInitKey: 'customWp',
      fallbackLabel: 'Custom Image'
    };
  }

  function getMediaLibrary(kind, initOverride, activeCustomOverride) {
    const meta = mediaKindMeta(kind);
    const init = initOverride || window.__AGY_INITIAL_CONFIG__ || {};
    const stored = readStoredMediaList(meta.storageKey, init[meta.initListKey], meta.fallbackLabel);

    const serverMedia = window.__AGY_USER_MEDIA__;
    const hasServerList = Boolean(serverMedia && Array.isArray(serverMedia[meta.bucket]));
    const diskList = hasServerList ? normalizeSavedMediaList(serverMedia[meta.bucket], meta.fallbackLabel) : [];

    const byKey = new Map();
    if (hasServerList) {
      const diskByKey = new Map();
      diskList.forEach((it) => diskByKey.set(canonicalMediaKey(it.url), it));
      stored.forEach((it) => {
        const key = canonicalMediaKey(it.url);
        if (key.startsWith('user_media/')) {
          const diskMatch = diskByKey.get(key);
          if (diskMatch) {
            byKey.set(key, {
              url: diskMatch.url,
              name: it.name || diskMatch.name,
              addedAt: Math.max(it.addedAt || 0, diskMatch.addedAt || 0)
            });
          }
        } else {
          byKey.set(key, it);
        }
      });
      diskList.forEach((it) => {
        const key = canonicalMediaKey(it.url);
        if (!byKey.has(key)) {
          byKey.set(key, it);
        }
      });
    } else {
      stored.forEach((it) => byKey.set(canonicalMediaKey(it.url), it));
    }

    const activeUrl = activeCustomOverride !== undefined
      ? activeCustomOverride
      : (meta.activeStorageKey ? (localStorage.getItem(meta.activeStorageKey) ?? init[meta.activeInitKey] ?? '') : '');
    if (activeUrl) {
      const activeKey = canonicalMediaKey(activeUrl);
      if (activeKey && !byKey.has(activeKey)) {
        if (!hasServerList || !activeKey.startsWith('user_media/')) {
          byKey.set(activeKey, {
            url: activeUrl,
            name: deriveMediaName(activeUrl, meta.fallbackLabel),
            addedAt: Date.now()
          });
        }
      }
    }

    return Array.from(byKey.values()).sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0));
  }

  function upsertSavedMedia(kind, item) {
    if (!item || !item.url) return getMediaLibrary(kind);
    const meta = mediaKindMeta(kind);
    const current = getMediaLibrary(kind);
    const key = canonicalMediaKey(item.url);
    const filtered = current.filter((it) => canonicalMediaKey(it.url) !== key);
    const nextItem = {
      url: item.url,
      name: (item.name && String(item.name).trim()) || deriveMediaName(item.url, meta.fallbackLabel),
      addedAt: item.addedAt || Date.now()
    };
    const next = [nextItem, ...filtered];
    try {
      localStorage.setItem(meta.storageKey, JSON.stringify(next));
    } catch (e) {}
    if (window.__AGY_USER_MEDIA__ && key.startsWith('user_media/')) {
      const arr = Array.isArray(window.__AGY_USER_MEDIA__[meta.bucket]) ? window.__AGY_USER_MEDIA__[meta.bucket] : [];
      window.__AGY_USER_MEDIA__[meta.bucket] = [nextItem, ...arr.filter((it) => canonicalMediaKey(it.url) !== key)];
    }
    return next;
  }

  function removeSavedMediaFromStore(kind, url) {
    const meta = mediaKindMeta(kind);
    const key = canonicalMediaKey(url);
    const next = getMediaLibrary(kind).filter((it) => canonicalMediaKey(it.url) !== key);
    try {
      localStorage.setItem(meta.storageKey, JSON.stringify(next));
    } catch (e) {}
    if (window.__AGY_USER_MEDIA__) {
      if (Array.isArray(window.__AGY_USER_MEDIA__[meta.bucket])) {
        window.__AGY_USER_MEDIA__[meta.bucket] = window.__AGY_USER_MEDIA__[meta.bucket].filter((it) => canonicalMediaKey(it.url) !== key);
      }
    }
    return next;
  }

  function normalizeGreetingLines(list) {
    if (!Array.isArray(list)) return [];
    const seen = new Set();
    const out = [];
    for (const item of list) {
      const s = String(item || '').trim();
      if (!s || seen.has(s)) continue;
      seen.add(s);
      out.push(s);
    }
    return out;
  }

  function readCustomGreetings(initOverride) {
    try {
      const raw = localStorage.getItem(STORAGE_CUSTOM_GREETINGS);
      if (raw !== null) {
        return normalizeGreetingLines(JSON.parse(raw));
      }
    } catch (e) {}
    const init = initOverride || window.__AGY_INITIAL_CONFIG__ || {};
    return normalizeGreetingLines(init.customGreetings);
  }

  function getState() {
    const init = window.__AGY_INITIAL_CONFIG__ || {};
    const rawTheme = localStorage.getItem(STORAGE_THEME) || init.themeName || DEFAULT_THEME_KEY;
    const themeName = THEMES[rawTheme] ? rawTheme : DEFAULT_THEME_KEY;
    const rawBubble = localStorage.getItem(STORAGE_BUBBLE) || init.bubbleName || themeName;
    const bubbleName = THEMES[rawBubble] ? rawBubble : themeName;
    const inputStyle = localStorage.getItem(STORAGE_INPUT) || init.inputStyle || 'sync';
    const dimming = parseInt(localStorage.getItem(STORAGE_DIMMING) || (init.dimming !== undefined ? init.dimming : '69'), 10);
    const wpEnabled = localStorage.getItem(STORAGE_WP_ENABLED) !== null
      ? localStorage.getItem(STORAGE_WP_ENABLED) !== 'false'
      : (init.wpEnabled !== undefined ? init.wpEnabled : true);
    const activeThObj = THEMES[themeName] || THEMES[DEFAULT_THEME_KEY] || {};
    const storedMode = localStorage.getItem(STORAGE_WP_MODE);
    const wpMode = (storedMode === 'video' || storedMode === 'image')
      ? storedMode
      : ((init.wpMode === 'video' || init.wpMode === 'image') ? init.wpMode : (activeThObj.wallpaperVideo ? 'video' : 'image'));
    const rawCustomWp = localStorage.getItem(STORAGE_CUSTOM_WP);
    const customWp = rawCustomWp !== null ? rawCustomWp : (init.customWp || '');
    const rawCustomVid = localStorage.getItem(STORAGE_CUSTOM_VIDEO);
    const customVideo = rawCustomVid !== null ? rawCustomVid : (init.customVideo || '');
    const savedImages = getMediaLibrary('image', init, customWp);
    const savedVideos = getMediaLibrary('video', init, customVideo);
    const taskVoices = getMediaLibrary('audio', init, '');
    const taskVoiceEnabled = localStorage.getItem(STORAGE_TASK_VOICE_ENABLED) !== null
      ? localStorage.getItem(STORAGE_TASK_VOICE_ENABLED) !== 'false'
      : (init.taskVoiceEnabled !== undefined ? init.taskVoiceEnabled : true);
    const rawTaskVol = localStorage.getItem(STORAGE_TASK_VOICE_VOL) ?? init.taskVoiceVol;
    const taskVoiceVol = rawTaskVol !== undefined && rawTaskVol !== null && rawTaskVol !== ''
      ? Math.max(0, Math.min(100, parseInt(rawTaskVol, 10)))
      : 85;
    const customGreetings = readCustomGreetings(init);
    const userAvatar = localStorage.getItem(STORAGE_USER_AVATAR) ?? init.userAvatar ?? '';
    const agentAvatar = localStorage.getItem(STORAGE_AGENT_AVATAR) ?? init.agentAvatar ?? '';
    const rawBlur = localStorage.getItem(STORAGE_GLASS_BLUR) ?? init.glassBlur;
    const glassBlur = rawBlur !== undefined && rawBlur !== null && rawBlur !== '' ? parseInt(rawBlur, 10) : 3;
    const rawAvSize = localStorage.getItem(STORAGE_AVATAR_SIZE) ?? init.avatarSize;
    const avatarSize = rawAvSize !== undefined && rawAvSize !== null && rawAvSize !== '' ? parseInt(rawAvSize, 10) : 32;
    const rawAvRad = localStorage.getItem(STORAGE_AVATAR_RADIUS) ?? init.avatarRadius;
    const avatarRadius = rawAvRad !== undefined && rawAvRad !== null && rawAvRad !== '' ? parseInt(rawAvRad, 10) : 50;
    const bootIntro = localStorage.getItem(STORAGE_BOOT_INTRO) !== null
      ? localStorage.getItem(STORAGE_BOOT_INTRO) !== 'false'
      : (init.bootIntro !== undefined ? init.bootIntro : true);
    const sketchReveal = localStorage.getItem(STORAGE_SKETCH_REVEAL) !== null
      ? localStorage.getItem(STORAGE_SKETCH_REVEAL) !== 'false'
      : (init.sketchReveal !== undefined ? init.sketchReveal : true);
    const tawaGreeting = localStorage.getItem(STORAGE_TAWA_GREETING) !== null
      ? localStorage.getItem(STORAGE_TAWA_GREETING) !== 'false'
      : (init.tawaGreeting !== undefined ? init.tawaGreeting : true);
    const authLock = Boolean(serverAuthLock);
    return {
      themeName, bubbleName, inputStyle, dimming, wpEnabled, wpMode,
      customWp, customVideo, savedImages, savedVideos,
      taskVoices, taskVoiceEnabled, taskVoiceVol, customGreetings,
      userAvatar, agentAvatar, glassBlur, avatarSize, avatarRadius,
      bootIntro, sketchReveal, tawaGreeting,
      authLock
    };
  }

  function resolveMediaUrl(relOrAbs) {
    if (!relOrAbs) return '';
    const s = String(relOrAbs).trim();
    if (!s) return '';
    const base = (typeof window !== 'undefined' && window.__AGY_MEDIA_BASE_URL__)
      ? String(window.__AGY_MEDIA_BASE_URL__).replace(/\/+$/, '')
      : '';
    const localMediaMatch = s.match(/^https?:\/\/127\.0\.0\.1:\d+\/((?:assets|user_media)\/.+)$/i);
    if (localMediaMatch) {
      return base ? `${base}/${localMediaMatch[1]}` : s;
    }
    if (/^(https?:|data:|blob:|file:)/i.test(s)) return s;
    const cleanRel = s.replace(/^\.\//, '').replace(/^\/+/, '');
    return base ? `${base}/${cleanRel}` : `./${cleanRel}`;
  }

  function sanitizeCssUrl(u) {
    return String(u || '').replace(/["\\()\r\n]/g, (ch) => encodeURIComponent(ch));
  }

  // Downscale user/agent avatar uploads to 192x192 WebP once so theme_config.json stays tiny
  function compressAvatarFile(file, callback) {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        try {
          const size = 192;
          const canvas = document.createElement('canvas');
          canvas.width = size;
          canvas.height = size;
          const ctx = canvas.getContext('2d');
          const natW = img.naturalWidth || size;
          const natH = img.naturalHeight || size;
          const side = Math.min(natW, natH);
          const sx = Math.max(0, Math.floor((natW - side) / 2));
          const sy = Math.max(0, Math.floor((natH - side) / 2));
          ctx.drawImage(img, sx, sy, side, side, 0, 0, size, size);
          const out = canvas.toDataURL('image/webp', 0.88);
          callback(out && out.startsWith('data:image/webp') ? out : canvas.toDataURL('image/png'));
        } catch (e) {
          callback(String(reader.result || ''));
        }
      };
      img.onerror = () => callback(String(reader.result || ''));
      img.src = String(reader.result || '');
    };
    reader.readAsDataURL(file);
  }

  function findActiveShell() {
    const all = Array.from(document.querySelectorAll('.agy-shell'));
    if (all.length <= 1) return all[0] || null;
    let best = all[0];
    let bestArea = 0;
    for (const el of all) {
      const r = el.getBoundingClientRect();
      const area = r.width * r.height;
      if (area > bestArea) {
        bestArea = area;
        best = el;
      }
    }
    return best;
  }

  // Pre-bake L-shaped header/sidebar glass blur once per theme/dimming change to avoid per-frame GPU backdrop readback
  function syncPrebakedGlass(wpUrl, overlayRgb, overlayAlpha, tintBg, blurStr) {
    const shell = findActiveShell();
    if (!wpUrl) {
      if (shell) shell.style.removeProperty('--agy-l-glass-bg');
      return;
    }
    const key = `${wpUrl.slice(0, 64)}|${wpUrl.length}|${overlayRgb}|${overlayAlpha.toFixed(3)}|${tintBg}|${blurStr}`;
    window.__AGY_BLUR_CACHE__ = window.__AGY_BLUR_CACHE__ || {};
    const cached = window.__AGY_BLUR_CACHE__[key];
    if (cached) {
      if (shell) shell.style.setProperty('--agy-l-glass-bg', 'url("' + cached + '")');
      return;
    }
    const img = new Image();
    if (!/^(?:data|blob|file):/i.test(wpUrl)) {
      img.crossOrigin = 'anonymous';
    }
    img.onload = () => {
      try {
        const w = 640;
        const h = Math.max(180, Math.round((img.naturalHeight || 1440) * (w / (img.naturalWidth || 2560))));
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        const pxMatch = String(blurStr !== undefined ? blurStr : '3px').match(/(\d+(?:\.\d+)?)/);
        const scaledBlur = Math.max(0, Math.min(16, Math.round((pxMatch ? parseFloat(pxMatch[1]) : 3) * 0.75)));
        ctx.filter = scaledBlur > 0 ? `blur(${scaledBlur}px)` : 'none';
        ctx.drawImage(img, -12, -12, w + 24, h + 24);
        ctx.filter = 'none';
        ctx.fillStyle = `rgba(${overlayRgb}, ${overlayAlpha})`;
        ctx.fillRect(0, 0, w, h);
        if (tintBg) {
          ctx.fillStyle = tintBg;
          ctx.fillRect(0, 0, w, h);
        }
        const baked = canvas.toDataURL('image/webp', 0.85);
        canvas.width = 0;
        canvas.height = 0;
        const cache = window.__AGY_BLUR_CACHE__;
        if (Object.prototype.hasOwnProperty.call(cache, key)) {
          delete cache[key];
        }
        cache[key] = baked;
        const cacheKeys = Object.keys(cache);
        while (cacheKeys.length > 4) {
          delete cache[cacheKeys.shift()];
        }
        const curShell = document.querySelector('.agy-shell');
        if (curShell) curShell.style.setProperty('--agy-l-glass-bg', 'url("' + baked + '")');
      } catch (e) {}
    };
    img.src = wpUrl;
  }

  // ==================== UNIVERSAL ANIME LINE-ART TRACER (CANNY-STYLE NMS + COVER CROP + BEZIER) ====================
  function parseObjPosRatio(posStr) {
    const parts = String(posStr || '50% 50%').trim().split(/\s+/);
    const mapTok = (tok, def) => {
      if (!tok) return def;
      if (tok === 'left' || tok === 'top') return 0;
      if (tok === 'center') return 0.5;
      if (tok === 'right' || tok === 'bottom') return 1;
      if (tok.endsWith('%')) {
        const v = parseFloat(tok);
        return Number.isFinite(v) ? Math.max(0, Math.min(1, v / 100)) : def;
      }
      return def;
    };
    return [mapTok(parts[0], 0.5), mapTok(parts[1] || parts[0], 0.5)];
  }

  function simplifyChainRDPFlat(ptsX, ptsY, count, epsSq) {
    if (count <= 3) {
      const out = new Float32Array(count * 2);
      for (let i = 0; i < count; i++) {
        out[i * 2] = ptsX[i];
        out[i * 2 + 1] = ptsY[i];
      }
      return out;
    }
    const keep = new Uint8Array(count);
    keep[0] = 1;
    keep[count - 1] = 1;
    const stack = [[0, count - 1]];
    while (stack.length > 0) {
      const [s, e] = stack.pop();
      if (e - s <= 1) continue;
      const ax = ptsX[s];
      const ay = ptsY[s];
      const dx = ptsX[e] - ax;
      const dy = ptsY[e] - ay;
      const lenSq = dx * dx + dy * dy;
      let maxD = 0;
      let maxI = -1;
      for (let i = s + 1; i < e; i++) {
        const px = ptsX[i] - ax;
        const py = ptsY[i] - ay;
        let dSq;
        if (lenSq < 1e-9) {
          dSq = px * px + py * py;
        } else {
          const t = Math.max(0, Math.min(1, (px * dx + py * dy) / lenSq));
          const cx = px - t * dx;
          const cy = py - t * dy;
          dSq = cx * cx + cy * cy;
        }
        if (dSq > maxD) {
          maxD = dSq;
          maxI = i;
        }
      }
      if (maxD > epsSq && maxI > s) {
        keep[maxI] = 1;
        stack.push([s, maxI], [maxI, e]);
      }
    }
    let kept = 0;
    for (let i = 0; i < count; i++) if (keep[i]) kept++;
    const out = new Float32Array(kept * 2);
    let k = 0;
    for (let i = 0; i < count; i++) {
      if (keep[i]) {
        out[k++] = ptsX[i];
        out[k++] = ptsY[i];
      }
    }
    return out;
  }

  function extractStrokesJS(mediaEl, targetW = 1280, targetH = 800, objPosStr = '50% 50%', maxStrokes = 1380) {
    const strokes = [];
    try {
      const srcW = mediaEl.videoWidth || mediaEl.naturalWidth || 0;
      const srcH = mediaEl.videoHeight || mediaEl.naturalHeight || 0;
      if (srcW > 0 && srcH > 0) {
        const viewAspect = Math.max(0.4, Math.min(3.5, targetW / Math.max(1, targetH)));
        const w = 920;
        const h = Math.max(240, Math.round(w / viewAspect));
        const off = document.createElement('canvas');
        off.width = w;
        off.height = h;
        const octx = off.getContext('2d', { willReadFrequently: true });
        if (octx) {
          // Match exact CSS object-fit: cover + object-position crop so every contour aligns 1:1 with the video/image
          const [rx, ry] = parseObjPosRatio(objPosStr);
          const srcAspect = srcW / srcH;
          let sx = 0, sy = 0, sw = srcW, sh = srcH;
          if (srcAspect > viewAspect) {
            sw = srcH * viewAspect;
            sx = Math.max(0, (srcW - sw) * rx);
          } else if (srcAspect < viewAspect) {
            sh = srcW / viewAspect;
            sy = Math.max(0, (srcH - sh) * ry);
          }
          octx.imageSmoothingEnabled = true;
          octx.imageSmoothingQuality = 'medium';
          octx.drawImage(mediaEl, sx, sy, sw, sh, 0, 0, w, h);

          const data = octx.getImageData(0, 0, w, h).data;
          off.width = 0;
          off.height = 0;
          const totalPx = w * h;
          // Uint16Array scaled x8 preserves sub-unit accuracy at half the RAM of Float32Array
          const mag = new Uint16Array(totalPx);
          const dirBin = new Uint8Array(totalPx);
          let maxMag = 8;
          const rowBytes = w * 4;
          for (let y = 2; y < h - 2; y++) {
            const row = y * w;
            const rTopBase = (y - 1) * rowBytes;
            const rMidBase = y * rowBytes;
            const rBotBase = (y + 1) * rowBytes;

            let p0 = rTopBase + 4, p1 = rMidBase + 4, p2 = rBotBase + 4;
            let sR0 = data[p0] + 2 * data[p1] + data[p2], dR0 = data[p2] - data[p0];
            let sG0 = data[p0 + 1] + 2 * data[p1 + 1] + data[p2 + 1], dG0 = data[p2 + 1] - data[p0 + 1];
            let sB0 = data[p0 + 2] + 2 * data[p1 + 2] + data[p2 + 2], dB0 = data[p2 + 2] - data[p0 + 2];

            p0 += 4; p1 += 4; p2 += 4;
            let sR1 = data[p0] + 2 * data[p1] + data[p2], dR1 = data[p2] - data[p0];
            let sG1 = data[p0 + 1] + 2 * data[p1 + 1] + data[p2 + 1], dG1 = data[p2 + 1] - data[p0 + 1];
            let sB1 = data[p0 + 2] + 2 * data[p1 + 2] + data[p2 + 2], dB1 = data[p2 + 2] - data[p0 + 2];

            for (let x = 2; x < w - 2; x++) {
              const rxPos = (x + 1) * 4;
              const q0 = rTopBase + rxPos, q1 = rMidBase + rxPos, q2 = rBotBase + rxPos;
              const sR2 = data[q0] + 2 * data[q1] + data[q2], dR2 = data[q2] - data[q0];
              const sG2 = data[q0 + 1] + 2 * data[q1 + 1] + data[q2 + 1], dG2 = data[q2 + 1] - data[q0 + 1];
              const sB2 = data[q0 + 2] + 2 * data[q1 + 2] + data[q2 + 2], dB2 = data[q2 + 2] - data[q0 + 2];

              const gxR = sR2 - sR0, gyR = dR0 + 2 * dR1 + dR2;
              const gxG = sG2 - sG0, gyG = dG0 + 2 * dG1 + dG2;
              const gxB = sB2 - sB0, gyB = dB0 + 2 * dB1 + dB2;

              sR0 = sR1; sR1 = sR2; dR0 = dR1; dR1 = dR2;
              sG0 = sG1; sG1 = sG2; dG0 = dG1; dG1 = dG2;
              sB0 = sB1; sB1 = sB2; dB0 = dB1; dB1 = dB2;

              const gxL = 0.299 * gxR + 0.587 * gxG + 0.114 * gxB;
              const gyL = 0.299 * gyR + 0.587 * gyG + 0.114 * gyB;
              const gx1 = gxR - gxG;
              const gy1 = gyR - gyG;
              const gx2 = 0.5 * (gxR + gxG) - gxB;
              const gy2 = 0.5 * (gyR + gyG) - gyB;

              const lSq = gxL * gxL + gyL * gyL;
              const c1Sq = gx1 * gx1 + gy1 * gy1;
              const c2Sq = gx2 * gx2 + gy2 * gy2;
              // Stronger chroma weight preserves isoluminant anime iris boundaries (e.g. gold/pink vs white sclera)
              const m = Math.sqrt(lSq + 0.90 * (c1Sq + c2Sq));
              const mScaled = m > 8191 ? 65535 : Math.round(m * 8);
              const idx = row + x;
              mag[idx] = mScaled;
              if (mScaled > maxMag) maxMag = mScaled;

              let gx = gxL, gy = gyL;
              if (0.90 * c1Sq > lSq && c1Sq >= c2Sq) { gx = gx1; gy = gy1; }
              else if (0.90 * c2Sq > lSq && c2Sq > c1Sq) { gx = gx2; gy = gy2; }
              const ax = Math.abs(gx);
              const ay = Math.abs(gy);
              if (ax > ay * 2.414) dirBin[idx] = 0;
              else if (ay > ax * 2.414) dirBin[idx] = 2;
              else dirBin[idx] = (gx * gy >= 0) ? 1 : 3;
            }
          }

          // Canny NMS + 8x5 spatial tile peak tracking so soft foreground corners aren't drowned by global high-contrast areas
          const nms = new Uint16Array(totalPx);
          const bins = new Int32Array(128);
          const GRID_X = 8, GRID_Y = 5;
          const tileMax = new Uint16Array(GRID_X * GRID_Y);
          let nmsCount = 0;
          const margin = 3;
          const noiseFloor = 7 * 8;
          for (let y = margin; y < h - margin; y++) {
            const row = y * w;
            const ty = Math.min(GRID_Y - 1, Math.floor((y * GRID_Y) / h));
            for (let x = margin; x < w - margin; x++) {
              const i = row + x;
              const m = mag[i];
              if (m < noiseFloor) continue;
              const d = dirBin[i];
              let m1 = 0, m2 = 0;
              if (d === 0) { m1 = mag[i - 1]; m2 = mag[i + 1]; }
              else if (d === 2) { m1 = mag[i - w]; m2 = mag[i + w]; }
              else if (d === 1) { m1 = mag[i - w - 1]; m2 = mag[i + w + 1]; }
              else { m1 = mag[i - w + 1]; m2 = mag[i + w - 1]; }
              if (m >= m1 && m >= m2) {
                nms[i] = m;
                const b = Math.min(127, Math.floor((m / maxMag) * 127));
                bins[b]++;
                nmsCount++;
                const tx = Math.min(GRID_X - 1, Math.floor((x * GRID_X) / w));
                const tIdx = ty * GRID_X + tx;
                if (m > tileMax[tIdx]) tileMax[tIdx] = m;
              }
            }
          }

          let targetEdges = Math.max(140, Math.floor(nmsCount * 0.17));
          let hiBin = 22;
          for (let b = 127; b >= 1; b--) {
            targetEdges -= bins[b];
            if (targetEdges <= 0) {
              hiBin = b;
              break;
            }
          }
          const hiThresh = Math.max(20 * 8, (hiBin / 127) * maxMag);
          const loThresh = Math.max(10 * 8, hiThresh * 0.34);

          const tileSeed = new Uint16Array(GRID_X * GRID_Y);
          const tileFollow = new Uint16Array(GRID_X * GRID_Y);
          for (let ty = 0; ty < GRID_Y; ty++) {
            for (let tx = 0; tx < GRID_X; tx++) {
              const tIdx = ty * GRID_X + tx;
              const nx = (tx + 0.5) / GRID_X;
              const ny = (ty + 0.5) / GRID_Y;
              const inFocal = nx >= 0.25 && nx <= 0.75 && ny >= 0.20 && ny <= 0.78;
              const tmax = tileMax[tIdx];
              const minFloor = inFocal ? 22 * 8 : 26 * 8;
              const adaptCap = inFocal ? hiThresh * 0.30 : hiThresh * 0.34;
              const seed = tmax < minFloor ? 65535 : Math.max(minFloor, Math.min(adaptCap, tmax * 0.20));
              tileSeed[tIdx] = Math.round(seed);
              tileFollow[tIdx] = Math.max(7 * 8, Math.round(seed * 0.42));
            }
          }

          const visited = dirBin;
          visited.fill(0);
          const dirs = [[-1, -1], [0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0]];
          const candidates = [];

          // Reusable flat typed scratch buffers prevent creating tens of thousands of [x, y] tuples during tracing
          const MAX_HALF = 140;
          const fwdX = new Int16Array(MAX_HALF);
          const fwdY = new Int16Array(MAX_HALF);
          const revX = new Int16Array(MAX_HALF);
          const revY = new Int16Array(MAX_HALF);
          const chainX = new Float32Array(MAX_HALF * 2 + 2);
          const chainY = new Float32Array(MAX_HALF * 2 + 2);
          const smX = new Float32Array(MAX_HALF * 2 + 2);
          const smY = new Float32Array(MAX_HALF * 2 + 2);

          function traceHalf(startX, startY, initDx, initDy, minEdge, outX, outY) {
            let cx = startX, cy = startY;
            let tanX = initDx, tanY = initDy;
            let steps = 0, energy = 0;
            while (steps < MAX_HALF) {
              let bestX = -1, bestY = -1, bestScore = -1;
              const tanLen = (tanX === 0 && tanY === 0) ? 0 : Math.hypot(tanX, tanY);
              for (let d = 0; d < 8; d++) {
                const dx = dirs[d][0];
                const dy = dirs[d][1];
                const dot = tanLen === 0 ? 1 : (dx * tanX + dy * tanY);
                // Smoothed EMA tangent keeps curved eye irises & circles continuous across 1px raster steps without U-turns
                if (tanLen > 0 && dot < -0.18 * tanLen) continue;
                const nx = cx + dx;
                const ny = cy + dy;
                if (nx < margin || nx >= w - margin || ny < margin || ny >= h - margin) continue;
                const ni = ny * w + nx;
                const nVal = nms[ni];
                if (visited[ni] || nVal < minEdge) continue;
                const align = tanLen === 0 ? 1.0 : (1.0 + 0.55 * (dot / tanLen));
                const sc = nVal * align;
                if (sc > bestScore) {
                  bestScore = sc;
                  bestX = nx;
                  bestY = ny;
                }
              }

              if (bestX < 0 && tanLen > 0) {
                const ux = Math.round(tanX / tanLen);
                const uy = Math.round(tanY / tanLen);
                const gx2 = cx + ux * 2;
                const gy2 = cy + uy * 2;
                if (gx2 >= margin && gx2 < w - margin && gy2 >= margin && gy2 < h - margin) {
                  const gi = gy2 * w + gx2;
                  if (!visited[gi] && nms[gi] >= minEdge * 0.85) {
                    bestX = gx2;
                    bestY = gy2;
                  }
                }
              }

              if (bestX < 0) break;
              const bi = bestY * w + bestX;
              visited[bi] = 1;
              outX[steps] = bestX;
              outY[steps] = bestY;
              energy += nms[bi];
              const stepX = bestX - cx;
              const stepY = bestY - cy;
              tanX = tanLen === 0 ? stepX : (tanX * 0.52 + stepX * 0.48);
              tanY = tanLen === 0 ? stepY : (tanY * 0.52 + stepY * 0.48);
              cx = bestX;
              cy = bestY;
              steps++;
            }
            return { len: steps, energy };
          }

          function collectPass(mode) {
            for (let y = margin; y < h - margin; y++) {
              const ty = Math.min(GRID_Y - 1, Math.floor((y * GRID_Y) / h));
              for (let x = margin; x < w - margin; x++) {
                const sIdx = y * w + x;
                if (visited[sIdx]) continue;
                const val = nms[sIdx];
                let seedThresh, followThresh;
                if (mode === 1) {
                  const tx = Math.min(GRID_X - 1, Math.floor((x * GRID_X) / w));
                  const tIdx = ty * GRID_X + tx;
                  seedThresh = tileSeed[tIdx];
                  followThresh = tileFollow[tIdx];
                } else if (mode === 2) {
                  seedThresh = 21 * 8;
                  followThresh = 9 * 8;
                } else {
                  seedThresh = hiThresh;
                  followThresh = loThresh;
                }
                if (val < seedThresh) continue;

                visited[sIdx] = 1;
                const fwd = traceHalf(x, y, 0, 0, followThresh, fwdX, fwdY);
                let rev = { len: 0, energy: 0 };
                if (fwd.len > 0) {
                  const initDx = x - fwdX[0];
                  const initDy = y - fwdY[0];
                  rev = traceHalf(x, y, initDx, initDy, followThresh, revX, revY);
                }

                const totalLen = rev.len + 1 + fwd.len;
                const totalEnergy = val + fwd.energy + rev.energy;
                const avgEnergy = totalEnergy / totalLen;

                // Mode 2 mines long coherent low-contrast curves (white-on-snow silhouettes, soft jawlines) while ignoring short grain
                if (mode === 2) {
                  if (totalLen < 18) continue;
                } else {
                  const crispDotFloor = Math.max(48 * 8, hiThresh * 0.50);
                  const minLen = (avgEnergy >= crispDotFloor) ? 3 : 6;
                  if (totalLen < minLen) continue;
                }

                let p = 0;
                for (let i = rev.len - 1; i >= 0; i--) { chainX[p] = revX[i]; chainY[p] = revY[i]; p++; }
                chainX[p] = x; chainY[p] = y; p++;
                for (let i = 0; i < fwd.len; i++) { chainX[p] = fwdX[i]; chainY[p] = fwdY[i]; p++; }

                smX[0] = chainX[0]; smY[0] = chainY[0];
                smX[totalLen - 1] = chainX[totalLen - 1]; smY[totalLen - 1] = chainY[totalLen - 1];
                for (let i = 1; i < totalLen - 1; i++) {
                  smX[i] = 0.25 * chainX[i - 1] + 0.5 * chainX[i] + 0.25 * chainX[i + 1];
                  smY[i] = 0.25 * chainY[i - 1] + 0.5 * chainY[i] + 0.25 * chainY[i + 1];
                }

                const flatPx = simplifyChainRDPFlat(smX, smY, totalLen, 0.68);
                const vertCount = flatPx.length / 2;
                if (vertCount < 2) continue;

                for (let i = 0; i < flatPx.length; i += 2) {
                  flatPx[i] /= w;
                  flatPx[i + 1] /= h;
                }
                const midIdx = Math.floor(vertCount / 2) * 2;
                const nx = flatPx[midIdx];
                const ny = flatPx[midIdx + 1];
                const distSq = (nx - 0.5) * (nx - 0.5) * 1.3 + (ny - 0.45) * (ny - 0.45) * 1.4;
                const gentleBias = 0.68 + 0.70 * Math.exp(-distSq / 0.22);
                const eyeFocusBoost = (nx >= 0.34 && nx <= 0.66 && ny >= 0.32 && ny <= 0.60 && totalLen <= 18) ? 1.38 : 1.0;
                flatPx.w = Math.max(0.18, Math.min(1, avgEnergy / Math.max(1, hiThresh * 1.45)));

                const cTx = Math.min(GRID_X - 1, Math.floor(nx * GRID_X));
                const cTy = Math.min(GRID_Y - 1, Math.floor(ny * GRID_Y));
                candidates.push({
                  pts: flatPx,
                  score: avgEnergy * Math.pow(totalLen, 0.72) * gentleBias * eyeFocusBoost,
                  distCenter: Math.hypot(nx - 0.5, ny - 0.43),
                  cell: cTy * GRID_X + cTx
                });
              }
            }
          }

          collectPass(0);
          collectPass(1);
          collectPass(2);

          candidates.sort((a, b) => b.score - a.score);
          const picked = [];
          const usedIdx = new Uint8Array(candidates.length);
          const cellCounts = new Int32Array(GRID_X * GRID_Y);
          const cellQuota = Math.max(12, Math.floor((maxStrokes * 0.60) / (GRID_X * GRID_Y)));

          for (let i = 0; i < candidates.length && picked.length < maxStrokes; i++) {
            const c = candidates[i];
            if (cellCounts[c.cell] < cellQuota) {
              cellCounts[c.cell]++;
              usedIdx[i] = 1;
              picked.push(c);
            }
          }
          for (let i = 0; i < candidates.length && picked.length < maxStrokes; i++) {
            if (!usedIdx[i]) picked.push(candidates[i]);
          }

          picked.sort((a, b) => a.distCenter - b.distCenter);
          for (let i = 0; i < picked.length; i++) {
            strokes.push(picked[i].pts);
          }
        }
      }
    } catch (e) {}

    if (strokes.length < 18) {
      for (let i = 0; i < 48; i++) {
        const t = i / 48;
        const bx = 0.14 + 0.72 * ((i * 37) % 100) / 100;
        const by = 0.16 + 0.68 * ((i * 53) % 100) / 100;
        const len = 0.08 + 0.14 * Math.sin(t * Math.PI);
        const ang = (i * 0.7) % Math.PI;
        const fallback = new Float32Array([
          bx, by,
          bx + Math.cos(ang) * len * 0.5, by + Math.sin(ang) * len * 0.5 - 0.03,
          bx + Math.cos(ang) * len, by + Math.sin(ang) * len
        ]);
        fallback.w = 0.65;
        strokes.push(fallback);
      }
    }
    return strokes;
  }

  function createBloomSeeds() {
    const baseRegions = [
      [54, 42], [26, 28], [74, 66], [24, 72],
      [76, 26], [46, 74], [16, 46], [84, 48]
    ];
    return baseRegions.map(([bx, by], idx) => ({
      x: Math.max(10, Math.min(90, bx + (Math.random() - 0.5) * 14)),
      y: Math.max(10, Math.min(90, by + (Math.random() - 0.5) * 14)),
      delay: idx === 0 ? 0 : idx < 3 ? 0.1 + idx * 0.1 : 0.28 + (idx - 3) * 0.08,
      speed: 0.95 + Math.random() * 0.2
    }));
  }

  function clearRevealRaf() {
    if (window.__AGY_REVEAL_RAF__) {
      cancelAnimationFrame(window.__AGY_REVEAL_RAF__);
      window.__AGY_REVEAL_RAF__ = null;
    }
    if (typeof window.__AGY_REVEAL_CLEANUP__ === 'function') {
      try { window.__AGY_REVEAL_CLEANUP__(); } catch (e) {}
      window.__AGY_REVEAL_CLEANUP__ = null;
    }
    document.querySelectorAll('.agy-shell.agy-revealing').forEach((el) => el.classList.remove('agy-revealing'));
  }

  function triggerSketchBloomReveal(instant = false) {
    clearRevealRaf();
    const st = getState();
    const layer = document.getElementById('agy-live-bg-layer');
    const mediaWrap = document.getElementById('agy-live-media-wrap');
    const canvas = document.getElementById('agy-sketch-reveal-canvas');
    const videoEl = document.getElementById('agy-live-bg-video');
    const imgEl = document.getElementById('agy-live-bg-img');
    if (!layer || !mediaWrap || !canvas) return;

    const isVideoMode = st.wpMode === 'video';
    if (!st.wpEnabled) {
      canvas.width = 0;
      canvas.height = 0;
      canvas.style.display = 'none';
      layer.classList.add('agy-bg-hidden');
      return;
    }

    if (instant || !st.sketchReveal) {
      canvas.width = 0;
      canvas.height = 0;
      canvas.style.display = 'none';
      mediaWrap.style.webkitMaskImage = 'none';
      mediaWrap.style.maskImage = 'none';
      layer.style.background = 'transparent';
      if (isVideoMode && videoEl && videoEl.getAttribute('data-src')) {
        layer.classList.remove('agy-bg-hidden');
        if (videoEl.paused && videoEl.src) {
          videoEl.play().catch(() => {});
        }
      } else {
        layer.classList.add('agy-bg-hidden');
      }
      return;
    }

    const shell = findActiveShell();
    if (shell) shell.classList.add('agy-revealing');
    layer.classList.remove('agy-bg-hidden');
    layer.style.background = '#06080e';
    canvas.style.display = 'block';
    const rect = (shell || layer).getBoundingClientRect();
    const dpr = Math.min(1.25, window.devicePixelRatio || 1);
    const cw = Math.max(320, Math.round((rect.width || window.innerWidth) * dpr));
    const ch = Math.max(240, Math.round((rect.height || window.innerHeight) * dpr));
    if (canvas.width !== cw || canvas.height !== ch) {
      canvas.width = cw;
      canvas.height = ch;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Pick live frame or static image for contour extraction with exact cover-crop matching
    const activeMedia = (isVideoMode && videoEl && videoEl.readyState >= 2)
      ? videoEl
      : (imgEl && imgEl.complete && imgEl.naturalWidth > 0 ? imgEl : null);
    const objPos = activeMedia ? (getComputedStyle(activeMedia).objectPosition || '50% 50%') : '50% 50%';
    let strokes = activeMedia ? extractStrokesJS(activeMedia, rect.width || window.innerWidth, rect.height || window.innerHeight, objPos, 1380) : extractStrokesJS({});
    const seeds = createBloomSeeds();

    let cacheCanvas = document.createElement('canvas');
    cacheCanvas.width = cw;
    cacheCanvas.height = ch;
    let cacheCtx = cacheCanvas.getContext('2d');
    if (cacheCtx) {
      cacheCtx.fillStyle = '#06080e';
      cacheCtx.fillRect(0, 0, cw, ch);
      cacheCtx.lineCap = 'round';
      cacheCtx.lineJoin = 'round';
    }
    let drawnSettled = 0;
    let fullCacheReady = false;

    window.__AGY_REVEAL_CLEANUP__ = () => {
      strokes = null;
      if (cacheCanvas) {
        cacheCanvas.width = 0;
        cacheCanvas.height = 0;
        cacheCanvas = null;
        cacheCtx = null;
      }
      if (canvas) {
        canvas.width = 0;
        canvas.height = 0;
        canvas.style.display = 'none';
      }
    };

    mediaWrap.style.webkitMaskImage = 'none';
    mediaWrap.style.maskImage = 'none';
    if (isVideoMode && videoEl && videoEl.paused && videoEl.src) {
      videoEl.play().catch(() => {});
    }

    const sketchDur = 2100;
    const bloomDur = 2150;
    const start = performance.now();

    function strokeOnePath(targetCtx, pts, wFactor, isFresh) {
      if (!pts || pts.length < 4) return;
      const vertCount = pts.length >> 1;
      const alpha = isFresh ? 0.98 : (0.52 + 0.40 * wFactor);
      targetCtx.strokeStyle = isFresh ? `rgba(243, 232, 255, ${alpha})` : `rgba(216, 180, 254, ${alpha.toFixed(2)})`;
      targetCtx.lineWidth = (0.64 + 0.78 * wFactor) * dpr;
      targetCtx.beginPath();
      targetCtx.moveTo(pts[0] * cw, pts[1] * ch);
      if (vertCount === 2) {
        targetCtx.lineTo(pts[2] * cw, pts[3] * ch);
      } else {
        for (let k = 1; k < vertCount - 1; k++) {
          const xk = pts[k * 2] * cw;
          const yk = pts[k * 2 + 1] * ch;
          const mx = (xk + pts[k * 2 + 2] * cw) * 0.5;
          const my = (yk + pts[k * 2 + 3] * ch) * 0.5;
          targetCtx.quadraticCurveTo(xk, yk, mx, my);
        }
        const lastOff = (vertCount - 1) * 2;
        targetCtx.lineTo(pts[lastOff] * cw, pts[lastOff + 1] * ch);
      }
      targetCtx.stroke();
    }

    function drawStrokesProgress(p) {
      const total = strokes ? strokes.length : 0;
      const count = p >= 1 ? total : Math.max(1, Math.floor(total * p));
      if (cacheCtx && cacheCanvas) {
        if (p >= 1) {
          if (!fullCacheReady && strokes) {
            for (let i = drawnSettled; i < total; i++) {
              const pts = strokes[i];
              const wFactor = (pts && typeof pts.w === 'number') ? pts.w : 0.6;
              strokeOnePath(cacheCtx, pts, wFactor, false);
            }
            drawnSettled = total;
            fullCacheReady = true;
          }
          ctx.clearRect(0, 0, cw, ch);
          ctx.drawImage(cacheCanvas, 0, 0);
          return;
        }
        if (!strokes) return;
        const settleLimit = Math.max(0, count - 18);
        while (drawnSettled < settleLimit) {
          const pts = strokes[drawnSettled];
          const wFactor = (pts && typeof pts.w === 'number') ? pts.w : 0.6;
          strokeOnePath(cacheCtx, pts, wFactor, false);
          drawnSettled++;
        }
        ctx.clearRect(0, 0, cw, ch);
        ctx.drawImage(cacheCanvas, 0, 0);
        ctx.save();
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        for (let i = drawnSettled; i < count; i++) {
          const pts = strokes[i];
          const wFactor = (pts && typeof pts.w === 'number') ? pts.w : 0.6;
          strokeOnePath(ctx, pts, wFactor, true);
        }
        ctx.restore();
        return;
      }

      ctx.clearRect(0, 0, cw, ch);
      ctx.fillStyle = '#06080e';
      ctx.fillRect(0, 0, cw, ch);
      if (!strokes) return;
      ctx.save();
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      for (let i = 0; i < count; i++) {
        const pts = strokes[i];
        const wFactor = (pts && typeof pts.w === 'number') ? pts.w : 0.6;
        strokeOnePath(ctx, pts, wFactor, i > count - 18);
      }
      ctx.restore();
    }

    function applySeedBloom(bp) {
      const diag = Math.hypot(cw, ch);
      ctx.save();
      ctx.globalCompositeOperation = 'destination-out';
      for (let i = 0; i < seeds.length; i++) {
        const sd = seeds[i];
        const raw = (bp - sd.delay) / (1 - sd.delay);
        if (raw <= 0) continue;
        const lp = Math.min(1, raw * sd.speed);
        const eased = lp < 0.5 ? 2 * lp * lp : 1 - Math.pow(-2 * lp + 2, 2) / 2;
        const rad = eased * diag * 0.46;
        const cx = (sd.x / 100) * cw;
        const cy = (sd.y / 100) * ch;
        const g = ctx.createRadialGradient(cx, cy, Math.max(0, rad * 0.45), cx, cy, Math.max(1, rad));
        g.addColorStop(0, 'rgba(0,0,0,1)');
        g.addColorStop(0.7, 'rgba(0,0,0,0.85)');
        g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(cx, cy, rad, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }

    drawStrokesProgress(0.01);

    function step(now) {
      const elapsed = now - start;
      if (elapsed <= sketchDur) {
        drawStrokesProgress(Math.min(1, elapsed / sketchDur));
      } else {
        const bp = Math.min(1, (elapsed - sketchDur) / bloomDur);
        drawStrokesProgress(1);
        if (fullCacheReady) strokes = null;
        applySeedBloom(bp);
      }
      if (elapsed < sketchDur + bloomDur) {
        window.__AGY_REVEAL_RAF__ = requestAnimationFrame(step);
      } else {
        window.__AGY_REVEAL_RAF__ = null;
        document.querySelectorAll('.agy-shell.agy-revealing').forEach((el) => el.classList.remove('agy-revealing'));
        if (typeof window.__AGY_REVEAL_CLEANUP__ === 'function') {
          try { window.__AGY_REVEAL_CLEANUP__(); } catch (e) {}
          window.__AGY_REVEAL_CLEANUP__ = null;
        }
        mediaWrap.style.webkitMaskImage = 'none';
        mediaWrap.style.maskImage = 'none';
        layer.style.background = 'transparent';
        if (!isVideoMode || !videoEl || !videoEl.getAttribute('data-src')) {
          layer.classList.add('agy-bg-hidden');
        }
      }
    }

    window.__AGY_REVEAL_RAF__ = requestAnimationFrame(step);
  }
  window.__ANTIGRAVITY_REPLAY_REVEAL__ = () => triggerSketchBloomReveal(false);

  function scheduleRevealWhenReady(allowInstant = false) {
    window.__AGY_BOOT_FINISHED__ = true;
    nudgeComposerLayout();
    const shell = findActiveShell();
    if (shell) {
      const liveLayer = document.getElementById('agy-live-bg-layer');
      if (!liveLayer || liveLayer.tagName !== 'AGY-LIVE-BG' || liveLayer.parentElement !== shell) {
        applyTheme();
      }
    }
    const st = getState();
    const shouldInstant = allowInstant || !st.sketchReveal;
    if (shouldInstant) {
      window.__AGY_REVEAL_DONE_ONCE__ = true;
      triggerSketchBloomReveal(true);
      return;
    }
    const vidEl = document.getElementById('agy-live-bg-video');
    const imgEl = document.getElementById('agy-live-bg-img');
    const isVideoMode = st.wpMode === 'video' && Boolean(vidEl && vidEl.getAttribute('data-src'));
    if (isVideoMode && vidEl && vidEl.readyState < 2) {
      let fired = false;
      const fire = () => {
        if (fired) return;
        fired = true;
        window.__AGY_REVEAL_DONE_ONCE__ = true;
        triggerSketchBloomReveal(false);
      };
      vidEl.addEventListener('loadeddata', fire, { once: true });
      setTimeout(fire, 650);
    } else if (!isVideoMode && imgEl && imgEl.getAttribute('data-src') && !imgEl.complete) {
      let fired = false;
      const fire = () => {
        if (fired) return;
        fired = true;
        window.__AGY_REVEAL_DONE_ONCE__ = true;
        triggerSketchBloomReveal(false);
      };
      imgEl.addEventListener('load', fire, { once: true });
      setTimeout(fire, 500);
    } else {
      window.__AGY_REVEAL_DONE_ONCE__ = true;
      triggerSketchBloomReveal(false);
    }
  }

  function releaseVideoDecoder(videoEl) {
    if (!videoEl) return;
    videoEl.pause();
    videoEl.style.opacity = '0';
    videoEl.style.display = 'none';
    if (videoEl.getAttribute('src') || videoEl.getAttribute('data-src')) {
      videoEl.removeAttribute('src');
      videoEl.removeAttribute('data-src');
      videoEl.removeAttribute('poster');
      videoEl.load();
    }
  }

  function syncVideoAndRevealLayer(st, mainTheme, wpImageUrl, wpVideoUrl, isVideoMode, overlayRgb, overlayAlpha, bgPosition, blurStr) {
    const shell = findActiveShell();
    if (!shell) return;

    let layer = document.getElementById('agy-live-bg-layer');
    if (layer && (layer.tagName !== 'AGY-LIVE-BG' || layer.parentElement !== shell)) {
      layer.remove();
      layer = null;
    }
    if (!st.wpEnabled) {
      clearRevealRaf();
      releaseVideoDecoder(document.getElementById('agy-live-bg-video'));
      if (layer) layer.classList.add('agy-bg-hidden');
      return;
    }

    if (!layer) {
      layer = document.createElement('agy-live-bg');
      layer.id = 'agy-live-bg-layer';
      layer.style.cssText = 'display:block;position:absolute;inset:0;width:100%;height:100%;z-index:0;pointer-events:none;overflow:hidden;background:transparent;';
      layer.innerHTML = `
        <div id="agy-live-media-wrap" style="position:absolute;inset:0;overflow:hidden;">
          <video id="agy-live-bg-video" autoplay muted loop playsinline style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:none;opacity:0;transition:opacity 0.3s ease;"></video>
          <img id="agy-live-bg-img" alt="" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:none;" />
          <div id="agy-live-scrim" style="position:absolute;inset:0;pointer-events:none;z-index:2;opacity:0;transition:opacity 0.25s ease;"></div>
        </div>
        <canvas id="agy-sketch-reveal-canvas" style="position:absolute;inset:0;width:100%;height:100%;z-index:3;pointer-events:none;display:none;"></canvas>
      `;
      shell.insertBefore(layer, shell.firstChild);
    }

    const mediaWrap = document.getElementById('agy-live-media-wrap');
    const videoEl = document.getElementById('agy-live-bg-video');
    const imgEl = document.getElementById('agy-live-bg-img');
    const scrimEl = document.getElementById('agy-live-scrim');

    const secondaryGlowStop = mainTheme.secondaryGlow
      ? `, radial-gradient(circle at 22% 72%, ${mainTheme.secondaryGlow} 0%, transparent 55%)`
      : '';
    scrimEl.style.background = mainTheme.clearBackdrop
      ? `linear-gradient(180deg, rgba(${overlayRgb}, ${overlayAlpha}) 0%, rgba(${overlayRgb}, ${overlayAlpha}) 100%)`
      : `radial-gradient(circle at 75% 40%, ${mainTheme.glow} 0%, transparent 65%)${secondaryGlowStop}, linear-gradient(180deg, rgba(${overlayRgb}, ${overlayAlpha * 0.85}) 0%, rgba(${overlayRgb}, ${overlayAlpha}) 100%)`;

    if (videoEl) {
      videoEl.style.objectPosition = bgPosition || 'center center';
    }
    if (imgEl) {
      imgEl.style.objectPosition = bgPosition || 'center center';
    }

    if (isVideoMode && wpVideoUrl) {
      layer.classList.remove('agy-bg-hidden');
      if (imgEl) imgEl.style.display = 'none';
      if (videoEl) {
        videoEl.style.display = 'block';
        if (!/^(?:data|blob|file):/i.test(wpVideoUrl)) {
          videoEl.crossOrigin = 'anonymous';
        } else {
          videoEl.removeAttribute('crossorigin');
        }
        if (!st.customVideo && wpImageUrl) {
          videoEl.poster = wpImageUrl;
        } else {
          videoEl.removeAttribute('poster');
        }
        const markVideoReady = () => {
          videoEl.style.opacity = '1';
          if (scrimEl) scrimEl.style.opacity = '1';
        };
        if (videoEl.readyState >= 2) {
          markVideoReady();
        }
        if (videoEl.getAttribute('data-src') !== wpVideoUrl) {
          videoEl.removeAttribute('data-fallback-tried');
          videoEl.style.opacity = '0';
          if (scrimEl) scrimEl.style.opacity = '0';
          videoEl.setAttribute('data-src', wpVideoUrl);
          videoEl.onloadeddata = () => {
            markVideoReady();
            if (!wpImageUrl || Boolean(st.customVideo)) {
              try {
                const c = document.createElement('canvas');
                c.width = 480;
                c.height = Math.max(240, Math.round(480 * ((videoEl.videoHeight || 1080) / Math.max(1, videoEl.videoWidth || 1920))));
                const gctx = c.getContext('2d');
                if (gctx) {
                  gctx.drawImage(videoEl, 0, 0, c.width, c.height);
                  const frameUrl = c.toDataURL('image/webp', 0.82);
                  syncPrebakedGlass(frameUrl, overlayRgb, overlayAlpha, mainTheme.headerBg || '', blurStr);
                }
              } catch (e) {}
            }
          };
          videoEl.onplaying = markVideoReady;
          videoEl.onerror = () => {
            const fallbackVid = resolveMediaUrl(mainTheme.wallpaperVideo || '');
            if (fallbackVid && wpVideoUrl !== fallbackVid && !videoEl.getAttribute('data-fallback-tried')) {
              videoEl.setAttribute('data-fallback-tried', '1');
              videoEl.removeAttribute('crossorigin');
              videoEl.setAttribute('data-src', fallbackVid);
              videoEl.src = fallbackVid;
              videoEl.load();
              videoEl.play().catch(() => {});
              return;
            }
            videoEl.style.opacity = '0';
            if (scrimEl) scrimEl.style.opacity = '0';
          };
          videoEl.src = wpVideoUrl;
          videoEl.load();
          videoEl.play().catch(() => {});
        } else if (videoEl.paused) {
          videoEl.play().catch(() => {});
        }
      }
      if (!window.__AGY_REVEAL_DONE_ONCE__ && (!st.bootIntro || window.__AGY_BOOT_FINISHED__)) {
        scheduleRevealWhenReady(false);
      } else if (!window.__AGY_REVEAL_RAF__ && mediaWrap) {
        mediaWrap.style.webkitMaskImage = 'none';
        mediaWrap.style.maskImage = 'none';
      }
    } else {
      if (scrimEl) scrimEl.style.opacity = '0';
      releaseVideoDecoder(videoEl);
      if (imgEl && wpImageUrl) {
        if (!/^(?:data|blob|file):/i.test(wpImageUrl)) {
          imgEl.crossOrigin = 'anonymous';
        } else {
          imgEl.removeAttribute('crossorigin');
        }
        imgEl.style.display = 'block';
        if (imgEl.getAttribute('data-src') !== wpImageUrl) {
          imgEl.setAttribute('data-src', wpImageUrl);
          imgEl.src = wpImageUrl;
        }
      }
      if (!window.__AGY_REVEAL_DONE_ONCE__ && (!st.bootIntro || window.__AGY_BOOT_FINISHED__)) {
        scheduleRevealWhenReady(false);
      } else if (!window.__AGY_REVEAL_RAF__) {
        layer.classList.add('agy-bg-hidden');
      }
    }
  }

  // ==================== MONOCHROME STARFIELD BOOT HUD + ARISU-TAWA VOICE ====================
  function clearBootTimers() {
    if (Array.isArray(window.__AGY_BOOT_TIMERS__)) {
      window.__AGY_BOOT_TIMERS__.forEach((id) => clearTimeout(id));
    }
    window.__AGY_BOOT_TIMERS__ = [];
    if (window.__AGY_BOOT_CLOCK__) {
      clearInterval(window.__AGY_BOOT_CLOCK__);
      window.__AGY_BOOT_CLOCK__ = null;
    }
    if (window.__AGY_BOOT_HEX__) {
      clearInterval(window.__AGY_BOOT_HEX__);
      window.__AGY_BOOT_HEX__ = null;
    }
    if (window.__AGY_BOOT_KEYDOWN__) {
      window.removeEventListener('keydown', window.__AGY_BOOT_KEYDOWN__, true);
      window.__AGY_BOOT_KEYDOWN__ = null;
    }
  }

  function stopBootAudio() {
    if (window.__AGY_BOOT_AUDIO__) {
      try {
        window.__AGY_BOOT_AUDIO__.pause();
        window.__AGY_BOOT_AUDIO__.currentTime = 0;
      } catch (e) {}
      window.__AGY_BOOT_AUDIO__ = null;
    }
    try {
      if (window.speechSynthesis) window.speechSynthesis.cancel();
    } catch (e) {}
  }

  function teardownBootOverlay(internalRemount = false) {
    if (!sessionAuthenticated && !internalRemount) return;
    clearBootTimers();
    stopBootAudio();
    stopAuthCamera();
    const ov = document.getElementById('agy-boot-overlay');
    if (ov) ov.remove();
    const fl = document.getElementById('agy-flash-curtain');
    if (fl) fl.remove();
    const st = document.getElementById('agy-boot-styles');
    if (st) st.remove();
  }

  function mountBootSequence(forceReplay = false, jumpToMfa = false) {
    const st = getState();
    const mfaRequired = Boolean(serverAuthLock) && (!sessionAuthenticated || forceReplay);
    if (!forceReplay) {
      if (!HAS_VAULT_DAEMON) {
        if (!st.bootIntro || window.__AGY_BOOT_PLAYED__) return;
      } else if (sessionAuthenticated && (!st.bootIntro || closureBootCompleted)) {
        return;
      }
    }
    window.__AGY_BOOT_PLAYED__ = true;
    closureBootCompleted = true;

    if (mfaRequired && HAS_VAULT_DAEMON) {
      sessionAuthenticated = false;
      enforceWorkspaceLock();
    }

    ensureGreetingFonts();
    isMountingBootOverlay = true;
    teardownBootOverlay(true);

    const activeTh = THEMES[st.themeName] || THEMES[DEFAULT_THEME_KEY] || {};
    const bgArtUrl = sanitizeCssUrl(resolveMediaUrl(st.customWp || activeTh.wallpaper || '') || BOOT_ASSETS.starfieldBg || resolveMediaUrl('assets/starfield-boot-bg.jpg'));
    const iconColorUrl = BOOT_ASSETS.agyColorIcon || resolveMediaUrl('assets/agy-icon-color.png');
    const avatarUrl = sanitizeCssUrl(st.userAvatar && st.userAvatar !== 'none' ? st.userAvatar : (activeTh.userAvatar || iconColorUrl));
    const voiceUrls = {
      1: BOOT_ASSETS.voice1 || resolveMediaUrl('assets/voice/cyber_voice1.mp3'),
      2: BOOT_ASSETS.voice2 || resolveMediaUrl('assets/voice/cyber_voice2.mp3'),
      3: BOOT_ASSETS.voice3 || resolveMediaUrl('assets/voice/cyber_voice3.mp3'),
      4: BOOT_ASSETS.voice4 || resolveMediaUrl('assets/voice/cyber_voice4.mp3')
    };

    const bootStyle = document.createElement('style');
    bootStyle.id = 'agy-boot-styles';
    bootStyle.textContent = `
      #agy-boot-overlay {
        position: fixed;
        inset: 0;
        z-index: 2147483000;
        background: #06050b;
        display: flex;
        flex-direction: column;
        justify-content: space-between;
        padding: 44px 48px 34px;
        font-family: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI Variable Display', 'Segoe UI', sans-serif;
        color: #fafafa;
        overflow: hidden;
        transition: opacity 0.62s cubic-bezier(0.22, 1, 0.36, 1);
        user-select: none;
        -webkit-font-smoothing: antialiased;
      }
      #agy-boot-overlay.done { opacity: 0; pointer-events: none; }
      #agy-boot-overlay.done.instant { display: none; transition: none; }

      #agy-boot-overlay .agy-boot-art {
        position: absolute;
        inset: 0;
        z-index: 0;
        background: url("${bgArtUrl}") center center / cover no-repeat;
        opacity: 0;
        transform: scale(1.045);
        transition: opacity 1.1s ease, transform 6.5s cubic-bezier(0.16, 1, 0.3, 1);
        pointer-events: none;
      }
      #agy-boot-overlay.hud-mode .agy-boot-art {
        opacity: 0.34;
        transform: scale(1);
      }
      #agy-boot-overlay .agy-boot-vignette {
        position: absolute;
        inset: 0;
        z-index: 1;
        background:
          radial-gradient(circle at 50% 44%, rgba(139, 92, 246, 0.14) 0%, rgba(10, 8, 18, 0.72) 56%, rgba(5, 4, 10, 0.95) 100%),
          linear-gradient(180deg, rgba(6, 5, 11, 0.55) 0%, rgba(6, 5, 11, 0.25) 50%, rgba(6, 5, 11, 0.82) 100%);
        pointer-events: none;
      }
      #agy-boot-overlay .agy-boot-grid {
        position: absolute;
        inset: 0;
        z-index: 1;
        background-image:
          linear-gradient(to right, rgba(255, 255, 255, 0.028) 1px, transparent 1px),
          linear-gradient(to bottom, rgba(255, 255, 255, 0.028) 1px, transparent 1px);
        background-size: 64px 64px;
        mask-image: radial-gradient(circle at 50% 48%, rgba(0,0,0,0.85) 0%, transparent 72%);
        -webkit-mask-image: radial-gradient(circle at 50% 48%, rgba(0,0,0,0.85) 0%, transparent 72%);
        pointer-events: none;
      }

      #agy-flash-curtain {
        position: fixed;
        inset: 0;
        z-index: 2147483001;
        pointer-events: none;
        opacity: 0;
        background: radial-gradient(circle at 50% 50%, rgba(243, 232, 255, 0.72) 0%, rgba(168, 85, 247, 0.28) 52%, transparent 100%);
      }
      #agy-flash-curtain.burst { animation: agyFlashBurst 0.95s cubic-bezier(0.22, 1, 0.36, 1) forwards; }
      @keyframes agyFlashBurst { 0% { opacity: 0; } 24% { opacity: 0.85; } 100% { opacity: 0; } }

      #agy-boot-overlay .agy-boot-header,
      #agy-boot-overlay .agy-boot-footer {
        position: relative;
        z-index: 5;
        display: flex;
        justify-content: space-between;
        align-items: center;
        opacity: 0;
        transition: opacity 0.45s ease;
      }
      #agy-boot-overlay.hud-mode .agy-boot-header,
      #agy-boot-overlay.hud-mode .agy-boot-footer { opacity: 1; }

      #agy-boot-overlay .agy-brand-row {
        display: flex;
        align-items: center;
        gap: 12px;
      }
      #agy-boot-overlay .agy-brand-row img {
        width: 26px;
        height: 26px;
        object-fit: contain;
      }
      #agy-boot-overlay .agy-brand-name {
        font-size: 16.5px;
        font-weight: 700;
        letter-spacing: -0.02em;
        color: #ffffff;
      }
      #agy-boot-overlay .agy-brand-tag {
        font-size: 12.5px;
        font-weight: 600;
        color: #d8b4fe;
        background: rgba(168, 85, 247, 0.14);
        border: 1px solid rgba(192, 132, 252, 0.26);
        padding: 3px 10px;
        border-radius: 999px;
      }

      #agy-boot-overlay .agy-boot-skip {
        cursor: pointer;
        background: rgba(255, 255, 255, 0.05);
        border: 1px solid rgba(255, 255, 255, 0.10);
        color: #d4d4d8;
        padding: 7px 15px;
        border-radius: 999px;
        font-family: inherit;
        font-size: 13.5px;
        font-weight: 500;
        transition: background 0.18s ease, color 0.18s ease, border-color 0.18s ease;
      }
      #agy-boot-overlay .agy-boot-skip:hover {
        background: rgba(255, 255, 255, 0.11);
        border-color: rgba(255, 255, 255, 0.24);
        color: #ffffff;
      }

      #agy-boot-overlay .agy-boot-stage-wrap {
        position: relative;
        z-index: 5;
        flex: 1;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      #agy-boot-overlay .agy-boot-stage {
        display: none;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        width: 100%;
        animation: agyStageEnter 0.42s cubic-bezier(0.16, 1, 0.3, 1) forwards;
      }
      #agy-boot-overlay .agy-boot-stage.active { display: flex; }
      @keyframes agyStageEnter {
        from { opacity: 0; transform: translateY(12px) scale(0.985); }
        to { opacity: 1; transform: translateY(0) scale(1); }
      }
      #agy-boot-overlay .wipe-out {
        opacity: 0 !important;
        transform: translateY(-8px) scale(0.99) !important;
        transition: opacity 0.22s ease, transform 0.22s ease !important;
      }

      /* Stage 0: Crisp Editorial Brand Opening */
      #agy-boot-overlay .agy-splash-logo {
        width: 78px;
        height: 78px;
        object-fit: contain;
        margin-bottom: 20px;
        filter: drop-shadow(0 8px 28px rgba(168, 85, 247, 0.35));
        animation: agySplashFade 1.8s cubic-bezier(0.16, 1, 0.3, 1) forwards;
      }
      #agy-boot-overlay .agy-splash-wordmark {
        font-size: 34px;
        font-weight: 700;
        letter-spacing: -0.03em;
        color: #ffffff;
        margin-bottom: 8px;
        animation: agySplashFade 1.8s cubic-bezier(0.16, 1, 0.3, 1) 0.06s both;
      }
      #agy-boot-overlay .agy-splash-caption {
        font-size: 15.5px;
        font-weight: 500;
        color: #a1a1aa;
        letter-spacing: -0.005em;
        animation: agySplashFade 1.8s cubic-bezier(0.16, 1, 0.3, 1) 0.12s both;
      }
      @keyframes agySplashFade {
        0% { opacity: 0; transform: translateY(8px) scale(0.97); }
        24% { opacity: 1; transform: translateY(0) scale(1); }
        80% { opacity: 1; transform: translateY(0) scale(1); }
        100% { opacity: 0; transform: translateY(-4px) scale(1.01); }
      }

      /* Architectural Glass Dialog Card (Stage 1 & Stage 2) */
      #agy-boot-overlay .agy-dialog-card {
        width: min(540px, 92vw);
        background: linear-gradient(165deg, rgba(22, 17, 35, 0.88) 0%, rgba(11, 9, 19, 0.94) 100%);
        border: 1px solid rgba(255, 255, 255, 0.09);
        box-shadow:
          inset 0 1px 0 rgba(243, 232, 255, 0.22),
          0 32px 80px rgba(0, 0, 0, 0.72),
          0 0 48px rgba(147, 51, 234, 0.12);
        border-radius: 22px;
        padding: 38px 42px;
        text-align: left;
        box-sizing: border-box;
      }
      #agy-boot-overlay .agy-status-chip {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        font-size: 13.5px;
        font-weight: 600;
        color: #e9d5ff;
        margin-bottom: 14px;
      }
      #agy-boot-overlay .agy-status-dot {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background: #c084fc;
        box-shadow: 0 0 10px rgba(192, 132, 252, 0.9);
      }
      #agy-boot-overlay .agy-card-heading {
        font-size: 30px;
        font-weight: 700;
        letter-spacing: -0.025em;
        line-height: 1.24;
        color: #ffffff;
        margin: 0 0 10px;
      }
      #agy-boot-overlay .agy-card-desc {
        font-size: 16px;
        font-weight: 400;
        line-height: 1.6;
        color: #a1a1aa;
        margin: 0 0 28px;
      }

      /* Profile Identity Header & Spec Surface */
      #agy-boot-overlay .agy-profile-head {
        display: flex;
        align-items: center;
        gap: 16px;
        margin-bottom: 24px;
      }
      #agy-boot-overlay .agy-profile-avatar {
        width: 54px;
        height: 54px;
        border-radius: 50%;
        background: url("${avatarUrl}") center center / cover no-repeat;
        border: 1.5px solid rgba(216, 180, 254, 0.55);
        box-shadow: 0 4px 16px rgba(147, 51, 234, 0.28);
        flex-shrink: 0;
      }
      #agy-boot-overlay .agy-profile-eyebrow {
        font-size: 13.5px;
        font-weight: 600;
        color: #c084fc;
        margin-bottom: 3px;
      }
      #agy-boot-overlay .agy-spec-box {
        background: rgba(255, 255, 255, 0.035);
        border: 1px solid rgba(255, 255, 255, 0.085);
        border-radius: 16px;
        overflow: hidden;
        margin-bottom: 28px;
      }
      #agy-boot-overlay .agy-spec-row {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 16px;
        padding: 17px 22px;
      }
      #agy-boot-overlay .agy-spec-row + .agy-spec-row {
        border-top: 1px solid rgba(255, 255, 255, 0.065);
      }
      #agy-boot-overlay .agy-spec-label {
        font-size: 15.5px;
        font-weight: 500;
        color: #a1a1aa;
        white-space: nowrap;
      }
      #agy-boot-overlay .agy-spec-value-name {
        font-size: 19.5px;
        font-weight: 700;
        letter-spacing: -0.015em;
        color: #ffffff;
        text-align: right;
      }
      #agy-boot-overlay .agy-spec-value-code {
        font-family: 'JetBrains Mono', 'Cascadia Code', Consolas, monospace;
        font-size: 13.5px;
        font-weight: 600;
        letter-spacing: 0.02em;
        color: #f3e8ff;
        background: rgba(168, 85, 247, 0.16);
        border: 1px solid rgba(192, 132, 252, 0.32);
        padding: 6px 12px;
        border-radius: 9px;
        text-align: right;
      }

      /* Tactile Metallic Amethyst Primary CTA */
      #agy-boot-overlay .agy-primary-btn {
        width: 100%;
        height: 52px;
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 0 20px 0 22px;
        border-radius: 14px;
        cursor: pointer;
        border: 1px solid rgba(233, 213, 255, 0.34);
        background: linear-gradient(135deg, #9333ea 0%, #7e22ce 55%, #6b21a8 100%);
        box-shadow:
          inset 0 1px 0 rgba(255, 255, 255, 0.28),
          0 10px 24px rgba(126, 34, 206, 0.38);
        color: #ffffff;
        font-family: inherit;
        font-size: 16px;
        font-weight: 600;
        letter-spacing: -0.01em;
        transition: transform 0.16s ease, box-shadow 0.16s ease, filter 0.16s ease;
      }
      #agy-boot-overlay .agy-primary-btn:hover {
        filter: brightness(1.08);
        transform: translateY(-1px);
        box-shadow:
          inset 0 1px 0 rgba(255, 255, 255, 0.36),
          0 14px 30px rgba(147, 51, 234, 0.5);
      }
      #agy-boot-overlay .agy-primary-btn:active,
      #agy-boot-overlay .agy-primary-btn.triggered {
        transform: translateY(0) scale(0.992);
        filter: brightness(1.14);
      }
      #agy-boot-overlay .agy-keycap {
        font-family: 'JetBrains Mono', 'Cascadia Code', Consolas, monospace;
        font-size: 12.5px;
        font-weight: 600;
        color: #f3e8ff;
        background: rgba(255, 255, 255, 0.16);
        border: 1px solid rgba(255, 255, 255, 0.20);
        padding: 4px 10px;
        border-radius: 8px;
      }

      /* Stage 3-5: Sleek Synchronization & Verification */
      #agy-boot-overlay .agy-sync-wrap {
        display: flex;
        flex-direction: column;
        align-items: center;
        text-align: center;
      }
      #agy-boot-overlay .agy-icon-morph-box {
        position: relative;
        width: 104px;
        height: 104px;
        margin-bottom: 24px;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      #agy-boot-overlay .agy-icon-outline-svg { position: absolute; inset: 0; width: 100%; height: 100%; transition: opacity 0.4s ease; }
      #agy-boot-overlay .agy-icon-outline-svg.fade-stroke { opacity: 0; }
      #agy-boot-overlay .agy-icon-outline-path {
        fill: none;
        stroke: url(#agyBootStrokeGrad);
        stroke-width: 3.4;
        stroke-linecap: round;
        stroke-linejoin: round;
        filter: drop-shadow(0 0 12px rgba(192, 132, 252, 0.55));
      }
      #agy-boot-overlay .agy-icon-outline-path.trace { animation: agyTraceOutline 0.85s cubic-bezier(0.35, 0.05, 0.25, 1) forwards; }
      @keyframes agyTraceOutline { to { stroke-dashoffset: 0; } }
      #agy-boot-overlay .agy-icon-color-fill {
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
        object-fit: contain;
        clip-path: inset(85% 0 0 0);
        opacity: 0;
        transition: clip-path 0.8s cubic-bezier(0.22, 1, 0.36, 1), opacity 0.15s ease, filter 0.4s ease;
      }
      #agy-boot-overlay .agy-icon-color-fill.filled {
        clip-path: inset(0 0 0 0);
        opacity: 1;
        filter: drop-shadow(0 0 22px rgba(168, 85, 247, 0.45));
      }
      #agy-boot-overlay .agy-sync-title {
        font-size: 24px;
        font-weight: 700;
        letter-spacing: -0.02em;
        color: #ffffff;
        margin-bottom: 8px;
      }
      #agy-boot-overlay .agy-sync-sub {
        font-size: 15px;
        font-weight: 500;
        color: #a1a1aa;
      }

      /* Stage 6: Rhythm-Synced Grand Hero Welcome */
      #agy-boot-overlay .agy-hero-welcome {
        display: flex;
        flex-direction: column;
        align-items: center;
        text-align: center;
      }
      #agy-boot-overlay .agy-hero-badge {
        display: inline-flex;
        align-items: center;
        gap: 10px;
        background: rgba(168, 85, 247, 0.14);
        border: 1px solid rgba(216, 180, 254, 0.30);
        padding: 7px 16px;
        border-radius: 999px;
        font-family: 'JetBrains Mono', 'Cascadia Code', Consolas, monospace;
        font-size: 12.5px;
        font-weight: 600;
        letter-spacing: 0.08em;
        color: #e9d5ff;
        margin-bottom: 22px;
      }
      #agy-boot-overlay .agy-hero-title {
        font-size: clamp(36px, 4.2vw, 48px);
        font-weight: 700;
        letter-spacing: -0.03em;
        line-height: 1.18;
        margin: 0 0 14px;
        background: linear-gradient(135deg, #ffffff 30%, #f3e8ff 68%, #c084fc 100%);
        -webkit-background-clip: text;
        background-clip: text;
        -webkit-text-fill-color: transparent;
      }
      #agy-boot-overlay .agy-hero-id {
        font-family: 'JetBrains Mono', 'Cascadia Code', Consolas, monospace;
        font-size: 14.5px;
        font-weight: 500;
        letter-spacing: 0.05em;
        color: #c4b5fd;
      }

      /* Footer & Clean Progress Bar */
      #agy-boot-overlay .agy-footer-meta {
        display: flex;
        align-items: center;
        gap: 10px;
        font-size: 13.5px;
        font-weight: 500;
        color: #a1a1aa;
      }
      #agy-boot-overlay .agy-footer-id {
        font-family: 'JetBrains Mono', 'Cascadia Code', Consolas, monospace;
        font-size: 12.5px;
        font-weight: 500;
        color: #71717a;
      }
      #agy-boot-overlay .agy-eq-bars {
        display: inline-flex;
        align-items: flex-end;
        gap: 2.5px;
        height: 13px;
      }
      #agy-boot-overlay .agy-eq-bars span {
        width: 2.5px;
        border-radius: 2px;
        background: linear-gradient(180deg, #e879f9, #a855f7);
        animation: agyEqPulse 0.45s ease-in-out infinite alternate;
      }
      #agy-boot-overlay .agy-eq-bars span:nth-child(2) { animation-delay: 0.12s; }
      #agy-boot-overlay .agy-eq-bars span:nth-child(3) { animation-delay: 0.24s; }
      #agy-boot-overlay .agy-eq-bars span:nth-child(4) { animation-delay: 0.08s; }
      @keyframes agyEqPulse { from { height: 4px; opacity: 0.5; } to { height: 13px; opacity: 1; } }

      #agy-boot-overlay .agy-bottom-progress-track {
        position: absolute;
        left: 50%;
        transform: translateX(-50%);
        width: min(360px, 38vw);
        height: 3px;
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.08);
        overflow: hidden;
      }
      #agy-boot-overlay .agy-bottom-progress-bar {
        width: 0%;
        height: 100%;
        border-radius: 999px;
        background: linear-gradient(90deg, #a855f7, #e879f9, #38bdf8);
        box-shadow: 0 0 12px rgba(192, 132, 252, 0.65);
        transition: width 0.5s cubic-bezier(0.22, 1, 0.36, 1);
      }

      /* 4-Method Multi-Factor Identity Hub */
      #agy-boot-overlay .agy-boot-skip.is-locked {
        cursor: default;
        color: #c084fc;
        border-color: rgba(192, 132, 252, 0.28);
        background: rgba(168, 85, 247, 0.12);
      }
      #agy-boot-overlay .agy-mfa-card {
        width: min(560px, 94vw);
        padding: 30px 36px 28px;
      }
      #agy-boot-overlay .agy-mfa-operator-bar {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 12px;
        padding: 12px 16px;
        background: rgba(255, 255, 255, 0.035);
        border: 1px solid rgba(255, 255, 255, 0.08);
        border-radius: 14px;
        margin-bottom: 18px;
      }
      #agy-boot-overlay .agy-mfa-op-left {
        display: flex;
        align-items: center;
        gap: 12px;
      }
      #agy-boot-overlay .agy-mfa-mini-av {
        width: 38px;
        height: 38px;
        border-radius: 50%;
        background: url("${avatarUrl}") center center / cover no-repeat;
        border: 1.5px solid rgba(216, 180, 254, 0.55);
        flex-shrink: 0;
      }
      #agy-boot-overlay .agy-mfa-tabs {
        display: grid;
        grid-template-columns: repeat(4, 1fr);
        gap: 5px;
        background: rgba(0, 0, 0, 0.38);
        border: 1px solid rgba(255, 255, 255, 0.08);
        border-radius: 12px;
        padding: 4px;
        margin-bottom: 22px;
      }
      #agy-boot-overlay .agy-mfa-tab {
        border: none;
        background: transparent;
        color: #a1a1aa;
        font-family: inherit;
        font-size: 13px;
        font-weight: 600;
        padding: 8px 6px;
        border-radius: 9px;
        cursor: pointer;
        transition: all 0.18s ease;
        white-space: nowrap;
      }
      #agy-boot-overlay .agy-mfa-tab:hover { color: #f4f4f5; }
      #agy-boot-overlay .agy-mfa-tab.active {
        background: linear-gradient(135deg, rgba(147, 51, 234, 0.42), rgba(107, 33, 168, 0.48));
        color: #ffffff;
        box-shadow: inset 0 1px 0 rgba(243, 232, 255, 0.25), 0 4px 12px rgba(0, 0, 0, 0.35);
      }
      #agy-boot-overlay .agy-mfa-pane {
        display: none;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        min-height: 214px;
        text-align: center;
      }
      #agy-boot-overlay .agy-mfa-pane.active { display: flex; }

      /* Method 1: Live AI Face ID Scanner */
      #agy-boot-overlay .agy-face-ring-wrap {
        position: relative;
        width: 138px;
        height: 138px;
        border-radius: 50%;
        padding: 3.5px;
        background: conic-gradient(from 0deg, #a855f7, #e879f9, #38bdf8, transparent 70%, #a855f7);
        animation: agySpinRing 2.4s linear infinite;
        margin-bottom: 14px;
        box-shadow: 0 0 32px rgba(168, 85, 247, 0.32);
      }
      #agy-boot-overlay .agy-face-ring-wrap.matched {
        background: linear-gradient(135deg, #34d399, #10b981, #a855f7);
        animation: none;
        box-shadow: 0 0 36px rgba(52, 211, 153, 0.52);
      }
      #agy-boot-overlay .agy-face-ring-wrap.denied {
        background: linear-gradient(135deg, #fb7185, #e11d48);
        animation: none;
        box-shadow: 0 0 32px rgba(244, 63, 94, 0.48);
      }
      @keyframes agySpinRing { to { transform: rotate(360deg); } }
      #agy-boot-overlay .agy-face-lens {
        position: absolute;
        inset: 3.5px;
        border-radius: 50%;
        overflow: hidden;
        background: #070510;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      /* Counter-rotate inner lens when parent ring spins? Keep ring as ::before pseudo so video never spins! */
      #agy-boot-overlay .agy-face-ring-box {
        position: relative;
        width: 140px;
        height: 140px;
        margin-bottom: 14px;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      #agy-boot-overlay .agy-face-spinner {
        position: absolute;
        inset: 0;
        border-radius: 50%;
        background: conic-gradient(from 0deg, #a855f7, #f3e8ff, #38bdf8, rgba(168,85,247,0.12) 72%, #a855f7);
        animation: agySpinRing 2.2s linear infinite;
        box-shadow: 0 0 28px rgba(168, 85, 247, 0.32);
      }
      #agy-boot-overlay .agy-face-ring-box.matched .agy-face-spinner {
        background: linear-gradient(135deg, #34d399, #10b981);
        animation: none;
        box-shadow: 0 0 34px rgba(52, 211, 153, 0.55);
      }
      #agy-boot-overlay .agy-face-ring-box.denied .agy-face-spinner {
        background: linear-gradient(135deg, #fb7185, #e11d48);
        animation: none;
        box-shadow: 0 0 30px rgba(244, 63, 94, 0.5);
      }
      #agy-boot-overlay .agy-face-viewport {
        position: relative;
        z-index: 2;
        width: 132px;
        height: 132px;
        border-radius: 50%;
        overflow: hidden;
        background: #070510;
      }
      #agy-boot-overlay #agy-face-video {
        width: 100%;
        height: 100%;
        object-fit: cover;
        transform: scaleX(-1);
        display: block;
      }
      #agy-boot-overlay #agy-face-hud-canvas {
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
        transform: scaleX(-1);
        pointer-events: none;
      }
      #agy-boot-overlay .agy-face-scanbar {
        position: absolute;
        left: 0;
        right: 0;
        height: 2px;
        background: linear-gradient(90deg, transparent, rgba(232, 121, 249, 0.9), transparent);
        box-shadow: 0 0 10px rgba(192, 132, 252, 0.85);
        animation: agyFaceSweep 1.8s ease-in-out infinite alternate;
        pointer-events: none;
      }
      @keyframes agyFaceSweep { from { top: 14%; } to { top: 86%; } }
      #agy-boot-overlay .agy-mfa-status {
        font-size: 14.5px;
        font-weight: 600;
        color: #e4e4e7;
        margin-bottom: 4px;
      }
      #agy-boot-overlay .agy-mfa-sub {
        font-size: 12.5px;
        color: #a1a1aa;
      }
      #agy-boot-overlay .agy-ghost-link {
        margin-top: 10px;
        background: rgba(255, 255, 255, 0.05);
        border: 1px solid rgba(255, 255, 255, 0.12);
        color: #d8b4fe;
        border-radius: 999px;
        padding: 5px 13px;
        font-family: inherit;
        font-size: 12px;
        font-weight: 600;
        cursor: pointer;
        transition: background 0.16s ease, border-color 0.16s ease;
      }
      #agy-boot-overlay .agy-ghost-link:hover {
        background: rgba(168, 85, 247, 0.18);
        border-color: rgba(192, 132, 252, 0.4);
        color: #ffffff;
      }

      /* Method 2: 6-Digit Stealth PIN Orbs & Compact Pad */
      #agy-boot-overlay .agy-pin-orbs {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 14px;
        margin: 6px 0 16px;
      }
      #agy-boot-overlay .agy-pin-orbs.shake {
        animation: agyPinShake 0.36s cubic-bezier(0.36, 0.07, 0.19, 0.97) both;
      }
      @keyframes agyPinShake {
        15%, 85% { transform: translateX(-6px); }
        30%, 70% { transform: translateX(6px); }
        45%, 55% { transform: translateX(-4px); }
      }
      #agy-boot-overlay .agy-pin-orb {
        width: 15px;
        height: 15px;
        border-radius: 50%;
        border: 1.6px solid rgba(255, 255, 255, 0.28);
        background: rgba(255, 255, 255, 0.03);
        transition: all 0.14s cubic-bezier(0.22, 1, 0.36, 1);
      }
      #agy-boot-overlay .agy-pin-orb.filled {
        background: #d8b4fe;
        border-color: #f3e8ff;
        transform: scale(1.16);
        box-shadow: 0 0 14px rgba(192, 132, 252, 0.85);
      }
      #agy-boot-overlay .agy-pin-orb.error {
        background: #fb7185;
        border-color: #fda4af;
        box-shadow: 0 0 14px rgba(244, 63, 94, 0.8);
      }
      #agy-boot-overlay .agy-pin-orb.ok {
        background: #34d399;
        border-color: #a7f3d0;
        box-shadow: 0 0 16px rgba(52, 211, 153, 0.85);
      }
      #agy-boot-overlay .agy-pin-grid {
        display: grid;
        grid-template-columns: repeat(6, 1fr);
        gap: 7px;
        width: 100%;
        max-width: 380px;
        margin-top: 10px;
      }
      #agy-boot-overlay .agy-pin-key {
        height: 38px;
        border-radius: 10px;
        border: 1px solid rgba(255, 255, 255, 0.09);
        background: rgba(255, 255, 255, 0.04);
        color: #f4f4f5;
        font-family: 'JetBrains Mono', monospace;
        font-size: 14.5px;
        font-weight: 600;
        cursor: pointer;
        transition: background 0.14s ease, transform 0.1s ease;
      }
      #agy-boot-overlay .agy-pin-key:hover {
        background: rgba(168, 85, 247, 0.20);
        border-color: rgba(192, 132, 252, 0.35);
      }
      #agy-boot-overlay .agy-pin-key:active { transform: scale(0.95); }

      /* Method 4: Engineer Terminal & Quantum Hold */
      #agy-boot-overlay .agy-term-box {
        width: 100%;
        background: #06050c;
        border: 1px solid rgba(192, 132, 252, 0.24);
        border-radius: 13px;
        padding: 15px 18px;
        text-align: left;
        font-family: 'JetBrains Mono', 'Cascadia Code', Consolas, monospace;
        box-sizing: border-box;
        margin-bottom: 14px;
      }
      #agy-boot-overlay .agy-term-line {
        font-size: 12.5px;
        color: #a1a1aa;
        margin-bottom: 10px;
      }
      #agy-boot-overlay .agy-term-input-row {
        display: flex;
        align-items: center;
        gap: 8px;
      }
      #agy-boot-overlay .agy-term-prompt {
        font-size: 13px;
        font-weight: 600;
        color: #c084fc;
        white-space: nowrap;
      }
      #agy-boot-overlay #agy-term-pass {
        flex: 1;
        background: transparent;
        border: none;
        outline: none;
        color: #ffffff;
        font-family: inherit;
        font-size: 14px;
        letter-spacing: 0.12em;
      }
      #agy-boot-overlay .agy-hold-btn {
        position: relative;
        width: 100%;
        height: 44px;
        border-radius: 12px;
        overflow: hidden;
        border: 1px solid rgba(192, 132, 252, 0.28);
        background: rgba(255, 255, 255, 0.04);
        color: #e9d5ff;
        font-family: inherit;
        font-size: 13.5px;
        font-weight: 600;
        cursor: pointer;
      }
      #agy-boot-overlay .agy-hold-fill {
        position: absolute;
        inset: 0;
        width: 0%;
        background: linear-gradient(90deg, rgba(147, 51, 234, 0.65), rgba(56, 189, 248, 0.65));
        pointer-events: none;
      }
      #agy-boot-overlay .agy-hold-btn span {
        position: relative;
        z-index: 1;
      }
    `;
    document.head.appendChild(bootStyle);

    const flashCurtain = document.createElement('div');
    flashCurtain.id = 'agy-flash-curtain';
    document.body.appendChild(flashCurtain);

    const overlay = document.createElement('section');
    overlay.id = 'agy-boot-overlay';
    overlay.setAttribute('aria-label', 'Antigravity Welcome');
    overlay.innerHTML = `
      <div class="agy-boot-art"></div>
      <div class="agy-boot-vignette"></div>
      <div class="agy-boot-grid"></div>

      <header class="agy-boot-header">
        <div class="agy-brand-row">
          <img src="${iconColorUrl}" alt="Antigravity" />
          <span class="agy-brand-name">Antigravity</span>
          <span class="agy-brand-tag">Studio 2.0</span>
        </div>
        <button class="agy-boot-skip" id="agy-boot-skip" type="button">Skip · Esc</button>
      </header>

      <div class="agy-boot-stage-wrap">
        <div class="agy-boot-stage active" id="agy-stage-0">
          <img class="agy-splash-logo" src="${iconColorUrl}" alt="Antigravity" />
          <div class="agy-splash-wordmark">Antigravity</div>
          <div class="agy-splash-caption">Next-Generation Engineering Workspace</div>
        </div>

        <div class="agy-boot-stage" id="agy-stage-1">
          <div class="agy-dialog-card">
            <div class="agy-status-chip">
              <span class="agy-status-dot"></span>
              <span>WORKSPACE SESSION</span>
            </div>
            <h1 class="agy-card-heading">Initialize Workspace</h1>
            <p class="agy-card-desc">Establish local interface telemetry and synchronize your personal environment configuration.</p>
            <button class="agy-primary-btn" id="agy-btn-grant" type="button">
              <span>Grant Access</span>
              <span class="agy-keycap">Enter ↵</span>
            </button>
          </div>
        </div>

        <div class="agy-boot-stage" id="agy-stage-2">
          <div class="agy-dialog-card agy-mfa-card">
            <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:14px;">
              <div>
                <div class="agy-profile-eyebrow" style="margin-bottom:2px;">MULTI-FACTOR IDENTITY LOCK</div>
                <h1 class="agy-card-heading" style="margin:0;font-size:25px;">Identity Verification</h1>
              </div>
              <span style="font-family:'JetBrains Mono',monospace;font-size:11.5px;color:#a1a1aa;">SCRYPT · ONNX</span>
            </div>

            <div class="agy-mfa-operator-bar">
              <div class="agy-mfa-op-left">
                <div class="agy-mfa-mini-av"></div>
                <div>
                  <div style="font-size:12px;color:#a1a1aa;font-weight:500;">Operator</div>
                  <div style="font-size:16.5px;font-weight:700;color:#ffffff;letter-spacing:-0.01em;">Binh Phan</div>
                </div>
              </div>
              <span class="agy-spec-value-code" style="font-size:12px;padding:5px 10px;">BINHPHAN-SOFTWARE-ENGINEER</span>
            </div>

            <div class="agy-mfa-tabs" role="tablist">
              <button class="agy-mfa-tab active" data-auth-tab="face" type="button">Face ID</button>
              <button class="agy-mfa-tab" data-auth-tab="pin" type="button">Passcode</button>
              <button class="agy-mfa-tab" data-auth-tab="hello" type="button">Win Hello</button>
              <button class="agy-mfa-tab" data-auth-tab="term" type="button">Terminal</button>
            </div>

            <!-- Pane 1: Live AI Face ID -->
            <div class="agy-mfa-pane active" id="agy-pane-face">
              <div class="agy-face-ring-box" id="agy-face-ring-box">
                <div class="agy-face-spinner"></div>
                <div class="agy-face-viewport">
                  <video id="agy-face-video" autoplay muted playsinline></video>
                  <canvas id="agy-face-hud-canvas" width="132" height="132"></canvas>
                  <div class="agy-face-scanbar" id="agy-face-scanbar"></div>
                </div>
              </div>
              <div class="agy-mfa-status" id="agy-face-status">Initializing camera sensor...</div>
              <div class="agy-mfa-sub" id="agy-face-sub">Auto-switches to Passcode if camera is off or covered</div>
              <button class="agy-ghost-link" id="agy-face-enroll-btn" type="button">Calibrate HD Face ID</button>
            </div>

            <!-- Pane 2: 6-Digit Stealth Passcode -->
            <div class="agy-mfa-pane" id="agy-pane-pin">
              <div class="agy-mfa-status" id="agy-pin-status">Enter 6-Digit Passcode</div>
              <div class="agy-mfa-sub" id="agy-pin-sub">Type on your keyboard or use the keypad below</div>
              <div class="agy-pin-orbs" id="agy-pin-orbs">
                <span class="agy-pin-orb"></span>
                <span class="agy-pin-orb"></span>
                <span class="agy-pin-orb"></span>
                <span class="agy-pin-orb"></span>
                <span class="agy-pin-orb"></span>
                <span class="agy-pin-orb"></span>
              </div>
              <div class="agy-pin-grid" id="agy-pin-grid">
                <button class="agy-pin-key" data-digit="1" type="button">1</button>
                <button class="agy-pin-key" data-digit="2" type="button">2</button>
                <button class="agy-pin-key" data-digit="3" type="button">3</button>
                <button class="agy-pin-key" data-digit="4" type="button">4</button>
                <button class="agy-pin-key" data-digit="5" type="button">5</button>
                <button class="agy-pin-key" data-digit="6" type="button">6</button>
                <button class="agy-pin-key" data-digit="7" type="button">7</button>
                <button class="agy-pin-key" data-digit="8" type="button">8</button>
                <button class="agy-pin-key" data-digit="9" type="button">9</button>
                <button class="agy-pin-key" data-digit="0" type="button">0</button>
                <button class="agy-pin-key" data-action="back" type="button">⌫</button>
                <button class="agy-pin-key" data-action="clear" type="button" style="font-size:11.5px;">CLR</button>
              </div>
            </div>

            <!-- Pane 3: Windows Hello Hardware Biometrics -->
            <div class="agy-mfa-pane" id="agy-pane-hello">
              <div style="width:68px;height:68px;border-radius:18px;background:rgba(168,85,247,0.14);border:1px solid rgba(192,132,252,0.32);display:flex;align-items:center;justify-content:center;margin-bottom:16px;box-shadow:0 8px 24px rgba(126,34,206,0.28);">
                <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="#e9d5ff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 11c0 3.517-1.009 6.799-2.753 9.571m-3.44-2.04l.054-.09A13.916 13.916 0 008 11a4 4 0 118 0c0 1.017-.07 2.019-.203 3m-2.118 6.844A21.88 21.88 0 0015.171 17m3.839 1.132c.645-2.266.99-4.659.99-7.132A8 8 0 008 4.07M3 15.364c.64-1.319 1-2.8 1-4.364 0-1.457.39-2.823 1.07-4"/></svg>
              </div>
              <div class="agy-mfa-status" id="agy-hello-status">Windows Hello Hardware Security</div>
              <div class="agy-mfa-sub" id="agy-hello-sub" style="margin-bottom:18px;">Verify with Fingerprint sensor, IR Face, or Windows PIN</div>
              <button class="agy-primary-btn" id="agy-hello-trigger-btn" type="button" style="max-width:340px;height:46px;font-size:14.5px;">
                <span>Prompt Windows Hello</span>
                <span class="agy-keycap">Enter ↵</span>
              </button>
            </div>

            <!-- Pane 4: Engineer Terminal & Secret Key Chord -->
            <div class="agy-mfa-pane" id="agy-pane-term">
              <div class="agy-term-box">
                <div class="agy-term-line" id="agy-term-log">binhphan@antigravity ~ $ auth --verify-operator</div>
                <div class="agy-term-input-row">
                  <span class="agy-term-prompt">passphrase &gt;</span>
                  <input id="agy-term-pass" type="password" autocomplete="off" spellcheck="false" placeholder="Enter secret passphrase..." />
                </div>
              </div>
              <button class="agy-hold-btn" id="agy-chord-trigger-btn" type="button" style="${serverHasKeyChord ? '' : 'opacity:0.58;cursor:default;'}">
                <div class="agy-hold-fill" id="agy-chord-fill"></div>
                <span id="agy-chord-label">${serverHasKeyChord ? 'Authenticate via 3-Step Secret Key Chord' : 'Secret Key Chord Not Configured (Set in Theme Studio)'}</span>
              </button>
            </div>
          </div>
        </div>

        <div class="agy-boot-stage" id="agy-stage-morph">
          <div class="agy-sync-wrap">
            <div class="agy-icon-morph-box">
              <svg class="agy-icon-outline-svg" id="agy-icon-outline-svg" viewBox="0 0 256 256">
                <defs>
                  <linearGradient id="agyBootStrokeGrad" x1="10%" y1="90%" x2="88%" y2="12%">
                    <stop offset="0%" stop-color="#f3e8ff" />
                    <stop offset="45%" stop-color="#c084fc" />
                    <stop offset="80%" stop-color="#38bdf8" />
                    <stop offset="100%" stop-color="#a855f7" />
                  </linearGradient>
                </defs>
                <path
                  id="agy-boot-outline-path"
                  class="agy-icon-outline-path"
                  d="M 116.50,42.00 Q 111.00,44.00 105.00,49.50 Q 99.00,55.00 94.00,64.00 Q 89.00,73.00 74.50,119.50 Q 60.00,166.00 53.50,178.00 Q 47.00,190.00 40.00,198.00 Q 33.00,206.00 32.50,209.00 Q 32.00,212.00 34.00,213.50 Q 36.00,215.00 39.00,215.00 Q 42.00,215.00 49.00,211.00 Q 56.00,207.00 64.50,198.00 Q 73.00,189.00 82.50,173.00 Q 92.00,157.00 98.00,149.50 Q 104.00,142.00 110.00,138.50 Q 116.00,135.00 125.50,134.50 Q 135.00,134.00 141.50,137.00 Q 148.00,140.00 152.50,144.50 Q 157.00,149.00 169.00,168.50 Q 181.00,188.00 187.50,195.50 Q 194.00,203.00 200.50,208.00 Q 207.00,213.00 210.00,214.00 Q 213.00,215.00 216.50,214.50 Q 220.00,214.00 221.00,213.00 Q 222.00,212.00 221.50,208.50 Q 221.00,205.00 212.00,194.00 Q 203.00,183.00 197.00,170.00 Q 191.00,157.00 182.50,127.00 Q 174.00,97.00 166.50,78.50 Q 159.00,60.00 153.50,53.50 Q 148.00,47.00 144.00,44.50 Q 140.00,42.00 131.00,41.00 Q 122.00,40.00 116.50,42.00 Z"
                />
              </svg>
              <img id="agy-boot-color-fill" class="agy-icon-color-fill" src="${iconColorUrl}" alt="Antigravity" />
            </div>
            <div class="agy-sync-title" id="agy-morph-title">Synchronizing Workspace...</div>
            <div class="agy-sync-sub" id="agy-morph-sub">Loading graphics pipeline and interface configuration</div>
          </div>
        </div>

        <div class="agy-boot-stage" id="agy-stage-5">
          <div class="agy-sync-wrap">
            <div class="agy-icon-morph-box">
              <img src="${iconColorUrl}" alt="Antigravity" style="width:92px;height:92px;object-fit:contain;filter:drop-shadow(0 0 26px rgba(192,132,252,0.55));" />
            </div>
            <div class="agy-sync-title">Identity Verified</div>
            <div class="agy-sync-sub" style="color:#d8b4fe;">Clearance granted · Binh Phan</div>
          </div>
        </div>

        <div class="agy-boot-stage" id="agy-stage-6">
          <div class="agy-hero-welcome">
            <div class="agy-hero-badge">
              <span class="agy-eq-bars"><span></span><span></span><span></span><span></span></span>
              <span>WORKSPACE READY</span>
            </div>
            <h1 class="agy-hero-title">Welcome back, Binh Phan</h1>
            <div class="agy-hero-id">BINHPHAN-SOFTWARE-ENGINEER</div>
          </div>
        </div>
      </div>

      <footer class="agy-boot-footer">
        <div class="agy-footer-meta">
          <span class="agy-eq-bars"><span></span><span></span><span></span><span></span></span>
          <span id="agy-boot-status-bottom">Awaiting operator authorization</span>
        </div>
        <div class="agy-bottom-progress-track">
          <div class="agy-bottom-progress-bar" id="agy-bottom-progress"></div>
        </div>
        <span class="agy-footer-id">BINHPHAN-SOFTWARE-ENGINEER</span>
      </footer>
    `;
    document.body.appendChild(overlay);

    const skipBtn = document.getElementById('agy-boot-skip');
    const statusBottom = document.getElementById('agy-boot-status-bottom');
    const bottomProgress = document.getElementById('agy-bottom-progress');
    const morphTitle = document.getElementById('agy-morph-title');
    const morphSub = document.getElementById('agy-morph-sub');
    const iconOutlineSvg = document.getElementById('agy-icon-outline-svg');
    const outlinePath = document.getElementById('agy-boot-outline-path');
    const colorFillImg = document.getElementById('agy-boot-color-fill');
    const outlineTotalLen = Math.ceil(outlinePath.getTotalLength() || 673);
    outlinePath.style.strokeDasharray = `${outlineTotalLen}`;
    outlinePath.style.strokeDashoffset = `${outlineTotalLen}`;

    let currentStage = 0;
    let bootActx = null;
    let activeAuthTab = 'face';
    let authUnlocked = false;
    let pinBuffer = '';
    let pinBusy = false;
    let pendingFaceEnroll = false;
    let helloBusy = false;

    function playPinTick(freq = 1040, vol = 0.045) {
      try {
        bootActx = bootActx || new (window.AudioContext || window.webkitAudioContext)();
        if (bootActx.state === 'suspended') bootActx.resume();
        const now = bootActx.currentTime;
        const osc = bootActx.createOscillator();
        const g = bootActx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, now);
        osc.frequency.exponentialRampToValueAtTime(freq * 0.55, now + 0.028);
        g.gain.setValueAtTime(vol, now);
        g.gain.exponentialRampToValueAtTime(0.001, now + 0.032);
        osc.connect(g);
        g.connect(bootActx.destination);
        osc.start(now);
        osc.stop(now + 0.035);
      } catch (e) {}
    }

    function playTawaVoice(slotNum) {
      stopBootAudio();
      const src = voiceUrls[slotNum];
      if (!src) return;
      try {
        const audio = new Audio(src);
        audio.volume = 0.94;
        window.__AGY_BOOT_AUDIO__ = audio;
        audio.play().catch(() => {});
      } catch (e) {}
    }

    let lockoutUntilEpoch = 0;
    let chordCaptureMode = false;
    let chordSteps = [];

    function startLockoutCountdown(seconds, targetEl, restoreText) {
      const durSec = Math.max(1, Math.ceil(Number(seconds) || 30));
      lockoutUntilEpoch = Date.now() + durSec * 1000;
      if (window.__AGY_LOCKOUT_TIMER__) {
        clearInterval(window.__AGY_LOCKOUT_TIMER__);
      }
      const updateMsg = () => {
        const rem = Math.ceil((lockoutUntilEpoch - Date.now()) / 1000);
        if (rem <= 0) {
          clearInterval(window.__AGY_LOCKOUT_TIMER__);
          window.__AGY_LOCKOUT_TIMER__ = null;
          lockoutUntilEpoch = 0;
          pinBusy = false;
          if (targetEl && !authUnlocked) {
            targetEl.textContent = restoreText;
            targetEl.style.color = '#e4e4e7';
          }
          renderPinOrbs();
          return;
        }
        if (targetEl && !authUnlocked) {
          targetEl.textContent = `Too many failed attempts · Locked for ${rem}s`;
          targetEl.style.color = '#fb7185';
        }
      };
      updateMsg();
      window.__AGY_LOCKOUT_TIMER__ = setInterval(updateMsg, 500);
    }

    async function completeIdentityAuth(methodLabel, unlockProof = '', adminTicket = '') {
      if (authUnlocked || currentStage !== 2) return;
      if (adminTicket) rememberAdminTicket(adminTicket);

      if (mfaRequired && HAS_VAULT_DAEMON) {
        if (!unlockProof) return;
        try {
          const confirmResp = await daemonFetch('/auth/confirm-unlock', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ unlockProof })
          });
          if (!confirmResp.ok) return;
          const confirmData = await confirmResp.json();
          if (!confirmData || !confirmData.unlocked) return;
        } catch (e) {
          return;
        }
        authUnlocked = true;
        sessionAuthenticated = true;
        releaseWorkspaceLock();
      } else {
        authUnlocked = true;
      }

      stopAuthCamera();
      if (skipBtn) {
        skipBtn.classList.remove('is-locked');
        skipBtn.textContent = 'Skip · Esc';
      }
      if (statusBottom && methodLabel) {
        statusBottom.textContent = `Verified via ${methodLabel} · Binh Phan`;
      }
      playTawaVoice(2);
      const st2 = document.getElementById('agy-stage-2');
      window.__AGY_BOOT_TIMERS__.push(setTimeout(() => st2 && st2.classList.add('wipe-out'), 180));
      window.__AGY_BOOT_TIMERS__.push(setTimeout(() => runAutoSequenceAfterConfirm(), 400));
    }

    function renderPinOrbs(stateClass = '') {
      const orbsWrap = document.getElementById('agy-pin-orbs');
      if (!orbsWrap) return;
      const orbs = orbsWrap.querySelectorAll('.agy-pin-orb');
      orbs.forEach((orb, idx) => {
        orb.className = 'agy-pin-orb';
        if (stateClass) {
          orb.classList.add(stateClass);
        } else if (idx < pinBuffer.length) {
          orb.classList.add('filled');
        }
      });
    }

    async function runLiveFaceEnrollment(enrollTicket = '', fallbackUnlockProof = '') {
      pendingFaceEnroll = false;
      switchAuthTab('face');
      const faceStatus = document.getElementById('agy-face-status');
      const faceSub = document.getElementById('agy-face-sub');
      const enrollBtn = document.getElementById('agy-face-enroll-btn');
      if (enrollBtn) enrollBtn.style.display = 'none';
      if (faceStatus) faceStatus.textContent = 'Look straight at camera · Capturing HD profile...';
      if (faceSub) faceSub.textContent = 'Sampling 4 live multi-angle biometric frames';

      const videoEl = document.getElementById('agy-face-video');
      for (let w = 0; w < 16; w++) {
        if (videoEl && videoEl.readyState >= 2 && videoEl.videoWidth > 0) break;
        await new Promise((r) => setTimeout(r, 150));
      }
      if (!videoEl || videoEl.readyState < 2 || !videoEl.videoWidth) {
        if (faceStatus) faceStatus.textContent = 'Camera unavailable for enrollment';
        if (fallbackUnlockProof) {
          setTimeout(() => completeIdentityAuth('Passcode', fallbackUnlockProof, enrollTicket), 400);
        } else {
          switchAuthTab('pin', 'Camera unavailable · Enter Passcode');
        }
        return;
      }

      if (window.__AGY_FACE_POLL_TIMER__) {
        clearTimeout(window.__AGY_FACE_POLL_TIMER__);
        window.__AGY_FACE_POLL_TIMER__ = null;
      }
      if (window.__AGY_FACE_FALLBACK_TIMER__) {
        clearTimeout(window.__AGY_FACE_FALLBACK_TIMER__);
        window.__AGY_FACE_FALLBACK_TIMER__ = null;
      }

      const capCanvas = document.createElement('canvas');
      capCanvas.width = 400;
      capCanvas.height = Math.max(240, Math.round(400 * (videoEl.videoHeight / Math.max(1, videoEl.videoWidth))));
      const cctx = capCanvas.getContext('2d');
      const frames = [];
      for (let i = 0; i < 4; i++) {
        if (cctx) {
          cctx.drawImage(videoEl, 0, 0, capCanvas.width, capCanvas.height);
          frames.push(capCanvas.toDataURL('image/jpeg', 0.86));
        }
        playPinTick(980 + i * 140, 0.05);
        await new Promise((r) => setTimeout(r, 250));
      }

      try {
        const activeTicket = enrollTicket || getValidAdminTicket();
        const res = await daemonFetch('/auth/face-enroll', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ adminTicket: activeTicket, images: frames })
        });
        const data = await res.json();
        const ringBox = document.getElementById('agy-face-ring-box');
        if (data && data.ok) {
          if (ringBox) ringBox.classList.add('matched');
          if (faceStatus) faceStatus.textContent = `HD Face ID Bound · Binh Phan (${data.samples} samples)`;
          if (faceSub) faceSub.textContent = '128-D SFace biometric template saved locally';
          const proof = data.unlockProof || fallbackUnlockProof;
          const nextTicket = data.adminTicket || activeTicket;
          setTimeout(() => completeIdentityAuth('HD Face ID', proof, nextTicket), 450);
          return;
        }
        if (faceStatus && data && data.error) {
          faceStatus.textContent = data.error;
          faceStatus.style.color = '#fb7185';
        }
      } catch (e) {}
      if (fallbackUnlockProof) {
        setTimeout(() => completeIdentityAuth('Passcode', fallbackUnlockProof, enrollTicket), 650);
      }
    }

    async function handlePinDigit(digit) {
      if (pinBusy || authUnlocked || currentStage !== 2) return;
      if (lockoutUntilEpoch > Date.now()) return;
      if (!HAS_VAULT_DAEMON) {
        const pinStatus = document.getElementById('agy-pin-status');
        if (pinStatus) {
          pinStatus.textContent = 'Run .\\scripts\\install-win.ps1 once to activate Security Vault';
          pinStatus.style.color = '#fb7185';
        }
        return;
      }
      if (pinBuffer.length >= 6) return;
      pinBuffer += String(digit);
      playPinTick(880 + pinBuffer.length * 75, 0.05);
      renderPinOrbs();
      if (pinBuffer.length < 6) return;

      pinBusy = true;
      const entered = pinBuffer;
      const pinStatus = document.getElementById('agy-pin-status');
      const orbsWrap = document.getElementById('agy-pin-orbs');

      try {
        const resp = await daemonFetch('/auth/verify-pin', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ secret: entered })
        });
        const data = await resp.json();

        if (resp.status === 429 || (data && data.lockedOut)) {
          renderPinOrbs('error');
          playPinTick(220, 0.09);
          pinBuffer = '';
          if (orbsWrap) {
            orbsWrap.classList.remove('shake');
            void orbsWrap.offsetWidth;
            orbsWrap.classList.add('shake');
          }
          startLockoutCountdown(
            data.retryAfterSec || 30,
            pinStatus,
            pendingFaceEnroll ? 'Confirm Passcode to Calibrate Face ID' : 'Enter 6-Digit Passcode'
          );
          return;
        }

        if (data && data.verified && data.unlockProof) {
          rememberAdminTicket(data.adminTicket);
          renderPinOrbs('ok');
          if (pinStatus) {
            pinStatus.textContent = pendingFaceEnroll ? 'Passcode Verified · Starting Camera...' : 'Passcode Verified · Access Granted';
            pinStatus.style.color = '#34d399';
          }
          if (pendingFaceEnroll) {
            pinBuffer = '';
            pinBusy = false;
            setTimeout(() => runLiveFaceEnrollment(data.adminTicket, data.unlockProof), 260);
          } else {
            setTimeout(() => completeIdentityAuth('Passcode', data.unlockProof, data.adminTicket), 220);
          }
          return;
        }

        renderPinOrbs('error');
        playPinTick(240, 0.08);
        if (pinStatus) {
          const remTxt = typeof (data && data.remainingAttempts) === 'number'
            ? `Invalid Passcode · ${data.remainingAttempts} attempt${data.remainingAttempts === 1 ? '' : 's'} left`
            : 'Invalid Passcode · Try Again';
          pinStatus.textContent = remTxt;
          pinStatus.style.color = '#fb7185';
        }
        if (orbsWrap) {
          orbsWrap.classList.remove('shake');
          void orbsWrap.offsetWidth;
          orbsWrap.classList.add('shake');
        }
        setTimeout(() => {
          pinBuffer = '';
          pinBusy = false;
          renderPinOrbs();
          if (pinStatus && lockoutUntilEpoch <= Date.now()) {
            pinStatus.textContent = pendingFaceEnroll ? 'Confirm Passcode to Calibrate Face ID' : 'Enter 6-Digit Passcode';
            pinStatus.style.color = '#e4e4e7';
          }
        }, 520);
      } catch (err) {
        pinBuffer = '';
        pinBusy = false;
        renderPinOrbs('error');
        if (pinStatus) {
          pinStatus.textContent = 'Daemon Vault unreachable · Run install-win.ps1';
          pinStatus.style.color = '#fb7185';
        }
      }
    }

    async function startFaceScanner() {
      stopAuthCamera();
      const ringBox = document.getElementById('agy-face-ring-box');
      const videoEl = document.getElementById('agy-face-video');
      const hudCanvas = document.getElementById('agy-face-hud-canvas');
      const faceStatus = document.getElementById('agy-face-status');
      const faceSub = document.getElementById('agy-face-sub');
      if (ringBox) ringBox.classList.remove('matched', 'denied');
      if (!HAS_VAULT_DAEMON) {
        if (faceStatus) {
          faceStatus.textContent = 'Run .\\scripts\\install-win.ps1 once to activate Hardened Vault';
          faceStatus.style.color = '#e9d5ff';
        }
        if (faceSub) faceSub.textContent = 'Preview mode active until background daemon restarts';
        return;
      }
      if (faceStatus) {
        faceStatus.textContent = 'Opening camera sensor...';
        faceStatus.style.color = '#e4e4e7';
      }
      if (faceSub) faceSub.textContent = 'Auto-switches to Passcode if camera is off or covered';

      const base = getDaemonBaseUrl();
      if (!base || !navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== 'function') {
        switchAuthTab('pin', 'Camera unavailable · Switched to Passcode');
        return;
      }

      let stream = null;
      try {
        stream = await Promise.race([
          navigator.mediaDevices.getUserMedia({
            video: { width: { ideal: 480 }, height: { ideal: 480 }, facingMode: 'user' },
            audio: false
          }),
          new Promise((_, rej) => setTimeout(() => rej(new Error('Camera timeout')), 2800))
        ]);
      } catch (err) {
        if (activeAuthTab === 'face' && !authUnlocked && currentStage === 2) {
          switchAuthTab('pin', 'Camera off or blocked · Enter 6-Digit Passcode');
        }
        return;
      }

      if (activeAuthTab !== 'face' || authUnlocked || currentStage !== 2) {
        try { stream.getTracks().forEach((t) => t.stop()); } catch (e) {}
        return;
      }

      window.__AGY_AUTH_STREAM__ = stream;
      if (videoEl) {
        videoEl.srcObject = stream;
        videoEl.play().catch(() => {});
      }
      if (faceStatus) faceStatus.textContent = 'Scanning live biometric signature...';

      let darkStreak = 0;
      let anyFaceSeen = false;
      let lastVideoTime = -1;
      const sampleCanvas = document.createElement('canvas');
      sampleCanvas.width = 320;
      sampleCanvas.height = 240;
      const sctx = sampleCanvas.getContext('2d');
      const hctx = hudCanvas ? hudCanvas.getContext('2d') : null;

      window.__AGY_FACE_FALLBACK_TIMER__ = setTimeout(() => {
        if (!anyFaceSeen && activeAuthTab === 'face' && !authUnlocked && currentStage === 2 && !pendingFaceEnroll) {
          switchAuthTab('pin', 'No face in view · Switched to Passcode');
        }
      }, 4200);

      const pollFrame = async () => {
        if (activeAuthTab !== 'face' || authUnlocked || currentStage !== 2 || !window.__AGY_AUTH_STREAM__) return;
        if (!videoEl || videoEl.readyState < 2 || !videoEl.videoWidth || videoEl.currentTime === lastVideoTime) {
          window.__AGY_FACE_POLL_TIMER__ = setTimeout(pollFrame, 160);
          return;
        }
        lastVideoTime = videoEl.currentTime;
        sampleCanvas.height = Math.max(180, Math.round(320 * (videoEl.videoHeight / Math.max(1, videoEl.videoWidth))));
        if (sctx) sctx.drawImage(videoEl, 0, 0, sampleCanvas.width, sampleCanvas.height);
        const frameData = sampleCanvas.toDataURL('image/jpeg', 0.80);

        try {
          const resp = await daemonFetch('/auth/face-verify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ image: frameData })
          });
          if (!resp.ok) {
            switchAuthTab('pin', 'Biometric service unavailable · Switched to Passcode');
            return;
          }
          const res = await resp.json();
          if (activeAuthTab !== 'face' || authUnlocked || currentStage !== 2) return;

          if (hctx && hudCanvas) {
            hctx.clearRect(0, 0, hudCanvas.width, hudCanvas.height);
          }

          if (res.darkFrame) {
            darkStreak++;
            if (darkStreak >= 3 && !pendingFaceEnroll) {
              switchAuthTab('pin', 'Camera covered or dark · Switched to Passcode');
              return;
            }
          } else {
            darkStreak = 0;
          }

          if (res.hasFace) {
            anyFaceSeen = true;
            if (hctx && hudCanvas && Array.isArray(res.landmarks)) {
              hctx.fillStyle = res.matched ? '#34d399' : '#e879f9';
              res.landmarks.forEach((pt) => {
                const lx = pt[0] * hudCanvas.width;
                const ly = pt[1] * hudCanvas.height;
                hctx.beginPath();
                hctx.arc(lx, ly, 2.3, 0, Math.PI * 2);
                hctx.fill();
              });
            }

            if (res.tooSmall) {
              if (ringBox) ringBox.classList.remove('matched', 'denied');
              if (faceStatus) {
                faceStatus.textContent = 'Move closer to camera sensor...';
                faceStatus.style.color = '#e9d5ff';
              }
            } else if (res.staticReplay) {
              if (ringBox) ringBox.classList.add('denied');
              if (faceStatus) {
                faceStatus.textContent = 'Static frame rejected · Live presence required';
                faceStatus.style.color = '#fb7185';
              }
            } else if (!res.enrolled) {
              if (faceStatus) faceStatus.textContent = 'Face Detected · Click Calibrate HD Face below';
              if (faceSub) faceSub.textContent = 'Or press any number key to unlock with Passcode';
            } else if (res.matched) {
              if (ringBox) ringBox.classList.remove('denied');
              const streak = Number(res.matchStreak) || 1;
              const confPct = Math.min(99, Math.round(84 + Math.max(0, res.similarity - (res.threshold || 0.44)) * 45));
              if (faceStatus) {
                faceStatus.textContent = res.streakConfirmed
                  ? `Identity Confirmed · Binh Phan (${confPct}%)`
                  : `Verifying live liveness (${streak}/3) · ${confPct}%`;
                faceStatus.style.color = '#34d399';
              }
              if (res.streakConfirmed && res.unlockProof) {
                if (ringBox) ringBox.classList.add('matched');
                const scanBar = document.getElementById('agy-face-scanbar');
                if (scanBar) scanBar.style.display = 'none';
                setTimeout(() => completeIdentityAuth('AI Face ID', res.unlockProof, res.adminTicket), 260);
                return;
              }
            } else {
              if (ringBox) ringBox.classList.add('denied');
              if (faceStatus) {
                faceStatus.textContent = 'Unrecognized Operator · Access Blocked';
                faceStatus.style.color = '#fb7185';
              }
              if (faceSub) faceSub.textContent = 'Only Binh Phan is authorized, or use Passcode';
            }
          } else {
            if (ringBox) ringBox.classList.remove('denied');
            if (faceStatus) {
              faceStatus.textContent = 'Scanning live biometric signature...';
              faceStatus.style.color = '#e4e4e7';
            }
          }
        } catch (err) {
          switchAuthTab('pin', 'Biometric bridge offline · Switched to Passcode');
          return;
        }

        if (activeAuthTab === 'face' && !authUnlocked && currentStage === 2) {
          window.__AGY_FACE_POLL_TIMER__ = setTimeout(pollFrame, 195);
        }
      };

      window.__AGY_FACE_POLL_TIMER__ = setTimeout(pollFrame, 240);
    }

    async function triggerWindowsHelloAuth() {
      if (helloBusy || authUnlocked || currentStage !== 2) return;
      const base = getDaemonBaseUrl();
      const hStatus = document.getElementById('agy-hello-status');
      const hSub = document.getElementById('agy-hello-sub');
      if (!base || !HAS_VAULT_DAEMON) {
        if (hStatus) hStatus.textContent = 'Run .\\scripts\\install-win.ps1 once to activate Windows Hello';
        return;
      }
      helloBusy = true;
      if (hStatus) {
        hStatus.textContent = 'Waiting for Windows Hello Security Prompt...';
        hStatus.style.color = '#e9d5ff';
      }
      if (hSub) hSub.textContent = 'Scan your fingerprint, IR face, or enter Windows PIN';
      try {
        const res = await daemonFetch('/auth/windows-hello', { method: 'POST' });
        const data = await res.json();
        helloBusy = false;
        if (data && data.verified && data.unlockProof) {
          if (hStatus) {
            hStatus.textContent = 'Windows Hello Verified · Access Granted';
            hStatus.style.color = '#34d399';
          }
          setTimeout(() => completeIdentityAuth('Windows Hello', data.unlockProof, data.adminTicket), 220);
        } else {
          if (hStatus) {
            hStatus.textContent = 'Windows Hello Cancelled or Not Verified';
            hStatus.style.color = '#fb7185';
          }
          if (hSub) hSub.textContent = 'Click button below or press Enter to retry';
        }
      } catch (e) {
        helloBusy = false;
        if (hStatus) {
          hStatus.textContent = 'Restart daemon once to activate Windows Hello endpoint';
          hStatus.style.color = '#fb7185';
        }
      }
    }

    function resetChordUi() {
      chordCaptureMode = false;
      chordSteps = [];
      const chordFill = document.getElementById('agy-chord-fill');
      const chordLabel = document.getElementById('agy-chord-label');
      if (chordFill) chordFill.style.width = '0%';
      if (chordLabel && !authUnlocked) {
        chordLabel.textContent = serverHasKeyChord
          ? 'Authenticate via 3-Step Secret Key Chord'
          : 'Secret Key Chord Not Configured (Set in Theme Studio)';
      }
    }

    function switchAuthTab(tabKey, reasonSub = '') {
      activeAuthTab = tabKey;
      resetChordUi();
      overlay.querySelectorAll('.agy-mfa-tab').forEach((btn) => {
        btn.classList.toggle('active', btn.dataset.authTab === tabKey);
      });
      ['face', 'pin', 'hello', 'term'].forEach((k) => {
        const pane = document.getElementById(`agy-pane-${k}`);
        if (pane) pane.classList.toggle('active', k === tabKey);
      });

      if (tabKey !== 'face') {
        stopAuthCamera();
      }

      if (tabKey === 'face') {
        startFaceScanner();
      } else if (tabKey === 'pin') {
        pinBuffer = '';
        pinBusy = lockoutUntilEpoch > Date.now();
        renderPinOrbs();
        const pinStatus = document.getElementById('agy-pin-status');
        const pinSub = document.getElementById('agy-pin-sub');
        if (pinStatus && lockoutUntilEpoch <= Date.now()) {
          pinStatus.textContent = pendingFaceEnroll ? 'Confirm Passcode to Calibrate Face ID' : 'Enter 6-Digit Passcode';
          pinStatus.style.color = '#e4e4e7';
        }
        if (pinSub) {
          pinSub.textContent = reasonSub || 'Type 6 digits on keyboard or click keypad below';
        }
      } else if (tabKey === 'hello') {
        triggerWindowsHelloAuth();
      } else if (tabKey === 'term') {
        const passInput = document.getElementById('agy-term-pass');
        if (passInput) {
          passInput.value = '';
          setTimeout(() => passInput.focus(), 40);
        }
      }
    }

    function isSkipBlocked() {
      return mfaRequired && !authUnlocked && HAS_VAULT_DAEMON;
    }

    function showStage(idx) {
      currentStage = idx;
      const ids = ['agy-stage-0', 'agy-stage-1', 'agy-stage-2', 'agy-stage-morph', 'agy-stage-morph', 'agy-stage-5', 'agy-stage-6'];
      const targetId = ids[idx];
      ['agy-stage-0', 'agy-stage-1', 'agy-stage-2', 'agy-stage-morph', 'agy-stage-5', 'agy-stage-6'].forEach((id) => {
        const el = document.getElementById(id);
        if (!el) return;
        el.classList.remove('wipe-out');
        el.classList.toggle('active', id === targetId);
      });

      const lockEnforced = isSkipBlocked();
      if (skipBtn) {
        skipBtn.classList.toggle('is-locked', lockEnforced);
        skipBtn.textContent = lockEnforced ? 'Locked · MFA Required' : 'Skip · Esc';
      }

      if (idx === 2) {
        if (!mfaRequired && !forceReplay) {
          completeIdentityAuth('Quick Pass');
          return;
        }
        switchAuthTab('face');
      } else {
        stopAuthCamera();
      }

      const meta = [
        ['Initializing core kernel...', 12],
        ['Awaiting operator authorization', 28],
        ['Multi-factor verification · Binh Phan', 52],
        ['Synchronizing workspace...', 72],
        ['Applying visual pipeline...', 84],
        ['Identity verified', 94],
        ['Session active · Binh Phan', 100]
      ];
      statusBottom.textContent = meta[idx][0];
      bottomProgress.style.width = `${meta[idx][1]}%`;
    }

    function finishBoot(instant = false) {
      if (isSkipBlocked()) return;
      clearBootTimers();
      stopAuthCamera();
      window.__AGY_BOOT_FINISHED__ = true;
      if (instant) {
        stopBootAudio();
        overlay.classList.add('done', 'instant');
        scheduleRevealWhenReady(false);
        return;
      }
      flashCurtain.classList.remove('burst');
      void flashCurtain.offsetWidth;
      flashCurtain.classList.add('burst');
      window.__AGY_BOOT_TIMERS__.push(
        setTimeout(() => {
          overlay.classList.add('done');
          scheduleRevealWhenReady(false);
          window.__AGY_BOOT_TIMERS__.push(setTimeout(() => {
            overlay.style.display = 'none';
          }, 680));
        }, 260)
      );
    }

    function runAutoSequenceAfterConfirm() {
      morphTitle.textContent = 'Synchronizing Workspace...';
      morphSub.textContent = 'Loading graphics pipeline and interface configuration';
      iconOutlineSvg.classList.remove('fade-stroke');
      colorFillImg.classList.remove('filled');
      outlinePath.classList.remove('trace');
      outlinePath.style.strokeDashoffset = String(outlineTotalLen);
      showStage(3);
      void outlinePath.offsetWidth;
      outlinePath.classList.add('trace');

      let fillPhaseStarted = false;
      const startColorFillStage = () => {
        if (fillPhaseStarted || !overlay.isConnected || overlay.classList.contains('done')) return;
        fillPhaseStarted = true;

        morphTitle.textContent = 'Environment Configured';
        morphSub.textContent = 'Binh Phan · BINHPHAN-SOFTWARE-ENGINEER';
        showStage(4);
        void colorFillImg.offsetWidth;
        colorFillImg.classList.add('filled');

        window.__AGY_BOOT_TIMERS__.push(setTimeout(() => iconOutlineSvg.classList.add('fade-stroke'), 420));

        window.__AGY_BOOT_TIMERS__.push(setTimeout(() => {
          showStage(5);
          playTawaVoice(3);
        }, 920));

        window.__AGY_BOOT_TIMERS__.push(setTimeout(() => {
          showStage(6);
          playTawaVoice(4);
        }, 1820));

        // Synchronized to the exact 1.42s studio cinematic impact climax of cyber_voice4.mp3
        window.__AGY_BOOT_TIMERS__.push(setTimeout(() => finishBoot(false), 1820 + 1420));
      };

      outlinePath.addEventListener('animationend', startColorFillStage, { once: true });
      window.__AGY_BOOT_TIMERS__.push(setTimeout(startColorFillStage, 880));
    }

    function jumpStraightToMfaGate() {
      if (currentStage >= 2) return;
      if (Array.isArray(window.__AGY_BOOT_TIMERS__)) {
        window.__AGY_BOOT_TIMERS__.forEach((id) => clearTimeout(id));
        window.__AGY_BOOT_TIMERS__ = [];
      }
      overlay.classList.add('hud-mode');
      showStage(2);
    }

    if (jumpToMfa || (!st.bootIntro && mfaRequired && !forceReplay)) {
      overlay.classList.add('hud-mode');
      showStage(2);
    } else {
      showStage(0);
      window.__AGY_BOOT_TIMERS__.push(setTimeout(() => {
        overlay.classList.add('hud-mode');
        showStage(1);
      }, 1750));
    }

    document.getElementById('agy-btn-grant').addEventListener('click', (e) => {
      if (currentStage !== 1) return;
      e.currentTarget.classList.add('triggered');
      playTawaVoice(1);
      const st1 = document.getElementById('agy-stage-1');
      window.__AGY_BOOT_TIMERS__.push(setTimeout(() => st1 && st1.classList.add('wipe-out'), 150));
      window.__AGY_BOOT_TIMERS__.push(setTimeout(() => showStage(2), 360));
    });

    // Bind 4-Method Auth Switcher Tabs & Controls
    overlay.querySelectorAll('.agy-mfa-tab').forEach((btn) => {
      btn.addEventListener('click', () => {
        pendingFaceEnroll = false;
        switchAuthTab(btn.dataset.authTab);
      });
    });

    const enrollFaceBtn = document.getElementById('agy-face-enroll-btn');
    if (enrollFaceBtn) {
      enrollFaceBtn.addEventListener('click', () => {
        pendingFaceEnroll = true;
        switchAuthTab('pin', 'Verify current 6-digit PIN once to calibrate HD Face ID');
      });
    }

    const pinGrid = document.getElementById('agy-pin-grid');
    if (pinGrid) {
      pinGrid.addEventListener('click', (e) => {
        const btn = e.target.closest('.agy-pin-key');
        if (!btn || pinBusy) return;
        if (btn.dataset.digit !== undefined) {
          handlePinDigit(btn.dataset.digit);
        } else if (btn.dataset.action === 'back') {
          pinBuffer = pinBuffer.slice(0, -1);
          playPinTick(620, 0.04);
          renderPinOrbs();
        } else if (btn.dataset.action === 'clear') {
          pinBuffer = '';
          playPinTick(520, 0.04);
          renderPinOrbs();
        }
      });
    }

    const helloBtn = document.getElementById('agy-hello-trigger-btn');
    if (helloBtn) {
      helloBtn.addEventListener('click', () => triggerWindowsHelloAuth());
    }

    const termPassInput = document.getElementById('agy-term-pass');
    const termLog = document.getElementById('agy-term-log');
    if (termPassInput) {
      termPassInput.addEventListener('keydown', async (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          e.stopPropagation();
          if (lockoutUntilEpoch > Date.now()) return;
          if (!HAS_VAULT_DAEMON) {
            if (termLog) {
              termLog.textContent = 'auth: run .\\scripts\\install-win.ps1 once to activate vault';
              termLog.style.color = '#fb7185';
            }
            return;
          }
          const val = termPassInput.value;
          try {
            const resp = await daemonFetch('/auth/verify-pass', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ secret: val })
            });
            const data = await resp.json();
            if (resp.status === 429 || (data && data.lockedOut)) {
              playPinTick(220, 0.09);
              termPassInput.value = '';
              startLockoutCountdown(data.retryAfterSec || 30, termLog, 'binhphan@antigravity ~ $ auth --verify-operator');
              return;
            }
            if (data && data.verified && data.unlockProof) {
              if (termLog) {
                termLog.textContent = '[OK] Clearance granted: BINHPHAN-SOFTWARE-ENGINEER';
                termLog.style.color = '#34d399';
              }
              completeIdentityAuth('Engineer Terminal', data.unlockProof, data.adminTicket);
            } else {
              playPinTick(240, 0.08);
              termPassInput.value = '';
              if (termLog) {
                const rem = typeof (data && data.remainingAttempts) === 'number'
                  ? ` (${data.remainingAttempts} left)`
                  : '';
                termLog.textContent = `auth: invalid passphrase${rem} — try again`;
                termLog.style.color = '#fb7185';
              }
            }
          } catch (err) {
            if (termLog) {
              termLog.textContent = 'auth: daemon vault unreachable';
              termLog.style.color = '#fb7185';
            }
          }
        }
      });
    }

    const chordBtn = document.getElementById('agy-chord-trigger-btn');
    const chordFill = document.getElementById('agy-chord-fill');
    const chordLabel = document.getElementById('agy-chord-label');
    if (chordBtn) {
      chordBtn.addEventListener('click', () => {
        if (!serverHasKeyChord || authUnlocked || currentStage !== 2) return;
        if (lockoutUntilEpoch > Date.now()) return;
        chordCaptureMode = true;
        chordSteps = [];
        if (termPassInput) termPassInput.blur();
        if (chordFill) chordFill.style.width = '10%';
        if (chordLabel) chordLabel.textContent = 'Press Secret Key Combo 1 of 3... (Esc to cancel)';
        playPinTick(740, 0.045);
      });
    }

    async function handleChordKeyEvent(e) {
      const combo = serializeKeyCombo(e);
      if (!combo) return;
      e.preventDefault();
      e.stopPropagation();
      chordSteps.push(combo);
      playPinTick(780 + chordSteps.length * 110, 0.05);
      if (chordFill) chordFill.style.width = `${Math.round((chordSteps.length / 3) * 100)}%`;
      if (chordSteps.length < 3) {
        if (chordLabel) chordLabel.textContent = `Press Secret Key Combo ${chordSteps.length + 1} of 3...`;
        return;
      }
      const candidateChord = chordSteps.join('>');
      chordCaptureMode = false;
      chordSteps = [];
      try {
        const resp = await daemonFetch('/auth/verify-chord', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ secret: candidateChord })
        });
        const data = await resp.json();
        if (resp.status === 429 || (data && data.lockedOut)) {
          resetChordUi();
          startLockoutCountdown(data.retryAfterSec || 30, chordLabel, 'Authenticate via 3-Step Secret Key Chord');
          return;
        }
        if (data && data.verified && data.unlockProof) {
          if (chordLabel) chordLabel.textContent = 'Secret Key Chord Verified · Access Granted';
          completeIdentityAuth('Secret Key Chord', data.unlockProof, data.adminTicket);
        } else {
          playPinTick(230, 0.08);
          if (chordFill) chordFill.style.width = '0%';
          if (chordLabel) chordLabel.textContent = 'Invalid Key Chord Sequence · Click to Retry';
        }
      } catch (err) {
        resetChordUi();
      }
    }

    skipBtn.addEventListener('click', () => {
      if (isSkipBlocked()) {
        if (currentStage < 2) jumpStraightToMfaGate();
        return;
      }
      finishBoot(true);
    });

    window.__AGY_BOOT_KEYDOWN__ = (e) => {
      if (overlay.classList.contains('done')) return;

      // Strict workspace shortcut & focus containment while locked
      if (isSkipBlocked()) {
        if (/^F(?:[1-9]|1[0-2])$/.test(e.key)) {
          e.preventDefault();
          e.stopPropagation();
          return;
        }
        if (e.key === 'Tab') {
          const focusables = Array.from(overlay.querySelectorAll('button:not([disabled]), input:not([disabled])'))
            .filter((el) => el.offsetParent !== null);
          if (focusables.length > 0) {
            const idx = focusables.indexOf(document.activeElement);
            e.preventDefault();
            e.stopPropagation();
            const nextIdx = e.shiftKey
              ? (idx <= 0 ? focusables.length - 1 : idx - 1)
              : (idx === -1 || idx >= focusables.length - 1 ? 0 : idx + 1);
            focusables[nextIdx].focus();
          } else {
            e.preventDefault();
            e.stopPropagation();
          }
          return;
        }
        if ((e.ctrlKey || e.metaKey || e.altKey) && !chordCaptureMode) {
          const k = String(e.key || '').toLowerCase();
          const allowInputEdit = document.activeElement === termPassInput && (e.ctrlKey || e.metaKey) && ['a', 'v', 'c', 'x', 'backspace'].includes(k);
          if (!allowInputEdit) {
            e.preventDefault();
            e.stopPropagation();
            return;
          }
        }
      }

      if (currentStage === 1 && (e.key === 'Enter' || e.key === ' ')) {
        e.preventDefault();
        e.stopPropagation();
        const btn = document.getElementById('agy-btn-grant');
        if (btn) btn.click();
        return;
      }

      if (currentStage === 2) {
        if (chordCaptureMode) {
          if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            resetChordUi();
            return;
          }
          handleChordKeyEvent(e);
          return;
        }

        if (activeAuthTab === 'term' && document.activeElement === termPassInput) {
          if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            termPassInput.value = '';
          }
          return;
        }

        // Instant digit typing (even while Face ID is scanning -> switches straight to Passcode!)
        if (/^[0-9]$/.test(e.key) && !e.ctrlKey && !e.altKey && !e.metaKey) {
          e.preventDefault();
          e.stopPropagation();
          if (activeAuthTab !== 'pin') {
            switchAuthTab('pin', 'Manual Passcode entry');
          }
          handlePinDigit(e.key);
          return;
        }

        if (activeAuthTab === 'pin' && e.key === 'Backspace') {
          e.preventDefault();
          e.stopPropagation();
          pinBuffer = pinBuffer.slice(0, -1);
          playPinTick(620, 0.04);
          renderPinOrbs();
          return;
        }

        if (activeAuthTab === 'hello' && e.key === 'Enter') {
          e.preventDefault();
          e.stopPropagation();
          triggerWindowsHelloAuth();
          return;
        }

        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          if (!isSkipBlocked()) {
            finishBoot(true);
          } else if (activeAuthTab === 'pin' && pinBuffer.length > 0) {
            pinBuffer = '';
            renderPinOrbs();
          }
          return;
        }
        return;
      }

      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        if (isSkipBlocked()) {
          jumpStraightToMfaGate();
        } else {
          finishBoot(true);
        }
      }
    };
    window.addEventListener('keydown', window.__AGY_BOOT_KEYDOWN__, true);
    isMountingBootOverlay = false;
    enforceWorkspaceLock();
  }
  window.__ANTIGRAVITY_REPLAY_BOOT__ = () => mountBootSequence(true);

  /** Embed offline Plus Jakarta Sans, JetBrains Mono, and Mali WOFF2 subsets once. */
  function ensureGreetingFonts() {
    if (document.getElementById('agy-greeting-font-style')) return;
    const host = document.head || document.documentElement;
    if (!host) return;
    const viRange = 'U+0102-0103, U+0110-0111, U+0128-0129, U+0168-0169, U+01A0-01A1, U+01AF-01B0, U+0300-0301, U+0303-0304, U+0308-0309, U+0323, U+0329, U+1EA0-1EF9, U+20AB';
    const latinExtRange = 'U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C4, U+2113, U+2C60-2C7F, U+A720-A7FF';
    const latinRange = 'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD';

    const faces = [
      { family: 'Plus Jakarta Sans', weight: '400 700', src: BOOT_ASSETS.jakartaVi || resolveMediaUrl('assets/fonts/jakarta-vi.woff2'), range: viRange },
      { family: 'Plus Jakarta Sans', weight: '400 700', src: BOOT_ASSETS.jakartaLatinExt || resolveMediaUrl('assets/fonts/jakarta-latin-ext.woff2'), range: latinExtRange },
      { family: 'Plus Jakarta Sans', weight: '400 700', src: BOOT_ASSETS.jakartaLatin || resolveMediaUrl('assets/fonts/jakarta-latin.woff2'), range: latinRange },
      { family: 'JetBrains Mono', weight: '500 600', src: BOOT_ASSETS.jbMonoVi || resolveMediaUrl('assets/fonts/jbmono-vi.woff2'), range: viRange },
      { family: 'JetBrains Mono', weight: '500 600', src: BOOT_ASSETS.jbMonoLatin || resolveMediaUrl('assets/fonts/jbmono-latin.woff2'), range: latinRange },
      { family: 'AgyTawaMali', weight: '500', src: BOOT_ASSETS.greetingFontVi || resolveMediaUrl('assets/fonts/mali-500-vi.woff2'), range: viRange },
      { family: 'AgyTawaMali', weight: '500', src: BOOT_ASSETS.greetingFontLatinExt || resolveMediaUrl('assets/fonts/mali-500-latin-ext.woff2'), range: latinExtRange },
      { family: 'AgyTawaMali', weight: '500', src: BOOT_ASSETS.greetingFontLatin || resolveMediaUrl('assets/fonts/mali-500-latin.woff2'), range: latinRange }
    ];
    const fontEl = document.createElement('style');
    fontEl.id = 'agy-greeting-font-style';
    fontEl.textContent = faces.map((f) => `
      @font-face {
        font-family: '${f.family}';
        font-style: normal;
        font-weight: ${f.weight};
        font-display: swap;
        src: url("${sanitizeCssUrl(f.src)}") format('woff2');
        unicode-range: ${f.range};
      }`).join('\n');
    host.appendChild(fontEl);
  }

  function applyTheme(overrides = {}) {
    const st = { ...getState(), ...overrides };
    ensureGreetingFonts();
    try {
      localStorage.setItem(STORAGE_THEME, st.themeName);
      localStorage.setItem(STORAGE_BUBBLE, st.bubbleName);
      localStorage.setItem(STORAGE_INPUT, st.inputStyle);
      localStorage.setItem(STORAGE_DIMMING, String(st.dimming));
      localStorage.setItem(STORAGE_WP_ENABLED, String(st.wpEnabled));
      localStorage.setItem(STORAGE_WP_MODE, st.wpMode);
      if (overrides.customWp !== undefined) {
        localStorage.setItem(STORAGE_CUSTOM_WP, overrides.customWp);
      }
      if (overrides.customVideo !== undefined) {
        localStorage.setItem(STORAGE_CUSTOM_VIDEO, overrides.customVideo);
      }
      if (overrides.savedImages !== undefined) {
        localStorage.setItem(STORAGE_SAVED_IMAGES, JSON.stringify(st.savedImages));
      }
      if (overrides.savedVideos !== undefined) {
        localStorage.setItem(STORAGE_SAVED_VIDEOS, JSON.stringify(st.savedVideos));
      }
      if (overrides.taskVoices !== undefined) {
        localStorage.setItem(STORAGE_TASK_VOICES, JSON.stringify(st.taskVoices));
      }
      if (overrides.taskVoiceEnabled !== undefined) {
        localStorage.setItem(STORAGE_TASK_VOICE_ENABLED, String(st.taskVoiceEnabled));
      }
      if (overrides.taskVoiceVol !== undefined) {
        localStorage.setItem(STORAGE_TASK_VOICE_VOL, String(st.taskVoiceVol));
      }
      if (overrides.customGreetings !== undefined) {
        localStorage.setItem(STORAGE_CUSTOM_GREETINGS, JSON.stringify(st.customGreetings));
      }
      if (overrides.bootIntro !== undefined) {
        localStorage.setItem(STORAGE_BOOT_INTRO, String(st.bootIntro));
      }
      if (overrides.sketchReveal !== undefined) {
        localStorage.setItem(STORAGE_SKETCH_REVEAL, String(st.sketchReveal));
      }
      if (overrides.tawaGreeting !== undefined) {
        localStorage.setItem(STORAGE_TAWA_GREETING, String(st.tawaGreeting));
      }
      if (overrides.userAvatar !== undefined) {
        localStorage.setItem(STORAGE_USER_AVATAR, overrides.userAvatar);
      }
      if (overrides.agentAvatar !== undefined) {
        localStorage.setItem(STORAGE_AGENT_AVATAR, overrides.agentAvatar);
      }
      if (overrides.glassBlur !== undefined) {
        localStorage.setItem(STORAGE_GLASS_BLUR, String(overrides.glassBlur));
      }
      if (overrides.avatarSize !== undefined) {
        localStorage.setItem(STORAGE_AVATAR_SIZE, String(overrides.avatarSize));
      }
      if (overrides.avatarRadius !== undefined) {
        localStorage.setItem(STORAGE_AVATAR_RADIUS, String(overrides.avatarRadius));
      }
    } catch (e) {}

    if (window.agySaveThemeConfig) {
      try {
        const persistObj = { ...st };
        delete persistObj.authLock;
        window.agySaveThemeConfig(JSON.stringify(persistObj));
      } catch (e) {}
    }

    const mainTheme = THEMES[st.themeName] || THEMES[DEFAULT_THEME_KEY];
    const bubbleTheme = THEMES[st.bubbleName] || mainTheme;
    const wpUrl = resolveMediaUrl(st.customWp || mainTheme.wallpaper || '');
    const wpVideoUrl = resolveMediaUrl(st.customVideo || mainTheme.wallpaperVideo || '');
    const isVideoMode = Boolean(st.wpEnabled && st.wpMode === 'video' && wpVideoUrl);

    const oldLegacy = document.getElementById('antigravity-ho-ly-chibi-theme');
    if (oldLegacy) oldLegacy.remove();

    let styleEl = document.getElementById('antigravity-custom-theme-active');
    if (!styleEl) {
      styleEl = document.createElement('style');
      styleEl.id = 'antigravity-custom-theme-active';
      document.head.appendChild(styleEl);
    }

    const overlayAlpha = mainTheme.clearBackdrop
      ? Math.min(0.92, Math.max(0.0, ((st.dimming - 10) / 82) * 0.85))
      : Math.min(0.92, Math.max(0.12, (st.dimming / 100) * 0.78));
    const overlayRgb = mainTheme.overlayRgb || '10, 7, 6';
    const bgPosition = mainTheme.bgPosition || 'center center';
    const secondaryGlowStop = mainTheme.secondaryGlow
      ? `, radial-gradient(circle at 22% 72%, ${mainTheme.secondaryGlow} 0%, transparent 55%)`
      : '';

    let bgLayers = '';
    if (wpUrl) {
      bgLayers = mainTheme.clearBackdrop
        ? `linear-gradient(180deg, rgba(${overlayRgb}, ${overlayAlpha}) 0%, rgba(${overlayRgb}, ${overlayAlpha}) 100%), url("${wpUrl}")`
        : `radial-gradient(circle at 75% 40%, ${mainTheme.glow} 0%, transparent 65%)${secondaryGlowStop}, linear-gradient(180deg, rgba(${overlayRgb}, ${overlayAlpha * 0.85}) 0%, rgba(${overlayRgb}, ${overlayAlpha}) 100%), url("${wpUrl}")`;
    } else {
      bgLayers = mainTheme.pureBg || `radial-gradient(circle at 75% 30%, ${mainTheme.glow} 0%, transparent 60%), linear-gradient(160deg, rgba(${overlayRgb}, 0.96) 0%, #070910 100%)`;
    }

    const wpCss = st.wpEnabled ? `
      .agy-shell {
        background-image: ${bgLayers} !important;
        background-size: cover !important;
        background-position: ${bgPosition} !important;
        background-repeat: no-repeat !important;
        image-rendering: auto !important;
      }
      .agy-shell > :not(#agy-live-bg-layer):not([data-has-browser-hole="true"]) {
        position: relative;
        z-index: 1;
      }
      /* Keep transparent scrollers on GPU composited-scrolling layers */
      .agy-shell .overflow-y-auto {
        will-change: scroll-position;
      }
      .agy-sheet,
      .agy-inset-shell,
      .browser-hole-opaque,
      [data-main-content-body="true"],
      [data-side-panel-body="true"],
      [class*="agy-inset-shell"],
      [class*="--shell-canvas"],
      .agy-shell div.absolute.bottom-0.pointer-events-none,
      .agy-shell [class*="z-50"] .pointer-events-none.right-full,
      .agy-shell .bg-background:not(.settings-modal-container):not(.settings-modal-container *):not(#agy-custom-theme-modal-backdrop *) {
        background: transparent !important;
        background-color: transparent !important;
        background-image: none !important;
      }
      /* Browser split-pane hole cutout: keep wallpaper & L-glass visible outside [data-browser-hole] without covering live BrowserView */
      ${isVideoMode ? '' : `
      body[data-has-browser-hole="true"] .agy-shell[data-agy-hole-active="1"]::after {
        content: "";
        position: absolute;
        inset: 0;
        z-index: 0;
        pointer-events: none;
        background-image: ${bgLayers};
        background-size: cover;
        background-position: ${bgPosition};
        background-repeat: no-repeat;
        clip-path: var(--agy-hole-clip, none);
        will-change: transform;
      }
      `}
      body[data-has-browser-hole="true"] .agy-shell[data-agy-hole-active="1"] > :not([data-has-browser-hole="true"]):not([data-browser-hole]:not([data-browser-hole="false"])):not(.settings-modal-container),
      body[data-has-browser-hole="true"] .agy-shell[data-agy-hole-active="1"] .browser-hole-opaque:not([data-has-browser-hole="true"]),
      body[data-has-browser-hole="true"] .agy-shell[data-agy-hole-active="1"] [data-pane-id]:not([data-has-browser-hole="true"]),
      body[data-has-browser-hole="true"] .agy-shell[data-agy-hole-active="1"] [data-tiling-pane]:not([data-has-browser-hole="true"]),
      body[data-has-browser-hole="true"] .agy-shell[data-agy-hole-active="1"] [data-main-content-header]:not([data-has-browser-hole="true"]),
      body[data-has-browser-hole="true"] .agy-shell[data-agy-hole-active="1"] [data-side-panel-strip]:not([data-has-browser-hole="true"]) {
        background: transparent !important;
        background-color: transparent !important;
        background-image: none !important;
      }
      body[data-has-browser-hole="true"] .agy-shell[data-agy-hole-active="1"] :is([data-main-content-body], [data-side-panel-body]):not([data-has-browser-hole="true"]) {
        box-shadow: none !important;
      }
      body[data-has-browser-hole="true"] .agy-shell[data-agy-hole-active="1"] [data-split-sash] {
        background: rgba(56, 189, 248, 0.14) !important;
        background-image: none !important;
      }
    ` : `
      .agy-shell {
        background: #111113 !important;
      }
    `;

    const defaultCornerSvg = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 40 40'%3E%3Cpath d='M2 20 L2 6 Q2 2 6 2 L20 2' stroke='%23c084fc' stroke-width='1.5' fill='none' opacity='0.75'/%3E%3Ccircle cx='6' cy='6' r='2' fill='%23e9d5ff' opacity='0.85'/%3E%3C/svg%3E";
    const cornerFiligreeUrl = bubbleTheme.cornerSvg || defaultCornerSvg;

    const bubbleStickerCss = bubbleTheme.sticker ? (bubbleTheme.isOrnament ? `
      .group\\/user-input-step {
        padding-top: 18px !important;
      }
      .agy-user-bubble-frame::before {
        content: "";
        position: absolute;
        top: ${bubbleTheme.stickerTop}px;
        right: ${bubbleTheme.stickerRight}px;
        width: ${bubbleTheme.stickerW}px;
        height: ${bubbleTheme.stickerH}px;
        background-image: url("${bubbleTheme.sticker}");
        background-size: contain;
        background-position: center;
        background-repeat: no-repeat;
        z-index: 25;
        pointer-events: none;
        transition: transform 0.2s ease;
      }
    ` : `
      .group\\/user-input-step {
        padding-top: ${Math.max(36, Math.abs(bubbleTheme.stickerTop) + 8)}px !important;
      }
      .agy-user-bubble-frame::before {
        content: "";
        position: absolute;
        top: ${bubbleTheme.stickerTop}px;
        right: ${bubbleTheme.stickerRight}px;
        width: ${bubbleTheme.stickerW}px;
        height: ${bubbleTheme.stickerH}px;
        background-image: url("${bubbleTheme.sticker}");
        background-size: contain;
        background-position: bottom center;
        background-repeat: no-repeat;
        z-index: 25;
        pointer-events: none;
        transition: transform 0.2s ease;
      }
    `) : `
      .agy-user-bubble-frame::before { display: none !important; }
    `;

    const showInputSticker = st.inputStyle !== 'minimal' && bubbleTheme.sticker;
    const inputStickerCss = showInputSticker ? (bubbleTheme.isOrnament ? `
      .surface-composer {
        margin-top: 16px !important;
        overflow: visible !important;
      }
      .surface-composer::before {
        content: "";
        position: absolute;
        top: ${bubbleTheme.stickerTop}px;
        right: 16px;
        width: ${bubbleTheme.stickerW + 8}px;
        height: ${bubbleTheme.stickerH + 2}px;
        background-image: url("${bubbleTheme.sticker}");
        background-size: contain;
        background-position: center;
        background-repeat: no-repeat;
        z-index: 30;
        pointer-events: none;
      }
      .surface-composer::after {
        content: "";
        position: absolute;
        bottom: 3px;
        left: 4px;
        width: 16px;
        height: 16px;
        background-image: url("${cornerFiligreeUrl}");
        background-size: contain;
        background-repeat: no-repeat;
        transform: rotate(180deg);
        z-index: 25;
        pointer-events: none;
        opacity: 0.78;
      }
    ` : `
      .surface-composer {
        margin-top: 28px !important;
        overflow: visible !important;
      }
      .surface-composer::before {
        content: "";
        position: absolute;
        top: ${bubbleTheme.stickerTop - 4}px;
        right: 16px;
        width: ${bubbleTheme.stickerW + 6}px;
        height: ${bubbleTheme.stickerH + 6}px;
        background-image: url("${bubbleTheme.sticker}");
        background-size: contain;
        background-position: bottom center;
        background-repeat: no-repeat;
        z-index: 30;
        pointer-events: none;
      }
      .surface-composer::after { display: none !important; }
    `) : `
      .surface-composer::before,
      .surface-composer::after { display: none !important; }
    `;

    const inputCardBg =
      st.inputStyle === 'glass'
        ? (bubbleTheme.inputGlassBg || 'rgba(18, 12, 32, 0.54)')
        : st.inputStyle === 'double_gold'
        ? 'linear-gradient(145deg, rgba(28, 16, 48, 0.90) 0%, rgba(12, 8, 24, 0.94) 100%)'
        : (bubbleTheme.inputCardBg || 'rgba(20, 12, 36, 0.88)');

    const inputOuterBorder =
      st.inputStyle === 'double_gold'
        ? 'linear-gradient(135deg, #f3e8ff 0%, #c084fc 45%, rgba(126, 34, 206, 0.50) 75%, #e879f9 100%)'
        : bubbleTheme.frameBg;

    const sidebarBg = mainTheme.sidebarBg || 'rgba(14, 10, 8, 0.68)';
    const sidebarHoverBg = mainTheme.sidebarHoverBg || 'rgba(255, 255, 255, 0.08)';
    const btnBg = mainTheme.btnBg || 'rgba(48, 30, 22, 0.62)';
    const modalBg = mainTheme.modalBg || 'rgba(14, 12, 12, 0.96)';
    const innerBubbleBorder = bubbleTheme.isScroll
      ? '2px solid #78350f'
      : (bubbleTheme.innerBorder || '1px solid rgba(255, 255, 255, 0.06)');

    const isLight = Boolean(mainTheme.isLight);
    const uiInk = mainTheme.uiTextColor || (isLight ? '#0f172a' : 'rgba(248, 250, 252, 0.96)');
    const uiMutedInk = mainTheme.uiMutedColor || (isLight ? '#334155' : 'rgba(241, 245, 249, 0.92)');
    const uiShadow = isLight ? 'none' : '0 1px 4px rgba(0, 0, 0, 0.92), 0 0 8px rgba(0, 0, 0, 0.68)';
    const pillBg = mainTheme.pillBg || (isLight ? 'rgba(255, 255, 255, 0.78)' : 'rgba(6, 11, 24, 0.78)');
    const pillHoverBg = mainTheme.pillHoverBg || (isLight ? 'rgba(255, 255, 255, 0.94)' : 'rgba(10, 18, 38, 0.92)');
    const pillText = mainTheme.pillTextColor || (isLight ? '#0f172a' : '#f8fafc');
    const pillBorder = mainTheme.pillBorder || (isLight ? 'rgba(15, 23, 42, 0.16)' : 'rgba(255, 255, 255, 0.16)');
    const preCodeBg = isLight ? `rgba(${overlayRgb}, 0.72)` : `rgba(${overlayRgb}, 0.56)`;

    const effectiveUserAvatar = st.userAvatar === 'none' ? '' : (st.userAvatar || mainTheme.userAvatar || '');
    const effectiveAgentAvatar = st.agentAvatar === 'none' ? '' : (st.agentAvatar || mainTheme.agentAvatar || '');
    const avSize = Math.min(52, Math.max(22, Number(st.avatarSize) || 32));
    const avAgentSize = Math.max(22, avSize - 2);
    const avRadius = Math.min(50, Math.max(0, Number.isFinite(Number(st.avatarRadius)) ? Number(st.avatarRadius) : 50));

    const avatarCss = `
      ${effectiveUserAvatar ? `
      .agy-shell [data-testid="user-message"] {
        position: relative !important;
        padding-right: ${avSize + 10}px !important;
      }
      .agy-shell [data-testid="user-message"]::after {
        content: "";
        position: absolute;
        right: 0;
        bottom: 6px;
        width: ${avSize}px;
        height: ${avSize}px;
        border-radius: ${avRadius}%;
        background-image: url("${effectiveUserAvatar}");
        background-size: cover;
        background-position: center;
        border: 1.5px solid ${mainTheme.primary};
        box-shadow: 0 2px 10px rgba(0, 0, 0, 0.4), 0 0 8px ${mainTheme.glow};
        pointer-events: none;
      }
      ` : ''}
      ${effectiveAgentAvatar ? `
      .agy-shell [data-testid="agent-response"] {
        position: relative !important;
        padding-left: ${avAgentSize + 22}px !important;
        min-height: ${avAgentSize + 20}px !important;
      }
      .agy-shell [data-testid="agent-response"]::before {
        content: "";
        position: absolute;
        top: 12px;
        left: 12px;
        width: ${avAgentSize}px;
        height: ${avAgentSize}px;
        border-radius: ${avRadius}%;
        background-image: url("${effectiveAgentAvatar}");
        background-size: cover;
        background-position: center;
        border: 1.5px solid ${mainTheme.secondary || mainTheme.primary};
        box-shadow: 0 2px 10px rgba(0, 0, 0, 0.4), 0 0 8px ${mainTheme.secondaryGlow || mainTheme.glow};
        pointer-events: none;
      }
      ` : ''}
    `;

    const sidebarEnhanceCss = (mainTheme.sidebarEnhanceText || isLight) ? `
      .agy-shell .bg-sidebar a,
      .agy-shell .bg-sidebar span,
      .agy-shell .bg-sidebar button {
        color: ${isLight ? uiInk : 'inherit'};
        text-shadow: ${isLight ? 'none' : '0 1px 3px rgba(0, 0, 0, 0.88)'};
      }
      .agy-shell .bg-sidebar .text-muted-foreground,
      .agy-shell .bg-sidebar .text-secondary-foreground {
        color: ${uiMutedInk} !important;
      }
    ` : '';

    const aiCardCss = mainTheme.aiCardBg ? `
      /* Translucent reading card for AI responses (zero live backdrop-filter for max 120fps scroll) */
      .agy-shell [data-testid="agent-response"] {
        background: ${mainTheme.aiCardBg} !important;
        ${isLight ? `color: ${uiInk} !important;` : ''}
        backdrop-filter: none !important;
        border: 1px solid ${mainTheme.aiCardBorder || (isLight ? 'rgba(15, 23, 42, 0.12)' : 'rgba(255, 255, 255, 0.1)')} !important;
        border-radius: 14px !important;
        padding: 12px 16px !important;
        box-shadow: ${isLight ? '0 4px 14px rgba(15, 23, 42, 0.08)' : '0 4px 14px rgba(0, 0, 0, 0.28)'} !important;
        box-sizing: border-box !important;
        overflow: hidden !important;
      }
      .agy-shell [data-testid="agent-response"] .md-table-bleed,
      .agy-shell [data-testid="agent-response"] .md-table-host {
        width: 100% !important;
        min-width: 0 !important;
        max-width: 100% !important;
        margin-left: 0 !important;
        margin-right: 0 !important;
        margin-inline: 0 !important;
        left: auto !important;
        right: auto !important;
        transform: none !important;
        box-sizing: border-box !important;
      }
      .agy-shell [data-testid="agent-response"] .md-table-scroll,
      .agy-shell [data-testid="agent-response"] :has(> table):not(.md-table-frame) {
        display: block !important;
        width: 100% !important;
        min-width: 0 !important;
        max-width: 100% !important;
        overflow-x: auto !important;
        overflow-y: hidden !important;
        padding-left: 0 !important;
        padding-right: 0 !important;
        padding-bottom: 2px !important;
        box-sizing: border-box !important;
        /* Keep standard scrollbar-width: auto so Chromium does not disable ::-webkit-scrollbar */
        scrollbar-width: auto !important;
        scrollbar-color: auto !important;
      }
      .agy-shell [data-testid="agent-response"] .md-table-frame {
        /* .md-table-frame sits INSIDE .md-table-scroll; forcing width:100% + overflow:hidden hid overflow from .md-table-scroll */
        width: fit-content !important;
        min-width: 100% !important;
        max-width: none !important;
        margin: 0 !important;
        transform: none !important;
        box-sizing: border-box !important;
      }
      .agy-shell [data-testid="agent-response"] .md-table-scroll::-webkit-scrollbar,
      .agy-shell [data-testid="agent-response"] :has(> table):not(.md-table-frame)::-webkit-scrollbar {
        height: 8px !important;
        display: block !important;
      }
      .agy-shell [data-testid="agent-response"] .md-table-scroll::-webkit-scrollbar-track,
      .agy-shell [data-testid="agent-response"] :has(> table):not(.md-table-frame)::-webkit-scrollbar-track {
        background: ${isLight ? 'rgba(15, 23, 42, 0.06)' : 'rgba(255, 255, 255, 0.06)'} !important;
        border-radius: 9999px !important;
      }
      .agy-shell [data-testid="agent-response"] .md-table-scroll::-webkit-scrollbar-thumb,
      .agy-shell [data-testid="agent-response"] :has(> table):not(.md-table-frame)::-webkit-scrollbar-thumb {
        background: ${isLight ? 'rgba(15, 23, 42, 0.34)' : 'rgba(148, 163, 184, 0.48)'} !important;
        border-radius: 9999px !important;
      }
      .agy-shell [data-testid="agent-response"] .md-table-scroll::-webkit-scrollbar-thumb:hover,
      .agy-shell [data-testid="agent-response"] :has(> table):not(.md-table-frame)::-webkit-scrollbar-thumb:hover {
        background: ${isLight ? 'rgba(15, 23, 42, 0.54)' : 'rgba(148, 163, 184, 0.72)'} !important;
      }
      .agy-shell [data-testid="agent-response"] table {
        width: 100% !important;
        min-width: 100% !important;
        max-width: none !important;
        margin: 0 !important;
        table-layout: auto !important;
        box-sizing: border-box !important;
      }
      .agy-shell [data-testid="agent-response"] :is(th, td) {
        max-width: none !important;
        white-space: normal !important;
        word-break: normal !important;
        overflow-wrap: break-word !important;
        padding: 8px 12px !important;
      }
      .agy-shell [data-testid="agent-response"] :is(td, th) .inline-pill-wrap {
        min-width: 0 !important;
      }
      ${isLight ? `
      .agy-shell [data-main-content-body="true"],
      .agy-shell [data-testid="agent-response"] :is(p, li, span, code, h1, h2, h3, h4, strong, td, th) {
        color: ${uiInk};
      }
      ` : ''}
      .agy-shell [data-main-content-body="true"] h1,
      .agy-shell [data-main-content-body="true"] h2 {
        text-shadow: ${isLight ? 'none' : '0 2px 10px rgba(0, 0, 0, 0.85)'};
      }
    ` : '';

    const effectiveBlur = Number.isFinite(st.glassBlur) ? `${st.glassBlur}px` : (mainTheme.headerBlur || '3px');
    const useUnifiedGlass = Boolean(st.wpEnabled && wpUrl && mainTheme.unifiedGlass);
    if (useUnifiedGlass && typeof syncShellMetrics === 'function') {
      syncShellMetrics();
    }
    if (useUnifiedGlass) {
      syncPrebakedGlass(wpUrl, overlayRgb, overlayAlpha, mainTheme.headerBg || '', effectiveBlur);
    } else {
      syncPrebakedGlass(null);
    }
    syncVideoAndRevealLayer(st, mainTheme, wpUrl, wpVideoUrl, isVideoMode, overlayRgb, overlayAlpha, bgPosition, effectiveBlur);

    const sidePanelCss = st.wpEnabled ? `
      /* Frosted pre-baked glass + dark/light reading scrim for right-side Artifact / Text / Diff split panels */
      ${useUnifiedGlass ? `
      .agy-shell[data-agy-side-glass="1"]::before {
        clip-path: polygon(
          evenodd,
          0 0,
          100% 0,
          100% var(--agy-hdr-h, 75px),
          var(--agy-sidebar-w, 256px) var(--agy-hdr-h, 75px),
          var(--agy-sidebar-w, 256px) 100%,
          0 100%,
          0 0,
          var(--agy-side-l, 100%) var(--agy-side-t, 75px),
          var(--agy-side-r, 100%) var(--agy-side-t, 75px),
          var(--agy-side-r, 100%) var(--agy-side-b, 100%),
          var(--agy-side-l, 100%) var(--agy-side-b, 100%),
          var(--agy-side-l, 100%) var(--agy-side-t, 75px)
        ) !important;
      }
      ` : ''}
      body:not([data-has-browser-hole="true"]) .agy-shell [data-side-panel-body="true"]:not([data-has-browser-hole="true"]):not(:has([data-browser-hole]:not([data-browser-hole="false"]))) {
        background: ${mainTheme.aiCardBg || `rgba(${overlayRgb}, 0.72)`} !important;
        ${isLight ? `color: ${uiInk} !important;` : ''}
        backdrop-filter: none !important;
        border-left: 1px solid ${mainTheme.aiCardBorder || (isLight ? 'rgba(15, 23, 42, 0.14)' : 'rgba(255, 255, 255, 0.14)')} !important;
        box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.04) !important;
      }
      body:not([data-has-browser-hole="true"]) .agy-shell [data-side-panel-body="true"]:not([data-has-browser-hole="true"]):not(:has([data-browser-hole]:not([data-browser-hole="false"]))) pre {
        background: ${preCodeBg} !important;
        border: 1px solid ${mainTheme.aiCardBorder || (isLight ? 'rgba(15, 23, 42, 0.14)' : 'rgba(255, 255, 255, 0.14)')} !important;
        border-radius: 10px !important;
      }
      .agy-shell [data-side-panel-body="true"] :is(h1, h2, h3, h4) {
        ${isLight ? `color: ${uiInk} !important;` : ''}
        text-shadow: ${isLight ? 'none' : '0 1px 6px rgba(0, 0, 0, 0.85)'};
      }
    ` : '';

    const headerCss = mainTheme.headerBg ? `
      /* Frosted top titlebar & seamless L-shaped unified glass (zero live backdrop-filter) */
      ${useUnifiedGlass ? `
      .agy-shell {
        position: relative !important;
      }
      .agy-shell > div:first-of-type {
        position: relative !important;
        z-index: 3 !important;
      }
      .agy-shell > div:not(:first-of-type) {
        position: relative !important;
        z-index: 2 !important;
      }
      .agy-shell::before {
        content: "";
        position: absolute;
        inset: 0;
        z-index: 1;
        pointer-events: none;
        ${isVideoMode ? `
        background-color: ${mainTheme.sidebarBg || 'rgba(7, 10, 18, 0.34)'};
        background-image: none;
        ` : `
        background-color: ${mainTheme.headerBg};
        background-image: var(--agy-l-glass-bg, none);
        background-size: cover;
        background-position: ${bgPosition};
        background-repeat: no-repeat;
        `}
        backdrop-filter: none !important;
        transition: opacity 0.28s ease;
        will-change: transform;
        clip-path: polygon(
          0 0,
          100% 0,
          100% var(--agy-hdr-h, 75px),
          var(--agy-sidebar-w, 256px) var(--agy-hdr-h, 75px),
          var(--agy-sidebar-w, 256px) 100%,
          0 100%
        );
      }
      .agy-shell.agy-revealing::before {
        opacity: 0 !important;
      }
      .agy-shell [class*="@container/titlebar"] {
        background: transparent !important;
        backdrop-filter: none !important;
        border-bottom: 1px solid ${mainTheme.headerBorder || 'rgba(56, 189, 248, 0.10)'} !important;
      }
      ` : `
      .agy-shell [class*="@container/titlebar"] {
        background: ${mainTheme.headerBg} !important;
        backdrop-filter: none !important;
        border-bottom: 1px solid ${mainTheme.headerBorder || 'rgba(56, 189, 248, 0.15)'} !important;
      }
      `}
      .agy-shell [class*="@container/titlebar"] [data-testid="breadcrumb-segment"],
      .agy-shell [class*="@container/titlebar"] [data-testid="pane-titlebar-toolbar"] button,
      .agy-shell [class*="@container/titlebar"] [data-testid="pane-titlebar-toolbar"] span {
        color: ${uiInk} !important;
        text-shadow: ${uiShadow};
      }
      .agy-shell [class*="@container/titlebar"] [data-testid="pane-titlebar-toolbar"] button.border {
        background: ${isLight ? 'rgba(255, 255, 255, 0.56)' : 'rgba(6, 11, 24, 0.36)'} !important;
        border-color: ${pillBorder} !important;
      }
    ` : '';

    const sidebarOuterCss = useUnifiedGlass ? `
      .agy-shell aside,
      .agy-shell [data-sidebar="true"],
      .agy-shell .bg-sidebar {
        background: transparent !important;
        backdrop-filter: none !important;
      }
    ` : `
      .agy-shell aside,
      .agy-shell [data-sidebar="true"],
      .agy-shell .bg-sidebar {
        background: ${sidebarBg} !important;
        backdrop-filter: none !important;
      }
    `;

    styleEl.textContent = `
      ${wpCss}

      /* Translucent themed sidebar (unified via ::before when unifiedGlass is active) */
      ${sidebarOuterCss}
      .agy-shell .bg-sidebar .bg-sidebar,
      .agy-shell [data-sidebar="true"] .bg-sidebar,
      .agy-shell .bg-sidebar [class*="group/headerbtn"],
      .agy-shell .bg-sidebar [class*="group/section-header"] {
        background: transparent !important;
        backdrop-filter: none !important;
      }
      /* Preserve virtual list positioning; hide sticky headers only while scrolled */
      .agy-shell .bg-sidebar .agy-scrolled > .w-full.relative > .bg-sidebar[style*="position: sticky"] {
        opacity: 0 !important;
        pointer-events: none !important;
        transition: opacity 0.14s ease !important;
      }
      .agy-shell .bg-sidebar [class*="group/headerbtn"]:hover,
      .agy-shell .bg-sidebar a:hover {
        background: ${sidebarHoverBg} !important;
      }
      ${sidebarEnhanceCss}
      ${aiCardCss}
      ${sidePanelCss}
      ${avatarCss}
      ${headerCss}

      /* "+ New Conversation" button glow */
      .agy-button-custom.border.border-border {
        background: ${btnBg} !important;
        border-color: ${mainTheme.borderColor} !important;
        box-shadow: 0 2px 12px rgba(0, 0, 0, 0.3) !important;
      }

      /* User Chat Bubble Double-Border Frame & Ornament */
      .agy-user-bubble-frame {
        background: ${bubbleTheme.frameBg} !important;
        border-radius: ${bubbleTheme.isScroll ? '6px' : '14px'} !important;
        box-shadow: 0 4px 18px rgba(0, 0, 0, 0.45), 0 0 12px ${bubbleTheme.glow} !important;
        position: relative !important;
        overflow: visible !important;
        padding: 1.2px !important;
      }

      .agy-user-bubble-frame::after {
        content: "";
        position: absolute;
        top: 3px;
        left: 3px;
        width: ${bubbleTheme.isOrnament ? '16px' : '14px'};
        height: ${bubbleTheme.isOrnament ? '16px' : '14px'};
        background-image: url("${cornerFiligreeUrl}");
        background-size: contain;
        background-repeat: no-repeat;
        pointer-events: none;
        opacity: ${bubbleTheme.isOrnament ? '0.85' : '0.65'};
      }

      .agy-user-bubble {
        background: ${bubbleTheme.bg} !important;
        border-radius: ${bubbleTheme.isScroll ? '5px' : '13px'} !important;
        padding: 8px 16px !important;
        color: ${bubbleTheme.textColor} !important;
        border: ${innerBubbleBorder} !important;
        overflow: visible !important;
        font-weight: 450 !important;
      }

      .agy-user-bubble * {
        color: ${bubbleTheme.textColor} !important;
      }

      /* Double-Border Input Composer */
      .surface-composer {
        background: ${inputOuterBorder} !important;
        border-radius: 16px !important;
        padding: 1.5px !important;
        box-shadow: 0 6px 24px rgba(0, 0, 0, 0.5), 0 0 14px ${bubbleTheme.glow} !important;
        position: relative !important;
      }

      /* New Conversation / Empty state has a top context bar (project & branch selectors) above .surface-composer-card:
         use a sleek smoked glass tray instead of painting bright border gradient behind the top strip */
      .surface-composer:has(> :not(.surface-composer-card)) {
        background: linear-gradient(180deg, rgba(${overlayRgb}, 0.78) 0%, rgba(${overlayRgb}, 0.90) 100%) !important;
        border: 1px solid ${bubbleTheme.borderColor || 'rgba(192, 132, 252, 0.36)'} !important;
        padding: 5px 6px 6px 6px !important;
      }

      .surface-composer-card {
        background: ${inputCardBg} !important;
        backdrop-filter: none !important;
        border-radius: 14.5px !important;
        border: ${bubbleTheme.innerBorder || '1px solid rgba(255, 255, 255, 0.07)'} !important;
      }

      .surface-composer:has(> :not(.surface-composer-card)) > .surface-composer-card {
        border-radius: 12px !important;
        border: 1px solid ${bubbleTheme.borderColor || 'rgba(192, 132, 252, 0.30)'} !important;
      }

      /* Guarantee input region above bottom model toolbar never collapses on initial mount */
      .surface-composer-card > :has(+ [data-testid="input-box-bottom-toolbar"]) {
        min-height: 40px !important;
        box-sizing: border-box !important;
      }

      /* High-contrast pill badges for top composer bar (adaptive light/dark theme) */
      .surface-composer [data-testid="project-selector-trigger"],
      .surface-composer [data-testid="branch-pill-trigger"],
      .surface-composer [aria-label="Select Environment"],
      .surface-composer > :not(.surface-composer-card) [data-testid="input-box-bottom-toolbar"] button,
      .surface-composer > :not(.surface-composer-card) [data-testid="input-box-bottom-toolbar"] [role="button"] {
        background: ${pillBg} !important;
        color: ${pillText} !important;
        border: 1px solid ${pillBorder} !important;
        border-radius: 9999px !important;
        font-weight: 500 !important;
        box-shadow: 0 1px 6px rgba(0, 0, 0, 0.25) !important;
        margin: 1px 2px !important;
        transition: background-color 0.15s ease, border-color 0.15s ease !important;
      }
      .surface-composer [data-testid="branch-pill-trigger"],
      .surface-composer [aria-label="Select Environment"],
      .surface-composer > :not(.surface-composer-card) [data-testid="input-box-bottom-toolbar"] button:not([data-testid="project-selector-trigger"]),
      .surface-composer > :not(.surface-composer-card) [data-testid="input-box-bottom-toolbar"] [role="button"]:not([data-testid="project-selector-trigger"]) {
        padding-left: 8px !important;
        padding-right: 7px !important;
        gap: 4px !important;
      }
      .surface-composer [data-testid="project-selector-trigger"]:hover,
      .surface-composer [data-testid="branch-pill-trigger"]:hover,
      .surface-composer [aria-label="Select Environment"]:hover,
      .surface-composer > :not(.surface-composer-card) [data-testid="input-box-bottom-toolbar"] button:hover,
      .surface-composer > :not(.surface-composer-card) [data-testid="input-box-bottom-toolbar"] [role="button"]:hover {
        background: ${pillHoverBg} !important;
        border-color: ${mainTheme.borderColor} !important;
        color: ${pillText} !important;
      }
      .surface-composer [data-testid="project-selector-trigger"] *,
      .surface-composer [data-testid="branch-pill-trigger"] *,
      .surface-composer [aria-label="Select Environment"] *,
      .surface-composer > :not(.surface-composer-card) [data-testid="input-box-bottom-toolbar"] button *,
      .surface-composer > :not(.surface-composer-card) [data-testid="input-box-bottom-toolbar"] [role="button"] * {
        color: ${pillText} !important;
      }
      .surface-composer > :not(.surface-composer-card) [data-testid="input-box-bottom-toolbar"] .ml-auto > * {
        background: ${pillBg} !important;
        color: ${pillText} !important;
        border-radius: 9999px !important;
        padding: 2px 8px !important;
      }

      ${bubbleStickerCss}
      ${inputStickerCss}

      @media (max-width: 640px) {
        .agy-user-bubble-frame::before,
        .surface-composer::before {
          transform: scale(0.78);
          transform-origin: bottom right;
        }
      }

      .settings-modal-container {
        background: ${modalBg} !important;
        border: 1px solid ${mainTheme.borderColor} !important;
        box-shadow: 0 12px 48px rgba(0, 0, 0, 0.75), 0 0 24px ${mainTheme.glow} !important;
        backdrop-filter: none !important;
      }

      #agy-custom-theme-modal-dialog {
        background: ${modalBg} !important;
        border-color: ${mainTheme.borderColor} !important;
        box-shadow: 0 24px 64px rgba(0, 0, 0, 0.9), 0 0 32px ${mainTheme.glow} !important;
      }
      #agy-custom-theme-modal-header {
        background: ${mainTheme.modalHeaderBg || 'rgba(22, 16, 14, 0.85)'} !important;
      }
      #agy-custom-theme-badge {
        color: ${mainTheme.primary} !important;
        border-color: ${mainTheme.borderColor} !important;
        background: ${mainTheme.glow} !important;
      }
      #agy-custom-theme-sidebar-btn svg {
        color: ${mainTheme.primary} !important;
      }
      .agy-shell > #agy-live-bg-layer,
      #agy-live-bg-layer {
        display: block !important;
        position: absolute !important;
        inset: 0 !important;
        width: 100% !important;
        height: 100% !important;
        z-index: 0 !important;
        pointer-events: none !important;
        overflow: hidden !important;
        margin: 0 !important;
        padding: 0 !important;
      }
      #agy-live-bg-layer.agy-bg-hidden {
        display: none !important;
      }
      body[data-has-browser-hole="true"] .agy-shell[data-agy-hole-active="1"] > #agy-live-bg-layer {
        clip-path: var(--agy-hole-clip, none) !important;
      }
      /* Harmonious Modern Typography (Plus Jakarta Sans + JetBrains Mono) */
      .agy-shell {
        font-family: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI Variable Text', 'Segoe UI', sans-serif !important;
        -webkit-font-smoothing: antialiased;
      }
      .agy-shell [data-testid="agent-response"],
      .agy-shell [data-testid="user-message"] {
        font-family: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI Variable Text', 'Segoe UI', sans-serif !important;
        font-size: 15.2px !important;
        line-height: 1.68 !important;
      }
      .agy-shell .surface-composer textarea:not(.inputarea),
      .agy-shell .surface-composer [contenteditable="true"] {
        font-family: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI Variable Text', 'Segoe UI', sans-serif !important;
        font-size: 15px !important;
        line-height: 1.5 !important;
        min-height: 26px !important;
      }
      .agy-shell :is(pre, code, kbd, samp),
      .agy-shell [class*="font-mono"] {
        font-family: 'JetBrains Mono', 'Cascadia Code', Consolas, monospace !important;
      }

      .agy-shell [data-agy-greeting] {
        font-size: 0 !important;
        line-height: 0 !important;
        color: transparent !important;
        text-shadow: none !important;
      }
      .agy-shell [data-agy-greeting]::after {
        content: attr(data-agy-greeting);
        font-family: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI Variable Display', sans-serif !important;
        font-size: clamp(27px, 2.55vw, 35px) !important;
        line-height: 1.32 !important;
        font-weight: 700 !important;
        letter-spacing: -0.025em !important;
        color: ${isLight ? '#0f172a' : '#fafafa'} !important;
        text-shadow: ${isLight ? '0 1px 2px rgba(255, 255, 255, 0.55)' : '0 4px 24px rgba(0, 0, 0, 0.72)'} !important;
        display: block !important;
        text-align: center !important;
        max-width: 840px;
        margin: 0 auto;
        white-space: normal !important;
      }
    `;

    syncTitleBarOverlay(st);
    scheduleTitleBarSync(st);
    syncEmptyGreeting(st);
  }

  function syncTitleBarOverlay(stOverride) {
    const st = stOverride || getState();
    const activeTh = THEMES[st.themeName] || THEMES[DEFAULT_THEME_KEY] || {};
    if (window.electronNative && typeof window.electronNative.setTitleBarOverlay === 'function') {
      try {
        window.electronNative.setTitleBarOverlay({
          color: st.wpEnabled ? '#00000000' : '#111114',
          symbolColor: (st.wpEnabled && activeTh.isLight) ? '#0f172a' : '#f8fafc'
        });
      } catch (e) {}
    }
  }

  function clearTitleBarTimers() {
    if (Array.isArray(window.__AGY_TBO_TIMERS__)) {
      window.__AGY_TBO_TIMERS__.forEach(id => clearTimeout(id));
    }
    window.__AGY_TBO_TIMERS__ = [];
  }

  function scheduleTitleBarSync(stOverride) {
    clearTitleBarTimers();
    const st = stOverride || getState();
    syncTitleBarOverlay(st);
    [300, 900, 2000, 4000, 7000].forEach(ms => {
      window.__AGY_TBO_TIMERS__.push(setTimeout(() => syncTitleBarOverlay(), ms));
    });
  }

  function removeCustomTheme() {
    if (!sessionAuthenticated) return;
    clearTitleBarTimers();
    clearRevealRaf();
    teardownBootOverlay();
    stopTaskAudio();
    if (window.__AGY_TASK_COMPLETE_TIMER__) {
      clearTimeout(window.__AGY_TASK_COMPLETE_TIMER__);
      window.__AGY_TASK_COMPLETE_TIMER__ = null;
    }
    if (window.__AGY_MODAL_OBSERVER__) {
      try { window.__AGY_MODAL_OBSERVER__.disconnect(); } catch (e) {}
      window.__AGY_MODAL_OBSERVER__ = null;
    }
    if (window.__AGY_TICK_RAF__) {
      cancelAnimationFrame(window.__AGY_TICK_RAF__);
      window.__AGY_TICK_RAF__ = 0;
    }
    if (window.__AGY_SHELL_RO__) {
      try { window.__AGY_SHELL_RO__.disconnect(); } catch (e) {}
      window.__AGY_SHELL_RO__ = null;
    }
    if (window.__AGY_SCROLL_AC__) {
      try { window.__AGY_SCROLL_AC__.abort(); } catch (e) {}
    }
    const liveBgLayer = document.getElementById('agy-live-bg-layer');
    if (liveBgLayer) liveBgLayer.remove();
    const styleEl = document.getElementById('antigravity-custom-theme-active');
    if (styleEl) styleEl.remove();
    const fontStyleEl = document.getElementById('agy-greeting-font-style');
    if (fontStyleEl) fontStyleEl.remove();
    const navBtn = document.getElementById('agy-custom-theme-sidebar-btn');
    if (navBtn) navBtn.remove();
    const settingsBtn = document.getElementById('agy-custom-theme-settings-btn');
    if (settingsBtn) settingsBtn.remove();
    const modal = document.getElementById('agy-custom-theme-modal-backdrop');
    if (modal) modal.remove();
    document.querySelectorAll('[data-agy-greeting]').forEach((el) => {
      el.removeAttribute('data-agy-greeting');
      delete el.dataset.agyGreetingOrig;
    });
    const shell = findActiveShell();
    if (shell) {
      shell.classList.remove('agy-revealing');
      delete shell.dataset.agyHoleActive;
      shell.style.removeProperty('--agy-hole-clip');
      shell.style.removeProperty('--agy-l-glass-bg');
    }
    if (window.electronNative && typeof window.electronNative.setTitleBarOverlay === 'function') {
      try {
        window.electronNative.setTitleBarOverlay({ color: '#111114', symbolColor: '#f8fafc' });
      } catch (e) {}
    }
  }

  window.__ANTIGRAVITY_APPLY_CUSTOM_THEME__ = applyTheme;
  window.__ANTIGRAVITY_REMOVE_CUSTOM_THEME__ = removeCustomTheme;
  window.__ANTIGRAVITY_OPEN_THEME_MODAL__ = openCustomThemeModal;

  function bootstrapEngineDom() {
    applyTheme();
    mountBootSequence(false);
  }
  if (document.body && document.head) {
    bootstrapEngineDom();
  } else {
    document.addEventListener('DOMContentLoaded', bootstrapEngineDom, { once: true });
  }

  function openCustomThemeModal() {
    let backdrop = document.getElementById('agy-custom-theme-modal-backdrop');
    if (!backdrop) {
      backdrop = document.createElement('div');
      backdrop.id = 'agy-custom-theme-modal-backdrop';
      backdrop.style.cssText = `
        position: fixed;
        inset: 0;
        z-index: 99999;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 32px;
        background: rgba(0, 0, 0, 0.65);
        backdrop-filter: blur(10px);
      `;

      backdrop.innerHTML = `
        <div id="agy-custom-theme-modal-dialog" style="background: rgba(16, 12, 11, 0.97); border: 1.2px solid rgba(212, 148, 106, 0.35); border-radius: 18px; width: 100%; max-width: 900px; height: 86vh; max-height: 860px; display: flex; flex-direction: column; overflow: hidden; box-shadow: 0 24px 64px rgba(0, 0, 0, 0.9), 0 0 32px rgba(224, 142, 85, 0.25); font-family: system-ui, -apple-system, sans-serif;">
          <div id="agy-custom-theme-modal-header" style="display: flex; justify-content: space-between; align-items: center; padding: 18px 26px; border-bottom: 1px solid rgba(255, 255, 255, 0.08); background: rgba(22, 16, 14, 0.85);">
            <div style="display: flex; align-items: center; gap: 10px;">
              <span style="font-size: 17px; font-weight: 600; color: #f4f4f5; letter-spacing: -0.2px;">Custom Theme Studio</span>
              <span id="agy-custom-theme-badge" style="font-size: 11.5px; padding: 2.5px 9px; border-radius: 9999px; background: rgba(224, 142, 85, 0.2); color: #e08e55; font-weight: 500; border: 1px solid rgba(224, 142, 85, 0.3);">${THEME_KEYS.length} Preset${THEME_KEYS.length > 1 ? 's' : ''}</span>
            </div>
            <button id="agy-theme-modal-close-btn" type="button" style="background: rgba(255, 255, 255, 0.06); border: 1px solid rgba(255, 255, 255, 0.1); color: #d4d4d8; cursor: pointer; width: 30px; height: 30px; border-radius: 8px; font-size: 15px; display: flex; align-items: center; justify-content: center; transition: all 0.15s ease;">✕</button>
          </div>
          <div id="agy-theme-modal-body" style="flex: 1; overflow-y: auto; height: 100%;"></div>
        </div>
      `;

      document.body.appendChild(backdrop);

      backdrop.addEventListener('click', (e) => {
        if (e.target === backdrop) backdrop.style.display = 'none';
      });
      backdrop.querySelector('#agy-theme-modal-close-btn').addEventListener('click', () => {
        backdrop.style.display = 'none';
      });
      window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && backdrop.style.display !== 'none') {
          backdrop.style.display = 'none';
        }
      });
    }

    backdrop.style.display = 'flex';
    const body = backdrop.querySelector('#agy-theme-modal-body');
    renderThemePanels(body);
  }

  function renderThemePanels(container) {
    const st = getState();
    const mainTheme = THEMES[st.themeName] || THEMES[DEFAULT_THEME_KEY];
    const effUserAv = st.userAvatar === 'none' ? '' : (st.userAvatar || mainTheme.userAvatar || '');
    const effAgentAv = st.agentAvatar === 'none' ? '' : (st.agentAvatar || mainTheme.agentAvatar || '');

    container.innerHTML = `
      <div id="agy-theme-scroll-container" style="padding: 24px 32px 48px 32px; max-width: 860px; margin: 0 auto; overflow-y: auto; height: 100%; color: #f4f4f5;">
        <div style="border: 1px solid ${mainTheme.borderColor}; background: ${mainTheme.cardBg || 'rgba(22, 16, 14, 0.72)'}; border-radius: 12px; padding: 16px 20px; margin-bottom: 14px; display: flex; flex-direction: column; gap: 12px;">
          <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 10px;">
            <div>
              <div style="font-size: 14.5px; font-weight: 600; color: #f4f4f5; margin-bottom: 2px;">Wallpaper, Pre-Baked Blur & Config</div>
              <div style="font-size: 12.5px; color: #a1a1aa;">Balance artwork clarity, 120fps pre-baked frosted glass blur, or share config JSON.</div>
            </div>
            <div style="display: flex; align-items: center; gap: 10px; flex-wrap: wrap;">
              <label style="display: flex; align-items: center; gap: 6px; font-size: 12.5px; color: #d4d4d8; cursor: pointer;">
                <input id="agy-wp-toggle" type="checkbox" ${st.wpEnabled ? 'checked' : ''} style="accent-color: ${mainTheme.primary}; cursor: pointer;" />
                Backdrop
              </label>
              <label style="display: flex; align-items: center; gap: 6px; font-size: 12px; color: #a1a1aa;">
                Dim
                <input id="agy-dim-slider" type="range" min="15" max="92" value="${st.dimming}" style="width: 96px; cursor: pointer; accent-color: #ffffff; height: 5px;" />
                <span id="agy-dim-val" style="min-width: 32px; text-align: right;">${st.dimming}%</span>
              </label>
              <label style="display: flex; align-items: center; gap: 6px; font-size: 12px; color: #a1a1aa;">
                Blur
                <input id="agy-blur-slider" type="range" min="0" max="16" value="${st.glassBlur}" style="width: 78px; cursor: pointer; accent-color: ${mainTheme.primary}; height: 5px;" />
                <span id="agy-blur-val" style="min-width: 30px; text-align: right;">${st.glassBlur}px</span>
              </label>
              <div style="display: inline-flex; border-radius: 8px; overflow: hidden; border: 1px solid ${mainTheme.borderColor}; background: rgba(0,0,0,0.28);">
                <button id="agy-mode-image" type="button" style="padding: 4px 10px; font-size: 11.5px; cursor: pointer; border: none; background: ${st.wpMode === 'image' ? 'rgba(255,255,255,0.18)' : 'transparent'}; color: ${st.wpMode === 'image' ? '#ffffff' : '#a1a1aa'}; font-weight: ${st.wpMode === 'image' ? '600' : '400'};">Ảnh tĩnh</button>
                <button id="agy-mode-video" type="button" style="padding: 4px 10px; font-size: 11.5px; cursor: pointer; border: none; border-left: 1px solid ${mainTheme.borderColor}; background: ${st.wpMode === 'video' ? 'rgba(255,255,255,0.18)' : 'transparent'}; color: ${st.wpMode === 'video' ? '#ffffff' : '#a1a1aa'}; font-weight: ${st.wpMode === 'video' ? '600' : '400'};">Video động</button>
              </div>
              <label style="padding: 5px 10px; border-radius: 8px; background: rgba(255, 255, 255, 0.08); border: 1px solid ${mainTheme.borderColor}; color: #f4f4f5; font-size: 12px; cursor: pointer; white-space: nowrap;">
                Chọn Ảnh / Video
                <input id="agy-wp-upload" type="file" accept="image/*,video/mp4,video/webm,video/quicktime,video/*" style="display: none;" />
              </label>
              <button id="agy-export-btn" type="button" style="padding: 5px 10px; border-radius: 8px; background: rgba(255, 255, 255, 0.08); border: 1px solid rgba(255, 255, 255, 0.16); color: #f4f4f5; font-size: 12px; cursor: pointer; white-space: nowrap;">
                Export JSON
              </button>
              <button id="agy-import-toggle" type="button" style="padding: 5px 10px; border-radius: 8px; background: rgba(255, 255, 255, 0.08); border: 1px solid rgba(255, 255, 255, 0.16); color: #f4f4f5; font-size: 12px; cursor: pointer; white-space: nowrap;">
                Import JSON
              </button>
              <button id="agy-reset-btn" type="button" style="padding: 5px 10px; border-radius: 8px; background: rgba(239, 68, 68, 0.14); border: 1px solid rgba(239, 68, 68, 0.35); color: #fca5a5; font-size: 12px; cursor: pointer; white-space: nowrap;">
                Reset
              </button>
            </div>
          </div>
          <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 10px; padding-top: 8px; border-top: 1px solid rgba(255,255,255,0.07);">
            <div style="display: flex; align-items: center; gap: 14px; flex-wrap: wrap;">
              <label style="display: flex; align-items: center; gap: 6px; font-size: 12px; color: #d4d4d8; cursor: pointer;">
                <input id="agy-boot-toggle" type="checkbox" ${st.bootIntro ? 'checked' : ''} style="accent-color: ${mainTheme.primary}; cursor: pointer;" />
                Boot Intro + Tawa Voice
              </label>
              <label style="display: flex; align-items: center; gap: 6px; font-size: 12px; color: #d4d4d8; cursor: pointer;">
                <input id="agy-sketch-toggle" type="checkbox" ${st.sketchReveal ? 'checked' : ''} style="accent-color: ${mainTheme.primary}; cursor: pointer;" />
                Vẽ nét → Loang màu
              </label>
              <label style="display: flex; align-items: center; gap: 6px; font-size: 12px; color: #d4d4d8; cursor: pointer;">
                <input id="agy-greeting-toggle" type="checkbox" ${st.tawaGreeting ? 'checked' : ''} style="accent-color: ${mainTheme.primary}; cursor: pointer;" />
                Câu chào Custom
              </label>
              <label style="display: flex; align-items: center; gap: 6px; font-size: 12px; color: #d4d4d8; cursor: pointer;">
                <input id="agy-task-voice-toggle" type="checkbox" ${st.taskVoiceEnabled ? 'checked' : ''} style="accent-color: ${mainTheme.primary}; cursor: pointer;" />
                Voice xong Task
              </label>
              <span id="agy-upload-status" style="font-size: 11.5px; color: #93c5fd;"></span>
            </div>
            <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
              <button id="agy-custom-vg-toggle" type="button" style="padding: 4px 10px; border-radius: 7px; background: rgba(255,255,255,0.08); border: 1px solid ${mainTheme.borderColor}; color: #e4e4e7; font-size: 11.5px; cursor: pointer;">
                Tùy chỉnh Voice &amp; Câu chào ▾
              </button>
              <button id="agy-replay-boot-btn" type="button" style="padding: 4px 10px; border-radius: 7px; background: rgba(255,255,255,0.08); border: 1px solid ${mainTheme.borderColor}; color: #e4e4e7; font-size: 11.5px; cursor: pointer;">
                Replay Intro
              </button>
              <button id="agy-replay-reveal-btn" type="button" style="padding: 4px 10px; border-radius: 7px; background: rgba(255,255,255,0.08); border: 1px solid ${mainTheme.borderColor}; color: #e4e4e7; font-size: 11.5px; cursor: pointer;">
                Replay Vẽ Nền
              </button>
            </div>
          </div>
          <div id="agy-custom-vg-box" style="display: none; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 14px; padding-top: 10px; border-top: 1px solid rgba(255,255,255,0.08);">
            <div style="display: flex; flex-direction: column; gap: 8px; background: rgba(0,0,0,0.25); border: 1px solid rgba(255,255,255,0.08); border-radius: 10px; padding: 12px;">
              <div style="display: flex; justify-content: space-between; align-items: center; gap: 8px; flex-wrap: wrap;">
                <span style="font-size: 12.5px; font-weight: 600; color: #f4f4f5;">Voice báo xong Task (Random)</span>
                <div style="display: flex; align-items: center; gap: 6px;">
                  <button id="agy-task-voice-test" type="button" title="Nghe thử ngẫu nhiên" style="padding: 4px 8px; border-radius: 7px; background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.14); color: #e4e4e7; font-size: 11.5px; cursor: pointer;">🎲 Test</button>
                  <label style="padding: 4px 9px; border-radius: 7px; background: rgba(255, 255, 255, 0.08); border: 1px solid ${mainTheme.borderColor}; color: #f4f4f5; font-size: 11.5px; cursor: pointer; white-space: nowrap;">
                    Thêm Voice
                    <input id="agy-task-voice-upload" type="file" multiple accept="audio/*,.mp3,.wav,.ogg,.m4a,.aac,.flac" style="display: none;" />
                  </label>
                </div>
              </div>
              <div style="display: flex; align-items: center; gap: 8px;">
                <span style="font-size: 11.5px; color: #a1a1aa;">Âm lượng</span>
                <input id="agy-task-voice-vol" type="range" min="0" max="100" value="${st.taskVoiceVol}" style="flex: 1; cursor: pointer; accent-color: ${mainTheme.primary}; height: 5px;" />
                <span id="agy-task-voice-vol-val" style="min-width: 34px; text-align: right; font-size: 11.5px; color: #d4d4d8;">${st.taskVoiceVol}%</span>
              </div>
              <div id="agy-task-voice-list" style="display: flex; flex-direction: column; gap: 5px; max-height: 112px; overflow-y: auto;"></div>
              <div style="font-size: 11px; color: #71717a;">Chỉ tạo Audio khi tác vụ vừa xong rồi tự hủy (0 MB RAM khi rảnh).</div>
            </div>
            <div style="display: flex; flex-direction: column; gap: 8px; background: rgba(0,0,0,0.25); border: 1px solid rgba(255,255,255,0.08); border-radius: 10px; padding: 12px;">
              <div style="display: flex; justify-content: space-between; align-items: center; gap: 8px;">
                <span style="font-size: 12.5px; font-weight: 600; color: #f4f4f5;">Câu chào Custom (mỗi dòng 1 câu)</span>
                <span id="agy-greeting-msg" style="font-size: 11px; color: #93c5fd;"></span>
              </div>
              <textarea id="agy-greeting-lines" rows="4" placeholder="Nhập câu chào riêng của bạn (mỗi dòng 1 câu)..." style="width: 100%; box-sizing: border-box; background: rgba(0,0,0,0.38); color: #f4f4f5; border: 1px solid ${mainTheme.borderColor}; border-radius: 7px; padding: 7px 9px; font-size: 12px; resize: vertical; line-height: 1.45;">${escapeHtml((st.customGreetings || []).join('\n'))}</textarea>
              <div style="display: flex; justify-content: flex-end; gap: 8px;">
                <button id="agy-greeting-reset" type="button" style="padding: 4px 10px; border-radius: 7px; background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.14); color: #d4d4d8; font-size: 11.5px; cursor: pointer;">Xóa hết</button>
                <button id="agy-greeting-save" type="button" style="padding: 4px 12px; border-radius: 7px; background: ${mainTheme.primary}; color: #090d16; font-weight: 600; font-size: 11.5px; border: none; cursor: pointer;">Lưu câu chào</button>
              </div>
            </div>
          </div>
          <div id="agy-import-box" style="display: none; flex-direction: column; gap: 8px; padding-top: 8px; border-top: 1px solid rgba(255,255,255,0.08);">
            <textarea id="agy-import-text" rows="3" placeholder='Paste exported theme config JSON here (e.g. {"themeName":"WLOP Cosmic","dimming":45,...})' style="width: 100%; box-sizing: border-box; background: rgba(0,0,0,0.35); color: #f4f4f5; border: 1px solid ${mainTheme.borderColor}; border-radius: 8px; padding: 8px 10px; font-family: monospace; font-size: 12px; resize: vertical;"></textarea>
            <div style="display: flex; justify-content: flex-end; align-items: center; gap: 8px;">
              <span id="agy-import-msg" style="font-size: 12px; color: #fca5a5;"></span>
              <button id="agy-import-apply" type="button" style="padding: 5px 12px; border-radius: 7px; background: ${mainTheme.primary}; color: #090d16; font-weight: 600; font-size: 12px; border: none; cursor: pointer;">Apply JSON</button>
            </div>
          </div>
        </div>

        <div style="border: 1px solid ${mainTheme.borderColor}; background: ${mainTheme.cardBg || 'rgba(22, 16, 14, 0.72)'}; border-radius: 12px; padding: 14px 20px; margin-bottom: 24px; display: flex; flex-direction: column; gap: 10px;">
          <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px;">
            <div>
              <div style="font-size: 14px; font-weight: 600; color: #f4f4f5; margin-bottom: 2px;">Chat Avatars (User & AI Agent)</div>
              <div style="font-size: 12px; color: #a1a1aa;">Profile badges rendered beside chat messages (auto-compressed WebP).</div>
            </div>
            <div style="display: flex; align-items: center; gap: 16px; flex-wrap: wrap;">
              <div style="display: flex; align-items: center; gap: 8px;">
                <div id="agy-user-av-preview" style="width: 30px; height: 30px; border-radius: ${st.avatarRadius}%; border: 1.5px solid ${mainTheme.primary}; background: rgba(255,255,255,0.06) ${effUserAv ? `url('${effUserAv}') center/cover no-repeat` : ''}; display: flex; align-items: center; justify-content: center; font-size: 11px; color: #a1a1aa;">${effUserAv ? '' : 'U'}</div>
                <label style="padding: 4px 10px; border-radius: 7px; background: rgba(255, 255, 255, 0.08); border: 1px solid ${mainTheme.borderColor}; color: #f4f4f5; font-size: 12px; cursor: pointer; white-space: nowrap;">
                  User
                  <input id="agy-user-av-upload" type="file" accept="image/*" style="display: none;" />
                </label>
                <button id="agy-user-av-clear" type="button" style="padding: 4px 8px; border-radius: 7px; background: transparent; border: 1px solid rgba(255, 255, 255, 0.14); color: #a1a1aa; font-size: 11.5px; cursor: pointer;">Off</button>
              </div>
              <div style="display: flex; align-items: center; gap: 8px;">
                <div id="agy-agent-av-preview" style="width: 30px; height: 30px; border-radius: ${st.avatarRadius}%; border: 1.5px solid ${mainTheme.secondary || mainTheme.primary}; background: rgba(255,255,255,0.06) ${effAgentAv ? `url('${effAgentAv}') center/cover no-repeat` : ''}; display: flex; align-items: center; justify-content: center; font-size: 11px; color: #a1a1aa;">${effAgentAv ? '' : 'AI'}</div>
                <label style="padding: 4px 10px; border-radius: 7px; background: rgba(255, 255, 255, 0.08); border: 1px solid ${mainTheme.borderColor}; color: #f4f4f5; font-size: 12px; cursor: pointer; white-space: nowrap;">
                  Agent
                  <input id="agy-agent-av-upload" type="file" accept="image/*" style="display: none;" />
                </label>
                <button id="agy-agent-av-clear" type="button" style="padding: 4px 8px; border-radius: 7px; background: transparent; border: 1px solid rgba(255, 255, 255, 0.14); color: #a1a1aa; font-size: 11.5px; cursor: pointer;">Off</button>
              </div>
            </div>
          </div>
          <div style="display: flex; align-items: center; gap: 20px; flex-wrap: wrap; padding-top: 6px; border-top: 1px solid rgba(255,255,255,0.07);">
            <label style="display: flex; align-items: center; gap: 8px; font-size: 12px; color: #a1a1aa;">
              Size
              <input id="agy-av-size" type="range" min="22" max="52" value="${st.avatarSize}" style="width: 100px; cursor: pointer; accent-color: ${mainTheme.primary}; height: 5px;" />
              <span id="agy-av-size-val" style="min-width: 34px;">${st.avatarSize}px</span>
            </label>
            <label style="display: flex; align-items: center; gap: 8px; font-size: 12px; color: #a1a1aa;">
              Corner Radius
              <input id="agy-av-rad" type="range" min="0" max="50" value="${st.avatarRadius}" style="width: 100px; cursor: pointer; accent-color: ${mainTheme.primary}; height: 5px;" />
              <span id="agy-av-rad-val" style="min-width: 34px;">${st.avatarRadius}%</span>
            </label>
          </div>
        </div>

        <div style="border: 1px solid ${mainTheme.borderColor}; background: ${mainTheme.cardBg || 'rgba(22, 16, 14, 0.72)'}; border-radius: 12px; padding: 15px 20px; margin-bottom: 24px; display: flex; flex-direction: column; gap: 12px;">
          <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 10px;">
            <div>
              <div style="font-size: 14px; font-weight: 600; color: #f4f4f5; margin-bottom: 2px;">Multi-Factor Security Vault (scrypt · Face ID · PIN · Win Hello · Terminal)</div>
              <div style="font-size: 12px; color: #a1a1aa;">Credentials are hashed server-side in auth_vault.json (scrypt + CSPRNG token + brute-force lockout).</div>
            </div>
            <div style="display: flex; align-items: center; gap: 10px; flex-wrap: wrap;">
              <label style="display: flex; align-items: center; gap: 6px; font-size: 12.5px; color: #e9d5ff; font-weight: 600; cursor: pointer;">
                <input id="agy-auth-lock-toggle" type="checkbox" ${st.authLock ? 'checked' : ''} style="accent-color: ${mainTheme.primary}; cursor: pointer;" />
                Require MFA on Boot
              </label>
              <button id="agy-mfa-test-btn" type="button" style="padding: 5px 11px; border-radius: 8px; background: rgba(168, 85, 247, 0.18); border: 1px solid ${mainTheme.borderColor}; color: #f3e8ff; font-size: 12px; font-weight: 600; cursor: pointer;">
                Test Lock Screen
              </button>
              <button id="agy-face-reset-btn" type="button" style="padding: 5px 10px; border-radius: 8px; background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.14); color: #d4d4d8; font-size: 12px; cursor: pointer;">
                Reset Face ID
              </button>
            </div>
          </div>
          <div style="display: flex; align-items: center; gap: 10px; flex-wrap: wrap; padding-top: 8px; border-top: 1px solid rgba(255,255,255,0.07);">
            <span style="font-size: 12px; color: #d8b4fe; font-weight: 600;">Authorize Changes:</span>
            <input id="agy-cur-pin-auth" type="password" inputmode="numeric" maxlength="6" placeholder="Current 6-digit PIN..." style="width: 190px; background: rgba(0,0,0,0.42); color: #ffffff; border: 1px solid ${mainTheme.borderColor}; border-radius: 8px; padding: 6px 10px; font-family: 'JetBrains Mono', monospace; font-size: 12.5px;" />
            <span style="font-size: 11.5px; color: #a1a1aa;">Required once per 5 min before changing PIN, passphrase, key chord, or MFA lock.</span>
          </div>
          <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(230px, 1fr)); gap: 10px; padding-top: 4px;">
            <div style="display: flex; align-items: center; gap: 8px;">
              <input id="agy-new-pin-input" type="password" inputmode="numeric" maxlength="6" placeholder="New 6-digit PIN..." style="flex: 1; background: rgba(0,0,0,0.36); color: #ffffff; border: 1px solid ${mainTheme.borderColor}; border-radius: 8px; padding: 6px 10px; font-family: 'JetBrains Mono', monospace; font-size: 12.5px;" />
              <button id="agy-save-pin-btn" type="button" style="padding: 6px 12px; border-radius: 8px; background: ${mainTheme.primary}; color: #090612; font-weight: 600; font-size: 12px; border: none; cursor: pointer; white-space: nowrap;">Save PIN</button>
            </div>
            <div style="display: flex; align-items: center; gap: 8px;">
              <input id="agy-new-pass-input" type="password" placeholder="New Terminal passphrase..." style="flex: 1; background: rgba(0,0,0,0.36); color: #ffffff; border: 1px solid ${mainTheme.borderColor}; border-radius: 8px; padding: 6px 10px; font-family: 'JetBrains Mono', monospace; font-size: 12.5px;" />
              <button id="agy-save-pass-btn" type="button" style="padding: 6px 12px; border-radius: 8px; background: rgba(255,255,255,0.12); color: #ffffff; font-weight: 600; font-size: 12px; border: 1px solid rgba(255,255,255,0.18); cursor: pointer; white-space: nowrap;">Save Pass</button>
            </div>
            <div style="display: flex; align-items: center; gap: 8px;">
              <button id="agy-record-chord-btn" type="button" style="flex: 1; padding: 6px 10px; border-radius: 8px; background: rgba(168,85,247,0.16); color: #f3e8ff; font-weight: 600; font-size: 12px; border: 1px solid ${mainTheme.borderColor}; cursor: pointer; white-space: nowrap;">
                ${serverHasKeyChord ? 'Update 3-Key Chord' : 'Record 3-Key Chord'}
              </button>
              <button id="agy-clear-chord-btn" type="button" style="padding: 6px 10px; border-radius: 8px; background: rgba(255,255,255,0.06); color: #d4d4d8; font-size: 12px; border: 1px solid rgba(255,255,255,0.14); cursor: pointer; white-space: nowrap;">Clear</button>
            </div>
          </div>
          <div id="agy-mfa-settings-msg" style="font-size: 11.5px; color: #34d399; min-height: 14px;"></div>
        </div>

        <div style="margin-bottom: 28px;">
          <div style="font-size: 15px; font-weight: 600; color: #ffffff; margin-bottom: 4px;">User Chat Bubble</div>
          <div style="font-size: 12.5px; color: #a1a1aa; margin-bottom: 14px;">Mix and match bubble frame & ornament independently from the active wallpaper.</div>
          <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px;">
            ${THEME_KEYS.map(name => {
              const th = THEMES[name];
              const isSelected = name === st.bubbleName;
              const stickerTop = th.isOrnament ? Math.round((th.stickerTop || 0) * 0.85) : Math.round((th.stickerTop || 0) * 0.74);
              const stickerW = Math.round((th.stickerW || 0) * 0.78);
              const stickerH = th.isOrnament ? Math.round((th.stickerH || 0) * 0.8) : Math.round((th.stickerH || 0) * 0.78);
              return `
                <div class="agy-bubble-card" data-name="${name}" style="position: relative; border-radius: 12px; border: ${isSelected ? '1.5px solid #f4f4f5' : '1px solid rgba(255, 255, 255, 0.12)'}; background: ${isSelected ? 'rgba(42, 34, 30, 0.68)' : 'rgba(14, 12, 12, 0.78)'}; padding: 24px 18px 14px 18px; cursor: pointer; display: flex; flex-direction: column; justify-content: space-between; min-height: 112px; transition: border-color 0.15s ease, background-color 0.15s ease;">
                  <div style="display: flex; justify-content: center; align-items: center; width: 100%; margin-top: 6px; margin-bottom: 10px;">
                    <div style="position: relative; width: 192px; height: 46px; padding: 1.2px; border-radius: ${th.isScroll ? '6px' : '12px'}; background: ${th.frameBg}; box-shadow: 0 4px 14px rgba(0,0,0,0.45), 0 0 10px ${th.glow};">
                      <div style="position: relative; width: 100%; height: 100%; background: ${th.bg}; border: ${th.innerBorder || '1px solid ' + th.borderColor}; border-radius: ${th.isScroll ? '4px' : '11px'}; display: flex; align-items: center; padding: 0 16px;">
                        ${th.sticker ? `<div style="position: absolute; top: ${stickerTop}px; right: 8px; width: ${stickerW}px; height: ${stickerH}px; background-image: url('${th.sticker}'); background-size: contain; background-position: ${th.isOrnament ? 'center' : 'bottom center'}; background-repeat: no-repeat; pointer-events: none;"></div>` : ''}
                        <span style="font-size: 13.5px; font-weight: 500; color: ${th.textColor};">Hello ✨</span>
                      </div>
                    </div>
                  </div>
                  <div style="display: flex; justify-content: space-between; align-items: center;">
                    <span style="font-size: 13.5px; font-weight: 500; color: #e4e4e7;">${name}</span>
                    <div class="agy-card-check-slot">${isSelected ? CHECK_SVG : ''}</div>
                  </div>
                </div>
              `;
            }).join('')}
          </div>
        </div>

        <div style="margin-bottom: 28px;">
          <div style="font-size: 15px; font-weight: 600; color: #ffffff; margin-bottom: 4px;">Composer Style</div>
          <div style="font-size: 12.5px; color: #a1a1aa; margin-bottom: 14px;">Customize the chat input frame without affecting keyboard shortcuts or attachments.</div>
          <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px;">
            ${Object.entries(INPUT_STYLES).map(([key, item]) => {
              const isSelected = key === st.inputStyle;
              const activeBubbleTh = THEMES[st.bubbleName] || mainTheme;
              const previewStickerStyle = activeBubbleTh.isOrnament
                ? 'top: -12px; right: 10px; width: 72px; height: 22px; background-position: center;'
                : 'top: -22px; right: 10px; width: 32px; height: 28px; background-position: bottom center;';
              const previewInnerBg = key === 'glass'
                ? (activeBubbleTh.inputGlassBg || 'rgba(20, 15, 13, 0.45)')
                : (activeBubbleTh.inputCardBg || 'rgba(26, 18, 15, 0.92)');
              return `
                <div class="agy-input-card" data-style="${key}" style="border-radius: 12px; border: ${isSelected ? '1.5px solid #f4f4f5' : '1px solid rgba(255, 255, 255, 0.12)'}; background: ${isSelected ? 'rgba(42, 34, 30, 0.68)' : 'rgba(14, 12, 12, 0.78)'}; padding: 16px 18px; cursor: pointer; display: flex; flex-direction: column; gap: 12px; transition: border-color 0.15s ease, background-color 0.15s ease;">
                  <div class="agy-input-preview-outer" style="position: relative; margin-top: 8px; padding: 1.5px; border-radius: 10px; background: ${key === 'double_gold' ? 'linear-gradient(135deg, #f59e0b, #fbbf24)' : activeBubbleTh.frameBg};">
                    <div class="agy-input-preview-sticker" style="position: absolute; ${previewStickerStyle} background-image: url('${activeBubbleTh.sticker || ''}'); background-size: contain; background-repeat: no-repeat; display: ${key !== 'minimal' && activeBubbleTh.sticker ? 'block' : 'none'}; pointer-events: none;"></div>
                    <div class="agy-input-preview-inner" style="background: ${previewInnerBg}; border-radius: 9px; padding: 8px 12px; font-size: 12px; color: #a1a1aa; display: flex; justify-content: space-between; align-items: center;">
                      <span>Ask anything, @ to mention...</span>
                      <span class="agy-input-preview-turbo" style="color: ${activeBubbleTh.primary}; font-size: 11px;">Send →</span>
                    </div>
                  </div>
                  <div style="display: flex; justify-content: space-between; align-items: center;">
                    <div>
                      <div style="font-size: 13.5px; font-weight: 500; color: #e4e4e7;">${item.label}</div>
                      <div style="font-size: 11.5px; color: #a1a1aa;">${item.desc}</div>
                    </div>
                    <div class="agy-card-check-slot">${isSelected ? CHECK_SVG : ''}</div>
                  </div>
                </div>
              `;
            }).join('')}
          </div>
        </div>

        <div id="agy-presets-section"></div>
      </div>
    `;

    function updateInputPreviews(bName) {
      const activeTh = THEMES[bName] || THEMES[DEFAULT_THEME_KEY];
      container.querySelectorAll('.agy-input-card').forEach(card => {
        const key = card.dataset.style;
        const outer = card.querySelector('.agy-input-preview-outer');
        if (outer) {
          outer.style.background = key === 'double_gold'
            ? 'linear-gradient(135deg, #f59e0b, #fbbf24)'
            : activeTh.frameBg;
        }
        const inner = card.querySelector('.agy-input-preview-inner');
        if (inner) {
          inner.style.background = key === 'glass'
            ? (activeTh.inputGlassBg || 'rgba(20, 15, 13, 0.45)')
            : (activeTh.inputCardBg || 'rgba(26, 18, 15, 0.92)');
        }
        const sticker = card.querySelector('.agy-input-preview-sticker');
        if (sticker) {
          if (key !== 'minimal' && activeTh.sticker) {
            sticker.style.display = 'block';
            sticker.style.backgroundImage = `url('${activeTh.sticker}')`;
            if (activeTh.isOrnament) {
              sticker.style.top = '-12px';
              sticker.style.width = '72px';
              sticker.style.height = '22px';
              sticker.style.backgroundPosition = 'center';
            } else {
              sticker.style.top = '-22px';
              sticker.style.width = '32px';
              sticker.style.height = '28px';
              sticker.style.backgroundPosition = 'bottom center';
            }
          } else {
            sticker.style.display = 'none';
          }
        }
        const turbo = card.querySelector('.agy-input-preview-turbo');
        if (turbo) {
          turbo.style.color = activeTh.primary;
        }
      });
    }

    const slider = container.querySelector('#agy-dim-slider');
    const valLabel = container.querySelector('#agy-dim-val');
    slider.addEventListener('input', (e) => {
      const v = parseInt(e.target.value, 10);
      valLabel.textContent = v + '%';
      applyTheme({ dimming: v });
    });

    const wpToggle = container.querySelector('#agy-wp-toggle');
    wpToggle.addEventListener('change', (e) => {
      applyTheme({ wpEnabled: e.target.checked });
    });

    const modeImgBtn = container.querySelector('#agy-mode-image');
    const modeVidBtn = container.querySelector('#agy-mode-video');
    const uploadStatus = container.querySelector('#agy-upload-status');
    function syncModeButtons(activeMode) {
      if (modeImgBtn) {
        modeImgBtn.style.background = activeMode === 'image' ? 'rgba(255,255,255,0.18)' : 'transparent';
        modeImgBtn.style.color = activeMode === 'image' ? '#ffffff' : '#a1a1aa';
        modeImgBtn.style.fontWeight = activeMode === 'image' ? '600' : '400';
      }
      if (modeVidBtn) {
        modeVidBtn.style.background = activeMode === 'video' ? 'rgba(255,255,255,0.18)' : 'transparent';
        modeVidBtn.style.color = activeMode === 'video' ? '#ffffff' : '#a1a1aa';
        modeVidBtn.style.fontWeight = activeMode === 'video' ? '600' : '400';
      }
    }
    if (modeImgBtn) {
      modeImgBtn.addEventListener('click', () => {
        applyTheme({ wpMode: 'image', wpEnabled: true });
        syncModeButtons('image');
        if (wpToggle) wpToggle.checked = true;
        if (uploadStatus) uploadStatus.textContent = '';
        renderPresetsSection();
      });
    }
    if (modeVidBtn) {
      modeVidBtn.addEventListener('click', () => {
        const curSt = getState();
        const curTh = THEMES[curSt.themeName] || {};
        const hasVid = Boolean(curSt.customVideo || curTh.wallpaperVideo);
        applyTheme({ wpMode: 'video', wpEnabled: true });
        syncModeButtons('video');
        if (wpToggle) wpToggle.checked = true;
        if (uploadStatus) {
          uploadStatus.textContent = hasVid ? '' : 'Hãy chọn Furina Live hoặc một Video đã lưu bên dưới';
        }
        renderPresetsSection();
      });
    }

    const bootToggle = container.querySelector('#agy-boot-toggle');
    if (bootToggle) {
      bootToggle.addEventListener('change', (e) => {
        applyTheme({ bootIntro: e.target.checked });
      });
    }
    const sketchToggle = container.querySelector('#agy-sketch-toggle');
    if (sketchToggle) {
      sketchToggle.addEventListener('change', (e) => {
        applyTheme({ sketchReveal: e.target.checked });
      });
    }
    const greetingToggle = container.querySelector('#agy-greeting-toggle');
    if (greetingToggle) {
      greetingToggle.addEventListener('change', (e) => {
        applyTheme({ tawaGreeting: e.target.checked });
      });
    }
    function closeHostModalsForPreview() {
      const bd = document.getElementById('agy-custom-theme-modal-backdrop');
      if (bd) bd.style.display = 'none';
      const settingsBox = document.querySelector('.settings-modal-container');
      if (settingsBox) {
        const sr = settingsBox.getBoundingClientRect();
        const closeBtn = Array.from(settingsBox.querySelectorAll('button')).find((b) => {
          const r = b.getBoundingClientRect();
          return r.width > 0 && r.height > 0 && (r.top - sr.top) < 64 && (sr.right - r.right) < 64;
        });
        if (closeBtn) {
          closeBtn.click();
        } else {
          document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true, cancelable: true }));
        }
      }
    }
    const replayBootBtn = container.querySelector('#agy-replay-boot-btn');
    if (replayBootBtn) {
      replayBootBtn.addEventListener('click', () => {
        closeHostModalsForPreview();
        mountBootSequence(true);
      });
    }
    const replayRevealBtn = container.querySelector('#agy-replay-reveal-btn');
    if (replayRevealBtn) {
      replayRevealBtn.addEventListener('click', () => {
        closeHostModalsForPreview();
        setTimeout(() => triggerSketchBloomReveal(false), 120);
      });
    }

    async function uploadMediaToServer(file, fallbackName) {
      const base = getDaemonBaseUrl();
      if (!base) return null;
      try {
        const resp = await daemonFetch(`/upload?name=${encodeURIComponent(file.name || fallbackName)}`, {
          method: 'POST',
          headers: { 'Content-Type': file.type || 'application/octet-stream' },
          body: file
        });
        if (resp.ok) {
          const info = await resp.json();
          if (info && info.url) return info;
        }
      } catch (err) {}
      return null;
    }

    function triggerRevealOnReady(kind) {
      if (!getState().sketchReveal) return;
      if (kind === 'video') {
        const vidEl = document.getElementById('agy-live-bg-video');
        if (vidEl) {
          const onReady = () => triggerSketchBloomReveal(false);
          if (vidEl.readyState >= 2) onReady();
          else vidEl.addEventListener('loadeddata', onReady, { once: true });
        }
      } else {
        const imgEl = document.getElementById('agy-live-bg-img');
        if (imgEl) {
          const onReady = () => triggerSketchBloomReveal(false);
          if (imgEl.complete) onReady();
          else imgEl.addEventListener('load', onReady, { once: true });
        }
      }
    }

    const wpUpload = container.querySelector('#agy-wp-upload');
    wpUpload.addEventListener('change', async (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      const isVideo = (file.type && file.type.startsWith('video/')) || /\.(mp4|webm|mov|m4v)$/i.test(file.name || '');
      const kind = isVideo ? 'video' : 'image';
      if (uploadStatus) uploadStatus.textContent = isVideo ? 'Đang nạp video...' : 'Đang nạp ảnh nền...';

      const uploaded = await uploadMediaToServer(file, isVideo ? 'custom.mp4' : 'custom.png');
      let mediaUrl = uploaded && uploaded.url ? uploaded.url : '';
      const displayName = (uploaded && uploaded.name) || file.name || (isVideo ? 'Custom Video' : 'Custom Image');

      if (!mediaUrl) {
        if (isVideo) {
          mediaUrl = URL.createObjectURL(file);
        } else {
          mediaUrl = await new Promise((resolve) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result || ''));
            reader.onerror = () => resolve('');
            reader.readAsDataURL(file);
          });
        }
      }

      wpUpload.value = '';
      if (!mediaUrl) {
        if (uploadStatus) uploadStatus.textContent = 'Không đọc được tệp đã chọn!';
        return;
      }

      const nextList = upsertSavedMedia(kind, {
        url: mediaUrl,
        name: displayName,
        addedAt: Date.now()
      });

      if (isVideo) {
        applyTheme({ wpMode: 'video', customVideo: mediaUrl, savedVideos: nextList, wpEnabled: true });
        syncModeButtons('video');
        if (uploadStatus) uploadStatus.textContent = uploaded && uploaded.duplicate ? 'Đã chọn lại video đã lưu!' : 'Đã lưu & cập nhật video nền!';
      } else {
        applyTheme({ wpMode: 'image', customWp: mediaUrl, savedImages: nextList, wpEnabled: true });
        syncModeButtons('image');
        if (uploadStatus) uploadStatus.textContent = uploaded && uploaded.duplicate ? 'Đã chọn lại ảnh đã lưu!' : 'Đã lưu & cập nhật ảnh nền!';
      }
      if (wpToggle) wpToggle.checked = true;
      renderPresetsSection();
      triggerRevealOnReady(kind);
    });

    const userAvUpload = container.querySelector('#agy-user-av-upload');
    const userAvPreview = container.querySelector('#agy-user-av-preview');
    const userAvClear = container.querySelector('#agy-user-av-clear');
    const agentAvUpload = container.querySelector('#agy-agent-av-upload');
    const agentAvPreview = container.querySelector('#agy-agent-av-preview');
    const agentAvClear = container.querySelector('#agy-agent-av-clear');

    function syncAvPreview(el, url, fallbackText) {
      if (!el) return;
      if (url) {
        el.style.backgroundImage = `url("${url}")`;
        el.style.backgroundSize = 'cover';
        el.style.backgroundPosition = 'center';
        el.textContent = '';
      } else {
        el.style.backgroundImage = 'none';
        el.textContent = fallbackText;
      }
    }

    if (userAvUpload) {
      userAvUpload.addEventListener('change', (e) => {
        const file = e.target.files && e.target.files[0];
        if (!file) return;
        compressAvatarFile(file, (dataUrl) => {
          applyTheme({ userAvatar: dataUrl });
          syncAvPreview(userAvPreview, dataUrl, 'U');
        });
      });
    }
    if (userAvClear) {
      userAvClear.addEventListener('click', () => {
        applyTheme({ userAvatar: 'none' });
        syncAvPreview(userAvPreview, '', 'U');
      });
    }

    const authLockToggle = container.querySelector('#agy-auth-lock-toggle');
    const mfaTestBtn = container.querySelector('#agy-mfa-test-btn');
    const faceResetBtn = container.querySelector('#agy-face-reset-btn');
    const curPinAuthInput = container.querySelector('#agy-cur-pin-auth');
    const newPinInput = container.querySelector('#agy-new-pin-input');
    const savePinBtn = container.querySelector('#agy-save-pin-btn');
    const newPassInput = container.querySelector('#agy-new-pass-input');
    const savePassBtn = container.querySelector('#agy-save-pass-btn');
    const recordChordBtn = container.querySelector('#agy-record-chord-btn');
    const clearChordBtn = container.querySelector('#agy-clear-chord-btn');
    const mfaMsg = container.querySelector('#agy-mfa-settings-msg');

    function showMfaMsg(txt, isError = false) {
      if (!mfaMsg) return;
      mfaMsg.style.color = isError ? '#fb7185' : '#34d399';
      mfaMsg.textContent = txt;
    }

    async function ensureAdminTicket() {
      if (!HAS_VAULT_DAEMON) {
        showMfaMsg('Run .\\scripts\\install-win.ps1 once to activate Hardened Security Vault.', true);
        return '';
      }
      const existing = getValidAdminTicket();
      if (existing) return existing;
      const curPin = curPinAuthInput ? curPinAuthInput.value.trim() : '';
      if (!/^\d{6}$/.test(curPin)) {
        if (curPinAuthInput) curPinAuthInput.focus();
        showMfaMsg('Enter your current 6-digit PIN in "Authorize Changes" first.', true);
        return '';
      }
      try {
        const resp = await daemonFetch('/auth/verify-pin', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ secret: curPin })
        });
        const data = await resp.json();
        if (resp.status === 429 || (data && data.lockedOut)) {
          showMfaMsg(`Too many failed attempts · Locked for ${data.retryAfterSec || 30}s.`, true);
          return '';
        }
        if (data && data.verified && data.adminTicket) {
          rememberAdminTicket(data.adminTicket);
          if (curPinAuthInput) curPinAuthInput.value = '';
          return data.adminTicket;
        }
        showMfaMsg('Current 6-digit PIN is incorrect.', true);
      } catch (err) {
        showMfaMsg('Security Vault unreachable.', true);
      }
      return '';
    }

    async function applyVaultPatch(patchObj, successMessage) {
      const ticket = await ensureAdminTicket();
      if (!ticket) return false;
      try {
        const resp = await daemonFetch('/auth/update-settings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ adminTicket: ticket, ...patchObj })
        });
        const data = await resp.json();
        if (!resp.ok || !data || !data.ok) {
          if (resp.status === 401) lastAdminTicketExp = 0;
          showMfaMsg((data && data.error) || 'Failed updating vault settings.', true);
          return false;
        }
        serverAuthLock = Boolean(data.authLock);
        serverHasKeyChord = Boolean(data.hasKeyChord);
        if (recordChordBtn) {
          recordChordBtn.textContent = serverHasKeyChord ? 'Update 3-Key Chord' : 'Record 3-Key Chord';
        }
        showMfaMsg(successMessage, false);
        return true;
      } catch (err) {
        showMfaMsg('Failed communicating with Security Vault.', true);
        return false;
      }
    }

    if (authLockToggle) {
      authLockToggle.addEventListener('change', async (e) => {
        const desired = Boolean(e.target.checked);
        const ok = await applyVaultPatch(
          { authLock: desired },
          desired ? 'Multi-Factor Identity Lock enabled in Vault.' : 'Multi-Factor Identity Lock disabled in Vault.'
        );
        if (!ok) {
          e.target.checked = Boolean(serverAuthLock);
        }
      });
    }
    if (mfaTestBtn) {
      mfaTestBtn.addEventListener('click', () => {
        closeHostModalsForPreview();
        mountBootSequence(true, true);
      });
    }
    if (faceResetBtn) {
      faceResetBtn.addEventListener('click', async () => {
        const ticket = await ensureAdminTicket();
        if (!ticket) return;
        try {
          const resp = await daemonFetch('/auth/face-reset', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ adminTicket: ticket })
          });
          const data = await resp.json();
          if (resp.ok && data && data.ok) {
            if (data.adminTicket) rememberAdminTicket(data.adminTicket);
            showMfaMsg('Face ID biometric template cleared. Click Calibrate HD Face on next boot to re-enroll.', false);
          } else {
            showMfaMsg((data && data.error) || 'Could not reset Face ID.', true);
          }
        } catch (err) {
          showMfaMsg('Restart daemon once to enable Face ID service.', true);
        }
      });
    }
    if (savePinBtn && newPinInput) {
      savePinBtn.addEventListener('click', async () => {
        const raw = newPinInput.value.trim();
        if (!/^\d{6}$/.test(raw)) {
          showMfaMsg('New PIN must be exactly 6 digits (0-9).', true);
          return;
        }
        const ok = await applyVaultPatch({ newPin: raw }, '6-digit Passcode updated (scrypt vault saved).');
        if (ok) newPinInput.value = '';
      });
    }
    if (savePassBtn && newPassInput) {
      savePassBtn.addEventListener('click', async () => {
        const raw = newPassInput.value;
        if (!raw || raw.length < 4) {
          showMfaMsg('Passphrase must be at least 4 characters.', true);
          return;
        }
        const ok = await applyVaultPatch({ newPass: raw }, 'Engineer Terminal passphrase updated (scrypt vault saved).');
        if (ok) newPassInput.value = '';
      });
    }
    if (recordChordBtn) {
      recordChordBtn.addEventListener('click', async () => {
        const ticket = await ensureAdminTicket();
        if (!ticket) return;
        const recorded = [];
        recordChordBtn.textContent = 'Press Combo 1/3...';
        showMfaMsg('Press 3 secret key combinations (Esc to cancel)...', false);
        const onRecKey = async (ev) => {
          if (ev.key === 'Escape') {
            ev.preventDefault();
            ev.stopPropagation();
            window.removeEventListener('keydown', onRecKey, true);
            recordChordBtn.textContent = serverHasKeyChord ? 'Update 3-Key Chord' : 'Record 3-Key Chord';
            showMfaMsg('Key chord recording cancelled.', true);
            return;
          }
          const combo = serializeKeyCombo(ev);
          if (!combo) return;
          ev.preventDefault();
          ev.stopPropagation();
          recorded.push(combo);
          if (recorded.length < 3) {
            recordChordBtn.textContent = `Press Combo ${recorded.length + 1}/3...`;
            return;
          }
          window.removeEventListener('keydown', onRecKey, true);
          await applyVaultPatch({ newChord: recorded.join('>') }, `3-Step Secret Key Chord saved (${recorded.join(' -> ')}).`);
        };
        window.addEventListener('keydown', onRecKey, true);
      });
    }
    if (clearChordBtn) {
      clearChordBtn.addEventListener('click', async () => {
        await applyVaultPatch({ newChord: '' }, 'Secret Key Chord cleared.');
      });
    }
    if (agentAvUpload) {
      agentAvUpload.addEventListener('change', (e) => {
        const file = e.target.files && e.target.files[0];
        if (!file) return;
        compressAvatarFile(file, (dataUrl) => {
          applyTheme({ agentAvatar: dataUrl });
          syncAvPreview(agentAvPreview, dataUrl, 'AI');
        });
      });
    }
    if (agentAvClear) {
      agentAvClear.addEventListener('click', () => {
        applyTheme({ agentAvatar: 'none' });
        syncAvPreview(agentAvPreview, '', 'AI');
      });
    }

    const blurSlider = container.querySelector('#agy-blur-slider');
    const blurLabel = container.querySelector('#agy-blur-val');
    if (blurSlider) {
      blurSlider.addEventListener('input', (e) => {
        const v = parseInt(e.target.value, 10);
        if (blurLabel) blurLabel.textContent = v + 'px';
        applyTheme({ glassBlur: v });
      });
    }

    const avSizeSlider = container.querySelector('#agy-av-size');
    const avSizeVal = container.querySelector('#agy-av-size-val');
    if (avSizeSlider) {
      avSizeSlider.addEventListener('input', (e) => {
        const v = parseInt(e.target.value, 10);
        if (avSizeVal) avSizeVal.textContent = v + 'px';
        applyTheme({ avatarSize: v });
      });
    }

    const avRadSlider = container.querySelector('#agy-av-rad');
    const avRadVal = container.querySelector('#agy-av-rad-val');
    if (avRadSlider) {
      avRadSlider.addEventListener('input', (e) => {
        const v = parseInt(e.target.value, 10);
        if (avRadVal) avRadVal.textContent = v + '%';
        if (userAvPreview) userAvPreview.style.borderRadius = v + '%';
        if (agentAvPreview) agentAvPreview.style.borderRadius = v + '%';
        applyTheme({ avatarRadius: v });
      });
    }

    const exportBtn = container.querySelector('#agy-export-btn');
    const importToggle = container.querySelector('#agy-import-toggle');
    const importBox = container.querySelector('#agy-import-box');
    const importText = container.querySelector('#agy-import-text');
    const importApply = container.querySelector('#agy-import-apply');
    const importMsg = container.querySelector('#agy-import-msg');

    if (exportBtn) {
      exportBtn.addEventListener('click', () => {
        const json = JSON.stringify(getState(), null, 2);
        if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
          navigator.clipboard.writeText(json).then(() => {
            exportBtn.textContent = 'Copied ✓';
            setTimeout(() => { exportBtn.textContent = 'Export JSON'; }, 1500);
          }).catch(() => {
            if (importBox && importText) {
              importBox.style.display = 'flex';
              importText.value = json;
              importText.select();
            }
          });
        } else if (importBox && importText) {
          importBox.style.display = 'flex';
          importText.value = json;
          importText.select();
        }
      });
    }
    if (importToggle && importBox) {
      importToggle.addEventListener('click', () => {
        importBox.style.display = importBox.style.display === 'none' ? 'flex' : 'none';
        if (importMsg) importMsg.textContent = '';
      });
    }
    if (importApply && importText) {
      importApply.addEventListener('click', () => {
        try {
          const parsed = JSON.parse(importText.value.trim());
          if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            throw new Error('Config must be a JSON object');
          }
          const allowed = {};
          const keys = ['themeName', 'bubbleName', 'inputStyle', 'dimming', 'wpEnabled', 'wpMode', 'customWp', 'customVideo', 'savedImages', 'savedVideos', 'taskVoices', 'taskVoiceEnabled', 'taskVoiceVol', 'customGreetings', 'userAvatar', 'agentAvatar', 'glassBlur', 'avatarSize', 'avatarRadius', 'bootIntro', 'sketchReveal', 'tawaGreeting'];
          keys.forEach((k) => {
            if (parsed[k] !== undefined) allowed[k] = parsed[k];
          });
          applyTheme(allowed);
          renderThemePanels(container);
        } catch (err) {
          if (importMsg) importMsg.textContent = 'Invalid JSON: ' + err.message;
        }
      });
    }

    const resetBtn = container.querySelector('#agy-reset-btn');
    resetBtn.addEventListener('click', () => {
      localStorage.removeItem(STORAGE_CUSTOM_WP);
      localStorage.removeItem(STORAGE_CUSTOM_VIDEO);
      localStorage.removeItem(STORAGE_WP_MODE);
      localStorage.removeItem(STORAGE_USER_AVATAR);
      localStorage.removeItem(STORAGE_AGENT_AVATAR);
      localStorage.removeItem(STORAGE_GLASS_BLUR);
      localStorage.removeItem(STORAGE_AVATAR_SIZE);
      localStorage.removeItem(STORAGE_AVATAR_RADIUS);
      localStorage.removeItem(STORAGE_THEME);
      localStorage.removeItem(STORAGE_BUBBLE);
      localStorage.removeItem(STORAGE_INPUT);
      localStorage.removeItem(STORAGE_DIMMING);
      localStorage.removeItem(STORAGE_WP_ENABLED);
      localStorage.removeItem(STORAGE_BOOT_INTRO);
      localStorage.removeItem(STORAGE_SKETCH_REVEAL);
      localStorage.removeItem(STORAGE_TAWA_GREETING);
      localStorage.removeItem(STORAGE_TASK_VOICE_ENABLED);
      localStorage.removeItem(STORAGE_TASK_VOICE_VOL);
      localStorage.removeItem(STORAGE_CUSTOM_GREETINGS);
      const defTh = THEMES[DEFAULT_THEME_KEY] || {};
      const defMode = defTh.wallpaperVideo ? 'video' : 'image';
      applyTheme({
        themeName: DEFAULT_THEME_KEY,
        bubbleName: DEFAULT_THEME_KEY,
        inputStyle: 'sync',
        dimming: 69,
        wpEnabled: true,
        wpMode: defMode,
        customWp: '',
        customVideo: '',
        taskVoiceEnabled: true,
        taskVoiceVol: 85,
        customGreetings: [],
        userAvatar: '',
        agentAvatar: '',
        glassBlur: 3,
        avatarSize: 32,
        avatarRadius: 50,
        bootIntro: true,
        sketchReveal: true,
        tawaGreeting: true
      });
      syncModeButtons(defMode);
      if (bootToggle) bootToggle.checked = true;
      if (sketchToggle) sketchToggle.checked = true;
      if (greetingToggle) greetingToggle.checked = true;
      if (taskVoiceToggle) taskVoiceToggle.checked = true;
      if (taskVoiceVolSlider) taskVoiceVolSlider.value = 85;
      if (taskVoiceVolVal) taskVoiceVolVal.textContent = '85%';
      if (greetingLinesEl) greetingLinesEl.value = '';
      renderTaskVoiceList();
      window.__AGY_GREETING_NEED_FRESH__ = true;
      syncEmptyGreeting();
      if (uploadStatus) uploadStatus.textContent = '';
      syncAvPreview(userAvPreview, defTh.userAvatar || '', 'U');
      syncAvPreview(agentAvPreview, defTh.agentAvatar || '', 'AI');
      if (userAvPreview) userAvPreview.style.borderRadius = '50%';
      if (agentAvPreview) agentAvPreview.style.borderRadius = '50%';
      if (slider) slider.value = 69;
      if (valLabel) valLabel.textContent = '69%';
      if (blurSlider) blurSlider.value = 3;
      if (blurLabel) blurLabel.textContent = '3px';
      if (avSizeSlider) avSizeSlider.value = 32;
      if (avSizeVal) avSizeVal.textContent = '32px';
      if (avRadSlider) avRadSlider.value = 50;
      if (avRadVal) avRadVal.textContent = '50%';
      if (wpToggle) wpToggle.checked = true;

      renderPresetsSection();
      container.querySelectorAll('.agy-bubble-card').forEach(b => {
        const isSel = b.dataset.name === DEFAULT_THEME_KEY;
        b.style.border = isSel ? '1.5px solid #f4f4f5' : '1px solid rgba(255, 255, 255, 0.12)';
        b.style.background = isSel ? 'rgba(42, 34, 30, 0.68)' : 'rgba(14, 12, 12, 0.78)';
        const slot = b.querySelector('.agy-card-check-slot');
        if (slot) slot.innerHTML = isSel ? CHECK_SVG : '';
      });
      container.querySelectorAll('.agy-input-card').forEach(c => {
        const isSel = c.dataset.style === 'sync';
        c.style.border = isSel ? '1.5px solid #f4f4f5' : '1px solid rgba(255, 255, 255, 0.12)';
        c.style.background = isSel ? 'rgba(42, 34, 30, 0.68)' : 'rgba(14, 12, 12, 0.78)';
        const slot = c.querySelector('.agy-card-check-slot');
        if (slot) slot.innerHTML = isSel ? CHECK_SVG : '';
      });
      updateInputPreviews(DEFAULT_THEME_KEY);
    });

    const taskVoiceToggle = container.querySelector('#agy-task-voice-toggle');
    const customVgToggle = container.querySelector('#agy-custom-vg-toggle');
    const customVgBox = container.querySelector('#agy-custom-vg-box');
    const taskVoiceUpload = container.querySelector('#agy-task-voice-upload');
    const taskVoiceTestBtn = container.querySelector('#agy-task-voice-test');
    const taskVoiceVolSlider = container.querySelector('#agy-task-voice-vol');
    const taskVoiceVolVal = container.querySelector('#agy-task-voice-vol-val');
    const taskVoiceListEl = container.querySelector('#agy-task-voice-list');
    const greetingLinesEl = container.querySelector('#agy-greeting-lines');
    const greetingSaveBtn = container.querySelector('#agy-greeting-save');
    const greetingResetBtn = container.querySelector('#agy-greeting-reset');
    const greetingMsgEl = container.querySelector('#agy-greeting-msg');

    function renderTaskVoiceList() {
      if (!taskVoiceListEl) return;
      const voices = getMediaLibrary('audio');
      if (voices.length === 0) {
        taskVoiceListEl.innerHTML = `<div style="font-size: 11.5px; color: #71717a; padding: 6px 2px;">Chưa có file voice nào. Bấm "Thêm Voice" để nạp 1 hoặc nhiều file .mp3/.wav/.ogg/.m4a.</div>`;
        return;
      }
      taskVoiceListEl.innerHTML = voices.map((v, idx) => `
        <div style="display: flex; align-items: center; gap: 6px; padding: 4px 8px; border-radius: 7px; border: 1px solid rgba(255,255,255,0.10); background: rgba(255,255,255,0.03);">
          <span style="font-size: 10.5px; color: #93c5fd; min-width: 16px;">#${idx + 1}</span>
          <span style="flex: 1; font-size: 11.5px; color: #e4e4e7; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${escapeHtml(v.name)}">${escapeHtml(v.name)}</span>
          <button type="button" class="agy-tv-play-btn" data-url="${escapeHtml(v.url)}" title="Nghe thử" style="padding: 2px 6px; border-radius: 5px; background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.14); color: #e4e4e7; font-size: 10.5px; cursor: pointer;">▶</button>
          <button type="button" class="agy-tv-del-btn" data-url="${escapeHtml(v.url)}" title="Xóa voice" style="padding: 2px 6px; border-radius: 5px; background: rgba(239,68,68,0.12); border: 1px solid rgba(239,68,68,0.28); color: #fca5a5; font-size: 10.5px; cursor: pointer;">✕</button>
        </div>
      `).join('');

      taskVoiceListEl.querySelectorAll('.agy-tv-play-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
          const url = btn.dataset.url || '';
          if (url) playOneShotTaskAudio(url, getState().taskVoiceVol);
        });
      });
      taskVoiceListEl.querySelectorAll('.agy-tv-del-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
          const url = btn.dataset.url || '';
          if (url) deleteSavedMediaItem('audio', url);
        });
      });
    }

    if (taskVoiceToggle) {
      taskVoiceToggle.addEventListener('change', (e) => {
        applyTheme({ taskVoiceEnabled: e.target.checked });
      });
    }
    if (taskVoiceVolSlider) {
      taskVoiceVolSlider.addEventListener('input', (e) => {
        const v = parseInt(e.target.value, 10);
        if (taskVoiceVolVal) taskVoiceVolVal.textContent = v + '%';
        applyTheme({ taskVoiceVol: v });
      });
    }
    if (taskVoiceTestBtn) {
      taskVoiceTestBtn.addEventListener('click', () => {
        playRandomTaskVoice(true);
      });
    }
    if (taskVoiceUpload) {
      taskVoiceUpload.addEventListener('change', async (e) => {
        const files = Array.from((e.target && e.target.files) || []);
        if (files.length === 0) return;
        if (uploadStatus) uploadStatus.textContent = `Đang nạp ${files.length} voice...`;
        let nextVoices = getMediaLibrary('audio');
        for (const file of files) {
          const uploaded = await uploadMediaToServer(file, 'task_voice.mp3');
          let mediaUrl = uploaded && uploaded.url ? uploaded.url : '';
          const displayName = (uploaded && uploaded.name) || file.name || 'Task Voice';
          if (!mediaUrl) {
            mediaUrl = await new Promise((resolve) => {
              const reader = new FileReader();
              reader.onload = () => resolve(String(reader.result || ''));
              reader.onerror = () => resolve('');
              reader.readAsDataURL(file);
            });
          }
          if (mediaUrl) {
            nextVoices = upsertSavedMedia('audio', { url: mediaUrl, name: displayName, addedAt: Date.now() });
          }
        }
        taskVoiceUpload.value = '';
        applyTheme({ taskVoices: nextVoices, taskVoiceEnabled: true });
        if (taskVoiceToggle) taskVoiceToggle.checked = true;
        if (uploadStatus) uploadStatus.textContent = `Đã thêm ${files.length} voice (${nextVoices.length} tổng)!`;
        renderTaskVoiceList();
      });
    }

    if (customVgToggle && customVgBox) {
      customVgToggle.addEventListener('click', () => {
        const isHidden = customVgBox.style.display === 'none';
        customVgBox.style.display = isHidden ? 'grid' : 'none';
        customVgToggle.textContent = isHidden ? 'Tùy chỉnh Voice & Câu chào ▴' : 'Tùy chỉnh Voice & Câu chào ▾';
      });
    }
    if (greetingSaveBtn && greetingLinesEl) {
      greetingSaveBtn.addEventListener('click', () => {
        const lines = normalizeGreetingLines(greetingLinesEl.value.split(/\r?\n/));
        applyTheme({ customGreetings: lines, tawaGreeting: true });
        if (greetingToggle) greetingToggle.checked = true;
        window.__AGY_GREETING_NEED_FRESH__ = true;
        syncEmptyGreeting();
        if (greetingMsgEl) {
          greetingMsgEl.textContent = lines.length > 0 ? `Đã lưu (${lines.length} câu)` : 'Đã xóa câu chào custom';
          setTimeout(() => { if (greetingMsgEl) greetingMsgEl.textContent = ''; }, 2000);
        }
      });
    }
    if (greetingResetBtn && greetingLinesEl) {
      greetingResetBtn.addEventListener('click', () => {
        greetingLinesEl.value = '';
        applyTheme({ customGreetings: [] });
        window.__AGY_GREETING_NEED_FRESH__ = true;
        syncEmptyGreeting();
        if (greetingMsgEl) {
          greetingMsgEl.textContent = 'Đã xóa danh sách câu chào';
          setTimeout(() => { if (greetingMsgEl) greetingMsgEl.textContent = ''; }, 2000);
        }
      });
    }

    async function deleteSavedMediaItem(kind, targetUrl) {
      const isVideo = kind === 'video';
      const isAudio = kind === 'audio';
      const base = getDaemonBaseUrl();
      if (base && canonicalMediaKey(targetUrl).startsWith('user_media/')) {
        try {
          const resp = await daemonFetch('/delete_media', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url: targetUrl })
          });
          if (resp.ok) {
            const info = await resp.json();
            if (info && info.media) {
              window.__AGY_USER_MEDIA__ = info.media;
            }
          }
        } catch (err) {}
      }

      const nextList = removeSavedMediaFromStore(kind, targetUrl);
      const curSt = getState();
      const patch = isVideo ? { savedVideos: nextList } : (isAudio ? { taskVoices: nextList } : { savedImages: nextList });
      if (isVideo && isSameMediaUrl(curSt.customVideo, targetUrl)) {
        patch.customVideo = '';
      } else if (!isVideo && !isAudio && isSameMediaUrl(curSt.customWp, targetUrl)) {
        patch.customWp = '';
      }
      applyTheme(patch);
      if (uploadStatus) {
        uploadStatus.textContent = isVideo ? 'Đã xóa video khỏi thư viện!' : (isAudio ? 'Đã xóa voice khỏi danh sách!' : 'Đã xóa ảnh khỏi thư viện!');
      }
      if (isAudio) {
        renderTaskVoiceList();
      } else {
        renderPresetsSection();
      }
    }

    function renderPresetsSection() {
      const host = container.querySelector('#agy-presets-section');
      if (!host) return;
      const curSt = getState();
      const isVideoTab = curSt.wpMode === 'video';
      const builtInKeys = THEME_KEYS.filter((name) => {
        const th = THEMES[name] || {};
        const isLive = Boolean(th.wallpaperVideo || th.mediaType === 'video');
        return isVideoTab ? isLive : !isLive;
      });
      const savedItems = getMediaLibrary(isVideoTab ? 'video' : 'image');
      const totalCount = builtInKeys.length + savedItems.length;

      const headerBadge = document.getElementById('agy-custom-theme-badge');
      if (headerBadge) {
        headerBadge.textContent = `${totalCount} ${isVideoTab ? 'Video' : 'Ảnh'}`;
      }

      const builtInHtml = builtInKeys.map((name) => {
        const th = THEMES[name];
        const activeCustom = isVideoTab ? curSt.customVideo : curSt.customWp;
        const isSelected = name === curSt.themeName && !activeCustom;
        const wpThumb = resolveMediaUrl(th.wallpaper);
        const thumbBg = wpThumb
          ? `linear-gradient(180deg, rgba(0,0,0,0.15), rgba(14,12,12,0.85)), url('${sanitizeCssUrl(wpThumb)}')`
          : (th.pureBg || th.bg);
        const thumbOrnamentStyle = th.isOrnament
          ? 'right: 10px; bottom: 8px; width: 76px; height: 24px; background-position: center;'
          : 'right: 12px; bottom: 4px; width: 42px; height: 38px; background-position: bottom center;';
        return `
          <div class="agy-preset-card" data-name="${escapeHtml(name)}" style="border-radius: 12px; border: ${isSelected ? '1.5px solid #f4f4f5' : '1px solid rgba(255, 255, 255, 0.12)'}; background: rgba(14, 12, 12, 0.82); overflow: hidden; cursor: pointer; display: flex; flex-direction: column; transition: border-color 0.15s ease;">
            <div style="height: 68px; width: 100%; background-image: ${thumbBg}; background-size: cover; background-position: ${th.bgPosition || 'center'}; position: relative; display: flex; align-items: flex-end; padding: 8px 14px;">
              ${th.sticker ? `<div style="position: absolute; ${thumbOrnamentStyle} background-image: url('${th.sticker}'); background-size: contain; background-repeat: no-repeat; pointer-events: none;"></div>` : ''}
              <span style="font-size: 13.5px; font-weight: 600; color: #fff; text-shadow: 0 1px 4px rgba(0,0,0,0.7);">${escapeHtml(name)}</span>
            </div>
            <div style="padding: 10px 14px; display: flex; justify-content: space-between; align-items: center;">
              <span style="font-size: 12px; color: #a1a1aa;">${escapeHtml(th.concept || '')}</span>
              <div class="agy-card-check-slot">${isSelected ? CHECK_SVG : ''}</div>
            </div>
          </div>
        `;
      }).join('');

      const savedHtml = savedItems.map((item) => {
        const resolvedUrl = resolveMediaUrl(item.url);
        const isSelected = isVideoTab
          ? isSameMediaUrl(curSt.customVideo, item.url)
          : isSameMediaUrl(curSt.customWp, item.url);
        const displayName = item.name || deriveMediaName(item.url, isVideoTab ? 'Saved Video' : 'Saved Image');
        const deleteBtnHtml = `
          <button type="button" class="agy-saved-delete-btn" data-url="${escapeHtml(item.url)}" title="Xóa khỏi thư viện" style="position: absolute; top: 8px; right: 8px; z-index: 4; width: 24px; height: 24px; border-radius: 9999px; border: 1px solid rgba(255, 255, 255, 0.22); background: rgba(10, 12, 18, 0.72); color: #fca5a5; display: flex; align-items: center; justify-content: center; cursor: pointer; padding: 0; transition: background-color 0.15s ease, border-color 0.15s ease;">
            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/></svg>
          </button>
        `;
        const previewInner = isVideoTab
          ? `
            <video class="agy-saved-vid-thumb" src="${escapeHtml(resolvedUrl)}#t=0.5" muted loop playsinline preload="metadata" style="position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; pointer-events: none;"></video>
            <div style="position: absolute; inset: 0; background: linear-gradient(180deg, rgba(0,0,0,0.12), rgba(14,12,12,0.86)); pointer-events: none;"></div>
            <span style="position: absolute; top: 8px; left: 10px; z-index: 3; font-size: 10px; font-weight: 600; letter-spacing: 0.4px; padding: 2px 6px; border-radius: 9999px; background: rgba(15, 23, 42, 0.75); border: 1px solid rgba(56, 189, 248, 0.35); color: #bae6fd;">VIDEO</span>
          `
          : `
            <div style="position: absolute; inset: 0; background-image: linear-gradient(180deg, rgba(0,0,0,0.12), rgba(14,12,12,0.86)), url('${sanitizeCssUrl(resolvedUrl)}'); background-size: cover; background-position: center; pointer-events: none;"></div>
            <span style="position: absolute; top: 8px; left: 10px; z-index: 3; font-size: 10px; font-weight: 600; letter-spacing: 0.4px; padding: 2px 6px; border-radius: 9999px; background: rgba(15, 23, 42, 0.75); border: 1px solid rgba(251, 191, 36, 0.35); color: #fde68a;">ẢNH</span>
          `;

        return `
          <div class="agy-saved-media-card" data-url="${escapeHtml(item.url)}" data-kind="${isVideoTab ? 'video' : 'image'}" style="border-radius: 12px; border: ${isSelected ? '1.5px solid #f4f4f5' : '1px solid rgba(255, 255, 255, 0.12)'}; background: rgba(14, 12, 12, 0.82); overflow: hidden; cursor: pointer; display: flex; flex-direction: column; transition: border-color 0.15s ease;">
            <div style="height: 68px; width: 100%; position: relative; display: flex; align-items: flex-end; padding: 8px 14px; background: rgba(18, 20, 28, 0.9);">
              ${previewInner}
              ${deleteBtnHtml}
              <span style="position: relative; z-index: 3; font-size: 13px; font-weight: 600; color: #fff; text-shadow: 0 1px 4px rgba(0,0,0,0.85); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 100%;">${escapeHtml(displayName)}</span>
            </div>
            <div style="padding: 10px 14px; display: flex; justify-content: space-between; align-items: center;">
              <span style="font-size: 12px; color: #a1a1aa;">${isVideoTab ? 'Video đã lưu' : 'Ảnh tĩnh đã lưu'}</span>
              <div class="agy-card-check-slot">${isSelected ? CHECK_SVG : ''}</div>
            </div>
          </div>
        `;
      }).join('');

      host.innerHTML = `
        <div style="font-size: 15px; font-weight: 600; color: #ffffff; margin-bottom: 4px;">Theme Presets — ${isVideoTab ? 'Video động' : 'Ảnh tĩnh'} (${totalCount})</div>
        <div style="font-size: 12.5px; color: #a1a1aa; margin-bottom: 14px;">${isVideoTab ? 'Live wallpaper mặc định & toàn bộ video nền bạn đã từng chọn.' : 'Preset tĩnh mặc định & toàn bộ ảnh nền bạn đã từng chọn.'}</div>
        <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px;">
          ${builtInHtml}
          ${savedHtml}
        </div>
      `;

      host.querySelectorAll('.agy-preset-card').forEach((card) => {
        card.addEventListener('click', () => {
          const name = card.dataset.name;
          if (isVideoTab) {
            applyTheme({ themeName: name, bubbleName: name, customVideo: '', wpMode: 'video', wpEnabled: true });
          } else {
            applyTheme({ themeName: name, bubbleName: name, customWp: '', wpMode: 'image', wpEnabled: true });
          }
          if (wpToggle) wpToggle.checked = true;
          if (uploadStatus) uploadStatus.textContent = '';

          container.querySelectorAll('.agy-bubble-card').forEach((b) => {
            const isSel = b.dataset.name === name;
            b.style.border = isSel ? '1.5px solid #f4f4f5' : '1px solid rgba(255, 255, 255, 0.12)';
            b.style.background = isSel ? 'rgba(42, 34, 30, 0.68)' : 'rgba(14, 12, 12, 0.78)';
            const slot = b.querySelector('.agy-card-check-slot');
            if (slot) slot.innerHTML = isSel ? CHECK_SVG : '';
          });

          updateInputPreviews(name);
          renderPresetsSection();
        });
      });

      host.querySelectorAll('.agy-saved-media-card').forEach((card) => {
        const vidThumb = card.querySelector('.agy-saved-vid-thumb');
        if (vidThumb) {
          card.addEventListener('mouseenter', () => {
            vidThumb.play().catch(() => {});
          });
          card.addEventListener('mouseleave', () => {
            vidThumb.pause();
          });
        }
        card.addEventListener('click', () => {
          const url = card.dataset.url || '';
          const kind = card.dataset.kind || 'image';
          if (!url) return;
          if (kind === 'video') {
            applyTheme({ wpMode: 'video', customVideo: url, wpEnabled: true });
            syncModeButtons('video');
            if (uploadStatus) uploadStatus.textContent = '';
          } else {
            applyTheme({ wpMode: 'image', customWp: url, wpEnabled: true });
            syncModeButtons('image');
            if (uploadStatus) uploadStatus.textContent = '';
          }
          if (wpToggle) wpToggle.checked = true;
          renderPresetsSection();
          triggerRevealOnReady(kind);
        });
      });

      host.querySelectorAll('.agy-saved-delete-btn').forEach((btn) => {
        btn.addEventListener('mouseenter', () => {
          btn.style.background = 'rgba(220, 38, 38, 0.85)';
          btn.style.borderColor = 'rgba(248, 113, 113, 0.9)';
          btn.style.color = '#ffffff';
        });
        btn.addEventListener('mouseleave', () => {
          btn.style.background = 'rgba(10, 12, 18, 0.72)';
          btn.style.borderColor = 'rgba(255, 255, 255, 0.22)';
          btn.style.color = '#fca5a5';
        });
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          e.preventDefault();
          const url = btn.dataset.url || '';
          if (!url) return;
          deleteSavedMediaItem(isVideoTab ? 'video' : 'image', url);
        });
      });
    }

    renderPresetsSection();
    renderTaskVoiceList();

    (async () => {
      const base = getDaemonBaseUrl();
      if (!base) return;
      try {
        const resp = await daemonFetch('/user_media_list');
        if (!resp.ok) return;
        const info = await resp.json();
        if (info && info.ok) {
          window.__AGY_USER_MEDIA__ = {
            images: Array.isArray(info.images) ? info.images : [],
            videos: Array.isArray(info.videos) ? info.videos : [],
            audios: Array.isArray(info.audios) ? info.audios : []
          };
          if (document.body.contains(container)) {
            renderPresetsSection();
            renderTaskVoiceList();
          }
        }
      } catch (err) {}
    })();

    container.querySelectorAll('.agy-bubble-card').forEach(card => {
      card.addEventListener('click', () => {
        const name = card.dataset.name;
        applyTheme({ bubbleName: name });

        container.querySelectorAll('.agy-bubble-card').forEach(b => {
          const isSel = b.dataset.name === name;
          b.style.border = isSel ? '1.5px solid #f4f4f5' : '1px solid rgba(255, 255, 255, 0.12)';
          b.style.background = isSel ? 'rgba(42, 34, 30, 0.68)' : 'rgba(14, 12, 12, 0.78)';
          const slot = b.querySelector('.agy-card-check-slot');
          if (slot) slot.innerHTML = isSel ? CHECK_SVG : '';
        });

        updateInputPreviews(name);
      });
    });

    container.querySelectorAll('.agy-input-card').forEach(card => {
      card.addEventListener('click', () => {
        const styleKey = card.dataset.style;
        applyTheme({ inputStyle: styleKey });

        container.querySelectorAll('.agy-input-card').forEach(c => {
          const isSel = c.dataset.style === styleKey;
          c.style.border = isSel ? '1.5px solid #f4f4f5' : '1px solid rgba(255, 255, 255, 0.12)';
          c.style.background = isSel ? 'rgba(42, 34, 30, 0.68)' : 'rgba(14, 12, 12, 0.78)';
          const slot = c.querySelector('.agy-card-check-slot');
          if (slot) slot.innerHTML = isSel ? CHECK_SVG : '';
        });
      });
    });
  }

  function injectMainSidebarButton() {
    if (document.getElementById('agy-custom-theme-sidebar-btn')) return;

    const sidebar = document.querySelector('.bg-sidebar');
    if (!sidebar) return;

    const spans = Array.from(sidebar.querySelectorAll('span'));
    const customSpan = spans.find(s => s.textContent?.trim() === 'Customizations');
    if (!customSpan) return;

    const row = customSpan.closest('a, button, div[role="button"], .group\\/headerbtn') || customSpan.parentElement;
    if (!row || !row.parentNode) return;

    const btn = document.createElement('button');
    btn.id = 'agy-custom-theme-sidebar-btn';
    btn.type = 'button';
    btn.className = 'w-full flex items-center gap-2.5 px-3 py-1.5 text-sm font-medium text-muted-foreground hover:text-foreground rounded-lg transition-colors cursor-pointer select-none';
    btn.style.cssText = 'text-align: left;';
    btn.innerHTML = `
      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;"><path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"/></svg>
      <span style="flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">Custom theme</span>
    `;

    row.parentNode.insertBefore(btn, row.nextSibling);

    btn.addEventListener('click', (e) => {
      e.preventDefault();
      window.__ANTIGRAVITY_OPEN_THEME_MODAL__();
    });
  }

  function injectSettingsModalButton() {
    const modal = document.querySelector('.settings-modal-container');
    if (!modal || document.getElementById('agy-custom-theme-settings-btn')) return;

    const headers = Array.from(modal.querySelectorAll('h2, h3'));
    const appearanceHeader = headers.find(h => h.textContent?.trim() === 'Appearance');
    if (!appearanceHeader) return;

    let targetContainer = appearanceHeader.parentElement;
    while (targetContainer && !targetContainer.className.includes('justify-between') && targetContainer !== modal) {
      targetContainer = targetContainer.parentElement;
    }

    if (!targetContainer || !targetContainer.parentNode) return;

    Array.from(targetContainer.parentNode.children).forEach(child => {
      if (child.id === 'agy-custom-theme-settings-btn') child.remove();
    });

    const btn = document.createElement('button');
    btn.id = 'agy-custom-theme-settings-btn';
    btn.type = 'button';
    btn.className = 'select-none rounded px-3 py-1.5 text-sm font-medium transition-colors cursor-pointer text-white';
    btn.style.cssText = 'background: linear-gradient(135deg, #e08e55 0%, #b45309 100%); border: 1px solid rgba(251, 191, 36, 0.4); box-shadow: 0 2px 10px rgba(224, 142, 85, 0.3); margin-top: 8px; margin-bottom: 8px; display: inline-flex; align-items: center; gap: 6px;';
    btn.innerHTML = `
      <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"/></svg>
      <span>Open Custom Theme Studio</span>
    `;

    targetContainer.parentNode.insertBefore(btn, targetContainer.nextSibling);

    btn.addEventListener('click', () => {
      window.__ANTIGRAVITY_OPEN_THEME_MODAL__();
    });
  }

  function hookSidebarScroll() {
    if (!window.__AGY_SCROLL_AC__) return;
    const scrollers = document.querySelectorAll('.agy-shell .bg-sidebar .overflow-y-auto');
    scrollers.forEach(sc => {
      if (sc.dataset.agyScrollBound) return;
      sc.dataset.agyScrollBound = '1';
      const sync = () => sc.classList.toggle('agy-scrolled', sc.scrollTop > 2);
      sync();
      sc.addEventListener('scroll', sync, { passive: true, signal: window.__AGY_SCROLL_AC__.signal });
    });
  }

  function syncShellMetrics() {
    const shell = findActiveShell();
    if (!shell) return;
    const split = shell.querySelector('[data-testid="sidebar-split"]');
    const sidebarPane = split ? split.firstElementChild : null;
    const titleBar = shell.querySelector('[class*="@container/titlebar"]');
    const sw = sidebarPane ? Math.round(sidebarPane.getBoundingClientRect().width) : 0;
    const shellRect = shell.getBoundingClientRect();
    const hdrBottom = titleBar ? Math.round(titleBar.getBoundingClientRect().bottom - shellRect.top) : 35;
    shell.style.setProperty('--agy-sidebar-w', sw + 'px');
    shell.style.setProperty('--agy-hdr-h', hdrBottom + 'px');

    const hasHoleAttr = document.body.getAttribute('data-has-browser-hole') === 'true';
    const holeEl = hasHoleAttr ? shell.querySelector('[data-browser-hole]:not([data-browser-hole="false"])') : null;
    if (holeEl) {
      if (window.__AGY_SHELL_RO__ && window.__AGY_HOLE_EL__ !== holeEl) {
        try { window.__AGY_SHELL_RO__.observe(holeEl); } catch (e) {}
        window.__AGY_HOLE_EL__ = holeEl;
      }
      const hRect = holeEl.getBoundingClientRect();
      if (hRect.width > 1 && hRect.height > 1) {
        const l = Math.max(0, Math.round(hRect.left - shellRect.left));
        const t = Math.max(0, Math.round(hRect.top - shellRect.top));
        const r = Math.max(l, Math.round(hRect.right - shellRect.left));
        const b = Math.max(t, Math.round(hRect.bottom - shellRect.top));
        shell.style.setProperty(
          '--agy-hole-clip',
          `polygon(evenodd, 0 0, 100% 0, 100% 100%, 0 100%, 0 0, ${l}px ${t}px, ${r}px ${t}px, ${r}px ${b}px, ${l}px ${b}px, ${l}px ${t}px)`
        );
        shell.dataset.agyHoleActive = '1';
        delete shell.dataset.agySideGlass;
        return;
      }
    }
    window.__AGY_HOLE_EL__ = null;
    delete shell.dataset.agyHoleActive;
    shell.style.removeProperty('--agy-hole-clip');

    const sideBody = shell.querySelector('[data-side-panel-body="true"]');
    if (sideBody) {
      if (window.__AGY_SHELL_RO__ && window.__AGY_SIDE_EL__ !== sideBody) {
        try { window.__AGY_SHELL_RO__.observe(sideBody); } catch (e) {}
        window.__AGY_SIDE_EL__ = sideBody;
      }
      const sRect = sideBody.getBoundingClientRect();
      const hasContent = sideBody.children.length > 0;
      if (hasContent && sRect.width > 24 && sRect.height > 24 && sRect.left < shellRect.right - 8 && sRect.right > shellRect.left + 8) {
        const sl = Math.max(sw, Math.round(sRect.left - shellRect.left));
        const st = Math.max(hdrBottom, Math.round(sRect.top - shellRect.top));
        const sr = Math.min(Math.round(shellRect.width), Math.max(sl, Math.round(sRect.right - shellRect.left)));
        const sb = Math.min(Math.round(shellRect.height), Math.max(st, Math.round(sRect.bottom - shellRect.top)));
        if (sr - sl > 20 && sb - st > 20) {
          shell.style.setProperty('--agy-side-l', sl + 'px');
          shell.style.setProperty('--agy-side-t', st + 'px');
          shell.style.setProperty('--agy-side-r', sr + 'px');
          shell.style.setProperty('--agy-side-b', sb + 'px');
          shell.dataset.agySideGlass = '1';
          return;
        }
      }
    }
    delete shell.dataset.agySideGlass;
  }

  function hookShellMetrics() {
    const shell = findActiveShell();
    if (!shell) return;
    if (!shell.dataset.agyTboMounted) {
      shell.dataset.agyTboMounted = '1';
      scheduleTitleBarSync();
    }
    if (!window.__AGY_SHELL_RO__ && typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(syncShellMetrics);
      ro.observe(shell);
      const sidebarPane = shell.querySelector('[data-testid="sidebar-split"]')?.firstElementChild;
      if (sidebarPane) ro.observe(sidebarPane);
      window.__AGY_SHELL_RO__ = ro;
    }
    syncShellMetrics();
  }

  function pickTawaGreeting() {
    const st = getState();
    const customList = Array.isArray(st.customGreetings) ? st.customGreetings.filter(Boolean) : [];
    const pool = customList.length > 0 ? customList : DEFAULT_CUSTOM_GREETINGS;
    if (!pool.length) return '';
    const prev = window.__AGY_LAST_GREETING__;
    const choices = pool.length > 1 ? pool.filter(s => s !== prev) : pool;
    const picked = choices[Math.floor(Math.random() * choices.length)] || pool[0];
    window.__AGY_LAST_GREETING__ = picked;
    return picked;
  }

  function syncEmptyGreeting(stOverride) {
    const st = stOverride || getState();
    const shell = findActiveShell();
    if (!shell) return;
    const hasCustom = Array.isArray(st.customGreetings) && st.customGreetings.some(Boolean);
    if (!st.tawaGreeting || (!hasCustom && !DEFAULT_CUSTOM_GREETINGS.length)) {
      shell.querySelectorAll('[data-agy-greeting]').forEach((el) => {
        el.removeAttribute('data-agy-greeting');
        delete el.dataset.agyGreetingOrig;
      });
      return;
    }
    const root = shell.querySelector('[data-main-content-body="true"]') || shell;
    const hasChat = Boolean(root.querySelector('[data-testid="agent-response"], .agy-user-bubble-frame'));
    if (hasChat) {
      window.__AGY_GREETING_NEED_FRESH__ = true;
      return;
    }
    const candidates = root.querySelectorAll('h1, h2, h3, p, div, span');
    for (let i = 0; i < candidates.length; i++) {
      const el = candidates[i];
      if (el.children.length > 0) continue;
      if (el.closest('.surface-composer, [data-testid="agent-response"], .agy-user-bubble-frame, .settings-modal-container, #agy-custom-theme-modal-backdrop, .bg-sidebar, [class*="@container/titlebar"], pre, code, button, input, textarea')) {
        continue;
      }
      const txt = (el.textContent || '').trim();
      if (!txt || txt.length > 85) continue;
      if (!GREETING_RX.test(txt)) continue;
      if (!el.hasAttribute('data-agy-greeting') || window.__AGY_GREETING_NEED_FRESH__ || el.dataset.agyGreetingOrig !== txt) {
        el.dataset.agyGreetingOrig = txt;
        el.setAttribute('data-agy-greeting', pickTawaGreeting());
        window.__AGY_GREETING_NEED_FRESH__ = false;
      }
      break;
    }
  }

  const taskVoiceState = {
    wasRunning: false,
    lastUrl: location.href,
    urlChangedAt: 0,
    userCancelledAt: 0,
    lastPlayedUrl: ''
  };

  function stopTaskAudio() {
    const audio = window.__AGY_TASK_AUDIO__;
    if (audio) {
      try {
        audio.pause();
        audio.removeAttribute('src');
        audio.load();
      } catch (e) {}
      window.__AGY_TASK_AUDIO__ = null;
    }
  }

  function playOneShotTaskAudio(rawUrl, volPercent = 85) {
    const resolved = resolveMediaUrl(rawUrl);
    if (!resolved) return;
    stopTaskAudio();
    try {
      const audio = new Audio(resolved);
      audio.volume = Math.max(0, Math.min(1, (Number.isFinite(Number(volPercent)) ? Number(volPercent) : 85) / 100));
      window.__AGY_TASK_AUDIO__ = audio;
      const cleanup = () => {
        try {
          audio.pause();
          audio.removeAttribute('src');
          audio.load();
        } catch (e) {}
        if (window.__AGY_TASK_AUDIO__ === audio) {
          window.__AGY_TASK_AUDIO__ = null;
        }
      };
      audio.addEventListener('ended', cleanup, { once: true });
      audio.addEventListener('error', cleanup, { once: true });
      audio.play().catch(cleanup);
    } catch (e) {}
  }

  function playRandomTaskVoice(ignoreEnabled = false) {
    const st = getState();
    if (!ignoreEnabled && !st.taskVoiceEnabled) return;
    const pool = getMediaLibrary('audio');
    if (pool.length === 0) return;
    const choices = pool.length > 1
      ? pool.filter((item) => !isSameMediaUrl(item.url, taskVoiceState.lastPlayedUrl))
      : pool;
    const picked = choices[Math.floor(Math.random() * choices.length)] || pool[0];
    if (!picked || !picked.url) return;
    taskVoiceState.lastPlayedUrl = picked.url;
    playOneShotTaskAudio(picked.url, st.taskVoiceVol);
  }
  window.__ANTIGRAVITY_TEST_TASK_VOICE__ = () => playRandomTaskVoice(true);

  function syncTaskCompletionVoice() {
    if (location.href !== taskVoiceState.lastUrl) {
      taskVoiceState.lastUrl = location.href;
      taskVoiceState.urlChangedAt = Date.now();
      taskVoiceState.wasRunning = false;
      if (window.__AGY_TASK_COMPLETE_TIMER__) {
        clearTimeout(window.__AGY_TASK_COMPLETE_TIMER__);
        window.__AGY_TASK_COMPLETE_TIMER__ = null;
      }
      return;
    }
    const shell = findActiveShell();
    if (!shell) return;
    const isRunning = Boolean(shell.querySelector('[data-testid="input-cancel-button"]'));
    if (isRunning) {
      if (window.__AGY_TASK_COMPLETE_TIMER__) {
        clearTimeout(window.__AGY_TASK_COMPLETE_TIMER__);
        window.__AGY_TASK_COMPLETE_TIMER__ = null;
      }
      taskVoiceState.wasRunning = true;
      return;
    }
    if (!taskVoiceState.wasRunning || window.__AGY_TASK_COMPLETE_TIMER__) return;
    window.__AGY_TASK_COMPLETE_TIMER__ = setTimeout(() => {
      window.__AGY_TASK_COMPLETE_TIMER__ = null;
      const curShell = findActiveShell();
      if (!curShell || curShell.querySelector('[data-testid="input-cancel-button"]')) {
        return;
      }
      taskVoiceState.wasRunning = false;
      const now = Date.now();
      if (location.href !== taskVoiceState.lastUrl) return;
      if (now - taskVoiceState.urlChangedAt < 1200) return;
      if (now - taskVoiceState.userCancelledAt < 1800) return;
      if (!curShell.querySelector('[data-testid="agent-response"]')) return;
      playRandomTaskVoice(false);
    }, 450);
  }

  function tick() {
    if (!sessionAuthenticated) {
      enforceWorkspaceLock();
    }
    const activeShell = findActiveShell();
    if (activeShell) {
      const liveLayer = document.getElementById('agy-live-bg-layer');
      if (!liveLayer || liveLayer.tagName !== 'AGY-LIVE-BG' || liveLayer.parentElement !== activeShell) {
        applyTheme();
      }
    }
    injectMainSidebarButton();
    injectSettingsModalButton();
    hookSidebarScroll();
    hookShellMetrics();
    syncEmptyGreeting();
    syncTaskCompletionVoice();
  }

  function scheduleTick() {
    if (window.__AGY_TICK_RAF__) return;
    window.__AGY_TICK_RAF__ = requestAnimationFrame(() => {
      window.__AGY_TICK_RAF__ = 0;
      tick();
    });
  }

  clearTitleBarTimers();
  if (window.__AGY_TICK_RAF__) {
    cancelAnimationFrame(window.__AGY_TICK_RAF__);
    window.__AGY_TICK_RAF__ = 0;
  }
  if (window.__AGY_SHELL_RO__) {
    try { window.__AGY_SHELL_RO__.disconnect(); } catch (e) {}
    window.__AGY_SHELL_RO__ = null;
  }
  if (window.__AGY_SCROLL_AC__) {
    try { window.__AGY_SCROLL_AC__.abort(); } catch (e) {}
  }
  if (window.__AGY_TASK_COMPLETE_TIMER__) {
    clearTimeout(window.__AGY_TASK_COMPLETE_TIMER__);
    window.__AGY_TASK_COMPLETE_TIMER__ = null;
  }
  window.__AGY_SCROLL_AC__ = new AbortController();
  document.addEventListener('click', (e) => {
    if (e.target && typeof e.target.closest === 'function' && e.target.closest('[data-testid="input-cancel-button"]')) {
      taskVoiceState.userCancelledAt = Date.now();
    }
  }, { capture: true, signal: window.__AGY_SCROLL_AC__.signal });
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && String(e.key || '').toLowerCase() === 'd') {
      taskVoiceState.userCancelledAt = Date.now();
    }
  }, { capture: true, signal: window.__AGY_SCROLL_AC__.signal });
  window.addEventListener('load', () => scheduleTitleBarSync(), { signal: window.__AGY_SCROLL_AC__.signal });
  window.addEventListener('focus', () => syncTitleBarOverlay(), { signal: window.__AGY_SCROLL_AC__.signal });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) syncTitleBarOverlay();
  }, { signal: window.__AGY_SCROLL_AC__.signal });
  document.querySelectorAll('[data-agy-scroll-bound]').forEach(el => delete el.dataset.agyScrollBound);
  document.querySelectorAll('[data-agy-tbo-mounted]').forEach(el => delete el.dataset.agyTboMounted);
  const staleBackdrop = document.getElementById('agy-custom-theme-modal-backdrop');
  if (staleBackdrop) staleBackdrop.remove();
  const staleSidebarBtn = document.getElementById('agy-custom-theme-sidebar-btn');
  if (staleSidebarBtn) staleSidebarBtn.remove();
  const staleSettingsBtn = document.getElementById('agy-custom-theme-settings-btn');
  if (staleSettingsBtn) staleSettingsBtn.remove();

  window.__AGY_HOLE_EL__ = null;
  if (window.__AGY_MODAL_OBSERVER__) {
    window.__AGY_MODAL_OBSERVER__.disconnect();
  }
  window.__AGY_MODAL_OBSERVER__ = new MutationObserver(scheduleTick);
  const observeRoot = document.body || document.documentElement;
  if (observeRoot) {
    window.__AGY_MODAL_OBSERVER__.observe(observeRoot, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['data-has-browser-hole', 'data-browser-hole']
    });
  }
  tick();

  return 'Antigravity Custom Theme Engine Ready!';
})();
