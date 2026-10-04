# Jelly

[繁體中文](README.md)

Jelly is a soft jelly who lives on your macOS desktop. She walks across all your screens, you can pick her up and throw her, and she scrunches up her face when poked. She also holds files for you: a new screenshot is swallowed the moment it is saved, and double-clicking her lets you drag it out again, into a chat or an AI app.

<p align="center"><img src="docs/images/jelly-carrying.png" width="420" alt="Pink Jelly with a file card inside her, three small jellies behind her"></p>

Her body, physics and look come from [Jelly Baby](https://github.com/scottstts/Jelly-Baby) by scottstts, a soft-body toy that runs in the browser. This project moves her onto the desktop and adds file holding, screenshot handling and three baby jellies.

## Download and install

1. Download the latest `Jelly-<version>-arm64.dmg` from [Releases](https://github.com/catsmice/jelly-desktop-oss/releases).
2. Open the `.dmg` and drag Jelly into Applications.
3. Open Jelly. She appears on your desktop, with her icon in the menu bar.

The app is signed and notarized by Apple, so macOS opens it without an "unidentified developer" warning.

Jelly runs on Apple Silicon Macs (M1 and later). She is developed and tested on macOS 27; older versions have not been tried.

## Playing with her

- Press and drag to carry her. Let go mid-swing and she flies off and lands.
- Click her and she scrunches up her face.
- Scroll or pinch with two fingers over her to make her bigger or smaller. She remembers her size.
- Double-click her to open her tray.
- Right-click her, or click her menu bar icon, for her menu.

Three baby jellies follow her around. While she roams freely, a trampoline turns up now and then for everyone to bounce on, and a bored baby sometimes climbs onto her head and sits there for a while.

<p align="center">
  <img src="docs/images/jelly-poke.png" width="400" alt="Jelly's resting face and her face when poked">
  <img src="docs/images/jelly-trampoline.png" width="300" alt="Jelly and the three babies at the trampoline">
  <img src="docs/images/jelly-riding.png" width="220" alt="A yellow baby jelly sitting on Jelly's head">
</p>

## Giving her files

Drag any file onto her and she swallows it, and it shows up inside her as a card. The file stays where it is; she only keeps track of where it lives.

Double-click her to open the tray, which lays her cards out flat beside her, newest first. In the tray you can:

- Drag a card into any app: Finder, Mail, a chat.
- Hover a card and press Space to see it in Quick Look.
- Click a card's bin. Screenshots and screen recordings go to the Trash, where Put Back restores them. Any other file is only let go of and stays where it was.
- Click Clear all to let go of every card.

You can also drop files on the tray to give them to her.

<p align="center"><img src="docs/images/jelly-tray-open.png" width="720" alt="Jelly's tray open beside her, with five screenshot cards"></p>

## Screenshots

Jelly watches the folder macOS saves screenshots to (the Desktop, unless you changed it) and swallows each new screenshot as it lands. The card shows the time it was taken. She holds up to 12 from today.

In a shared folder like the Desktop she only takes files macOS marked as screenshots. She leaves your other pictures alone and never moves anything. Screen recordings carry no such mark, so she only catches those in a folder kept just for screenshots.

To have your screenshots filed for you:

1. In her menu, choose Screenshots → Choose folder… and pick a folder kept just for screenshots, such as `~/Pictures/Screenshots/Inbox`.
2. She offers to have macOS save screenshots there from now on. Choose Save screenshots here.
3. Tick File into month folders and confirm. From then on, a screenshot you drag out, or one from an earlier day, moves into a folder for its month inside that folder, like `2026-10/`. Nothing is ever deleted.

Filing is not offered for your home folder, Desktop, Documents or Downloads.

### 1× screenshots for AI apps

A screenshot from a Retina screen has twice the width and height of what you saw. When you drag a screenshot out of the tray, Jelly hands over a copy scaled to 1×, so 3024×1964 becomes 1512×982. In Claude and similar AI apps that uses about 60% fewer tokens. The original is left as it is. Turn it off under Screenshots → Shrink to 1× when taken out.

### Cropping

Hover a screenshot card and press C, or click its crop button. Drag out the part to keep and press Enter. The crop is saved next to the original with "(cropped)" added to its name, and the original is left as it is.

## Downloads

Tick Fetch downloads in her menu and each finished download shows up inside her, ready to drag somewhere else. She holds the 8 newest, and the files stay in your Downloads folder. It is off until you turn it on, and the first time macOS asks whether she may read Downloads.

## Staying out of your way

On the screen you are working on, she stays where she is, shuffling about on the spot, and dozes off after a minute. With more than one screen, she can wander around the others. Once the keyboard and mouse have been idle for a minute, she has the run of every screen.

To keep her in one spot, choose Pin here in her menu. Dragging her while pinned moves the spot.

## Her menu

| Item | What it does |
| --- | --- |
| Open her tray | Only in the menu bar icon's menu |
| Pin here | Keeps her where she is now |
| Fetch downloads | Catches downloads as they finish |
| Screenshots | Folder, filing into month folders, 1× copies |
| Open at login | Opens Jelly when you log in |
| Language | Automatic, English or 繁體中文; Automatic follows the system |
| Quit Jelly | |

## What she costs

She is a real-time 3D soft-body simulation and uses about 1 GB of memory. Dozing on the spot she takes about 18% of one CPU core, and more while she is awake and walking.

## Privacy

Jelly's code makes no network connections, has no account and collects nothing. She reads only the files you give her, your screenshot folder, and Downloads when Fetch downloads is on. Her settings live in `~/Library/Application Support/jelly-desktop/` and her log in `~/Library/Logs/jelly-desktop/jelly.log`. The log includes the names of files she caught and stays on your Mac.

## Uninstalling

If you turned on Open at login, untick it first. Quit Jelly and move Jelly from Applications to the Trash. To remove her settings too, delete the two folders above.

## Running from source

```sh
git clone https://github.com/catsmice/jelly-desktop-oss.git
cd jelly-desktop-oss
npm install
npm start
```

`app/` holds a prebuilt Jelly Baby, so she runs without a build step. Rebuilding `app/`, packaging and releasing are covered in [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md).

## Credits and licence

- Jelly herself, her soft-body physics and her look: [Jelly Baby](https://github.com/scottstts/Jelly-Baby) by scottstts, GPL-3.0.
- The room light reflected in her: [Empty Play Room](https://polyhaven.com/a/empty_play_room) on Poly Haven, photographed by Greg Zaal and processed by Jarod Guest, CC0.

Jelly desktop is released under GPL-3.0. See [LICENSE](LICENSE) and [NOTICE.md](NOTICE.md).
