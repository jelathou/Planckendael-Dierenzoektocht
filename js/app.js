/* Planckendael Dierenzoektocht — app logica */
(() => {
  'use strict';

  const CHUNK_SIZE = 9;
  const LS_JOURNEY = 'pdz_journey';
  const LS_STATS = 'pdz_stats';

  // ---- State ----
  let animals = [];           // volledige dierenlijst
  let journey = null;         // { order:[ids], found:{id:true}, chunk:0 } — heel traject, elk dier één keer
  let viewChunk = 0;          // welk segment nu in het grid getoond wordt
  let animalById = {};
  let currentDetailId = null;
  let cameraStream = null;
  let cameraFacing = 'environment';

  // ---- DOM ----
  const $ = (id) => document.getElementById(id);
  const el = {
    startScreen: $('startScreen'), questScreen: $('questScreen'),
    newQuestBtn: $('newQuestBtn'), resetJourneyBtn: $('resetJourneyBtn'),
    overallFill: $('overallFill'), overallFound: $('overallFound'), overallTotal: $('overallTotal'),
    homePhotos: $('homePhotos'), journey: $('journey'),
    grid: $('grid'), backToStart: $('backToStart'),
    questProgressFill: $('questProgressFill'), questCountLabel: $('questCountLabel'),
    progressBadge: $('progressBadge'), progressCount: $('progressCount'), progressTotal: $('progressTotal'),
    detailModal: $('detailModal'), detailClose: $('detailClose'),
    detailPhoto: $('detailPhoto'), detailName: $('detailName'), detailLatin: $('detailLatin'),
    detailFact: $('detailFact'), foundBtn: $('foundBtn'), unfindBtn: $('unfindBtn'), foundBanner: $('foundBanner'),
    userPhotoWrap: $('userPhotoWrap'), userPhoto: $('userPhoto'),
    cameraModal: $('cameraModal'), cameraVideo: $('cameraVideo'), cameraCanvas: $('cameraCanvas'),
    cameraShutter: $('cameraShutter'), cameraCancel: $('cameraCancel'), cameraSwitch: $('cameraSwitch'),
    fileFallback: $('fileFallback'),
    rewardModal: $('rewardModal'), rewardClose: $('rewardClose'), rewardTitle: $('rewardTitle'),
    rewardRank: $('rewardRank'), rewardProgress: $('rewardProgress'), confettiCanvas: $('confettiCanvas'),
    dancer: $('dancer'), speechBubble: $('speechBubble'),
    jungleModal: $('jungleModal'), jungleScene: $('jungleScene'), jungleClose: $('jungleClose'),
    jungleReset: $('jungleReset'), jungleTotal: $('jungleTotal'), jungleConfetti: $('jungleConfetti'),
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
  async function idbDelete(key) {
    const db = await openDB();
    return new Promise((res, rej) => {
      const tx = db.transaction('photos', 'readwrite');
      tx.objectStore('photos').delete(key);
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

  // ---- Traject (journey) ----
  function saveJourney() { if (journey) localStorage.setItem(LS_JOURNEY, JSON.stringify(journey)); }
  function loadJourney() {
    try { return JSON.parse(localStorage.getItem(LS_JOURNEY)); } catch { return null; }
  }
  async function createJourney() {
    journey = { order: shuffle(animals.map(a => a.id)), found: {}, chunk: 0 };
    saveJourney();
    await idbClear();                       // schone lei bij een nieuw traject
    setStats({ completed: 0, totalPhotos: 0 });
  }
  function ensureJourney() {
    if (!journey) journey = loadJourney();
    // Als de dierenlijst gewijzigd is, is het oude traject niet meer geldig.
    if (journey && (!Array.isArray(journey.order) || journey.order.length !== animals.length)) journey = null;
  }

  function totalChunks() { return journey ? Math.ceil(journey.order.length / CHUNK_SIZE) : 0; }
  function chunkIds(i) { return journey ? journey.order.slice(i * CHUNK_SIZE, i * CHUNK_SIZE + CHUNK_SIZE) : []; }
  function chunkOf(id) { const idx = journey ? journey.order.indexOf(id) : -1; return idx < 0 ? -1 : Math.floor(idx / CHUNK_SIZE); }
  function chunkFoundCount(i) { return chunkIds(i).filter(id => found(id)).length; }
  function isChunkComplete(i) { const ids = chunkIds(i); return ids.length > 0 && ids.every(id => found(id)); }
  function totalFound() { return journey ? Object.keys(journey.found).length : 0; }
  function journeyComplete() { return journey && journey.chunk >= totalChunks(); }
  function currentIds() { return chunkIds(viewChunk); }

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

  function found(id) { return !!(journey && journey.found && journey.found[id]); }

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
    const ids = currentIds();
    const size = ids.length;
    const c = ids.filter(id => found(id)).length;
    el.progressCount.textContent = c;
    el.progressTotal.textContent = size;
    el.questCountLabel.textContent = `${c}/${size}`;
    el.questProgressFill.style.width = `${size ? (c / size) * 100 : 0}%`;
  }

  function renderGrid() {
    el.grid.innerHTML = '';
    currentIds().forEach((id) => {
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
    el.unfindBtn.hidden = !isFound;

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

  // ---- Zoektocht (segment van het traject) ----
  function openChunk(i) {
    if (i < 0 || i >= totalChunks()) return;
    viewChunk = i;
    showScreen('quest');
    renderGrid();
  }

  // De home-knop: open het actieve segment, of de jungle als alles gevonden is.
  function startActiveQuest() {
    if (!journey) return;
    if (journeyComplete()) { showJungle(); return; }
    openChunk(journey.chunk);
  }

  async function resetJourney() {
    if (!window.confirm('Het hele traject opnieuw beginnen? Al je gevonden dieren en foto’s worden gewist.')) return;
    await createJourney();
    viewChunk = 0;
    showScreen('start');
    refreshHome();
    toast('Nieuw traject gestart 🔍');
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
    journey.found[id] = true;
    saveJourney();

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
    el.unfindBtn.hidden = false;
    renderGrid();
    toast(wasFound ? 'Foto vervangen 📸' : 'Dier gevonden! 🎉');

    // Voltooide je hiermee het actieve segment?
    const ci = chunkOf(id);
    if (ci === journey.chunk && isChunkComplete(ci)) {
      setTimeout(() => { closeDetail(); completeChunk(ci); }, 700);
    }
  }

  // Zet een gevonden dier terug op "niet gevonden" en verwijder de gemaakte foto.
  async function unfindAnimal() {
    const id = currentDetailId;
    if (!id || !found(id)) return;
    if (!window.confirm('Dit dier terugzetten als niet-gevonden? De foto die je ervan maakte, wordt verwijderd.')) return;
    delete journey.found[id];
    saveJourney();
    await idbDelete('photo_' + id);
    const s = getStats();
    if (s.totalPhotos > 0) { s.totalPhotos -= 1; setStats(s); }
    el.foundBanner.hidden = true;
    el.userPhotoWrap.hidden = true;
    el.foundBtn.textContent = '📷 Dier gevonden';
    el.unfindBtn.hidden = true;
    renderGrid();
    toast('Teruggezet als niet-gevonden');
  }

  // ---- Beloning ----
  const DANCERS = ['🐵', '🦧', '🦜', '🐘', '🦩', '🦊', '🐨', '🦥', '🦦', '🦁', '🐯', '🐼'];

  function rankFor(done, total) {
    const ratio = total ? done / total : 0;
    if (done >= total) return '🌟 Legendarische Jungle-Ontdekker';
    if (ratio >= 0.75) return '🥇 Meester-Speurneus';
    if (ratio >= 0.5) return '🥈 Ervaren Dierenspotter';
    if (ratio >= 0.25) return '🥉 Junior Bioloog';
    return '🔰 Speurneus in Opleiding';
  }

  // Segment voltooid: schuif het actieve segment op en toon de dans-animatie.
  function completeChunk(i) {
    journey.chunk = i + 1;
    saveJourney();
    const s = getStats();
    s.completed = (s.completed || 0) + 1;
    setStats(s);
    showReward(journeyComplete());
  }

  function showReward(isFinal) {
    el.dancer.textContent = DANCERS[(Math.random() * DANCERS.length) | 0];
    el.speechBubble.textContent = 'Goed gedaan, je bent een echte speurneus!';
    const done = journey.chunk;           // aantal voltooide segmenten
    const total = totalChunks();
    el.rewardTitle.textContent = isFinal ? 'Laatste zoektocht voltooid! 🌴' : 'Zoektocht voltooid!';
    el.rewardRank.textContent = rankFor(done, total);
    el.rewardProgress.textContent = isFinal
      ? `Je vond alle ${animals.length} dieren van Planckendael!`
      : `Zoektocht ${done} van ${total} klaar · ${totalFound()}/${animals.length} dieren gevonden`;
    el.rewardClose.textContent = isFinal ? 'Naar de jungle 🌴' : 'Verder speuren 🔍';
    el.rewardModal.dataset.final = isFinal ? '1' : '';
    el.rewardModal.hidden = false;
    launchConfetti(el.confettiCanvas);
  }

  // ---- Jungle-eindscherm ----
  function buildJungleScene() {
    const emojis = ['🐒', '🦧', '🦁', '🐘', '🦒', '🦓', '🦩', '🦜', '🐍', '🦥', '🦦', '🐆', '🦛', '🦏', '🐅', '🦚', '🌴', '🌿', '🍃', '🐢', '🦇', '🦋'];
    const scene = el.jungleScene;
    scene.innerHTML = '';
    for (let i = 0; i < 36; i++) {
      const s = document.createElement('span');
      s.textContent = emojis[(Math.random() * emojis.length) | 0];
      s.style.left = (Math.random() * 94) + '%';
      s.style.top = (Math.random() * 94) + '%';
      s.style.fontSize = (20 + Math.random() * 26) + 'px';
      s.style.animationDelay = (Math.random() * 3).toFixed(2) + 's';
      scene.appendChild(s);
    }
  }

  function showJungle() {
    el.jungleTotal.textContent = animals.length;
    buildJungleScene();
    el.jungleModal.hidden = false;
    launchConfetti(el.jungleConfetti);
  }

  function launchConfetti(canvas) {
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
      if (t < 5000) requestAnimationFrame(frame);
      else ctx.clearRect(0, 0, W, H);
    }
    requestAnimationFrame(frame);
  }

  // ---- Home / voortgang ----
  function refreshHome() {
    ensureJourney();
    const total = animals.length;
    const nFound = totalFound();
    el.overallTotal.textContent = total;
    el.overallFound.textContent = nFound;
    el.overallFill.style.width = total ? `${(nFound / total) * 100}%` : '0%';
    el.homePhotos.textContent = getStats().totalPhotos || 0;
    renderJourneyPath();

    if (journeyComplete()) {
      el.newQuestBtn.textContent = '🌴 Bekijk de jungle';
    } else {
      const c = journey ? journey.chunk : 0;
      const partial = journey && chunkFoundCount(c) > 0;
      el.newQuestBtn.textContent = partial ? `▶️ Verder met zoektocht ${c + 1}` : `🔍 Start zoektocht ${c + 1}`;
    }
    el.resetJourneyBtn.hidden = !(nFound > 0 || (journey && journey.chunk > 0));
  }

  function renderJourneyPath() {
    const jn = el.journey;
    jn.innerHTML = '';
    if (!journey) return;
    const tc = totalChunks();
    for (let i = 0; i < tc; i++) {
      const ids = chunkIds(i);
      const fc = chunkFoundCount(i);
      const done = fc === ids.length;
      const current = i === journey.chunk;
      const locked = i > journey.chunk;
      const stop = document.createElement('div');
      stop.className = 'stop' + (done ? ' done' : '') + (current ? ' current' : '') + (locked ? ' locked' : '');
      stop.innerHTML =
        `<div class="stop-node">${done ? '✓' : (i + 1)}</div>` +
        `<div class="stop-info"><span class="stop-title">Zoektocht ${i + 1}</span>` +
        `<span class="stop-meta">${fc}/${ids.length} gevonden</span></div>`;
      if (!locked) stop.addEventListener('click', () => openChunk(i));
      jn.appendChild(stop);
    }
    // Eindpunt: de jungle
    const reached = journeyComplete();
    const jstop = document.createElement('div');
    jstop.className = 'stop jungle-stop' + (reached ? ' reached' : ' locked');
    jstop.innerHTML =
      `<div class="jungle-node">${reached ? '🌴' : '🔒'}</div>` +
      `<span class="stop-title">${reached ? 'Jungle bereikt!' : 'Jungle vol dieren'}</span>`;
    if (reached) jstop.addEventListener('click', showJungle);
    jn.appendChild(jstop);
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
    el.newQuestBtn.addEventListener('click', startActiveQuest);
    el.resetJourneyBtn.addEventListener('click', resetJourney);
    el.backToStart.addEventListener('click', () => { showScreen('start'); refreshHome(); });
    el.detailClose.addEventListener('click', closeDetail);
    el.detailModal.addEventListener('click', (e) => { if (e.target === el.detailModal) closeDetail(); });
    el.foundBtn.addEventListener('click', startCamera);
    el.unfindBtn.addEventListener('click', unfindAnimal);
    el.cameraShutter.addEventListener('click', captureFromVideo);
    el.cameraCancel.addEventListener('click', stopCamera);
    el.cameraSwitch.addEventListener('click', switchCamera);
    el.fileFallback.addEventListener('change', onFileFallback);
    el.rewardClose.addEventListener('click', () => {
      const isFinal = el.rewardModal.dataset.final === '1';
      el.rewardModal.hidden = true;
      if (isFinal) { showJungle(); }
      else { showScreen('start'); refreshHome(); }
    });
    el.jungleClose.addEventListener('click', () => { el.jungleModal.hidden = true; showScreen('start'); refreshHome(); });
    el.jungleReset.addEventListener('click', () => { el.jungleModal.hidden = true; resetJourney(); });
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
    ensureJourney();
    if (!journey && animals.length) await createJourney();
    viewChunk = journey ? journey.chunk : 0;
    refreshHome();
    showScreen('start');
  }

  document.addEventListener('DOMContentLoaded', init);
})();
