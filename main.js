// Jelly's shell: serves the patched Jelly Baby build into a frameless,
// transparent, always-on-top window that clicks through everywhere except the jelly.
const { app, BrowserWindow, ipcMain, screen, globalShortcut, nativeImage, powerMonitor, Menu, shell, Tray, dialog } = require('electron');
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { execFile } = require('child_process');
const screenshots = require('./screenshots');
const downloads = require('./downloads');
const i18n = require('./i18n');

// JELLY_APP serves another build instead, to try a rebuild without replacing app/.
const ROOT = process.env.JELLY_APP ? path.resolve(process.env.JELLY_APP) : path.join(__dirname, 'app');

// What a swallowed file looks like.
//
// Electron's own app.getFileIcon and nativeImage.createThumbnailFromPath both
// wedge the main process solid here: not a rejection, a hang, with the timer
// queue frozen behind them, so the pet stops moving. QuickLook's own command
// line tool is a separate process that can be given a deadline and killed, and
// what it returns is better anyway: the first slide of a deck, the picture
// itself for a picture, rather than one generic icon for the whole file type.
// It hangs on directories, so those never reach it.
const THUMBS = fs.mkdtempSync(path.join(os.tmpdir(), 'jelly-shelf-'));
// HEIC and TIFF being edited, as PNG. Apart from THUMBS, which /thumbs/ serves
// without a token.
const EDITS = fs.mkdtempSync(path.join(os.tmpdir(), 'jelly-edit-'));
/** macOS refuses a drag with no icon, and a folder has no preview to offer. */
const BLANK_CARD = path.join(__dirname, 'carry-icon.png');
let thumbCount = 0;

// What a card says on it, and what colour it says it in. The kinds are what a
// person would call the thing, not the extension: a .key and a .pptx are both
// a deck, and both should look like one inside her.
const KINDS = {
  IMAGE: 'png jpg jpeg gif heic webp tiff bmp svg avif',
  DOC: 'pdf doc docx pages txt md rtf epub',
  SHEET: 'xls xlsx numbers csv tsv',
  DECK: 'ppt pptx key',
  VIDEO: 'mp4 mov avi mkv webm m4v',
  SOUND: 'mp3 wav aac flac m4a aiff',
  CODE: 'js ts jsx tsx py go rs rb java c h cpp swift json html css sh yml yaml toml',
};

const describe = file => {
  const name = path.basename(file), dot = name.lastIndexOf('.');
  try { if (fs.statSync(file).isDirectory()) return { label: 'FOLDER', kind: 'FOLDER' }; }
  catch { return { label: '?', kind: 'FILE' }; }
  const suffix = dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
  const kind = Object.keys(KINDS).find(name => KINDS[name].split(' ').includes(suffix)) ?? 'FILE';
  return { label: (suffix || name).slice(0, 5).toUpperCase(), kind };
};

// The preview is kept on disk as well as sent to the page, because handing a
// file back out is a native drag and a native drag needs an icon from a file.
const thumbnail = file => new Promise(resolve => {
  let folder;
  try {
    if (!fs.statSync(file).isFile()) return resolve(null);
    folder = path.join(THUMBS, String(thumbCount++));
    fs.mkdirSync(folder);
  } catch { return resolve(null); }
  // 512 so a screenshot is legible in the tray. Her belly cards and the drag
  // icon are scaled down from it; createFromPath only decodes a PNG, and does
  // not wedge the way the thumbnail calls above do.
  execFile('qlmanage', ['-t', '-s', '512', '-o', folder, file],
    { timeout: 5000, killSignal: 'SIGKILL' }, () => {
      try {
        const made = fs.readdirSync(folder).find(name => name.endsWith('.png'));
        if (!made) return resolve(null);
        const picture = path.join(folder, made);
        const full = nativeImage.createFromPath(picture);
        if (full.isEmpty()) return resolve(null);
        resolve({
          icon: full.resize({ width: 256 }).toDataURL(),
          dragIcon: full.resize({ width: 128 }),
          thumb: '/thumbs/' + path.relative(THUMBS, picture).split(path.sep).map(encodeURIComponent).join('/'),
        });
      } catch { resolve(null); }  // no preview for this one; the type card stands
    });
});
// A screenshot handed out to an AI app costs tokens by its pixel area, and a
// Retina screenshot has twice the pixels in each direction that were on screen.
// So each one gets a copy at 1x (72 dpi, the size it looked), made in the
// background when it is caught so it is ready the moment a drag begins. The
// original is never changed. Claude counts ceil(w/28) x ceil(h/28) tokens, so a
// 3024x1964 screenshot is ~4,760 and its 1x copy 1512x982 is ~1,944.
const SHRINKABLE = /\.(png|jpe?g|heic|tiff?)$/i;
let smallCount = 0;
const shrinkCopy = file => new Promise(resolve => {
  if (!SHRINKABLE.test(file)) return resolve(null);
  execFile('sips', ['-g', 'pixelWidth', '-g', 'pixelHeight', '-g', 'dpiWidth', file], { timeout: 5000 }, (err, out) => {
    if (err) return resolve(null);
    const read = key => Number((out.match(new RegExp(key + ':\\s*([\\d.]+)')) || [])[1]);
    const width = read('pixelWidth'), height = read('pixelHeight'), dpi = read('dpiWidth') || 72;
    if (!width || dpi <= 72) return resolve(null);   // already 1x: hand out the original
    const folder = path.join(THUMBS, 'small-' + smallCount++);
    try { fs.mkdirSync(folder); } catch { return resolve(null); }
    const out1x = path.join(folder, path.basename(file));
    const w = Math.round(width * 72 / dpi), h = Math.round(height * 72 / dpi);
    execFile('sips', ['--resampleWidth', String(w), '-s', 'dpiWidth', '72', '-s', 'dpiHeight', '72', file, '--out', out1x],
      { timeout: 10000, killSignal: 'SIGKILL' }, error => resolve(error ? null : { path: out1x, width: w, height: h }));
  });
});

const TYPES = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.bin': 'application/octet-stream', '.exr': 'application/octet-stream',
};
// Two keys each, for filming from npm start. Any Electron accelerator works here.
const CUE_TOY = 'Alt+T';
const CUE_STACK = 'Alt+S';

// Web Audio otherwise waits for a click, which a click-through window rarely gets.
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

// Installed as Jelly.app there is no terminal, so what she says goes to a log
// file instead, started afresh each launch: ~/Library/Logs/jelly-desktop/
// jelly.log (Electron names its folders after package.json's name, not the product).
if (app.isPackaged) {
  const logs = app.getPath('logs');
  fs.mkdirSync(logs, { recursive: true });
  // Capped, so a run of weeks (Open at login) or an error repeating every frame
  // cannot fill the disk: past 2 MB it becomes jelly.old.log and starts again.
  const LOG = path.join(logs, 'jelly.log'), CAP = 2 * 1024 * 1024;
  let out = fs.createWriteStream(LOG, { flags: 'w' }), written = 0;
  console.log = (...parts) => {
    const line = new Date().toTimeString().slice(0, 8) + ' ' + parts.join(' ') + '\n';
    if ((written += Buffer.byteLength(line)) > CAP) {
      out.end();
      try { fs.renameSync(LOG, path.join(logs, 'jelly.old.log')); } catch {}
      out = fs.createWriteStream(LOG, { flags: 'w' });
      written = Buffer.byteLength(line);
    }
    out.write(line);
  };
}
// Set as soon as quitting starts. Her windows are destroyed while the timers
// below can still fire, and touching a destroyed window throws, which showed up
// as an error dialog on every Quit. Every timer checks this first.
let quitting = false;

