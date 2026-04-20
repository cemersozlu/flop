/* FLAC Player — Renderer */

const state = {
  tracks: [], albums: {}, queue: [], queueIndex: -1,
  currentTrack: null, isPlaying: false,
  currentView: 'albums', currentAlbumKey: null,
  searchQuery: '', sortBy: 'artist',
  musicFolder: null,
  isSaving: false, // Prevent playback while writing metadata
  currentFolder: null, // For folder tree navigation
  activeCollection: 'flac', // 'flac' or 'mp3'
  collections: {
    flac: { tracks: [], albums: {}, folder: null, currentFolder: null },
    mp3: { tracks: [], albums: {}, folder: null, currentFolder: null }
  }
};

const $ = id => document.getElementById(id);

// ── Helpers ────────────────────────────────────────────────
function fmt(s) {
  if (!s || isNaN(s)) return '0:00';
  return Math.floor(s / 60) + ':' + String(Math.floor(s % 60)).padStart(2, '0');
}

function albumKey(t) {
  const a = (t.albumArtist || t.artist || 'Unknown Artist').trim().toLowerCase();
  const b = (t.album || 'Unknown Album').trim().toLowerCase();
  return a + '___' + b;
}

function artEl(src) {
  if (src) {
    const img = document.createElement('img');
    img.src = src;
    img.onerror = () => img.replaceWith(placeholder());
    return img;
  }
  return placeholder();
}

function placeholder() {
  const d = document.createElement('div');
  d.className = 'album-art-placeholder';
  d.innerHTML = `<svg width="40" height="40" viewBox="0 0 40 40" fill="none">
    <circle cx="20" cy="20" r="18" class="outer-circle" stroke-width="1" opacity="0.3"/>
    <circle cx="20" cy="20" r="7" class="middle-circle" stroke-width="1" opacity="0.4"/>
    <circle cx="20" cy="20" r="2.5" class="inner-circle" opacity="0.5"/>
  </svg>`;
  return d;
}

function qbadge(t) {
  if (!t.bitrate) return '';
  return Math.round(t.bitrate / 1000);
}

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function renderStars(rating) {
  let html = '';
  for (let i = 1; i <= 5; i++) {
    html += `<svg class="star ${i <= rating ? 'filled' : ''}" data-val="${i}" width="13" height="13" viewBox="0 0 24 24" fill="${i <= rating ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>`;
  }
  return html;
}

// ── Album grouping ─────────────────────────────────────────
function groupAlbums() {
  state.albums = {};
  for (const t of state.tracks) {
    const k = albumKey(t);
    if (!state.albums[k]) {
      state.albums[k] = { 
        key: k, 
        name: t.album || 'Unknown Album', 
        artist: t.albumArtist || t.artist || 'Unknown Artist', 
        year: t.year, 
        coverArt: null, 
        tracks: [] 
      };
    }
    const a = state.albums[k];
    if (!a.coverArt && t.coverArt) a.coverArt = t.coverArt;
    if (!a.year && t.year) a.year = t.year;
    a.tracks.push(t);
  }
  for (const a of Object.values(state.albums)) {
    a.tracks.sort((x, y) => x.discNo !== y.discNo ? x.discNo - y.discNo : x.trackNo - y.trackNo);
  }
}

function sortedAlbums(map) {
  const arr = Object.values(map);
  if (state.sortBy === 'artist') return arr.sort((a, b) => a.artist.localeCompare(b.artist) || a.name.localeCompare(b.name));
  if (state.sortBy === 'year-desc') return arr.sort((a, b) => (b.year || 0) - (a.year || 0) || a.name.localeCompare(b.name));
  if (state.sortBy === 'year-asc') return arr.sort((a, b) => (a.year || 0) - (b.year || 0) || a.name.localeCompare(b.name));
  return arr.sort((a, b) => a.name.localeCompare(b.name));
}

function filteredAlbums() {
  const q = state.searchQuery.toLowerCase();

  let albums = state.albums;
  if (state.currentFolder) {
    const filtered = {};
    for (const [k, a] of Object.entries(state.albums)) {
      if (a.tracks.some(t => t.path.startsWith(state.currentFolder + '\\') || t.path.startsWith(state.currentFolder + '/'))) {
        filtered[k] = a;
      }
    }
    albums = filtered;
  }

  if (!q) return albums;
  const r = {};
  for (const [k, a] of Object.entries(albums)) {
    if (a.name.toLowerCase().includes(q) || a.artist.toLowerCase().includes(q) || a.tracks.some(t => t.title.toLowerCase().includes(q))) r[k] = a;
  }
  return r;
}

