# Facilities art

Pre-rendered 3D art of the online facilities screen (C-27b, `c-27-tech-spec.md` §4). Do not edit
these files by hand: render again in the design repository and copy them with
`scripts/sync-facility-art.sh`.

## Source

`ofm-document/05-design/brand/eleven-saga/stadium/3d-src/`, rendered with
(Playwright 1.48.2, Chromium with SwiftShader, three.js r147):

```sh
node render.js tinh,gian,anh,hop,mang,buom,chao,so,mo,luoi,shop,food,park,training,medical,academy,trophy,empty,crane --layers
node render.js ground --layers --ground-density=1.5
```

The ground is rendered at 1.5 px per map unit (render.html: 2.1) to keep all the art within its
2,000,000-byte budget (c-27 §4.3).

<!-- sources:start -->
| File | md5 |
|---|---|
| `lib_core.js` | `4bbd8b675406e943ed42c8b73f965e2d` |
| `lib_campus.js` | `0bfcaa056aa44f5b27dad9f92df9f9ef` |
| `render.html` | `1c86ce810849419f9208c9d84e39a4aa` |
| `render.js` | `6a56ac5e83c5d7b011a4130e7e8cefea` |
| `README.md` | `bf2aab4b60cb7ac26bd4d603b8d0c142` |
<!-- sources:end -->

Per piece: `<key>.base.webp` is the piece with both club colours white (lossy WebP, q 0.8; ground
q 0.78). When `meta.json` marks it `layers: true`, `<key>.c1.webp` / `<key>.c2.webp` are lossless
masks (white, alpha = how much of colour 1 / colour 2 shows), from two more passes with that colour
black: `m = 1 − L(colour black) / L(both white)`, L the luminance of the scene light behind the
pixel (before the ACES tone curve). `art/tint.ts` paints them the same way:
`tone(light(base) × Π(1 − m + m × colour))`. Every pass starts from a fresh page, so the random
details line up. The training ground, medical centre, trophy room, crane and ground carry no club
colour (`layers: false`).

## Measurements

<!-- measure:start (C-27b, 2026-11-10) -->
Mean ΔE76 of the painted art against the same piece rendered straight in the paint colours,
over the mask region (mask ≥ 5 %, both opaque; the ground has no club colour, so all of it).
Paint colours as `tint.ts` makes them: `#000000` is held to L* 18 (`#2c2c2c`), and the straight
render uses that. Each cell is **method / shipped / design**:

