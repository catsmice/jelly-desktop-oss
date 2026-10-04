// Screenshots and screen recordings, caught as they land.
//
// She watches one folder: the one chosen in her menu, or else wherever macOS
// saves screenshots (the Desktop, unless changed with Cmd+Shift+5, Options).
// Each new screenshot is fed to her.
//
// Two ways of watching, by the "File into month folders" switch:
// - Off (the default): the folder is shared, like the Desktop. Only files macOS
//   itself marked as screenshots are hers, and nothing is ever moved. Screen
//   recordings carry no such mark, so they are not caught.
// - On: the folder is given over to screenshots, like ~/Pictures/Screenshots/Inbox.
//   Every picture and recording in it is hers, and once one has been dragged out,
//   or is no longer from today, or is past the newest KEEP, it is moved into a
//   folder for its month inside it: Inbox/2026-10/.
// Nothing is ever deleted, and nothing outside the folder is ever moved.
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFile, execFileSync } = require('child_process');

/** How many she keeps before the oldest is let go of (and filed, if filing). */
const KEEP = 12;
/** A dragged-out screenshot is filed this long after the drag begins. The
 * drag reports nothing when it lands, and the app it lands in may still be
 * reading the file a moment later, so it is not moved straight away. */
const FILE_AFTER_MS = 60 * 1000;
// Screenshots, and the screen recordings Cmd+Shift+5 saves to the same place.
const CAPTURE = /\.(png|jpe?g|heic|tiff?|mov|mp4)$/i;
// Where this used to be fixed. Someone who set macOS up to save there was
// already having screenshots filed, so for them filing starts out on.
const OLD_INBOX = path.join(os.homedir(), 'Pictures', 'Screenshots', 'Inbox');

const home = where => where.replace(/^~(?=$|\/)/, os.homedir());

/** Where macOS saves screenshots: its own setting, or the Desktop. */
const systemFolder = () => {
  for (const key of ['location-screenshot', 'location']) {
    try {
      const where = execFileSync('defaults', ['read', 'com.apple.screencapture', key],
        { encoding: 'utf8', timeout: 3000, stdio: ['ignore', 'pipe', 'ignore'] }).trim();
      if (where) return path.resolve(home(where));
    } catch {}   // not set: macOS's default
  }
  return path.join(os.homedir(), 'Desktop');
};

/** Have macOS save new screenshots and recordings into this folder, as
 * Cmd+Shift+5, Options, Other Location does. */
const setSystemFolder = folder => {
  for (const key of ['location', 'location-screenshot', 'location-screenrecording']) {
    execFileSync('defaults', ['write', 'com.apple.screencapture', key, '-string', folder], { timeout: 3000 });
  }
};

// Whether macOS marked this file as a screenshot. It does so whatever language
// the file is named in; a picture saved or dragged into the folder has no mark.
const markedAsScreenshot = file => new Promise(resolve =>
  execFile('xattr', ['-p', 'com.apple.metadata:kMDItemIsScreenCapture', file], { timeout: 3000 },
    error => resolve(!error)));

// Local dates, not UTC: a screenshot taken at 07:00 in Taipei belongs to today.
const pad = n => String(n).padStart(2, '0');
const monthOf = date => `${date.getFullYear()}-${pad(date.getMonth() + 1)}`;
const dayOf = date => `${monthOf(date)}-${pad(date.getDate())}`;
const today = () => dayOf(new Date());

// When it was taken: the file's creation time, so marking one up afterwards
// does not move it to the front or into another month.
const takenAt = file => {
  try { const stat = fs.statSync(file); return stat.birthtimeMs > 0 ? stat.birthtime : stat.mtime; } catch { return null; }
};

/**
 * Start watching `folder`. `swallow(paths)` feeds her, newest first. With
 * `filing` the folder is hers and old screenshots go into month folders inside
 * it; without, only marked screenshots are caught and nothing is moved.
 * Returns null when the folder is not there.
 */