function filteredTracks() {
  const q = state.searchQuery.toLowerCase();
  let tracks = state.tracks;

  if (state.currentFolder) {
    tracks = tracks.filter(t => t.path.startsWith(state.currentFolder + '\\') || t.path.startsWith(state.currentFolder + '/'));
  }

  if (!q) return tracks;
  return tracks.filter(t => t.title.toLowerCase().includes(q) || t.artist.toLowerCase().includes(q) || t.album.toLowerCase().includes(q));
}

// ── View switching ─────────────────────────────────────────
// Simple inline style — always wins, no cascade issues
function showView(view) {
  $('empty-state').style.display = view === 'empty' ? 'flex' : 'none';
  $('loading-state').style.display = view === 'loading' ? 'flex' : 'none';
  $('album-grid').style.display = view === 'albums' ? 'grid' : 'none';
  $('track-list-view').style.display = view === 'tracks' ? 'block' : 'none';

  if (!state.currentFolder) {
    document.querySelectorAll('.tree-header').forEach(h => h.classList.remove('active'));
    // Reset/Collapse tree when viewing full library
    document.querySelectorAll('.tree-children').forEach(c => c.classList.remove('visible'));
    document.querySelectorAll('.toggle-icon').forEach(i => i.classList.remove('expanded'));
    // Keep root children visible
    const rootChildren = $('folder-tree')?.querySelector('.tree-children');
    if (rootChildren) rootChildren.classList.add('visible');
  }
}

function showRightPane(visible) {
  const el = document.getElementById('pane-right');
  el.style.setProperty('display', visible ? 'flex' : 'none', 'important');
}

// ── Render album grid ──────────────────────────────────────
function renderAlbumGrid() {
  state.currentView = 'albums';
  const albums = sortedAlbums(filteredAlbums());
  const grid = $('album-grid');
  grid.innerHTML = '';

  if (!albums.length) { showView('empty'); return; }
  showView('albums');

  for (const alb of albums) {
    const card = document.createElement('div');
    card.className = 'album-card';
    card.dataset.key = alb.key;
    if (state.currentAlbumKey === alb.key) card.classList.add('selected');
    if (state.currentTrack && albumKey(state.currentTrack) === alb.key) card.classList.add('now-playing');

    const wrap = document.createElement('div');
    wrap.className = 'album-art-wrap';
    wrap.appendChild(artEl(alb.coverArt));

    const ov = document.createElement('div');
    ov.className = 'album-play-overlay';
    ov.innerHTML = '<svg width="36" height="36" viewBox="0 0 36 36" fill="currentColor"><path d="M10 7l17 11-17 11V7z"/></svg>';
    wrap.appendChild(ov);

    const info = document.createElement('div');
    info.className = 'album-info';
    info.innerHTML = `<div class="album-name">${esc(alb.name)}</div>
      <div class="album-artist-year">${esc(alb.artist)}</div>
      <div class="album-track-count">${alb.year ? alb.year + ' · ' : ''}${alb.tracks.length} track${alb.tracks.length !== 1 ? 's' : ''}</div>`;

    card.appendChild(wrap);
    card.appendChild(info);
    grid.appendChild(card);

    card.addEventListener('click', () => {
      document.querySelectorAll('.album-card').forEach(c => c.classList.remove('selected'));
      card.classList.add('selected');
      openAlbum(alb.key);
    });

    ov.addEventListener('click', e => { e.stopPropagation(); playAlbum(alb.key); });
  }
}

