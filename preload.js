// The only bridge her pages get to the shell: what she is told, and what she reports.
const { contextBridge, ipcRenderer, webUtils } = require('electron');

// A dropped file's real path is not on the File object any more; it has to be
// asked for, and only a preload can ask. So the catcher's drop is handled here
// rather than in its page, which sees names and nothing else.
// Her tray takes drops too, so files can be fed to her there as well.
if (location.pathname === '/catcher.html' || location.pathname === '/tray.html') {
  addEventListener('drop', event => {
    event.preventDefault();
    const paths = [...(event.dataTransfer?.files ?? [])]
      .map(file => { try { return webUtils.getPathForFile(file); } catch { return file.name; } })
      .filter(Boolean);
    if (paths.length) ipcRenderer.send('pet-swallow', paths);
  }, true);
}

contextBridge.exposeInMainWorld('pet', {
  ready: () => ipcRenderer.send('pet-ready'),
  // The window never takes keyboard focus, so cues arrive from the shell's
  // global shortcuts rather than from a key event on the page.
  onCue: handle => ipcRenderer.on('pet-cue', (_event, cue) => handle(cue)),
  // Where the body is on screen, so the shell can decide about the cursor
  // without waiting for an event the window may never be sent.
  where: (x, y, r) => ipcRenderer.send('pet-where', x, y, r),
  // From the catcher window: files dropped on the pet, and the mouse events it
  // intercepted on the way, which belong to the pet's own window.
  swallow: files => ipcRenderer.send('pet-swallow', files),
  caught: (kind, at) => ipcRenderer.send('pet-caught', kind, at),
  onCarrying: handle => ipcRenderer.on('pet-carrying', (_event, files, fresh) => handle(files, fresh)),
  onScreens: handle => ipcRenderer.on('pet-screens', (_event, rects) => handle(rects)),
  // The desk's size and where this window sits on it, so the page can draw the
  // whole floor and slide it to show this window's share.
  onView: handle => ipcRenderer.on('pet-view', (_event, view) => handle(view)),
  handOver: key => ipcRenderer.send('pet-hand-over', key),
  // The tray: her cards spread out flat beside her, so any one can be picked.
  openTray: () => ipcRenderer.send('pet-tray-open'),
  closeTray: () => ipcRenderer.send('pet-tray-close'),
  trayDone: () => ipcRenderer.send('pet-tray-done'),
  clearTray: () => ipcRenderer.send('pet-tray-clear'),
  preview: key => ipcRenderer.send('pet-preview', key),
  throwAway: key => ipcRenderer.send('pet-throw', key),
  // Editing a picture (crop, pixelate, box, arrow): the tray asks, the edit
  // window shows it and answers with a crop, or with the finished PNG's bytes.
  editOpen: key => ipcRenderer.send('pet-edit-open', key),
  editDone: (key, result) => ipcRenderer.send('pet-edit-done', key, result),
  onEdit: handle => ipcRenderer.on('pet-edit', (_event, key, src, width, height) => handle(key, src, width, height)),
  onTray: handle => ipcRenderer.on('pet-tray', (_event, items, opening, filing) => handle(items, opening, filing)),
  onTrayClose: handle => ipcRenderer.on('pet-tray-closing', () => handle()),
  // Her size: scroll or pinch over her, and the size she was left at.
  zoom: (delta, pinch) => ipcRenderer.send('pet-zoom', delta, pinch),
  onZoom: handle => ipcRenderer.on('pet-zoom', (_event, delta, pinch) => handle(delta, pinch)),
  saveSize: size => ipcRenderer.send('pet-size-save', size),
  onSize: handle => ipcRenderer.on('pet-size', (_event, size) => handle(size)),
  // Where she may wander, given what you are doing: see 'pet-roam' in main.js.
  onRoam: handle => ipcRenderer.on('pet-roam', (_event, roam) => handle(roam)),
  // Pinned to a spot: the right-click menu, the pin itself, and where her spot is.
  menu: () => ipcRenderer.send('pet-menu'),
  onPin: handle => ipcRenderer.on('pet-pin', (_event, pin) => handle(pin)),
  pinAt: (x, y) => ipcRenderer.send('pet-pin-at', x, y),
  // Tucked away at the edge of her screen: the menu tucks her, and she says when
  // being dragged out has untucked her.
  onTuck: handle => ipcRenderer.on('pet-tuck', (_event, tuck) => handle(tuck)),
  untucked: () => ipcRenderer.send('pet-untucked'),
});
