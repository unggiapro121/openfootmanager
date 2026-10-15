# Runtime portrait pool

These WebP files are the faces given to players who have no photo of their own,
by `src-tauri/src/commands/portraits/`. Each is a 256x256 cut-out with a
transparent background, framed like the real-player photos in the packages
(face centred at 50% / 53%, face width 57% of the frame).

`../../src/commands/portraits/catalog.rs` lists every file with its appearance
group and age band. Both the files and the catalog are generated — do not edit
them by hand.

## Provenance

- `chroma-*.webp` — the 11 synthetic portraits that shipped with upstream commit
  2817f702, re-framed to the geometry above. Synthetic/generated, GPLv3 with the
  project.
- every other file — synthetic portraits generated with Google Gemini as
  5x6 / 4x5 contact sheets, then cut, background-removed (rembg,
  `isnet-general-use`) and re-framed by `build_portraits.py`. No photograph of a
  real person was used as input. Faces that came out resembling a real
  footballer were dropped (listed with `keep=0` in `faces.csv`), as were cut-outs
  the matting left marked. Distributed under the project's GPLv3. A second batch
  of sheets (older northern/central Europeans, older South-East Asians, South
  Asians, Gulf/Middle-Eastern and mixed-heritage Latin American players) was
  generated to cover the nationalities of the package players who have no
  photo; the real photos themselves were never used as input.

## Rebuilding

The tool and the tag sheet live outside the repository, next to the source
sheets: `ofm-packages/avatar/build_portraits.py` and `ofm-packages/avatar/faces.csv`.

```bash
build_portraits.py slice <staging>          # cut, clean, frame; writes contact sheets
build_portraits.py reframe <this dir> <staging>   # the original chroma-* faces
# tag new faces in faces.csv: id, group, band (young/prime/veteran), keep
build_portraits.py build <staging> <repo root>
```

Bump `GENERATOR_VERSION` in `portraits/mod.rs` whenever the pool changes, so
players' cached faces are re-picked.
