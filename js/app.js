/* Planckendael Dierenzoektocht — app logica */
(() => {
  'use strict';

  const QUEST_SIZE = 9;
  const LS_QUEST = 'pdz_quest';
  const LS_STATS = 'pdz_stats';

  // ---- State ----
  let animals = [];           // volledige dierenlijst
  let quest = null;           // { ids:[], found:{id:true}, startedAt }
  let animalById = {};
  let currentDetailId = null;
  let cameraStream = null;
  let cameraFacing = 'environment';

  // ---- DOM ----
  const $ = (id) => document.getElementById(id);
  const el = {
    startScreen: $('startScreen'), questScreen: $('questScreen'),
    newQuestBtn: $('newQuestBtn'), resumeRow: $('resumeRow'), resumeBtn: $('resumeBtn'),
    statsRow: $('statsRow'), statCompleted: $('statCompleted'), statPhotos: $('statPhotos'),
    grid: $('grid'), backToStart: $('backToStart'),
    questProgressFill: $('questProgressFill'), questCountLabel: $('questCountLabel'),
    progressBadge: $('progressBadge'), progressCount: $('progressCount'), progressTotal: $('progressTotal'),
    detailModal: $('detailModal'), detailClose: $('detailClose'),
    detailPhoto: $('detailPhoto'), detailName: $('detailName'), detailLatin: $('detailLatin'),
    detailFact: $('detailFact'), foundBtn: $('foundBtn'), foundBanner: $('foundBanner'),
    userPhotoWrap: $('userPhotoWrap'), userPhoto: $('userPhoto'),
    cameraModal: $('cameraModal'), cameraVideo: $('cameraVideo'), cameraCanvas: $('cameraCanvas'),
    cameraShutter: $('cameraShutter'), cameraCancel: $('cameraCancel'), cameraSwitch: $('cameraSwitch'),
    fileFallback: $('fileFallback'),
    rewardModal: $('rewardModal'), rewardClose: $('rewardClose'), rewardNew: $('rewardNew'),
    rewardRank: $('rewardRank'), confettiCanvas: $('confettiCanvas'),
    toast: $('toast'),
  };

  // ---- IndexedDB (foto's) ----
  let dbPromise = null;
  function openDB() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open('pdz-db', 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('photos')) db.createObjectStore('photos');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbPromise;
  }
  async function idbSet(key, val) {
    const db = await openDB();
    return new Promise((res, rej) => {
      const tx = db.transaction('photos', 'readwrite');
      tx.objectStore('photos').put(val, key);
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
    });
  }
  async function idbGet(key) {
    const db = await openDB();
    return new Promise((res, rej) => {
      const tx = db.transaction('photos', 'readonly');
      const r = tx.objectStore('photos').get(key);
      r.onsuccess = () => res(r.result || null);
      r.onerror = () => rej(r.error);
    });
  }
  async function idbClear() {
    const db = await openDB();
    return new Promise((res, rej) => {
      const tx = db.transaction('photos', 'readwrite');
      tx.objectStore('photos').clear();
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
    });
  }
  async function idbCount() {
    const db = await openDB();
    return new Promise((res) => {
      const tx = db.transaction('photos', 'readonly');
      const r = tx.objectStore('photos').count();
      r.onsuccess = () => res(r.result || 0);
      r.onerror = () => res(0);
    });
  }

  // ---- Stats ----
  function getStats() {
    try { return JSON.parse(localStorage.getItem(LS_STATS)) || { completed: 0, totalPhotos: 0 }; }
    catch { return { completed: 0, totalPhotos: 0 }; }
  }
  function setStats(s) { localStorage.setItem(LS_STATS, JSON.stringify(s)); }

  // ---- Quest opslag ----
  function saveQuest() { if (quest) localStorage.setItem(LS_QUEST, JSON.stringify(quest)); }
  function loadQuest() {
    try { return JSON.parse(localStorage.getItem(LS_QUEST)); } catch { return null; }
  }

  // ---- Helpers ----
  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function toast(msg) {
    el.toast.textContent = msg;
    el.toast.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(() => { el.toast.hidden = true; }, 2200);
  }

  function found(id) { return !!(quest && quest.found && quest.found[id]); }
  function foundCount() { return quest ? Object.keys(quest.found || {}).length : 0; }

  // ---- Afbeeldingen ----
  // De directe "afbeelding"-URL's uit de dataset zijn onbetrouwbaar, dus we
  // halen foto's primair op via de Wikipedia REST API (op paginatitel) en
  // cachen het resultaat (geheugen + localStorage) zodat we niet herhaaldelijk fetchen.
  const imgMemCache = new Map();
  const LS_IMG = 'pdz_imgcache';
  let imgLsCache = null;
  function loadImgLsCache() {
    if (imgLsCache) return imgLsCache;
    try { imgLsCache = JSON.parse(localStorage.getItem(LS_IMG)) || {}; } catch { imgLsCache = {}; }
    return imgLsCache;
  }
  function persistImgLsCache() {
    try { localStorage.setItem(LS_IMG, JSON.stringify(imgLsCache)); } catch (e) {}
  }

  // Vergroot een Wikimedia thumbnail (…/330px-Foo.jpg) naar gewenste breedte.
  function upscale(url, px) {
    if (!url) return url;
    return url.replace(/\/(\d+)px-/, `/${px}px-`);
  }

  async function resolveImageUrl(animal) {
    // Lokaal gebundelde foto (img/…) heeft altijd voorrang → werkt volledig offline.
    if (animal.afbeelding && !/^https?:/i.test(animal.afbeelding)) return animal.afbeelding;

    // Anders online: cache + Wikipedia REST API als noodval.
    if (imgMemCache.has(animal.id)) return imgMemCache.get(animal.id);
    const ls = loadImgLsCache();
    if (ls[animal.id]) { imgMemCache.set(animal.id, ls[animal.id]); return ls[animal.id]; }

    let url = null;
    if (animal.wiki) {
      const t = encodeURIComponent(animal.wiki.replace(/ /g, '_'));
      for (const lang of ['en', 'nl']) {
        try {
          const r = await fetch(`https://${lang}.wikipedia.org/api/rest_v1/page/summary/${t}`);
          if (r.ok) {
            const j = await r.json();
            const src = (j.thumbnail && j.thumbnail.source) || (j.originalimage && j.originalimage.source);
            if (src) { url = src; break; }
          }
        } catch (e) { /* offline of geblokkeerd: probeer volgende taal */ }
      }
    }
    if (!url && animal.afbeelding) url = animal.afbeelding;

    if (url) {
      imgMemCache.set(animal.id, url);
      ls[animal.id] = url;
      persistImgLsCache();
    }
    return url;
  }

  const PLACEHOLDER = 'data:image/svg+xml,' + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">' +
    '<rect width="100" height="100" fill="#dfe7e0"/>' +
    '<text x="50" y="62" font-size="46" text-anchor="middle">🐾</text></svg>'
  );

  // Laad een afbeelding in een <img>; px = gewenste breedte (grid ~400, detail ~800).
  async function loadImage(imgEl, animal, px) {
    imgEl.alt = animal.naam;
    const base = await resolveImageUrl(animal);
    if (!base) { imgEl.src = PLACEHOLDER; return; }
    imgEl.onerror = () => {
      // upscaled variant faalde → probeer originele thumbnail, anders placeholder
      imgEl.onerror = () => { imgEl.onerror = null; imgEl.src = PLACEHOLDER; };
      imgEl.src = base;
    };
    imgEl.src = upscale(base, px);
  }

  // ---- Rendering ----
  function showScreen(name) {
    el.startScreen.hidden = name !== 'start';
    el.questScreen.hidden = name !== 'quest';
    el.progressBadge.hidden = name !== 'quest';
  }

  function updateProgressUI() {
    const c = foundCount();
    el.progressCount.textContent = c;
    el.progressTotal.textContent = QUEST_SIZE;
    el.questCountLabel.textContent = `${c}/${QUEST_SIZE}`;
    el.questProgressFill.style.width = `${(c / QUEST_SIZE) * 100}%`;
  }

  function renderGrid() {
    el.grid.innerHTML = '';
    quest.ids.forEach((id) => {
      const a = animalById[id];
      if (!a) return;
      const tile = document.createElement('div');
      tile.className = 'tile' + (found(id) ? ' found' : '');
      tile.dataset.id = id;
      const img = document.createElement('img');
      loadImage(img, a, 400);
      const name = document.createElement('div');
      name.className = 'tile-name';
      name.textContent = a.naam;
      tile.append(img, name);
      tile.addEventListener('click', () => openDetail(id));
      el.grid.appendChild(tile);
    });
    updateProgressUI();
  }

  async function openDetail(id) {
    const a = animalById[id];
    if (!a) return;
    currentDetailId = id;
    el.detailName.textContent = a.naam;
    el.detailLatin.textContent = a.latijn || '';
    el.detailFact.textContent = a.weetje || '';
    loadImage(el.detailPhoto, a, 800);
    const isFound = found(id);
    el.foundBanner.hidden = !isFound;
    el.foundBtn.textContent = isFound ? '📷 Nieuwe foto maken' : '📷 Dier gevonden';

    // eigen foto tonen
    const userImg = await idbGet('photo_' + id);
    if (userImg) {
      el.userPhoto.src = userImg;
      el.userPhotoWrap.hidden = false;
    } else {
      el.userPhotoWrap.hidden = true;
    }
    el.detailModal.hidden = false;
  }

  function closeDetail() {
    el.detailModal.hidden = true;
    currentDetailId = null;
  }

  // ---- Nieuwe zoektocht ----
  async function newQuest() {
    if (animals.length === 0) { toast('Dierenlijst nog niet geladen…'); return; }
    const pick = shuffle(animals).slice(0, Math.min(QUEST_SIZE, animals.length));
    quest = { ids: pick.map(a => a.id), found: {}, startedAt: Date.now() };
    await idbClear();
    saveQuest();
    showScreen('quest');
    renderGrid();
  }

  function resumeQuest() {
    if (!quest) return;
    showScreen('quest');
    renderGrid();
  }

  // ---- Camera ----
  async function startCamera() {
    el.cameraModal.hidden = false;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      // fallback naar bestand-input met camera capture
      el.cameraModal.hidden = true;
      el.fileFallback.value = '';
      el.fileFallback.click();
      return;
    }
    try {
      cameraStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: cameraFacing }, audio: false,
      });
      el.cameraVideo.srcObject = cameraStream;
    } catch (e) {
      stopCamera();
      el.cameraModal.hidden = true;
      // fallback
      el.fileFallback.value = '';
      el.fileFallback.click();
    }
  }

  function stopCamera() {
    if (cameraStream) {
      cameraStream.getTracks().forEach(t => t.stop());
      cameraStream = null;
    }
    el.cameraVideo.srcObject = null;
    el.cameraModal.hidden = true;
  }

  async function switchCamera() {
    cameraFacing = cameraFacing === 'environment' ? 'user' : 'environment';
    if (cameraStream) { cameraStream.getTracks().forEach(t => t.stop()); }
    try {
      cameraStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: cameraFacing }, audio: false });
      el.cameraVideo.srcObject = cameraStream;
    } catch (e) { toast('Kan camera niet wisselen'); }
  }

  function captureFromVideo() {
    const v = el.cameraVideo;
    const c = el.cameraCanvas;
    const w = v.videoWidth || 1080, h = v.videoHeight || 1080;
    c.width = w; c.height = h;
    c.getContext('2d').drawImage(v, 0, 0, w, h);
    const dataUrl = c.toDataURL('image/jpeg', 0.82);
    stopCamera();
    savePhoto(currentDetailId, dataUrl);
  }

  function fileToDataUrl(file, maxDim = 1280) {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => {
        const img = new Image();
        img.onload = () => {
          let { width: w, height: h } = img;
          const scale = Math.min(1, maxDim / Math.max(w, h));
          w = Math.round(w * scale); h = Math.round(h * scale);
          const c = document.createElement('canvas');
          c.width = w; c.height = h;
          c.getContext('2d').drawImage(img, 0, 0, w, h);
          resolve(c.toDataURL('image/jpeg', 0.82));
        };
        img.onerror = () => resolve(reader.result);
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }

  async function onFileFallback(e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const dataUrl = await fileToDataUrl(file);
    savePhoto(currentDetailId, dataUrl);
  }

  async function savePhoto(id, dataUrl) {
    if (!id) return;
    await idbSet('photo_' + id, dataUrl);
    const wasFound = found(id);
    quest.found[id] = true;
    saveQuest();

    // stats: foto's tellen
    if (!wasFound) {
      const s = getStats();
      s.totalPhotos = (s.totalPhotos || 0) + 1;
      setStats(s);
    }

    // UI updaten
    el.userPhoto.src = dataUrl;
    el.userPhotoWrap.hidden = false;
    el.foundBanner.hidden = false;
    el.foundBtn.textContent = '📷 Nieuwe foto maken';
    renderGrid();
    toast(wasFound ? 'Foto vervangen 📸' : 'Dier gevonden! 🎉');

    if (foundCount() >= QUEST_SIZE) {
      setTimeout(() => { closeDetail(); showReward(); }, 700);
    }
  }

  // ---- Beloning ----
  function rankFor(completed) {
    if (completed >= 10) return '🌟 Legendarische Ontdekkingsreiziger';
    if (completed >= 5) return '🥇 Meester-Speurder';
    if (completed >= 3) return '🥈 Ervaren Dierenspotter';
    if (completed >= 2) return '🥉 Junior Bioloog';
    return '🔰 Eerste Zoektocht Voltooid!';
  }

  function showReward() {
    const s = getStats();
    s.completed = (s.completed || 0) + 1;
    setStats(s);
    el.rewardRank.textContent = rankFor(s.completed);
    el.rewardModal.hidden = false;
    launchConfetti();
  }

  function launchConfetti() {
    const canvas = el.confettiCanvas;
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    canvas.width = window.innerWidth * dpr;
    canvas.height = window.innerHeight * dpr;
    ctx.scale(dpr, dpr);
    const W = window.innerWidth, H = window.innerHeight;
    const colors = ['#1b7a3d', '#2fa85b', '#ffb200', '#ff5d5d', '#4d9bff', '#ff8fd0'];
    const pieces = Array.from({ length: 140 }, () => ({
      x: Math.random() * W, y: -20 - Math.random() * H,
      r: 4 + Math.random() * 6,
      c: colors[(Math.random() * colors.length) | 0],
      vy: 2 + Math.random() * 4, vx: -1.5 + Math.random() * 3,
      rot: Math.random() * Math.PI, vr: -0.2 + Math.random() * 0.4,
    }));
    let start = performance.now();
    function frame(now) {
      const t = now - start;
      ctx.clearRect(0, 0, W, H);
      pieces.forEach(p => {
        p.x += p.vx; p.y += p.vy; p.rot += p.vr;
        ctx.save();
        ctx.translate(p.x, p.y); ctx.rotate(p.rot);
        ctx.fillStyle = p.c;
        ctx.fillRect(-p.r / 2, -p.r / 2, p.r, p.r * 0.6);
        ctx.restore();
      });
      if (t < 5000 && !el.rewardModal.hidden) requestAnimationFrame(frame);
      else ctx.clearRect(0, 0, W, H);
    }
    requestAnimationFrame(frame);
  }

  // ---- Startscherm state ----
  async function refreshStartScreen() {
    quest = loadQuest();
    const hasActive = quest && quest.ids && foundCount() < QUEST_SIZE && quest.ids.length === QUEST_SIZE;
    el.resumeRow.hidden = !hasActive;
    const s = getStats();
    const photos = await idbCount();
    el.statCompleted.textContent = s.completed || 0;
    el.statPhotos.textContent = s.totalPhotos || photos || 0;
    el.statsRow.hidden = !((s.completed || 0) > 0 || (s.totalPhotos || 0) > 0);
  }

  // ---- Init ----
  async function loadAnimals() {
    try {
      const r = await fetch('data/animals.json', { cache: 'no-cache' });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      animals = await r.json();
    } catch (e) {
      console.error('Kon dierenlijst niet laden', e);
      animals = [];
      toast('⚠️ Dierenlijst ontbreekt (data/animals.json)');
    }
    animalById = {};
    animals.forEach(a => { animalById[a.id] = a; });
  }

  function bindEvents() {
    el.newQuestBtn.addEventListener('click', newQuest);
    el.resumeBtn.addEventListener('click', resumeQuest);
    el.backToStart.addEventListener('click', () => { showScreen('start'); refreshStartScreen(); });
    el.detailClose.addEventListener('click', closeDetail);
    el.detailModal.addEventListener('click', (e) => { if (e.target === el.detailModal) closeDetail(); });
    el.foundBtn.addEventListener('click', startCamera);
    el.cameraShutter.addEventListener('click', captureFromVideo);
    el.cameraCancel.addEventListener('click', stopCamera);
    el.cameraSwitch.addEventListener('click', switchCamera);
    el.fileFallback.addEventListener('change', onFileFallback);
    el.rewardClose.addEventListener('click', () => { el.rewardModal.hidden = true; showScreen('start'); refreshStartScreen(); });
    el.rewardNew.addEventListener('click', () => { el.rewardModal.hidden = true; newQuest(); });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        if (!el.cameraModal.hidden) stopCamera();
        else if (!el.detailModal.hidden) closeDetail();
      }
    });
  }

  function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return;
    // Enkel in beveiligde context (https of localhost); niet op file://
    if (location.protocol === 'file:') return;
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch(() => { /* offline-modus niet beschikbaar */ });
    });
  }

  async function init() {
    bindEvents();
    registerServiceWorker();
    await loadAnimals();
    await refreshStartScreen();
    showScreen('start');
  }

  document.addEventListener('DOMContentLoaded', init);
})();
