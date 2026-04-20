const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const mm = require('music-metadata');
const Metaflac = require('metaflac-js');
const FastFlac = require('./FastFlac');

app.commandLine.appendSwitch('overlay-scrollbars');

// Redirect userData to a 'data' folder next to the EXE if running in portable mode
// PORTABLE_EXECUTABLE_DIR is set by electron-builder's portable wrapper
if (process.env.PORTABLE_EXECUTABLE_DIR) {
  const portableDataPath = path.join(process.env.PORTABLE_EXECUTABLE_DIR, 'data');
  if (!fs.existsSync(portableDataPath)) {
    fs.mkdirSync(portableDataPath, { recursive: true });
  }
  app.setPath('userData', portableDataPath);
}

const settingsPath = path.join(app.getPath('userData'), 'settings.json');

let mainWindow;
// Cache: hash of cover data -> temp file path
const artCache = new Map();

// Only load electron-reload in development mode
if (!app.isPackaged) {
  require('electron-reload')(path.join(__dirname, '..'), {
    electron: require('electron'),
    awaitWriteFinish: true
  });
}

function loadSettings() {
  const defaults = { musicFolder_flac: null, musicFolder_mp3: null, musicFolder: null };
  if (fs.existsSync(settingsPath)) {
    try {
      const saved = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
      if (saved.musicFolder && !saved.musicFolder_flac) saved.musicFolder_flac = saved.musicFolder;
      return { ...defaults, ...saved };
    } catch (e) { return defaults; }
  }
  return defaults;
}

function saveSettings(settings) {
  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
}

function artTempPath(hash, ext) {
  return path.join(os.tmpdir(), `flacplayer_art_${hash}.${ext}`);
}

function saveCoverArt(picData, format) {
  const ext = format.replace('image/', '').replace('jpeg', 'jpg') || 'jpg';
  const hash = crypto.createHash('md5').update(picData).digest('hex');
  if (artCache.has(hash)) return artCache.get(hash);
  const filePath = artTempPath(hash, ext);
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, picData);
  }
  const url = 'file:///' + filePath.replace(/\\/g, '/').split('/').map(seg => encodeURIComponent(seg)).join('/');
  artCache.set(hash, url);
  return url;
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 2000, height: 900,
    icon: path.join(__dirname, 'assets', 'icon.png'),
    minWidth: 900, minHeight: 600,
    backgroundColor: '#111111',
    frame: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: false,
    },
  });
  mainWindow.loadFile(path.join(__dirname, 'index.html'));
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  for (const url of artCache.values()) {
    try {
      const filePath = url.replace('file:///', '').replace(/\//g, path.sep);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    } catch (e) { }
  }
  if (process.platform !== 'darwin') app.quit();
});

// IPC: Open folder dialog
ipcMain.handle('open-folder', async (event, collection) => {
  const settings = loadSettings();
  const currentPath = collection === 'mp3' ? settings.musicFolder_mp3 : settings.musicFolder_flac;
  if (currentPath && fs.existsSync(currentPath)) return currentPath;
  return null;
});

ipcMain.handle('change-folder', async (event, collection) => {
  const result = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory'] });
  if (result.canceled) return null;
  const settings = loadSettings();
  const chosen = result.filePaths[0];
  if (collection === 'mp3') settings.musicFolder_mp3 = chosen;
  else settings.musicFolder_flac = chosen;
  saveSettings(settings);
  return chosen;
});


// IPC: Scan folder for FLAC and MP3 files recursively
ipcMain.handle('scan-folder', async (event, folderPath) => {
  const flacFiles = [];
  const mp3Files = [];
  function walk(dir) {
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) { walk(fullPath); }
        else if (entry.isFile()) {
          const lower = entry.name.toLowerCase();
          if (lower.endsWith('.flac')) { flacFiles.push(fullPath); }
          else if (lower.endsWith('.mp3')) { mp3Files.push(fullPath); }
        }
      }
    } catch (e) { }
  }
  walk(folderPath);
  return { flacFiles, mp3Files };
});

// Global Metadata Queue to prevent I/O saturation (especially on network drives)
const metadataQueue = [];
let isProcessingQueue = false;

async function processMetadataQueue() {
  if (isProcessingQueue) return;
  isProcessingQueue = true;
  
  const CONCURRENCY = 4;
  const workers = Array(CONCURRENCY).fill(null).map(async () => {
    while (metadataQueue.length > 0) {
      const task = metadataQueue.shift();
      if (!task) continue;
      try {
        const result = await task.processFunc(task.filePath);
        task.resolve(result);
      } catch (e) {
        task.reject(e);
      }
    }
  });
  
  await Promise.all(workers);
  isProcessingQueue = false;
  // If more tasks were added while we were finishing, restart
  if (metadataQueue.length > 0) processMetadataQueue();
}