const watch = (swallow, { folder, filing }) => {
  if (!fs.existsSync(folder)) {
    console.log('Screenshots: no folder at ' + folder + ', not watching.');
    return null;
  }
  const inFolder = file => path.dirname(path.resolve(file)) === folder;
  // Without filing, which of the folder's files are hers: the marked ones, and
  // crops she made herself (a crop is a new file, and carries no mark).
  const mine = new Set();
  const expected = new Set();
  const owns = file => inFolder(file) && (filing || mine.has(file));
  const isHers = async one => {
    if (expected.delete(one) || filing) return true;
    return /\.(mov|mp4)$/i.test(one) ? false : markedAsScreenshot(one);
  };
  const take = async ones => {
    const hers = [];
    for (const one of ones) if (await isHers(one)) { mine.add(one); hers.push(one); }
    if (hers.length) swallow(hers);
  };

  /** Move one screenshot into its month's folder, inside the folder. */
  const file = where => {
    if (!filing || !inFolder(where)) return false;
    const when = takenAt(where);
    if (!when) return false;
    const month = monthOf(when);
    const into = path.join(folder, month);
    try {
      fs.mkdirSync(into, { recursive: true });
      const ext = path.extname(where), stem = path.basename(where, ext);
      let target = path.join(into, stem + ext);
      for (let n = 2; fs.existsSync(target); n++) target = path.join(into, `${stem} (${n})${ext}`);
      fs.renameSync(where, target);
      console.log('filed: ' + path.basename(where) + ' -> ' + month);
      return true;
    } catch (error) {
      console.log('could not file ' + path.basename(where) + ': ' + error.message);
      return false;
    }
  };

  const seen = new Set();
  const pictures = () => fs.readdirSync(folder)
    .filter(name => !name.startsWith('.') && CAPTURE.test(name))
    .map(name => path.join(folder, name));

  // What is already there: today's are hers; older ones are filed if filing,
  // and otherwise left where they are.
  const waiting = [];
  for (const one of pictures()) {
    const when = takenAt(one);
    if (!when) continue;
    seen.add(one);
    if (dayOf(when) !== today()) file(one);
    else waiting.push({ one, when });
  }
  waiting.sort((a, b) => b.when - a.when);
  // After this returns, so the shell already knows the watcher when they arrive.
  if (waiting.length) setImmediate(() => take(waiting.map(w => w.one)));

  // macOS writes a screenshot as a hidden file and then renames it, so a new
  // name is only taken once it is visible and has stopped growing.
  const settle = (one, size = -1) => setTimeout(() => {
    let now;
    try { now = fs.statSync(one).size; } catch { seen.delete(one); return; }
    if (now === 0 || now !== size) return settle(one, now);
    take([one]);
  }, 250);
  const watcher = fs.watch(folder, (_kind, name) => {
    if (!name || name.startsWith('.') || !CAPTURE.test(name)) return;
    const one = path.join(folder, name);
    if (seen.has(one) || !fs.existsSync(one)) return;
    seen.add(one);
    settle(one);
  });
  console.log('Screenshots: watching ' + folder + (filing ? ', filing by month.' : '.'));
  return {
    folder,
    filing,
    /** Whether this file is one of hers: crop it, throw it away, file it. */
    owns,
    /** A file she is about to make in the folder (a crop), to catch as hers. */
    expect: one => expected.add(one),
    /** Label for a card: the time it was taken. */
    label: one => {
      const when = takenAt(one);
      return when ? when.toTimeString().slice(0, 5) : null;
    },
    /** File it a little later, unless she has been given it back by then. */
    fileSoon: (one, stillHeld) => filing && setTimeout(() => {
      if (stillHeld(one)) return;
      seen.delete(one);
      file(one);
    }, FILE_AFTER_MS),
    /** Of the ones she holds, which should go now: not today's, or past KEEP. */
    surplus: held => {
      const hers = held.filter(owns);
      const old = hers.filter(one => { const w = takenAt(one); return w && dayOf(w) !== today(); });
      const extra = hers.filter(one => !old.includes(one)).slice(KEEP);
      return [...old, ...extra];
    },
    file: one => { if (!filing) return false; seen.delete(one); return file(one); },
    stop: () => watcher.close(),
  };
};

module.exports = { watch, systemFolder, setSystemFolder, OLD_INBOX };
