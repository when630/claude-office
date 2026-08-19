// 산책 모드를 그린다. 움직임은 stroll.mjs가 정하고 여기서는 그리기만 한다.
//
// 큰 창·미니와 결정적으로 다른 점은 **배경이 없다는 것**이다. 방도 바닥도 없이 게만 남으므로
// 여기서 쓰는 것은 스프라이트와 말풍선뿐이고, 캔버스는 매 프레임 지워진다(투명 창).
// 그래서 색도 따로 든다 — 어두운 사무실 바닥 위가 아니라 **남의 배경화면 위**에 놓이는 그림이라
// 밝은 벽지에서도 살아남아야 한다.
import { SPR, drawSprite } from './sprites.mjs';
import { glyphKeyFor, showsDizzy } from './talk.mjs';

const COLORS = {
  shadow: '#000000',
  bubble: '#f4f6fb',
  bubbleEdge: '#b9c2d0',
  label: '#f4f6fb',
  labelDim: '#c3ccdb',
  labelBack: '#171a1fdd',
  sel: '#d8a33a',
};

// 노트북을 게의 어디에 놓을까 — **발보다 4px 아래다.**
//
// 발에 맞춰 놓아 봤더니 상판이 게를 통째로 삼켰다(굽어서 확인했다). 앉은 몸이 10px인데
// 노트북이 8px이라, 같은 바닥에 세우면 눈까지 가려져 화면에 노트북만 남는다.
// 4px 앞에 놓으면 상판 위로 눈과 팔이 나온다 — 정면 그림에서 아래가 곧 앞이라,
// 이게 "노트북 뒤에 앉았다"를 만드는 전부다.
const LAP_DY = 4;
// 머리 위 기호가 뜨는 높이
const GLYPH_GAP = 3;
// 어지러움 별의 궤도. **큰 창과 같은 값이어야 한다**(render.mjs의 DIZZY_*) — 같은 상태를
// 창마다 다른 크기로 돌리면 어느 쪽이 맞는지 알 수 없게 된다.
const DIZZY_CYCLE = 1100;
const DIZZY_STARS = 2;
const DIZZY_RX = 6;
const DIZZY_RY = 2;
const DIZZY_CY = -5;

function rect(ctx, x, y, w, h, color) {
  ctx.fillStyle = color;
  ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
}

// 몸. **자세는 act가 먼저 정하고 mood는 그 안에서 갈린다** — 집혀 있는 게가 손을 들고
// 부르거나 자고 있으면 들려 있다는 사실이 지워진다.
function bodyOf(pet, t) {
  const worker = pet.entry?.worker ?? {};
  switch (pet.act) {
    case 'held':
      return Math.floor(t / 190) % 2 ? SPR.heldA : SPR.heldB;
    case 'land':
      return SPR.armsUp; // 내려놓인 직후 — 팔이 한 줄 올라간 채 잠깐 멈칫한다
    case 'work':
      return Math.floor(t / 150) % 2 ? SPR.sitUp : SPR.sit;
    case 'in':
    case 'out':
      return Math.floor(t / 160) % 2 ? SPR.stepA : SPR.stepB;
    default:
      break;
  }
  if (pet.moving) return Math.floor(t / 160) % 2 ? SPR.stepA : SPR.stepB;
  if (worker.mood === 'waiting') return SPR.armsHigh;
  if (showsDizzy(worker)) return Math.sin(((t % DIZZY_CYCLE) / DIZZY_CYCLE) * Math.PI * 2) >= 0 ? SPR.tiltR : SPR.tiltL;
  // 헤매는 중 — 아주 느리게 팔을 들었다 내린다(머리 긁적). 타이핑 150ms와 확연히 달라야 한다
  if (worker.mood === 'stuck') return Math.floor(t / 700) % 2 ? SPR.armsHigh : SPR.stand;
  if (worker.mood === 'stopped') return SPR.asleep;
  if (worker.mood === 'failed') return SPR.stand;
  return SPR.stand;
}

// 펴는 중인 노트북. lap은 0(접힘)에서 1(다 폄)까지고, **그 사이를 스프라이트 셋으로 건넌다** —
// 상판을 잘라 올리면 테두리까지 잘려 나가 판때기가 자라나는 것처럼 보인다.
function laptopOf(lap, t) {
  if (lap <= 0) return null;
  if (lap < 0.35) return SPR.laptopShut;
  if (lap < 0.75) return SPR.laptopHalf;
  return Math.floor(t / 220) % 2 ? SPR.laptopCode : SPR.laptopOpen;
}

const BUBBLE_H = 11;

function drawGlyphBubble(ctx, cx, bottom, glyph) {
  const w = 13;
  const h = BUBBLE_H;
  const left = Math.round(cx - w / 2);
  const top = Math.round(bottom - h);
  rect(ctx, left + 1, top, w - 2, h - 1, COLORS.bubble);
  rect(ctx, left, top + 1, w, h - 3, COLORS.bubble);
  rect(ctx, cx - 1, bottom - 1, 3, 2, COLORS.bubble);
  ctx.globalAlpha = 0.5;
  rect(ctx, left + 1, top + h - 2, w - 2, 1, COLORS.bubbleEdge);
  ctx.globalAlpha = 1;
  drawSprite(ctx, glyph, left + (w - glyph.w) / 2, top + (h - 1 - glyph.h) / 2);
}

