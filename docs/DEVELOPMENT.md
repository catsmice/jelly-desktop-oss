# Jelly desktop: development notes

How everything in Jelly works, for whoever works on her. What she does for people is
in the [README](../README.en.md).

It began as a throwaway proof that scottstts/Jelly-Baby can live on the macOS desktop: a
full-screen transparent window, the soft-body physics intact, the jelly walking
around the desktop as if it were the tabletop, noticing your cursor, dozing off
when you leave, and passing clicks through everywhere except its own silhouette.

## Run it

```sh
npm install     # once: pulls Electron
npm start
```

The jelly wanders a floor that spans every display, stands around, and hops. She is
shown on every desktop (Space) and over full-screen apps too. Drag it with the mouse and throw it; everywhere else your
clicks reach whatever is behind the window.

Quit from her menu (right-click her, or her menu-bar icon). Run from `npm start`, Ctrl+C
in the terminal or Cmd+Shift+J anywhere also quits.

### As an app

```sh
npm run install-app   # builds Jelly.app and puts it in /Applications (under a minute)
```

Then start her from Launchpad or Spotlight like any app. There is no Dock icon; her
icon in the menu bar has the same menu as right-clicking her, plus **Open her tray**,
**Open at login** and **Quit Jelly**. Only one Jelly runs at a time, and the app and
`npm start` share their settings, so either can be used.

- It is signed with whatever Developer ID Application certificate is in the login
  keychain (electron-builder finds it; `CSC_NAME` picks one if there are several), and
  left unsigned where there is none (`npm start` needs no signing at all). No
  notarizing, which personal use does not need. A stable
  signature is what keeps macOS's Downloads permission across rebuilds. The first
  build may ask for the keychain key once per signed file: choose **Always Allow**.
- Signing skips Apple's timestamp (`"timestamp": "none"` in `package.json`): every
  file is signed separately, and a timestamp is a round trip to Apple per file, which
  took a build from under a minute to over eight. Notarizing would need it back.
