# Origin and licence

Jelly desktop is free software under the **GNU General Public License v3.0 only**
(`LICENSE`). Copyright © 2026 Chi Min Lee (catsmice).

## Built on Jelly Baby

Jelly herself, her soft-body physics, her look and her model, come from
[scottstts/Jelly-Baby](https://github.com/scottstts/Jelly-Baby) by Scott (scottstts), at commit
`41ad7d1`, licensed GPL-3.0-only. Jelly desktop is a derivative work of it and carries
the same licence.

- `app/` is a compiled build of upstream `41ad7d1` with `jelly-transparent.diff` applied
  and the files in `upstream/` added. Upstream's table textures, social image and night
  sky are left out of it, since nothing here loads them.
- `jelly-transparent.diff` is every change made to upstream's source: a transparent
  page, the desk as her floor, the trampoline as her only toy, her pink flavour, a pixel
  budget, and the hooks the shell drives her through.
- `upstream/` holds the files added to upstream's source: `babies.ts` (the baby
  jellies), `shelf.ts` (the cards shown inside her), and `build-baby-model.mjs` and
  `bench-baby.mjs` (the babies' model and its benchmark).
- The rest is the Electron shell around her, written for this project: `main.js`,
  `preload.js`, `pet-demo.js`, `screenshots.js`, `downloads.js`, `i18n.js`, `tray.html`
  and `crop.html`, the icons, and the packaging.

## Third-party assets

| File | What | Source | Licence |
| --- | --- | --- | --- |
| `app/assets/bg_room-*.exr` | The room light reflected and refracted in her body | [Empty Play Room](https://polyhaven.com/a/empty_play_room) on Poly Haven, photography by Greg Zaal, processing by Jarod Guest; shipped by upstream | CC0 |

Upstream lists this file as its own; its embedded metadata names the Poly Haven
original, so it is credited here.

## Source for a download

Anyone who receives a built copy of Jelly can get its complete corresponding source from
this repository, at the tag of that release: the shell, `jelly-transparent.diff`,
`upstream/`, and the build and packaging steps in `docs/DEVELOPMENT.md`, together with upstream
at `41ad7d1`. GPL-3.0 does not mix with the Mac App Store's terms, so she is only
distributed as a direct download.