function drawDizzy(ctx, cx, top, t) {
  const a = ((t % DIZZY_CYCLE) / DIZZY_CYCLE) * Math.PI * 2;
  const angles = [];
  for (let i = 0; i < DIZZY_STARS; i++) angles.push(a + (i / DIZZY_STARS) * Math.PI * 2);
  // 뒤에 있는 별을 먼저 그려야 앞뒤가 프레임마다 뒤집히지 않는다
  angles.sort((p, q) => Math.cos(q) - Math.cos(p));
  for (const s of angles) {
    const spr = Math.cos(s) > 0 ? SPR.dizzyFar : SPR.dizzy;
    drawSprite(ctx, spr, cx + Math.sin(s) * DIZZY_RX - spr.w / 2, top + DIZZY_CY - Math.cos(s) * DIZZY_RY - spr.h / 2);
  }
}

// 게 하나.
//
// **바닥이 없는 화면이다** — 게가 위아래로도 다니므로 "떨어질 곳"이 없고, 그림자는 늘 발밑에
// 같은 크기로 붙는다. 집혀 있는 동안만 흐려진다: 발을 딛고 있지 않다는 표시가 그것뿐이다.
function drawPet(ctx, pet, t, opts) {
  const { hover } = opts;
  const worker = pet.entry?.worker ?? {};
  const body = bodyOf(pet, t);
  const x = Math.round(pet.x);
  const y = Math.round(pet.y);
  const lifted = pet.act === 'held';

  ctx.globalAlpha = lifted ? 0.14 : 0.3;
  rect(ctx, x - 6, y - 1, 12, 2, COLORS.shadow);
  ctx.globalAlpha = 1;

  // 마우스가 올라간 게의 발밑을 밝힌다. **들고 있는 동안은 안 그린다** — 이미 손에 있는데
  // 노란 띠까지 따라다니면 그게 놓을 자리 표시처럼 읽힌다.
  if (hover === worker.key && !lifted) {
    ctx.globalAlpha = 0.35;
    rect(ctx, x - 9, y - 2, 18, 3, COLORS.sel);
    ctx.globalAlpha = 1;
  }

  const dim = worker.mood === 'stopped';
  if (dim) ctx.globalAlpha = 0.45;
  drawSprite(ctx, body, x - body.w / 2, y - body.h);
  if (dim) ctx.globalAlpha = 1;

  // 노트북은 몸보다 나중에 — 상판이 하반신을 덮어야 "뒤에 앉았다"가 된다
  const lap = laptopOf(pet.lap, t);
  if (lap) drawSprite(ctx, lap, x - lap.w / 2, y - lap.h + LAP_DY);

  let top = y - body.h;
  const glyphKey = glyphKeyFor(worker);
  const glyph = glyphKey ? SPR[glyphKey] : null;
  if (glyph) {
    const float = worker.mood === 'waiting' ? Math.round(Math.sin(t / 260) * 1.5) : Math.round(Math.sin(t / 900) * 1);
    const bottom = y - body.h - GLYPH_GAP + float;
    drawGlyphBubble(ctx, x, bottom, glyph);
    // 이름표는 말풍선 **위**에 선다 — 아래에 두면 무슨 상태인지가 이름에 가린다
    top = bottom - BUBBLE_H;
  }
  if (showsDizzy(worker)) drawDizzy(ctx, x, y - body.h, t);

  return { x, top };
}

// 이름표는 **마우스를 올렸을 때만** 뜬다. 바탕화면에 늘 글자가 떠 있으면 장식이 아니라 잡음이고,
// 무엇보다 남의 배경화면 위에서는 읽히지도 않는다. 배경 띠를 깔아 어떤 벽지 위에서도 읽게 한다.
function drawTag(ctx, pet, at, opts) {
  const { scale, dpr, font } = opts;
  const worker = pet.entry?.worker ?? {};
  // 방 이름은 `label`이다 — `key`는 작업 디렉터리 이름이고, 별칭·묶기가 반영된 것이 이쪽이다
  const room = pet.entry?.room?.label ?? '';
  const name = worker.name ?? '';
  const line = [room, name].filter(Boolean).join(' · ');
  if (!line) return;

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.font = font;
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  const w = ctx.measureText(line).width;
  // 화면 가장자리의 게는 이름표가 밖으로 나가 잘린다 — 안으로 당긴다
  const wide = ctx.canvas.width / dpr;
  const px = Math.min(Math.max(Math.round(at.x * scale - w / 2), 6), Math.max(6, wide - w - 6));
  const py = Math.max(14, Math.round((at.top - 4) * scale));
  rect(ctx, px - 4, py - 11, w + 8, 15, COLORS.labelBack);
  ctx.fillStyle = COLORS.label;
  ctx.fillText(line, px, py);
  ctx.setTransform(scale * dpr, 0, 0, scale * dpr, 0, 0);
}

// 한 프레임. `pets`는 stepStroll이 돌려준 그리기 순서 그대로다.
export function renderStroll(ctx, pets, opts) {
  const { scale, dpr, t, hover } = opts;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.setTransform(scale * dpr, 0, 0, scale * dpr, 0, 0);
  ctx.imageSmoothingEnabled = false;

  const tags = [];
  for (const pet of pets) {
    const at = drawPet(ctx, pet, t, opts);
    if (hover === pet.key) tags.push({ pet, at });
  }
  // 이름표는 게를 다 그린 뒤에 — 옆 게가 남의 이름표를 덮으면 안 된다
  for (const tag of tags) drawTag(ctx, tag.pet, tag.at, opts);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
}
