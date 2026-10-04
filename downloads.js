// Downloads, caught as they finish.
//
// A finished download goes into her, ready to be dragged where it is needed.
// Unlike screenshots these are the user's own files: she never moves or trashes
// them, she only holds on to them, and lets go of the oldest past KEEP. Only
// downloads that finish while she is running count; what is already in the
// folder is left alone, or she would swallow years of downloads at startup.
const fs = require('fs');
const path = require('path');
const os = require('os');

const FOLDER = process.env.JELLY_DOWNLOADS || path.join(os.homedir(), 'Downloads');
/** How many downloads she holds before letting go of the oldest. */
const KEEP = 8;
// Browsers write to a stand-in and rename it when the download is complete:
// Chrome .crdownload, Safari .download (a folder), Firefox .part.
const PARTIAL = /\.(crdownload|download|part|partial|tmp)$/i;

const inFolder = file => path.dirname(path.resolve(file)) === path.resolve(FOLDER);

const watch = swallow => {
  if (!fs.existsSync(FOLDER)) {
    console.log('Downloads: no folder at ' + FOLDER + ', not watching.');
    return null;
  }
  const seen = new Set();
  // A finished name is taken once it is a regular file whose size has stopped
  // changing; a download can still be flushing for a moment after the rename.
  const settle = (one, size = -1) => setTimeout(() => {
    let stat;
    try { stat = fs.statSync(one); } catch { seen.delete(one); return; }
    if (!stat.isFile()) { seen.delete(one); return; }
    if (stat.size === 0 || stat.size !== size) return settle(one, stat.size);
    swallow([one]);
  }, 500);
  let watcher;
  try {
    watcher = fs.watch(FOLDER, (_kind, name) => {
      if (!name || name.startsWith('.') || PARTIAL.test(name)) return;
      const one = path.join(FOLDER, name);
      if (seen.has(one) || !fs.existsSync(one)) return;
      seen.add(one);
      settle(one);
    });
  } catch (error) {
    // macOS protects ~/Downloads; without access there is nothing to watch.
    console.log('Downloads: cannot watch ' + FOLDER + ': ' + error.message);
    return null;
  }
  console.log('Downloads: watching ' + FOLDER + '.');
  return {
    owns: inFolder,
    /** Of the ones she holds (newest first), the downloads past KEEP. */
    surplus: held => held.filter(inFolder).slice(KEEP),
    stop: () => watcher.close(),
  };
};

module.exports = { watch, FOLDER };