// One of her at a time: a second launch just quits.
if (!app.requestSingleInstanceLock()) app.exit(0);

// The catcher. A window is only offered a dragged file if it was a drag
// destination when the drag began, and a click-through window never is. So a
// small window that is solid from birth rides over the pet: it takes the drops,
// and hands its mouse events back to the pet's own window so grabbing, poking
// and throwing still work.
const CATCHER_PAGE = `<!doctype html><meta charset="utf-8">
<style>html,body{margin:0;height:100%;overflow:hidden;background:transparent;cursor:default}</style>
<script>
  // Screen coordinates, not window ones. This window rides on her and is moved
  // sixteen times a second, so a position measured against it means nothing by
  // the time the shell reads its bounds to convert it: she jerks about instead
  // of following the cursor. Where the cursor is on the desk does not depend on
  // where this window happens to be.
  const send = (kind, event, extra) => window.pet?.caught?.(kind, {
    x: event.screenX, y: event.screenY,
    button: event.button ?? 0, buttons: event.buttons ?? 0, ...extra,
  });
  // The drop itself is handled in the preload, which is the only place that can
  // turn a dropped File into a path. These just keep macOS willing to drop here.
  for (const kind of ['dragenter','dragover','dragleave']) {
    addEventListener(kind, event => event.preventDefault(), true);
  }
  // A press on her always belongs to her: she is picked up and thrown. Files
  // come back out through the tray, where each one is flat and can be aimed at,
  // rather than from her belly, where a card is seen through a lens well away
  // from where it really is.
  // Only the left button picks her up: the shell passes every press on as a
  // left click, so a right-click would otherwise grab her. It opens her menu.
  for (const kind of ['pointerdown','pointermove','pointerup']) {
    addEventListener(kind, event => { if (kind === 'pointermove' || event.button === 0) send(kind, event); }, true);
  }
  addEventListener('contextmenu', event => { event.preventDefault(); window.pet?.menu?.(); }, true);
  // A double-click opens her tray. It is counted here rather than left to the
  // browser's dblclick: the first click is a poke, she jiggles, and this window
  // follows her, so it has moved by the second click and macOS no longer pairs
  // the two. Two presses close together in time and on screen are enough.
  // The tray opens on the second release, not the press: a real click also
  // activates this window, and opening any earlier lets that activation take
  // focus from the tray the moment it appears, which closes it.
  let lastPress = null, opening = false;
  addEventListener('pointerdown', event => {
    if (event.button !== 0) return;
    const now = performance.now();
    const twice = lastPress && now - lastPress.at < 450
      && Math.hypot(event.screenX - lastPress.x, event.screenY - lastPress.y) < 10;
    lastPress = twice ? null : { at: now, x: event.screenX, y: event.screenY };
    opening = !!twice;
  }, true);
  addEventListener('pointerup', () => {
    if (opening) window.pet?.openTray?.();
    opening = false;
  }, true);
  // Two fingers over her resize her: scrolling, or pinching, which Chromium
  // reports as a scroll with Ctrl held. Spreading or scrolling up makes her bigger.
  addEventListener('wheel', event => {
    event.preventDefault();
    window.pet?.zoom?.(event.deltaY, event.ctrlKey);
  }, { passive: false, capture: true });
</script>`;

// What she says, in the language picked once her settings are read.
let words = i18n.strings('en');
// Her strings, handed to a page of hers as it is served.
// Her own small pages (catcher, tray, edit) load nothing but themselves, their
// thumbnails and the picture being edited. The game's page is left without one:
// it is upstream's build.
const OWN_PAGE = {
  'Content-Type': 'text/html',
  'Content-Security-Policy': "default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; "
    + "img-src 'self' data: blob:; connect-src 'self'",
};
const withWords = html => html.replace('<meta charset="utf-8">',
  `<meta charset="utf-8"><script>window.jellyWords = ${JSON.stringify(words.table)};</script>`)
  .replace('<!doctype html>', `<!doctype html><html lang="${words.lang}">`);