// ── Right pane ─────────────────────────────────────────────
function openAlbum(key) {
  state.currentAlbumKey = key;
  const alb = state.albums[key];
  if (!alb) { alert('BUG: album not found for key: ' + key + '\nAvailable keys: ' + Object.keys(state.albums).join('\n')); return; }

  // Show pane
  showRightPane(true);

  // Art
  const artEl2 = $('detail-art');
  artEl2.innerHTML = '';
  artEl2.appendChild(artEl(alb.coverArt));

  // Info
  $('detail-artist').textContent = alb.artist;
  $('detail-title').textContent = alb.name;
  $('detail-meta').innerHTML = [alb.year ? `<b>${alb.year}</b>` : '', alb.tracks.length + ' tracks', `<b>${fmt(alb.tracks.reduce((s, t) => s + t.duration, 0))}</b>`].filter(Boolean).join(' · ');
  $('play-album-btn').onclick = () => playAlbum(key);

  // Tracks
  const tbody = $('album-track-body');
  tbody.innerHTML = '';
  
  const hasMultipleDiscs = new Set(alb.tracks.map(t => t.discNo)).size > 1;

  alb.tracks.forEach((t, i) => {
    const tr = document.createElement('tr');
    if (state.currentTrack?.path === t.path) tr.classList.add('now-playing');
    tr.dataset.path = t.path;
    
    // Format track number: "1.01" for multi-disc, just "1" for single-disc
    const displayNo = hasMultipleDiscs 
      ? `${t.discNo}.${String(t.trackNo || i + 1).padStart(2, '0')}` 
      : (t.trackNo || i + 1);
      
    tr.innerHTML = `
      <td class="track-table__col-track-no">${displayNo}</td>
      <td class="track-table__col-track-title-artist">${esc(t.title)}<br>${esc(t.artist)}</td>
      <td class="track-table__col-track-rating">${renderStars(t.rating)}</td>
      <td class="track-table__col-track-duration">${fmt(t.duration)}</td>
      <td class="track-table__col-track-info"><span class="track-info-badge">${qbadge(t) || (state.activeCollection === 'flac' ? 'FLAC' : 'MP3')}</span></td>`;
    tr.addEventListener('click', () => {
      tbody.querySelectorAll('tr').forEach(r => r.classList.remove('selected'));
      tr.classList.add('selected');
    });
    tr.addEventListener('dblclick', () => {
      state.queue = alb.tracks.map(x => x.path);
      state.queueIndex = i;
      playTrack(t);
    });

    const stars = tr.querySelectorAll('.star');
    stars.forEach(star => {
      star.addEventListener('click', async (e) => {
        e.stopPropagation();
        const newRating = parseInt(star.dataset.val, 10);
        const oldVal = t.rating;
        const newVal = (newRating === t.rating) ? 0 : newRating; // Toggle rating to 0 if same star clicked

        // Update UI immediately
        stars.forEach((s, idx) => {
          if (idx < newVal) { s.classList.add('filled'); s.setAttribute('fill', 'currentColor'); }
          else { s.classList.remove('filled'); s.setAttribute('fill', 'none'); }
        });

        state.isSaving = true;
        updatePlayPause();
        console.log(`[App] Setting rating ${newVal} for ${t.path}`);

        let wasPlayingThis = false;
        let cTime = 0;
        let wasPlayingState = false;
        if (state.currentTrack && state.currentTrack.path === t.path) {
          console.log('[App] Track is currently playing. Releasing file lock...');
          wasPlayingThis = true;
          cTime = audio.currentTime;
          wasPlayingState = !audio.paused;
          audio.src = ''; // Free Windows File Lock
          audio.load();
        }

        try {
          const newRating = newVal;
          const success = await window.electronAPI.setRating(t.path, newRating);

          if (success) {
            console.log(`[App] Rating successfully updated to ${newRating}`);
            t.rating = newRating;
            const folder = t.path.substring(0, Math.max(t.path.lastIndexOf('\\'), t.path.lastIndexOf('/')));
            window.electronAPI.saveLibraryCache(folder, state.collections[state.activeCollection].tracks, state.activeCollection);
          } else {
            console.warn(`[App] Rating update failed for ${t.path}`);
          }

          if (wasPlayingThis) {
            console.log('[App] Resuming playback at', cTime);
            // Wait slightly for the file system to settle
            await new Promise(r => setTimeout(r, 100));

            const rawUrl = await window.electronAPI.getAudioUrl(t.path);
            const url = rawUrl + (rawUrl.includes('?') ? '&' : '?') + 't=' + Date.now();

            audio.src = url;
            audio.load();
            audio.onloadedmetadata = () => {
              audio.currentTime = cTime;
              if (wasPlayingState) safePlay();
              audio.onloadedmetadata = null;
            };
          }
        } catch (err) {
          console.error('[App] Error in rating update:', err);
        } finally {
          state.isSaving = false;
          updatePlayPause();
        }
      });
    });

    tbody.appendChild(tr);
  });

  $('pane-right-inner').scrollTop = 0;
}

// ── Track list ─────────────────────────────────────────────
function renderTrackList() {
  state.currentView = 'tracks';
  showView('tracks');

  const tracks = filteredTracks().slice().sort((a, b) => {
    if (state.sortBy === 'artist') return a.artist.localeCompare(b.artist);
    if (state.sortBy === 'year-desc') return (b.year || 0) - (a.year || 0);
    if (state.sortBy === 'year-asc') return (a.year || 0) - (b.year || 0);
    return a.title.localeCompare(b.title);
  });
  const tbody = $('track-table-body');
  tbody.innerHTML = '';
  tracks.forEach((t, i) => {
    const tr = document.createElement('tr');
    if (state.currentTrack?.path === t.path) tr.classList.add('now-playing');
    tr.dataset.path = t.path;
    tr.innerHTML = `
      <td class="track-table__col-track-no">${i + 1}</td>
      <td class="track-table__col-track-title-artist">${esc(t.title)}<br>${esc(t.artist)}</td>
      <td>${esc(t.album)}</td>
      <td>${t.year || ''}</td>

      <td class="track-table__col-track-duratio">${fmt(t.duration)}</td>
      <td class="track-table__col-track-info"><span class="track-info-badge">${qbadge(t) || (state.activeCollection === 'flac' ? 'FLAC' : 'MP3')}</span></td>`;
    tr.addEventListener('click', () => { state.queue = tracks.map(x => x.path); state.queueIndex = i; playTrack(t); });
    tbody.appendChild(tr);
  });
}