- With no terminal, what she says goes to
  `~/Library/Logs/jelly-desktop/jelly.log` (Electron names its folders after
  `package.json`'s `name`), started afresh each launch and capped at 2 MB, past which it
  becomes `jelly.old.log`. It logs what happens (files caught, filed, thrown away,
  handed over; the tray; settings) and errors, not her ongoing state.
- She wakes up behind a small pink pill near the bottom of the screen ("Jelly is
  waking up · …"), not the game's own loading screen. Her page's look (`PET_CSS` in
  `main.js`) is written into the HTML as the shell serves it, not inserted after
  loading: her window draws while hidden, so the game's opaque beige loading screen
  had already been painted into it, and macOS flashed that frame across the whole
  display as the window appeared.

What you can do with her:

| gesture | what happens |
| --- | --- |
| drag her | she is picked up and thrown; a click is a poke |
| drop a file on her, or on her open tray | she swallows it and shows it inside her |
| double-click her | her tray opens beside her: drag any file out of it |
| in the tray: double-click a card, or Space over it | Quick Look, the system's preview |
| in the tray: the trash button on a card, or Delete | screenshots and recordings to the Trash; other files are only let go of |
| two-finger scroll or pinch over her | she gets bigger or smaller, and stays that size |
| in the tray: the crop button on a screenshot, or C | crop a copy; Enter saves `… (cropped).png` as a new card |
| right-click her | her menu: **Pin here** keeps her on her spot (see "Pinned to a spot"); **Fetch downloads** switches the downloads catcher; **Screenshots** picks her folder and filing (see "Catching screenshots") |
| download something | she swallows it when it finishes (see "Catching downloads") |
| take a screenshot | if screenshots are saved to her inbox, she swallows it (see "Catching screenshots") |

While you are using the computer she keeps off the screen you are working on;
see "Staying out of your way".

For filming, two cues skip the waiting. They exist only under `npm start`, never in
the installed app:

| keys | what happens |
| --- | --- |
| Option+T | the trampoline comes out, or goes away if it is already out |
| Option+S | a baby climbs onto her head, or comes down if one is up there |

They are global, because the window is click-through and never takes keyboard
focus. That means Option+T and Option+S belong to the pet while it is running and
will not type their usual characters (†, ß) anywhere else, which is why the installed
app leaves them alone. Change `CUE_TOY` and
`CUE_STACK` at the top of `main.js` if that gets in the way; any Electron
accelerator works.

Startup takes a few seconds the first time while WebGPU compiles the material.

## How the desktop becomes a floor

The camera is a long lens (14 degrees) one metre above the floor plane, pitched 30
degrees down, so the bottom of your screen is the near edge of the floor and the top
is about 0.6 m away. Walking away from you moves the jelly up the screen and shrinks
it, exactly as it does on the tabletop in the browser game. `pet-demo.js` unprojects
the screen corners onto that plane to find the walkable area, then picks somewhere to
go and holds the keys a person would hold.

Tune `LENS`, `EYE`, `PITCH` and `MARGIN` at the top of `pet-demo.js` to change the
framing. A wider `LENS` or a steeper `PITCH` gives a more top-down, diorama look.

Moving the camera back also means moving the near plane out, from the game's 1 mm to
60 cm. The face is drawn as flat patches floating two tenths of a millimetre above
the skin. At 25 cm, the game's own viewing distance, the depth buffer separates them
from the skin by about 27 units; at two metres it separates them by less than one, so
the mouth and tongue flicker in and out as the body wobbles.

## More than one screen

The floor is the whole desk: the page draws a canvas the size of every display
together, so walking off the side of the laptop is walking onto whatever else is
plugged in, with nothing handed over and no second scene to run.

The window is not. macOS paints a window on a single display, whatever bounds it
is given. A window spanning two accepts the bounds, reports them back, renders
all of it, and is shown on one display and never on the other. Every trace of a
drag across the seam said she had crossed, because in the page she had; a screen
capture of each side is what showed one of them empty. So the window is one
display's worth, kept on whichever display she is on and moved when she crosses,
and the page slides its canvas so the window shows its own slice of the floor.
Nothing in the scene moves at the seam; only the frame around it does.

Two details make the hop invisible. The window move and the canvas slide reach
the page by different routes, so for a few milliseconds an input event can be
mapped against the wrong slice and yank her a whole screen sideways; moves are
dropped for that long, and the grab holds her still. And she swings when thrown,
so a hop needs sixty pixels of hysteresis and a third of a second before the next,
or the window flaps between two screens while she settles.

Displays that do not make a rectangle together leave a gap. A 1512 by 982 laptop
beside a 1920 by 1080 monitor gives a 3432 by 1080 floor with a strip along the
bottom left that is on no screen at all. The page is told where the real screens
are, in desk pixels, and rejects any destination that lands outside them.

The cost is sharpness rather than speed. The renderer holds itself to a four
megapixel budget, so one screen at 1512 by 982 renders at 1.64 device pixels per
CSS pixel and the whole desk at 3432 by 1080 renders at 1.04. Same work, spread
over 2.3 times the area, so she loses about a third of her linear resolution. The
budget is one number in `renderer.ts`.

## What it does

**It notices the cursor, but no longer comes over.** Walking to the cursor is off
while the shelf is being built: a pet that comes to meet you is a moving target when
you are trying to drop a file on it. It still wakes for a cursor and still knows when
one is on its body. `FOLLOW_CURSOR` at the top of `pet-demo.js` turns the rest back
on, and `globalThis.__petFollow` switches it live. What it does when it is on: The window forwards every mouse move on the screen even
while it is clicking through, so the pointer is something the pet can see. The
cursor's position is projected onto the floor plane, and a pointer within 30 cm of
the body, in its own scale, cancels whatever it was doing and pulls it over. It stops
6 cm short rather than standing under you, and a fast sweep across it makes it hop. A
cursor outside the walkable area still pulls, as far towards you as the floor allows,
so working in a corner leans it that way. Four seconds of stillness and it loses
interest and goes back to wandering.

**It sleeps when you stop.** Ninety seconds without the cursor moving and it stands
still, closes its eyes and blows a sleep bubble, all of which the upstream project
already knew how to draw for its bed. Any real cursor movement wakes it. Chromium
re-fires mousemove at the same coordinates whenever the page repaints, which for an
animated full-screen canvas is constantly, so only a pointer that actually moved
counts as someone being there.

**You can poke it.** Click the jelly and it squashes flat and wide for a fifth of a
second, then springs back through a couple of overshoots, squinting while it happens.
`images/jelly-poke.png` is resting and poked.

Two layers make that up. Underneath is the real thing: the spot under the cursor is
pressed in along the surface normal, a little over two centimetres on a body seven
centimetres tall, while the body's own centre shifts less than a millimetre. On its
own it is nearly invisible, and the reason is worth knowing. A dent points away from
the viewer, so it moves the outline by zero pixels, and a real jelly's wobble is a
few percent of a body about 140 pixels tall. Measured every way, the silhouette
barely moved.

So on top of the physics there is a drawn squash: the character is scaled flat and
wide and springs back, which is what actually reads as a poke. It is an exaggeration
rather than a simulation, and `POKE.bounce = 0` turns it off and leaves the physics
alone. It has to be held rather than oscillated: at thirty frames a second, the first
quarter of a single bounce is one frame long and flashes past unseen.

A click pokes and a press-and-drag drags, never both at once. That is not fussiness:
a drag holds the exact spot the poke is pressing in, and the two cancel out almost
completely. Since input swallows pointerup once it holds a grip, the release is
spotted by watching its grab disappear rather than by listening for the event.

**A toy turns up, and the babies get it.** Every minute or two a trampoline pops
into being on the floor. The three babies break formation, walk to it, climb on at
their own spots along the mat and bounce together while their mother carries on with
whatever she was doing. They reach about 125 mm, four body heights, against a mat
that sits at 55. When they have had enough they all get off and it pops away.
`images/jelly-trampoline.png` is the three of them mid-bounce; `images/jelly-toy.png` is the older
picture, from when she used it herself. The trampoline is upstream's,
unchanged: a facility that owns the body while it is in use, bounces it, decides when
the bounce is high enough to be worth laughing about, and hands the body back. All
this adds is the coming and going, and a pet that decides to climb on by itself
rather than waiting for someone to press E.

Two things to expect. The jelly goes dark on the mat, because a body that gets its
colour from transmitted light takes on whatever is behind it, and the mat is a dark
green. And it makes noise: the trampoline has its own motion sound upstream.

**It has company.** Three smaller jellies, at 40% of her height and in their own
flavours, walk in a loose line behind her, hurrying when they fall behind and
ambling when they are in place. `images/jelly-family.png` is the four of them on the move.

Each baby is a full soft body with its own solver instance and its own rig, not an
animated sprite: the same gait carries it, and it wobbles and squashes the same way.
What makes three of them affordable is that they are a different model, built from
the same implicit shape at a coarser cage, costing 2.31 ms a frame against her 8.25.
They are also simpler above the neck. Her face is rebuilt from the deformed skin
every frame and is the most expensive single thing in it; at this size a baby needs
eyes, and eyes are two samples of the skin rather than a pass over every vertex.

**The babies have their own games.** Left alone they fall in behind her, but one
will wander a little way off and come back, or climb onto her head and sit there
until it gets bored, then push off and drop down. `images/jelly-stack.png` is one of them
up there, standing on her crown with its soles a millimetre and a half proud of it.
Her head gives way under the weight: the rider is carried by a spring towards its
rest pose, node by node, which is how the trampoline holds whoever is bouncing on
it, and she is pressed down by a grab on her crown, which is how a poke works. The
sag is real rather than drawn.

Only one at a time goes up. Her crown fits one, and two riders aimed at the same
point stand inside each other.

**It sits on the desktop.** A soft contact shadow under the body, spreading and
fading as it hops. There is no floor to catch a real shadow, so the runtime projects
the body's footprint onto the floor plane and hands the composite a screen-space
ellipse, which goes straight into the window's alpha. `images/jelly-asleep.png` shows both
the sleeping face and the shadow.

The behaviour knobs are the constants at the top of `pet-demo.js`: `NOTICE`,
`PERSONAL`, `STARTLE`, `LINGER`, `IDLE_SLEEP`, `POKE`, `FAMILY`, `GAMES` and the
`TOY` block. For testing,
`globalThis.__petIdleSleep = 5` shortens the nap timer, `globalThis.__petToyGap =
[3, 4]` brings the toy out every few seconds and `globalThis.__petToyPlay = 4` cuts
the bouncing short; all three are read live.

Priority runs: a hand on the jelly, then sleep, then the toy, then the cursor, then
wandering. The toy beating the cursor is deliberate, since a pointer that has been
there all along is less interesting than something new on the floor, but it does mean
a busy mouse will not stop it going to play.

## Catching files

macOS decides a drag's destination when the drag begins, and a click-through
window is never a candidate, so the pet's own window can never be offered a file
however fast it reacts. A window that is solid from birth can, even transparent
and always on top, which is why Yoink's shelf works.

So a small catcher window rides on her: transparent, invisible, solid, sized to
her body and moved with her. It takes the drops and forwards its mouse events
back to the pet's window, so grabbing, poking and throwing still work through it.
The pet's own window is now click-through at all times and never toggles.

Putting her mouse events through another window broke dragging her, in three
separate ways that all look identical from the outside: she is let go partway and
the drag turns into a poke. Each one on its own is enough.

- `sendInputEvent` accepts a `button` but never sets the held-button mask, so a
  forwarded move arrives with nothing pressed. Forwarded moves carry
  `modifiers: ['leftButtonDown']`.
- Worse than either, the two streams fight over the pointer capture, because a
  forwarded real move and a synthesised one carry the same pointer id. The canvas
  takes the capture on the press and the next real move takes it away, so the
  canvas is told it has lost the pointer and lets go about a hundred pixels in.
  What is left is not nothing, which is why this one hid for so long: she keeps
  moving, because a loose pet walks towards the cursor. It reads as her drifting
  after the mouse instead of swinging from it, and she never arrives, because
  walking is slower than dragging and the far screen is a long way off. The
  capture is not needed here, since the shell's moves reach the canvas either
  way, so losing it is ignored for as long as a pointer is holding her.
- A click-through window is still sent the real mouse's movements, and a window
  that cannot be clicked is never told a button is down, so those arrive with
  nothing pressed either. Upstream reads a move with no button as proof the
  release went missing and lets go, which is right in a browser and wrong here:
  the real cursor moving is then enough to drop her, and dragging her across the
  desk moves the real cursor a great deal. They are stopped at the window, above
  the canvas listener that would act on them, and only while a pointer is holding
  her. A baby riding her crown is a grab on the body too, so the test is whether
  input has a pointer grab, not whether the body has any.
- The catcher rides on her and is moved sixteen times a second, so a position
  measured against it means nothing by the time the shell reads its bounds to
  convert it. She jerks about instead of following the cursor. The page reports
  `screenX` and `screenY` now: where the cursor is on the desk does not depend on
  where any window happens to be.
- A press pins the catcher where it is until the release. A dragged pet crosses
  from one display to the next, the window follows her over the boundary, and it
  changes screen and scale underneath the gesture it is carrying. Pinned, it
  stays on one display for as long as the drag lasts. A release that goes missing
  would leave it pinned for good, so four seconds of silence unpins it.

Growing the catcher to cover the whole desk for the duration of a press is a
worse answer to the same problem and was tried first. macOS moves a window that
has just grown past one display, a tenth of a second later and without being
asked, so the frame everything is measured against moves while it is being
measured.

Two things that look like fixes and are not. Switching the forwarding off during
a press stops the buttonless moves, but the events then reach the page without
landing on the canvas, so the grip is kept and she stops following instead. And
treating a move with nothing pressed as a lost release, to fold the catcher back
early, folds it back immediately: the moment it covers the desk the real cursor
is over it, and a cursor resting still with no button down is reported exactly
that way.

Two things cost a round each to find, both of them mine rather than the platform's:
a `data:` URL is an opaque origin and Chromium restricts file drops into those,
and a window at screen-saver level is not offered drags either. Served from the
app's own origin, at floating level, both a transparent and an opaque test window
took the file.

A dropped `File` no longer carries a path, only a name, and `webUtils.getPathForFile`
is the one way to ask for the path. It can only be called from a preload, so the
drop handler lives there rather than in the catcher's page.

## Taking one back out: the tray

Double-click her and her tray opens beside her: a slab of her own jelly with
every file she holds laid out flat as a card, newest first. Drag any card out, as
an ordinary macOS file drag, into Finder, a mail window, or whatever will take it.
Files can be dropped on the open tray to feed her, too, and a **Clear all** button
lets go of everything (screenshots are filed, other files are left where they are;
nothing is deleted). It is drawn from `tray.html`.

Files used to come out of her belly instead, and that was dropped. A card inside
her is seen through a thick lens, 50 to 70 pixels from where it really is and often
on her far side, so a press aimed at one picked her up instead; a "belly zone"
only ever gave back the newest file; and a press that might mean her or might mean
a file is a guess every time. In the tray a card is flat and is where it looks.
Now a press on her always means her.

How it behaves, and why:

- **She stands still** while it is open, or she walks off from it or behind it.
- **It grows and shrinks with what she holds,** away from her side and anchored at its
  bottom, up to five cards a row and four rows; past that the cards scroll. It is
  sized when it opens and again whenever a card comes or goes, so files dropped on
  the open tray fit.
- **Quick Look** (double-click a card, or Space over it) is the system panel, through
  `previewFile`. macOS counts that panel as another app becoming active, so while
  it is open, switching apps and the cursor being away do not close the tray, until
  the cursor comes back to it.
- **Its animation loop runs only while it is out** or on its way in or out. Left
  running, it drew an invisible slab sixty times a second for as long as she was
  awake, which cost as much as she does dozing.
- **Throwing one away**: a screenshot or recording goes to the Trash (Finder's Put
  Back restores it). A file she was fed from anywhere else is only let go of and
  stays where it was; moving someone's own file to the Trash from her tray would be
  a nasty surprise. The button's tooltip says which.
- **The slab is soft.** Its edge is a ring of springs that ripples when disturbed,
  and the whole slab squashes and rebounds: landing when it opens, giving under a
  card the cursor is on, jolting when a card is pulled out or a file dropped in.
  Her window-pane highlight is drawn over the cards, as on her belly, which is most
  of what makes it read as glossy. A page in a transparent window cannot blur what
  is behind the window, so it is a little more opaque than the mock-up.
- **The double-click is counted by the catcher,** not left to the browser. The first
  click is a poke, she jiggles, the catcher follows her, and macOS no longer pairs
  the two clicks. It opens on the second release.
- **It closes when you switch to another app, when the cursor has stayed off it for
  six seconds,** on Esc, on a second double-click, or when she is picked up or
  resized. Not on losing focus: a press on her is passed into her own window, and
  focus moving between her windows closed the tray the moment it appeared. Scripted
  clicks never move focus, which is why every test passed while it failed by hand.
- She gives a file up at the moment the drag begins rather than when it lands,
  because a native drag reports nothing back. The file on disk is untouched, and a
  cancelled drag can be dropped on her again.

The list of what she is holding lives in the shell, not in the page: the hand-over
happens inside a drag and there is no time to ask the page anything. The page is
told the list and draws it.

## One shelf on every desktop

This is where she is most useful. Two displays sit side by side, so a plain drag
already crosses between them. Desktops (Spaces) do not: to move a file from one
to another you have to hold the button while the desktop switches, and letting go
early drops it where you were. A full-screen app is its own desktop, so it has the
same problem.

She is shown on every desktop and over full-screen apps, so the file goes with you.
Feed her on one desktop, switch, double-click her, and drag it out of her tray on
the next. All three windows are set this way with
`setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })`: the pet's own, the
catcher, and the tray. If only the pet's window were set, she would show on the new
desktop but could not take a drop or hand a file back there.

## Catching screenshots

`screenshots.js` watches one folder: the one picked with **Screenshots → Choose
folder…** in her menu, or else wherever macOS saves screenshots (its
`com.apple.screencapture` setting, read at each start, or the Desktop). Each new
screenshot is swallowed within a second, its card showing the time it was taken, and
she is on every desktop, so it is closer than the Desktop was. After choosing a
folder she offers to make macOS save screenshots there too (what Cmd+Shift+5,
Options, Other Location does), since she only sees what lands in her folder.

How much is hers depends on **Screenshots → File into month folders**:

- **Off** (the default): the folder is shared, like the Desktop. Only files macOS
  marked as screenshots (the `kMDItemIsScreenCapture` attribute, set whatever the
  system language) are caught, plus crops she made, and nothing is ever moved. Screen
  recordings carry no such mark, so they are not caught.
- **On**: the folder is kept just for screenshots, such as
  `~/Pictures/Screenshots/Inbox`. Every picture and recording in it is caught
  (recordings show a purple video band and a frame of the video), and she files them
  into a folder per month **inside** it (`Inbox/2026-10/`): a minute after one is
  dragged out (the app it landed in may still be reading it), when it is no longer
  from today, when she holds more than twelve, or on Clear all. Switching it on
  asks first, and it is not offered for the home folder, Desktop, Documents or
  Downloads. Whoever had macOS saving to `~/Pictures/Screenshots/Inbox`, where the
  folder used to be fixed, starts with it on.

**Nothing is ever deleted, and nothing outside the folder is ever moved.**

- macOS writes a screenshot as a hidden file and renames it, so a name is only taken
  once it is visible and has stopped growing.
- "Taken" is the file's creation time, not its modification time, so marking one up
  does not move it to another day or month. Dates are local, not UTC: in Taipei a
  UTC "today" would roll over at 8 am.
- Changing the folder lets go of the cards from the old one; they are not filed.
- No folder, no watching: the shelf works as before. `JELLY_INBOX` points it at
  another folder, which is how it is tested.

## Catching downloads

`downloads.js` watches `~/Downloads` (`JELLY_DOWNLOADS` to point it elsewhere) and
feeds her each download as it finishes, ready to be dragged out of her tray. It is off
until switched on with **Fetch downloads** in her right-click menu (watching Downloads
makes macOS ask for access), kept in `jelly.json`.

- Only downloads that finish while she runs count. What is already in the folder is
  left alone, or she would swallow years of downloads at startup.
- Browsers write to a stand-in and rename it when done: Chrome `.crdownload`, Safari a
  `.download` bundle, Firefox `.part`. She ignores those, takes the final name once it
  is a regular file whose size has stopped changing, and ignores folders.
- **Downloads are the user's own files, not her captures.** She never moves or
  trashes them: the tray's trash button and Clear all only let go of them. She holds
  the eight newest and lets go of older ones.
- macOS protects `~/Downloads`; the first watch may ask for access. Without it, the
  terminal says `Downloads: cannot watch …`.

## Screenshots for AI apps: 1x copies and cropping

An AI app counts an image's tokens by its pixel area (Claude: ceil(w/28) x ceil(h/28),
capped at 4,784 on current models), not its file size, so compressing a PNG to JPEG
saves nothing. A Retina screenshot has twice the pixels each way that were on screen.
So every screenshot she catches gets a **1x copy** (72 dpi, the size it looked, made
by `sips` in the background next to its thumbnail), and dragging a screenshot out of
the tray hands over that copy: 3024x1964 becomes 1512x982, about 4,760 tokens down to
1,944. A screenshot already at 72 dpi (from a 1x external display) goes out as it is.
The original is never changed. **Screenshots → Shrink to 1× when taken out** in her menu
turns it off; the card's tooltip says what it will drag out as. Files she was fed are
never shrunk.

