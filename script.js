// =====================================================================
// FELICIA PORTFOLIO — script.js v11.0
// Fixed: iframe guard, event delegation for uploads, YouTube reinit
// =====================================================================
(function () {

    // ── Iframe guard: if this script runs inside a loader iframe, exit silently ──
    if (window.top !== window.self) return;

    // =====================================================================
    // § A — INDEXEDDB (persistent large-file audio storage)
    // =====================================================================
    const DB_NAME       = 'FeliciaMusicDB';
    const DB_VER        = 1;
    const STORE_NAME    = 'audio_files';
    const STATE_KEY     = 'felicia_audio_state';

    function openDB() {
        return new Promise((res, rej) => {
            const req = indexedDB.open(DB_NAME, DB_VER);
            req.onupgradeneeded = e => {
                if (!e.target.result.objectStoreNames.contains(STORE_NAME))
                    e.target.result.createObjectStore(STORE_NAME, { keyPath: 'id' });
            };
            req.onsuccess = () => res(req.result);
            req.onerror   = () => rej(req.error);
        });
    }
    async function dbSave(id, blob) {
        try { const db = await openDB(); return new Promise((res,rej)=>{ const tx=db.transaction(STORE_NAME,'readwrite'); tx.objectStore(STORE_NAME).put({id,data:blob}); tx.oncomplete=()=>res(true); tx.onerror=()=>rej(tx.error); }); } catch(e){ console.warn('IDB save',e); }
    }
    async function dbGet(id) {
        try { const db = await openDB(); return new Promise((res,rej)=>{ const tx=db.transaction(STORE_NAME,'readonly'); const r=tx.objectStore(STORE_NAME).get(id); r.onsuccess=()=>res(r.result?.data??null); r.onerror=()=>rej(r.error); }); } catch(e){ console.warn('IDB get',e); return null; }
    }
    async function dbDel(id) {
        try { const db = await openDB(); return new Promise((res,rej)=>{ const tx=db.transaction(STORE_NAME,'readwrite'); tx.objectStore(STORE_NAME).delete(id); tx.oncomplete=()=>res(true); tx.onerror=()=>rej(tx.error); }); } catch(e){ console.warn('IDB del',e); }
    }

    // =====================================================================
    // § B — GLOBAL STATE
    // =====================================================================
    const DEFAULT_COVER = 'music-cover.jpg';

    const DEFAULT_YT = [
        { id:100, youtubeId:'TdVS69vxap8', title:'The Music Freaks Ep.1 | RosyClozy', artist:'RosyClozy', thumbnail:'https://img.youtube.com/vi/TdVS69vxap8/hqdefault.jpg' }
    ];

    let playlist      = [];
    let ytVideos      = [];
    let songIndex     = 0;
    let isPlaying     = false;
    let globalAudio   = null;   // lives in <body>, never destroyed
    let _initialized  = false;

    // Permanent default playlist (Ed Sheeran & Taylor Swift)
    const PERMANENT_PLAYLIST = [
        { id:'song_perfect',   title:'Perfect',    artist:'Ed Sheeran',   src:'Ed Sheeran - Perfect.mp3',                type:'url' },
        { id:'song_lovestory', title:'Love Story', artist:'Taylor Swift',  src:'Taylor Swift - Love Story (Lyrics) (1).mp3', type:'url' }
    ];

    // Load persisted data or set permanent default
    try { playlist = JSON.parse(localStorage.getItem('felicia_playlist')) || []; } catch(_){}
    if (!playlist.length || !playlist.some(s => s.title === 'Perfect' || s.title === 'Love Story')) {
        playlist = PERMANENT_PLAYLIST;
        try { localStorage.setItem('felicia_playlist', JSON.stringify(playlist)); } catch(_){}
    }

    // Force Rozy Clozy videos only
    ytVideos = DEFAULT_YT;
    try { localStorage.setItem('felicia_youtube', JSON.stringify(ytVideos)); } catch(_){}

    // =====================================================================
    // § C — BOOTSTRAP (runs once on first DOMContentLoaded)
    // =====================================================================
    document.addEventListener('DOMContentLoaded', () => {
        if (!_initialized) {
            _initialized = true;
            buildPersistentAudio();
            buildMiniPlayer();
            initRouter();
            attachGlobalDelegation(); // ← Event Delegation on document (persists across SPA)
        }
        reinit();
    });

    // =====================================================================
    // § D — EVENT DELEGATION (document-level, survives SPA page swaps)
    // =====================================================================
    function attachGlobalDelegation() {
        // File inputs — audio upload (id: audio-upload OR audio-upload-btn)
        document.addEventListener('change', e => {
            const t = e.target;
            if (t.type === 'file' && t.accept && t.accept.includes('audio')) {
                handleAudioFiles(t.files);
                t.value = ''; // reset so same file can be re-selected
            }
            // profile photo upload
            if (t.id === 'profile-photo-upload') {
                handleProfilePhoto(t.files[0]);
            }
        });

        // Auth form submit (profile edit)
        document.addEventListener('submit', e => {
            if (e.target.id === 'edit-profile-form') {
                e.preventDefault();
                saveProfileForm();
            }
        });

        // Keyboard shortcut: Space = play/pause when not typing
        document.addEventListener('keydown', e => {
            if (e.target && e.target.id === 'profile-name' && e.key === 'Enter') {
                e.preventDefault();
                e.target.blur();
                return;
            }
            if (['INPUT','TEXTAREA','SELECT'].includes(e.target.tagName)) return;
            if (e.target && e.target.isContentEditable) return;
            if (e.code === 'Space') { e.preventDefault(); togglePlay(); }
            if (e.code === 'ArrowRight') nextSong();
            if (e.code === 'ArrowLeft')  prevSong();
        });

        // Profile inline name edit (focusout / blur)
        document.addEventListener('focusout', e => {
            if (e.target && e.target.id === 'profile-name') {
                saveInlineProfileName(e.target);
            }
        });
    }

    // =====================================================================
    // § E — PERSISTENT AUDIO (created once, lives in <body>)
    // =====================================================================
    function buildPersistentAudio() {
        if (document.getElementById('global-audio')) {
            globalAudio = document.getElementById('global-audio');
            return;
        }
        globalAudio = document.createElement('audio');
        globalAudio.id      = 'global-audio';
        globalAudio.preload = 'auto';
        globalAudio.style.display = 'none';
        document.body.appendChild(globalAudio);

        globalAudio.addEventListener('ended', () => {
            if (!playlist.length) return;
            songIndex = (songIndex + 1) % playlist.length;
            loadAndPlay(songIndex, true);
        });
        globalAudio.addEventListener('timeupdate',    syncProgress);
        globalAudio.addEventListener('timeupdate',    saveState);
        globalAudio.addEventListener('pause',         () => { isPlaying = false;  syncIcons(); saveState(); });
        globalAudio.addEventListener('play',          () => { isPlaying = true;   syncIcons(); saveState(); });
        globalAudio.addEventListener('loadedmetadata',() => {
            const dur = globalAudio.duration;
            setEl('duration', fmt(dur));
            const s = document.getElementById('seek-bar');
            if (s) s.max = Math.floor(dur);
        });
        window.addEventListener('beforeunload', saveState);

        // Restore session state or play first song
        if (!restoreState()) {
            loadAndPlay(0, false);
        }
    }

    // =====================================================================
    // § F — SPA ROUTER
    // =====================================================================
    function initRouter() {
        document.addEventListener('click', e => {
            const a = e.target.closest('a[href]');
            if (!a) return;
            const href = a.getAttribute('href') || '';
            if (!href || href.startsWith('#') || href.startsWith('javascript:')) return;
            if (href.startsWith('http://') || href.startsWith('https://') || href.startsWith('mailto:')) return;
            if (a.target === '_blank') return;
            if (href.includes('.html')) {
                e.preventDefault();
                navigate(href);
            }
        });
        window.addEventListener('popstate', () => {
            const page = location.pathname.split('/').pop() || 'index.html';
            navigate(page, false);
        });
    }

    async function navigate(url, push = true) {
        const clean   = url.split('#')[0];
        const current = location.pathname.split('/').pop() || 'index.html';
        if (current === clean.split('/').pop() && !url.includes('#')) return;

        saveState();
        const main = document.querySelector('main');
        if (!main) { location.href = clean; return; }

        main.style.transition = 'opacity 0.12s';
        main.style.opacity    = '0.15';

        let html = null, title = '';

        // 1️⃣  Try Fetch (works on web server)
        try {
            const r = await fetch(clean);
            if (r.ok) {
                const raw = await r.text();
                const doc = new DOMParser().parseFromString(raw, 'text/html');
                const m   = doc.querySelector('main');
                if (m && m.innerHTML.trim()) { html = m.innerHTML; title = doc.title; }
            }
        } catch (_) { /* file:// → try iframe */ }

        // 2️⃣  Iframe fallback (file:// protocol)
        if (!html) {
            ({ html, title } = await iframeLoad(clean));
        }

        if (html) {
            main.innerHTML = html;
            if (title) document.title = title;
            if (push) {
                try { history.pushState({ url: clean }, title, clean); } catch (_) {}
            }
            highlightNav(clean);
            await tick(60);
            main.style.opacity = '1';
            reinit();
        } else {
            // hard navigate (saves audio state via beforeunload)
            location.href = clean;
        }
    }

    function iframeLoad(src) {
        return new Promise(resolve => {
            const iframe = document.createElement('iframe');
            Object.assign(iframe.style, { position:'fixed', top:'-9999px', left:'-9999px', width:'1px', height:'1px', opacity:'0', pointerEvents:'none' });
            let done = false;
            const finish = (html, title) => {
                if (done) return; done = true;
                iframe.remove();
                resolve({ html: html || null, title: title || '' });
            };
            iframe.onload = () => {
                try {
                    const d = iframe.contentDocument || iframe.contentWindow?.document;
                    const m = d?.querySelector('main');
                    finish(m?.innerHTML || null, d?.title);
                } catch(_) { finish(null, ''); }
            };
            iframe.onerror = () => finish(null, '');
            setTimeout(() => finish(null, ''), 3000);
            iframe.src = src;
            document.body.appendChild(iframe);
        });
    }

    function highlightNav(url) {
        const page = url.split('/').pop().split('#')[0] || 'index.html';
        document.querySelectorAll('aside nav a.nav-item').forEach(a => {
            const h = (a.getAttribute('href') || '').split('/').pop();
            h === page ? a.classList.add('active') : a.classList.remove('active');
            a.style.background = '';
            a.style.boxShadow  = '';
        });
        document.querySelectorAll('nav.md\\:hidden a').forEach(a => {
            const h = (a.getAttribute('href') || '').split('/').pop();
            a.classList.toggle('text-primary',   h === page && page !== 'bahasa-indonesia.html');
            a.classList.toggle('text-pink-500',  h === page &&  page === 'bahasa-indonesia.html');
            a.classList.toggle('text-slate-400', h !== page);
        });
    }

    // =====================================================================
    // § G — REINIT (called after every page swap + initial load)
    // =====================================================================
    function reinit() {
        try { lucide.createIcons(); }       catch(_){}
        try { loadProfileData(); }          catch(_){}
        try { initPhotoFrames(); }          catch(_){}
        try { initArticleEditor(); }        catch(_){}
        if (sessionStorage.getItem('felicia_auth') === 'true') showAuthUI();

        // Dashboard-specific
        if (document.getElementById('play-btn')) {
            try { wireDashboardPlayer(); } catch(_){}
            try { renderPlaylist(); }       catch(_){}
        }

        // YouTube grid (exists on dashboard)
        try { initYouTubePlayer(); } catch(_){}

        // Task pages
        if (document.getElementById('informatika-tasks') || document.getElementById('bindo-tasks')) {
            try { initTaskModal(); initTasks(); } catch(_){}
        }

        syncSongUI();
        syncIcons();
        updateMiniPlayer();
        window.scrollTo(0, 0);
    }

    // =====================================================================
    // § H — AUDIO UPLOAD via Event Delegation
    //   handleAudioFiles is called by the document-level 'change' listener
    //   → works NO MATTER which page the user is on
    // =====================================================================
    function handleAudioFiles(files) {
        if (!files || !files.length) return;
        showToast(`⏳ Memuat ${files.length} lagu…`);

        const startIdx = playlist.length;
        let count = 0;

        for (let i = 0; i < files.length; i++) {
            const file = files[i];
            if (!file.type.startsWith('audio/') && !file.name.match(/\.(mp3|wav|ogg|flac|aac|m4a)$/i)) continue;

            const songId  = `upload_${Date.now()}_${i}`;
            const blobUrl = URL.createObjectURL(file); // instant, zero-latency
            const title   = file.name.replace(/\.[^.]+$/, '');

            const song = { id: songId, title, artist: 'Upload Lokal 🎵', cover: DEFAULT_COVER, src: blobUrl, storageKey: songId, type: 'local' };
            playlist.push(song);
            count++;

            // Async: save to IndexedDB for persistence (doesn't block playback)
            dbSave(songId, file).catch(e => console.warn('IDB save failed', e));

            // Async: also store DataURL as fallback if file < 4 MB
            if (file.size < 4 * 1024 * 1024) {
                const reader = new FileReader();
                reader.onload = ev => { song.dataUrl = ev.target.result; savePlaylist(); };
                reader.onerror = () => {};
                reader.readAsDataURL(file);
            }
        }

        if (!count) { showToast('❌ Tidak ada file audio yang valid.', 'error'); return; }

        savePlaylist();
        renderPlaylist();
        showToast(`🎵 ${count} lagu ditambahkan!`);
        loadAndPlay(startIdx, true); // ← start playing the first newly added song
    }

    // =====================================================================
    // § I — AUDIO ENGINE
    // =====================================================================
    async function loadAndPlay(idx, play, seekTo = 0) {
        if (!playlist.length || !globalAudio) return;
        idx = Math.max(0, Math.min(idx, playlist.length - 1));
        songIndex = idx;

        const song = playlist[idx];
        if (!song) return;

        syncSongUI(song);
        renderPlaylist(); // highlight active

        let src = song.src;

        // If src is a blob URL that has expired (page reload), try to recover from IDB
        if (song.storageKey && (!src || src.startsWith('blob:') && !await blobUrlAlive(src))) {
            try {
                const data = await dbGet(song.storageKey);
                if (data instanceof Blob || data instanceof File) {
                    src = URL.createObjectURL(data);
                    song.src = src;
                } else if (typeof data === 'string' && data.startsWith('data:')) {
                    src = data; song.src = src;
                } else if (song.dataUrl) {
                    src = song.dataUrl; song.src = src;
                }
            } catch(e) { console.warn('IDB read error', e); }
        }

        // Final fallback: dataUrl
        if (!src || src === 'undefined') {
            src = song.dataUrl || '';
        }

        if (!src) {
            showToast('❌ File audio tidak ditemukan.', 'error');
            return;
        }

        try {
            if (globalAudio.src !== src) {
                globalAudio.src = src;
                globalAudio.load();
                if (play) {
                    globalAudio.addEventListener('canplay', () => {
                        if (seekTo > 0) { try { globalAudio.currentTime = seekTo; } catch(_){} }
                        globalAudio.play().catch(err => { console.warn('play blocked', err); isPlaying = false; syncIcons(); });
                    }, { once: true });
                } else {
                    if (seekTo > 0) globalAudio.addEventListener('loadedmetadata', () => {
                        try { globalAudio.currentTime = seekTo; } catch(_){}
                    }, { once: true });
                }
            } else {
                if (seekTo > 0) { try { globalAudio.currentTime = seekTo; } catch(_){} }
                if (play) globalAudio.play().catch(err => { console.warn('play blocked', err); isPlaying = false; syncIcons(); });
            }
        } catch(e) {
            console.error('Audio load error', e);
            showToast('❌ Gagal memuat audio.', 'error');
        }

        updateMiniPlayer();
    }

    // Check if a blob: URL is still valid (not revoked)
    async function blobUrlAlive(url) {
        if (!url || !url.startsWith('blob:')) return false;
        try {
            const r = await fetch(url);
            return r.ok;
        } catch(_) { return false; }
    }

    function togglePlay() {
        if (!globalAudio || !playlist.length) return;
        if (globalAudio.paused) {
            globalAudio.play().catch(() => {});
        } else {
            globalAudio.pause();
        }
    }

    function nextSong() {
        if (!playlist.length) return;
        loadAndPlay((songIndex + 1) % playlist.length, true);
    }
    function prevSong() {
        if (!playlist.length) return;
        loadAndPlay((songIndex - 1 + playlist.length) % playlist.length, true);
    }

    // =====================================================================
    // § J — SESSION STATE (auto-resume after hard reload / direct URL open)
    // =====================================================================
    function saveState() {
        try {
            sessionStorage.setItem(STATE_KEY, JSON.stringify({
                index:   songIndex,
                time:    globalAudio?.currentTime || 0,
                playing: isPlaying
            }));
        } catch(_){}
    }

    function restoreState() {
        try {
            const s = JSON.parse(sessionStorage.getItem(STATE_KEY));
            if (!s || typeof s.index !== 'number') return false;
            if (!playlist[s.index]) return false;
            loadAndPlay(s.index, s.playing, s.time || 0);
            return true;
        } catch(_) { return false; }
    }

    // =====================================================================
    // § K — DASHBOARD PLAYER CONTROLS (re-wired after each page swap)
    // =====================================================================
    function wireDashboardPlayer() {
        const wire = (id, fn) => { const el = document.getElementById(id); if (el) el.onclick = fn; };
        wire('play-btn',  togglePlay);
        wire('prev-btn',  prevSong);
        wire('next-btn',  nextSong);

        const seekBar = document.getElementById('seek-bar');
        if (seekBar) {
            seekBar.oninput = () => {
                if (globalAudio) { try { globalAudio.currentTime = +seekBar.value; } catch(_){} }
            };
        }
        // Note: file inputs are NOT wired here — they are caught by global delegation
    }

    // =====================================================================
    // § L — UI SYNC HELPERS
    // =====================================================================
    const fmt = t => { if (!t || isNaN(t)) return '0:00'; const m = Math.floor(t/60), s = Math.floor(t%60); return `${m}:${s<10?'0':''}${s}`; };
    const setEl = (id, v) => { const e = document.getElementById(id); if (e) e.innerText = v; };
    const setSrc = (id, v) => { const e = document.getElementById(id); if (e && v) e.src = v; };

    function syncSongUI(song) {
        song = song || playlist[songIndex];
        if (!song) return;
        setEl('song-title',  song.title);
        setEl('song-artist', song.artist);
        setSrc('album-cover', song.cover);
        setEl('mini-title',  song.title);
        setEl('mini-artist', song.artist);
        setSrc('mini-cover', song.cover);
    }

    function syncIcons() {
        // main player icon
        const pi = document.getElementById('play-icon');
        if (pi) { pi.setAttribute('data-lucide', isPlaying ? 'pause' : 'play'); try { lucide.createIcons(); } catch(_){} }
        // mini player icon
        const mi = document.getElementById('mini-play-icon');
        if (mi) { mi.setAttribute('data-lucide', isPlaying ? 'pause' : 'play'); try { lucide.createIcons(); } catch(_){} }
    }

    function syncProgress() {
        if (!globalAudio || isNaN(globalAudio.duration)) return;
        const pct = (globalAudio.currentTime / globalAudio.duration) * 100;
        const bar = document.getElementById('mini-progress-bar');
        if (bar) bar.style.width = `${pct}%`;
        const sk = document.getElementById('seek-bar');
        if (sk) sk.value = globalAudio.currentTime;
        setEl('current-time', fmt(globalAudio.currentTime));
    }

    // =====================================================================
    // § M — MINI PLAYER (Spotify-style, fixed bottom-right, lives in <body>)
    // =====================================================================
    function buildMiniPlayer() {
        if (document.getElementById('mini-player')) return;
        const mp = document.createElement('div');
        mp.id = 'mini-player';
        mp.style.cssText = 'display:none;position:fixed;bottom:90px;right:20px;z-index:9990;width:315px;opacity:0;transform:translateY(20px);transition:opacity .4s cubic-bezier(.34,1.56,.64,1),transform .4s cubic-bezier(.34,1.56,.64,1);';
        mp.innerHTML = `
        <div style="background:rgba(255,255,255,0.97);backdrop-filter:blur(24px);-webkit-backdrop-filter:blur(24px);border-radius:22px;box-shadow:0 20px 60px -10px rgba(100,149,237,.3),0 0 0 1.5px rgba(255,255,255,.9);overflow:hidden;font-family:'Outfit',sans-serif;">
            <div style="height:3px;background:#f1f5f9;"><div id="mini-progress-bar" style="height:100%;width:0%;background:linear-gradient(90deg,#ffb347,#6495ed);transition:width .2s linear;"></div></div>
            <div style="padding:14px 16px;display:flex;align-items:center;gap:12px;">
                <img id="mini-cover" src="${DEFAULT_COVER}" style="width:50px;height:50px;border-radius:12px;object-fit:cover;flex-shrink:0;box-shadow:0 4px 14px rgba(0,0,0,.2);" onerror="this.src='${DEFAULT_COVER}'">
                <div style="flex:1;min-width:0;">
                    <p id="mini-title"  style="font-weight:700;font-size:13px;color:#1e293b;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin:0 0 2px;"></p>
                    <p id="mini-artist" style="font-size:11px;color:#94a3b8;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin:0;"></p>
                </div>
                <div style="display:flex;align-items:center;gap:2px;flex-shrink:0;">
                    <button id="mini-prev" title="Sebelumnya" style="width:30px;height:30px;border:none;background:transparent;cursor:pointer;border-radius:8px;display:flex;align-items:center;justify-content:center;color:#94a3b8;transition:all .2s;" onmouseover="this.style.background='#f8fafc';this.style.color='#ffb347'" onmouseout="this.style.background='transparent';this.style.color='#94a3b8'"><i data-lucide="skip-back"    style="width:14px;height:14px;"></i></button>
                    <button id="mini-play-btn" title="Play/Pause" style="width:38px;height:38px;border:none;background:linear-gradient(135deg,#ffb347,#6495ed);cursor:pointer;border-radius:50%;display:flex;align-items:center;justify-content:center;color:white;box-shadow:0 4px 14px rgba(255,179,71,.4);transition:transform .2s;" onmouseover="this.style.transform='scale(1.1)'" onmouseout="this.style.transform='scale(1)'"><i id="mini-play-icon" data-lucide="play" style="width:16px;height:16px;"></i></button>
                    <button id="mini-next" title="Berikutnya" style="width:30px;height:30px;border:none;background:transparent;cursor:pointer;border-radius:8px;display:flex;align-items:center;justify-content:center;color:#94a3b8;transition:all .2s;" onmouseover="this.style.background='#f8fafc';this.style.color='#ffb347'" onmouseout="this.style.background='transparent';this.style.color='#94a3b8'"><i data-lucide="skip-forward" style="width:14px;height:14px;"></i></button>
                </div>
            </div>
        </div>
        <button id="mini-close-btn" title="Tutup" style="position:absolute;top:-8px;right:-8px;width:22px;height:22px;border:2px solid white;background:#1e293b;color:white;border-radius:50%;cursor:pointer;display:flex;align-items:center;justify-content:center;padding:0;transition:background .2s;" onmouseover="this.style.background='#ef4444'" onmouseout="this.style.background='#1e293b'"><i data-lucide="x" style="width:11px;height:11px;"></i></button>`;
        document.body.appendChild(mp);
        try { lucide.createIcons(); } catch(_){}

        document.getElementById('mini-play-btn').onclick  = togglePlay;
        document.getElementById('mini-prev').onclick      = prevSong;
        document.getElementById('mini-next').onclick      = nextSong;
        document.getElementById('mini-close-btn').onclick = () => {
            mp.style.opacity = '0'; mp.style.transform = 'translateY(20px)';
            setTimeout(() => mp.style.display = 'none', 400);
        };
    }

    function updateMiniPlayer() {
        const mp = document.getElementById('mini-player');
        if (!mp) return;

        const onDashboard = !!document.getElementById('play-btn');
        if (onDashboard || !playlist.length) { mp.style.display = 'none'; return; }

        if (mp.style.display === 'none') {
            mp.style.display = 'block';
            requestAnimationFrame(() => { mp.style.opacity = '1'; mp.style.transform = 'translateY(0)'; });
        }

        syncSongUI();
        syncIcons();
    }

    // =====================================================================
    // § N — PLAYLIST
    // =====================================================================
    function savePlaylist() {
        try {
            const clean = playlist.map(s => ({
                id:         s.id,
                title:      s.title,
                artist:     s.artist,
                cover:      s.cover || '',
                src:        (s.type === 'url') ? s.src : '',     // don't persist blob URLs
                dataUrl:    s.dataUrl || null,
                storageKey: s.storageKey || null,
                type:       s.type || 'url'
            }));
            localStorage.setItem('felicia_playlist', JSON.stringify(clean));
        } catch(e) { console.warn('Playlist save error', e); }
    }

    window.playSong = idx => loadAndPlay(idx, true);

    window.renderPlaylist = function() {
        const c = document.getElementById('playlist-container');
        if (!c) return;
        const auth = sessionStorage.getItem('felicia_auth') === 'true';
        c.innerHTML = '';
        playlist.forEach((s, i) => {
            const active = i === songIndex;
            const bdr    = active ? '#ffb347' : 'transparent';
            const bg     = active ? 'linear-gradient(135deg,rgba(255,179,71,.08),rgba(100,149,237,.08))' : 'transparent';
            const titClr = active ? '#ffb347' : '#1e293b';
            c.insertAdjacentHTML('beforeend', `
            <div onclick="playSong(${i})" style="display:flex;align-items:center;gap:12px;padding:12px 14px;border-radius:16px;cursor:pointer;transition:all .2s;border:1.5px solid ${bdr};background:${bg};" onmouseover="this.style.background='#f8fafc'" onmouseout="this.style.background='${bg}'">
                <div style="width:36px;height:36px;border-radius:12px;background:${active ? '#ffb347' : '#f1f5f9'};color:${active ? '#fff' : '#6495ed'};display:flex;align-items:center;justify-content:center;flex-shrink:0;">
                    <i data-lucide="music" style="width:18px;height:18px;"></i>
                </div>
                <div style="overflow:hidden;flex:1;min-width:0;">
                    <p style="font-weight:700;font-size:13px;color:${titClr};white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin:0 0 2px;">${s.title}</p>
                    <p style="font-size:11px;color:#94a3b8;margin:0;">${s.artist}</p>
                </div>
                ${active ? '<span style="width:8px;height:8px;border-radius:50%;background:#ffb347;flex-shrink:0;animation:pulse 1.5s infinite;"></span>' : ''}
                <button onclick="event.stopPropagation();deleteSong(${i})" style="width:26px;height:26px;border:none;background:transparent;cursor:pointer;color:#cbd5e1;border-radius:8px;display:flex;align-items:center;justify-content:center;flex-shrink:0;transition:all .2s;" onmouseover="this.style.color='#ef4444';this.style.background='#fef2f2'" onmouseout="this.style.color='#cbd5e1';this.style.background='transparent'"><i data-lucide="trash-2" style="width:13px;height:13px;"></i></button>
            </div>`);
        });
        try { lucide.createIcons(); } catch(_){}
    };

    // ── EDIT SONG MODAL — rich UI with real-time cover preview & Mini Player sync ──
    window.editCurrentSong = function() {
        if (!playlist.length) return;
        const s = playlist[songIndex];
        document.getElementById('editSongModal')?.remove();

        const modal = document.createElement('div');
        modal.id = 'editSongModal';
        modal.style.cssText = 'position:fixed;inset:0;z-index:9997;display:flex;align-items:center;justify-content:center;padding:16px;background:rgba(15,23,42,0.7);backdrop-filter:blur(10px);';
        modal.innerHTML = `
        <div id="editSongCard" style="background:white;border-radius:2rem;padding:2rem;width:100%;max-width:420px;box-shadow:0 32px 80px rgba(0,0,0,0.25);border:3px solid #ffb347;font-family:'Outfit',sans-serif;animation:slideUp .35s cubic-bezier(.34,1.56,.64,1);">

            <!-- Header -->
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:1.5rem;">
                <div style="display:flex;align-items:center;gap:10px;">
                    <div style="width:40px;height:40px;border-radius:12px;background:linear-gradient(135deg,#ffb347,#6495ed);display:flex;align-items:center;justify-content:center;">
                        <i data-lucide="music-4" style="width:20px;height:20px;color:white;"></i>
                    </div>
                    <div>
                        <h3 style="font-weight:800;font-size:16px;color:#1e293b;margin:0;letter-spacing:.04em;">EDIT INFO LAGU</h3>
                        <p style="font-size:11px;color:#94a3b8;margin:0;font-weight:600;">Perubahan langsung sinkron ke Mini Player</p>
                    </div>
                </div>
                <button id="esm-close" style="width:34px;height:34px;border:none;background:#f1f5f9;border-radius:10px;cursor:pointer;display:flex;align-items:center;justify-content:center;color:#64748b;transition:all .2s;" onmouseover="this.style.background='#fee2e2';this.style.color='#ef4444'" onmouseout="this.style.background='#f1f5f9';this.style.color='#64748b'"><i data-lucide="x" style="width:16px;height:16px;"></i></button>
            </div>

            <!-- Cover Preview -->
            <div style="position:relative;margin-bottom:1.25rem;">
                <div style="position:relative;width:100%;height:160px;border-radius:1.25rem;overflow:hidden;background:#f1f5f9;border:2.5px dashed #e2e8f0;cursor:pointer;" id="esm-cover-wrap" onclick="document.getElementById('esm-file-input').click()" title="Klik untuk ganti cover">
                    <img id="esm-cover-preview" src="${s.cover || DEFAULT_COVER}" style="width:100%;height:100%;object-fit:cover;transition:transform .3s;" onerror="this.src='${DEFAULT_COVER}'">
                    <div style="position:absolute;inset:0;background:rgba(0,0,0,0);display:flex;align-items:center;justify-content:center;transition:background .3s;" id="esm-cover-ov" onmouseover="this.style.background='rgba(0,0,0,.45)';document.getElementById('esm-ov-inner').style.opacity='1'" onmouseout="this.style.background='rgba(0,0,0,0)';document.getElementById('esm-ov-inner').style.opacity='0'">
                        <div id="esm-ov-inner" style="opacity:0;transition:opacity .3s;display:flex;flex-direction:column;align-items:center;gap:6px;">
                            <div style="width:48px;height:48px;background:rgba(255,255,255,.9);border-radius:50%;display:flex;align-items:center;justify-content:center;">
                                <i data-lucide="image-plus" style="width:22px;height:22px;color:#ffb347;"></i>
                            </div>
                            <span style="color:white;font-weight:700;font-size:11px;letter-spacing:.08em;">GANTI COVER</span>
                        </div>
                    </div>
                </div>
                <!-- Hidden file input for cover -->
                <input type="file" id="esm-file-input" accept="image/*" class="hidden" style="display:none;">
            </div>

            <!-- URL Input for Cover -->
            <div style="margin-bottom:1rem;">
                <label style="display:block;font-size:10px;font-weight:700;color:#94a3b8;letter-spacing:.12em;text-transform:uppercase;margin-bottom:6px;">Atau URL Gambar Cover</label>
                <div style="display:flex;gap:8px;">
                    <input id="esm-cover-url" type="text" placeholder="https://..." value="${s.cover || ''}" style="flex:1;padding:10px 14px;border-radius:12px;border:2px solid #e2e8f0;font-size:13px;outline:none;font-family:inherit;transition:border-color .2s;" onfocus="this.style.borderColor='#ffb347'" onblur="this.style.borderColor='#e2e8f0'">
                    <button onclick="applyEsmUrl()" style="padding:10px 16px;background:linear-gradient(135deg,#ffb347,#6495ed);color:white;border:none;border-radius:12px;font-weight:700;cursor:pointer;font-size:12px;white-space:nowrap;transition:opacity .2s;" onmouseover="this.style.opacity='.85'" onmouseout="this.style.opacity='1'">Terapkan</button>
                </div>
            </div>

            <!-- Title Input -->
            <div style="margin-bottom:1rem;">
                <label style="display:block;font-size:10px;font-weight:700;color:#94a3b8;letter-spacing:.12em;text-transform:uppercase;margin-bottom:6px;">Judul Lagu</label>
                <input id="esm-title" type="text" value="${s.title}" placeholder="Nama lagu…" style="width:100%;padding:12px 16px;border-radius:14px;border:2px solid #e2e8f0;font-size:14px;font-weight:700;color:#1e293b;outline:none;font-family:inherit;box-sizing:border-box;transition:border-color .2s;" onfocus="this.style.borderColor='#ffb347'" onblur="this.style.borderColor='#e2e8f0'">
            </div>

            <!-- Artist Input -->
            <div style="margin-bottom:1.5rem;">
                <label style="display:block;font-size:10px;font-weight:700;color:#94a3b8;letter-spacing:.12em;text-transform:uppercase;margin-bottom:6px;">Nama Penyanyi / Artis</label>
                <input id="esm-artist" type="text" value="${s.artist}" placeholder="Nama artis…" style="width:100%;padding:12px 16px;border-radius:14px;border:2px solid #e2e8f0;font-size:14px;font-weight:700;color:#1e293b;outline:none;font-family:inherit;box-sizing:border-box;transition:border-color .2s;" onfocus="this.style.borderColor='#6495ed'" onblur="this.style.borderColor='#e2e8f0'">
            </div>

            <!-- Save Button -->
            <button onclick="saveEditedSong()" style="width:100%;padding:15px;background:linear-gradient(135deg,#ffb347,#6495ed);color:white;border:none;border-radius:16px;font-weight:800;font-size:14px;cursor:pointer;letter-spacing:.06em;box-shadow:0 8px 24px rgba(255,179,71,.35);transition:all .2s;display:flex;align-items:center;justify-content:center;gap:8px;font-family:inherit;" onmouseover="this.style.transform='translateY(-2px)';this.style.boxShadow='0 12px 28px rgba(255,179,71,.5)'" onmouseout="this.style.transform='';this.style.boxShadow='0 8px 24px rgba(255,179,71,.35)'">
                <i data-lucide="save" style="width:18px;height:18px;"></i>
                SIMPAN &amp; SINKRONKAN
            </button>
        </div>`;

        // Close on backdrop click
        modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
        document.body.appendChild(modal);
        try { lucide.createIcons(); } catch(_){}
        setTimeout(() => document.getElementById('esm-title')?.focus(), 100);

        // ── Wire file input for cover image inside modal ──
        const fi = document.getElementById('esm-file-input');
        if (fi) {
            fi.addEventListener('change', e => {
                const file = e.target.files[0];
                if (!file) return;
                const reader = new FileReader();
                reader.onload = ev => {
                    const preview = document.getElementById('esm-cover-preview');
                    if (preview) preview.src = ev.target.result;
                    // Also store in URL input for applyEsmUrl consistency
                    const urlInput = document.getElementById('esm-cover-url');
                    if (urlInput) urlInput.value = '[file upload]'; // placeholder text
                    // Stash the data URL for saving later
                    if (fi) fi._dataUrl = ev.target.result;
                };
                reader.readAsDataURL(file);
            });
        }
    };

    // Apply URL typed in cover url field to preview
    window.applyEsmUrl = function() {
        const urlInput = document.getElementById('esm-cover-url');
        const preview  = document.getElementById('esm-cover-preview');
        if (!urlInput || !preview) return;
        const url = urlInput.value.trim();
        if (url && url !== '[file upload]') {
            preview.src = url;
            // Clear any file-upload dataUrl since we're using a URL now
            const fi = document.getElementById('esm-file-input');
            if (fi) fi._dataUrl = null;
        }
    };

    // Save & sync all changes from the edit modal
    window.saveEditedSong = function() {
        if (!playlist.length) return;
        const s      = playlist[songIndex];
        const title  = document.getElementById('esm-title')?.value?.trim();
        const artist = document.getElementById('esm-artist')?.value?.trim();
        const fi     = document.getElementById('esm-file-input');
        const urlInp = document.getElementById('esm-cover-url');
        const preview = document.getElementById('esm-cover-preview');

        // Determine new cover
        let newCover = s.cover; // default: keep old
        if (fi && fi._dataUrl) {
            // File was uploaded — use the DataURL
            newCover = fi._dataUrl;
        } else if (urlInp && urlInp.value.trim() && urlInp.value.trim() !== '[file upload]') {
            newCover = urlInp.value.trim();
        } else if (preview && preview.src && !preview.src.endsWith(DEFAULT_COVER)) {
            newCover = preview.src;
        }

        // Apply changes to playlist entry
        if (title)  s.title  = title;
        if (artist) s.artist = artist;
        if (newCover) s.cover = newCover;

        // ── Persist & sync everywhere ──
        savePlaylist();
        syncSongUI(s);           // updates #song-title, #song-artist, #album-cover, #mini-title, #mini-artist, #mini-cover
        renderPlaylist();        // re-render playlist with new cover thumbnails
        updateMiniPlayer();      // ensure mini player gets refreshed

        document.getElementById('editSongModal')?.remove();
        showToast('🎵 Info lagu disimpan & disinkronkan!');
    };

    window.deleteSong = async function(idx) {
        if (!confirm('Hapus lagu ini?')) return;
        const s = playlist[idx];
        if (s?.storageKey) await dbDel(s.storageKey);
        playlist.splice(idx, 1);
        savePlaylist();
        if (!playlist.length) { globalAudio?.pause(); isPlaying = false; }
        else {
            if (songIndex >= playlist.length) songIndex = 0;
            loadAndPlay(songIndex, false);
        }
        renderPlaylist(); updateMiniPlayer();
        showToast('🗑️ Lagu dihapus.');
    };

    // =====================================================================
    // § O — YOUTUBE PLAYER (re-initialized on every page load)
    // =====================================================================
    function extractYTId(url) {
        if (!url) return null;
        url = url.trim();
        if (/^[a-zA-Z0-9_-]{11}$/.test(url)) return url;
        const m = url.match(/(?:youtube\.com\/(?:[^/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/|youtube\.com\/shorts\/|music\.youtube\.com\/watch\?v=)([a-zA-Z0-9_-]{11})/i);
        return m ? m[1] : null;
    }

    // Called by reinit() after every page swap — ensures grid is always fresh
    window.initYouTubePlayer = function() {
        renderYTGrid();
    };

    window.renderYTGrid = function renderYTGrid() {
        const c = document.getElementById('youtube-grid');
        if (!c) return;
        const auth = sessionStorage.getItem('felicia_auth') === 'true';

        if (!ytVideos.length) {
            c.innerHTML = `<div class="col-span-full text-center py-10 text-slate-400"><p class="font-bold text-sm uppercase tracking-widest">Belum ada video</p><p class="text-xs mt-1">Klik tombol + untuk menambah</p></div>`;
            return;
        }
        c.innerHTML = ytVideos.map(v => `
        <div class="game-card overflow-hidden group relative cursor-pointer" onclick="openYTPlayer('${v.youtubeId}','${(v.title||'').replace(/'/g,"\\'")}')">
            <div class="relative overflow-hidden" style="aspect-ratio:16/9;">
                <img src="${v.thumbnail}" class="w-full h-full object-cover group-hover:scale-110 transition duration-700" onerror="this.style.display='none'" loading="lazy">
                <div class="absolute inset-0 bg-black/30 group-hover:bg-black/15 transition duration-300 flex items-center justify-center">
                    <div style="width:52px;height:52px;background:rgba(255,0,0,.9);border-radius:50%;display:flex;align-items:center;justify-content:center;box-shadow:0 8px 24px rgba(255,0,0,.4);" class="group-hover:scale-125 transition">
                        <svg style="width:20px;height:20px;fill:white;margin-left:4px" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
                    </div>
                </div>
            </div>
            <div class="p-4">
                <p class="font-bold text-sm text-slate-800 line-clamp-2 mb-1">${v.title||'Video'}</p>
                <p class="text-xs text-slate-500 font-semibold">${v.artist||'YouTube'}</p>
            </div>
            <button onclick="event.stopPropagation();deleteYTVideo(${v.id})" class="absolute top-2 right-2 w-8 h-8 bg-red-500 text-white rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition hover:bg-red-700 shadow-lg"><i data-lucide="trash-2" class="w-3.5 h-3.5"></i></button>
        </div>`).join('');
        try { lucide.createIcons(); } catch(_){}
    };

    // Open YouTube embed modal (responsive 16:9 iframe)
    window.openYTPlayer = function(ytId, title) {
        document.getElementById('ytPlayerModal')?.remove();
        // Pause MP3 so audio doesn't overlap
        if (globalAudio && !globalAudio.paused) { globalAudio.pause(); }

        const modal = document.createElement('div');
        modal.id = 'ytPlayerModal';
        modal.className = 'fixed inset-0 z-[9996] flex items-center justify-center p-4 bg-slate-900/85 backdrop-blur-md';
        modal.innerHTML = `
        <div class="w-full max-w-3xl bg-slate-900 rounded-[2rem] p-4 md:p-6 border-2 border-red-500/40 shadow-2xl">
            <div class="flex justify-between items-center mb-4 gap-3">
                <div class="flex items-center gap-3 overflow-hidden min-w-0">
                    <div class="w-10 h-10 rounded-xl bg-red-600 flex items-center justify-center text-white flex-shrink-0">
                        <svg style="width:18px;height:18px;fill:white" viewBox="0 0 24 24"><path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/></svg>
                    </div>
                    <h4 class="text-white font-bold text-sm md:text-base truncate">${title||'Video'}</h4>
                </div>
                <div class="flex gap-2 flex-shrink-0">
                    <a href="https://www.youtube.com/watch?v=${ytId}" target="_blank" rel="noopener" class="px-3 py-2 bg-red-600 hover:bg-red-700 text-white rounded-xl text-xs font-bold transition flex items-center gap-1">Buka YouTube <i data-lucide="external-link" class="w-3 h-3"></i></a>
                    <button onclick="document.getElementById('ytPlayerModal').remove()" class="w-9 h-9 bg-white/10 hover:bg-red-500 text-white rounded-full flex items-center justify-center transition"><i data-lucide="x" class="w-4 h-4"></i></button>
                </div>
            </div>
            <!-- Responsive 16:9 iframe container -->
            <div style="position:relative;width:100%;padding-bottom:56.25%;height:0;overflow:hidden;border-radius:1rem;background:#000;">
                <iframe
                    src="https://www.youtube-nocookie.com/embed/${ytId}?autoplay=1&rel=0&modestbranding=1"
                    title="${title||'YouTube Video'}"
                    frameborder="0"
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                    allowfullscreen
                    referrerpolicy="strict-origin-when-cross-origin"
                    style="position:absolute;top:0;left:0;width:100%;height:100%;border:none;">
                </iframe>
            </div>
        </div>`;
        modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
        document.body.appendChild(modal);
        try { lucide.createIcons(); } catch(_){}
    };

    window.openAddYouTubeModal = function() {
        document.getElementById('ytModal')?.remove();
        const modal = document.createElement('div');
        modal.id = 'ytModal';
        modal.className = 'fixed inset-0 z-[9995] flex items-center justify-center p-4 bg-slate-900/70 backdrop-blur-sm';
        modal.innerHTML = `
        <div class="bg-white rounded-[2rem] p-8 w-full max-w-md shadow-2xl border-4 border-[#6495ed]">
            <div class="flex justify-between items-center mb-6">
                <h3 class="font-bold text-xl font-display uppercase tracking-widest text-[#6495ed] flex items-center gap-2">
                    <svg style="width:22px;height:22px;fill:#6495ed" viewBox="0 0 24 24"><path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/></svg>
                    Tambah Video YouTube
                </h3>
                <button onclick="document.getElementById('ytModal').remove()" class="p-2 bg-slate-100 rounded-xl hover:bg-red-50 hover:text-red-500 transition"><i data-lucide="x" class="w-4 h-4"></i></button>
            </div>
            <div class="space-y-4">
                <div>
                    <label class="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5 ml-1">URL / Link YouTube</label>
                    <input id="yt-url-input" type="text" placeholder="https://www.youtube.com/watch?v=..." class="w-full px-4 py-3 rounded-xl border-2 border-slate-200 focus:border-[#6495ed] focus:outline-none text-sm" oninput="previewYT(this.value)">
                </div>
                <div id="yt-preview" class="hidden rounded-2xl overflow-hidden border-2 border-slate-100 bg-slate-100 relative shadow-inner" style="aspect-ratio:16/9;">
                    <img id="yt-thumb" src="" class="w-full h-full object-cover">
                    <div class="absolute inset-0 flex items-center justify-center">
                        <div style="width:48px;height:48px;background:rgba(255,0,0,.85);border-radius:50%;display:flex;align-items:center;justify-content:center;">
                            <svg style="width:20px;height:20px;fill:white;margin-left:3px" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
                        </div>
                    </div>
                </div>
                <div>
                    <label class="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5 ml-1">Judul (Opsional)</label>
                    <input id="yt-title-input" type="text" placeholder="Judul video…" class="w-full px-4 py-3 rounded-xl border-2 border-slate-200 focus:border-[#6495ed] focus:outline-none text-sm font-bold text-slate-800">
                </div>
                <div>
                    <label class="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5 ml-1">Channel (Opsional)</label>
                    <input id="yt-artist-input" type="text" placeholder="Nama channel…" class="w-full px-4 py-3 rounded-xl border-2 border-slate-200 focus:border-[#6495ed] focus:outline-none text-sm font-bold text-slate-800">
                </div>
                <button onclick="saveYTVideo()" class="w-full py-4 bg-gradient-to-r from-[#6495ed] to-[#ffb347] text-white font-bold font-display uppercase tracking-widest rounded-2xl hover:opacity-90 transition shadow-lg flex items-center justify-center gap-2">
                    <i data-lucide="plus" class="w-5 h-5"></i> Tambah Video
                </button>
            </div>
        </div>`;
        document.body.appendChild(modal);
        try { lucide.createIcons(); } catch(_){}
        setTimeout(() => document.getElementById('yt-url-input')?.focus(), 80);
    };

    window.previewYT = function(url) {
        const id = extractYTId(url);
        const p  = document.getElementById('yt-preview');
        const th = document.getElementById('yt-thumb');
        if (!id || !p) { if(p) p.classList.add('hidden'); return; }
        if (th) th.src = `https://img.youtube.com/vi/${id}/hqdefault.jpg`;
        p.classList.remove('hidden');
    };

    window.saveYTVideo = function() {
        const url   = document.getElementById('yt-url-input')?.value?.trim();
        let title   = document.getElementById('yt-title-input')?.value?.trim();
        let artist  = document.getElementById('yt-artist-input')?.value?.trim();
        const id    = extractYTId(url);

        if (!id) { showToast('❌ Link YouTube tidak valid!', 'error'); return; }
        title  = title  || `Video #${ytVideos.length + 1}`;
        artist = artist || 'YouTube';

        ytVideos.push({ id: Date.now(), youtubeId: id, title, artist, thumbnail: `https://img.youtube.com/vi/${id}/hqdefault.jpg` });
        try { localStorage.setItem('felicia_youtube', JSON.stringify(ytVideos)); } catch(_){}
        document.getElementById('ytModal')?.remove();
        renderYTGrid();
        showToast('▶️ Video berhasil ditambahkan!');
    };

    window.deleteYTVideo = function(id) {
        if (!confirm('Hapus video ini?')) return;
        ytVideos = ytVideos.filter(v => v.id !== id);
        try { localStorage.setItem('felicia_youtube', JSON.stringify(ytVideos)); } catch(_){}
        renderYTGrid();
        showToast('🗑️ Video dihapus.');
    };

    // =====================================================================
    // § P — PHOTO FRAMES
    // =====================================================================
    function initPhotoFrames() {
        loadGallery();
        document.querySelectorAll('.photo-frame:not([data-pf])').forEach(frame => {
            frame.dataset.pf = '1';
            frame.style.cursor = 'pointer';

            const ov = document.createElement('div');
            ov.style.cssText = 'position:absolute;inset:0;border-radius:inherit;display:flex;align-items:center;justify-content:center;background:transparent;pointer-events:none;transition:background .3s;';
            ov.innerHTML = `<div style="opacity:0;transition:opacity .3s;display:flex;flex-direction:column;align-items:center;gap:6px;"><div style="width:44px;height:44px;background:rgba(255,255,255,.9);border-radius:50%;display:flex;align-items:center;justify-content:center;box-shadow:0 4px 16px rgba(0,0,0,.2);"><i data-lucide="camera" style="width:20px;height:20px;color:#ffb347;"></i></div><span style="color:white;font-weight:700;font-size:11px;text-transform:uppercase;letter-spacing:.1em;text-shadow:0 1px 3px rgba(0,0,0,.5);">Ganti Foto</span></div>`;
            frame.appendChild(ov);

            const fi = document.createElement('input');
            fi.type = 'file'; fi.accept = 'image/*'; fi.style.display = 'none';
            frame.appendChild(fi);

            frame.addEventListener('mouseenter', () => { ov.style.background='rgba(0,0,0,.38)'; ov.firstElementChild.style.opacity='1'; });
            frame.addEventListener('mouseleave', () => { ov.style.background='transparent';     ov.firstElementChild.style.opacity='0'; });
            frame.addEventListener('click', () => openPhotoModal(frame, fi));
            fi.addEventListener('change', e => {
                const file = e.target.files[0]; if (!file) return;
                const reader = new FileReader();
                reader.onload = ev => { const img = frame.querySelector('img'); if(img){img.src=ev.target.result;} saveGallery(frame.dataset.galleryId, ev.target.result); };
                reader.readAsDataURL(file);
            });
            try { lucide.createIcons(); } catch(_){}
        });
    }

    function openPhotoModal(frame, fi) {
        document.getElementById('photoChoiceModal')?.remove();
        const modal = document.createElement('div');
        modal.id = 'photoChoiceModal';
        modal.className = 'fixed inset-0 z-[999] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm';
        modal.innerHTML = `
        <div class="bg-white rounded-[2rem] p-8 w-full max-w-sm shadow-2xl border-4 border-[#ffb347]">
            <div class="flex justify-between items-center mb-5">
                <h3 class="font-bold text-lg font-display uppercase tracking-widest text-[#ffb347]">Ganti Foto</h3>
                <button onclick="document.getElementById('photoChoiceModal').remove()" class="p-2 bg-slate-100 rounded-xl hover:bg-red-50 hover:text-red-500 transition"><i data-lucide="x" class="w-4 h-4"></i></button>
            </div>
            <div class="space-y-3">
                <button id="pcmUpload" class="w-full py-4 flex items-center gap-4 px-5 bg-orange-50 hover:bg-[#ffb347] hover:text-white text-[#ffb347] font-bold rounded-2xl transition border-2 border-[#ffb347]/30 hover:border-[#ffb347]"><i data-lucide="upload" class="w-5 h-5"></i> Upload dari Perangkat</button>
                <button id="pcmUrl"    class="w-full py-4 flex items-center gap-4 px-5 bg-blue-50  hover:bg-[#6495ed] hover:text-white text-[#6495ed] font-bold rounded-2xl transition border-2 border-[#6495ed]/30 hover:border-[#6495ed]"><i data-lucide="link"   class="w-5 h-5"></i> Masukkan URL Foto</button>
                <div id="pcmUrlArea" class="hidden">
                    <input id="pcmUrlInput" type="text" placeholder="https://..." class="w-full px-4 py-3 rounded-xl border-2 border-slate-200 focus:border-[#ffb347] focus:outline-none text-sm mt-2">
                    <button id="pcmApply" class="w-full mt-2 py-3 bg-gradient-to-r from-[#ffb347] to-[#6495ed] text-white font-bold rounded-xl hover:opacity-90">Terapkan</button>
                </div>
            </div>
        </div>`;
        document.body.appendChild(modal);
        try { lucide.createIcons(); } catch(_){}
        document.getElementById('pcmUpload').onclick = () => { modal.remove(); fi.click(); };
        document.getElementById('pcmUrl').onclick    = () => document.getElementById('pcmUrlArea').classList.toggle('hidden');
        document.getElementById('pcmApply').onclick  = () => {
            const url = document.getElementById('pcmUrlInput').value.trim();
            if (url) { const img=frame.querySelector('img'); if(img)img.src=url; saveGallery(frame.dataset.galleryId,url); modal.remove(); }
        };
    }

    function saveGallery(id, data) {
        if (!id) return;
        try { const g=JSON.parse(localStorage.getItem('felicia_gallery')||'{}'); g[id]=data; localStorage.setItem('felicia_gallery',JSON.stringify(g)); } catch(_){}
    }
    function loadGallery() {
        // Disabled: gallery images locked to download (8).png, download (9).png, download (10).png in HTML
    }

    // =====================================================================
    // § Q — ARTICLE EDITOR
    // =====================================================================
    function initArticleEditor() {
        try {
            const saved = JSON.parse(localStorage.getItem('felicia_articles')||'{}');
            document.querySelectorAll('.editable-article').forEach(a => { if(saved[a.dataset.articleId])a.innerHTML=saved[a.dataset.articleId]; });
        } catch(_){}
        document.querySelectorAll('.btn-edit-article').forEach(btn => {
            btn.addEventListener('click', () => openArticleModal(btn.dataset.targetArticle));
        });
    }

    function openArticleModal(id) {
        const article = document.querySelector(`.editable-article[data-article-id="${id}"]`);
        if (!article) return;
        document.getElementById('articleEditorModal')?.remove();
        const modal = document.createElement('div');
        modal.id = 'articleEditorModal';
        modal.className = 'fixed inset-0 z-[998] flex items-center justify-center p-4 bg-slate-900/70 backdrop-blur-sm';
        modal.innerHTML = `
        <div class="bg-white rounded-[2rem] p-8 w-full max-w-3xl shadow-2xl border-4 border-[#ffb347] flex flex-col gap-5 max-h-[90vh]">
            <div class="flex justify-between items-center">
                <h3 class="font-bold text-xl font-display uppercase tracking-widest text-[#ffb347]">✏️ Edit Artikel</h3>
                <button onclick="document.getElementById('articleEditorModal').remove()" class="p-2 bg-slate-100 rounded-xl hover:bg-red-50 hover:text-red-500 transition"><i data-lucide="x" class="w-5 h-5"></i></button>
            </div>
            <textarea id="articleTA" class="w-full p-5 rounded-2xl border-2 border-slate-200 focus:border-[#ffb347] focus:outline-none text-sm font-mono resize-none overflow-y-auto" rows="14" style="min-height:260px">${article.innerHTML.trim()}</textarea>
            <div class="flex gap-3">
                <button onclick="saveArticle('${id}')" class="flex-1 py-4 bg-gradient-to-r from-[#ffb347] to-[#6495ed] text-white font-bold uppercase rounded-2xl hover:opacity-90 flex items-center justify-center gap-2"><i data-lucide="save" class="w-5 h-5"></i> Simpan</button>
                <button onclick="resetArticle('${id}')" class="px-6 py-4 bg-slate-100 text-slate-600 font-bold rounded-2xl hover:bg-red-50 hover:text-red-500 transition">Reset</button>
            </div>
        </div>`;
        document.body.appendChild(modal); try { lucide.createIcons(); } catch(_){}
    }
    window.saveArticle = function(id) {
        const ta = document.getElementById('articleTA'); if(!ta) return;
        const a  = document.querySelector(`.editable-article[data-article-id="${id}"]`);
        if (a) a.innerHTML = ta.value;
        try { const s=JSON.parse(localStorage.getItem('felicia_articles')||'{}'); s[id]=ta.value; localStorage.setItem('felicia_articles',JSON.stringify(s)); } catch(_){}
        document.getElementById('articleEditorModal')?.remove();
        showToast('✅ Artikel disimpan!');
    };
    window.resetArticle = function(id) {
        if (!confirm('Reset ke teks awal?')) return;
        try { const s=JSON.parse(localStorage.getItem('felicia_articles')||'{}'); delete s[id]; localStorage.setItem('felicia_articles',JSON.stringify(s)); } catch(_){}
        document.getElementById('articleEditorModal')?.remove();
        location.reload();
    };

    // =====================================================================
    // § R — PROFILE
    // =====================================================================
    function loadProfileData() {
        try {
            const d = JSON.parse(localStorage.getItem('felicia_profile')||'null');
            if (!d || typeof d !== 'object') return;

            if (d.name && d.name !== 'undefined' && String(d.name).trim() !== '') {
                const el = document.getElementById('profile-name');
                if (el) el.innerText = d.name;
            }
            if (d.email && d.email !== 'undefined' && String(d.email).trim() !== '') {
                const el = document.getElementById('profile-email');
                if (el) el.innerText = d.email;
            }
            if (d.wa && d.wa !== 'undefined' && String(d.wa).trim() !== '') {
                const el = document.getElementById('profile-wa');
                if (el) el.innerText = d.wa;
            }
            if (d.ig && d.ig !== 'undefined' && String(d.ig).trim() !== '') {
                const el = document.getElementById('profile-ig');
                if (el) el.innerText = d.ig;
            }
            // Foto profil utama dikunci permanen di HTML ke profile (3).jpg
        } catch(_){}
    }

    function saveInlineProfileName(el) {
        if (!el) return;
        let text = el.innerText.trim();
        if (!text || text === 'undefined') {
            text = 'Felicia Frances';
            el.innerText = text;
        }
        try {
            let d = JSON.parse(localStorage.getItem('felicia_profile') || '{}');
            if (!d || typeof d !== 'object') d = {};
            d.name = text;
            localStorage.setItem('felicia_profile', JSON.stringify(d));
            showToast('✅ Nama profil disimpan!');
        } catch(_){}
    }
    function saveProfileForm() {
        const g = id => document.getElementById(id)?.value||'';
        const data = { name:g('input-name'), email:g('input-email'), wa:g('input-wa'), ig:g('input-ig'), photo:g('input-photo') };
        try { localStorage.setItem('felicia_profile', JSON.stringify(data)); } catch(_){}
        document.getElementById('editProfileModal')?.classList.add('hidden');
        loadProfileData();
        showToast('✅ Profil diperbarui!');
    }
    function handleProfilePhoto(file) {
        if (!file) return;
        const reader = new FileReader();
        reader.onload = ev => {
            const img = document.getElementById('profile-img');
            if (img) img.src = ev.target.result;
            try { const d=JSON.parse(localStorage.getItem('felicia_profile')||'{}'); d.photo=ev.target.result; localStorage.setItem('felicia_profile',JSON.stringify(d)); } catch(_){}
            showToast('📸 Foto profil diperbarui!');
        };
        reader.readAsDataURL(file);
    }

    // =====================================================================
    // § S — TASKS
    // =====================================================================
    const DEFAULT_TASKS = {
        informatika: [
            { id:1, title:'Sejarah Komputer',     desc:'Membuat presentasi tentang perkembangan generasi komputer.', status:'clear'    },
            { id:2, title:'Algoritma & Flowchart', desc:'Membuat flowchart untuk studi kasus masalah sehari-hari.',   status:'progress' }
        ],
        bindo: [
            { id:1, title:'Teks LHO',       desc:'Laporan Hasil Observasi mengenai flora dan fauna di lingkungan sekolah.', status:'clear' },
            { id:2, title:'Antologi Puisi', desc:'Kumpulan karya puisi bertema keindahan alam dan budi pekerti.',           status:'clear' }
        ]
    };

    function initTasks() {
        if (!localStorage.getItem('felicia_tasks')) {
            try { localStorage.setItem('felicia_tasks', JSON.stringify(DEFAULT_TASKS)); } catch(_){}
        }
        renderTasks('informatika');
        renderTasks('bindo');
    }

    window.renderTasks = function(subj) {
        const c = document.getElementById(`${subj}-tasks`); if(!c) return;
        const addBtn = c.querySelector('.add-task-btn');
        const tasks  = (JSON.parse(localStorage.getItem('felicia_tasks')||'{}'))[subj] || [];
        const auth   = sessionStorage.getItem('felicia_auth') === 'true';
        c.innerHTML  = '';
        tasks.forEach(task => {
            const cfg = task.status==='clear'    ? {badge:'bg-[#6495ed]/20 text-[#6495ed]', txt:'Clear',    iconBg:'#6495ed', icon:'check-circle-2', bdr:'hover:border-[#6495ed]'}
                      : task.status==='progress' ? {badge:'bg-[#ffb347]/20 text-[#ffb347]', txt:'Progress', iconBg:'#ffb347', icon:'clock',           bdr:'hover:border-[#ffb347]'}
                                                 : {badge:'bg-slate-200 text-slate-600',     txt:'Locked',   iconBg:'#94a3b8', icon:'lock',            bdr:''};
            c.insertAdjacentHTML('beforeend', `
            <div class="bg-white p-5 rounded-2xl border-2 border-slate-100 ${cfg.bdr} hover:shadow-lg transition flex gap-4">
                <div class="w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0 text-white" style="background:${cfg.iconBg}"><i data-lucide="${cfg.icon}" class="w-6 h-6"></i></div>
                <div class="flex-1 min-w-0">
                    <div class="flex justify-between items-start mb-1"><h4 class="font-bold text-base text-[#ffb347]">${task.title}</h4><span class="text-[10px] font-bold ${cfg.badge} px-2 py-1 rounded-md uppercase tracking-widest">${cfg.txt}</span></div>
                    <p class="text-xs text-slate-500">${task.desc}</p>
                    ${auth?`<div class="flex gap-2 justify-end mt-2 pt-2 border-t border-slate-100"><button onclick="openTaskModal('${subj}',${task.id})" class="p-1.5 bg-[#6495ed]/10 text-[#6495ed] hover:bg-[#6495ed] hover:text-white rounded-lg transition"><i data-lucide="edit-3" class="w-4 h-4"></i></button><button onclick="deleteTask('${subj}',${task.id})" class="p-1.5 bg-red-100 text-red-500 hover:bg-red-500 hover:text-white rounded-lg transition"><i data-lucide="trash-2" class="w-4 h-4"></i></button></div>`:''}
                </div>
            </div>`);
        });
        if (addBtn) { auth?addBtn.classList.remove('hidden'):addBtn.classList.add('hidden'); c.appendChild(addBtn); }
        try { lucide.createIcons(); } catch(_){}
    };

    function initTaskModal() {
        if (document.getElementById('taskModal')) return;
        document.body.insertAdjacentHTML('beforeend', `
        <div id="taskModal" class="hidden fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div class="bg-white p-8 w-full max-w-md border-4 border-[#ffb347] rounded-[2rem] shadow-2xl">
                <div class="flex justify-between items-center mb-6">
                    <h3 id="taskModalTitle" class="font-bold text-xl font-display uppercase tracking-widest text-[#ffb347]">Tambah Misi</h3>
                    <button onclick="closeTaskModal()" class="text-slate-400 bg-slate-100 p-2 rounded-xl hover:bg-red-50 hover:text-red-500 transition"><i data-lucide="x" class="w-5 h-5"></i></button>
                </div>
                <form id="taskForm" class="space-y-4">
                    <input type="hidden" id="taskId"><input type="hidden" id="taskSubject">
                    <div><label class="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5 ml-1">Judul</label><input id="taskTitle" type="text" required class="w-full px-5 py-3 rounded-xl bg-slate-50 border-2 border-slate-100 focus:border-[#ffb347] focus:outline-none font-bold text-slate-800"></div>
                    <div><label class="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5 ml-1">Deskripsi</label><textarea id="taskDesc" rows="3" class="w-full px-5 py-3 rounded-xl bg-slate-50 border-2 border-slate-100 focus:border-[#ffb347] focus:outline-none text-sm text-slate-800"></textarea></div>
                    <div><label class="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5 ml-1">Status</label><select id="taskStatus" class="w-full px-5 py-3 rounded-xl bg-slate-50 border-2 border-slate-100 focus:border-[#ffb347] focus:outline-none font-bold text-slate-800"><option value="progress">In Progress</option><option value="clear">Clear</option><option value="locked">Locked</option></select></div>
                    <button type="submit" class="w-full py-4 bg-gradient-to-r from-[#ffb347] to-[#6495ed] text-white font-bold uppercase rounded-xl hover:opacity-90 shadow-lg mt-4">Simpan</button>
                </form>
            </div>
        </div>`);
        document.getElementById('taskForm').addEventListener('submit', e => { e.preventDefault(); saveTask(); });
        try { lucide.createIcons(); } catch(_){}
    }
    window.openTaskModal = function(subj, id=null) {
        document.getElementById('taskSubject').value = subj;
        document.getElementById('taskId').value = id||'';
        if (id) {
            document.getElementById('taskModalTitle').innerText = 'Edit Misi';
            const t = (JSON.parse(localStorage.getItem('felicia_tasks')||'{}'))[subj]?.find(x=>x.id===id);
            if (t) { document.getElementById('taskTitle').value=t.title; document.getElementById('taskDesc').value=t.desc; document.getElementById('taskStatus').value=t.status; }
        } else {
            document.getElementById('taskModalTitle').innerText='Tambah Misi';
            document.getElementById('taskTitle').value=''; document.getElementById('taskDesc').value=''; document.getElementById('taskStatus').value='progress';
        }
        document.getElementById('taskModal').classList.remove('hidden');
    };
    window.closeTaskModal = ()=>document.getElementById('taskModal')?.classList.add('hidden');
    window.saveTask = function() {
        const subj=document.getElementById('taskSubject').value, id=document.getElementById('taskId').value,
              title=document.getElementById('taskTitle').value, desc=document.getElementById('taskDesc').value, status=document.getElementById('taskStatus').value;
        let td=JSON.parse(localStorage.getItem('felicia_tasks')||'{}');
        if (!td[subj]) td[subj]=[];
        if (id){ const i=td[subj].findIndex(t=>t.id===parseInt(id)); if(i!==-1)td[subj][i]={id:parseInt(id),title,desc,status}; }
        else { const nid=td[subj].length?Math.max(...td[subj].map(t=>t.id))+1:1; td[subj].push({id:nid,title,desc,status}); }
        try { localStorage.setItem('felicia_tasks',JSON.stringify(td)); } catch(_){}
        closeTaskModal(); renderTasks(subj); showToast('✅ Misi disimpan!');
    };
    window.deleteTask = function(subj, id) {
        if (!confirm('Hapus misi ini?')) return;
        let td=JSON.parse(localStorage.getItem('felicia_tasks')||'{}');
        td[subj]=(td[subj]||[]).filter(t=>t.id!==parseInt(id));
        try { localStorage.setItem('felicia_tasks',JSON.stringify(td)); } catch(_){}
        renderTasks(subj); showToast('🗑️ Misi dihapus.');
    };

    // =====================================================================
    // § T — TOAST
    // =====================================================================
    function showToast(msg, type='success') {
        document.getElementById('felicia-toast')?.remove();
        const t = document.createElement('div');
        t.id = 'felicia-toast';
        Object.assign(t.style, {
            position:'fixed', bottom:'105px', left:'50%', transform:'translateX(-50%)',
            zIndex:'9999', padding:'14px 24px', borderRadius:'16px',
            boxShadow:'0 10px 40px rgba(0,0,0,.15)', fontWeight:'700', color:'white',
            fontSize:'13px', letterSpacing:'.02em', whiteSpace:'nowrap',
            background: type==='success' ? 'linear-gradient(135deg,#ffb347,#6495ed)' : '#ef4444',
            fontFamily:"'Outfit',sans-serif"
        });
        t.innerText = msg;
        document.body.appendChild(t);
        setTimeout(()=>t.remove(), 3000);
    }

    // =====================================================================
    // § U — AUTH
    // =====================================================================
    window.checkPassword = function() {
        if (sessionStorage.getItem('felicia_auth')==='true') { showToast('🔓 Admin Mode aktif!'); return; }
        showLoginModal();
    };
    function showLoginModal() {
        document.getElementById('loginModal')?.remove();
        document.body.insertAdjacentHTML('beforeend', `
        <div id="loginModal" class="fixed inset-0 bg-slate-900/70 backdrop-blur-sm z-[9998] flex items-center justify-center p-4">
            <div class="bg-white rounded-[2rem] p-8 w-full max-w-sm shadow-2xl border-4 border-[#ffb347]">
                <div class="text-center mb-6">
                    <div class="w-16 h-16 bg-gradient-to-br from-[#ffb347] to-[#6495ed] rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-xl"><i data-lucide="shield" class="w-8 h-8 text-white"></i></div>
                    <h3 class="font-bold text-2xl font-display uppercase tracking-widest text-slate-800">Admin Mode</h3>
                    <p class="text-slate-400 text-sm mt-1">Masukkan Security Key</p>
                </div>
                <div class="space-y-4">
                    <input id="loginInput" type="password" placeholder="••••••••••••" class="w-full px-5 py-4 rounded-2xl border-2 border-slate-200 focus:border-[#ffb347] focus:outline-none font-bold text-center text-slate-800 tracking-widest text-lg" onkeydown="if(event.key==='Enter')submitLogin()">
                    <button onclick="submitLogin()" class="w-full py-4 bg-gradient-to-r from-[#ffb347] to-[#6495ed] text-white font-bold uppercase tracking-widest rounded-2xl hover:opacity-90 shadow-lg">🔑 Masuk</button>
                    <button onclick="document.getElementById('loginModal').remove()" class="w-full py-3 text-slate-400 hover:text-slate-700 font-bold text-sm">Batal</button>
                </div>
            </div>
        </div>`);
        try { lucide.createIcons(); } catch(_){}
        setTimeout(()=>document.getElementById('loginInput')?.focus(), 80);
    }
    window.submitLogin = function() {
        const inp = document.getElementById('loginInput'); if(!inp) return;
        if (inp.value === 'feliciafrances') {
            sessionStorage.setItem('felicia_auth','true');
            document.getElementById('loginModal')?.remove();
            showAuthUI(); showToast('🔓 Admin Mode aktif!');
            renderPlaylist?.(); renderYTGrid?.();
            renderTasks?.('informatika'); renderTasks?.('bindo');
        } else {
            inp.classList.add('border-red-400'); inp.value=''; inp.placeholder='❌ Key Salah!';
            setTimeout(()=>{ inp.classList.remove('border-red-400'); inp.placeholder='••••••••••••'; }, 2000);
        }
    };
    function showAuthUI() {
        document.querySelectorAll('.auth-only').forEach(e=>e.classList.remove('hidden'));
        document.querySelectorAll('.btn-edit-article').forEach(e=>e.classList.remove('hidden'));
    }

    // =====================================================================
    // § W — ARCADE MINI GAMES (2048, Flappy Bird, Ular Tangga vs AI)
    // =====================================================================
    window.openGameModal = function(type) {
        document.getElementById('gameActiveModal')?.remove();
        const modal = document.createElement('div');
        modal.id = 'gameActiveModal';
        modal.className = 'fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-slate-900/85 backdrop-blur-md overflow-y-auto';

        if (type === '2048') {
            modal.innerHTML = `
            <div class="bg-slate-900 border-2 border-amber-500/40 text-white p-6 rounded-[2.5rem] w-full max-w-md shadow-2xl relative flex flex-col items-center">
                <div class="w-full flex justify-between items-center mb-4">
                    <div class="flex items-center gap-2">
                        <span class="text-2xl">🎲</span>
                        <h3 class="text-xl font-bold font-display text-amber-400">Game 2048</h3>
                    </div>
                    <button onclick="document.getElementById('gameActiveModal').remove()" class="p-2 bg-slate-800 rounded-xl hover:bg-red-500 hover:text-white transition"><i data-lucide="x" class="w-5 h-5"></i></button>
                </div>
                <div class="flex justify-between w-full mb-4 px-2">
                    <div class="bg-slate-800 px-4 py-2 rounded-xl text-center"><span class="text-[10px] text-slate-400 block uppercase">Skor</span><span id="g2048-score" class="font-bold text-lg text-amber-400">0</span></div>
                    <button onclick="init2048Game()" class="px-4 py-2 bg-amber-500 text-slate-950 font-bold rounded-xl text-xs uppercase hover:bg-amber-400 transition">Reset</button>
                </div>
                <div id="g2048-board" class="grid grid-cols-4 gap-3 bg-slate-950 p-4 rounded-2xl w-full aspect-square border border-slate-800"></div>
                <p class="text-[11px] text-slate-400 mt-4 text-center">Gunakan tombol di bawah atau Tombol Panah Keyboard!</p>
                <div class="grid grid-cols-3 gap-2 mt-3 w-48 text-center">
                    <div></div><button onclick="move2048('up')" class="py-2 bg-slate-800 hover:bg-slate-700 rounded-xl font-bold">▲</button><div></div>
                    <button onclick="move2048('left')" class="py-2 bg-slate-800 hover:bg-slate-700 rounded-xl font-bold">◄</button>
                    <button onclick="move2048('down')" class="py-2 bg-slate-800 hover:bg-slate-700 rounded-xl font-bold">▼</button>
                    <button onclick="move2048('right')" class="py-2 bg-slate-800 hover:bg-slate-700 rounded-xl font-bold">►</button>
                </div>
            </div>`;
            document.body.appendChild(modal); try { lucide.createIcons(); } catch(_){}
            init2048Game();
        } 
        else if (type === 'flappy') {
            modal.innerHTML = `
            <div class="bg-slate-900 border-2 border-cyan-500/40 text-white p-6 rounded-[2.5rem] w-full max-w-md shadow-2xl relative flex flex-col items-center">
                <div class="w-full flex justify-between items-center mb-4">
                    <div class="flex items-center gap-2">
                        <span class="text-2xl">🐤</span>
                        <h3 class="text-xl font-bold font-display text-cyan-400">Flappy Bird</h3>
                    </div>
                    <button onclick="stopFlappy();document.getElementById('gameActiveModal').remove()" class="p-2 bg-slate-800 rounded-xl hover:bg-red-500 hover:text-white transition"><i data-lucide="x" class="w-5 h-5"></i></button>
                </div>
                <canvas id="flappyCanvas" width="320" height="420" class="bg-slate-950 rounded-2xl border border-cyan-500/30 cursor-pointer shadow-inner"></canvas>
                <p class="text-[11px] text-slate-400 mt-3">Klik Canvas / Tekan SPASI untuk Terbang!</p>
            </div>`;
            document.body.appendChild(modal); try { lucide.createIcons(); } catch(_){}
            startFlappyGame();
        } 
        else if (type === 'snakes') {
            modal.innerHTML = `
            <div class="bg-slate-900 border-2 border-emerald-500/40 text-white p-6 rounded-[2.5rem] w-full max-w-lg shadow-2xl relative flex flex-col items-center">
                <div class="w-full flex justify-between items-center mb-3">
                    <div class="flex items-center gap-2">
                        <span class="text-2xl">🐍</span>
                        <h3 class="text-xl font-bold font-display text-emerald-400">Ular Tangga vs AI</h3>
                    </div>
                    <button onclick="document.getElementById('gameActiveModal').remove()" class="p-2 bg-slate-800 rounded-xl hover:bg-red-500 hover:text-white transition"><i data-lucide="x" class="w-5 h-5"></i></button>
                </div>
                <div class="flex justify-between items-center w-full mb-3 px-2 text-xs">
                    <div class="flex gap-4">
                        <span class="flex items-center gap-1 font-bold text-cyan-400"><span class="w-3 h-3 rounded-full bg-cyan-400 inline-block"></span> Kamu: Petak <b id="pPos">1</b></span>
                        <span class="flex items-center gap-1 font-bold text-rose-400"><span class="w-3 h-3 rounded-full bg-rose-500 inline-block"></span> AI Bot: Petak <b id="bPos">1</b></span>
                    </div>
                    <span id="snakesStatus" class="font-bold text-amber-400">Giliran Kamu!</span>
                </div>
                <div id="snakesBoard" class="grid grid-cols-10 gap-1 bg-slate-950 p-2 rounded-2xl w-full aspect-square border border-emerald-500/30 text-[10px]"></div>
                <div class="flex items-center gap-4 mt-4 w-full">
                    <button id="rollDiceBtn" onclick="playSnakesTurn()" class="flex-1 py-3 bg-gradient-to-r from-emerald-500 to-teal-500 text-slate-950 font-bold rounded-xl text-xs uppercase tracking-widest hover:opacity-90 transition">🎲 Lempar Dadu</button>
                    <div id="diceResult" class="w-12 h-12 bg-slate-800 rounded-xl flex items-center justify-center font-bold text-xl text-amber-400 border border-slate-700">-</div>
                </div>
            </div>`;
            document.body.appendChild(modal); try { lucide.createIcons(); } catch(_){}
            initSnakesGame();
        }
    };

    // ── 2048 Game Engine ──
    let grid2048 = [], score2048 = 0;
    window.init2048Game = function() {
        grid2048 = Array(16).fill(0); score2048 = 0;
        add2048Tile(); add2048Tile();
        render2048();
    };
    function add2048Tile() {
        const empties = grid2048.reduce((a,v,i)=>v===0?[...a,i]:a, []);
        if (!empties.length) return;
        const idx = empties[Math.floor(Math.random()*empties.length)];
        grid2048[idx] = Math.random() < 0.9 ? 2 : 4;
    }
    function render2048() {
        const board = document.getElementById('g2048-board');
        const scoreEl = document.getElementById('g2048-score');
        if (scoreEl) scoreEl.innerText = score2048;
        if (!board) return;
        board.innerHTML = grid2048.map(v => {
            let bg = 'bg-slate-900 text-slate-700', txt = v || '';
            if (v===2) bg='bg-amber-100 text-slate-800 font-bold';
            if (v===4) bg='bg-amber-200 text-slate-800 font-bold';
            if (v===8) bg='bg-amber-500 text-white font-bold';
            if (v===16) bg='bg-orange-500 text-white font-bold';
            if (v===32) bg='bg-orange-600 text-white font-bold';
            if (v===64) bg='bg-rose-500 text-white font-bold';
            if (v>=128) bg='bg-yellow-400 text-slate-950 font-black shadow-lg';
            return `<div class="${bg} rounded-xl flex items-center justify-center text-lg font-display transition-all duration-150">${txt}</div>`;
        }).join('');
    }
    window.move2048 = function(dir) {
        let moved = false;
        for (let i = 0; i < 4; i++) {
            let r = [];
            for (let j = 0; j < 4; j++) {
                const idx = (dir==='up'||dir==='down') ? (j*4+i) : (i*4+j);
                r.push(grid2048[idx]);
            }
            if (dir==='right'||dir==='down') r.reverse();
            let filtered = r.filter(x => x !== 0);
            for (let k = 0; k < filtered.length - 1; k++) {
                if (filtered[k] === filtered[k+1]) {
                    filtered[k] *= 2; score2048 += filtered[k]; filtered[k+1] = 0;
                }
            }
            filtered = filtered.filter(x => x !== 0);
            while (filtered.length < 4) filtered.push(0);
            if (dir==='right'||dir==='down') filtered.reverse();
            for (let j = 0; j < 4; j++) {
                const idx = (dir==='up'||dir==='down') ? (j*4+i) : (i*4+j);
                if (grid2048[idx] !== filtered[j]) moved = true;
                grid2048[idx] = filtered[j];
            }
        }
        if (moved) { add2048Tile(); render2048(); }
    };

    // ── Flappy Bird Engine ──
    let flappyLoop = null;
    function startFlappyGame() {
        const cvs = document.getElementById('flappyCanvas');
        if (!cvs) return;
        const ctx = cvs.getContext('2d');
        let birdY = 200, birdV = 0, gravity = 0.45, flap = -7;
        let pipes = [], score = 0, gameOver = false;

        function jump() {
            if (gameOver) { birdY=200; birdV=0; pipes=[]; score=0; gameOver=false; loop(); return; }
            birdV = flap;
        }
        cvs.onclick = jump;

        let frame = 0;
        function loop() {
            if (!document.getElementById('flappyCanvas')) return;
            frame++;
            birdV += gravity; birdY += birdV;

            if (frame % 80 === 0) {
                const topH = Math.floor(Math.random() * 180) + 40;
                pipes.push({ x: 320, top: topH, gap: 110, passed: false });
            }

            pipes.forEach(p => p.x -= 2.5);
            pipes = pipes.filter(p => p.x > -60);

            pipes.forEach(p => {
                if (p.x < 70 && p.x + 50 > 30) {
                    if (birdY - 12 < p.top || birdY + 12 > p.top + p.gap) gameOver = true;
                }
                if (!p.passed && p.x < 30) { p.passed = true; score++; }
            });
            if (birdY > 400 || birdY < 0) gameOver = true;

            ctx.fillStyle = '#0f172a'; ctx.fillRect(0,0,320,420);
            ctx.fillStyle = '#22c55e';
            pipes.forEach(p => {
                ctx.fillRect(p.x, 0, 50, p.top);
                ctx.fillRect(p.x, p.top + p.gap, 50, 420 - (p.top + p.gap));
            });
            ctx.fillStyle = '#f59e0b';
            ctx.beginPath(); ctx.arc(50, birdY, 14, 0, Math.PI * 2); ctx.fill();

            ctx.fillStyle = '#ffffff'; ctx.font = 'bold 20px Outfit, sans-serif';
            ctx.fillText(`Skor: ${score}`, 15, 35);

            if (gameOver) {
                ctx.fillStyle = 'rgba(0,0,0,0.7)'; ctx.fillRect(0,0,320,420);
                ctx.fillStyle = '#ef4444'; ctx.font = 'bold 24px Outfit, sans-serif'; ctx.fillText('Game Over!', 90, 190);
                ctx.fillStyle = '#ffffff'; ctx.font = '14px Outfit, sans-serif'; ctx.fillText('Klik Canvas untuk main lagi', 70, 235);
                return;
            }
            flappyLoop = requestAnimationFrame(loop);
        }
        loop();
    }
    window.stopFlappy = function() { if (flappyLoop) cancelAnimationFrame(flappyLoop); };

    // ── Ular Tangga vs AI Engine ──
    let pPos = 1, bPos = 1, snakesTurn = 'player';
    const snakesMap = { 98:78, 95:56, 92:73, 87:24, 62:18, 54:34, 47:26, 16:6 };
    const ladderMap = { 4:14, 9:31, 21:42, 28:84, 36:44, 51:67, 71:91, 80:100 };

    window.initSnakesGame = function() {
        pPos = 1; bPos = 1; snakesTurn = 'player';
        renderSnakesBoard();
    };
    function renderSnakesBoard() {
        const b = document.getElementById('snakesBoard');
        const pEl = document.getElementById('pPos');
        const bEl = document.getElementById('bPos');
        const stEl = document.getElementById('snakesStatus');
        if (pEl) pEl.innerText = pPos;
        if (bEl) bEl.innerText = bPos;
        if (stEl) stEl.innerText = snakesTurn === 'player' ? '🎲 Giliran Kamu!' : '🤖 AI Sedang Lempar...';
        if (!b) return;

        let cells = [];
        for (let r = 9; r >= 0; r--) {
            let row = [];
            for (let c = 0; c < 10; c++) {
                let num = r % 2 === 1 ? (r * 10 + (10 - c)) : (r * 10 + c + 1);
                row.push(num);
            }
            cells.push(...row);
        }
        b.innerHTML = cells.map(num => {
            let isP = num === pPos, isB = num === bPos;
            let isSnake = snakesMap[num], isLadder = ladderMap[num];
            let bg = 'bg-slate-900 text-slate-400';
            if (isSnake) bg = 'bg-rose-950/60 text-rose-400 border border-rose-800/40';
            if (isLadder) bg = 'bg-emerald-950/60 text-emerald-400 border border-emerald-800/40';

            return `<div class="${bg} rounded flex items-center justify-center relative font-bold">
                <span class="opacity-40">${num}</span>
                ${isP ? '<span class="absolute w-3.5 h-3.5 bg-cyan-400 rounded-full border-2 border-white shadow-lg animate-bounce"></span>' : ''}
                ${isB ? '<span class="absolute w-3.5 h-3.5 bg-rose-500 rounded-full border-2 border-white shadow-lg"></span>' : ''}
            </div>`;
        }).join('');
    }

    window.playSnakesTurn = function() {
        if (snakesTurn !== 'player') return;
        const dice = Math.floor(Math.random() * 6) + 1;
        document.getElementById('diceResult').innerText = dice;

        pPos += dice;
        if (pPos > 100) pPos = 100 - (pPos - 100);
        if (snakesMap[pPos]) pPos = snakesMap[pPos];
        if (ladderMap[pPos]) pPos = ladderMap[pPos];
        renderSnakesBoard();

        if (pPos === 100) { showToast('🎉 KAMU MENANG ULAR TANGGA!'); return; }

        snakesTurn = 'bot';
        const btn = document.getElementById('rollDiceBtn');
        if (btn) btn.disabled = true;
        renderSnakesBoard();

        setTimeout(() => {
            const bDice = Math.floor(Math.random() * 6) + 1;
            const diceEl = document.getElementById('diceResult');
            if (diceEl) diceEl.innerText = bDice;
            bPos += bDice;
            if (bPos > 100) bPos = 100 - (bPos - 100);
            if (snakesMap[bPos]) bPos = snakesMap[bPos];
            if (ladderMap[bPos]) bPos = ladderMap[bPos];

            if (bPos === 100) { showToast('🤖 AI Bot Menang! Coba Lagi!'); }
            snakesTurn = 'player';
            if (btn) btn.disabled = false;
            renderSnakesBoard();
        }, 900);
    };

    // =====================================================================
    // § V — UTILITIES
    // =====================================================================
    const tick = ms => new Promise(r => setTimeout(r, ms));

})();