// ── Folder Tree ───────────────────────────────────────────
function buildFolderTree() {
  const root = { name: 'Root', children: {}, path: state.musicFolder };
  const base = state.musicFolder.endsWith('\\') || state.musicFolder.endsWith('/') ? state.musicFolder : state.musicFolder + (state.musicFolder.includes('\\') ? '\\' : '/');

  const tracksSource = state.searchQuery ? filteredTracks() : state.tracks;

  for (const t of tracksSource) {
    let rel = t.path.replace(base, '');
    const parts = rel.split(/[\\\/]/);
    parts.pop(); // Remove filename

    let cur = root;
    let curPath = base.slice(0, -1);
    for (const p of parts) {
      curPath += (curPath.includes('\\') ? '\\' : '/') + p;
      if (!cur.children[p]) cur.children[p] = { name: p, children: {}, path: curPath };
      cur = cur.children[p];
    }
  }
  return root;
}

function renderFolderTree() {
  const tree = buildFolderTree();
  const container = $('folder-tree');
  container.innerHTML = '';

  function createNode(node, depth) {
    const keys = Object.keys(node.children).sort();
    // if (depth > 0 && keys.length === 0) return null; // Only show folders -- user wants to see all folders with tracks

    const el = document.createElement('div');
    el.className = 'tree-item';

    if (depth > 0) {
      const header = document.createElement('div');
      header.className = 'tree-header';
      header.dataset.path = node.path;

      const hasChildren = keys.length > 0;

      header.innerHTML = `
        <span class="toggle-icon ${hasChildren ? '' : 'hidden'}">
          <svg width="8" height="8" viewBox="0 0 8 8" fill="currentColor"><path d="M0 0l4 4-4 4z"/></svg>
        </span>
        <span class="folder-name">${esc(node.name)}</span>
        `;
      // <span class="folder-icon">
      //   <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor"><path d="M1 3a1 1 0 0 1 1-1h3.586l1.414 1.414H12a1 1 0 0 1 1 1V11a1 1 0 0 1-1 1H2a1 1 0 0 1-1-1V3z"/></svg>
      // </span>

      header.addEventListener('click', (e) => {
        e.stopPropagation();
        const children = el.querySelector('.tree-children');
        const icon = header.querySelector('.toggle-icon');

        if (hasChildren) {
          children.classList.toggle('visible');
          icon.classList.toggle('expanded');
        }

        state.currentFolder = node.path;
        document.querySelectorAll('.tree-header').forEach(h => h.classList.remove('active'));
        header.classList.add('active');
        document.querySelectorAll('.grid-switch').forEach(b => b.classList.remove('active'));

        // Show filtered album grid
        renderAlbumGrid();
        updateLibraryStats();
      });

      el.appendChild(header);
    }

    if (keys.length > 0) {
      const children = document.createElement('div');
      children.className = 'tree-children';
      if (state.searchQuery) children.classList.add('visible'); // Auto-expand when searching
      for (const k of keys) {
        const childEl = createNode(node.children[k], depth + 1);
        if (childEl) children.appendChild(childEl);
      }
      el.appendChild(children);
      if (depth === 0) children.classList.add('visible'); // Root children always visible
    }

    // Auto-expand toggle icon when searching
    if (state.searchQuery && depth > 0 && keys.length > 0) {
        const icon = el.querySelector('.toggle-icon');
        if (icon) icon.classList.add('expanded');
    }

    return el;
  }

  container.appendChild(createNode(tree, 0));
  updateHighlights();
}

// ── Playback ───────────────────────────────────────────────
async function playTrack(t) {
  state.currentTrack = t;
  state.isPlaying = true;
  const audio = $('audio-engine');
  audio.src = await window.electronAPI.getAudioUrl(t.path);
  safePlay();
  updatePlayerUI(t);
  updateHighlights();
}

/**
 * Safely starts playback, handling cases where src might be missing or invalid.
 */
async function safePlay(retryCount = 0) {
  if (!audio.src || audio.src === 'null' || audio.src === location.href || state.isSaving) return;

  try {
    const playPromise = audio.play();
    if (playPromise !== undefined) {
      await playPromise;
    }
    state.isPlaying = true;
    updatePlayPause();
  } catch (error) {
    if (retryCount < 10) {
      console.log(`Playback retry ${retryCount + 1}: ${error.message}`);
      const delay = Math.min(1000, 100 * Math.pow(2, retryCount)); // Exponential backoff
      setTimeout(() => safePlay(retryCount + 1), delay);
    } else {
      console.error('Max playback retries reached:', error);
      state.isPlaying = false;
      updatePlayPause();
    }
  }
}