Cropping is per screenshot, when wanted: the crop button on a screenshot card (or C
over it) opens `crop.html` in a window of her jelly, 80% of the screen, above her.
Drag out an area, adjust it by its corners, Enter to save. `sips` crops the original
into `… (cropped).png` beside it, at full resolution and 144 dpi, so the inbox catches
it as a new card with its own 1x copy. The picture is served to the crop page by a
one-off token (`/file/<token>`), so the page can load that file and no other. While the
crop window is open the tray stays open, as for Quick Look.

## Her language

She speaks English or Traditional Chinese: whatever the system prefers first
(Traditional Chinese for zh-Hant, zh-TW, zh-HK and zh-MO, English for everything else,
Simplified Chinese included), or what is picked under **Language** in her menu, kept in
`jelly.json`. Her menus, dialogs, tray, crop window, loading line and macOS's
folder-access prompts are translated; her log stays in English.

- Every string is in `i18n.js`. The shell uses it directly; the tray and crop pages are
  handed their table as `window.jellyWords` when they are served, so a change of
  language re-serves the tray. The loading line changes at the next start.
- The game's own loading steps are English only, so in Chinese the pill shows just
  「Jelly 正在醒來」.
- Adding a language is a table in `i18n.js`, an entry in `LANGUAGES`, a test in
  `fromSystem`, and an `.lproj` with `InfoPlist.strings` listed in `extraResources`.

