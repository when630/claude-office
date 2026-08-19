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
  speech: '#1d2026',
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
    case 'warp':
    case 'sink':
    case 'drop':
      return SPR.heldA; // 구멍을 오가거나 손에서 떨어지는 동안은 다리가 늘어져 있다
    case 'look':
      // 커서를 올려다본다 — 팔을 살짝 들었다 내리는 것이 "쳐다보는 중"으로 읽힌다
      return Math.floor(t / 420) % 2 ? SPR.armsUp : SPR.stand;
    case 'chat':
      // 웃는 눈으로 떠든다 — 큰 창의 잡담과 같은 얼굴이다
      return Math.floor(t / 220) % 2 ? SPR.chat : SPR.stand;
    case 'stretch':
      return SPR.armsHigh; // 두 팔을 쭉 편다
    case 'nap':
      return SPR.asleep;
    case 'dizzy':
      // 흔들린 뒤 — **몸은 그대로 두고 머리 위 별만 돌린다.** 큰 창처럼 갸우뚱 프레임을
      // 끼웠더니 줄마다 어긋난 머리가 이 크기에서 "기울었다"가 아니라 "찌그러졌다"로 보였다.
      // 어지러움은 별이 말한다.
      return SPR.stand;
    case 'hop':
      return SPR.armsUp; // 뛰는 동안 팔이 올라간다
    case 'land':
      return SPR.armsUp; // 딛고 선 직후 — 팔이 한 줄 올라간 채 잠깐 멈칫한다
    case 'work':
      return Math.floor(t / 150) % 2 ? SPR.sitUp : SPR.sit;
    case 'in':
    case 'out':
      return Math.floor(t / 160) % 2 ? SPR.stepA : SPR.stepB;
    default:
      break;
  }
  // 뛰는 동안은 걸음이 빨라진다 — 자리만 빨리 흐르고 다리가 그대로면 미끄러지는 것으로 보인다
  if (pet.moving) return Math.floor(t / (pet.dash ? 95 : 160)) % 2 ? SPR.stepA : SPR.stepB;
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

// 폴짝 뛸 때 몸이 뜨는 높이. `pet.hop`(0..1)에 곱한다 — 얼마나 뛰었나는 움직임이 정하고,
// 그것이 몇 px인가는 그리는 쪽이 정한다.
const HOP_H = 7;
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

// 게가 떨어져 나오는 포탈. **위에서 내려다본 납작한 구멍**이라 가로로 넓다 — 정면에서 본
// 고리로 그리면 게가 그 앞을 지나가는 것인지 통과하는 것인지 알 수 없다.
//
// 색은 **상태 신호와 겹치지 않는 것**으로 골랐다. 이 화면에서 노랑은 대기, 빨강은 실패,
// 초록은 완료, 파랑은 작업 중, 연보라는 서버 장애가 이미 쓰고 있다(sprites.mjs의 긴 주석).
// 포탈은 상태가 아니라 연출이므로 그 체계 밖에 있어야 한다 — 민트 테두리에 짙은 남보라 구멍이다.
const PORTAL_W = 24;
const PORTAL_H = 8;
// 속은 **거의 검정이어야 구멍이 된다.** 남보라로 두었더니 어두운 배경(#1b2230)과 명도가
// 비슷해 뚫린 곳이 아니라 얹어 놓은 판으로 보였다(굽어서 확인했다).
const PORTAL = { rim: '#8fd6b4', hole: '#0a0418' };