function playAlbum(key) {
  const a = state.albums[key];
  if (!a || !a.tracks.length) return;
  state.queue = a.tracks.map(t => t.path);
  state.queueIndex = 0;
  playTrack(a.tracks[0]);
}

function updatePlayerUI(t) {
  $('now-playing-title').textContent = t.title;
  $('now-playing-artist').textContent = t.artist;
  const art = $('now-playing-art');
  art.innerHTML = '';
  art.appendChild(artEl(t.coverArt));
  $('audio-quality').textContent = qbadge(t) || (t.path.toLowerCase().endsWith('.flac') ? 'FLAC' : 'MP3');
  updatePlayPause();
}

function updatePlayPause() {
  const showLoading = isBuffering || state.isSaving;
  $('icon-play').style.display = (state.isPlaying || showLoading) ? 'none' : 'block';
  $('icon-pause').style.display = (state.isPlaying && !showLoading) ? 'block' : 'none';
  if ($('icon-buffer')) $('icon-buffer').style.display = showLoading ? 'block' : 'none';
}

function updateHighlights() {
  document.querySelectorAll('.album-card').forEach(c => {
    c.classList.toggle('now-playing', state.currentTrack && albumKey(state.currentTrack) === c.dataset.key);
  });
  document.querySelectorAll('tr[data-path]').forEach(tr => {
    tr.classList.toggle('now-playing', tr.dataset.path === state.currentTrack?.path);
  });

  // Tree view highlighting
  document.querySelectorAll('.tree-header').forEach(h => h.classList.remove('now-playing'));
  if (state.currentTrack) {
    const trackPath = state.currentTrack.path;
    const folderPath = trackPath.substring(0, Math.max(trackPath.lastIndexOf('\\'), trackPath.lastIndexOf('/')));
    const activeHeader = document.querySelector(`.tree-header[data-path="${folderPath.replace(/\\/g, '\\\\')}"]`);
    if (activeHeader) activeHeader.classList.add('now-playing');
  }
}

function expandTreeToPath(path) {
  const headers = document.querySelectorAll('.tree-header');
  let targetHeader = null;
  for (const h of headers) {
    if (h.dataset.path === path) {
      targetHeader = h;
      break;
    }
  }

  if (targetHeader) {
    let cur = targetHeader.closest('.tree-item');
    while (cur) {
      const children = cur.querySelector('.tree-children');
      const header = cur.querySelector('.tree-header');
      if (children) children.classList.add('visible');
      if (header) {
        const icon = header.querySelector('.toggle-icon');
        if (icon) icon.classList.add('expanded');
      }
      cur = cur.parentElement.closest('.tree-item');
    }
    targetHeader.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
}

function playNext() {
  if (!state.queue.length) return;
  state.queueIndex = (state.queueIndex + 1) % state.queue.length;
  const t = state.tracks.find(x => x.path === state.queue[state.queueIndex]);
  if (t) playTrack(t);
}

function playPrev() {
  const audio = $('audio-engine');
  if (!state.queue.length) return;
  if (audio.currentTime > 3) { audio.currentTime = 0; return; }
  state.queueIndex = (state.queueIndex - 1 + state.queue.length) % state.queue.length;
  const t = state.tracks.find(x => x.path === state.queue[state.queueIndex]);
  if (t) playTrack(t);
}

// ── Audio events ───────────────────────────────────────────
const audio = $('audio-engine');
let isSeeking = false, wasPlaying = false, isBuffering = false;

audio.addEventListener('timeupdate', () => {
  if (isSeeking) return;
  const { currentTime: c, duration: d } = audio;
  if (!d) return;
  const p = c / d;
  $('progress-fill').style.width = (p * 100) + '%';
  $('progress-thumb').style.left = (p * 100) + '%';
  $('time-current').textContent = fmt(c);
  $('time-total').textContent = fmt(d);
});
audio.addEventListener('waiting', () => { isBuffering = true; updatePlayPause(); });
audio.addEventListener('playing', () => { isBuffering = false; state.isPlaying = true; updatePlayPause(); });
audio.addEventListener('canplay', () => { isBuffering = false; updatePlayPause(); });
audio.addEventListener('ended', () => { state.isPlaying = false; updatePlayPause(); playNext(); });
audio.addEventListener('error', () => {
  const err = audio.error;
  const path = state.currentTrack ? state.currentTrack.path : 'unknown';

  // If we intentionally cleared src to free the file lock, ignore this error
  if (!audio.src || audio.src === 'null' || audio.src === location.href) {
    console.log('Ignored audio error (likely intentional src clear)');
    return;
  }

  console.error(`Audio Error [${path}]:`, err?.code, err?.message);

  isBuffering = false;
  state.isPlaying = false;
  updatePlayPause();

  // If we were supposed to be playing, try to skip to next track after a short delay
  if (state.currentTrack) {
    setTimeout(() => {
      console.log(`Skipping track due to error: ${path}`);
      playNext();
    }, 1000);
  }
});

audio.addEventListener('play', () => { state.isPlaying = true; updatePlayPause(); });
audio.addEventListener('pause', () => { state.isPlaying = false; updatePlayPause(); });

const pb = $('progress-bar');
function getPct(e) { const r = pb.getBoundingClientRect(); return Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)); }
function setUI(p) {
  $('progress-fill').style.width = (p * 100) + '%';
  $('progress-thumb').style.left = (p * 100) + '%';
  if (audio.duration) $('time-current').textContent = fmt(p * audio.duration);
}
pb.addEventListener('mousedown', e => {
  if (!audio.duration) return;
  isSeeking = true; wasPlaying = !audio.paused; audio.pause();
  const p = getPct(e); setUI(p); audio.currentTime = p * audio.duration;
});
document.addEventListener('mousemove', e => { if (!isSeeking) return; setUI(getPct(e)); });
document.addEventListener('mouseup', e => {
  if (!isSeeking) return;
  const p = getPct(e); setUI(p);
  if (audio.duration) audio.currentTime = p * audio.duration;
  if (wasPlaying) audio.play().catch(console.error);
  isSeeking = false;
});