## Her size

Two-finger scroll or pinch over her (Chromium reports a pinch as a scroll with Ctrl
held) makes her bigger or smaller, from half to two and a half times, and the size is
kept between runs in `jelly.json` in the app's user-data folder.

Her size is the lens, not her body: a narrower lens makes her and everything with her
bigger and leaves the physics alone. A lens zooms towards the middle of the screen, so
after every step the camera is slid along the floor until the spot she stands on lands
on the same pixel as before; her feet stay where they were.

The render loop skips frames while her body is at rest and nobody holds her, and a
resize changes only the camera, so it has to ask to be drawn. Before it did, every
number said she had grown and every capture showed her the same size.

## Staying out of your way

Wherever she stands, the catcher on top of her takes the clicks, so a pet that
wanders can sit on the button you are about to press. Twice a second the shell looks
at how long you have left the keyboard and mouse alone, and which screen the cursor
is on, and tells her one of three things:

| you | her | she |
| --- | --- | --- |
| using the computer | on the screen with the cursor | stays put |
| using the computer | on another screen | wanders, but only on her own screen |
| away for a minute | anywhere | wanders anywhere |

Staying put is not standing still. She keeps a spot, the place she settled or was put
down, and fidgets on it every few seconds, a turn or a shuffle or a hop, drifting back
if she has wandered off it. The babies keep coming to her and the trampoline stays
away. That needs the scene kept running (standing still let the render loop skip
everything, babies included), which costs about twice as much, so after a minute with
nothing near her she dozes off where she is (about 18% CPU, against 60-80% awake).
Only a cursor that comes up to her, a poke, or picking her up wakes her; a cursor busy
elsewhere on her screen does not.