// `part`는 타원의 어느 절반인가 — **게를 그 사이에 끼우려고 나눈다.**
//
// 통째로 그리면 게가 구멍을 지나가는 것이 아니라 **타원 뒤로 숨거나 앞을 스치는** 것이 된다.
// 뒤쪽(위) 절반을 먼저, 게를 그 위에, 앞쪽(아래) 절반을 마지막에 얹으면 그제야 게가 구멍
// **안에** 있는 것으로 읽힌다 — 캐릭터가 구멍을 통과하는 그림의 관례다.
function drawPortal(ctx, cx, cy, k, t, part = 'all') {
  if (k <= 0) return;
  const w = Math.max(2, PORTAL_W * k);
  const h = Math.max(1, PORTAL_H * k);
  const rows = Math.max(1, Math.round(h));
  const half = rows / 2;
  // 열리는 동안 테두리가 옅게 뛴다 — 가만히 있는 고리는 그려 둔 무늬로 보인다.
  // **맥동은 테두리에만 준다**: 속까지 반투명하게 칠했더니 테두리 색이 비쳐 구멍이
  // 청록으로 빛났다(어두운 배경에서 굽어 확인했다). 구멍은 늘 불투명한 검정이다.
  const pulse = Math.min(1, 0.65 + 0.35 * Math.abs(Math.sin(t / 140)));
  for (let i = 0; i < rows; i++) {
    if (part === 'back' && i >= half) continue;
    if (part === 'front' && i < half) continue;
    // 타원 한 줄의 반지름. 위아래로 갈수록 좁아진다.
    const ny = ((i + 0.5) / rows) * 2 - 1;
    const rw = (w / 2) * Math.sqrt(Math.max(0, 1 - ny * ny));
    if (rw < 0.5) continue;
    const y = Math.round(cy - h / 2 + i);
    ctx.globalAlpha = pulse;
    rect(ctx, cx - rw, y, rw * 2, 1, PORTAL.rim);
    ctx.globalAlpha = 1;
    // 속은 판다. **테두리를 2px 남긴다** — 1px만 남기면 이 크기에서 고리가 실선 한 줄로
    // 보여 구멍이 아니라 그어 놓은 타원이 된다.
    if (rw > 3 && i > 0 && i < rows - 1) rect(ctx, cx - rw + 2, y, rw * 2 - 4, 1, PORTAL.hole);
  }
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
  const falling = pet.act === 'warp';
  const sinking = pet.act === 'sink';
  // 폴짝 뛴 높이. 몸만 이만큼 뜨고 그림자는 바닥에 남는다.
  // 고른 직후의 들썩(perkOf)도 같은 값에 얹는다 — 그래야 그림자도 같이 줄어 "떴다"가 된다.
  const hop = (pet.hop ?? 0) * HOP_H + (opts.perks?.get(pet.key) ?? 0);

  // 구멍의 **뒤쪽 절반**이 먼저다. 게는 그 위에 그리고, 앞쪽 절반은 게 위에 얹는다(아래).
  const portalY = Math.round(pet.portalY ?? 0);
  const inPortal = pet.portal > 0 && (falling || sinking);
  if (inPortal) drawPortal(ctx, x, portalY, pet.portal, t, 'back');

  // 그림자는 **설 자리에** 진다 — 떨어지는 동안에도 어디에 내려앉을지 미리 보인다.
  // 구멍으로 잠기는 동안에는 없다: 발밑이 구멍인데 그림자가 지면 바닥이 있는 것이 된다.
  //
  // **뜬 만큼 작고 옅어진다.** 폴짝 뛸 때 몸만 올려 봤더니 뛴 것이 아니라 화면이 흔들린
  // 것으로 보였다 — 발밑에 남아 줄어드는 그림자가 "떴다"를 만드는 전부다.
  const shadowY = falling ? Math.round(pet.gy) : y;
  if (!sinking) {
    const k = hop > 0 ? 1 - (hop / HOP_H) * 0.45 : 1;
    ctx.globalAlpha = (lifted ? 0.14 : falling ? 0.18 : 0.3) * k;
    rect(ctx, x - 6 * k, shadowY - 1, 12 * k, 2, COLORS.shadow);
    ctx.globalAlpha = 1;
  }



  // 마우스가 올라간 게의 발밑을 밝힌다. **들고 있는 동안은 안 그린다** — 이미 손에 있는데
  // 노란 띠까지 따라다니면 그게 놓을 자리 표시처럼 읽힌다.
  // **지휘 중에도 안 그린다**: 그때 발밑은 고른 표시가 쓰는 자리라 노란 띠가 흰 고리를 덮고,
  // 무엇보다 지휘 중에는 가리키는 것만으로는 아무 일도 안 일어나 알릴 것이 없다.
  if (hover === worker.key && !lifted && !opts.command) {
    ctx.globalAlpha = 0.35;
    rect(ctx, x - 9, shadowY - 2, 18, 3, COLORS.sel);
    ctx.globalAlpha = 1;
  }

  const dim = worker.mood === 'stopped';
  if (dim) ctx.globalAlpha = 0.45;
  // 구멍을 오가는 동안에는 **구멍 너머에 있는 몸을 자른다.** 자르지 않으면 통과하는 것이
  // 아니라 구멍을 스쳐 지나가는 것이 된다. 자르는 쪽은 반대다 — 나올 때는 아직 구멍
  // **위**에 있는 부분이 안 보이고, 들어갈 때는 이미 구멍 **아래**로 내려간 부분이 안 보인다.
  if (inPortal) {
    ctx.save();
    ctx.beginPath();
    if (sinking) ctx.rect(x - 16, portalY - 60, 32, 60);
    else ctx.rect(x - 16, portalY, 32, 80);
    ctx.clip();
  }
  drawSprite(ctx, body, x - body.w / 2, y - hop - body.h);
  if (inPortal) ctx.restore();
  if (dim) ctx.globalAlpha = 1;

  // 노트북은 몸보다 나중에 — 상판이 하반신을 덮어야 "뒤에 앉았다"가 된다
  const lap = laptopOf(pet.lap, t);
  if (lap) drawSprite(ctx, lap, x - lap.w / 2, y - lap.h + LAP_DY);

  // 구멍의 앞쪽 절반은 게 위에 얹는다 — 이 한 겹이 "구멍 안에 있다"를 만든다
  if (inPortal) drawPortal(ctx, x, portalY, pet.portal, t, 'front');
  // 잠기는 동안에는 그 뒤로 아무것도 안 그린다: 기호도 이름표도 없이 조용히 사라진다
  if (sinking) return { x, top: y - body.h };

  let top = y - body.h;
  // 잡담 중이면 말풍선이 기호 자리를 쓴다 — 둘을 같이 띄우면 머리 위가 두 겹이 된다
  if (pet.say) {
    drawSpeech(ctx, x, y - body.h - GLYPH_GAP, pet.say, opts);
    return { x, top: y - body.h - GLYPH_GAP - 9 };
  }
  // 마우스를 게 위에 얹고 있으면 하트를 띄운다 — 쓰다듬는 것에 대한 대답이다.
  // **상태 기호보다 뒤다**: 나를 기다리는 게가 하트를 띄우고 있으면 그건 오작동이다.
  // 지휘 중에는 하트도 이름표도 안 띄운다 — 고르고 보내는 동안 머리 위가 붐비면 조작이 가린다
  const petting = hover === worker.key && pet.act !== 'work' && !opts.command;
  const glyphKey = glyphKeyFor(worker) ?? (petting ? 'gHeart' : null);
  const glyph = glyphKey ? SPR[glyphKey] : null;
  if (glyph) {
    const float = worker.mood === 'waiting' ? Math.round(Math.sin(t / 260) * 1.5) : Math.round(Math.sin(t / 900) * 1);
    const bottom = y - body.h - GLYPH_GAP + float;
    drawGlyphBubble(ctx, x, bottom, glyph);
    // 이름표는 말풍선 **위**에 선다 — 아래에 두면 무슨 상태인지가 이름에 가린다
    top = bottom - BUBBLE_H;
  }
  // 서버 장애의 별과 **같은 별을 쓴다** — 흔들려서 어지러운 것도 어지러운 것이다.
  // 둘이 겹칠 일은 없다: 흔들림은 idle일 때만 걸리고 서버 장애는 그 자리에서 멈춰 선다.
  if (showsDizzy(worker) || pet.act === 'dizzy') drawDizzy(ctx, x, y - body.h, t);

  return { x, top };
}