$('btn-play').addEventListener('click', () => {
  if (!state.currentTrack || state.isSaving) return;
  audio.paused ? safePlay() : audio.pause();
});
$('btn-next').addEventListener('click', playNext);
$('btn-prev').addEventListener('click', playPrev);
$('volume-slider').addEventListener('input', e => { audio.volume = parseFloat(e.target.value); });

$('now-playing-art').addEventListener('click', () => {
  if (!state.currentTrack) return;
  
  // Detect which collection the playing track belongs to
  const targetType = state.currentTrack.path.toLowerCase().endsWith('.flac') ? 'flac' : 'mp3';
  
  // Switch collection if necessary
  if (state.activeCollection !== targetType) {
    switchCollection(targetType);
  }

  const ak = albumKey(state.currentTrack);
  state.currentFolder = null; // Reset folder filter
  updateLibraryStats();
  document.querySelectorAll('.tree-header').forEach(h => h.classList.remove('active'));
  if (state.currentView !== 'albums') {
    document.querySelector('.grid-switch[data-view="albums"]').click();
  } else {
    renderAlbumGrid(); // Re-render if already in albums view
  }
  // Tree view handling
  const trackPath = state.currentTrack.path;
  const folderPath = trackPath.substring(0, Math.max(trackPath.lastIndexOf('\\'), trackPath.lastIndexOf('/')));
  expandTreeToPath(folderPath);

  // Restore right pane and card selection
  openAlbum(ak);
  const card = document.querySelector(`.album-card[data-key="${ak}"]`);
  if (card) {
    document.querySelectorAll('.album-card').forEach(c => c.classList.remove('selected'));
    card.classList.add('selected');
    card.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
});


// ── Window Controls ──────────────────────────────────────────
document.getElementById('minimize-btn').addEventListener('click', () => window.electronAPI.minimizeWindow());
document.getElementById('maximize-btn').addEventListener('click', () => window.electronAPI.maximizeWindow());
document.getElementById('close-btn').addEventListener('click', () => window.electronAPI.closeWindow());

// ── Nav ────────────────────────────────────────────────────
document.querySelectorAll('.grid-switch').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.grid-switch').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    state.currentFolder = null; // Reset folder filter
    state.searchQuery = ''; // Clear search query
    $('search-input').value = ''; // Clear search input UI
    updateLibraryStats();
    if (!state.tracks.length) return;
    if (btn.dataset.view === 'albums') renderAlbumGrid();
    if (btn.dataset.view === 'tracks') renderTrackList();
    renderFolderTree(); // Refresh tree view to show full library
  });
  btn.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      btn.click();
    }
  });
});

// ── Search & Sort ──────────────────────────────────────────
$('search-input').addEventListener('input', e => {
  state.searchQuery = e.target.value;
  if (state.currentView === 'albums') renderAlbumGrid();
  else renderTrackList();
  renderFolderTree();
  updateLibraryStats();
});

$('sort-select').addEventListener('change', e => {
  state.sortBy = e.target.value;
  if (state.currentView === 'albums') renderAlbumGrid();
  else renderTrackList();
});