While she stays awake she is drawn at 20 fps instead of 30, but only once the whole
family has been still for 1.2 s: anything moving (a baby walking or climbing, her own
fidget settling, the cursor coming near) is at the full rate, or it looks sluggish.
The rate comes from `__petFrameMs`, which the game's frame loop reads; it goes no
lower than 20 fps because each frame advances her physics by at most 50 ms. Her
physics runs at a fixed 240 Hz however many frames are drawn, so this saves less
than it sounds: the real saving is dozing.

A baby riding on her head holds on with grabs on her body, and only *your* grabs
(`input.grabs`, or a poke) count as a hand on her. Counting every grab kept her at
full rate and never dozing for as long as a baby rode there.

## Pinned to a spot

Right-click her and choose **Pin here**, and she stays on her spot whatever you are
doing: idle or not, whichever screen the cursor is on. It is the same staying put as
above (fidgets, babies, no trampoline, dozing after a minute), only always.
Dragging her moves the spot and she stays pinned; right-clicking again unpins her.

- The spot is kept in `jelly.json` with her size, **in desk pixels** at her feet, not
  in floor metres: resizing slides the camera, so a floor position would land
  somewhere else on screen after a restart. At startup she walks back to it; a spot
  on a screen that is no longer connected unpins her.
- Only the left button picks her up. The shell passes every press on as a left
  click, so a right-click used to grab her.