- **method**: painted from the white render before encoding: the masks and the formula alone.
- **shipped**: painted from the files here (adds the base's lossy WebP, q 0.8).
- **design**: the straight render through WebP q 0.8, as `render.js` ships coloured art: the error
  the approved design's own images already carry.

| Piece | red #dc2626 / yellow #facc15 | blue #1d4ed8 / white | black #000000 / white | yellow #facc15 / light yellow #fef08a |
|---|---|---|---|---|
| tinh | 4.47 / 8.65 / 15.36 | 2.01 / 6.83 / 13.43 | 2.66 / 7.60 / 6.10 | 3.04 / 6.74 / 10.02 |
| gian | 4.07 / 8.43 / 17.24 | 1.80 / 6.50 / 14.13 | 2.58 / 7.28 / 6.00 | 2.81 / 6.54 / 11.47 |
| anh | 3.90 / 7.55 / 15.23 | 2.03 / 5.90 / 13.04 | 2.57 / 6.58 / 5.46 | 2.93 / 6.04 / 9.92 |
| hop | 3.92 / 7.82 / 16.29 | 2.06 / 5.61 / 12.17 | 2.46 / 6.26 / 5.02 | 2.88 / 5.92 / 10.62 |
| mang | 3.70 / 7.01 / 15.65 | 1.80 / 5.16 / 12.61 | 2.37 / 5.65 / 4.54 | 2.57 / 5.27 / 10.39 |
| buom | 3.80 / 7.10 / 15.62 | 1.96 / 5.29 / 12.14 | 2.31 / 5.60 / 4.53 | 2.74 / 5.40 / 10.17 |
| chao | 3.53 / 6.96 / 17.18 | 1.76 / 5.36 / 12.95 | 2.15 / 5.64 / 4.64 | 2.54 / 5.43 / 11.60 |
| so | 3.59 / 7.23 / 17.61 | 1.66 / 5.41 / 13.67 | 2.35 / 6.00 / 4.94 | 2.46 / 5.51 / 12.02 |
| mo | 4.38 / 5.69 / 16.72 | 3.95 / 5.80 / 13.22 | 3.51 / 5.06 / 3.36 | 3.66 / 5.05 / 12.12 |
| luoi | 3.75 / 6.95 / 17.11 | 1.78 / 4.97 / 13.26 | 2.38 / 5.61 / 4.63 | 2.74 / 5.38 / 11.23 |
| ground | 0.00 / 1.95 / 1.95 | 0.00 / 1.95 / 1.95 | 0.00 / 1.95 / 1.95 | 0.00 / 1.95 / 1.95 |

Worst cell: method 4.47, shipped 8.65, design 17.61. Mean of all
cells: method 2.58, shipped 5.83, design 10.48.
Measured by `measure.js` (C-27b work files, kept outside both repositories).
<!-- measure:end -->

## Files

<!-- files:start (written by scripts/sync-facility-art.sh) -->
| File | Bytes | md5 |
|---|---|---|
| `academy.base.webp` | 21.540 | `25eb9d057d827e258257616390875472` |
| `academy.c1.webp` | 31.258 | `c15862fe1511e46b67261ee3bc933475` |
| `academy.c2.webp` | 516 | `69bff39f262d95319824e5d9c2e47236` |
| `anh.base.webp` | 36.824 | `60ff61329ce026cf3d4949567f8fb909` |
| `anh.c1.webp` | 33.220 | `f2e584977d272536c80715094253768d` |
| `anh.c2.webp` | 29.340 | `23297d9d19896e74276e7c38bed45d07` |
| `buom.base.webp` | 68.776 | `edbce274650fa89f426870a35623c1ec` |
| `buom.c1.webp` | 80.080 | `28c23de9d50f0caae292d3d317c46adf` |
| `buom.c2.webp` | 64.266 | `c9a416e54b38bcc1d289439f1cd46f3f` |
| `chao.base.webp` | 44.532 | `cd0813001303c0775f4f949b48dd63f3` |
| `chao.c1.webp` | 47.164 | `3244ea119642220de4341fee2968e3d7` |
| `chao.c2.webp` | 42.832 | `29588155501c7f0856611b041aec91f6` |
| `crane.base.webp` | 7.566 | `a9dccce9ae0d843eb41977fe312c1118` |
| `empty.base.webp` | 9.186 | `23c0b512621f9f538193d740fc442c08` |
| `empty.c1.webp` | 5.298 | `31e4cb4ce4254faab1139f0aace73838` |
| `empty.c2.webp` | 516 | `73d2f25f22199bddd1a7daf362258f5c` |
| `food.base.webp` | 8.780 | `9858e7d886662a31b0c2adc09ff1a04f` |
| `food.c1.webp` | 14.480 | `e6bf3fc1701fed0094db159f8b023722` |
| `food.c2.webp` | 16.710 | `3ef57078f455bee5b8c4042f6e34d4de` |
| `gian.base.webp` | 44.298 | `07d68dadcb08d4a568c57e35b512814c` |
| `gian.c1.webp` | 48.088 | `89dbce33e9d8700cb7676e71543fd118` |
| `gian.c2.webp` | 43.974 | `4b161c923fc2960221730fe20e1eb267` |
| `ground.base.webp` | 179.896 | `8d068c9a979d68cf7b7a8f498fccf196` |
| `hop.base.webp` | 54.838 | `39e41b385df5f587b7287ec257a11cc3` |
| `hop.c1.webp` | 49.502 | `1461e08874cc9fa1ff94c9fa59ed8897` |
| `hop.c2.webp` | 40.298 | `6be13f499ed00fc8a80675353234a94c` |
| `luoi.base.webp` | 73.504 | `10ba3ef5f37c77d851c181f6f57252ca` |
| `luoi.c1.webp` | 67.334 | `19322e4ea505fb7f304de8e3dec4ab47` |
| `luoi.c2.webp` | 55.718 | `63f39213e7db9eb3ef15effbd9676110` |
| `mang.base.webp` | 59.850 | `764c2595145530f9d7d8291b340a113e` |
| `mang.c1.webp` | 71.668 | `041df9b8a83f80a710b646caf4a8dacf` |
| `mang.c2.webp` | 54.202 | `f34a1dae780a80df093b8efc1ccac430` |
| `medical.base.webp` | 16.586 | `00d3d403edcee1c7505560c4c2568af6` |
| `meta.json` | 2.508 | `e67e22a33835239a914c9de1553cef41` |
| `mo.base.webp` | 68.996 | `e402fe5cc2453dc625db7c64c0284fa3` |
| `mo.c1.webp` | 98.548 | `717dc0c8bec35d167813796630ed8e34` |
| `mo.c2.webp` | 48.776 | `acc4e6a38ea04914820ac381cb29d1f2` |
| `park.base.webp` | 22.270 | `70bc2c3fd21277c5cdc35437e90e203e` |
| `park.c1.webp` | 17.116 | `10a3944eda3589b97937a6af69964a9c` |
| `park.c2.webp` | 516 | `684895d69cee334f85b31dd675b62d8f` |
| `shop.base.webp` | 10.396 | `d3749237d9b50ea67e3473d1f9bcd856` |
| `shop.c1.webp` | 11.868 | `296387cb2a3ac178e02e2aa46bb6cfe8` |
| `shop.c2.webp` | 13.218 | `2bdc36d956747e7fd4fa4454a3e9dec0` |
| `so.base.webp` | 50.116 | `76f36759dbe6b392f5ee4e10226e49cd` |
| `so.c1.webp` | 44.842 | `f7ec7349ded6c5507a22142da19280df` |
| `so.c2.webp` | 40.860 | `5445faadc7853aac1efe2d366dbc4247` |
| `tinh.base.webp` | 30.918 | `d18d392e364b3396bd7de5a1e8c6f2a1` |
| `tinh.c1.webp` | 29.438 | `10086bcef34cc3eef27adf675bcdb0b9` |
| `tinh.c2.webp` | 27.014 | `b59e67c388dc6c99493c193a3362451a` |
| `training.base.webp` | 23.240 | `77a2441cd4d4d5f47caf08ea5f8b0319` |
| `trophy.base.webp` | 12.832 | `74d35725ef79be9db4513e43b5b5e5e9` |
| **Total** (51 files) | **1.976.112** | |
<!-- files:end -->