// ── Library Switcher ──────────────────────────────────────
function switchCollection(type) {
  // Save current navigation state to the outgoing collection
  const oldType = state.activeCollection;
  state.collections[oldType].currentFolder = state.currentFolder;
  state.collections[oldType].folder = state.musicFolder;

  // Restore state from the incoming collection
  state.activeCollection = type;
  const col = state.collections[type];
  state.tracks = col.tracks || [];
  state.albums = col.albums || {};
  state.musicFolder = col.folder;
  state.currentFolder = col.currentFolder;
  
  document.documentElement.setAttribute('data-collection', type);
  
  document.querySelectorAll('.switcher-btn, .library-switch__button').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.collection === type);
  });
  
  if (!state.tracks || !state.tracks.length) {
    showView('empty');
    if (state.musicFolder) {
       $('empty-state').querySelector('h2').textContent = `No ${type.toUpperCase()} files found`;
       $('empty-state').querySelector('p').textContent = `The folder "${state.musicFolder}" doesn't seem to contain any ${type.toUpperCase()} tracks.`;
    } else {
       $('empty-state').querySelector('h2').textContent = `No ${type.toUpperCase()} Library`;
       $('empty-state').querySelector('p').textContent = `Please select a folder for your ${type.toUpperCase()} collection.`;
    }
  } else {
    renderAlbumGrid();
  }
  renderFolderTree();
  updateLibraryStats();
}

function updateLibraryStats() {
  const albumsCount = Object.keys(filteredAlbums()).length;
  const tracksCount = filteredTracks().length;
  $('lib-albums').innerHTML = `${albumsCount}`;
  $('lib-tracks').innerHTML = `${tracksCount}`;

  // Toggle visibility of library-back
  const libBack = $('library-back');
  if (libBack) {
    const isFiltered = state.searchQuery || state.currentFolder;
    libBack.style.display = isFiltered ? 'block' : 'none';
  }
}

document.querySelectorAll('.switcher-btn, .library-switch__button').forEach(btn => {
  btn.addEventListener('click', () => {
    if (btn.dataset.collection === state.activeCollection) return;
    switchCollection(btn.dataset.collection);
  });
  btn.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      btn.click();
    }
  });
});

// ── Library ────────────────────────────────────────────────
async function openLibrary() {
  const folder = await window.electronAPI.changeFolder(state.activeCollection);
  if (folder) runLibraryScan(folder);
}


$('open-folder-btn').addEventListener('click', async () => {
  const folder = await window.electronAPI.changeFolder(state.activeCollection);
  if (folder) runLibraryScan(folder, true);
});
$('open-folder-btn').addEventListener('keydown', e => {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    $('open-folder-btn').click();
  }
});
$('refresh-library-btn').addEventListener('click', async () => {
  if (state.musicFolder) {
    runLibraryScan(state.musicFolder, true);
  }
});
$('refresh-library-btn').addEventListener('keydown', e => {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    $('refresh-library-btn').click();
  }
});
$('empty-open-btn').addEventListener('click', async () => {
  const folder = await window.electronAPI.changeFolder(state.activeCollection);
  if (folder) runLibraryScan(folder, true);
});

async function init() {
  showView('loading');
  $('loading-text').textContent = 'Initializing...';
  
  const flacFolder = await window.electronAPI.openFolder('flac');
  if (flacFolder) {
    await runLibraryScan(flacFolder, false, 'flac');
  }
  
  const mp3Folder = await window.electronAPI.openFolder('mp3');
  if (mp3Folder) {
    await runLibraryScan(mp3Folder, false, 'mp3');
  }

  // Finalize initial view
  switchCollection(state.activeCollection);
}