- Her window sits at screen-saver level, above where macOS draws menus, so it
  covered her own menu. It steps down to floating while the menu is open and back
  up when it closes.

## Showing what she has swallowed

Her material is fully transmissive, which in three means it samples the framebuffer
as it stands at the moment she is drawn. Anything opaque is drawn before her, so
anything opaque placed inside her body is inside her on screen too: refracted,
tinted, blurred by her roughness, for no shader work at all. Her eyes have always
worked this way. The word that matters is opaque: a cut-out icon with an alpha edge
sorts into the transparent pass, which runs after her, and never reaches the
backdrop she refracts. So the picture is composited onto a solid card first.

Three things had to be right before a card read as a file rather than a smear.

**Brightness is not the dial.** What she does to anything behind her is a multiply
by `exp(-absorption * thickness)`, which for this pink is about (0.98, 0.30, 0.58):
the green is all but gone. Turning the card up lifts all three channels together
and the ratio between them is the whole problem, so a brighter card is a brighter
pink smear. Dividing the card's own emission by that same figure puts the colour
back. Two of the three numbers come out above one, which the tone mapping folds
towards white rather than clipping. `Shelf.setFlavor` recomputes it, so a lime pet
corrects for lime.

**A preview does not read at thirty pixels.** She is about two hundred pixels tall
on screen and a card inside her is thirty, which is room for four bold letters and
no room for the first slide of somebody's deck. Each card carries a coloured band
naming what the thing is, with the preview above it as the reward for looking
closely.

**The card rides the skin, not her centre.** One sampler lookup per frame gives the
deformed belly surface at a fixed rest-space spot, and the card hangs a few
millimetres inside it along the normal. It leans when she leans and sinks when she
is squashed, because it is reading the triangles the solver just moved. `FaceSkin`
already did this for her eyes and mouth; it now takes a window so the belly can be
indexed too.

Previews come from `qlmanage`, QuickLook's own command line tool. Electron's
`app.getFileIcon` and `nativeImage.createThumbnailFromPath` both wedge the main
process solid here: not a rejection, a hang, with the timer queue frozen behind
them, so the pet stops moving. A separate process can be given a deadline and
killed, and what QuickLook returns is better anyway: the first slide of a deck, the
picture itself for a picture. It hangs on directories, so those never reach it.

## Changing how it looks

The pet ships pink (`images/jelly-pink.png`). Set `FLAVOUR` at the top of `pet-demo.js` to
pink, lime, strawberry, blueberry or lemon.

Flavours live in `src/graphics/character/jelly-flavors.ts` upstream, as a surface
colour plus three absorption coefficients. The material turns the absorption into an
attenuation colour over 3.5 cm of jelly, so a flavour is not a hex code: pick the
colour you want light to be after it has crossed the body, then set each coefficient
to `-ln(target) / 0.035`. Pink is `[0.6, 34.4, 15.6]`, which is a transmitted
(0.98, 0.30, 0.58). Adding or editing a flavour there needs a rebuild of `app/`.

The face is separate. Its colours are fixed in `baby-face.ts` upstream and are not
part of a flavour, and the stock greens clash badly on a pink body, so `BERRY_FACE`
in `pet-demo.js` retints them at startup: plum eyes, a berry mouth, a pink tongue and
coral cheeks. Doing that properly upstream would mean extending the flavour type to
carry face colours.

Shape is a rebuild but not a hard one. The body is not a sculpted model: it is ten
Gaussian metaballs in `refs/jelly_baby_mesh.html` upstream, each an ellipsoid with a
centre, three radii, a strength and a sharpness, summed into a field whose 0.42
contour is the skin, with the base flattened by a plane. `npm run build:model` walks
that field with marching tetrahedra and regenerates everything downstream, the
72k-vertex skin, the tetrahedral physics cage, the floor contact points and the
optical proxy, in about three seconds. Moving the arm centres out and thickening the
crown, two numbers each, produces a visibly different creature that still walks,
wobbles and can be thrown, because the cage is derived from the same field.

Replacing the body with an imported model is the harder path: the cage, the contact
bindings, the face's rest-space lookup and the optical proxy are all generated from
the implicit field, so an arbitrary GLB would need its own tetrahedralisation.

## What is in here

