// What she says to people, in English and Traditional Chinese. Her log stays in
// English: it is for whoever is fixing her, not for whoever is using her.
//
// The language follows the system's first preferred language (Traditional
// Chinese for zh-Hant, zh-TW, zh-HK and zh-MO; English for everything else),
// unless one is picked in her menu. {name} in a string is filled in by t().
const STRINGS = {
  en: {
    // Her menu
    openTray: 'Open her tray',
    pinHere: 'Pin here',
    tuckAway: 'Tuck away at the edge',
    fetchDownloads: 'Fetch downloads',
    screenshots: 'Screenshots',
    watching: 'Watching {folder}',
    noFolder: 'No folder at {folder}',
    chooseFolder: 'Choose folder…',
    useSystemFolder: "Use macOS's screenshot folder",
    fileByMonth: 'File into month folders',
    shrink: 'Shrink to 1× when taken out',
    language: 'Language',
    languageAuto: 'Automatic',
    openAtLogin: 'Open at login',
    quit: 'Quit Jelly',
    // Choosing the screenshot folder
    chooseTitle: 'Screenshot folder',
    chooseMessage: 'Choose the folder Jelly watches for screenshots.',
    chooseButton: 'Watch this folder',
    pointMessage: 'Save new screenshots to this folder?',
    pointDetail: 'macOS saves screenshots to {system}. Jelly only catches what lands in {folder}, '
      + 'so she will miss them unless macOS saves them there too. '
      + 'You can change it back with Cmd+Shift+5, Options.',
    pointYes: 'Save screenshots here',
    pointNo: 'Leave macOS as it is',
    // Filing
    fileMessage: 'File screenshots into month folders?',
    fileDetail: 'Jelly will treat every picture and recording in {folder} as a screenshot, '
      + 'and move any not from today into a folder for its month inside it, like {month}/. '
      + 'Nothing is deleted. Only use this for a folder kept just for screenshots.',
    fileYes: 'File them',
    cancel: 'Cancel',
    // Waking up
    wakingUp: 'Jelly is waking up',
    // The tray
    clearAll: 'Clear all',
    clearFiles: 'Screenshots go to their month folder. Nothing is deleted.',
    clearLets: 'Lets go of every card. Nothing is moved or deleted.',
    trash: 'Move to Trash',
    letGo: 'Let go (the file stays where it is)',
    editCopy: 'Edit a copy (C)',
    dragsOut: 'Drags out at 1× ({size}), smaller for AI apps',
    // Editing
    editTitle: 'Edit',
    toolCrop: 'Crop',
    toolPixelate: 'Pixelate',
    toolBox: 'Box',
    toolArrow: 'Arrow',
    undo: 'Undo (⌘Z)',
    cropStart: 'Drag across the picture to choose what to keep.',
    editUnreadable: 'This picture could not be opened. Press Esc to close.',
    cropAdjust: 'Drag the corners to adjust. Enter saves a copy; the original stays as it is.',
    pixelateStart: 'Drag over anything private to pixelate it.',
    boxStart: 'Drag to draw a box.',
    arrowStart: 'Drag from where the arrow starts to what it points at.',
    editReady: 'Enter saves a copy; the original stays as it is. ⌘Z undoes.',
    editSave: 'Save a copy',
  },
  'zh-Hant': {
    openTray: '打開收納盤',
    pinHere: '固定在這裡',
    tuckAway: '躲到邊邊',
    fetchDownloads: '偵測下載項目',
    screenshots: '截圖',
    watching: '監看中：{folder}',
    noFolder: '找不到資料夾：{folder}',
    chooseFolder: '選擇資料夾…',
    useSystemFolder: '使用 macOS 的截圖資料夾',
    fileByMonth: '依月份歸檔',
    shrink: '縮圖自動縮小成 1×',
    language: '語言',
    languageAuto: '自動',
    openAtLogin: '登入時開啟',
    quit: '結束 Jelly',
    chooseTitle: '截圖資料夾',
    chooseMessage: '選擇 Jelly 要監看截圖的資料夾。',
    chooseButton: '監看這個資料夾',
    pointMessage: '要把新的截圖存到這個資料夾嗎？',
    pointDetail: 'macOS 目前把截圖存到 {system}。Jelly 只會接住存進 {folder} 的檔案，'
      + '所以除非 macOS 也存到那裡，否則她會漏接。之後可以用 Cmd+Shift+5 的「選項」改回來。',
    pointYes: '存到這裡',
    pointNo: '維持 macOS 原本的設定',
    fileMessage: '要依月份歸檔截圖嗎？',
    fileDetail: 'Jelly 會把 {folder} 裡所有的圖片和錄影都當成截圖，'
      + '並把不是今天的移到裡面對應月份的資料夾，例如 {month}/。'
      + '不會刪除任何檔案。請只對專門放截圖的資料夾使用。',
    fileYes: '開始歸檔',
    cancel: '取消',
    wakingUp: 'Jelly 正在醒來',
    clearAll: '全部清除',
    clearFiles: '截圖會移到所屬月份的資料夾，不會刪除任何檔案。',
    clearLets: '放下所有卡片，不會移動或刪除任何檔案。',
    trash: '丟到垃圾桶',
    letGo: '放下（檔案留在原處）',
    editCopy: '編輯一份副本 (C)',
    dragsOut: '拖出時為 1×（{size}），給 AI 應用程式較省',
    editTitle: '編輯',
    toolCrop: '裁切',
    toolPixelate: '馬賽克',
    toolBox: '方框',
    toolArrow: '箭頭',
    undo: '復原 (⌘Z)',
    cropStart: '在圖片上拖曳，選出要保留的範圍。',
    editUnreadable: '這張圖片打不開。按 Esc 關閉。',
    cropAdjust: '拖曳四個角調整。按 Enter 儲存副本，原檔不會變。',
    pixelateStart: '在不想給人看的地方拖出一塊範圍，裡面會變成馬賽克。',
    boxStart: '拖曳畫出方框。',
    arrowStart: '從箭頭的起點拖到要指的地方。',
    editReady: '按 Enter 儲存副本，原檔不會變。⌘Z 復原。',
    editSave: '儲存副本',
  },
};

/** The languages offered in her menu, by the name each calls itself. */
const LANGUAGES = { en: 'English', 'zh-Hant': '繁體中文' };

/** The language for a system preference list such as ['zh-Hant-TW', 'en-US']. */
const fromSystem = preferred => {
  const first = (preferred[0] ?? 'en').replace('_', '-');
  return /^zh-(Hant|TW|HK|MO)\b/i.test(first) ? 'zh-Hant' : 'en';
};

/** The strings for one language, with t(key, values) to fill them in. */
const strings = lang => {
  const table = STRINGS[lang] ?? STRINGS.en;
  const t = (key, values = {}) => (table[key] ?? STRINGS.en[key] ?? key)
    .replace(/\{(\w+)\}/g, (_, name) => values[name] ?? '');
  return { lang, table: { ...STRINGS.en, ...table }, t };
};

module.exports = { strings, fromSystem, LANGUAGES };
