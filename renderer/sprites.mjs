// 픽셀 데이터를 캔버스 스프라이트로 굽는다. 데이터 자체는 shared/pixels.mjs에 있다.
import * as PX from '../shared/pixels.mjs';

const { PALETTE, assertRect } = PX;
export { PALETTE };

function makeCanvas(w, h) {
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  return cv;
}

export function sprite(rows, palette = PALETTE) {
  const { w, h } = assertRect(rows);
  const cv = makeCanvas(w, h);
  const ctx = cv.getContext('2d');
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const color = palette[rows[y][x]];
      if (!color) continue;
      ctx.fillStyle = color;
      ctx.fillRect(x, y, 1, 1);
    }
  }
  return { w, h, canvas: cv };
}

// 단색 글리프 — 말풍선 안 기호처럼 색만 바꿔 여러 벌 필요할 때
export function glyph(rows, color) {
  return sprite(rows, { '.': null, k: color });
}

export const SPR = {
  // 캐릭터
  stand: sprite(PX.CLAWD_STAND),
  armsUp: sprite(PX.CLAWD_ARMS_UP),
  armsHigh: sprite(PX.CLAWD_ARMS_HIGH),
  stepA: sprite(PX.CLAWD_STEP_A),
  stepB: sprite(PX.CLAWD_STEP_B),
  asleep: sprite(PX.CLAWD_ASLEEP),
  chat: sprite(PX.CLAWD_CHAT),
  sip: sprite(PX.CLAWD_SIP),
  aide: sprite(PX.CLAWD_AIDE),
  aideUp: sprite(PX.CLAWD_AIDE_UP),

  // 바닥 소품
  plant: sprite(PX.PLANT),
  cactus: sprite(PX.CACTUS),
  cooler: sprite(PX.COOLER),
  rack: sprite(PX.SERVER_RACK),
  shelf: sprite(PX.BOOKSHELF),
  sofa: sprite(PX.SOFA),
  vending: sprite(PX.VENDING),
  coffee: sprite(PX.COFFEE),
  printer: sprite(PX.PRINTER),
  trash: sprite(PX.TRASH),
  fan: sprite(PX.FAN),
  tank: sprite(PX.FISHTANK),
  cabinet: sprite(PX.CABINET),
  boxes: sprite(PX.BOXES),
  lamp: sprite(PX.LAMP),
  arcade: sprite(PX.ARCADE),
  beaker: sprite(PX.BEAKER),
  extinguisher: sprite(PX.EXTINGUISHER),

  // 벽 소품
  clock: sprite(PX.CLOCK),
  frame: sprite(PX.FRAME),
  window: sprite(PX.WINDOW),

  // 책상 위
  mug: sprite(PX.MUG),
  snack: sprite(PX.SNACK),
  sticky: sprite(PX.STICKY),
  papers: sprite(PX.PAPERS),
  // 바닥에 널브러진 것 — 각도가 다른 낱장 넷 + 쓰레기 둘 (renderer/render.mjs의 LITTER)
  sheetFlat: sprite(PX.SHEET_FLAT),
  sheetTiltR: sprite(PX.SHEET_TILT_R),
  sheetTiltL: sprite(PX.SHEET_TILT_L),
  sheetNarrow: sprite(PX.SHEET_NARROW),
  paperBall: sprite(PX.PAPER_BALL),
  canDown: sprite(PX.CAN_DOWN),
  phone: sprite(PX.PHONE),
  can: sprite(PX.CAN),
  headset: sprite(PX.HEADSET),

  // 방 종류별 작업 도구
  flask: sprite(PX.FLASK),
  laptop: sprite(PX.LAPTOP),
  book: sprite(PX.BOOK),
  pencup: sprite(PX.PENCUP),
  docs: sprite(PX.DOCS),

  // 말풍선 기호
  gQuestion: glyph(PX.G_QUESTION, '#1d2026'),
  gBang: glyph(PX.G_BANG, '#c8452b'),
  gCheck: glyph(PX.G_CHECK, '#2f8f4e'),
  gCross: glyph(PX.G_CROSS, '#c8452b'),
  gZzz: glyph(PX.G_ZZZ, '#5a6478'),
  gHeart: glyph(PX.G_HEART, '#d9536f'),
  gNote: glyph(PX.G_NOTE, '#6a7fd2'),
  gDots: glyph(PX.G_DOTS, '#4a5262'),
  gSpark: glyph(PX.G_SPARK, '#d8a33a'),
  // 헤매는 중 — 어두운 gQuestion과 같은 모양이지만 눈에 걸려야 하므로 색이 다르다
  gStuck: glyph(PX.G_QUESTION, '#d8a33a'),
};

export function drawSprite(ctx, spr, x, y) {
  ctx.drawImage(spr.canvas, Math.round(x), Math.round(y));
}