| File | What it does |
| --- | --- |
| `main.js` | Electron shell: serves `app/`, the pet's window, the catcher, the tray, what she holds, where she may roam |
| `preload.js` | The one bridge between the pages and the shell |
| `pet-demo.js` | Injected into the page: places the camera and sizes her, wanders the floor, stays put, hit-tests the body |
| `screenshots.js` | Watches the screenshot folder; files screenshots and recordings into month folders when asked |
| `downloads.js` | Feeds her downloads as they finish; never moves them |
| `i18n.js` | Everything she says to people, in English and Traditional Chinese |
| `build/zh_TW.lproj/` | The Traditional Chinese lines macOS shows when it asks for folder access |
| `build/` | The app icon (`icon.icns`, from `icon-1024.png`) |
| `icons/` | Her menu-bar icon, a template image macOS tints |
| `tray.html` | The tray: her cards spread out flat on a soft slab of her jelly |
| `crop.html` | Cropping one screenshot: the picture large, a selection, Enter to save a copy |
| `app/` | Prebuilt Jelly Baby with the patch below applied (18 MB) |
| `jelly-transparent.diff` | The patch, against a fresh clone of the upstream repo |
| `upstream/shelf.ts` | New upstream file: the cards she carries inside her |
| `upstream/babies.ts` | New upstream file: the small jellies |
| `images/jelly-transparent.png` | Captured window, showing the alpha cutout |
| `images/jelly-pink.png` | The pink pet as it ships |
| `images/jelly-asleep.png` | Asleep, over a plain desktop, showing the contact shadow |
| `images/jelly-toy.png` | Walking over to the trampoline, both contact shadows visible |
| `images/jelly-poke.png` | Resting, and mid-poke |
| `images/jelly-family.png` | The mother and three babies on the move |
| `images/jelly-trampoline.png` | The babies on the trampoline, mother watching |
| `images/jelly-stack.png` | A baby riding on her head |
| `images/jelly-shelf.png` | Three swallowed files, seen through her |
| `carry-icon.png` | The drag icon for a file with no preview of its own |

## What it costs

Measured on an M1 Pro, full screen, 30 fps cap:

| State | CPU across all processes |
| --- | ---: |
| Resting between wanders, nothing drawn at all | 8 % |
| Dozing, drawing the sleep bubble at 3 fps | 17 % |
| Awake: walking, or still wobbling after a walk | 67 % |
| The same with three babies also walking | 82 % |
| Awake, before the tabletop optics were dropped | 103 % |

Almost all of it is the renderer process, not the GPU process, which sits at 12 %.
Window size barely matters: the cost is the 240 Hz solver plus the per-frame skin
deform and face rebuild, so a bigger window is nearly free and a busier pet is not.
Hence the long rests in the wander loop, and the sleep skip in the patch.

Memory, measured 2026-10-03 with macOS `footprint` (what Activity Monitor shows),
one screen, awake, all of her processes together:

| Build | Total | GPU process | Her page |
| --- | ---: | ---: | ---: |
| As it was, 4M-pixel budget, hidden worlds compiled | 1,340–1,410 MB | 900–930 MB | 310–330 MB |
| 2M-pixel budget, hidden worlds left out of the scene | 1,020–1,060 MB | 580–610 MB | 290–320 MB |

Most of it is the GPU process: every render target in the pipeline is the size of
the drawing buffer, so the pixel budget in `renderer.ts` is the biggest lever (4M
pixels cost about 930 MB there, 2M about 560 MB, 1M about 460 MB, where her outline
starts to step). The other lever was the original game's home world (the portal, the
bed, the dressing table), built and hidden but switched on by the shader warm-up and
uploaded: 59 meshes and 215k vertices, three times her own. The shell is not the
cost. The same build in WKWebView, the engine Tauri would use, came to about 1.2 GB
for her page alone and took 31 s to start instead of 4.

## Making a release

`npm run release` (`scripts/build-dmg.sh`) builds `dist-release/Jelly-<version>-arm64.dmg`,
signed, notarized and stapled, so it opens on any Apple Silicon Mac with no warning,
offline too. It needs a Developer ID Application certificate in the login keychain and a
`notarytool` keychain profile named by `NOTARY_PROFILE`
(`NOTARY_PROFILE=<profile> npm run release`). Steps: build
and sign with `electron-builder.release.cjs` (hardened runtime, Apple timestamp, the JIT
entitlements in `build/entitlements.mac.plist`), check the bundle holds nothing stray,
notarize and staple the app, build the `.dmg` from it with an Applications link,
notarize and staple that, then ask Gatekeeper and write the SHA-256 beside it.
`--skip-build` reuses the last app. Apple Silicon only for now: no Intel Mac to test on.

## Rebuilding `app/` from source

```sh
git clone https://github.com/scottstts/Jelly-Baby.git
cd Jelly-Baby && git checkout 41ad7d1                # the patch is against this commit
npm install
git apply ../jelly-transparent.diff
cp ../upstream/*.mjs scripts/                     # the baby-jelly build and its benchmark
cp ../upstream/babies.ts ../upstream/shelf.ts src/app/   # small jellies, and the file shelf
node --experimental-strip-types scripts/build-baby-model.mjs 0.028 0.005
npx vite build --base ./ --outDir dist-pet
rm -rf ../app && cp -R dist-pet ../app
rm -f ../app/assets/wood_* ../app/og_image.png    # nothing loads these once the table is gone
rm -f ../app/assets/night-*.exr                   # night mode is never switched on; source unknown (NOTICE.md)
```

`build-baby-model.mjs` writes a second model from the same implicit shape at a
given height and cage spacing. Scaling the mother down would keep all 4,026 of her
elements and cost as much as she does; at 40% and a 5 mm lattice a baby is 327
particles, 1,134 elements and 17,674 vertices, which is 2.31 ms of solver and skin
against her 8.25 ms. `bench-baby.mjs` prints that comparison.