// IPC: Parse metadata for a batch of files
ipcMain.handle('parse-metadata', async (event, filePaths, options = {}) => {
  const skipCovers = options.skipCovers === true;
  
  const processFile = async (filePath) => {
    try {
      if (skipCovers && filePath.toLowerCase().endsWith('.flac')) {
        const ff = FastFlac.readMetadata(filePath);
        if (ff) return { ...ff, __v: 9 };
      }
      const metadata = await mm.parseFile(filePath, { skipCovers });
      const { common, format } = metadata;
      let coverArt = null;
      if (!skipCovers && common.picture && common.picture.length > 0) {
        const pic = common.picture[0];
        let mime = pic.format || 'image/jpeg';
        if (!mime.startsWith('image/')) mime = 'image/' + mime;
        try { coverArt = saveCoverArt(pic.data, mime); } catch (e) { }
      }
      let rating = 0;
      const vorbis = (metadata.native && (metadata.native.VORBIS || metadata.native.vorbis)) || [];
      const id3 = (metadata.native && (metadata.native.ID3v2 || metadata.native.id3v2)) || [];
      const rTag = vorbis.find(t => t.id.toUpperCase() === 'RATING') || vorbis.find(t => t.id.toLowerCase() === 'rating');
      const popm = id3.find(t => t.id.toUpperCase() === 'POPM' || t.id.toUpperCase() === 'POP');
      if (rTag) {
        const val = parseInt(rTag.value, 10);
        if (!isNaN(val)) {
          if (val <= 5) rating = val;
          else if (val <= 100) rating = Math.round(val / 20);
        }
      } else if (popm && popm.value && popm.value.rating !== undefined) {
        const val = parseInt(popm.value.rating, 10);
        if (!isNaN(val) && val > 0) {
          rating = Math.round(val / 51);
          if (rating < 1) rating = 1; if (rating > 5) rating = 5;
        }
      }
      if (!rating && common.rating && common.rating.length > 0) {
        const r = common.rating[0].rating;
        if (r <= 1) rating = Math.round(r * 5);
        else if (r <= 5) rating = Math.round(r);
        else if (r <= 100) rating = Math.round(r / 20);
      }
      return {
        path: filePath,
        title: common.title || path.basename(filePath, path.extname(filePath)),
        artist: common.artist || common.albumartist || 'Unknown Artist',
        albumArtist: common.albumartist || common.artist || 'Unknown Artist',
        album: common.album || 'Unknown Album',
        year: common.year || null,
        trackNo: common.track?.no || 0,
        discNo: common.disk?.no || 1,
        duration: format.duration || 0,
        sampleRate: format.sampleRate || null,
        bitDepth: format.bitsPerSample || null,
        bitrate: format.bitrate || null,
        rating, coverArt, __v: 9,
      };
    } catch (e) {
      return {
        path: filePath, title: path.basename(filePath, path.extname(filePath)), artist: 'Unknown Artist', album: 'Unknown Album',
        duration: 0, sampleRate: null, bitDepth: null, bitrate: null,
        rating: 0, coverArt: null, __v: 9
      };
    }
  };

  const promises = filePaths.map(filePath => {
    return new Promise((resolve, reject) => {
      metadataQueue.push({ filePath, resolve, reject, processFunc: processFile });
    });
  });

  processMetadataQueue();
  return Promise.all(promises);
});

ipcMain.handle('load-library-cache', async (event, folderPath, collection) => {
  const suffix = collection ? `-${collection}` : '';
  const cachePath = path.join(app.getPath('userData'), crypto.createHash('md5').update(folderPath).digest('hex') + suffix + '-library.json');
  if (fs.existsSync(cachePath)) { try { return JSON.parse(fs.readFileSync(cachePath, 'utf8')); } catch (e) { return null; } }
  return null;
});

ipcMain.handle('save-library-cache', async (event, folderPath, tracks, collection) => {
  const suffix = collection ? `-${collection}` : '';
  const cachePath = path.join(app.getPath('userData'), crypto.createHash('md5').update(folderPath).digest('hex') + suffix + '-library.json');
  await fs.promises.writeFile(cachePath, JSON.stringify(tracks));
});


// Save rating to FLAC tags (Optimized in-place write, with non-ASCII path + ID3 fallback)
const { Worker } = require('worker_threads');

ipcMain.handle('set-rating', (event, filePath, ratingValue) => {
  const clampedRating = Math.max(0, Math.min(5, Math.round(ratingValue)));
  console.log(`[Main] set-rating request for ${filePath} (Value: ${clampedRating})`);

  return new Promise((resolve) => {
    const worker = new Worker(path.join(__dirname, 'ratingWorker.js'), {
      workerData: { filePath, clampedRating }
    });

    worker.on('message', (result) => {
      if (result.success) {
        console.log(`[Main] Rating update complete (${result.path} path)!`);
        resolve(true);
      } else {
        console.error(`[Main] Rating update failed:`, result.error);
        resolve(false);
      }
    });

    worker.on('error', (e) => {
      console.error(`[Main] Worker error:`, e.message);
      resolve(false);
    });
  });
});

ipcMain.handle('get-audio-url', async (event, filePath) => {
  const normalized = filePath.replace(/\\/g, '/');
  return 'file:///' + normalized.split('/').map(encodeURIComponent).join('/');
});

ipcMain.handle('update-title-bar-overlay', async (event, options) => {
  mainWindow.setTitleBarOverlay(options);
});

ipcMain.handle('minimize-window', () => mainWindow.minimize());
ipcMain.handle('maximize-window', () => {
  if (mainWindow.isMaximized()) {
    mainWindow.unmaximize();
  } else {
    mainWindow.maximize();
  }
});
ipcMain.handle('close-window', () => mainWindow.close());