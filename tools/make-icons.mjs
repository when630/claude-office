// 캐릭터 픽셀 데이터를 앱/트레이 아이콘 PNG로 굽는다.
// 외부 의존성을 두지 않으려고 PNG 인코더를 직접 넣었다 (RGBA, 필터 0, zlib).
import zlib from 'node:zlib';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PALETTE, CLAWD_STAND, assertRect } from '../shared/pixels.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, '..', 'build');

// ── PNG 인코더
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePng(width, height, rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  // 각 스캔라인 앞에 필터 바이트 0
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ── 그리기
function hexToRgb(hex) {
  return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
}

class Bitmap {
  constructor(w, h) {
    this.w = w;
    this.h = h;
    this.data = Buffer.alloc(w * h * 4); // 투명으로 시작
  }

  set(x, y, [r, g, b], a = 255) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const i = (y * this.w + x) * 4;
    this.data[i] = r;
    this.data[i + 1] = g;
    this.data[i + 2] = b;
    this.data[i + 3] = a;
  }

  fill(x0, y0, w, h, color, a = 255) {
    for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) this.set(x, y, color, a);
  }

  // 픽셀 문자열을 scale배로 확대해 찍는다
  stamp(rows, palette, ox, oy, scale) {
    const { w, h } = assertRect(rows);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const hex = palette[rows[y][x]];
        if (!hex) continue;
        this.fill(ox + x * scale, oy + y * scale, scale, scale, hexToRgb(hex));
      }
    }
  }

  png() {
    return encodePng(this.w, this.h, this.data);
  }
}

// 상태 점 — 트레이에서 대기/실패를 한눈에. 16px로 축소돼도 보이도록 크게 찍는다.
function statusDot(bm, scale, hex) {
  const color = hexToRgb(hex);
  const size = 6 * scale;
  const x = bm.w - size;
  const y = bm.h - size;
  bm.fill(x, y, size, size, color);
  // 모서리를 투명하게 깎아 동그랗게 (배경이 투명이라 테두리는 두지 않는다)
  for (const [dx, dy] of [
    [0, 0],
    [size - 1, 0],
    [0, size - 1],
    [size - 1, size - 1],
  ]) {
    bm.set(x + dx, y + dy, [0, 0, 0], 0);
  }
}

function clawdIcon(size, dotHex) {
  // 캐릭터는 16폭 — 정사각 캔버스 가운데에 세로로 맞춰 넣는다 (높이가 바뀌어도 따라간다)
  const { w, h } = assertRect(CLAWD_STAND, 'CLAWD_STAND');
  const scale = Math.floor(size / w);
  const bm = new Bitmap(size, size);
  const oy = Math.floor((w - h) / 2) * scale;
  bm.stamp(CLAWD_STAND, PALETTE, 0, oy, scale);
  if (dotHex) statusDot(bm, scale, dotHex);
  return bm;
}

fs.mkdirSync(OUT_DIR, { recursive: true });

const targets = [
  ['icon.png', clawdIcon(512, null)],
  ['tray.png', clawdIcon(32, null)],
  ['tray-wait.png', clawdIcon(32, '#ffcf5c')],
  ['tray-fail.png', clawdIcon(32, '#e2624a')],
];

for (const [name, bm] of targets) {
  const file = path.join(OUT_DIR, name);
  fs.writeFileSync(file, bm.png());
  console.log(`${name}  ${bm.w}×${bm.h}  ${fs.statSync(file).size}B`);
}