// 잡담 말풍선. 기호 말풍선(drawGlyphBubble)과 달리 글자가 들어가므로 폭을 재서 그린다.
// **글자는 확대 변환 밖에서 그린다** — 픽셀 폰트를 배율로 늘리면 획이 뭉갠다(큰 창과 같은 규칙).
function drawSpeech(ctx, cx, bottom, text, opts) {
  const { scale, dpr, font } = opts;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.font = font;
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  const tw = ctx.measureText(text).width;
  const w = tw + 10;
  const h = 17;
  const wide = ctx.canvas.width / dpr;
  const left = Math.min(Math.max(Math.round(cx * scale - w / 2), 4), Math.max(4, wide - w - 4));
  const top = Math.max(2, Math.round(bottom * scale) - h);
  ctx.fillStyle = COLORS.bubble;
  ctx.fillRect(left, top, w, h - 3);
  ctx.fillRect(left + 2, top + h - 3, w - 4, 3);
  // 꼬리는 풍선이 아니라 **게 머리 위**에 붙는다 — 가장자리에서 풍선이 안으로 밀려도
  // 누가 말하고 있는지는 그대로 남아야 한다
  ctx.fillRect(Math.round(cx * scale) - 2, top + h - 4, 5, 5);
  ctx.fillStyle = COLORS.speech;
  ctx.fillText(text, left + 5, top + 12);
  ctx.setTransform(scale * dpr, 0, 0, scale * dpr, 0, 0);
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

// 발자국. **게보다 먼저, 전부 한꺼번에** 그린다 — 게마다 제 자국을 그리게 하면 뒤에 오는
// 게가 앞선 게의 자국을 덮어 발자국이 끊긴다.
//
// 색은 게 몸통(#cc785c)을 어둡게 한 것이다. 그림자처럼 검게 두면 어두운 배경화면에서
// 아예 안 보인다 — 자국은 "지나간 흔적"이라 밟은 것의 색을 띠는 편이 어느 벽지에서나 읽힌다.
const TRACK_COLOR = '#8a4f39';

function drawTracks(ctx, tracks) {
  for (const k of tracks) {
    if (k.fade <= 0) continue;
    ctx.globalAlpha = 0.5 * k.fade;
    // 뛴 자국은 조금 길다 — 걸음과 달리 발을 끌고 나간 것으로 읽힌다
    rect(ctx, k.x - 1, k.y - 1, k.run ? 3 : 2, 1, TRACK_COLOR);
    ctx.globalAlpha = 1;
  }
}

// 고른 게의 발밑 표시와 선택 상자.
//
// 색은 **흰색이다.** 게임 관례는 초록이지만 이 화면에서 초록은 "완료"가 쓰고 있고,
// 노랑은 대기, 빨강은 실패다(sprites.mjs의 긴 주석). 고르는 것은 상태가 아니라 내가 지금
// 하고 있는 조작이므로, 상태 팔레트 바깥의 색이라야 서로 헷갈리지 않는다.
const PICK = '#f4f6fb';
// 보내는 명령의 파문만 색이 다르다 — 고르는 것과 보내는 것은 다른 일이다.
// 상태 팔레트(노랑=대기·초록=완료·빨강=실패·파랑=작업)와 겹치지 않는 민트를 쓴다.
const MARK_MOVE = '#8fd6b4';
const MARK_MS = 620;
// 흰 고리 하나만 두면 밝은 벽지에서 사라진다 — 한 픽셀 아래에 어두운 고리를 깔아 테두리를 만든다.
// 남의 배경화면 위에 놓이는 그림이라 이 한 겹이 "어디서나 읽힌다"의 전부다.
const PICK_EDGE = '#0d1016';
const PICK_R = 9;
// 후보 고리는 한 뼘 작다 — 몸이 뒤쪽 호를 가리는 탓에 크기까지 같으면 닫힌 고리와 구분이 안 된다.
// 큰 고리가 몸 밖으로 나와야 "둘렀다"가 보이고, 작은 반달은 발밑에 붙어 "얹혔다"로 읽힌다.
const IN_BOX_R = 7;
// 발밑에 눕는 만큼 — 보내기 표식(0.62)보다 더 눌렀다. 게 발치에 딱 붙어야 신발처럼 읽힌다.
const PICK_SQUASH = 0.42;
// 고른 직후 게마다 한 번 도는 이펙트의 길이
const PICK_FX_MS = 380;

// 고른 게의 발밑 고리 — 골라져 있는 **동안 내내** 남는 표시다. 네모가 무는 것은 골라지는
// 순간의 사건이고, 이 고리가 그 결과다.
//
// **바닥에 놓인 타원이다.** 예전에는 네 귀퉁이 괄호였는데, 이제 그 모양은 무는 네모가 쓴다 —
// 결과와 사건이 같은 그림이면 무엇이 방금 일어난 것인지 알 수 없다. 발밑 원은 RTS의
// 관례이기도 하고, 이 화면이 이미 쓰는 눌린 원(포탈·보내기)과 결이 맞는다.
//
// `k`는 그 게의 이펙트 진행도다(없으면 이미 앉은 것). 네모가 조여드는 동안 고리도 같이
// 스며 나온다 — 다 켜 두면 네모가 물기도 전에 결과가 먼저 나와 있다.
function drawPicked(ctx, pet, t, k) {
  if (k != null && k < 0) return; // 아직 제 차례가 아니다
  const fade = k != null && k < 1 ? Math.min(1, k * 2) : 1;
  const x = Math.round(pet.x);
  const y = Math.round(pet.y);
  // 아주 느리게 숨 쉰다 — 멈춘 고리는 발밑에 그려 둔 무늬로 보인다
  const breath = 0.5 + 0.5 * Math.sin(t / 520);
  const r = PICK_R + breath * 0.7;
  ctx.globalAlpha = 0.5 * fade;
  ring(ctx, x, y + 1, r, PICK_EDGE, PICK_SQUASH);
  ctx.globalAlpha = (0.7 + breath * 0.3) * fade;
  ring(ctx, x, y, r, PICK, PICK_SQUASH);
  ctx.globalAlpha = 1;
}

// 상자가 지나가는 중에 그 안에 든 게. **아직 고른 것이 아니라 고리가 안 닫혔다** —
// 발밑에 앞쪽 반달만 걸친다. 다 닫아 두면 놓기 전에 이미 골라진 것으로 보여, 상자를 넓혔다
// 좁히며 조준하는 동안 무엇이 바뀌는지가 안 보인다.
function drawInBox(ctx, pet) {
  const x = Math.round(pet.x);
  const y = Math.round(pet.y);
  ctx.globalAlpha = 0.4;
  ring(ctx, x, y + 1, IN_BOX_R, PICK_EDGE, PICK_SQUASH, true);
  ctx.globalAlpha = 0.75;
  ring(ctx, x, y, IN_BOX_R, PICK, PICK_SQUASH, true);
  ctx.globalAlpha = 1;
}

// 놓는 순간 게마다 한 번 도는 이펙트 — **네모가 밖에서 조여들어 그 게 하나를 문다.**
//
// 전에는 그린 상자 하나가 고른 것 전체를 감싸며 조여들었는데, 그러면 "저 무리를 묶었다"까지만
// 말하고 **누구누구인지는 말하지 않는다**(가운데 서 있던 못 고른 게도 같이 묶인 것으로 보였다).
// 네모를 게마다 따로 물리면 셋을 골랐을 때 네모도 셋이라 세어진다.
const PICK_BOX_GROW = 9; // 이만큼 밖에서 출발한다
const PICK_BOX_ARM = 4; // 귀퉁이 갈고리 길이

// 게 하나를 감싸는 자리. 발밑(y)에서 머리 위(y-15)까지다.
function petBox(pet, grow) {
  const x = Math.round(pet.x);
  const y = Math.round(pet.y);
  return { x0: x - 9 - grow, y0: y - 15 - grow, x1: x + 9 + grow, y1: y + 2 + grow };
}

// 네 귀퉁이만 — 네 변을 다 그리면 아직 끌고 있는 선택 상자와 구분이 안 된다.
// **좌표는 늘 정규화된 것을 받는다**(x0<x1, y0<y1). 예전에 끄는 상자를 그대로 넘겼더니
// 오른쪽 아래에서 왼쪽 위로 끌 때 x0>x1이 되어 갈고리가 죄다 바깥으로 뒤집혔다.
function corners(ctx, b, arm, color) {
  for (const [px, sx] of [
    [b.x0, 1],
    [b.x1, -1],
  ]) {
    for (const [py, sy] of [
      [b.y0, 1],
      [b.y1, -1],
    ]) {
      rect(ctx, sx > 0 ? px : px - arm, py, arm, 1, color);
      rect(ctx, px, sy > 0 ? py : py - arm, 1, arm, color);
    }
  }
}

function drawPickBox(ctx, pet, k) {
  const e = 1 - (1 - k) * (1 - k) * (1 - k); // 끝에서 부드럽게 멎는다
  const b = petBox(pet, PICK_BOX_GROW * (1 - e));
  // 다 조여든 뒤에 옅어진다 — 무는 동안 사라지면 어디에 물렸는지가 안 남는다
  const fade = k > 0.7 ? 1 - (k - 0.7) / 0.3 : 1;
  ctx.globalAlpha = 0.45 * fade;
  corners(ctx, { x0: b.x0 + 1, y0: b.y0 + 1, x1: b.x1 + 1, y1: b.y1 + 1 }, PICK_BOX_ARM, PICK_EDGE);
  ctx.globalAlpha = 0.95 * fade;
  corners(ctx, b, PICK_BOX_ARM, PICK);
  ctx.globalAlpha = 1;
}

// 고리가 앉을 때 게가 살짝 들썩인다 — 고리만 돌면 게는 가만있는데 바닥에만 무언가 생긴 것이
// 되어, 누가 골렸는지가 아니라 어디가 골렸는지로 읽힌다. 앞의 절반에서만 뜬다.
function perkOf(k) {
  return k < 0.5 ? Math.sin((k / 0.5) * Math.PI) * 2 : 0;
}

// 지휘 중의 커서. **OS 커서를 감추고 이것을 그린다**(stroll-app의 setCommand) —
// 모양과 그 이유는 shared/pixels.mjs의 CURSOR_ARROW에 적혀 있다. 가리키는 지점이
// 스프라이트의 왼쪽 위이므로 커서 좌표에 그대로 얹는다.
// **커서는 세계가 아니라 화면에 속한다** — 게 배율(2·3·4배)을 타면 안 된다.
// 배율 4로 쓰는 사람 화면에서는 40×52px짜리 화살표가 떠서, 커서가 아니라 커서 그림을 끌고
// 다니는 꼴이었다. 그래서 여기서만 변환을 갈아 끼워 **늘 2배로 찍는다**(글자를 확대 변환
// 밖에서 그리는 것과 같은 사정이다).
const CURSOR_ZOOM = 2;

function drawCursor(ctx, at, ready, opts) {
  const { scale, dpr } = opts;
  ctx.setTransform(CURSOR_ZOOM * dpr, 0, 0, CURSOR_ZOOM * dpr, 0, 0);
  // 논리 좌표 → 창 좌표(at * scale) → 이 변환의 좌표
  const x = Math.round((at.x * scale) / CURSOR_ZOOM);
  const y = Math.round((at.y * scale) / CURSOR_ZOOM);
  drawSprite(ctx, SPR.cursor, x, y);
  // 고른 게가 있으면 "보낼 수 있다"를 알리는 배지가 꼬리 옆에 붙는다. **화살표에 닿아 있어야
  // 한다** — 머리 옆에 2px 띄워 찍었더니 커서에 딸린 표시가 아니라 화면에 떠 있는 티끌로
  // 보였다. 어두운 테두리를 둘러 밝은 벽지에서도 배지로 읽히게 한다.
  if (ready) {
    rect(ctx, x + 8, y + 8, 4, 4, PICK_EDGE);
    rect(ctx, x + 9, y + 9, 2, 2, MARK_MOVE);
  }
  ctx.setTransform(scale * dpr, 0, 0, scale * dpr, 0, 0);
}

// 누른 자리에 남는 표식 — 지금은 "저리로 가라" 하나뿐이다. 고르기는 게마다 따로 물리는
// 네모(drawPickBox)가 맡는다: 자리에 찍는 것과 대상에 무는 것은 다른 그림이라야 한다.
function drawMarks(ctx, marks, now) {
  for (const m of marks) {
    const age = (now - m.t0) / MARK_MS;
    if (age < 0 || age > 1) continue;
    drawMoveMark(ctx, m, age);
  }
}

// 바닥에 놓인 원. **세로로 눌러 그린다** — 위에서 비스듬히 내려다본 화면이라 정원으로 그리면
// 바닥이 아니라 허공에 뜬 고리가 된다(포탈과 같은 사정이다).
// `front`는 앞쪽(아래) 절반만 그린다 — 발밑에 걸친 초승달이 된다. **점선으로 끊어 보려다
// 접었다**: 이 크기(반지름 7~9px)에서 각도로 자르면 좌우 끝에 점이 몰려, 고리가 아니라 양옆에
// 붙은 괄호로 보였다(굽어서 확인했다). 열린 고리와 닫힌 고리로 가르는 편이 확실하다.
function ring(ctx, cx, cy, r, color, squash = 0.62, front = false) {
  if (r < 1) return;
  // 촘촘히 돌아야 각이 안 진다 — 성글게 찍으면 원이 아니라 팔각형이 된다
  const steps = Math.max(16, Math.round(r * 12));
  for (let i = 0; i < steps; i++) {
    const a = (i / steps) * Math.PI * 2;
    const sin = Math.sin(a);
    if (front && sin < -0.25) continue;
    rect(ctx, cx + Math.cos(a) * r, cy + sin * r * squash, 1, 1, color);
  }
}

// 보내기 — **화살표가 내리꽂히고, 그 자리에서 원이 조여든다.**
//
// 처음엔 천천히 내려와 바닥에 `ㅗ` 자국을 남겼는데, 찍는 것이 아니라 조심스레 놓는 것으로
// 보였고 자국도 지저분했다. 빠르게 떨어뜨려 튕기게 하고, 닿은 자리에는 줄어드는 원만 남긴다.
function drawMoveMark(ctx, m, age) {
  const x = Math.round(m.x);
  const y = Math.round(m.y);
  const HIT = 0.22; // 이때 바닥에 닿는다

  // 화살표 — 내려오고, 닿는 순간 한 번 튕겼다 사라진다
  if (age < HIT + 0.28) {
    const k = Math.min(1, age / HIT);
    const drop = (1 - k) * (1 - k) * 12; // 끝에서 빨라진다
    const bounce = age > HIT ? Math.sin(((age - HIT) / 0.28) * Math.PI) * 2.5 : 0;
    const ay = Math.round(y - 6 - drop - bounce);
    ctx.globalAlpha = age > HIT ? 1 - (age - HIT) / 0.28 : 1;
    rect(ctx, x - 2, ay, 5, 1, MARK_MOVE);
    rect(ctx, x - 1, ay + 1, 3, 1, MARK_MOVE);
    rect(ctx, x, ay + 2, 1, 1, MARK_MOVE);
    ctx.globalAlpha = 1;
  }

  // 닿은 자리 — 원이 조여들며 옅어진다. 다 조여들면 점 하나가 남는다.
  if (age >= HIT) {
    const k = (age - HIT) / (1 - HIT);
    ctx.globalAlpha = 1 - k * k;
    ring(ctx, x, y, 7 - k * 5, MARK_MOVE);
    ctx.globalAlpha = 1;
  }
}

function drawBox(ctx, box) {
  const x0 = Math.round(Math.min(box.x0, box.x1));
  const x1 = Math.round(Math.max(box.x0, box.x1));
  const y0 = Math.round(Math.min(box.y0, box.y1));
  const y1 = Math.round(Math.max(box.y0, box.y1));
  const w = Math.max(1, x1 - x0);
  const h = Math.max(1, y1 - y0);
  ctx.globalAlpha = 0.12;
  rect(ctx, x0, y0, w, h, PICK);
  ctx.globalAlpha = 0.8;
  rect(ctx, x0, y0, w, 1, PICK);
  rect(ctx, x0, y1, w, 1, PICK);
  rect(ctx, x0, y0, 1, h, PICK);
  rect(ctx, x1, y0, 1, h + 1, PICK);
  ctx.globalAlpha = 1;
}

// 한 프레임. `pets`는 stepStroll이 돌려준 그리기 순서 그대로다.
export function renderStroll(ctx, pets, opts) {
  const { scale, dpr, t, hover, tracks = [], box = null, cursor = null, marks = [] } = opts;
  const { selected = null, inBox = null, picks = null } = opts;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.setTransform(scale * dpr, 0, 0, scale * dpr, 0, 0);
  ctx.imageSmoothingEnabled = false;

  drawTracks(ctx, tracks);

  // 놓는 순간의 이펙트가 어디까지 왔나(0..1). **게가 걸어 다니므로 자리는 저장하지 않고
  // 매 프레임 게에서 읽는다.** 음수는 아직 제 차례가 아니라는 뜻이다(stroll-app의 시차).
  const fx = new Map();
  if (picks?.size) {
    for (const pet of pets) {
      const t0 = picks.get(pet.key);
      if (t0 != null) fx.set(pet.key, (t - t0) / PICK_FX_MS);
    }
  }

  // 선택 표시는 **게보다 먼저** — 발밑 표시가 몸 위에 얹히면 다리가 잘려 보인다.
  // 고른 것이 후보보다 세다: 상자를 다시 끌 때 이미 고른 게의 고리가 도로 열리면 안 된다.
  for (const pet of pets) {
    if (selected?.has(pet.key)) drawPicked(ctx, pet, t, fx.get(pet.key));
    else if (inBox?.has(pet.key)) drawInBox(ctx, pet);
  }

  const perks = new Map();
  for (const [key, k] of fx) if (k >= 0 && k <= 1) perks.set(key, perkOf(k));
  const petOpts = perks.size ? { ...opts, perks } : opts;
  const tags = [];
  for (const pet of pets) {
    const at = drawPet(ctx, pet, t, petOpts);
    if (hover === pet.key && !opts.command) tags.push({ pet, at });
  }

  // 무는 네모는 **게 위에** 얹는다 — 밖에서 조여드는 것이라 몸에 가리면 조여든 것이 아니라
  // 몸 뒤에서 사라진 것이 된다
  if (fx.size) {
    for (const pet of pets) {
      const k = fx.get(pet.key);
      if (k >= 0 && k <= 1) drawPickBox(ctx, pet, k);
    }
  }
  if (marks.length) drawMarks(ctx, marks, t);
  if (box) drawBox(ctx, box);
  // 커서는 맨 위다 — 게에도 상자에도 가리면 안 된다
  if (cursor) drawCursor(ctx, cursor, cursor.ready, opts);
  // 이름표는 게를 다 그린 뒤에 — 옆 게가 남의 이름표를 덮으면 안 된다
  for (const tag of tags) drawTag(ctx, tag.pet, tag.at, opts);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
}