async function runLibraryScan(folder, force = false, targetType = state.activeCollection) {
  try {
    // If scanning for the visible collection, show loading
    if (targetType === state.activeCollection) {
       state.musicFolder = folder;
       showView('loading');
       $('loading-text').textContent = `Scanning for ${targetType.toUpperCase()} files…`;
    }

    const result = await window.electronAPI.scanFolder(folder);
    if (!result || typeof result !== 'object') {
       throw new Error('Invalid scan result from system');
    }

    const files = targetType === 'flac' ? (result.flacFiles || []) : (result.mp3Files || []);
    
    if (files.length === 0) {
      state.collections[targetType] = { tracks: [], albums: {}, folder: folder, currentFolder: null };
      if (targetType === state.activeCollection) showView('empty');
      return;
    }

    if (targetType === state.activeCollection) {
      $('loading-text').textContent = `Loading ${targetType.toUpperCase()}...`;
    }
    
    const cached = force ? null : await window.electronAPI.loadLibraryCache(folder, targetType);
    
    if (cached && cached.length === files.length && cached[0] && cached[0].__v >= 9) {
      state.collections[targetType].tracks = cached;
    } else {
      const tracks = [];
      const BATCH = 50;
      for (let i = 0; i < files.length; i += BATCH) {
        const chunk = files.slice(i, i + BATCH);
        const parsed = await window.electronAPI.parseMetadata(chunk, { skipCovers: true });
        tracks.push(...parsed);
        if (targetType === state.activeCollection) {
          $('loading-text').textContent = `Parsing ${targetType.toUpperCase()}… ${Math.round(((i + chunk.length) / files.length) * 100)}%`;
        }
      }
      state.collections[targetType].tracks = tracks;
    }
    
    // Group albums for this collection
    const originalTracks = state.tracks;
    state.tracks = state.collections[targetType].tracks;
    groupAlbums();
    state.collections[targetType].albums = JSON.parse(JSON.stringify(state.albums));
    state.collections[targetType].folder = folder;
    
    // Restore state
    if (targetType === state.activeCollection) {
       switchCollection(targetType);
    } else {
       state.tracks = originalTracks;
       groupAlbums(); // Restore current view grouping
    }

    // Cover Harvest (Background)
    const col = state.collections[targetType];
    const originalVisibleTracks = state.tracks;
    
    state.tracks = col.tracks;
    groupAlbums();
    await harvestCovers(folder);
    col.tracks = state.tracks;
    col.albums = JSON.parse(JSON.stringify(state.albums));
    await window.electronAPI.saveLibraryCache(folder, col.tracks, targetType);
    
    if (targetType === state.activeCollection) {
      switchCollection(targetType);
    } else {
      state.tracks = originalVisibleTracks;
      groupAlbums();
    }

  } catch (err) {
    console.error(`[App] ${targetType} scan failed:`, err);
    if (targetType === state.activeCollection) {
      alert(`${targetType.toUpperCase()} Library Scan Failed: ` + err.message);
      showView('empty');
    }
  }
}



async function harvestCovers(rootFolder) {
  const folders = new Map();
  state.tracks.forEach(t => {
    const dir = t.path.substring(0, Math.max(t.path.lastIndexOf('\\'), t.path.lastIndexOf('/')));
    if (!folders.has(dir)) folders.set(dir, []);
    folders.get(dir).push(t);
  });

  const folderList = Array.from(folders.keys());
  const BATCH_SIZE = 12; // Process 12 folders in a single IPC call
  console.log(`[App] Harvesting covers for ${folderList.length} unique folders (Batch Size: ${BATCH_SIZE})`);

  for (let i = 0; i < folderList.length; i += BATCH_SIZE) {
    const batch = folderList.slice(i, i + BATCH_SIZE);
    $('loading-text').textContent = `Harvesting Covers… ${Math.round(((i + batch.length) / folderList.length) * 100)}%`;

    try {
      const pathsToScan = batch.map(dir => folders.get(dir)[0].path);
      const results = await window.electronAPI.parseMetadata(pathsToScan, { skipCovers: false });

      let foundCovers = 0;
      results.forEach((res, idx) => {
        if (res && res.coverArt) {
          const dir = batch[idx];
          const tracksInDir = folders.get(dir);
          tracksInDir.forEach(t => t.coverArt = res.coverArt);
          foundCovers++;
        }
      });
      console.log(`[App] Cover Batch Complete: ${foundCovers}/${batch.length} covers found (Current progress: ${Math.round(((i + batch.length) / folderList.length) * 100)}%)`);
    } catch (e) { console.error('Batch cover harvest failed', e); }

    // Update UI every batch
    groupAlbums();
    renderAlbumGrid();
  }
}

// Theme Sidebar Logic
const themeToggle = $('theme-toggle');
const themeSidebar = $('theme-sidebar');
const themeClose = $('theme-sidebar-close');
const themeOptions = document.querySelectorAll('.theme-sidebar__option');

function setTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('theme', theme);
  
  // Update active state in UI
  themeOptions.forEach(opt => {
    opt.classList.toggle('active', opt.dataset.theme === theme);
  });
}

if (themeToggle) {
  themeToggle.addEventListener('click', () => {
    const isVisible = themeSidebar.classList.toggle('visible');
    themeToggle.classList.toggle('active', isVisible);
  });
}

if (themeClose) {
  themeClose.addEventListener('click', () => {
    themeSidebar.classList.remove('visible');
    themeToggle.classList.remove('active');
  });
}

themeOptions.forEach(opt => {
  opt.addEventListener('click', () => {
    setTheme(opt.dataset.theme);
    // Optional: close sidebar after selection on smaller screens
    // themeSidebar.classList.remove('visible');
  });
});

// Load saved theme
const savedTheme = localStorage.getItem('theme') || 'orange';
setTheme(savedTheme);

init(); // Start the app