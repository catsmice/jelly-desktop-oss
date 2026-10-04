// Injected into the page once it is playing. Four jobs: turn the desktop into a
// floor the jelly can walk around on, give it somewhere to go, let it notice the
// cursor and doze off without one, and report hits so the shell can open a hole
// in the click-through window.
//
// Globals on the page, all named __pet*:
// - The bridge to the patched game, which reads them every frame: __petWake,
//   __petSleeping, __petFrameMs, __petViewport and __petPixelBudget.
// - Hooks for testing her from a script (webContents.executeJavaScript), never
//   used by the shell: __petDebug (a snapshot of her state), __petProbe, __petArea,
//   __petCarrying, __petCue, __petPoke, __petPokeTuning and __petLastPoke, and
//   overrides for timings that are too long to wait for: __petFollow,
//   __petIdleSleep, __petStayDoze, __petStayFrameMs, __petToyGap and __petToyPlay.
//   They live only in her own page, which nothing outside the app can reach.
(() => {
  // The desktop is seen the way the browser game sees its tabletop: a long lens
  // looking down at a shallow angle, so walking away from you moves the jelly up
  // the screen and shrinks it.
  const LENS = 14;      // degrees of vertical field of view
  const EYE = 1.0;      // metres above the floor
  const PITCH = 30;     // degrees below horizontal
  const MARGIN = { x: .78, near: -.84, far: .45 };  // how much of the screen is walkable
  const FLAVOUR = 'pink';  // pink, lime, strawberry, blueberry or lemon
  // How big she can be made, as a multiple of her size through the lens above.
  const SIZE = { min: .5, max: 2.5 };

  // Walking to the cursor is off: a pet that comes to meet you is a moving target
  // when you are trying to drop a file on it. She still wakes for a cursor, she
  // just does not chase one. Turn this on to get the attention behaviour, and the
  // startle hop with it.
  const FOLLOW_CURSOR = false;   // globalThis.__petFollow overrides it live

  // All distances in metres on the floor plane; the body itself is 7 cm tall.
  const NOTICE = .30;     // cursor this close is worth walking over to
  const PERSONAL = .06;   // and this close is close enough
  const STARTLE = .05;    // a fast sweep this close makes it hop
  const LINGER = 4000;    // ms a still cursor stays interesting
  const IDLE_SLEEP = 90;  // seconds without the cursor before it dozes off
  // Staying put on the screen you are working on, she is kept running so she
  // can fidget, which costs about twice what standing still did. So after this
  // long with nothing coming near her she dozes off where she is, and only a
  // cursor this close to her (or a poke, or picking her up) wakes her again.
  // While she is awake and only fidgeting she is also drawn at 20 fps rather
  // than 30 (STAY_FRAME_MS); anything bigger, like being held, is back at 30.
  const STAY_DOZE = 60;   // seconds; globalThis.__petStayDoze overrides it
  const NEAR = .10;       // metres from her centre
  const STAY_FRAME_MS = 48;  // 20 fps; globalThis.__petStayFrameMs overrides it

  // The toy comes out on its own, gets played with, and goes away again.
  const TOY = {
    gap: [45, 120],   // seconds of ordinary life between visits
    pop: 650,         // ms to appear or vanish
    patience: 25,     // seconds to reach it before it gives up and leaves
    play: 16,         // seconds of bouncing
    approach: .125,   // metres: close enough to climb on
  };

  // The babies walk in a loose line behind their mother. Each has its own soft
  // body and its own rig, so following is a matter of telling it where to stand
  // and letting the same gait carry it there.
  const FAMILY = {
    gap: .06,        // metres from the mother to the first in line
    spacing: .045,   // and between each one after
    stagger: .028,   // side to side, so they are not single file
    arrive: .02,     // close enough to stop walking
    hurry: .07,      // past this they go at full pace rather than ambling
  };

  // Idle games. A baby that has nothing to do wanders a little way off and comes
  // back, or climbs onto its mother's head and sits there until it gets bored.
  const GAMES = {
    chance: .01,     // per tick, per baby, while everyone is idle
    explore: [3, 7], // seconds spent wandering off
    ride: [7, 14],   // seconds spent sitting on her head
    reach: .10,      // how far off a baby will wander
    sag: .007,       // metres her head gives way under one
    perch: .009,     // clearance between her crown and a baby's soles
    hop: .32,        // the push it gets on the way down
  };

  // The face is drawn in its own small meshes with fixed colours, which are not
  // part of a flavour upstream: the stock green reads as a clash on a pink body.
  const BERRY_FACE = {
    '#142905': '#3a1024',   // eyes -> dark plum
    '#254508': '#7a1739',   // mouth and brows -> berry
    '#b5d641': '#ff9dbe',   // tongue -> pink
    '#edab4f': '#ff7d9e',   // blush -> coral
  };

  const waiting = setInterval(() => {
    const jelly = globalThis.__jelly;
    if (!jelly) return;
    clearInterval(waiting);
    start(jelly);
  }, 150);

  function start(jelly) {
    const { body, baby, camera, input, renderer } = jelly;
    if (FLAVOUR !== 'lime') baby.setFlavor(FLAVOUR);
    // Whatever she is made of decides what a card inside her has to fight.
    jelly.shelf?.setFlavor(FLAVOUR);
    if (FLAVOUR === 'pink') {
      baby.group.traverse(part => {
        const wanted = part.isMesh && part.material && part.material.color
          && BERRY_FACE['#' + part.material.color.getHexString()];
        if (wanted) part.material.color.set(wanted);
      });
    }
    const scratch = body.center.clone();
    const heading = body.center.clone();

    // A pet does not orbit: park the camera, and keep parking it. The app's own
    // resize handler restores the tabletop lens and polar limit on every resize.
    input.fixedCamera = true;
    input.controls.enableRotate = false;
    input.controls.enableZoom = false;
    input.controls.maxDistance = 8;

    // Where a point on the screen lands on the floor plane. This lays out the
    // walkable area, and turns the cursor into a place the jelly can walk to.
    const floorAt = (ndcX, ndcY) => {
      const ray = scratch.set(ndcX, ndcY, .5).unproject(camera).sub(camera.position).normalize();
      if (ray.y > -1e-4) return null;
      const t = -camera.position.y / ray.y;
      return { x: camera.position.x + ray.x * t, z: camera.position.z + ray.z * t };
    };

    let area = null;
    // Her size is the lens, not her body: a narrower lens makes her and
    // everything with her bigger, and leaves the physics alone. The camera is
    // also slid along the floor by `offset`, so that a resize keeps her where
    // she stands on screen rather than zooming her towards the middle.
    let size = 1, shownSize = 1;
    const offset = { x: 0, z: 0 };
    const lens = () => 2 * Math.atan(Math.tan(LENS / 2 * Math.PI / 180) / shownSize) * 180 / Math.PI;
    const frame = () => {
      input.controls.maxPolarAngle = Math.PI / 2 - .02;
      camera.fov = lens();
      // The browser game views the body from 25 cm, so a 1 mm near plane is fine
      // there. From two metres away it leaves the face patches, which float two
      // tenths of a millimetre above the skin, sharing one depth code with it:
      // the mouth and tongue then flicker as the body wobbles. Nothing here is
      // ever closer than about 1.7 m, so the near plane can move a long way out.
      camera.near = .6;
      camera.far = 8;
      camera.position.set(offset.x, EYE, EYE / Math.tan(PITCH * Math.PI / 180) + offset.z);
      input.controls.target.set(offset.x, 0, offset.z);
      input.controls.update();
      camera.updateProjectionMatrix();
      camera.updateMatrixWorld(true);
      const corners = [
        floorAt(-MARGIN.x, MARGIN.far), floorAt(MARGIN.x, MARGIN.far),
        floorAt(-MARGIN.x, MARGIN.near), floorAt(MARGIN.x, MARGIN.near),
      ];
      if (corners.every(Boolean)) area = corners;
    };
    frame();

    // Resizing. Scroll or pinch over her sets a target; the lens eases towards
    // it, and after every step the camera is slid so the spot she stands on
    // lands on the same pixel as before.
    const resizeBy = (delta, pinch) => {
      size = Math.min(SIZE.max, Math.max(SIZE.min, size * Math.exp(-delta * (pinch ? .008 : .0025))));
      saveSoon();
    };
    let saving = 0;
    const saveSoon = () => { clearTimeout(saving); saving = setTimeout(() => window.pet?.saveSize?.(size), 600); };
    // Only the camera changes, and the render loop skips frames while her body
    // is at rest and nobody holds her, so a resize has to ask to be drawn: every
    // step, and for a moment after the last one so the final size lands.
    let drawUntil = 0;
    const easeSize = () => {
      if (performance.now() < drawUntil) globalThis.__petWake = true;
      if (Math.abs(size - shownSize) > 1e-4) {
        globalThis.__petWake = true;
        drawUntil = performance.now() + 400;
        const foot = scratch.set(body.center.x, 0, body.center.z).project(camera);
        const ndc = { x: foot.x, y: foot.y };
        shownSize += (size - shownSize) * .25;
        if (Math.abs(size - shownSize) < 1e-3) shownSize = size;
        frame();
        const now = floorAt(ndc.x, ndc.y);
        if (now) { offset.x += body.center.x - now.x; offset.z += body.center.z - now.z; frame(); }
      }
      requestAnimationFrame(easeSize);
    };
    requestAnimationFrame(easeSize);
    window.pet?.onZoom?.((delta, pinch) => { wake(performance.now()); resizeBy(delta, pinch); });
    window.pet?.onSize?.(saved => {
      if (!(saved > 0)) return;
      size = shownSize = Math.min(SIZE.max, Math.max(SIZE.min, saved));
      frame();
    });
    // The app re-fits the camera whenever the viewport resizes, and its fit is
    // the browser game's, not this one. Framing is re-imposed after it every
    // time. The canvas itself is desk-sized and never resizes, so it is the
    // viewport that has to be watched: a window hopping between displays
    // resizes that, and left alone the lens would stay at the app's wide
    // default from the first hop on, and she would be a third her size.
    for (const watched of [renderer.domElement, document.querySelector('#viewport')]) {
      if (watched) new ResizeObserver(() => requestAnimationFrame(frame)).observe(watched);
    }

    // The floor is the whole desk, every display together, and the canvas is
    // that size. The window is only ever one display's worth of it: macOS
    // paints a window on a single display, whatever bounds it was given, so a
    // window spanning two shows on one and is invisible on the other. Instead
    // the shell keeps the window on whichever display she is on and tells the
    // page where that window sits on the desk, and the canvas is slid so that
    // the window shows its own slice. Nothing in the scene moves at the seam.
    const canvas = renderer.domElement;
    const desk = { width: innerWidth, height: innerHeight, x: 0, y: 0 };
    const applyView = () => {
      globalThis.__petViewport = { width: desk.width, height: desk.height };
      canvas.style.cssText = `position:fixed;left:${-desk.x}px;top:${-desk.y}px;`
        + `width:${desk.width}px;height:${desk.height}px;touch-action:none;outline:none;display:block`;
      jelly.resize?.();
      frame();
    };
    window.pet?.onView?.(view => { Object.assign(desk, view); applyView(); });

    // The real screens, in desk pixels. Two screens of different heights leave a
    // strip along the bottom of the shorter one that is on no screen at all.
    let screens = [];
    window.pet?.onScreens?.(rects => { screens = rects; });
    // A floor point in desk pixels: canvas pixels, since the canvas is the desk.
    const deskAt = (x, y, z) => {
      const at = scratch.set(x, y, z).project(camera);
      return [(at.x * .5 + .5) * desk.width, (-at.y * .5 + .5) * desk.height];
    };
    const onScreen = (x, z) => {
      if (screens.length < 2) return true;
      const [px, py] = deskAt(x, 0, z);
      return screens.some(one =>
        px >= one.x && px < one.x + one.width && py >= one.y && py < one.y + one.height);
    };

    // A point somewhere in the walkable area. The far edge covers more ground
    // than the near edge, so interpolate the corners rather than use a rectangle.
    const anywhere = () => {
      const [farLeft, farRight, nearLeft, nearRight] = area;
      const depth = Math.random(), across = Math.random();
      const left = {
        x: farLeft.x + (nearLeft.x - farLeft.x) * depth,
        z: farLeft.z + (nearLeft.z - farLeft.z) * depth,
      };
      const right = {
        x: farRight.x + (nearRight.x - farRight.x) * depth,
        z: farRight.z + (nearRight.z - farRight.z) * depth,
      };
      return { x: left.x + (right.x - left.x) * across, z: left.z + (right.z - left.z) * across };
    };
    // Somewhere she can actually be seen. A few tries is plenty: the gap between
    // two screens is a small share of the floor, and the fallback is only as bad
    // as walking into it once.
    // Where she may go depends on what you are doing; the shell decides and says
    // so. 'free': anywhere, as always. 'stay': she is on the screen you are
    // working on, so she stays put. 'local': you are working on another screen,
    // so she may wander, but only on her own.
    let roam = { mode: 'free', screen: null };
    const onRoamScreen = (x, z) => {
      if (roam.mode !== 'local' || !roam.screen) return true;
      const [px, py] = deskAt(x, 0, z), r = roam.screen;
      return px >= r.x + 40 && px < r.x + r.width - 40 && py >= r.y && py < r.y + r.height;
    };
    window.pet?.onRoam?.(next => { roam = next; });
    const somewhere = () => {
      let pick = anywhere();
      for (let tries = 0; tries < 40 && !(onScreen(pick.x, pick.z) && onRoamScreen(pick.x, pick.z)); tries++) pick = anywhere();
      return pick;
    };

    // The nearest place on the floor it is allowed to stand. A cursor out over the
    // menu bar still pulls it that way, as far as the walkable area lets it go.
    const clampToArea = point => {
      const [farLeft, farRight, nearLeft, nearRight] = area;
      const depth = Math.min(1, Math.max(0, (point.z - farLeft.z) / (nearLeft.z - farLeft.z)));
      const left = farLeft.x + (nearLeft.x - farLeft.x) * depth;
      const right = farRight.x + (nearRight.x - farRight.x) * depth;
      return {
        x: Math.min(right, Math.max(left, point.x)),
        z: farLeft.z + (nearLeft.z - farLeft.z) * depth,
      };
    };

    // Drive the real input path rather than poking the rig, so walking, turning
    // and the gait behave exactly as they do under a human's hands.
    // Dispatched on an element, not on window: the handler asks the target for
    // its closest form field, and window has no such method.
    const press = (code, down) =>
      document.body.dispatchEvent(new KeyboardEvent(down ? 'keydown' : 'keyup', { code, bubbles: true }));

    const held = new Set();
    const hold = codes => {
      for (const code of held) if (!codes.has(code)) { press(code, false); held.delete(code); }
      for (const code of codes) if (!held.has(code)) { press(code, true); held.add(code); }
      globalThis.__petWake = held.size > 0;
    };
    const stand = () => hold(new Set());

    // Walking is camera-relative, so translate "go there" into the key
    // combinations a person would hold.
    const walkToward = (dx, dz) => {
      const distance = Math.hypot(dx, dz) || 1;
      camera.getWorldDirection(heading);
      heading.y = 0;
      heading.normalize();
      const ahead = (dx * heading.x + dz * heading.z) / distance;
      const across = (dx * -heading.z + dz * heading.x) / distance;
      const codes = new Set();
      if (ahead > .38) codes.add('KeyW'); else if (ahead < -.38) codes.add('KeyS');
      if (across > .38) codes.add('KeyD'); else if (across < -.38) codes.add('KeyA');
      hold(codes);
    };

    // The window forwards every mouse move on the screen, even while it is
    // clicking through, so the cursor is a first-class thing the pet can see.
    let pointer = null;      // where the cursor lands on the floor
    let pointerAt = 0;       // when it last moved
    let pointerSpeed = 0;    // screen pixels per second
    let lastSeen = { x: 0, y: 0, at: 0 };
    let asleep = false;
    let wokeAt = 0;
    let startledAt = 0;
    let destination = null;
    // Staying put: the spot she keeps, and her next fidget on it.
    let spot = null, wasHeld = false, fidgetAt = 0, fidgetUntil = 0, fidget = { dx: 0, dz: 0 };
    let stayAwakeSince = 0;   // when she last had a reason to be awake while staying
    // Whether anyone in the family has moved since the last look, by more than a
    // couple of millimetres: her, or any baby. Checked once a tick.
    const CALM_MS = 1200;     // still this long before dropping to 20 fps
    let stillSince = 0, lastPlaces = null;
    const familyMoved = () => {
      const now = [body, ...babies.map(cub => cub.body)].map(b => [b.center.x, b.center.y, b.center.z]);
      const moved = !lastPlaces || now.some((p, i) => Math.hypot(p[0] - lastPlaces[i][0], p[1] - lastPlaces[i][1], p[2] - lastPlaces[i][2]) > .002);
      lastPlaces = now;
      return moved;
    };
    // Pinned: she stays on her spot always, whatever you are doing. Moving her
    // moves the spot. The shell keeps it, in desk pixels, between runs.
    let pinned = false, homeward = null, homewardUntil = 0;
    const staying = () => pinned || roam.mode === 'stay';
    window.pet?.onPin?.(pin => {
      const was = pinned;
      pinned = !!pin.on;
      spot = null;   // settle afresh where she is, or walk to the saved spot
      homeward = null;
      if (pinned && pin.at) {
        const at = floorAt(pin.at.x / desk.width * 2 - 1, -(pin.at.y / desk.height * 2 - 1));
        if (at) { homeward = clampToArea(at); homewardUntil = performance.now() + 20000; }
      }
      // A little hop says it took.
      if (pinned !== was && !pin.quiet) { wake(performance.now()); press('Space', true); press('Space', false); }
    });
    let restUntil = 0;
    let giveUpAt = 0;

    const idleSleepMs = () => (globalThis.__petIdleSleep ?? IDLE_SLEEP) * 1000;

    const sleep = () => {
      if (asleep) return;
      asleep = true;
      destination = null;
      stand();
      globalThis.__petSleeping = true;   // the face dozes and the frame rate drops
    };
    const wake = now => {
      globalThis.__petSleeping = false;
      if (!asleep) return;
      asleep = false;
      wokeAt = now;
      globalThis.__petWake = true;
    };

    // The toy. Upstream's trampoline is a full facility: it owns the body while
    // it is being used, bounces it, and hands it back. All this adds is the
    // coming and going, and a pet that decides to climb on by itself.
    const toy = {
      facility: jelly.trampoline,
      group: jelly.trampoline.visual.group,
      at: jelly.TRAMPOLINE,
      state: 'away',
      untilAt: 0,
      scale: 0,
    };
    toy.group.scale.setScalar(0);
    toy.group.visible = false;

    // The wait is re-rolled once per visit, not per tick, but it is read live so
    // that shortening TOY.gap takes effect on the wait already in progress.
    let toyJitter = Math.random();
    let toyGoneAt = performance.now();
    const toyWaitOver = now => {
      const [low, high] = globalThis.__petToyGap ?? TOY.gap;
      return now - toyGoneAt > (low + toyJitter * Math.max(0, high - low)) * 1000;
    };

    // Its shadow is the same trick as the body's: a footprint on the floor plane,
    // projected to screen and handed to the composite as alpha.
    const castToyShadow = () => {
      // project() mutates and returns the vector it was given, so read the numbers
      // out before reusing the scratch vector for the next point.
      const centre = scratch.set(toy.at.x, 0, toy.at.z).project(camera);
      const ndcX = centre.x, ndcY = centre.y;
      // Wider than the rim, or the pool hides underneath the toy itself.
      const spread = toy.at.radius * 1.55 * toy.scale;
      const edgeX = scratch.set(toy.at.x + spread, 0, toy.at.z).project(camera).x;
      const edgeY = scratch.set(toy.at.x, 0, toy.at.z + spread).project(camera).y;
      jelly.composite.setShadow(
        1,
        ndcX * .5 + .5, .5 - ndcY * .5,
        Math.abs(edgeX - ndcX) * .5, Math.abs(edgeY - ndcY) * .5,
        .38 * toy.scale,
      );
    };

    // Popping in and out, with a little overshoot on the way in.
    const pop = (from, to, ms, done) => {
      const started = performance.now();
      const tick = () => {
        const k = Math.min(1, (performance.now() - started) / ms);
        // Both curves run 0 to 1: they ease how far along the tween is, not which
        // way it goes. Easing back down here would play the arrival in reverse.
        const eased = to > from ? 1 - Math.pow(1 - k, 3) : k * k;
        toy.scale = from + (to - from) * eased;
        toy.group.scale.setScalar(toy.scale * (to > from ? 1 + .16 * Math.sin(Math.PI * k) : 1));
        castToyShadow();
        globalThis.__petWake = true;
        if (k < 1) requestAnimationFrame(tick); else done();
      };
      tick();
    };

    // The bed is for the babies. She had her turn; they are better at it, and a
    // mother standing on a trampoline while three children watch is the wrong
    // picture. Each has its own spot on the mat and its own ride.
    const rides = jelly.babyToys ?? [];
    const playOnToy = now => {
      if (toy.state !== 'ready' && toy.state !== 'playing') return false;
      let allAboard = rides.length > 0;
      rides.forEach((ride, index) => {
        const cub = babies[index];
        if (!cub) return;
        if (ride.active) { cub.rig.move.set(0, 0, 0); return; }
        allAboard = false;
        // The bed keeps bodies out of its own footprint, so a baby walks at its
        // seat, is stopped by the rim, and climbs on from there.
        if (ride.physics.nearby) { cub.rig.move.set(0, 0, 0); ride.interact(); return; }
        const seat = ride.seat;
        const dx = seat.x - cub.body.center.x, dz = seat.z - cub.body.center.z;
        const gap = Math.hypot(dx, dz) || 1;
        cub.rig.move.set(dx / gap, 0, dz / gap);
        globalThis.__petWake = true;
      });
      if (toy.state === 'ready') {
        if (allAboard) { toy.state = 'playing'; toy.untilAt = now + (globalThis.__petToyPlay ?? TOY.play) * 1000; }
        else if (now > toy.untilAt) putToyAway();   // nobody made it; take it away
      } else if (now > toy.untilAt) putToyAway();
      return true;
    };

    const bringOutToy = () => {
      toy.state = 'arriving';
      toy.group.visible = true;
      pop(0, 1, TOY.pop, () => {
        jelly.facilities.enabled = true;   // only now can it be climbed on or bumped into
        toy.state = 'ready';
        toy.untilAt = performance.now() + TOY.patience * 1000;
      });
    };

    const putToyAway = () => {
      if (toy.facility.active) toy.facility.interact();
      for (const ride of rides) if (ride.active) ride.interact();
      jelly.facilities.enabled = false;
      toy.state = 'leaving';
      pop(toy.scale, 0, TOY.pop, () => {
        toy.group.visible = false;
        toy.state = 'away';
        toyJitter = Math.random();
        toyGoneAt = performance.now();
      });
    };

    const noticeCursor = (x, y) => {
      // Chromium re-fires mousemove at the same point whenever the page under the
      // cursor repaints, which for an animated full-screen canvas is constantly.
      // Only a cursor that actually moved counts as someone being there.
      if (x === lastSeen.x && y === lastSeen.y) return;
      const now = performance.now();
      const gap = Math.max(16, now - lastSeen.at);
      pointerSpeed = Math.hypot(x - lastSeen.x, y - lastSeen.y) / (gap / 1000);
      lastSeen = { x, y, at: now };
      pointerAt = now;
      const rect = renderer.domElement.getBoundingClientRect();
      pointer = floorAt(((x - rect.left) / rect.width) * 2 - 1, -((y - rect.top) / rect.height) * 2 + 1);
      // While she keeps out of your way she sleeps through a cursor busy
      // elsewhere on her screen; only one that comes up to her wakes her.
      const near = pointer && Math.hypot(pointer.x - body.center.x, pointer.z - body.center.z) < NEAR;
      if (near) { stayAwakeSince = now; stillSince = now; }   // awake, and at full rate
      if (!staying() || near) wake(now);
    };

    setInterval(() => {
      if (!area) return;
      const now = performance.now();
      globalThis.__petFrameMs = undefined;   // full rate unless she is only fidgeting, below
      // No trampoline while she is keeping out of your way: it is big, and it is
      // exactly the kind of thing that ends up over the window you are using.
      if (toy.state === 'away' && toyWaitOver(now) && !staying()) bringOutToy();
      if (toy.state !== 'away') castToyShadow();   // also keeps it right across a resize
      // Playing outranks following: while the bed is out the line breaks up.
      const idle = held.size === 0 && toy.state === 'away' && !asleep;
      if (playOnToy(now)) babies.forEach((cub, i) => { if (games[i].state !== 'follow') climbDown(cub, games[i]); });
      else follow(now, idle);

      // A hand on the jelly outranks everything else. Yours, that is: a baby riding
      // on her head holds on with grabs of its own, and counting those made her
      // drop everything for as long as one rode there, staying awake at full
      // frame rate instead of fidgeting quietly and dozing off.
      // (`body.grab` is only the first of all her grabs, a baby's included.)
      if (input.grabs.size > 0 || pressing) {
        stand();
        destination = null;
        wasHeld = true;   // wherever she is put down becomes her spot
        pointerAt = now;
        wake(now);
        globalThis.__petWake = true;
        return;
      }

      if (now - pointerAt > idleSleepMs()) {
        if (toy.state !== 'away') putToyAway();   // the family turns in together
        sleep();
        return;
      }
      if (asleep || now - wokeAt < 1200) { stand(); return; }
      // The tray is open beside her: stay put, or she walks off from it or behind it.
      if (globalThis.__petHold) { stand(); destination = null; return; }
      // You are working on her screen: stay out of the way, but stay alive. She
      // keeps a spot and fidgets on it, a small turn or shuffle or hop every few
      // seconds, drifting back if she has wandered off it. The scene keeps
      // running meanwhile, which it would not if she simply stood: the render
      // loop skips everything, the babies too, once her body has settled.
      if (staying()) {
        destination = null;
        if (toy.state !== 'away') putToyAway();
        const here = { x: body.center.x, z: body.center.z };
        // Pinned with a spot to go back to (after a restart): walk there first.
        if (pinned && homeward) {
          const dx = homeward.x - here.x, dz = homeward.z - here.z;
          if (Math.hypot(dx, dz) < .03 || now > homewardUntil) { spot = homeward; homeward = null; stand(); }
          else { walkToward(dx, dz); globalThis.__petWake = true; return; }
        }
        if (!spot || wasHeld) {
          spot = here; wasHeld = false; stayAwakeSince = now;
          if (pinned) window.pet?.pinAt?.(...deskAt(here.x, 0, here.z));   // remember it
        }
        // Woken, or just arrived: the doze clock starts again.
        if (stayAwakeSince < wokeAt) stayAwakeSince = wokeAt;
        if (now - stayAwakeSince > (globalThis.__petStayDoze ?? STAY_DOZE) * 1000) { sleep(); return; }
        // 20 fps only once the whole family has been still for a moment: anything
        // moving (a baby walking or climbing, her own fidget settling, the
        // cursor coming up to her) is drawn at the full rate, or it looks sluggish.
        if (familyMoved() || now < fidgetUntil) stillSince = now;
        if (now - stillSince > CALM_MS) globalThis.__petFrameMs = globalThis.__petStayFrameMs ?? STAY_FRAME_MS;
        if (now < fidgetUntil) walkToward(fidget.dx, fidget.dz);
        else {
          stand();
          if (now >= fidgetAt) {
            fidgetAt = now + 2500 + Math.random() * 3500;
            const off = Math.hypot(spot.x - here.x, spot.z - here.z);
            if (off < .02 && Math.random() < .3) { press('Space', true); press('Space', false); }
            else {
              const angle = off > .02 ? Math.atan2(spot.z - here.z, spot.x - here.x) : Math.random() * Math.PI * 2;
              fidget = { dx: Math.cos(angle), dz: Math.sin(angle) };
              fidgetUntil = now + 140 + Math.random() * 180;
            }
          }
        }
        globalThis.__petWake = true;
        return;
      }
      spot = null;
      stayAwakeSince = 0;
      homeward = null;
      // A walk begun before you moved to another screen may lead onto yours.
      if (destination && !onRoamScreen(destination.x, destination.z)) destination = null;

      // Attention: an interesting cursor cancels whatever it was doing.
      const chase = globalThis.__petFollow ?? FOLLOW_CURSOR;
      const target = chase && pointer && now - pointerAt < LINGER ? clampToArea(pointer) : null;
      if (target) {
        const dx = target.x - body.center.x, dz = target.z - body.center.z;
        const reach = Math.hypot(dx, dz);
        if (reach < NOTICE) {
          destination = null;
          if (reach < STARTLE && pointerSpeed > 1800 && now - startledAt > 2500) {
            startledAt = now;
            press('Space', true); press('Space', false);
          }
          if (reach > PERSONAL) walkToward(dx, dz); else stand();
          return;
        }
      }

      // Otherwise wander. Eight-way steering can circle a point forever without
      // landing on it, so arrive within a body's width and give up on it after a
      // while regardless. A pet that marches non-stop also keeps a core busy, and
      // standing about is most of the character anyway: see docs/DEVELOPMENT.md.
      if (!destination) {
        if (now < restUntil) { stand(); return; }
        destination = somewhere();
        giveUpAt = now + 9000;
      }
      const dx = destination.x - body.center.x, dz = destination.z - body.center.z;
      if (Math.hypot(dx, dz) < .05 || now > giveUpAt) {
        destination = null;
        restUntil = now + 3000 + Math.random() * 9000;
        stand();
        return;
      }
      walkToward(dx, dz);
      if (Math.random() < .012) { press('Space', true); press('Space', false); }
    }, 140);

    // Hit test: the body's projected disc, which shrinks with distance exactly as
    // the body does. Measured in screen pixels on every move.
    const overBody = (x, y) => {
      const rect = renderer.domElement.getBoundingClientRect();
      const centre = scratch.copy(body.center).project(camera);
      const cx = rect.left + (centre.x * .5 + .5) * rect.width;
      const cy = rect.top + (-centre.y * .5 + .5) * rect.height;
      const basis = camera.matrixWorld.elements;
      const edge = scratch.copy(body.center);
      edge.x += basis[0] * .045; edge.y += basis[1] * .045; edge.z += basis[2] * .045;
      edge.project(camera);
      const ex = rect.left + (edge.x * .5 + .5) * rect.width;
      const ey = rect.top + (-edge.y * .5 + .5) * rect.height;
      return Math.hypot(x - cx, y - cy) < Math.hypot(ex - cx, ey - cy);
    };

    // Poking. The solver reads velocity at the start of every step, so pushing the
    // particles under the cursor away from the camera for a single frame leaves a
    // real dent that springs back on its own. Upstream's nudge() wakes the body the
    // same way. Dragging is untouched: the press still starts a grab as before, it
    // just squashes where the finger lands first.
    const POKE = {
      reach: .015, depth: .011, hold: 220, nodes: 10, rebound: .30, squash: .35,
      // The physics alone is honest and nearly invisible. A dent points away from
      // the viewer, so it moves the outline by no pixels, and a real jelly's wobble
      // is a few percent of a body 140 pixels tall. This is the cartoon on top: a
      // damped squash of the drawn character, which is what actually reads as a
      // poke. Set bounce to 0 for the physics on its own.
      bounce: .18, press: 70, spring: 260, decay: 200,
    };
    const poke = (x, y) => {
      if (body.grabs.length >= 3) { globalThis.__petLastPoke = { node: -1, why: 'already held', at: performance.now() }; return false; }
      const rect = renderer.domElement.getBoundingClientRect();
      const ray = scratch.set(
        ((x - rect.left) / rect.width) * 2 - 1,
        -((y - rect.top) / rect.height) * 2 + 1,
        .5,
      ).unproject(camera).sub(camera.position).normalize();
      const rx = ray.x, ry = ray.y, rz = ray.z;
      const ox = camera.position.x, oy = camera.position.y, oz = camera.position.z;
      // The cage node nearest the ray on the side facing the camera is the spot
      // under the cursor; anything behind it is the far wall of the body.
      let hit = -1, nearest = Infinity;
      for (let i = 0; i < body.mass.length; i++) {
        const px = body.x[i * 3] - ox, py = body.x[i * 3 + 1] - oy, pz = body.x[i * 3 + 2] - oz;
        const along = px * rx + py * ry + pz * rz;
        if (along <= 0 || along >= nearest) continue;
        const dx = px - rx * along, dy = py - ry * along, dz = pz - rz * along;
        if (dx * dx + dy * dy + dz * dz < POKE.reach * POKE.reach) { hit = i; nearest = along; }
      }
      if (hit < 0) { globalThis.__petLastPoke = { node: -1, why: 'no cage node under the cursor', at: performance.now() }; return false; }

      // Hold the spot in, briefly, with the same constraint dragging uses. A
      // one-frame shove is invisible: the solver restores the shape between two
      // rendered frames, and an impulse big enough to survive that moves the whole
      // body instead of denting it. The press is spread over the handful of cage
      // nodes around the spot, up to the kernel's binding limit.
      const hx = body.x[hit * 3], hy = body.x[hit * 3 + 1], hz = body.x[hit * 3 + 2];
      const near = [];
      for (let i = 0; i < body.mass.length; i++) {
        const gap = Math.hypot(body.x[i * 3] - hx, body.x[i * 3 + 1] - hy, body.x[i * 3 + 2] - hz);
        if (gap >= POKE.reach) continue;
        // Only the shell facing the camera: pulling a ball of material that
        // includes the far side drags the body instead of denting it.
        const facing = (body.x[i * 3] - body.center.x) * rx
          + (body.x[i * 3 + 1] - body.center.y) * ry
          + (body.x[i * 3 + 2] - body.center.z) * rz;
        if (facing > 0) continue;
        near.push([i, Math.pow(1 - gap / POKE.reach, 2)]);
      }
      near.sort((a, b) => b[1] - a[1]);
      const weights = near.slice(0, POKE.nodes);
      const total = weights.reduce((sum, pair) => sum + pair[1], 0);
      if (!(total > 0)) { globalThis.__petLastPoke = { node: -1, why: 'no facing nodes', at: performance.now() }; return false; }
      for (const pair of weights) pair[1] /= total;

      const anchor = body.center.clone().set(0, 0, 0);
      for (const [id, w] of weights) {
        anchor.x += body.x[id * 3] * w;
        anchor.y += body.x[id * 3 + 1] * w;
        anchor.z += body.x[id * 3 + 2] * w;
      }
      // Press along the surface normal, not along the line of sight: a finger goes
      // straight into the skin, and on a blob the outward normal is near enough
      // the direction from the centre. Pushing along the view ray instead just
      // squashes the whole body towards the far side.
      const outX = hx - body.center.x, outY = hy - body.center.y, outZ = hz - body.center.z;
      const reachOut = Math.hypot(outX, outY, outZ) || 1;
      const inX = -outX / reachOut * POKE.depth;
      const inY = -outY / reachOut * POKE.depth;
      const inZ = -outZ / reachOut * POKE.depth;
      const press = {
        weights,
        point: anchor.clone(),
        target: anchor.clone().set(anchor.x + inX, anchor.y + inY, anchor.z + inZ),
        lambda: new Float64Array(3),
      };
      // The dent alone is honest and nearly invisible: it points away from the
      // viewer, and a body-facing dimple moves the silhouette by no pixels at all.
      // So the poke also squashes the whole jelly down against the floor, hardest
      // at the top, which is the part anyone can actually see.
      if (POKE.squash) {
        let tallest = 0;
        for (let i = 1; i < body.x.length; i += 3) if (body.x[i] > tallest) tallest = body.x[i];
        for (let i = 0; i < body.mass.length; i++) {
          body.velocity[i * 3 + 1] -= POKE.squash * (body.x[i * 3 + 1] / (tallest || 1));
        }
      }
      body.grabs.push(press);
      body.wake();
      setTimeout(() => {
        const at = body.grabs.indexOf(press);
        if (at >= 0) body.grabs.splice(at, 1);
        // Let go with a flick outwards. The dent alone recovers politely; the
        // overshoot is what reads as squishy.
        for (const [id, w] of weights) {
          body.velocity[id * 3] -= inX / POKE.depth * POKE.rebound * w * weights.length;
          body.velocity[id * 3 + 1] -= inY / POKE.depth * POKE.rebound * w * weights.length;
          body.velocity[id * 3 + 2] -= inZ / POKE.depth * POKE.rebound * w * weights.length;
        }
        body.wake();
        globalThis.__petWake = true;
      }, POKE.hold);
      squashAndStretch();
      wake(performance.now());
      globalThis.__petWake = true;
      globalThis.__petLastPoke = { node: hit, at: performance.now() };
      return hit;
    };
    // Squash and stretch, drawn rather than simulated: the character is scaled
    // flat and wide, then springs back through a couple of decaying overshoots.
    let squashing = 0;
    const squashAndStretch = () => {
      const started = performance.now();
      const run = ++squashing;
      const tick = () => {
        if (run !== squashing) return;
        const t = performance.now() - started;
        if (!POKE.bounce || t > POKE.hold + POKE.decay * 4) {
          baby.group.scale.set(1, 1, 1);
          squashing = 0;
          return;
        }
        // Press in over a few frames, stay squashed while the finger is in, then
        // spring back through decaying overshoots. A single oscillation looks like
        // nothing: at thirty frames a second its first quarter is one frame long.
        let flat;
        if (t < POKE.press) flat = 1 - POKE.bounce * (t / POKE.press);
        else if (t < POKE.hold) flat = 1 - POKE.bounce;
        else {
          const since = t - POKE.hold;
          flat = 1 - POKE.bounce * Math.exp(-since / POKE.decay) * Math.cos(2 * Math.PI * since / POKE.spring);
        }
        baby.group.scale.set(1 / Math.sqrt(flat), flat, 1 / Math.sqrt(flat));
        globalThis.__petWake = true;
        requestAnimationFrame(tick);
      };
      tick();
    };

    globalThis.__petPoke = poke;
    globalThis.__petPokeTuning = POKE;

    // A click pokes, a drag drags, and never both at once: a drag holds the very
    // spot the poke is trying to press in, and the two cancel each other out.
    // Input swallows pointerup once it holds a grip, so the release is spotted by
    // watching its grab disappear rather than by listening for the event.
    let pressing = null;
    let pressWatch = 0;
    const stopWatching = () => { pressing = null; clearInterval(pressWatch); pressWatch = 0; };
    addEventListener('pointerdown', event => {
      if (!overBody(event.clientX, event.clientY)) return;
      // Count what is already holding her, because a baby riding her crown is a
      // grab too: waiting for none at all means a poke never lands while one is
      // up there.
      pressing = { x: event.clientX, y: event.clientY, at: performance.now(), drift: 0, held: body.grabs.length };
      clearInterval(pressWatch);
      pressWatch = setInterval(() => {
        if (!pressing) return;
        if (pressing.drift > 8 || performance.now() - pressing.at > 1500) return stopWatching();
        if (body.grabs.length > pressing.held) return;   // still holding on: this is a drag
        const { x, y } = pressing;
        stopWatching();
        poke(x, y);
      }, 20);
    }, true);
    addEventListener('pointermove', event => {
      if (pressing) pressing.drift = Math.max(pressing.drift, Math.hypot(event.clientX - pressing.x, event.clientY - pressing.y));
    }, true);
    // A click-through window is still sent the mouse's movements, and a window
    // that cannot be clicked is never told a button is down, so they arrive with
    // nothing pressed. Input reads a move with no button as proof the release
    // went missing and lets go, which is right in a browser and wrong here: the
    // real cursor moving is then enough to drop her, and dragging her across the
    // desk moves the real cursor a great deal. Stopped at the window, above the
    // canvas listener that would act on them, and only while she is being held.
    // Letting go still works: the release arrives as its own event.
    // Whether a pointer is holding her, which is not the same as whether anything
    // is: a baby riding her crown is a grab on the body too, and suppressing
    // these while one is up there would leave her blind to the cursor.
    const carried = () => input.grabs?.size > 0;
    addEventListener('pointermove', event => {
      if (event.buttons === 0 && carried()) event.stopImmediatePropagation();
    }, true);
    // The same two streams fight over the pointer capture, and the loser is the
    // drag. The canvas takes the capture on the press, the real cursor's next
    // forwarded move takes it away again, and the canvas is told it has lost the
    // pointer and lets go a hundred pixels in. What is left looks like her
    // walking after the cursor rather than being carried by it, because that is
    // exactly what it is. Nothing here needs the capture: the shell's moves are
    // delivered to the canvas either way.
    addEventListener('lostpointercapture', event => {
      if (carried()) event.stopPropagation();
    }, true);
    // Input also lets go of everything when the window blurs or the page is
    // reported hidden, which is right for a tab and wrong for a window that
    // never has focus and hops between displays: macOS can count it as
    // occluded for a moment mid-hop, and one such moment drops her in the
    // seam. At the target, capture listeners run before the others, so these
    // get in ahead of input's own. The release still arrives as its own event.
    for (const kind of ['blur', 'visibilitychange']) {
      addEventListener(kind, event => { if (carried()) event.stopImmediatePropagation(); }, true);
    }

    addEventListener('mousemove', event => {
      noticeCursor(event.clientX, event.clientY);
      if (overBody(event.clientX, event.clientY)) globalThis.__petWake = true;
    }, true);

    // Tell the shell where the body is, in window pixels, so it can decide about
    // the cursor by polling rather than by being told. A little wider than the
    // body itself, since a file has to be aimed at a creature that wanders.
    const REACHABLE = 1.15;
    // Desk pixels throughout: the shell moves the window under her and would
    // otherwise be adding a window origin that had just changed.
    const reportWhere = () => {
      const [cx, cy] = deskAt(body.center.x, body.center.y, body.center.z);
      const basis = camera.matrixWorld.elements;
      const [ex, ey] = deskAt(body.center.x + basis[0] * .045, body.center.y + basis[1] * .045,
        body.center.z + basis[2] * .045);
      window.pet?.where?.(cx, cy, Math.hypot(ex - cx, ey - cy) * REACHABLE);
    };
    setInterval(reportWhere, 60);
    reportWhere();

    const babies = jelly.babies ?? [];
    // Grabs are how this codebase moves a body without pretending to: a weighted
    // set of cage nodes pulled towards a point, force-limited by the solver. A
    // baby riding her head is held by one; her head giving way under it is
    // another, pressing down, exactly as a poke does.
    const rankedNodes = (who, count, pick) => {
      const ids = [...Array(who.mass.length).keys()];
      ids.sort((a, b) => pick(who.rest, b) - pick(who.rest, a));
      return ids.slice(0, count).map(id => [id, 1 / count]);
    };
    const highest = (rest, i) => rest[i * 3 + 1];
    const lowest = (rest, i) => -rest[i * 3 + 1];
    const frontmost = (rest, i) => rest[i * 3 + 2];
    const restCentre = (who, weights) => {
      let x = 0, y = 0, z = 0;
      for (const [id, w] of weights) { x += who.rest[id * 3] * w; y += who.rest[id * 3 + 1] * w; z += who.rest[id * 3 + 2] * w; }
      return { x, y, z };
    };
    const holdOn = (who, weights) => {
      const at = who.center.clone().set(0, 0, 0);
      for (const [id, w] of weights) {
        at.x += who.x[id * 3] * w; at.y += who.x[id * 3 + 1] * w; at.z += who.x[id * 3 + 2] * w;
      }
      const grab = { weights, point: at.clone(), target: at.clone(), lambda: new Float64Array(3) };
      who.grabs.push(grab); who.wake();
      return grab;
    };
    // Grabs are strong. Setting a target where a body is not yet pulls that hard
    // enough to tear it: a rider grabbed mid-jump and aimed at her crown came out
    // nine times its own width. Walk the targets there instead, as upstream does
    // for dragging.
    const easeTarget = (target, x, y, z, step = .02) => {
      const dx = x - target.x, dy = y - target.y, dz = z - target.z;
      const far = Math.hypot(dx, dy, dz);
      if (far <= step) { target.set(x, y, z); return; }
      target.set(target.x + dx / far * step, target.y + dy / far * step, target.z + dz / far * step);
    };
    const letGo = (who, grab) => {
      const at = who.grabs.indexOf(grab);
      if (at >= 0) who.grabs.splice(at, 1);
      who.wake();
    };

    const games = babies.map(() => ({ state: 'follow', until: 0, spot: null, hold: null, press: null, lift: 0, reach: 0, perch: 0, squash: 0 }));
    // Her crown fits one. Two riders aimed at the same point stand inside each other.
    const onHer = () => games.some(game => game.state === 'climbing' || game.state === 'leaping' || game.state === 'riding');
    // The skin sits proud of the cage by up to half a lattice cell, so a crown
    // measured from the cage nodes is several millimetres under the visible one,
    // and a baby aimed at it sinks into her head. Both ends use the skin.
    const headTop = () => {
      const skin = body.surface.positions;
      let top = 0;
      for (let i = 1; i < skin.length; i += 39) if (skin[i] > top) top = skin[i];
      return top;
    };
    const soleOf = cub => {
      const skin = cub.body.surface.positions;
      let sole = Infinity;
      for (let i = 1; i < skin.length; i += 3) if (skin[i] < sole) sole = skin[i];
      return sole;
    };

    const climbDown = (cub, game) => {
      cub.carry = null;
      if (game.press) letGo(body, game.press);
      game.press = null;
      // A shove up and out, so it leaves her head rather than sinking through it.
      const away = Math.atan2(cub.body.center.x - body.center.x, cub.body.center.z - body.center.z) || 0;
      for (let i = 0; i < cub.body.mass.length; i++) {
        cub.body.velocity[i * 3] += Math.sin(away) * GAMES.hop;
        cub.body.velocity[i * 3 + 1] += GAMES.hop * .5;
        cub.body.velocity[i * 3 + 2] += Math.cos(away) * GAMES.hop;
      }
      cub.body.wake();
      game.state = 'follow';
      globalThis.__petWake = true;
    };

    // Where each baby ought to be standing: behind her, along the way she is
    // facing, staggered so the line is not a queue.
    const walkCub = (cub, spot, arrive = FAMILY.arrive) => {
      const dx = spot.x - cub.body.center.x, dz = spot.z - cub.body.center.z;
      const gap = Math.hypot(dx, dz);
      if (gap < arrive) { cub.rig.move.set(0, 0, 0); return true; }
      // The rig reads the length of this as how briskly to walk, so a baby left
      // behind hurries and one already in place ambles.
      const pace = Math.min(1, gap / FAMILY.hurry);
      cub.rig.move.set(dx / gap * pace, 0, dz / gap * pace);
      globalThis.__petWake = true;
      return false;
    };

    const follow = (now, idle) => {
      if (!babies.length) return;
      const yaw = jelly.rig.yaw;
      const aheadX = Math.sin(yaw), aheadZ = Math.cos(yaw);
      babies.forEach((cub, index) => {
        const game = games[index];

        if (game.state === 'riding') {
          // Her head is a moving platform: the rider is carried at its soles, and
          // she is pressed down by the same token so she wears the weight. Both
          // heights are offsets from her centre, fixed when the rider landed.
          // Measuring her crown afresh each tick compounds, since the press has
          // already pushed it down and the next tick presses below that again.
          cub.carry = { x: body.center.x, y: body.center.y + game.perch, z: body.center.z };
          easeTarget(game.press.target, body.center.x, body.center.y + game.squash, body.center.z, .004);
          cub.rig.move.set(0, 0, 0);
          globalThis.__petWake = true;
          if (now > game.until) climbDown(cub, game);
          return;
        }

        if (game.state === 'leaping') {
          // Let the hop carry it as far as it will, then take over.
          cub.rig.move.set(0, 0, 0);
          globalThis.__petWake = true;
          if (now < game.until && cub.body.center.y < game.reach) return;
          const crown = rankedNodes(body, 12, highest);
          game.press = holdOn(body, crown);
          let crownY = 0;
          for (const [id, w] of crown) crownY += body.x[id * 3 + 1] * w;
          game.squash = crownY - GAMES.sag - body.center.y;
          // Where the carry point has to be for the visible soles to land on her
          // pressed crown. Three things sit between the two: the model's own rest
          // origin, the skin hanging below the lowest cage node, and the carry
          // spring's static sag under gravity, which is g over its stiffness.
          let lowestNode = Infinity;
          for (let i = 1; i < cub.body.x.length; i += 3) lowestNode = Math.min(lowestNode, cub.body.x[i]);
          const overhang = lowestNode - soleOf(cub);
          game.perch = headTop() - GAMES.sag + GAMES.perch
            - cub.soleOffset + overhang + 2.4 / 900 - body.center.y;
          game.state = 'riding';
          game.until = now + (GAMES.ride[0] + Math.random() * (GAMES.ride[1] - GAMES.ride[0])) * 1000;
          return;
        }

        if (game.state === 'climbing') {
          if (!walkCub(cub, { x: body.center.x, z: body.center.z }, .05) && now < game.until) return;
          if (!cub.body.grounded) return;   // wait for a settled body, as interact() does
          cub.rig.jump();
          game.state = 'leaping';
          game.reach = headTop() * .55;
          game.until = now + 700;
          return;
        }

        if (game.state === 'exploring') {
          if (walkCub(cub, game.spot) || now > game.until) { game.state = 'follow'; game.until = now + 4000; }
          return;
        }

        // Nothing on: fall in behind her, and now and then wander off or climb up.
        const back = FAMILY.gap + index * FAMILY.spacing;
        const side = (index % 2 ? 1 : -1) * FAMILY.stagger;
        const spot = clampToArea({
          x: body.center.x - aheadX * back + aheadZ * side,
          z: body.center.z - aheadZ * back - aheadX * side,
        });
        const home = walkCub(cub, spot);
        if (!home || !idle || now < game.until || Math.random() > GAMES.chance) return;
        if (Math.random() < .45 && !onHer()) {
          game.state = 'climbing';
          game.until = now + 6000;
        } else {
          game.state = 'exploring';
          game.spot = clampToArea({
            x: body.center.x + (Math.random() * 2 - 1) * GAMES.reach,
            z: body.center.z + (Math.random() * 2 - 1) * GAMES.reach,
          });
          game.until = now + (GAMES.explore[0] + Math.random() * (GAMES.explore[1] - GAMES.explore[0])) * 1000;
        }
      });
    };

    // Cues from the shell's global shortcuts, for filming: bring the toy out or
    // put it away, send a baby up onto her head or bring it down. Each one skips
    // the waiting rather than adding a second way for things to happen.
    const cue = name => {
      wake(performance.now());
      globalThis.__petWake = true;
      pointerAt = performance.now();   // and do not doze off mid-shot
      if (name === 'hold' || name === 'release') { globalThis.__petHold = name === 'hold'; return; }
      if (name === 'toy') {
        if (toy.state === 'away') bringOutToy(); else putToyAway();
        return;
      }
      if (name !== 'stack') return;
      const rider = games.findIndex(game => game.state !== 'follow');
      if (rider >= 0) { climbDown(babies[rider], games[rider]); return; }
      if (toy.state !== 'away') putToyAway();   // they cannot play and climb at once
      const free = games.findIndex(game => game.state === 'follow');
      if (free < 0) return;
      games[free].state = 'climbing';
      games[free].until = performance.now() + 9000;
    };
    globalThis.__petCue = cue;
    window.pet?.onCue?.(cue);

    // Files arrive from the catcher window, which is the only one macOS will
    // offer them to. The shell owns the list and this draws it: a fresh count
    // means something just arrived, which is the difference between reacting
    // and quietly repainting a card whose picture landed late.
    let carrying = [];
    window.pet?.onCarrying?.((files, fresh) => {
      carrying = files;
      globalThis.__jelly?.shelf?.show(files.map(file => ({
        key: file.path, icon: file.icon ?? null, label: file.label, kind: file.kind,
      })));
      if (!fresh) return;
      wake(performance.now());
      squashAndStretch();
      globalThis.__petWake = true;
    });
    globalThis.__petCarrying = () => carrying;

    // Test hooks (see the top of this file).
    globalThis.__petProbe = overBody;
    globalThis.__petArea = () => area;
    globalThis.__petDebug = () => ({
      held: [...held], destination, asleep,
      roam: roam.mode, pinned, homeward, spot, awakeFor: stayAwakeSince ? Math.round(performance.now() - stayAwakeSince) : null,
      sinceWoke: Math.round(performance.now() - wokeAt), grabbed: !!(body.grabs.length || body.grab),
      pointer, sinceCursor: Math.round(performance.now() - pointerAt),
      toy: { state: toy.state, active: toy.facility.active, scale: +toy.scale.toFixed(3) },
      babies: babies.map((cub, i) => ({ at: [+cub.body.center.x.toFixed(3), +cub.body.center.z.toFixed(3), +cub.body.center.y.toFixed(3)], doing: games[i].state })),
      press: pressing ? { drift: Math.round(pressing.drift), held: Math.round(performance.now() - pressing.at) } : null,
      lastPoke: globalThis.__petLastPoke ?? null,
    });
    window.pet?.ready();
  }
})();