// Her page's look: no room, no game controls, and a small loading pill in place
// of the game's own loading screen. It goes into the HTML as it is served, so it
// is there from the very first paint. Added after loading, the game's opaque beige
// loading screen had already been painted into her hidden window, and macOS showed
// that frame for an instant when the window appeared.
const petCss = () => `
    :root, body, #app { background: transparent !important; }
    .masthead, .actions, .desktop-hints, .touch-controls,
    .facility-hint, .facility-button { display: none !important; }
    /* The game's own loading screen (a title, a placeholder jelly, the step it
       is on) floated half-seen over whatever was on screen. A desktop pet wakes
       up quietly instead: one small pink pill near the bottom, with the step. */
    #loading { background: transparent !important; place-items: end center !important; padding-bottom: 14vh; }
    #loading .jelly-mark, #loading h2 { display: none !important; }
    #loading .loading-card {
      width: auto !important; max-width: 70vw; display: flex; align-items: center; gap: 10px;
      padding: 9px 16px 9px 13px; border-radius: 999px;
      background: linear-gradient(rgba(224, 132, 160, .94), rgba(196, 98, 128, .94));
      box-shadow: inset 0 1.5px 0 rgba(255, 255, 255, .5), 0 6px 16px rgba(150, 52, 84, .35);
    }
    #loading .loading-card::before {
      content: ''; flex: none; width: 8px; height: 8px; border-radius: 50%; background: #fff;
      animation: jelly-wake 1.1s ease-in-out infinite;
    }
    #loading #load-message {
      margin: 0; color: #fff; font: 600 12.5px/1.3 ui-rounded, -apple-system, system-ui, sans-serif;
      letter-spacing: .01em; text-align: left;
    }
    #loading:not(.failed) #load-message::before { content: '${words.t('wakingUp')} · '; opacity: .8; }
    /* The steps come from the game, in English only, so another language shows
       just the waking line. */
    ${words.lang === 'en' ? '' : `#loading:not(.failed) #load-message { font-size: 0 !important; }
    #loading:not(.failed) #load-message::before { content: '${words.t('wakingUp')}'; font-size: 12.5px; opacity: 1; }`}
    #loading #fatal, #loading #retry { display: none !important; }
    @keyframes jelly-wake { 0%, 100% { transform: scale(.6); opacity: .55 } 50% { transform: scale(1); opacity: 1 } }
  `;

const SERVABLE = new Map();   // token -> file, for /file/<token>

const server = http.createServer((req, res) => {
  // Only her own windows may ask. A web page in a browser could otherwise point
  // a name of its own at 127.0.0.1 (DNS rebinding) and read the thumbnails of
  // whatever she holds; such a request carries that name as its Host.
  if (req.headers.host !== `127.0.0.1:${server.address().port}`) { res.writeHead(403); res.end(); return; }
  let url;
  try { url = decodeURIComponent(req.url.split('?')[0]); } catch { url = null; }
  if (!url || url.includes('\0')) { res.writeHead(400); res.end(); return; }
  if (url === '/catcher.html') {
    res.writeHead(200, OWN_PAGE);
    res.end(CATCHER_PAGE);
    return;
  }
  if (url === '/edit.html') {
    res.writeHead(200, OWN_PAGE);
    res.end(withWords(fs.readFileSync(path.join(__dirname, 'edit.html'), 'utf8')));
    return;
  }
  // A file the shell has chosen to show (the picture being edited), by a
  // random token that lasts until the edit ends: the page can ask for that
  // file and no other.
  if (url.startsWith('/file/')) {
    const file = SERVABLE.get(url.slice('/file/'.length));
    if (!file) { res.writeHead(404); res.end(); return; }
    fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'Content-Type': ({ '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.heic': 'image/heic', '.tiff': 'image/tiff', '.tif': 'image/tiff' })[path.extname(file).toLowerCase()] || 'application/octet-stream' });
      res.end(data);
    });
    return;
  }
  if (url === '/tray.html') {
    res.writeHead(200, OWN_PAGE);
    res.end(withWords(fs.readFileSync(path.join(__dirname, 'tray.html'), 'utf8')));
    return;
  }
  if (url.startsWith('/thumbs/')) {
    const picture = path.join(THUMBS, url.slice('/thumbs/'.length));
    if (!picture.startsWith(THUMBS + path.sep)) { res.writeHead(403); res.end(); return; }
    fs.readFile(picture, (err, data) => {
      if (err) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'Content-Type': 'image/png' });
      res.end(data);
    });
    return;
  }
  if (url === '/') {
    fs.readFile(path.join(ROOT, 'index.html'), 'utf8', (err, html) => {
      if (err) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(html.replace('</head>', `<style>${petCss()}</style></head>`));
    });
    return;
  }
  const file = path.join(ROOT, url);
  if (!file.startsWith(ROOT + path.sep)) { res.writeHead(403); res.end(); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
});

app.whenReady().then(() => new Promise(r => server.listen(0, '127.0.0.1', r)).then(async () => {
  app.dock?.hide();
  // Every screen at once, as one floor. The page draws a canvas the size of the
  // whole desk, every display together, so walking off the side of the laptop
  // is walking onto whatever else is plugged in with nothing handed over.
  //
  // The window, though, is only ever one display's worth of that. macOS paints
  // a window on a single display whatever bounds it is given: a window spanning
  // two accepts the bounds, shows on one, and is invisible on the other, which
  // took a screen capture of each side to believe. So the window is kept on
  // whichever display she is on, hopping when she crosses, and the page slides
  // its canvas so the window shows its own slice of the floor. Nothing in the
  // scene moves at the seam; only the frame around it does.
  const span = () => {
    const all = screen.getAllDisplays();
    // The whole display, menu bar included: the desktop is the floor.
    const each = all.map(one => one.bounds);
    const left = Math.min(...each.map(one => one.x)), top = Math.min(...each.map(one => one.y));
    return {
      x: left, y: top,
      width: Math.max(...each.map(one => one.x + one.width)) - left,
      height: Math.max(...each.map(one => one.y + one.height)) - top,
      screens: each,
    };
  };
  let area = span();
  // The display the window is on. She starts wherever the floor's centre is.
  let shown = null;
  const displayAt = (x, y) => area.screens.find(one =>
    x >= one.x && x < one.x + one.width && y >= one.y && y < one.y + one.height) ?? null;
  const win = new BrowserWindow({
    width: 400,
    height: 300,
    x: area.x,
    y: area.y,
    show: false,
    transparent: true,
    frame: false,
    hasShadow: false,
    resizable: false,
    skipTaskbar: true,
    enableLargerThanScreen: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      backgroundThrottling: false,
    },
  });
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.setIgnoreMouseEvents(true, { forward: true });
  // Left out of screenshots and screen sharing, so a full-screen shot is of
  // the desktop rather than of her.
  win.setContentProtection(true);
  // Shown only once the page's own look is replaced; see after loadURL below.
  // Put the window on a display, and tell the page which slice of the desk that
  // window now shows. Desk pixels are the page's coordinates throughout, so the
  // slice is the display's offset from the desk's corner.
  // The window move and the canvas slide reach the page by different routes,
  // so for a few milliseconds after a hop an input event can be mapped against
  // the wrong slice and yank her a whole screen sideways. Moves are dropped
  // for that long. She is held still by the grab in the meantime.
  let hopped = 0;
  let away = 0;   // when she was first seen off the shown display, or 0
  const settle = display => {
    shown = display;
    hopped = Date.now();
    win.setBounds({ x: display.x, y: display.y, width: display.width, height: display.height });
    win.webContents.send('pet-view', {
      width: area.width, height: area.height, x: display.x - area.x, y: display.y - area.y,
    });
  };
  settle(displayAt(area.x + area.width / 2, area.y + area.height / 2) ?? area.screens[0]);

  // Displays that are not rectangles together leave gaps: two screens of
  // different heights, or offset from one another, and the floor covers a
  // strip that is on no screen at all. The page is told where the real ones
  // are, in desk pixels, so she never wanders into the void between them.
  const tellScreens = () => win.webContents.send('pet-screens', area.screens.map(one => ({
    x: one.x - area.x, y: one.y - area.y, width: one.width, height: one.height,
  })));
  // macOS reports a display change for things that do not move a screen, like
  // the Dock or menu bar sliding in, and reports it again and again. Only a real
  // change to the screens is worth re-laying out her floor for.
  const relayout = () => {
    const next = span();
    if (JSON.stringify(next.screens) === JSON.stringify(area.screens)) return;
    area = next;
    tellScreens();
    settle(displayAt(shown?.x ?? area.x, shown?.y ?? area.y) ?? area.screens[0]);
    console.log(`screens: ${area.screens.length}, floor ${area.width}x${area.height}`);
  };
  for (const change of ['display-added', 'display-removed', 'display-metrics-changed']) {
    screen.on(change, relayout);
  }

  // The renderer reports whether the cursor is over the body; everywhere else
  // the window is a hole and clicks reach whatever is behind it.
  // The pet's own window stays click-through at all times now. Everything near
  // her is handled by a small catcher window that rides over her: it is a drag
  // destination from birth, which is the only kind macOS will offer a file to,
  // and it forwards what it intercepts back here.
  let body = null;
  // A press pins the catcher where it is until the release. It normally rides on
  // her sixteen times a second, and a dragged pet crosses from one display to
  // the next: the window follows her over the boundary, changes screen and scale
  // underneath the gesture, and the press it was carrying does not survive that.
  // Pinned, it stays on one display for as long as the drag lasts, and macOS
  // keeps delivering to it wherever the cursor goes.
  let dragging = false;
  let seen = 0;

  ipcMain.on('pet-where', (_event, x, y, r) => { body = { x, y, r }; });
  ipcMain.on('pet-ready', () => {
    console.log('Jelly is awake. Drag it, throw it, or leave it alone.');
    // Only now is the page listening, so this is when it learns the desk.
    tellScreens();
    if (shown) settle(shown);
    if (!shots) startShots();
    if (settings.size) win.webContents.send('pet-size', settings.size);
    // Off until asked for: watching Downloads makes macOS ask for access, and
    // takes in every file that lands there.
    if (settings.downloads === true) fetched ??= downloads.watch(swallow);
    // A pin on a screen that is no longer connected is let go of.
    if (settings.pin?.on) {
      const at = settings.pin.at;
      if (at && !displayAt(area.x + at.x, area.y + at.y)) { delete settings.pin; saveSettings(); console.log('unpinned: her spot is on a screen that is gone'); }
      else win.webContents.send('pet-pin', { on: true, at, quiet: true });
    }
  });
  // What she is holding lives here rather than in the page, because handing a
  // file back out happens in the middle of a native drag and there is no time
  // to ask the page anything. The page is told the list and draws it.
  const carried = [];
  let shots = null;   // the screenshot watcher, once she is awake
  let fetched = null; // the downloads watcher, while Fetch downloads is on
  const announce = (fresh = 0) => {
    if (quitting || win.isDestroyed() || catcher.isDestroyed()) return;
    win.webContents.send('pet-carrying', carried.map(
      ({ path: where, name, label, kind, icon }) => ({ path: where, name, label, kind, icon })), fresh);
    if (trayOpen && carried.length) placeTray();   // more or fewer cards: resize it
    if (trayOpen) tray.webContents.send('pet-tray', trayItems(), false, !!shots?.filing);
  };
  const swallow = files => {
    // She swallows first and finds out what it looks like afterwards. A picture
    // can take a second to arrive and must never hold up the animation, so the
    // cards go in wearing their file type and are repainted when the thumbnail
    // turns up. Some never do, and a card with the type on it is a fine end state.
    const fresh = files.filter(file => !carried.some(held => held.path === file));
    if (!fresh.length) return;
    console.log('caught: ' + fresh.map(file => path.basename(file)).join(', '));
    carried.unshift(...fresh.map(file => {
      const card = { path: file, name: path.basename(file), ...describe(file) };
      // A screenshot is always a picture, so its card says when it was taken.
      if (shots?.owns(file)) card.label = shots.label(file) ?? card.label;
      return card;
    }));
    // Screenshots past what she keeps, or not from today, go to their month.
    if (shots) for (const old of shots.surplus(carried.map(one => one.path))) {
      carried.splice(carried.findIndex(one => one.path === old), 1);
      shots.file(old);
    }
    // Downloads past what she keeps are only let go of; they stay in Downloads.
    if (fetched) for (const old of fetched.surplus(carried.map(one => one.path))) {
      carried.splice(carried.findIndex(one => one.path === old), 1);
    }
    announce(fresh.length);
    for (const file of fresh) thumbnail(file).then(made => {
      const held = carried.find(one => one.path === file);
      if (!made || !held) return;
      Object.assign(held, made);
      announce();
    });
    for (const file of fresh) if (shots?.owns(file)) shrinkCopy(file).then(small => {
      const held = carried.find(one => one.path === file);
      if (small && held) { held.small = small; announce(); }
    });
  };
  ipcMain.on('pet-swallow', (_event, files) => {
    if (!Array.isArray(files)) return;
    const paths = files.filter(file => typeof file === 'string' && path.isAbsolute(file));
    if (paths.length) swallow(paths);
  });

  // Handing one back, from a card picked in the tray. macOS starts a file drag
  // from a real dragstart, so the drag begins in the tray. She gives it up at the moment
  // the drag begins: a native drag reports nothing back when it lands, so there
  // is no later moment to act on. The file itself is untouched, and a cancelled
  // drag can simply be dropped on her again. A screenshot is filed a minute
  // later, unless it has been dropped back on her by then.
  ipcMain.on('pet-hand-over', (event, key) => {
    const which = carried.findIndex(one => one.path === key);
    if (which < 0) return;
    const [held] = carried.splice(which, 1);
    if (!held) return;
    announce();
    const small = settings.shrink !== false && held.small;
    console.log('handing over: ' + held.name + (small ? ` (1x, ${small.width}x${small.height})` : ''));
    event.sender.startDrag({ file: small ? small.path : held.path, icon: held.dragIcon ?? BLANK_CARD });
    if (shots?.owns(held.path)) {
      shots.fileSoon(held.path, one => carried.some(still => still.path === one));
    }
  });

  // The tray. Her cards, spread flat beside her where any one can be picked:
  // inside her they are seen through a lens, well away from where they are.
  // It is its own window, sized to what she holds, and it is a drag source, so
  // it takes focus while it is open and closes when it loses it.
  let trayOpen = false;
  let trayShownAt = 0;
  const CARD = { w: 104, h: 90, gapX: 12, gapY: 14, padX: 56, padTop: 52, padBottom: 52 };
  const trayItems = () => carried.map(({ path: where, name, label, kind, thumb, small }) =>
    ({ path: where, name, label, kind, thumb, trash: !!shots?.owns(where),
       edit: SHRINKABLE.test(where),
       out: settings.shrink !== false && small ? `${small.width}x${small.height}` : null }));
  // At most this many rows; past them the cards scroll inside the tray.
  const TRAY_ROWS = 4;
  const traySize = count => {
    const cols = Math.min(5, Math.max(1, count)), rows = Math.min(TRAY_ROWS, Math.ceil(count / cols));
    return {
      width: CARD.padX * 2 + cols * CARD.w + (cols - 1) * CARD.gapX,
      height: CARD.padTop + CARD.padBottom + rows * CARD.h + (rows - 1) * CARD.gapY,
    };
  };
  // Where it is anchored: the edge nearest her, and its bottom, so that as cards
  // come and go it grows and shrinks away from her rather than over her.
  let trayAnchor = null;
  const placeTray = () => {
    const size = traySize(carried.length), { display, side, edge, bottom } = trayAnchor;
    let x = side === 'right' ? edge : edge - size.width;
    x = Math.max(display.x, Math.min(x, display.x + display.width - size.width));
    const y = Math.max(display.y + 30, Math.min(bottom - size.height, display.y + display.height - size.height));
    tray.setBounds({ x, y, ...size });
  };
  const openTray = () => {
    if (!carried.length || !body) { console.log('tray: nothing to show'); return; }
    // Beside her on the floor, bottom level with her base, on whichever side
    // has room on her display.
    const at = { x: area.x + body.x, y: area.y + body.y };
    const display = displayAt(at.x, at.y) ?? shown ?? area.screens[0];
    const right = Math.round(at.x + body.r * .75);
    const roomy = right + traySize(carried.length).width <= display.x + display.width;
    trayAnchor = roomy
      ? { display, side: 'right', edge: right, bottom: Math.round(at.y + body.r * .9) }
      : { display, side: 'left', edge: Math.round(at.x - body.r * .75), bottom: Math.round(at.y + body.r * .9) };
    placeTray();
    trayOpen = true;
    trayShownAt = Date.now();
    win.webContents.send('pet-cue', 'hold');
    tray.show();
    tray.webContents.send('pet-tray', trayItems(), true, !!shots?.filing);
    console.log('tray: open with ' + carried.length);
  };
  const closeTray = (why = 'asked') => {
    if (!trayOpen) return;
    tray.closeFilePreview();
    console.log('tray: closing (' + why + ')');
    trayOpen = false;
    win.webContents.send('pet-cue', 'release');
    tray.webContents.send('pet-tray-closing');
  };
  ipcMain.on('pet-tray-open', () => (trayOpen ? closeTray('double-click again') : openTray()));
  ipcMain.on('pet-tray-close', () => closeTray('idle or Esc'));
  // Quick Look on a card: the system's own panel, in this app, so it does not
  // count as switching away. While it is open the cursor is on the panel rather
  // than the tray, so the tray does not close for the cursor being away until
  // the cursor has come back to it.
  let previewing = false;
  ipcMain.on('pet-preview', (_event, key) => {
    const held = carried.find(one => one.path === key);
    if (!held || !trayOpen) return;
    previewing = true;
    tray.previewFile(held.path, held.name);
  });
  // Editing one picture: a window with it large and four tools (crop, pixelate,
  // box, arrow), and Enter to keep the result. The result is a new file beside
  // the original, which is never changed. A crop on its own is cut by sips, which
  // keeps the original's resolution and colour profile; anything drawn comes back
  // from the page as a finished PNG at full resolution. In the screenshot folder
  // the watcher catches it as a new card, with its own 1x copy like any
  // screenshot; anywhere else (Downloads, a file she was fed) she is handed it
  // directly.
  let editWin = null, editing = null, editTemp = null, editCount = 0, editSize = null;
  // The PNG a HEIC or TIFF was turned into is the whole unedited picture, so it
  // goes as soon as the edit ends (and with EDITS at Quit, at the latest).
  const endEdit = () => {
    SERVABLE.clear();
    editing = null; editSize = null;
    if (editTemp) fs.rm(editTemp, { force: true }, () => {});
    editTemp = null;
  };
  const EDIT_DRAWS = /\.(png|jpe?g)$/i;   // what the page can draw as it is
  const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  ipcMain.on('pet-edit-open', async (event, key) => {
    if (event.sender !== tray.webContents) return;
    const held = carried.find(one => one.path === key);
    if (!held || !SHRINKABLE.test(held.path)) return;
    endEdit();
    // HEIC and TIFF go to the page as a PNG made for the purpose.
    let drawn = held.path;
    if (!EDIT_DRAWS.test(held.path)) {
      drawn = editTemp = path.join(EDITS, `${editCount++}.png`);
      const made = await new Promise(done => execFile('sips', ['-s', 'format', 'png', held.path, '--out', drawn],
        { timeout: 10000, killSignal: 'SIGKILL' }, error => done(!error)));
      if (!made) { console.log('could not open ' + held.name + ' for editing'); endEdit(); return; }
    }
    // Measured from what the page will draw: nativeImage reads PNG and JPEG only.
    const size = nativeImage.createFromPath(drawn).getSize();
    if (!size.width) { console.log('could not read ' + held.name + ' for editing'); endEdit(); return; }
    if (!editWin) {
      editWin = new BrowserWindow({
        show: false, transparent: true, frame: false, hasShadow: false, resizable: false, skipTaskbar: true,
        webPreferences: { preload: path.join(__dirname, 'preload.js'), backgroundThrottling: false },
      });
      editWin.setAlwaysOnTop(true, 'screen-saver', 1);   // above her
      editWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
      editWin.on('closed', () => { editWin = null; });
      await editWin.loadURL(`http://127.0.0.1:${server.address().port}/edit.html`);
    }
    const display = (trayAnchor?.display) ?? shown ?? area.screens[0];
    const work = screen.getDisplayMatching(display).workArea;
    const w = Math.round(work.width * .8), h = Math.round(work.height * .8);
    editWin.setBounds({ x: work.x + Math.round((work.width - w) / 2), y: work.y + Math.round((work.height - h) / 2), width: w, height: h });
    const token = crypto.randomBytes(16).toString('hex');
    SERVABLE.clear(); SERVABLE.set(token, drawn);
    editing = held.path;
    previewing = true;   // the tray stays open meanwhile, as for Quick Look
    editSize = size;
    editWin.webContents.send('pet-edit', held.path, `/file/${token}`, size.width, size.height, settings.editLooks ?? null);
    editWin.show(); editWin.focus();
  });
  // The look and colour last chosen for each tool, kept between runs. Only
  // names the page knows are kept.
  const EDIT_LOOKS = { pixelate: ['blocks', 'frosted', 'tiles'], box: ['square', 'rounded', 'spotlight', 'highlight'], arrow: ['plain', 'straight', 'curved'] };
  const EDIT_PAINTS = ['box', 'highlight', 'arrow'];
  const EDIT_COLOURS = ['red', 'pink', 'yellow', 'blue', 'green', 'white'];
  ipcMain.on('pet-edit-looks', (event, looks) => {
    if (!editWin || editWin.isDestroyed() || event.sender !== editWin.webContents || !looks) return;
    const kept = { colour: {} };
    for (const [tool, names] of Object.entries(EDIT_LOOKS)) if (names.includes(looks[tool])) kept[tool] = looks[tool];
    for (const paint of EDIT_PAINTS) {
      const colour = looks.colour?.[paint];
      if (EDIT_COLOURS.includes(colour) && !(paint === 'highlight' && colour === 'white')) kept.colour[paint] = colour;
    }
    settings.editLooks = kept;
    saveSettings();
  });
  // The page answers with { rect } for a crop alone, or { png } when anything
  // was drawn (the crop, if any, already applied). Only the picture that was
  // opened can be saved.
  ipcMain.on('pet-edit-done', (event, key, result) => {
    if (!editWin || editWin.isDestroyed() || event.sender !== editWin.webContents) return;
    editWin.hide();
    const opened = editing, size = editSize;
    endEdit();
    if (!result || !key || key !== opened) return;
    // A PNG no bigger than four bytes a pixel, and some room for its header,
    // could make it.
    if (result.png && !(result.png instanceof Uint8Array)) return;
    if (result.png && result.png.length > size.width * size.height * 4 + (1 << 20)) return;
    const png = result.png ? Buffer.from(result.png) : null;
    if (png && !png.subarray(0, 8).equals(PNG_SIGNATURE)) return;
    const rect = !png && result.rect;
    if (!png && !(rect && [rect.x, rect.y, rect.w, rect.h].every(Number.isInteger) && rect.w > 0 && rect.h > 0)) return;
    const ext = png ? '.png' : path.extname(key), stem = path.basename(key, path.extname(key)), folder = path.dirname(key);
    let target = path.join(folder, `${stem} (edited)${ext}`);
    // lstat, not exists: a dangling link reads as missing and would be written through.
    const taken = file => { try { fs.lstatSync(file); return true; } catch { return false; } };
    for (let n = 2; taken(target); n++) target = path.join(folder, `${stem} (edited ${n})${ext}`);
    // In the screenshot folder the watcher will see it; an edited copy carries
    // no screenshot mark of its own, so it is told to expect it.
    const watched = !!shots && path.resolve(folder) === shots.folder;
    if (watched) shots.expect(target);
    const saved = error => {
      if (error) { console.log('could not save an edited ' + path.basename(key) + ': ' + error.message); return; }
      console.log(`edited: ${path.basename(target)}` + (rect ? ` (cropped to ${rect.w}x${rect.h})` : ''));
      if (!watched) swallow([target]);
    };
    if (png) fs.writeFile(target, png, { flag: 'wx' }, saved);
    else execFile('sips', ['-c', String(rect.h), String(rect.w), '--cropOffset', String(rect.y), String(rect.x), key, '--out', target],
      { timeout: 10000, killSignal: 'SIGKILL' }, saved);
  });

  // Throwing one away. A screenshot or recording goes to the Trash, where Put Back
  // restores it. Any other file she was fed is only let go of: moving someone's
  // own file to the Trash from her tray would be a nasty surprise.
  ipcMain.on('pet-throw', (_event, key) => {
    const which = carried.findIndex(one => one.path === key);
    if (which < 0) return;
    const [held] = carried.splice(which, 1);
    if (shots?.owns(held.path)) {
      shell.trashItem(held.path).then(() => console.log('thrown away: ' + held.name),
        error => console.log('could not throw away ' + held.name + ': ' + error.message));
    } else console.log('let go of: ' + held.name);
    announce();
  });
  // Clear all. Screenshots are filed now, as if each had been dragged out; any
  // other file is simply let go of, and stays where it always was.
  ipcMain.on('pet-tray-clear', () => {
    const all = carried.splice(0);
    let filed = 0;
    for (const one of all) if (shots?.owns(one.path) && shots.file(one.path)) filed++;
    console.log('tray: cleared ' + all.length + ' (' + filed + ' screenshots filed)');
    announce();
    closeTray('cleared');
  });
  ipcMain.on('pet-tray-done', () => { if (!trayOpen && !tray.isDestroyed()) tray.hide(); });

  // Staying out of your way. While you are using the computer she keeps off the
  // screen you are working on: on that screen she stays put, and on another one
  // she may wander, but only there. The screen you are working on is the one
  // the cursor is on. Once you have left the keyboard and mouse alone for a
  // minute she has the run of the whole desk again.
  const ROAM_AFTER = 60;   // seconds without any input
  let roamSent = '';
  setInterval(() => {
    if (quitting || win.isDestroyed() || !body) return;
    const cursor = screen.getCursorScreenPoint();
    const yours = displayAt(cursor.x, cursor.y);
    const hers = displayAt(area.x + body.x, area.y + body.y);
    const away = powerMonitor.getSystemIdleTime() >= ROAM_AFTER;
    const mode = away ? 'free' : (!yours || !hers || yours === hers) ? 'stay' : 'local';
    const roam = {
      mode,
      screen: mode === 'local'
        ? { x: hers.x - area.x, y: hers.y - area.y, width: hers.width, height: hers.height } : null,
    };
    const said = JSON.stringify(roam);
    if (said === roamSent) return;
    roamSent = said;
    win.webContents.send('pet-roam', roam);
  }, 500);

  // Her size, kept between runs in a small settings file.
  const SETTINGS = path.join(app.getPath('userData'), 'jelly.json');
  // The installed app and npm start share this folder (both are named after
  // package.json's name), so her size, pin and switches are the same in both.
  const settings = (() => { try { return JSON.parse(fs.readFileSync(SETTINGS, 'utf8')); } catch { return {}; } })();
  // Her language: the one picked in her menu, or the system's.
  const pickLanguage = () => (i18n.LANGUAGES[settings.language] ? settings.language
    : i18n.fromSystem(app.getPreferredSystemLanguages()));
  words = i18n.strings(pickLanguage());
  ipcMain.on('pet-zoom', (_event, delta, pinch) => {
    closeTray('resized');   // it was placed beside her at her old size
    win.webContents.send('pet-zoom', delta, pinch);
  });
  // Pinned to a spot: right-click her for "Pin here". Pinned, she stays on her
  // spot whatever you are doing; dragging her moves the spot. Kept between runs.
  const saveSettings = () => { try { fs.writeFileSync(SETTINGS, JSON.stringify(settings)); } catch {} };
  const pinTo = (on, quiet = false) => {
    // "Pin here" means where she is now; the page reports that spot back.
    if (on) settings.pin = { on: true, at: null }; else delete settings.pin;
    saveSettings();
    win.webContents.send('pet-pin', { on, at: null, quiet });
    console.log(on ? 'pinned' : 'unpinned');
  };
  // Tucked away: she walks to the nearest side of her screen and peeks in from
  // it, half of her past the edge, until untucked from the menu or dragged
  // out. Not kept between runs: she starts in the open.
  let tucked = false;
  const tuckAway = on => {
    tucked = on;
    win.webContents.send('pet-tuck', { on });
    console.log(on ? 'tucked away' : 'untucked');
  };
  ipcMain.on('pet-untucked', () => { tucked = false; console.log('untucked: dragged out'); });
  ipcMain.on('pet-pin-at', (_event, x, y) => {
    if (!settings.pin?.on) return;
    settings.pin.at = { x: Math.round(x), y: Math.round(y) };
    saveSettings();
  });
  // Which folder she watches for screenshots: one chosen in her menu, or else
  // wherever macOS saves them (read at each start, so a change made with
  // Cmd+Shift+5 is followed). JELLY_INBOX overrides both, for tests.
  const tilde = where => (where.startsWith(os.homedir()) ? '~' + where.slice(os.homedir().length) : where);
  const shotsFolder = () => path.resolve(process.env.JELLY_INBOX || settings.screenshots?.folder || screenshots.systemFolder());
  // Folders that hold more than screenshots. Filing one of these would move
  // someone's own pictures into month folders, so it is never offered.
  const SHARED = ['home', 'desktop', 'documents', 'downloads'].map(name => app.getPath(name));
  const startShots = () => {
    if (shots) {
      // Cards from the folder she was watching are let go of, not filed.
      const old = shots;
      old.stop();
      shots = null;
      for (let i = carried.length - 1; i >= 0; i--) if (old.owns(carried[i].path)) carried.splice(i, 1);
      announce();
    }
    const folder = shotsFolder();
    // Filing used to be always on, into a fixed inbox; whoever saves there keeps it.
    if (settings.screenshots?.file === undefined && folder === screenshots.OLD_INBOX) {
      settings.screenshots = { ...settings.screenshots, file: true };
      saveSettings();
    }
    const filing = !!settings.screenshots?.file && !SHARED.includes(folder);
    shots = screenshots.watch(swallow, { folder, filing });
  };
  const chooseShotsFolder = async () => {
    app.focus({ steal: true });   // she has no Dock icon; bring the dialog to the front
    const picked = await dialog.showOpenDialog({
      title: words.t('chooseTitle'), message: words.t('chooseMessage'),
      defaultPath: shots?.folder ?? shotsFolder(), buttonLabel: words.t('chooseButton'),
      properties: ['openDirectory', 'createDirectory'],
    });
    if (picked.canceled || !picked.filePaths[0]) return;
    const folder = path.resolve(picked.filePaths[0]);
    settings.screenshots = { folder, file: false };
    saveSettings();
    // She only sees what lands in her folder, so offer to send macOS's there too.
    const system = screenshots.systemFolder();
    if (system !== folder) {
      const { response } = await dialog.showMessageBox({
        type: 'question', message: words.t('pointMessage'),
        detail: words.t('pointDetail', { system: tilde(system), folder: tilde(folder) }),
        buttons: [words.t('pointYes'), words.t('pointNo')], defaultId: 0, cancelId: 1,
      });
      if (response === 0) {
        try { screenshots.setSystemFolder(folder); console.log('macOS now saves screenshots to ' + folder); }
        catch (error) { console.log('could not change where macOS saves screenshots: ' + error.message); }
      }
    }
    startShots();
  };
  // Filing moves files, so it is switched on only after saying so.
  const toggleFiling = async () => {
    if (!shots) return;
    if (!shots.filing) {
      app.focus({ steal: true });
      const now = new Date(), month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
      const { response } = await dialog.showMessageBox({
        type: 'warning', message: words.t('fileMessage'),
        detail: words.t('fileDetail', { folder: tilde(shots.folder), month }),
        buttons: [words.t('fileYes'), words.t('cancel')], defaultId: 1, cancelId: 1,
      });
      if (response !== 0) return;
    }
    settings.screenshots = { ...settings.screenshots, file: !shots.filing };
    saveSettings();
    startShots();
  };
  // Changing her language: the menu is built afresh each time it opens, and the
  // tray and edit pages are served again. Her loading line changes next start.
  const speak = lang => {
    if (lang) settings.language = lang; else delete settings.language;
    saveSettings();
    words = i18n.strings(pickLanguage());
    console.log('language: ' + words.lang);
    closeTray('language');
    tray.reload();
    if (editWin && !editWin.isDestroyed()) editWin.destroy();
    endEdit();
  };
  // Her menu: right-click her, or click her icon in the menu bar. Both show the
  // same items, so either is enough to find everything.
  const menuItems = fromMenuBar => {
    const pinnedNow = !!settings.pin?.on;
    return [
      ...(fromMenuBar ? [{ label: words.t('openTray'), enabled: carried.length > 0, click: () => openTray() }, { type: 'separator' }] : []),
      { label: words.t('pinHere'), type: 'checkbox', checked: pinnedNow, click: () => pinTo(!pinnedNow) },
      { label: words.t('tuckAway'), type: 'checkbox', checked: tucked, click: () => tuckAway(!tucked) },
      { label: words.t('fetchDownloads'), type: 'checkbox', checked: !!fetched, click: () => {
        if (fetched) { fetched.stop(); fetched = null; settings.downloads = false; console.log('Downloads: stopped.'); }
        else { fetched = downloads.watch(swallow); settings.downloads = true; }
        saveSettings();
      } },
      { label: words.t('screenshots'), submenu: [
        { label: shots ? words.t('watching', { folder: tilde(shots.folder) }) : words.t('noFolder', { folder: tilde(shotsFolder()) }), enabled: false },
        { label: words.t('chooseFolder'), click: chooseShotsFolder },
        { label: words.t('useSystemFolder'), type: 'checkbox', checked: !settings.screenshots?.folder, click: () => {
          if (!settings.screenshots?.folder) return;   // already following it
          settings.screenshots = { file: false };
          saveSettings();
          startShots();
        } },
        { type: 'separator' },
        { label: words.t('fileByMonth'), type: 'checkbox', checked: !!shots?.filing,
          enabled: !!shots && !SHARED.includes(shots.folder), click: toggleFiling },
        { label: words.t('shrink'), type: 'checkbox', checked: settings.shrink !== false, click: () => {
          settings.shrink = settings.shrink === false; saveSettings();
          console.log('Shrink screenshots: ' + (settings.shrink ? 'on' : 'off'));
        } },
      ] },
      // Only an installed app can be opened at login; run from npm start, the
      // login item would point at Electron itself.
      ...(app.isPackaged ? [{ label: words.t('openAtLogin'), type: 'checkbox', checked: app.getLoginItemSettings().openAtLogin,
        click: item => app.setLoginItemSettings({ openAtLogin: item.checked }) }] : []),
      { label: words.t('language'), submenu: [
        { label: words.t('languageAuto'), type: 'radio', checked: !i18n.LANGUAGES[settings.language], click: () => speak(null) },
        ...Object.entries(i18n.LANGUAGES).map(([lang, name]) => (
          { label: name, type: 'radio', checked: settings.language === lang, click: () => speak(lang) })),
      ] },
      { type: 'separator' },
      { label: words.t('quit'), click: () => app.quit() },
    ];
  };
  ipcMain.on('pet-menu', () => {
    win.setAlwaysOnTop(true, 'floating');
    Menu.buildFromTemplate(menuItems(false)).popup({
      window: catcher,
      // Her window sits at screen-saver level, which is above where macOS draws
      // menus, so it would cover this one. It steps down while the menu is open.
      callback: () => win.setAlwaysOnTop(true, 'screen-saver'),
    });
  });
  // Her icon in the menu bar: a template image, so macOS tints it to match.
  const menuBar = new Tray(nativeImage.createFromPath(path.join(__dirname, 'icons', 'trayTemplate.png')));
  menuBar.setToolTip('Jelly');
  globalThis.jellyMenuBar = menuBar;   // kept referenced, or it can be collected and vanish
  menuBar.on('click', () => {
    win.setAlwaysOnTop(true, 'floating');
    menuBar.popUpContextMenu(Menu.buildFromTemplate(menuItems(true)));
    win.setAlwaysOnTop(true, 'screen-saver');
  });
  ipcMain.on('pet-size-save', (_event, size) => {
    settings.size = Math.round(size * 1000) / 1000;
    saveSettings();
  });

  ipcMain.on('pet-caught', (_event, kind, at) => {
    // Desk coordinates in, window coordinates out. The pet's window is the whole
    // desk, so this is only the offset of its origin.
    const theirs = win.getBounds();
    seen = Date.now();
    if (kind === 'pointermove' && seen - hopped < 150) return;
    if (kind === 'pointerdown') {
      dragging = true; closeTray('press on her');
    }
    else if (kind === 'pointerup') dragging = false;
    win.webContents.sendInputEvent({
      type: kind === 'pointerdown' ? 'mouseDown' : kind === 'pointerup' ? 'mouseUp' : 'mouseMove',
      x: Math.round(at.x - theirs.x), y: Math.round(at.y - theirs.y),
      button: 'left', clickCount: 1,
      // A synthetic move does not inherit the button from the press it belongs
      // to: sendInputEvent takes `button` but never sets the held-button mask,
      // so without this every forwarded move arrives with nothing pressed and
      // she lets go the instant the cursor stirs. Dragging her has been broken
      // since the catcher took over her mouse events, for exactly this reason.
      modifiers: at.buttons & 1 ? ['leftButtonDown'] : [],
    });
  });

  const catcher = new BrowserWindow({
    width: 200, height: 200, x: area.x, y: area.y, show: false,
    transparent: true, frame: false, hasShadow: false, resizable: false, skipTaskbar: true,
    // It has to be allowed to outgrow a screen, because during a press it
    // becomes the whole desk. Without this macOS keeps it on one display and
    // shifts it sideways to fit, leaving the far screen uncovered.
    enableLargerThanScreen: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), backgroundThrottling: false },
  });
  catcher.setAlwaysOnTop(true, 'floating');
  catcher.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  catcher.setIgnoreMouseEvents(false);
  await catcher.loadURL(`http://127.0.0.1:${server.address().port}/catcher.html`);
  catcher.showInactive();
  const tray = new BrowserWindow({
    width: 300, height: 200, show: false,
    transparent: true, frame: false, hasShadow: false, resizable: false, skipTaskbar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), backgroundThrottling: false },
  });
  tray.setAlwaysOnTop(true, 'floating');
  tray.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  // When it closes by itself. Not on losing focus: the press that opened it is
  // also passed on to her own window, and focus moving between her windows
  // closed the tray the moment it appeared. Instead: when you switch to another
  // app, which focus moving between her own windows never counts as, and when
  // the cursor has stayed away from it for a few seconds.
  // Quick Look counts as another app becoming active, so it is not one.
  app.on('did-resign-active', () => { if (!previewing) closeTray('switched to another app'); });
  let cursorAwaySince = 0;
  setInterval(() => {
    if (quitting || tray.isDestroyed()) return;
    if (!trayOpen) { cursorAwaySince = 0; return; }
    const at = screen.getCursorScreenPoint(), box = tray.getBounds();
    const over = at.x >= box.x && at.x < box.x + box.width && at.y >= box.y && at.y < box.y + box.height;
    if (over) previewing = false;   // back from Quick Look
    if (over || previewing || Date.now() - trayShownAt < 1500) { cursorAwaySince = 0; return; }
    if (!cursorAwaySince) cursorAwaySince = Date.now();
    else if (Date.now() - cursorAwaySince > 6000) closeTray('cursor away');
  }, 250);
  await tray.loadURL(`http://127.0.0.1:${server.address().port}/tray.html`);
  setInterval(() => {
    if (quitting || win.isDestroyed() || catcher.isDestroyed()) return;
    // A release can go missing, and a pinned catcher that never unpins would
    // stop following her for good.
    if (dragging && Date.now() - seen > 4000) dragging = false;
    if (!body) return;
    // She has crossed onto another display: move the window there. Held, she
    // goes where the cursor goes and the hop is immediate. Loose, she swings,
    // and a throw near the seam had the window flapping six times while she
    // settled; so loose she has to have stayed over there a quarter second.
    const at = { x: area.x + body.x, y: area.y + body.y };
    const outside = shown && (at.x < shown.x - 60 || at.x >= shown.x + shown.width + 60
      || at.y < shown.y - 60 || at.y >= shown.y + shown.height + 60);
    if (!outside) away = 0;
    else if (!away) away = Date.now();
    if (outside && Date.now() - hopped > 350 && (dragging || Date.now() - away > 250)) {
      const next = displayAt(at.x, at.y);
      if (next && next !== shown) { settle(next); away = 0; console.log('hop to ' + next.width + 'x' + next.height); }
    }
    if (dragging) return;
    const size = Math.max(80, Math.round(body.r * 2));
    const box = {
      x: Math.round(at.x - size / 2), y: Math.round(at.y - size / 2),
      width: size, height: size,
    };
    catcher.setBounds(box);
  }, 60);

  win.webContents.on('console-message', (...args) => {
    const event = args[0];
    const text = (event && event.message) || args[2] || '';
    if (/Security Warning|unsafe-eval|electronjs\.org|^\s*$/.test(text)) return;
    console.log(text.slice(0, 400));
  });

  await win.loadURL(`http://127.0.0.1:${server.address().port}/`);
  // Shown once the page has loaded, with its look (PET_CSS) in place from the
  // first paint.
  win.showInactive();
  await win.webContents.executeJavaScript(fs.readFileSync(path.join(__dirname, 'pet-demo.js'), 'utf8'));
  console.log(`floor ${area.width}x${area.height} across ${area.screens.length} `
    + `screen${area.screens.length === 1 ? '' : 's'}.`);

  // Cues for filming, only when run from a terminal (npm start). The window is
  // click-through and never focused, so these have to be global: while she runs
  // they belong to her, and Option+T and Option+S (ß) type nothing anywhere else.
  // Too much to take from everyone who installs her; the app quits from her menu.
  if (!app.isPackaged) {
    const cue = name => { win.webContents.send('pet-cue', name); console.log('cue: ' + name); };
    for (const [keys, name] of [[CUE_TOY, 'toy'], [CUE_STACK, 'stack']]) {
      if (!globalShortcut.register(keys, () => cue(name))) console.log('could not register ' + keys);
    }
    globalShortcut.register('Command+Shift+J', () => app.quit());
    // How to use her, for whoever started her from a terminal.
    console.log(`${CUE_TOY} brings the trampoline out or puts it away.`);
    console.log(`${CUE_STACK} sends a baby up onto her head, or brings it down.`);
    console.log('Drop a file on her, or on her tray, to feed her.');
    console.log('Double-click her to open the tray, and drag any file out of it.');
    console.log('Quit with Ctrl+C here, or Cmd+Shift+J anywhere.');
  }
}));

app.on('before-quit', () => { quitting = true; });
// Her windows only ever show her own pages: nothing navigates them elsewhere
// (a dropped file, a link) and nothing opens a window of its own, since either
// would carry the preload, and with it her whole bridge to the shell, along.
app.on('web-contents-created', (_event, contents) => {
  contents.on('will-navigate', event => event.preventDefault());
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
});
app.on('window-all-closed', () => app.quit());
app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  fs.rmSync(THUMBS, { recursive: true, force: true });
  fs.rmSync(EDITS, { recursive: true, force: true });
});