The patch does not apply to upstream's newer commits (a filmic compositor and mobile
changes landed after it was made), so it is pinned to `41ad7d1`; the commit was found
by matching each file's `index` line in the patch against upstream's history.

To try a build without replacing `app/`, run the shell with `JELLY_APP=path/to/dist-pet
npm start`. `__petPixelBudget` set in the page before it starts overrides the budget.

## What the patch changes

- `renderer.ts`: `alpha:false` becomes `alpha:true`.
- `composite.ts`: take the window's alpha from the scene-pass depth buffer, so the
  opaque backdrop still feeds the transmission material but never reaches the screen.
  Without this the jelly renders black, because transmission has nothing to refract.
- `runtime.ts`: stub out the tabletop, hide every other scene child, drop the
  per-frame shadow, caustic and light-transport work that only existed to paint that
  tabletop, cap to 30 fps, and skip all GPU work while the body is asleep.
- `input.ts`: a `fixedCamera` flag, so the camera stops following the body and the
  body walks across the frame instead.
- `runtime.ts` again, for the behaviour: a `__petSleeping` flag the shell can set,
  which puts the face to sleep without a bed, drops the frame rate to 3 fps and stops
  solving a body that cannot move; plus the contact shadow's footprint, projected
  every frame.
- `runtime.ts` and `trampoline/facility.ts` for the toy: the trampoline is the only
  facility registered with the manager, it hangs off the main scene so the shell can
  reveal it, its visual group is exposed so the shell can scale it, and the manager
  starts disabled. An unregistered facility never runs afterStep, which is what keeps
  the swing, bed and dressing table from pushing the body around with invisible
  collision barriers while staying built.
- `shelf.ts`, new: an opaque card per swallowed file, painted from a QuickLook
  preview and a type band, bound to the belly skin, with its emission pre-divided by
  the flavour's absorption so it arrives through her looking like itself.
- `face-skin.ts`: the sampler takes a window, so the belly can be indexed as well as
  the face. It was hard-coded to the patch the eyes and mouth live in.
- `composite.ts` again: two shadow ellipses now, one for the body and one for the toy.
  Each is composited into the window's alpha. It
  contributes alpha only. A tinted shadow would have to survive the AgX and sRGB
  transforms that run after the composite, which premultiplied colour does not, and
  it comes out pale enough to read as a highlight.

## Known rough edges

These are demo shortcuts, not the shape the real thing should take.

- A poke presses the front shell in with the same constraint dragging uses. Three
  things had to be right before it read as a poke at all. A one-frame shove is gone
  before the next frame is drawn, so the press is held rather than thrown. Pressing a
  ball of material that includes the far side of the body moves the whole jelly, so
  only nodes facing the camera are bound. And pressing along the line of sight
  squashes the body towards its far side, where pressing along the surface normal
  dents the skin the way a finger does.
- Raising the grab force cap does nothing for it, twice measured. Depth and area are
  what the material responds to; force saturates well below the cap.
- The visible squash is drawn, not simulated. A pet is watched at a size where honest
  soft-body response does not carry.
- Everything the bed does to a rider is a force tuned for a 190 g jelly: the spring,
  the damping and the ceiling on its pump. Scaling only the spring for a 12 g rider
  leaves the damping eating the pump almost exactly, and a baby buzzes on the spot
  instead of bouncing. All three scale together now.
- A grab is the wrong tool for holding a baby. At 2.8 N against 12 g it is a hundred
  times what the job needs, and aimed at an arm it pulls the arm out rather than
  turning the body. Carrying is a per-node spring instead, which cannot tear anything
  and pins the orientation for free.
- A baby on her head is held there rather than balanced there. Bodies do not collide
  with each other in this codebase at all: the collision system resolves a cage
  against boxes and cylinders, and nothing else. Holding the rider with a grab and
  pressing her crown with another buys the whole picture for two constraints, and it
  cannot fall off, which is either a feature or the next thing to fix.
- Anything perched on a body has to be measured from the skin, not the cage. The
  visible surface stands proud of the lattice by up to half a cell, which is several
  millimetres on her, and a baby aimed at the cage crown sits buried to the ears. Two things had to be true for it to be visible at all: a
  one-frame shove is gone before the next frame is drawn, since the solver restores
  the shape in between, and pressing a ball of material that includes the far side
  of the body shoves the whole jelly instead of denting it. Only nodes facing the
  camera are pressed, and the default grab force turned out to be plenty.
- The hit test is a projected disc around the body's centre, not its actual outline.
  The project already builds a BVH over the skin for grabbing; use that instead.
- Wandering works by dispatching synthetic key events, which keeps the real input path
  honest but is not where behaviour belongs. Eight-way steering also means the jelly
  can circle a destination, so it gives up on one after nine seconds.
- The window covers the menu bar, harmlessly, since clicks pass through. The
  walkable area stops well short of the top of the screen.
- A drag across the seam between two displays used to fail occasionally. Two causes
  are closed and it has not recurred.
- The tray is pink whatever flavour she is; it does not follow `FLAVOUR` yet.
- Each click of the double-click that opens the tray is also a poke.
- The babies are drawn above the tray, and can walk over it.
- With filing on, a screenshot from before today is filed as soon as she sees it, so
  the morning after, yesterday's are in their month folder, not in the tray.
- `globalThis.__petDebug()` in the page reports what the wander loop is doing, and
  where she may roam.
