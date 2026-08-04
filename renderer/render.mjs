// 픽셀 사무실 렌더러. 논리 좌표는 전부 1픽셀 단위 정수 — 정수배로만 확대해 픽셀이 뭉개지지 않게 한다.
//
// 방 하나 = 작업 디렉터리 하나. 방은 벽에 붙은 책상 줄과 그 아래 빈 바닥으로 나뉘고,
// 일하지 않는 게는 자리에서 일어나 바닥을 돌아다니며 혼잣말을 한다.
// 방마다 종류(renderer/themes.mjs)가 배정돼 바닥 무늬·책상 색·비품이 달라진다.
// 회의실만 예외로 책상 줄이 아니라 테이블 하나를 놓고 양쪽으로 마주 앉는다 (MEET_* 참고).
import { SPR, drawSprite } from './sprites.mjs';
import {
  speechFor,
  chatLines,
  reportFor,
  moveSpeech,
  fade,
  hashStr,
  rnd,
  slotNow,
  glyphKeyFor,
  hangEveryAt,
} from './talk.mjs';
import { assignThemes, THEMES } from './themes.mjs';

export const SLOT_W = 52; // 책상 한 자리가 차지하는 폭
// 한 자리의 세로 구성: 게(+8) · 상판(+20) · 다리(+34) · 비서가 서는 줄(~+32) · 이름표(+37) · 게이지(+40)
export const SLOT_H = 46;
// 자리 위 → 앉은 캐릭터의 머리. 상판(+20)이 다리 세 줄을 덮을 만큼 내려야 앉은 것처럼 보인다.
// 이 값이 작으면 다리가 상판 위로 드러나 "책상 뒤에 서 있는" 모습이 된다.
const SEAT_HEAD = 11;
const ROOM_PAD = 8;
const ROOM_HEAD = 14; // 방 이름·벽 소품이 붙는 벽면
const DESK_PAD = 16; // 벽과 첫 책상 줄 사이 — 앉은 게의 두 줄 말풍선이 벽을 안 침범할 만큼
const ROOM_GAP = 8;
const MAX_COLS = 5; // 책상 줄이 겹쳐 쌓이는 것보다 방이 옆으로 넓은 편이 낫다
// 한 명뿐인 방도 "사무실"로 보여야 한다 — 벽 소품 한두 개가 들어갈 폭까지 넓혀 둔다
const MIN_ROOM_W = 168;
const FLOOR_BASE = 46; // 돌아다닐 바닥 높이 (인원수만큼 더 넓어진다)
const MAX_BUBBLE_W = 96;
const LABEL_L = 62; // 왼쪽 방 이름이 쓰는 폭 (벽 소품이 침범하지 않게)
const LABEL_R = 30; // 오른쪽 "개발실 · 3"이 쓰는 폭

// ── 회의실. 다른 방은 벽에 붙은 책상 줄이지만 회의실은 테이블 하나를 놓고 양쪽으로 마주 앉는다.
// 블록 하나 = 테이블 하나 = 먼 쪽 줄 + 가까운 쪽 줄. 세로 구성(블록 위를 0으로):
//   +8  먼 쪽 게      +20 상판 윗면(먼 쪽 게의 하반신을 가린다)   +25 명패   +34 게이지
//   +46 가까운 쪽 게 머리(상판 앞면에 걸친다)  +53 등받이(가까운 쪽 게의 하반신을 가린다)
//   +51 상판 아래끝   +66 이름표   +68 게이지
const MEET_TOP = 20; // 블록 위 → 상판 윗면. surfaceY와 같은 줄이라야 먼 쪽 게가 앉은 것처럼 보인다
const MEET_RIM = 2; // 상판 먼 쪽 테두리
const MEET_FACE = 24; // 상판 윗면 — 먼 쪽엔 명패·게이지, 가까운 쪽엔 자료가 놓인다
const MEET_APRON = 3; // 상판 앞면
const MEET_BASE = 2; // 다리 대신 이어지는 하단 프레임 (자리마다 다리를 세우면 줄이 어지럽다)
const MEET_TABLE_H = MEET_RIM + MEET_FACE + MEET_APRON + MEET_BASE;
const MEET_NEAR = MEET_TOP + MEET_RIM + MEET_FACE; // 가까운 쪽 게 머리 = 상판 앞면 윗줄
const MEET_OVERHANG = 3; // 상판이 자리 줄 좌우로 삐져나오는 폭
const MEET_BLOCK_H = 72; // 가까운 쪽 게이지까지
const MEET_LONE_H = MEET_TOP + MEET_TABLE_H + 5; // 가까운 쪽이 비는 블록 (1인 회의…)

// 자리 안의 세로 오프셋. 회의실은 마주 앉은 줄이 앞을 막아 이름표를 바닥에 둘 수 없어
// 먼 쪽은 상판 위 명패로 올라간다. 그리는 쪽은 seat.dy만 보고 여기서만 값을 정한다.
// aide는 비서의 **발** 높이다 — 비서 키가 바뀌면 머리가 상판 선을 넘지 않게 같이 옮긴다.
//
// aide가 34인 이유 — 위아래로 1px씩밖에 여유가 없는 값이다.
//   아래에서: 자리 모양마다 책상 다리의 아래끝이 다르다(책상·서버실·연구실·자료실 +33,
//     제도판 +34, 낮은 테이블 +30). 발이 그보다 위면 다리 끝이 발 **아래로** 삐져나와
//     비서가 다리를 밟고 선 것처럼 보인다 → 가장 깊은 +34 이상이어야 한다.
//   위에서: 이름표는 baseline +37에 12px로 그려져 글자 윗변이 대략 +34다. 발이 그보다
//     아래면 이름표가 두 번째 비서 몸통 위에 겹쳐 찍힌다 → +34 이하여야 한다.
// 그래서 정확히 34. 비서 키나 이름표 위치를 바꾸면 이 값을 다시 재야 한다.
const DY_DESK = { name: 37, bar: 40, aide: 34, mark: 2, markH: 32 };
const DY_MEET_FAR = { name: MEET_TOP + MEET_RIM + 9, bar: MEET_TOP + MEET_RIM + 12, aide: 18, mark: 2, markH: 18 };
const DY_MEET_NEAR = { name: 28, bar: 30, aide: 26, mark: 6, markH: 22 };

const COLORS = {
  floor: '#101319',
  floorLine: '#151a22',
  wall: '#2a3140',
  wallTop: '#39435a',
  board: '#dfe4ee',
  boardEdge: '#9aa3b5',
  chair: '#2c3444',
  chairTrim: '#3d4a61',
  chairEdge: '#1b212c',
  bezel: '#1d2129',
  screenOn: '#16283a',
  screenOff: '#141821',
  bubble: '#f2f4f9',
  bubbleEdge: '#c3c9d6',
  bubbleLine: '#222732', // 어두운 바닥 위에서 말풍선을 떼어내는 외곽선
  bubbleText: '#1d2026',
  // 그리고 그 위에 얹는 파란 띠 하나 — 상태 기호와 구분되게
  bubbleTag: '#4d9ede',
  shadow: '#0b0d12',
  label: '#cfd6e4',
  labelDim: '#78839a',
  sel: '#ffcf5c',
  barBack: '#232936',
  barEdge: '#0e1117',
};

// 방 색은 해시를 그대로 각도로 쓰면 초록 근처로 몰린다 — 서로 떨어진 색상만 골라 쓰고,
// 겹치면 빈 자리로 밀어 같은 화면에 같은 색 방이 두 개 나오지 않게 한다.
const HUES = [208, 268, 320, 350, 24, 44, 88, 140, 174, 194, 248, 300];

function assignHues(rooms) {
  const used = new Set();
  const out = new Map();
  for (const room of rooms) {
    let idx = hashStr(room.key) % HUES.length;
    if (used.size < HUES.length) {
      while (used.has(idx)) idx = (idx + 1) % HUES.length;
      used.add(idx);
    }
    out.set(room.key, HUES[idx]);
  }
  return out;
}

// ── 심야엔 사무실을 어둡게 한다. 새벽 세 시가 오후 두 시와 똑같이 환한 것이 이상했다.
//
// **방 색 구분이 죽으면 실패다.** 명도만 낮추면 어두운 쪽에서 색이 서로 몰려 방을 가르는
// 수단이 사라진다 — 그래서 낮춘 만큼 **채도를 올려** 색상 차이를 남긴다.
//
// 시간대 구간은 talk.mjs의 TIME_SLOTS 하나가 들고 있고 여기서는 이름으로 묻는다.
// `night`(22~24시)와 `lateNight`(0~5시) 둘 다 어둡게 한다.
const NIGHT_L = 0.72; // 명도 배율
const NIGHT_S = 1.3; // 채도 배율
const NIGHT_SLOTS = ['night', 'lateNight'];

export function nightTint(slot) {
  return NIGHT_SLOTS.includes(slot) ? { l: NIGHT_L, s: NIGHT_S } : { l: 1, s: 1 };
}

// 방의 일이 다 끝났으면 불을 낮춘다.
//
// 방은 마지막 세션이 사라지는 순간 화면에서 **툭 없어진다.** 자리와 바닥 사이는 전환을 넣어
// 순간이동을 없앴는데(docs/characters.md) 방 단위에는 그게 없었다. 사라지는 것을 늦추면
// `layout()`이 줄을 다시 나누는 타이밍까지 건드려야 하고 그러면 **다른 방들이 옆으로 튄다** —
// 그래서 사라지는 시점은 그대로 두고, 그 전에 "끝났다"는 것만 보이게 한다.
//
// 판정은 세션 상태만 본다: 남은 세션이 전부 done·stopped·failed면 그 방은 퇴근한 방이다.
const DONE_L = 0.6;
const LIVE_MOODS = ['typing', 'waiting', 'stuck', 'idle'];

export function roomDone(room) {
  const workers = room?.workers ?? [];
  return workers.length > 0 && !workers.some((w) => LIVE_MOODS.includes(w.mood));
}

// 방 하나에 적용할 톤 — 심야 조명에 퇴근 여부를 곱한다.
export function roomTint(room, base) {
  return roomDone(room) ? { l: base.l * DONE_L, s: base.s } : base;
}

// hsl 한 벌을 배율에 맞춰 다시 쓴다. 반올림해 두면 같은 값이 문자열로도 같아 브라우저가
// 파싱을 재사용한다.
function hsl(hue, sat, light, tint) {
  return `hsl(${hue} ${Math.round(Math.min(100, sat * tint.s))}% ${Math.round(light * tint.l)}%)`;
}

function carpetColor(hue, tint = { l: 1, s: 1 }) {
  return {
    base: hsl(hue, 24, 15, tint),
    edge: hsl(hue, 28, 23, tint),
    rug: hsl(hue, 30, 22, tint),
    rugMid: hsl(hue, 34, 27, tint),
    rugEdge: hsl(hue, 40, 34, tint),
    tile: hsl(hue, 20, 17, tint),
    seam: hsl(hue, 22, 12, tint),
    fleck: hsl(hue, 24, 22, tint),
  };
}

// ── 비품 배치. 좌·우 번갈아 벽 쪽에서 안으로 쌓고, 자리가 없으면 조용히 자른다.
// 가운데는 비워둔다 — 거기가 게들이 모여 떠드는 자리(box.hang)다.
function placeProps(area, theme) {
  const out = [];
  let left = area.x + 1;
  let right = area.x + area.w - 1;
  theme.props.forEach((key, i) => {
    const spr = SPR[key];
    if (!spr) return;
    if (right - left < spr.w + 30) return; // 가운데 30px는 남긴다
    if (i % 2 === 0) {
      out.push({ spr, key, x: left, y: area.y + area.h - spr.h });
      left += spr.w + 2;
    } else {
      out.push({ spr, key, x: right - spr.w, y: area.y + area.h - spr.h });
      right -= spr.w + 2;
    }
  });
  return out;
}

const SCREEN_W = 26;
const SCREEN_H = 10;

function placeWallDecor(box, theme) {
  const out = [];
  const left = box.x + LABEL_L;
  const right = box.x + box.w - LABEL_R - (hasBoard(box) ? BOARD_W + 8 : 4);
  let wx = left;
  for (const key of theme.wall) {
    const size = key === 'screen' ? { w: SCREEN_W, h: SCREEN_H } : SPR[key];
    if (!size) continue;
    if (wx + size.w > right) break;
    out.push({ key, spr: key === 'screen' ? null : SPR[key], x: wx, y: box.y + Math.max(1, Math.floor((ROOM_HEAD - size.h) / 2)) });
    wx += size.w + 4;
  }
  return out;
}

// ── 레이아웃: 방을 가로로 흘려 배치하고, 방마다 책상 줄 + 걸어 다닐 바닥을 만든다.
//
// opts는 설정(app.mjs)에서 온다. `themes`는 방 key → 손으로 고른 종류 key,
// `nameOf`는 자리에 붙일 이름을 정하는 함수다 — 빈 문자열을 주면 이름표를 아예 달지 않는다.
// 이름 규칙을 여기서 판단하지 않는 건 오른쪽 패널도 같은 규칙을 써야 하기 때문이다.
export function layout(rooms, maxWidth, opts = {}) {
  const usable = Math.max(MIN_ROOM_W, maxWidth);
  const boxes = [];
  const seats = [];
  const hues = assignHues(rooms);
  const themes = assignThemes(rooms, hashStr, opts.themes);
  // ── 1걸음: 크기만 재고 줄을 나눈다.
  //
  // 방마다 자리 줄 높이가 다르다 — 회의실은 테이블을 놓고 마주 앉히느라(MEET_BLOCK_H)
  // 보통 자리 줄(SLOT_H)과 어긋나고, 바닥도 인원수를 탄다. 그대로 놓으면 한 줄에 선
  // 방들의 아래가 들쭉날쭉하다. 그래서 **줄을 먼저 나누고 그 줄의 최대 높이를 안 뒤에**
  // 박스를 만든다. 한 걸음으로는 지금 방이 어느 줄의 몇 번째인지 알 수 없다.
  const deskTop = ROOM_HEAD + DESK_PAD;
  const fitCols = Math.max(1, Math.floor((usable - ROOM_PAD * 2) / SLOT_W));
  const lines = [];
  let line = [];
  let lineW = 0;

  for (const room of rooms) {
    const theme = themes.get(room.key) ?? THEMES[0];
    const meet = theme.station === 'table';
    const n = Math.max(1, room.workers.length);
    // 회의실은 한 줄에 절반만 앉힌다 — 나머지 절반이 테이블 반대편에 마주 앉는다
    const cols = Math.min(meet ? Math.ceil(n / 2) : n, MAX_COLS, fitCols);
    const per = meet ? cols * 2 : cols; // 줄(또는 테이블) 하나가 받는 인원
    const rows = Math.ceil(n / per);
    // 마지막 테이블에 가까운 쪽 줄이 있는가 — 없으면 그만큼 방이 낮아진다
    const lastFacing = n - (rows - 1) * per > cols;
    const deskH = meet ? (rows - 1) * MEET_BLOCK_H + (lastFacing ? MEET_BLOCK_H : MEET_LONE_H) : rows * SLOT_H;
    const w = Math.max(MIN_ROOM_W, cols * SLOT_W + ROOM_PAD * 2);
    const floorH = FLOOR_BASE + Math.min(n, 6) * 4;
    const plan = { room, theme, meet, cols, per, rows, deskH, w, floorH, h: deskTop + deskH + floorH + ROOM_PAD };

    // 줄바꿈 판정은 예전과 같다 — 방이 어느 줄에 서는지가 달라지면 그건 다른 변경이다
    if (lineW > 0 && lineW + w > usable) {
      lines.push(line);
      line = [];
      lineW = 0;
    }
    line.push(plan);
    lineW += w + ROOM_GAP;
  }
  if (line.length) lines.push(line);

  // 줄마다 가장 높은 방에 맞춘다. 남는 높이는 **바닥에 준다** — 돌아다닐 자리가 넓어질 뿐
  // 자리 배치는 그대로다(자리는 벽 쪽 기준이라 아래로만 늘어난다).
  for (const row of lines) {
    const tallest = Math.max(...row.map((p) => p.h));
    for (const p of row) {
      p.floorH += tallest - p.h;
      p.h = tallest;
    }
  }

  // ── 2걸음: 맞춘 높이로 좌표를 붙여 박스를 만든다
  let x = 0;
  let y = 0;
  let rowH = 0;

  for (const row of lines) {
    x = 0;
    rowH = row[0]?.h ?? 0;

    for (const { room, theme, meet, cols, per, rows, deskH, w, floorH, h } of row) {
      // 방이 최소 폭까지 늘어난 경우 자리 줄을 가운데로 모은다
      const deskOff = Math.floor((w - (cols * SLOT_W + ROOM_PAD * 2)) / 2) + ROOM_PAD;
      const area = {
        x: x + 4,
        y: y + deskTop + deskH,
        w: w - 8,
        h: floorH - 3,
      };
      const box = {
        room,
        theme,
        x,
        y,
        w,
        h,
        cols,
        rows,
        floor: area,
        hue: hues.get(room.key) ?? HUES[0],
        props: placeProps(area, theme),
        // 다 같이 모이는 자리 — 정수기 앞 잡담이 여기서 벌어진다
        hang: { x: area.x + Math.floor(area.w / 2), y: area.y + area.h - 6 },
        seats: [],
        // 회의실만 채운다. 한 테이블을 두 줄이 나눠 쓰므로 그리는 순서를 여기서 잡아야 한다.
        blocks: meet
          ? Array.from({ length: rows }, (_, b) => ({
              top: y + deskTop + b * MEET_BLOCK_H,
              x: x + deskOff - MEET_OVERHANG,
              w: cols * SLOT_W + MEET_OVERHANG * 2,
              far: [],
              near: [],
            }))
          : null,
      };
      box.decor = placeWallDecor(box, theme);
      boxes.push(box);

      room.workers.forEach((worker, i) => {
        const seat = {
          worker,
          box,
          name: opts.nameOf ? opts.nameOf(worker) : worker.name,
          floor: area,
          idx: i, // 바닥을 인원수만큼 나눠 각자 제 구역 근처를 돈다 — 안 그러면 한곳에 뭉친다
          count: room.workers.length,
          w: SLOT_W,
          h: SLOT_H,
          side: null, // 회의실에서만 'far' | 'near'
          dy: DY_DESK,
          actor: null, // 매 프레임 갱신 — 히트 테스트가 이걸 본다
        };
        if (meet) {
          const blk = box.blocks[Math.floor(i / per)];
          const within = i % per;
          const far = within < cols;
          seat.side = far ? 'far' : 'near';
          seat.dy = far ? DY_MEET_FAR : DY_MEET_NEAR;
          seat.x = x + deskOff + (within % cols) * SLOT_W;
          seat.y = blk.top + (far ? 0 : MEET_NEAR - SEAT_HEAD);
          seat.h = MEET_BLOCK_H - (MEET_NEAR - SEAT_HEAD); // 마주 앉은 두 줄의 판정 영역이 겹치지 않을 만큼
          blk[seat.side].push(seat);
        } else {
          seat.x = x + deskOff + (i % cols) * SLOT_W;
          seat.y = y + deskTop + Math.floor(i / cols) * SLOT_H;
        }
        seats.push(seat);
        box.seats.push(seat);
      });

      x += w + ROOM_GAP;
    }
    y += rowH + ROOM_GAP;
  }

  // 마지막 줄 뒤에 붙은 간격은 뺀다 — 사무실 아래에 빈 띠가 남는다
  return { boxes, seats, width: usable, height: Math.max(0, y - ROOM_GAP) };
}

// 클릭·호버 판정. 캐릭터가 자리를 떠나 있으므로 "지금 서 있는 곳"을 먼저 본다.
export function pickAt(view, lx, ly) {
  for (const s of view.seats) {
    const a = s.actor;
    // 게(16×10)보다 조금 넉넉하게 — 걸어 다니는 표적이라 딱 맞추기 어렵다
    if (a && lx >= a.x - 11 && lx <= a.x + 11 && ly >= a.y - 14 && ly <= a.y + 5) return s;
  }
  return view.seats.find((s) => lx >= s.x && lx < s.x + s.w && ly >= s.y && ly < s.y + s.h) ?? null;
}

// ── 프리미티브
// #rrggbb 를 배율만큼 어둡게. 회색 계열(벽·바닥)은 hsl로 다시 쓸 것이 없어 이쪽으로 처리한다.
// 배율이 1이면 원래 문자열을 그대로 돌려준다 — 낮에는 아무 계산도 하지 않는다.
const shadeCache = new Map();

function shade(hex, mul) {
  if (mul === 1) return hex;
  const key = `${hex}@${mul}`;
  const hit = shadeCache.get(key);
  if (hit) return hit;
  const n = parseInt(hex.slice(1), 16);
  const ch = (shift) => Math.max(0, Math.min(255, Math.round(((n >> shift) & 255) * mul)));
  const out = `#${[ch(16), ch(8), ch(0)].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
  shadeCache.set(key, out);
  return out;
}

function rect(ctx, x, y, w, h, color) {
  ctx.fillStyle = color;
  ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
}

// 자리의 가로 중심. 모니터 자리를 왼쪽에 비워두느라 슬롯 가운데보다 2px 오른쪽이다.
function seatCx(seat) {
  return seat.x + SLOT_W / 2 + 2;
}

// 사무실 영역은 픽셀 폰트로 쓴다. 비트맵 폰트는 한 크기에서만 또렷하므로 확대 배율과
// 무관하게 12px로 고정한다 — 글자는 확대 변환 밖에서 그리므로 배율이 올라가도 안 뭉갠다.
// MonaS12가 없는 환경에서는 아래 대체 폰트로 조용히 내려간다.
const OFFICE_FONT = '"MonaS12", "Galmuri11", "Malgun Gothic", monospace';
export const OFFICE_FONT_PX = 12;
export const OFFICE_FONT_FAMILY = 'MonaS12';

// 굵기는 400 하나만 쓴다 — 비트맵 폰트에 볼드 페이스가 없으면 브라우저가 합성 볼드를 그리는데
// 픽셀이 번져 못 볼 꼴이 된다. 방 이름 강조는 색(COLORS.label vs labelDim)으로 한다.
function labelFont() {
  return `400 ${OFFICE_FONT_PX}px ${OFFICE_FONT}`;
}

// 폰트가 늦게 로드되면 캐시된 글자 폭이 실제와 어긋난다 — app.mjs가 로드 후 호출한다.
export function clearTextCache() {
  wrapCache.clear();
  fitCache.clear();
}

// 바닥은 **보이는 범위를 그대로 채운다**(사무실 크기가 아니다) — 끌어 옮겼을 때 바닥이 끝나고
// 껍데기 배경이 드러나면 사무실이 종이처럼 잘려 보인다. 사무실은 세계 좌표 어디로든 옮겨지므로
// 격자는 8px 세계 격자에 맞춰 시작한다 — 화면 기준으로 그으면 끌 때마다 격자가 떨린다.
function drawFloor(ctx, area, tint = { l: 1, s: 1 }) {
  const x0 = Math.floor(area.x);
  const y0 = Math.floor(area.y);
  const x1 = Math.ceil(area.x + area.w);
  const y1 = Math.ceil(area.y + area.h);
  // 방만 어둡게 하면 바깥 바닥이 떠 보인다 — 같은 배율로 함께 내린다.
  // 회색(채도 0)이라 채도 배율은 뜻이 없어 명도만 쓴다.
  rect(ctx, x0, y0, x1 - x0, y1 - y0, shade(COLORS.floor, tint.l));
  ctx.fillStyle = shade(COLORS.floorLine, tint.l);
  for (let gx = Math.floor(x0 / 8) * 8; gx < x1; gx += 8) ctx.fillRect(gx, y0, 1, y1 - y0);
  for (let gy = Math.floor(y0 / 8) * 8; gy < y1; gy += 8) ctx.fillRect(x0, gy, x1 - x0, 1);
}

// 방 종류별 바닥 무늬. 러그 하나로는 개발실과 라운지가 구분되지 않는다.
function drawRoomFloor(ctx, box, c) {
  const { x, y, w, h } = box;
  const top = y + ROOM_HEAD;
  const bot = y + h;
  rect(ctx, x, y, w, h, c.base);

  switch (box.theme.floor) {
    case 'tile': {
      for (let gy = top; gy < bot; gy += 8) {
        for (let gx = x; gx < x + w; gx += 8) {
          if (((gx - x) / 8 + (gy - top) / 8) % 2 === 0) continue;
          rect(ctx, gx, gy, Math.min(8, x + w - gx), Math.min(8, bot - gy), c.tile);
        }
      }
      ctx.fillStyle = c.seam;
      for (let gy = top; gy < bot; gy += 8) ctx.fillRect(x, gy, w, 1);
      break;
    }
    case 'wood': {
      for (let gy = top; gy < bot; gy += 5) {
        rect(ctx, x, gy, w, 4, ((gy - top) / 5) % 2 ? c.tile : c.base);
        ctx.fillStyle = c.seam;
        ctx.fillRect(x, gy + 4, w, 1);
        // 널 이음매를 줄마다 어긋나게
        const off = (((gy - top) / 5) % 3) * 22 + 10;
        for (let gx = x + off; gx < x + w; gx += 66) ctx.fillRect(gx, gy, 1, 4);
      }
      break;
    }
    case 'carpet': {
      ctx.fillStyle = c.fleck;
      for (let gy = top; gy < bot; gy += 3) {
        for (let gx = x; gx < x + w; gx += 3) {
          if (rnd(hashStr(box.room.key), gx * 131 + gy) > 0.22) continue;
          ctx.fillRect(gx, gy, 1, 1);
        }
      }
      break;
    }
    default: {
      ctx.fillStyle = c.seam;
      for (let gy = top; gy < bot; gy += 8) ctx.fillRect(x, gy, w, 1);
      for (let gx = x; gx < x + w; gx += 8) ctx.fillRect(gx, top, 1, bot - top);
    }
  }
}

// 벽에 걸린 화이트보드 — 방마다 낙서 모양이 고정되게 해시를 쓴다
const BOARD_W = 26;
const hasBoard = (box) => box.w >= 96; // 좁으면 방 이름과 겹친다

function drawBoard(ctx, box) {
  if (!hasBoard(box)) return;
  const bw = BOARD_W;
  const left = box.x + box.w - bw - 6;
  const top = box.y + 3;
  rect(ctx, left, top, bw, 9, COLORS.boardEdge);
  rect(ctx, left + 1, top + 1, bw - 2, 7, COLORS.board);
  const seed = hashStr(box.room.key);
  ctx.fillStyle = `hsl(${box.hue} 45% 45%)`;
  for (let i = 0; i < 3; i++) {
    const len = 4 + Math.floor(rnd(seed, i) * (bw - 8));
    ctx.fillRect(left + 3, top + 2 + i * 2, len, 1);
  }
}

// 회의실 프로젝터 스크린 — 스프라이트로 두면 낭비라 직접 그린다
function drawScreen(ctx, box, d, t) {
  rect(ctx, d.x, d.y, SCREEN_W, SCREEN_H, '#3a4150');
  rect(ctx, d.x + 1, d.y + 1, SCREEN_W - 2, SCREEN_H - 3, '#101820');
  const seed = hashStr(box.room.key + 'screen');
  const step = Math.floor(t / 700) % 4;
  for (let i = 0; i < 5; i++) {
    const bh = 1 + Math.floor(rnd(seed, i + step) * 5);
    rect(ctx, d.x + 3 + i * 4, d.y + SCREEN_H - 3 - bh, 3, bh, i % 2 ? '#4d9ede' : '#63c69b');
  }
  rect(ctx, d.x + 2, d.y + SCREEN_H - 1, SCREEN_W - 4, 1, '#2b313b');
}

// 서버 랙 LED — 스프라이트 위에 깜빡이는 점만 덧그린다
function drawRackLeds(ctx, p, t) {
  const seed = hashStr(`${p.x},${p.y}`);
  for (let row = 0; row < 3; row++) {
    const on = rnd(seed, row * 5 + Math.floor(t / 420)) > 0.45;
    if (!on) continue;
    ctx.fillStyle = row === 1 ? '#f2c14e' : '#8fd6b4';
    ctx.fillRect(p.x + 3 + row, p.y + 2 + row * 5, 1, 1);
  }
}

// 프린터 배출 주기와 종이가 자라는 최대 길이
const PRINT_CYCLE = 5600;
const PRINT_MAX = 4;

// 새로 뜬 방에는 이삿짐 박스가 잠깐 놓인다. `movedInAt`은 app.mjs가 "이 방을 처음 본 시각"으로
// 채워 준다 — 앱을 켠 직후에 뜬 방들은 안 채우므로 처음부터 온 사무실이 이사판이 되지 않는다.
const MOVEIN_MS = 9000;

function drawMoveIn(ctx, box, t) {
  const at = box.room?.movedInAt;
  if (!at) return;
  const age = Date.now() - at;
  if (age < 0 || age > MOVEIN_MS) return;
  const spr = SPR.boxes;
  if (!spr) return;
  // 바닥 가운데 아래 — 러그와 비품 사이의 빈 자리다. 마지막 1초는 위로 빠지며 사라진다.
  const out = Math.max(0, age - (MOVEIN_MS - 1000)) / 1000;
  const x = box.floor.x + Math.floor(box.floor.w / 2) - spr.w - 6;
  const y = box.floor.y + box.floor.h - spr.h - Math.round(out * 6);
  if (out < 1) drawSprite(ctx, spr, x, y);
}

function drawProps(ctx, box, t) {
  drawFloorMess(ctx, box, box.tint);
  drawMoveIn(ctx, box, t);
  for (const p of box.props) {
    drawSprite(ctx, p.spr, p.x, p.y);
    if (p.key === 'rack') drawRackLeds(ctx, p, t);
    if (p.key === 'coffee' && Math.floor(t / 900) % 3 === 0) {
      // 커피머신 램프
      ctx.fillStyle = '#c94f4f';
      ctx.fillRect(p.x + 2, p.y + 11, 1, 1);
    }
    if (p.key === 'fan') {
      // 선풍기 날개가 돌아가는 티만 낸다
      ctx.fillStyle = Math.floor(t / 90) % 2 ? '#d5dce8' : '#98a0af';
      ctx.fillRect(p.x + 3, p.y + 3, 3, 1);
    }
    // 프린터가 주기적으로 종이를 뱉는다. 배출구에서 한 장이 자라 나오다 사라진다 —
    // 시간만으로 도는 것이라 걷는 좌표와 무관하다.
    if (p.key === 'printer') {
      const ph = (t % PRINT_CYCLE) / PRINT_CYCLE;
      if (ph < 0.5) {
        const grow = Math.round(ph * 2 * PRINT_MAX);
        if (grow > 0) rect(ctx, p.x + 2, p.y + p.spr.h - 3, p.spr.w - 4, 1, COLORS.board);
        if (grow > 1) rect(ctx, p.x + 2, p.y + p.spr.h - 2, p.spr.w - 4, grow - 1, '#cdd4e0');
      }
    }
    // 아케이드 화면이 깜빡인다 — 아무도 안 부르는 방에서 혼자 돌아가는 오락기
    if (p.key === 'arcade') {
      ctx.fillStyle = Math.floor(t / 420) % 2 ? '#6fd3ee' : '#2b6f88';
      ctx.fillRect(p.x + 2, p.y + 2, p.spr.w - 4, 1);
    }
  }
}

function drawRoom(ctx, box, labels, t) {
  const { x, y, w, h, room, theme } = box;
  const c = carpetColor(box.hue, box.tint ?? { l: 1, s: 1 });
  drawRoomFloor(ctx, box, c);
  const tint = box.tint ?? { l: 1, s: 1 };
  rect(ctx, x, y, w, ROOM_HEAD, shade(COLORS.wall, tint.l));
  rect(ctx, x, y, w, 3, shade(COLORS.wallTop, tint.l));
  ctx.strokeStyle = c.edge;
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  drawBoard(ctx, box);

  for (const d of box.decor) {
    if (d.key === 'screen') drawScreen(ctx, box, d, t);
    else drawSprite(ctx, d.spr, d.x, d.y);
  }

  // 러그는 바닥 가운데에만 깐다 — 통째로 덮으면 방 종류별 바닥 무늬가 안 보이고
  // 그냥 빈 판때기처럼 읽힌다. 다 같이 모이는 자리(box.hang)가 이 러그 위다.
  const f = box.floor;
  const rw = Math.max(40, Math.min(f.w - 28, Math.round(f.w * 0.52)));
  const rh = Math.max(12, Math.min(f.h - 14, Math.round(f.h * 0.52)));
  const rx = f.x + Math.round((f.w - rw) / 2);
  const ry = f.y + f.h - rh - 3;
  rect(ctx, rx, ry, rw, rh, c.rugEdge); // 테두리
  rect(ctx, rx + 2, ry + 2, rw - 4, rh - 4, c.rug);
  rect(ctx, rx + 4, ry + 4, rw - 8, rh - 8, c.rugMid); // 안쪽 무늬 — 테두리만 남으면 선택 박스처럼 보인다
  rect(ctx, rx + 6, ry + 6, rw - 12, rh - 12, c.rug);
  rect(ctx, rx + 8, ry + Math.floor(rh / 2), rw - 16, 1, c.rugMid);
  // 안쪽을 비워두면 큰 방에서 "빈 테두리 상자"로 읽힌다 — 촘촘한 점으로 짜임을 넣는다
  ctx.fillStyle = c.rugMid;
  for (let gy = ry + 8; gy < ry + rh - 8; gy += 3) {
    for (let gx = rx + 9 + (gy % 2) * 3; gx < rx + rw - 9; gx += 6) ctx.fillRect(gx, gy, 1, 1);
  }
  ctx.fillStyle = c.rugEdge; // 양 끝 프린지
  for (let gy = ry + 2; gy < ry + rh - 2; gy += 3) {
    ctx.fillRect(rx - 1, gy, 1, 1);
    ctx.fillRect(rx + rw, gy, 1, 1);
  }

  drawProps(ctx, box, t);

  labels.push({ x: x + 5, y: y + 10, text: shortLabel(room.label, 14), color: COLORS.label, size: 9, weight: 700 });
  labels.push({
    x: x + w - (hasBoard(box) ? BOARD_W + 10 : 5),
    y: y + 10,
    text: `${theme.label} · ${room.workers.length}`,
    color: COLORS.labelDim,
    size: 9,
    align: 'right',
  });
}

// 몸통(14px)보다 조금 넓게 잡아야 등받이가 어깨 옆으로 보인다. 외곽선을 둘러야
// 자리가 비었을 때 회색 판때기로 보이지 않는다. 빈 의자는 옆으로 밀어둔다.
function drawChair(ctx, cx, top, empty) {
  const w = 20;
  const left = Math.round(cx - w / 2) + (empty ? -3 : 0);
  const y = empty ? top + 1 : top; // 빈 의자는 책상 밑으로 밀어 넣는다 — 등받이만 살짝 보이게
  rect(ctx, left, y - 1, w, 12, COLORS.chairEdge);
  rect(ctx, left + 1, y, w - 2, 10, COLORS.chair);
  rect(ctx, left + 2, y + 1, w - 4, 2, COLORS.chairTrim);
  rect(ctx, left - 1, y + 5, 2, 5, COLORS.chairEdge); // 팔걸이
  rect(ctx, left + w - 1, y + 5, 2, 5, COLORS.chairEdge);
}

// 회의실에서 테이블 이쪽(가까운 쪽)에 앉은 자리의 의자. 등받이가 뷰어 쪽에 있으니
// 캐릭터보다 나중에 그려 하반신을 덮는다 — 먼 쪽에서 상판이 하는 일과 같다.
// 이게 없으면 테이블 앞에 그냥 서 있는 것처럼 보인다.
//
// 덮는 폭은 아래 세 줄(다리·몸통 아랫단)까지만. 더 올리면 눈까지 먹어
// "상자 뒤에 낀 놈"이 되고, 팔걸이를 옆구리에 걸쳐야 앉은 자세로 읽힌다.
function drawChairBack(ctx, cx, clawdTop) {
  const w = 22;
  const left = Math.round(cx - w / 2);
  const y = clawdTop + SPR.stand.h - 3;
  rect(ctx, left, y - 3, 3, 7, COLORS.chairEdge); // 팔걸이 — 몸통(14px) 양옆으로 삐져나온다
  rect(ctx, left + w - 3, y - 3, 3, 7, COLORS.chairEdge);
  rect(ctx, left + 1, y, w - 2, 9, COLORS.chairEdge);
  rect(ctx, left + 2, y + 1, w - 4, 7, COLORS.chair);
  rect(ctx, left + 3, y + 1, w - 6, 2, COLORS.chairTrim); // 등받이 윗모서리에 걸리는 빛
}

// 가까운 쪽 빈 자리. 상판보다 먼저 그려 윗부분이 가려지게 두면 "밀어 넣은 의자"가 된다.
function drawTuckedChair(ctx, cx, blockTop) {
  drawChairBack(ctx, cx, blockTop + MEET_NEAR - 6);
}

// ── 자리(station). 방 종류마다 상판 모양과 그 위에 놓인 도구, 일하는 동작이 다르다.
// 공통 규칙 하나: 상판은 seat.y+20 근처에서 시작해 게의 하반신을 가려야 한다.
// 그 선이 어긋나면 앉아 있는 것처럼 보이지 않는다.
// 회의실('table')은 상판이 자리 것이 아니라 블록 것이라 여기로 오지 않는다 — drawMeetingTable.

// 상판 윗면 y(seat.y 기준). 라운지 낮은 테이블만 낮고, 제도판만 높다.
function surfaceY(station) {
  if (station === 'lowtable') return 23;
  if (station === 'drafting') return 17;
  return 20;
}

// 평범한 책상 — 개발실·운영실
function drawDeskTop(ctx, left, top, w, desk) {
  rect(ctx, left, top, w, 2, desk.edge);
  rect(ctx, left, top + 2, w, 4, desk.top);
  rect(ctx, left, top + 6, w, 4, desk.front);
  rect(ctx, left + 2, top + 10, 3, 4, desk.leg);
  rect(ctx, left + w - 5, top + 10, 3, 4, desk.leg);
}

function drawSurface(ctx, seat, t) {
  const { theme } = seat.box;
  const desk = theme.desk;
  const top = seat.y + surfaceY(theme.station);
  const left = seat.x + 4;

  switch (theme.station) {
    case 'console': {
      // 서버실: 금속 콘솔 책상 — 앞면에 통풍구
      rect(ctx, left, top, 44, 2, '#9aa3b2');
      rect(ctx, left, top + 2, 44, 4, desk.top);
      rect(ctx, left, top + 6, 44, 4, desk.front);
      ctx.fillStyle = '#2b313b';
      for (let gx = left + 3; gx < left + 41; gx += 3) ctx.fillRect(gx, top + 7, 1, 2);
      rect(ctx, left + 1, top + 10, 2, 4, desk.leg);
      rect(ctx, left + 41, top + 10, 2, 4, desk.leg);
      break;
    }
    case 'bench': {
      // 연구실: 흰 실험대 + 서랍 두 칸
      rect(ctx, left, top, 44, 2, '#e7ecf4');
      rect(ctx, left, top + 2, 44, 3, '#d3dae6');
      rect(ctx, left, top + 5, 44, 5, desk.front);
      rect(ctx, left + 3, top + 7, 17, 1, '#9aa3b2');
      rect(ctx, left + 24, top + 7, 17, 1, '#9aa3b2');
      rect(ctx, left + 1, top + 10, 3, 4, desk.leg);
      rect(ctx, left + 40, top + 10, 3, 4, desk.leg);
      break;
    }
    case 'drafting': {
      // 디자인실: 기울어진 제도판 + 아래 트레이
      rect(ctx, left, top, 44, 2, desk.edge);
      rect(ctx, left + 1, top + 2, 42, 9, '#e9edf4'); // 도면 용지
      rect(ctx, left, top + 11, 44, 3, desk.front); // 트레이
      rect(ctx, left + 4, top + 14, 3, 4, desk.leg);
      rect(ctx, left + 37, top + 14, 3, 4, desk.leg);
      break;
    }
    case 'reading': {
      // 자료실: 열람석 — 뒤로 칸막이가 올라온 나무 책상
      rect(ctx, left, top - 3, 44, 3, desk.front); // 칸막이
      rect(ctx, left, top, 44, 2, desk.edge);
      rect(ctx, left, top + 2, 44, 4, desk.top);
      rect(ctx, left, top + 6, 44, 4, desk.front);
      rect(ctx, left + 2, top + 10, 3, 4, desk.leg);
      rect(ctx, left + 39, top + 10, 3, 4, desk.leg);
      break;
    }
    case 'lowtable': {
      // 라운지: 낮고 넓은 좌식 테이블
      rect(ctx, left - 2, top, 48, 2, desk.edge);
      rect(ctx, left - 2, top + 2, 48, 3, desk.top);
      rect(ctx, left, top + 5, 3, 3, desk.leg);
      rect(ctx, left + 41, top + 5, 3, 3, desk.leg);
      break;
    }
    default:
      drawDeskTop(ctx, left, top, 44, desk);
  }
}

function drawKeyboard(ctx, left, top, worker, t) {
  rect(ctx, left, top, 13, 3, '#2b3140');
  rect(ctx, left, top, 13, 1, '#404a5d');
  if (worker.mood !== 'typing') return;
  const lit = Math.floor(t / 110) % 5;
  ctx.fillStyle = '#8fb7d8';
  ctx.fillRect(left + 1 + lit * 2, top + 1, 2, 1);
}

function drawMonitor(ctx, left, top, worker, t, w = 13, h = 11) {
  // 헤매는 중에도 화면은 켜져 있다 — 다만 아래 speed가 느려져 코드가 거의 안 흐른다
  const on = worker.mood === 'typing' || worker.mood === 'waiting' || worker.mood === 'stuck';
  rect(ctx, left, top, w, h, COLORS.bezel);
  rect(ctx, left + 1, top + 1, w - 2, h - 3, on ? COLORS.screenOn : COLORS.screenOff);

  if (on) {
    // 흐르는 코드 줄 — 세션마다 고정된 패턴이 위로 스크롤된다
    const seed = hashStr(worker.key);
    const speed = worker.mood === 'typing' ? 0.012 : 0.003;
    const offset = Math.floor(t * speed) % 4;
    for (let i = 0; i < 4; i++) {
      const row = top + 2 + ((i * 2 + offset) % (h - 3));
      if (row > top + h - 4) continue;
      const len = 3 + ((seed >> (i * 3)) % 11);
      ctx.fillStyle = i % 3 === 0 ? '#63c69b' : '#4d9ede';
      ctx.fillRect(left + 2, row, Math.min(len, w - 4), 1);
    }
  }
  rect(ctx, left + w / 2 - 3, top + h - 1, 6, 2, COLORS.bezel);
}

// 책상 위 잡동사니. 자리마다 다르게 보이되 새로 고쳐도 그대로여야 하므로 해시로 고른다.
// 넓은 오른쪽 칸(7~8px)과 좁은 왼쪽 칸(5px)에 각각 하나까지.
//
// **여기에 `papers`를 두지 않는다.** 상판 더미와 바닥에 흘린 것이 둘 다 컨텍스트를 말하게 된
// 뒤로는, 컨텍스트가 낮은데 우연히 서류가 놓인 자리가 그 뜻을 흐린다 —
// 이제 **서류가 보이면 컨텍스트**다.
const DESK_WIDE = ['mug', 'snack', 'phone', 'headset', 'mug'];
const DESK_NARROW = ['sticky', 'can'];

// ── 컨텍스트가 차면 책상에 서류가 쌓인다.
//
// 이름표 밑 얇은 막대 하나로만 보이던 값이라, 사무실을 훑는 것만으로는 어느 자리가 곧
// 압축될지 안 읽혔다. 막대를 **대체하는 게 아니라 거든다** — 정확한 숫자는 패널이 말한다.
//
// 문턱은 막대(60% 노랑 · 85% 빨강)보다 **일찍** 잡는다. 30%까지는 사무실이 깨끗하고 그 위로는
// 급하게 어지러워지는 곡선이라야 "차오르는 중"이 눈에 띈다. 막대보다 늦으면 막대는 노란데
// 서류는 안 쌓인 상태가 생겨 서로를 못 믿게 되지만, 일찍 잡는 쪽은 그 문제가 없다 —
// 막대가 색을 바꿀 때는 서류가 이미 쌓여 있다.
const PAPER_STEPS = [30, 45, 60, 75, 90];
// 한 장마다 위로 2px, 왼쪽으로 1px 어긋나게 쌓는다. 다섯 장이면 +8px — 상판 윗줄에서
// 상판 위 빈 공간까지만 쓴다(굽어서 확인했다).
const PAPER_DX = 1;
const PAPER_DY = 2;

export function paperCount(pct) {
  return pct == null ? 0 : PAPER_STEPS.filter((step) => pct >= step).length;
}

// ── 상판이 다 차면 바닥으로 넘친다.
//
// 책상은 다섯 장이 상한이라 그 위로는 더 보여줄 것이 없다. 컨텍스트가 90%인 자리와 60%인 자리가
// 상판만 보면 비슷해 보이는데, 정작 급한 것은 그 위쪽 구간이다.
//
// **상판 더미와 같은 지점(30%)부터** 바닥도 같이 어지러워지고 4%마다 한 장 늘어난다.
// 문턱을 상판보다 늦게 두면 30~60% 구간에서 상판만 조금 쌓이고 방은 깨끗해 "차오르는 중"이
// 안 읽혔다 — 두 표시가 같이 자라야 방을 훑는 것만으로 급한 자리가 튄다.
//
// 자리 순서(k)로 위치를 정하므로 **이미 흘린 장은 그 자리에 그대로 있고 새 장만 더해진다** —
// 프레임마다 다시 뽑으면 종이가 바닥에서 춤을 춘다.
const FLOOR_FROM = 30;
const FLOOR_PER = 4;
const FLOOR_MAX = 18; // 98%에서 상한에 닿는다

export function floorSheetCount(pct) {
  if (pct == null || pct < FLOOR_FROM) return 0;
  return Math.min(FLOOR_MAX, 1 + Math.floor((pct - FLOOR_FROM) / FLOOR_PER));
}

// 무엇이 널브러졌나. **각도가 다른 낱장 넷**이 대부분이고 쓰레기가 섞인다.
// 픽셀에서 회전은 변형을 따로 그려 내는 것이라(shared/pixels.mjs) 여기서는 고르기만 한다.
//
// 쓰레기는 **세 장째부터** 섞는다. 처음부터 캔이 굴러다니면 "서류가 넘친다"가 아니라
// "지저분한 방"으로 읽힌다 — 이 연출이 말하려는 것은 컨텍스트다.
const LITTER_PAPER = ['sheetFlat', 'sheetTiltR', 'sheetTiltL', 'sheetNarrow'];
const LITTER_TRASH = ['paperBall', 'canDown'];
const TRASH_FROM = 2;
const TRASH_CHANCE = 0.4;

// 장 번호(k)로만 고른다 — 프레임마다 다시 뽑으면 종이가 모양을 바꾸며 깜빡인다.
// 테스트에서 고르기만 떼어 확인한다 (test/roomstate.test.mjs)
export function litterKeyFor(seed, k) {
  const trash = k >= TRASH_FROM && rnd(seed, 520 + k) < TRASH_CHANCE;
  const pool = trash ? LITTER_TRASH : LITTER_PAPER;
  return pool[Math.floor(rnd(seed, 560 + k) * pool.length)];
}

// 널브러진 것은 **자기 구역 안에만** 둔다(bandBounds) — 어느 자리가 넘치고 있는지가 보여야 한다.
// 게보다 먼저 그려 밟고 지나가게 하고, 비품보다도 먼저 그려 비품 뒤로 깔린다.
function drawFloorMess(ctx, box, tint) {
  // 심야·퇴근 조명을 같이 받는다 — 안 그러면 어두운 방에서 종이만 하얗게 뜬다.
  // drawSprite에는 밝기 인자가 없어서 알파로 낮춘다(어두운 바닥에 섞이며 같이 어두워진다).
  const dim = tint?.l ?? 1;
  if (dim !== 1) {
    ctx.save();
    ctx.globalAlpha = dim;
  }
  for (const seat of box.seats ?? []) {
    const n = floorSheetCount(seat.worker.context?.pct);
    if (!n) continue;
    const b = bandBounds(seat);
    const seed = hashStr(seat.worker.key);
    for (let k = 0; k < n; k++) {
      const spr = SPR[litterKeyFor(seed, k)];
      if (!spr) continue;
      // 자리는 고른 것의 크기로 재야 구역 밖으로 삐져나가지 않는다 (7×3 ~ 5×4로 서로 다르다)
      const x = Math.round(b.x0 + rnd(seed, 400 + k * 2) * Math.max(1, b.x1 - b.x0 - spr.w));
      const y = Math.round(b.y0 + rnd(seed, 401 + k * 2) * Math.max(1, b.y1 - b.y0 - spr.h));
      drawSprite(ctx, spr, x, y);
    }
  }
  if (dim !== 1) ctx.restore();
}

// 더미를 쌓는 일만 하는 조각 — 맨 아랫장의 왼쪽(x)과 바닥줄(bottom)은 부르는 쪽이 정한다.
// 회의실은 상판이 자리 것이 아니라 블록 것이라 좌표를 따로 잡아야 해서 갈라 뒀다.
//
// 어긋나는 방향은 **늘 왼쪽**이다. 왼쪽 끝에 놓는 자리에서 오른쪽으로 기울여 봤더니 더미가
// 오른쪽 비품(실험대 플라스크) 쪽으로 자라 하나로 뭉쳐 보였다 — 방향을 자리마다 뒤집는 대신
// 왼쪽 끝에 놓는 자리는 PAPER_INSET만큼 안쪽에서 시작한다.
function stackPapers(ctx, x, bottom, n) {
  const spr = SPR.papers;
  for (let i = 0; i < n; i++) drawSprite(ctx, spr, x - i * PAPER_DX, bottom - spr.h - i * PAPER_DY);
}

// 상판에서 서류 더미가 놓일 x (seat.x 기준).
//
// 기본은 **상판 오른쪽 끝**이다 — 모니터·키보드는 왼쪽~가운데에 있고 비서는 상판 아래
// (DY_DESK.aide)에 서므로 이 자리가 비어 있다. 오른쪽 끝이 이미 찬 자리만 왼쪽 끝을 쓴다:
// 실험대는 시료 랙, 라운지 낮은 테이블은 머그, 제도판은 펜통이 거기 있다.
//
// **왼쪽 끝을 쓸 때 게 몸통(seat.x+21~35)을 밟지 않는지 봐야 한다** — 더미는 상판 윗줄보다
// 위로 자라므로 가운데에 두면 앉은 게를 덮는다. 그래서 실험대 플라스크는 오른쪽으로 비켰다.
const PAPER_LEFT_STATIONS = new Set(['bench', 'lowtable', 'drafting']);
// 상판 왼쪽 끝(+4)에서 안쪽으로 들일 폭 — 다 쌓였을 때 맨 윗장이 딱 상판 끝에 걸린다
const PAPER_INSET = (PAPER_STEPS.length - 1) * PAPER_DX;

function paperX(seat) {
  const left = PAPER_LEFT_STATIONS.has(seat.box.theme.station);
  return seat.x + (left ? 4 + PAPER_INSET : 47 - SPR.papers.w);
}

function drawDeskItems(ctx, seat, surface, stacked) {
  const seed = hashStr(seat.worker.key);
  // 서류가 쌓여 있으면 넓은 칸은 그쪽 몫이다 — 머그와 겹쳐 찍히지 않게 비켜준다
  if (!stacked) {
    const wide = SPR[DESK_WIDE[Math.floor(rnd(seed, 11) * DESK_WIDE.length)]];
    if (wide && rnd(seed, 12) > 0.15) drawSprite(ctx, wide, seat.x + 47 - wide.w, surface + 2 - wide.h);
  }
  const narrow = SPR[DESK_NARROW[Math.floor(rnd(seed, 13) * DESK_NARROW.length)]];
  if (narrow && rnd(seed, 14) > 0.5) drawSprite(ctx, narrow, seat.x + 19, surface + 2 - narrow.h);
}

// 방 종류별 "일하는 도구". 작업 중일 때만 움직인다 — 멈춰 있으면 대기 중임이 한눈에 보인다.
//
// 서류 더미는 **자리 모양과 상관없이** 끝에서 한 번 얹는다. 예전에는 자리마다 부르게 두어
// 콘솔·제도판·평책상 셋에만 붙어 있었고, 연구실·자료실·라운지에서는 컨텍스트가 90%여도
// 상판이 깨끗했다 — 방 종류에 따라 표시가 있다 없다 하면 그 표시를 못 믿는다.
function drawGear(ctx, seat, t) {
  const { worker } = seat;
  const { theme } = seat.box;
  const cx = seat.x + SLOT_W / 2 + 2;
  const surface = seat.y + surfaceY(theme.station);
  // 자리에 앉기 전(걸어오는 1.6초)에는 비품도 멈춰 있어야 한다 — mood만 보면 빈 책상에서
  // 모니터에 코드가 흐르고 플라스크가 끓는다.
  const busy = worker.mood === 'typing' && sitsNow(seat);
  const seed = hashStr(worker.key);
  const papers = paperCount(worker.context?.pct);

  switch (theme.station) {
    case 'console': {
      // 모니터 두 대 + 상태 LED 줄
      drawMonitor(ctx, seat.x + 4, seat.y + 12, worker, t, 8, 9);
      drawMonitor(ctx, seat.x + 13, seat.y + 12, worker, t, 8, 9);
      drawKeyboard(ctx, cx - 3, surface + 1, worker, t);
      for (let i = 0; i < 5; i++) {
        const on = rnd(seed, i * 3 + Math.floor(t / 300)) > (busy ? 0.3 : 0.75);
        rect(ctx, seat.x + 34 + i * 2, surface + 3, 1, 1, on ? '#8fd6b4' : '#2b313b');
      }
      break;
    }
    case 'bench': {
      // 플라스크에서 거품이 오른다. 왼쪽 끝(+4~14)은 서류 더미 몫이라 그만큼 비켜 놓는다 —
      // 오른쪽으로 더 밀면 앉은 게 몸통(+21부터)에 걸린다.
      drawSprite(ctx, SPR.flask, seat.x + 16, surface + 2 - SPR.flask.h);
      if (busy) {
        ctx.fillStyle = '#8fd6b4';
        for (let i = 0; i < 3; i++) {
          const ph = (t / 260 + i * 0.7) % 1;
          rect(ctx, seat.x + 17 + i, surface - 5 - Math.round(ph * 5), 1, 1, '#8fd6b4');
        }
      }
      // 시료 랙
      for (let i = 0; i < 3; i++) rect(ctx, seat.x + 38 + i * 3, surface - 3, 2, 5, i % 2 ? '#e08a3c' : '#6fd3ee');
      rect(ctx, seat.x + 37, surface + 1, 11, 1, '#9aa3b2');
      break;
    }
    case 'drafting': {
      // 용지 위에 선이 자란다 — 다 그리면 처음부터 다시
      const sheet = { x: seat.x + 6, y: surface + 3, w: 38, h: 7 };
      ctx.fillStyle = '#8b93a3';
      for (let i = 0; i < 3; i++) ctx.fillRect(sheet.x, sheet.y + i * 2, sheet.w, 1);
      const grow = busy ? (t / 3400) % 1 : 0.62;
      rect(ctx, sheet.x + 2, sheet.y + 1, Math.round((sheet.w - 6) * grow), 1, `hsl(${seat.box.hue} 60% 55%)`);
      rect(ctx, sheet.x + 2, sheet.y + 4, Math.round((sheet.w - 10) * grow), 1, `hsl(${seat.box.hue} 60% 45%)`);
      drawSprite(ctx, SPR.pencup, seat.x + 42, surface + 2 - SPR.pencup.h);
      break;
    }
    case 'reading': {
      // 펼친 책 — 작업 중이면 오른쪽 장이 넘어간다
      drawSprite(ctx, SPR.book, cx - 4, surface + 2 - SPR.book.h);
      if (busy && Math.floor(t / 700) % 2) rect(ctx, cx + 1, surface - 2, 4, 3, '#cfd6e4');
      drawSprite(ctx, SPR.lamp, seat.x + 6, surface + 2 - SPR.lamp.h);
      break;
    }
    case 'lowtable': {
      // 무릎 위가 아니라 낮은 테이블에 올린 노트북
      drawSprite(ctx, SPR.laptop, cx - 4, surface + 2 - SPR.laptop.h);
      if (busy) rect(ctx, cx - 1, surface - 3, 3, 1, Math.floor(t / 180) % 2 ? '#8fb7d8' : '#4d9ede');
      drawSprite(ctx, SPR.mug, seat.x + 38, surface + 2 - SPR.mug.h);
      break;
    }
    default: {
      drawMonitor(ctx, seat.x + 5, seat.y + 10, worker, t);
      drawKeyboard(ctx, cx - 3, surface + 1, worker, t);
      drawDeskItems(ctx, seat, surface, papers);
    }
  }

  // 비품을 다 놓은 뒤에 얹는다 — 더미가 상판 윗줄 위로 자라므로 먼저 그리면 비품에 깎인다
  if (papers) stackPapers(ctx, paperX(seat), surface + 2, papers);
}

// ── 회의 테이블. 자리마다 상판을 그리면 "책상을 이어붙인 줄"로 보인다 —
// 블록에 하나만 놓고 마주 앉은 두 줄이 같은 판을 쓰게 한다.
function drawMeetingTable(ctx, box, blk) {
  const d = box.theme.desk;
  const { x, w } = blk;
  const top = blk.top + MEET_TOP;
  const face = top + MEET_RIM + MEET_FACE; // 상판 윗면이 끝나고 앞면이 시작하는 줄

  rect(ctx, x, top, w, MEET_RIM, d.edge);
  rect(ctx, x, top + MEET_RIM, w, MEET_FACE, d.top);

  // 24px 상판이 통짜 판때기로 읽히지 않게 나뭇결을 흘린다 (방마다 같은 자리에 오도록 해시)
  const seed = hashStr(`${box.room.key}table`);
  ctx.globalAlpha = 0.3;
  ctx.fillStyle = d.front;
  for (let i = 0; i < 5; i++) {
    const gy = top + MEET_RIM + 3 + i * 4;
    for (let gx = x + 2; gx < x + w - 9; gx += 13) {
      if (rnd(seed, i * 17 + gx) > 0.55) continue;
      ctx.fillRect(gx, gy, 8, 1);
    }
  }
  ctx.globalAlpha = 1;

  rect(ctx, x, face - 1, w, 1, d.edge); // 앞쪽 모서리에 걸리는 빛
  rect(ctx, x, face, w, MEET_APRON, d.front);
  rect(ctx, x, face + MEET_APRON, w, MEET_BASE, d.leg);
}

// 먼 쪽 자리의 이름표는 상판 위 명패로 세운다 — 바닥에 두면 마주 앉은 줄이 밟는다.
// 카드 폭은 글자를 실측해서 맞춘다(고정 폭이면 긴 이름이 카드를 넘쳐 흐른다).
function drawNamePlate(ctx, seat, scale, seated, isSel) {
  const top = seat.y + MEET_TOP + MEET_RIM + 3;
  const cx = seatCx(seat);

  const name = seatName(seat);

  // 자리를 비운 동안엔 명패를 접어 눕혀 둔다 — 세워 둔 채 글자만 없으면 덜 그린 것처럼 보이고,
  // 카드를 아예 지우면 상판이 텅 비어 자리가 몇 개인지 안 읽힌다.
  // 이름을 숨긴 경우도 같다 (빈 카드를 세워두면 명패가 고장 난 것처럼 보인다).
  if (!seated || !name) {
    const left = Math.round(cx - 6);
    rect(ctx, left, top + 6, 12, 3, '#5d6472');
    rect(ctx, left, top + 6, 12, 1, '#7f8794');
    return '';
  }

  ctx.font = labelFont();
  const text = fitText(ctx, name, (SLOT_W - 14) * scale);
  const w = Math.min(SLOT_W - 6, Math.ceil(ctx.measureText(text).width / scale) + 7);
  const left = Math.round(cx - w / 2);
  rect(ctx, left, top, w, 9, '#8f97a6'); // 카드 그늘 — 상판에서 떠 보이게 하는 한 줄
  rect(ctx, left, top, w, 8, isSel ? '#fff1cd' : '#e7ebf3');
  rect(ctx, left + 1, top + 1, w - 2, 1, '#ffffff'); // 접힌 면에 걸리는 빛
  return text;
}

// 가까운 쪽 자리 앞에 놓인 자료와 머그. 상판 앞쪽(게 머리 위)이라 게보다 먼저 그린다.
//
// 컨텍스트 서류 더미도 여기서 얹는다 — 회의실은 상판이 자리 것이 아니라 블록 것이라
// drawGear를 거치지 않는다. **가까운 쪽에만** 쌓는다: 24px 상판을 마주 앉은 두 줄이 나눠 쓰고
// 먼 쪽 절반은 명패(3~11줄)와 게이지(12줄)가 이미 다 쓴다 — 거기에 더미를 얹으면 이름을
// 5글자로 잘라야 한다. 먼 쪽 자리는 바닥에 흘린 것으로 읽는다.
const MEET_PAPER_X = 42; // 머그(+34~41) 오른쪽 끝 — 왼쪽으로 어긋나 쌓여도 머그 위로는 안 온다
// 다섯째 장은 먼 쪽 게이지 줄(MEET_TOP+MEET_RIM+12)까지 올라가 그 막대의 오른쪽 끝을 덮는다.
// 상판 앞줄부터 그 줄 아래까지 들어가는 만큼만 쌓는다 — 회의실만 한 장 적다.
const MEET_PAPER_MAX = 4;

function drawPlaceSetting(ctx, seat, blockTop, t) {
  const bottom = blockTop + MEET_NEAR - 1; // 앞면 바로 위
  drawSprite(ctx, SPR.docs, seat.x + 12, bottom - SPR.docs.h);
  drawSprite(ctx, SPR.mug, seat.x + 34, bottom - SPR.mug.h);
  if (seat.worker.mood === 'typing') {
    // 자료를 짚어가며 말하는 티 — 멈춰 있으면 이 점도 멈춘다
    ctx.fillStyle = '#8fb7d8';
    ctx.fillRect(seat.x + 13 + (Math.floor(t / 300) % 4), bottom - SPR.docs.h - 2, 1, 1);
  }
  const papers = Math.min(MEET_PAPER_MAX, paperCount(seat.worker.context?.pct));
  if (papers) stackPapers(ctx, seat.x + MEET_PAPER_X, bottom, papers);
}

// ── 비서. 서브에이전트가 돌고 있는 동안 자리 옆에 서서 진행 상황을 보고한다.
// 둘까지만 세우고 나머지는 대사에서 "보조 4명"으로 알린다 — 책상을 다 가리면 안 된다.
const AIDE_MAX_DRAW = 2;

// 비서 간격은 스프라이트 폭에서 끌어온다 — 숫자를 박아두면 스프라이트를 고칠 때마다
// 둘이 겹친다(실제로 폭을 10→17로 키웠을 때 5px 겹쳤다).
const AIDE_GAP = () => SPR.aide.w + 1;

// 첫 비서가 설 x (자리 왼쪽 기준). 둘째 비서는 여기서 왼쪽으로 쌓인다.
//
// 하필 SLOT_W와 같은 값인 이유가 있다 — **옆자리를 밟지 않는 가장 오른쪽**이다.
// 스프라이트는 x를 중심으로 그려지고 그 안에서 몸통은 왼쪽 1px부터 12px을 쓰므로,
// 52면 몸통이 +44~+55에 선다. 옆자리 책상은 +56(다음 슬롯 +52의 +4)에서 시작하니 딱 1px 남는다.
// 여기서 더 밀면 옆자리 책상을 밟고, 제 책상(+4~+48)까지 완전히 비키려면 +57이 필요해
// 반드시 옆자리를 침범한다 — 그래서 책상 오른쪽 5px과는 그대로 겹친다(자기 책상 앞이니 맞다).
// 왼쪽으로 되돌리면 책상 가운데 잡동사니(머그 등)와 겹쳐 비서가 책상에 올라앉은 것처럼 보인다.
const AIDE_X = 52;

// 그림자는 **몸통 아래에만** 깐다. 서류가 오른쪽으로 삐져나와 스프라이트 가운데가 몸통
// 가운데가 아니므로 폭(spr.w)만으로는 위치를 구할 수 없다 — 스프라이트 안에서 몸통이
// 차지하는 칸을 여기 적어 둔다. `shared/pixels.mjs`의 CLAWD_AIDE를 고치면 같이 봐야 한다.
const AIDE_BODY_X = 1; // 스프라이트 왼쪽에서 몸통까지
const AIDE_BODY_W = 12; // 몸통(=다리 줄) 폭
function aideShadow(ctx, x, feet, spr) {
  ctx.globalAlpha = 0.3;
  rect(ctx, x - Math.round(spr.w / 2) + AIDE_BODY_X, feet - 1, AIDE_BODY_W, 2, COLORS.shadow);
  ctx.globalAlpha = 1;
}

function drawAides(ctx, seat, t) {
  const n = Math.min(AIDE_MAX_DRAW, seat.worker.aides.length);
  const feet = seat.y + seat.dy.aide; // 책상 앞에 서 있는 높이 — 이름표 줄 위로 올라오지 않게
  for (let i = 0; i < n; i++) {
    const x = seat.x + AIDE_X - i * AIDE_GAP();
    // 고개를 들었다 내리는 두 프레임 — 보고하는 티를 낸다
    const spr = Math.floor(t / 540 + i) % 2 ? SPR.aideUp : SPR.aide;
    aideShadow(ctx, x, feet, spr);
    drawSprite(ctx, spr, x - spr.w / 2, feet - spr.h);
    // 말풍선은 본인 것과 같은 높이(머리 위)로 띄운다 — 여기서 띄우면 게를 덮어버린다
    if (i === 0) seat.aideAnchor = { x, top: seat.y + SEAT_HEAD };
  }
}

// 자리를 비운 게한테도 비서가 따라붙는다
function drawAidesBeside(ctx, seat, pos, t) {
  const n = Math.min(AIDE_MAX_DRAW, seat.worker.aides.length);
  for (let i = 0; i < n; i++) {
    // 본체 몸통을 비켜 세운다 — 양쪽 폭에서 끌어와야 어느 쪽 스프라이트를 키워도 안 겹친다
    const x = Math.round(pos.x) + Math.ceil(SPR.stand.w / 2) + 1 + Math.ceil(SPR.aide.w / 2) + i * AIDE_GAP();
    const spr = Math.floor(t / 540 + i) % 2 ? SPR.aideUp : SPR.aide;
    const top = Math.round(pos.y) - spr.h;
    aideShadow(ctx, x, pos.y, spr);
    drawSprite(ctx, spr, x - spr.w / 2, top);
    if (i === 0) seat.aideAnchor = { x, top };
  }
}

// 라운지는 사무용 의자가 아니라 쿠션에 앉는다
function drawCushion(ctx, cx, top, empty) {
  const w = 18;
  const left = Math.round(cx - w / 2) + (empty ? -3 : 0);
  const y = top + (empty ? 1 : 0);
  rect(ctx, left, y + 4, w, 6, COLORS.chairEdge);
  rect(ctx, left + 1, y + 3, w - 2, 6, '#4e5c72');
  rect(ctx, left + 3, y + 4, w - 6, 2, '#5d6b83');
}

// ── 컨텍스트 게이지. 세션이 컨텍스트 창을 얼마나 먹었는지 자리 밑에 얇게 깐다.
function barColor(pct) {
  if (pct >= 85) return '#e2624a';
  if (pct >= 60) return '#e7b24a';
  return '#4fbf7f';
}

function drawContextBar(ctx, cx, top, pct, w = 24) {
  const left = Math.round(cx - w / 2);
  rect(ctx, left, top, w, 4, COLORS.barEdge);
  rect(ctx, left + 1, top + 1, w - 2, 2, COLORS.barBack);
  const filled = Math.round((w - 2) * Math.min(1, Math.max(0, pct) / 100));
  if (filled > 0) rect(ctx, left + 1, top + 1, filled, 2, barColor(pct));
}

// ── 캐릭터
// 앉아 있는 상태: 일하는 중이거나, 멈췄거나, 실패해서 늘어져 있거나.
function isSeated(mood) {
  return mood === 'typing' || mood === 'stuck' || mood === 'failed' || mood === 'stopped';
}

// ── 자리와 바닥 사이의 전환.
//
// mood만 보고 그리면 일이 끝난 순간 게가 책상에서 사라져 바닥 아무 데나 나타나고, 일이 시작되면
// 반대로 순간이동한다. 그래서 끝나면 **자리 앞에 나와 ✓를 띄우고** 바닥으로 걸어 나가고,
// 시작하면 **자리 앞까지 걸어와** 앉는다.
//
// **여기서만 시간에서 위치를 유도하는 원칙을 깬다.** 워커별로 마지막에 그린 위치를 들고 있다가
// 전환이 시작될 때 그 지점에서 출발한다. statusAt만 보고 계산하던 방식은 "지금 어디에 있는지"를
// 몰라서 세 가지가 튀었다(실측 최대 210px):
//   - 앉아 있던 게가 다시 일하면 바닥으로 순간이동한 뒤 걸어 돌아왔다(의자→바닥→의자)
//   - 전환이 끝나기 전에 상태가 또 바뀌면 새 전환의 반대쪽 끝으로 스냅했다
//   - 스냅샷이 1.5초 늦게 오면 그만큼 진행된 지점에서 시작해 걷기의 절반이 점프로 대체됐다
//
// 그래서 진행도의 기준도 statusAt이 아니라 **렌더러가 그 상태를 처음 본 시각**이다. statusAt은
// 경과 시간 표시(패널·말풍선)에만 쓰고, 여기서는 mood가 바뀐 것만 본다 — mood를 쓰면 잡 상태에서
// 오는 failed/stopped처럼 statusAt이 갱신되지 않는 전이도 놓치지 않는다.
//
// 대가: 창을 다시 그리면 앵커가 비어 그 순간엔 전환 없이 제자리에 나타난다(앱을 켠 직후와 같다 —
// 오히려 모두가 걸어 들어오지 않아 낫다). 같은 순간에 늘 같은 모습이라는 성질은 전환 중에만 깨진다.
const HOLD_MS = 1500; // 자리 앞에 서서 다 했다고 알리는 시간
const OUT_MS = 1600; // 자리 앞 → 바닥
const IN_MS = 1600; // 바닥 → 자리 앞

// 전환 진행도. 0~1로 자른다 — smooth()는 범위 밖 값을 그대로 늘려주므로 1을 넘기면 보간이
// 외삽으로 바뀌어 게가 방을 벗어난다. 기준 시각이 렌더러 것이라 음수가 될 일은 없지만,
// 잘라 두면 시계가 어떻게 어긋나도 좌표가 방 안에 남는다.
function progress(ms, span) {
  return smooth(clamp(ms / span, 0, 1));
}

// worker.key → { mood, mode, seenAt, from, last }
const anchors = new Map();

function anchorOf(seat, now) {
  const key = seat.worker.key;
  let a = anchors.get(key);
  if (!a) {
    // 처음 본 워커는 전환하지 않는다 — 앱을 켠 순간 모두가 걸어 들어오면 안 된다.
    const here = deskFront(seat);
    a = { mood: seat.worker.mood, mode: null, seenAt: -Infinity, from: here, last: here };
    anchors.set(key, a);
  } else if (a.mood !== seat.worker.mood) {
    a.mood = seat.worker.mood;
    a.seenAt = now;
    a.from = a.last; // 지금 실제로 서 있는 자리에서 출발한다
  }
  return a;
}

// 사라진 워커의 앵커는 버린다 — 안 지우면 세션이 드나들 때마다 쌓인다.
function pruneAnchors(seats) {
  if (anchors.size <= seats.length) return;
  const live = new Set(seats.map((s) => s.worker.key));
  for (const key of anchors.keys()) if (!live.has(key)) anchors.delete(key);
}

function phaseOf(worker, age, prevMode) {
  if (isSeated(worker.mood)) {
    // 실패·정지도 걸어와서 앉는다. 전환을 안 주면 바닥을 돌던 게가 의자로 순간이동하는데
    // (실측 최대 212px) 이 블록이 없애려던 바로 그 증상이다. ✱ 표시는 일을 시작한 것만 붙인다.
    //
    // 단, **이미 앉아 있었으면 걸어올 필요가 없다.** 앉은 상태끼리의 전이(작업 중 → 실패·정지,
    // 실패 → 재시도)에도 in을 주면 게가 의자에서 자리 앞 바닥으로 내려와(1줄 방 38px,
    // 2줄 방은 아랫줄 책상을 넘어 84px) 1.6초 서 있다가 다시 올라간다.
    if (prevMode !== 'sit' && age < IN_MS) {
      return { mode: 'in', k: progress(age, IN_MS), note: worker.mood === 'typing' ? 'start' : null };
    }
    return { mode: 'sit', k: 1, note: null };
  }

  // 일을 끝낸 경우만 ✓를 들고 잠깐 서 있는다. waiting은 곧바로 자리 앞으로 나온다(❗가 붙는다).
  const finished = worker.mood === 'idle' || worker.mood === 'done';
  const hold = finished ? HOLD_MS : 0;
  const note = finished ? 'done' : null;
  // hold도 진행도를 준다 — 바닥을 돌던 게가 done이 되는 경우엔 자리 앞까지 걸어와야 한다.
  // 앉아 있다 끝난 경우는 출발점이 이미 자리 앞이라 그대로 서 있는다.
  if (age < hold) return { mode: 'hold', k: progress(age, hold), note };
  if (age < hold + OUT_MS) return { mode: 'out', k: progress(age - hold, OUT_MS), note };
  return { mode: 'walk', k: 1, note: null };
}

// 지금 **실제로** 앉아 있는가. mood가 아니라 전환 단계를 본다 — 걸어오는·걸어 나가는
// 동안은 앉아 있지 않다. phase가 아직 없으면(첫 프레임 등) 예전 판정으로 돈다.
function sitsNow(seat) {
  return seat.phase ? seat.phase.mode === 'sit' : isSeated(seat.worker.mood);
}

// 자리 앞 바닥. 일어나면 여기 서고, 앉으러 올 때도 여기까지 걸어온다.
//
// seatCx만 쓰면 **한 점에 여러 마리가 겹친다** — 책상이 두 줄인 방(6인 이상)에서 같은 열의
// 위·아래 자리가, 회의실에서는 마주 앉은 짝이 seatCx가 같기 때문이다. 겹치면 한 마리만 보이고
// 나머지는 뒤에 숨고, 이름표가 덧찍혀 아무것도 읽히지 않는다(실측: 회의실 4명 → 2마리로 보였다).
//
// 키 해시로 ±8px 흩어 봤지만 몸통이 16px이라 여전히 겹쳤다 — **무작위가 아니라 결정적으로
// 갈라야** 한다. seatCx가 같아지는 원인이 곧 "몇 번째 줄인가"(회의실은 먼 쪽/가까운 쪽)이므로
// 그걸 레인 번호로 만들어 좌우로 벌린다. 두 번 배웠다:
//   - 레인 번호는 **연속**이어야 한다. `row*2`로 매기면 일반 방은 0·2·4만 나와 홀짝 방향이
//     전부 왼쪽으로 쏠렸고, 11인 이상에서 두 자리가 같은 점에 겹쳤다
//   - 오프셋은 고정 폭(±24) 안에 펴는 것으로도 모자란다. **다른 열·다른 줄** 조합이 비슷한 x에
//     떨어져(열 간격 52 - 오프셋 폭 48 = 4px) 12인 방에서 이름표가 s10s1로 덧찍혔다
//
// 그래서 **슬롯 폭을 줄 수(R)로 나눈 균일 격자**를 쓴다: 줄 r → seatCx + (r-(R-1)/2)·(52/R).
// 같은 열 안의 간격도, 옆 열과의 간격도 전부 52/R로 같아진다(2줄 26px · 3줄 17px · 4줄 13px).
// 4줄(회의실 2블록, 11인 이상)에서만 몸통 16px보다 3px 좁은데, 전원이 동시에 끝나는
// 순간에만 스치는 것이라 받아들인다.
function laneCount(box) {
  return Math.max(1, box.blocks ? box.rows * 2 : box.rows);
}

function frontSlot(seat) {
  const cols = Math.max(1, seat.box.cols);
  const i = seat.box.seats.indexOf(seat);
  if (!seat.side) return { lane: Math.floor(i / cols), col: i % cols };
  // 회의실은 한 블록이 먼 쪽 cols + 가까운 쪽 cols를 쓰고, 마주 앉은 두 줄이 각각 레인이다
  return {
    lane: Math.floor(i / (cols * 2)) * 2 + (seat.side === 'near' ? 1 : 0),
    col: (i % (cols * 2)) % cols,
  };
}

function deskFront(seat) {
  const b = floorBounds(seat);
  const n = laneCount(seat.box);
  const lane = Math.min(frontSlot(seat).lane, n - 1);
  const off = Math.round((lane - (n - 1) / 2) * (SLOT_W / n));
  return { x: clamp(seatCx(seat) + off, b.x0, b.x1), y: b.y0 };
}

// 이름표를 두 줄로 가르는 홀짝. **실제 x 순위**의 홀짝이어야 한다 — (열·레인) 전역 번호의
// 홀짝으로 해봤더니 11인 회의실처럼 레인이 비는 구성에서 x 이웃이 같은 줄에 떨어졌다.
// 방 하나에 최대 12자리라 순위 계산은 싸다.
function frontStagger(seat) {
  const mine = deskFront(seat).x;
  const seats = seat.box.seats;
  let rank = 0;
  for (let i = 0; i < seats.length; i++) {
    if (seats[i] === seat) continue;
    const x = deskFront(seats[i]).x;
    if (x < mine || (x === mine && i < seats.indexOf(seat))) rank++;
  }
  return rank % 2 ? 10 : 0;
}

// 지금 서 있을 자리. 전환 중이면 **앵커에 적힌 출발점**에서 목표까지 보간한다.
// 나가는 목표는 원래 산책 경로(walkPos)라 전환이 끝나는 순간 경로에 정확히 얹힌다.
// 결과 위치는 앵커에 적어 둔다 — 다음 전환이 여기서 출발한다.
function posFor(seat, t) {
  const p = walkPos(seat, t);
  const ph = seat.phase;
  const a = seat.anchor;
  if (!ph || ph.mode === 'walk' || !a) {
    if (a) a.last = { x: p.x, y: p.y };
    return p;
  }

  const to = ph.mode === 'out' ? p : deskFront(seat);
  // 전환 도중에 창 크기가 바뀌면 출발점(a.from)이 옛 레이아웃 좌표다 — 바닥 안으로 잡아둔다.
  const b = floorBounds(seat);
  const from = { x: clamp(a.from.x, b.x0, b.x1), y: clamp(a.from.y, b.y0, b.y1) };
  const dist = Math.abs(to.x - from.x) + Math.abs(to.y - from.y);
  const pos = {
    x: from.x + (to.x - from.x) * ph.k,
    y: from.y + (to.y - from.y) * ph.k,
    moving: dist > 4 && ph.k < 1,
    atHang: false,
    seg: p.seg,
    f: p.f,
  };
  a.last = { x: pos.x, y: pos.y };
  return pos;
}

const SEG_MS = 5200; // 한 구간 = 걷기 → 멈춰서 두리번
const HANG_EVERY = 3; // 세 구간마다 한 번은 다 같이 가운데로 모인다
const HANG_EVERY_LUNCH = 2; // 점심(12~14시)엔 더 자주 모인다

// 모이는 주기는 talk.mjs가 정한다 — 점심엔 더 자주 모인다. "지금이 점심인가"로 판단하면
// 12시 경계에서 이미 걷고 있던 구간의 출발점(spot(i))이 바뀌어 게가 방 폭만큼 튀기 때문에,
// 구간 번호에서 시각을 유도해 한 번 정해진 구간은 다시 바뀌지 않게 해 두었다.
const hangEvery = (i, t) => hangEveryAt(i, t, SEG_MS, HANG_EVERY, HANG_EVERY_LUNCH);

const isHang = (i, t) => i % hangEvery(i, t) === hangEvery(i, t) - 1;

// 잡담 창 — 구간 후반(둘 다 멈춰 있는 동안)에 한 번씩 주고받는다
const CHAT_A = [0.6, 0.79];
const CHAT_B = [0.79, 0.98];
const CHAT_NEAR_X = 26;
const CHAT_NEAR_Y = 12;

function smooth(k) {
  return k * k * (3 - 2 * k);
}

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

// 방 바닥 전체(게 중심 기준)
function floorBounds(seat) {
  const f = seat.floor;
  const lo = f.x + 10;
  const hi = Math.max(lo, f.x + f.w - 10);
  return { x0: lo, x1: hi, y0: f.y + 12, y1: Math.max(f.y + 12, f.y + f.h - 2) };
}

// 제 구역 ±25% — 서로 스치기는 해도 한 덩어리로 겹쳐 서지는 않는다
function bandBounds(seat) {
  const full = floorBounds(seat);
  const band = (full.x1 - full.x0) / Math.max(1, seat.count);
  return {
    x0: Math.max(full.x0, full.x0 + band * (seat.idx - 0.25)),
    x1: Math.min(full.x1, full.x0 + band * (seat.idx + 1.25)),
    y0: full.y0,
    y1: full.y1,
  };
}

// 입력 대기 중이면 제 책상 앞을 서성인다
function deskBounds(seat) {
  const full = floorBounds(seat);
  const cx = seat.x + SLOT_W / 2 + 2;
  return {
    x0: clamp(cx - 15, full.x0, full.x1),
    x1: clamp(cx + 15, full.x0, full.x1),
    y0: full.y0,
    y1: Math.min(full.y1, full.y0 + 8),
  };
}

// 구간 i가 끝났을 때 서 있을 자리. 시간만으로 정해지므로 상태를 들고 있지 않다.
// ── 비품 앞에 들르기.
//
// 방 비품은 바닥 좌우 끝에 서 있는데(placeProps) 게들은 그 앞을 **그냥 지나쳤다** —
// 커피머신 램프 말고는 상호작용이 하나도 없었다.
//
// 모임(`box.hang`)과 **같은 패턴**이다: 목표 지점만 갈아 끼우고 걷는 방식은 건드리지 않는다.
// 부드러움은 `walkPos`의 보간이 만들고 목표가 어디인지와 무관하므로 프레임 간 이동량도 그대로다.
// 목표는 `(seat, i)`만으로 정해지고 늘 자기 구역 안으로 clamp된다 — 두 조건이 점프를 막는다.
//
// **자기 구역(bandBounds) 안의 비품만** 들른다. 밖으로 나가면 남의 구역을 밟는다.
const VISIT_EVERY = 4; // 네 구간에 한 번
// 들를 만한 것 — 사람이 다가갈 이유가 있는 비품만. 서버 랙·소화기 앞에 설 일은 없다.
const VISIT_KEYS = ['vending', 'cooler', 'coffee', 'arcade', 'sofa'];
// 마시는 것 앞에 섰으면 컵을 들고 있다
const DRINK_KEYS = ['vending', 'cooler', 'coffee'];
const VISIT_GAP = 10; // 비품 옆에 서는 거리 (겹쳐 서지 않게)

const isVisitSeg = (i) => i % VISIT_EVERY === 0;

function visitable(seat) {
  const b = bandBounds(seat);
  return (seat.box.props ?? []).filter((p) => {
    if (!VISIT_KEYS.includes(p.key)) return false;
    const cx = p.x + p.spr.w / 2;
    return cx >= b.x0 && cx <= b.x1;
  });
}

// 이 구간에 들를 비품. 없으면 null.
function visitOf(seat, i) {
  if (!isVisitSeg(i) || seat.worker.mood === 'waiting') return null;
  const list = visitable(seat);
  if (!list.length) return null;
  return list[Math.floor(rnd(hashStr(seat.worker.key), i * 3 + 7) * list.length)];
}

function spot(seat, i, t) {
  const seed = hashStr(seat.worker.key);
  if (seat.worker.mood === 'waiting') {
    const b = deskBounds(seat);
    return { x: b.x0 + rnd(seed, i * 2) * (b.x1 - b.x0), y: b.y0 + rnd(seed, i * 2 + 1) * (b.y1 - b.y0) };
  }

  const prop = visitOf(seat, i);
  if (prop) {
    const b = bandBounds(seat);
    const cx = prop.x + prop.spr.w / 2;
    // 비품을 밟지 않게 옆에 선다. 구역 안에 남는 쪽을 고른다 — 벽 끝 비품은 안쪽에 선다.
    const right = clamp(cx + VISIT_GAP, b.x0, b.x1);
    const left = clamp(cx - VISIT_GAP, b.x0, b.x1);
    const x = Math.abs(right - cx) >= VISIT_GAP ? right : left;
    // 비품은 바닥 아래끝에 서 있으므로 그 줄에 맞춰 선다
    return { x, y: b.y1 };
  }
  if (isHang(i, t)) {
    const full = floorBounds(seat);
    const n = Math.max(1, seat.count);
    const h = seat.box.hang;
    return {
      x: clamp(h.x + (seat.idx - (n - 1) / 2) * 19, full.x0, full.x1),
      y: clamp(h.y - (seat.idx % 2) * 5, full.y0, full.y1),
    };
  }
  const b = bandBounds(seat);
  return { x: b.x0 + rnd(seed, i * 2) * (b.x1 - b.x0), y: b.y0 + rnd(seed, i * 2 + 1) * (b.y1 - b.y0) };
}

// 구간 경계는 모두가 공유한다 — 그래야 같은 순간에 다 같이 멈춰 서서 떠들 수 있다.
// 도착 시각(walkPart)만 게마다 흩어 놓아 줄줄이 행진하는 것처럼 보이지 않게 한다.
// 테스트에서 프레임 간 이동량을 재려고 내보낸다 — 이 앱이 앵커를 도입해 가며 없앤 점프가
// 다시 들어오는지 지키는 자리다(test/walk.test.mjs).
export function walkPos(seat, t) {
  const seed = hashStr(seat.worker.key);
  const i = Math.floor(t / SEG_MS);
  const f = (t % SEG_MS) / SEG_MS;
  const part = 0.44 + rnd(seed, 91) * 0.14;
  const a = spot(seat, i, t);
  const c = spot(seat, i + 1, t);
  const k = f >= part ? 1 : smooth(f / part);
  const dist = Math.abs(c.x - a.x) + Math.abs(c.y - a.y);
  return {
    x: a.x + (c.x - a.x) * k,
    y: a.y + (c.y - a.y) * k,
    moving: f < part && dist > 4,
    atHang: isHang(i + 1, t) && f >= part,
    // 도착해서 멈춰 있는 동안에만 "비품 앞"이다 — 걸어가는 중에 컵이 생기면 안 된다
    atProp: f >= part ? (visitOf(seat, i + 1)?.key ?? null) : null,
    seg: i,
    f,
  };
}

// 앉아서 일하는 동작도 방마다 다르다. 회의실은 손짓, 연구실은 두 팔을 든 채 젓는 모습.
// 앉으면 상판이 하반신을 덮어 다리가 안 보이므로, 두드리는 동작은 **팔을 한 줄 올렸다
// 내리는**(stand↔armsUp) 것으로 만든다 — 팔은 눈 높이라 상판 위에 늘 남는다.
function clawdSeated(worker, t, station) {
  // 헤매는 중 — 자리에는 있지만 손이 안 나간다. 아주 느리게 팔을 들었다 내리는 것이
  // 머리를 긁적이는 모습으로 읽힌다(두드리는 150ms와 확연히 다른 주기여야 한다).
  if (worker.mood === 'stuck') return Math.floor(t / 700) % 2 ? SPR.armsHigh : SPR.stand;
  if (worker.mood !== 'typing') return SPR.asleep;
  const flip = Math.floor(t / 150) % 2;
  switch (station) {
    case 'table':
      return Math.floor(t / 380) % 2 ? SPR.chat : SPR.armsUp;
    case 'bench':
      return flip ? SPR.armsUp : SPR.armsHigh;
    case 'reading':
      return Math.floor(t / 620) % 3 ? SPR.stand : SPR.armsUp;
    default:
      return flip ? SPR.armsUp : SPR.stand;
  }
}

function clawdStanding(worker, t, pos, chat) {
  if (worker.mood === 'waiting') return SPR.armsHigh;
  // 걷기는 대각선 짝으로 — 두 프레임의 접지선이 같아야 하므로 몸통은 띄우지 않는다
  if (pos.moving) return Math.floor(t / 160) % 2 ? SPR.stepA : SPR.stepB;
  if (chat) return Math.floor(t / 220) % 2 ? SPR.chat : SPR.stand;
  // 자판기·정수기·커피머신 앞에 섰으면 컵을 들고 있다 — 들렀다는 표시가 이것뿐이다
  if (DRINK_KEYS.includes(pos.atProp)) return SPR.sip;
  // 모여 있을 때는 절반쯤이 머그를 들고 있다 — 정수기 앞 풍경
  if (pos.atHang && hashStr(worker.key) % 2) return SPR.sip;
  return worker.mood === 'done' ? SPR.armsUp : SPR.stand;
}

function drawGlyphBubble(ctx, cx, bottom, glyph) {
  const w = 13;
  const h = 11;
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

// 한 줄을 주어진 폭에 맞춰 자른다. 폭은 device px 기준 — 글자를 확대 변환 밖에서 그리므로
// 논리 좌표와 섞지 않게 부르는 쪽에서 scale을 곱해 넘긴다.
// 명패는 매 프레임 다시 재므로 결과를 들고 있는다(자를 때 한 글자씩 measureText를 부른다).
const fitCache = new Map();

function fitText(ctx, text, maxW) {
  const key = `${maxW}|${text}`;
  const hit = fitCache.get(key);
  if (hit !== undefined) return hit;
  let out = text;
  if (ctx.measureText(text).width > maxW) {
    let cut = text;
    while (cut && ctx.measureText(`${cut}…`).width > maxW) cut = cut.slice(0, -1);
    out = `${cut}…`;
  }
  if (fitCache.size > 400) fitCache.clear();
  fitCache.set(key, out);
  return out;
}

// 끊을 자리는 공백을 먼저 본다 — 영어는 단어 중간에서 끊으면 읽히지 않는다
// ("this func / tion"). 공백이 없는 덩어리(경로·id·한 어절이 한 줄보다 긴 경우)는
// 어쩔 수 없이 글자에서 끊는다. 마지막 줄을 '…'로 잘라내는 규칙은 그대로다.
function wrapText(ctx, text, maxW, maxLines) {
  const out = [];
  let cur = '';
  for (const ch of text) {
    // 줄 첫머리의 공백은 버린다 — 끊긴 자리의 공백이 다음 줄을 밀어낸다
    if (!cur && /\s/.test(ch)) continue;
    if (cur && ctx.measureText(cur + ch).width > maxW) {
      if (out.length + 1 >= maxLines) {
        while (cur && ctx.measureText(cur + '…').width > maxW) cur = cur.slice(0, -1);
        out.push(cur + '…');
        return out;
      }
      const at = cur.lastIndexOf(' ');
      // 줄 맨 앞을 잘라내면 빈 줄이 생기므로 공백이 첫 글자인 경우는 글자에서 끊는다
      const carry = at > 0 ? cur.slice(at + 1) : '';
      out.push(at > 0 ? cur.slice(0, at) : cur);
      cur = carry;
    }
    cur += ch;
  }
  if (cur) out.push(cur);
  return out;
}

// 줄바꿈은 글자마다 measureText를 부른다 — 같은 말을 5초 동안 60fps로 다시 재지 않게 캐시한다.
const wrapCache = new Map();

function measureSpeech(ctx, text, size, scale) {
  const key = `${scale}|${text}`;
  const hit = wrapCache.get(key);
  if (hit) return hit;
  ctx.font = labelFont();
  const lines = wrapText(ctx, text, MAX_BUBBLE_W * scale, 2);
  const out = { lines, textW: Math.max(...lines.map((l) => ctx.measureText(l).width)) };
  if (wrapCache.size > 400) wrapCache.clear();
  wrapCache.set(key, out);
  return out;
}

// 혼잣말 말풍선. 글자는 확대 밖에서 그려야 읽히므로 상자만 여기서 그리고 텍스트는 labels로 넘긴다.
// 말풍선이 놓일 자리를 먼저 계산한다 — 그려 보기 전에 겹침을 판정해야 하므로 분리했다.
function measureBubble(ctx, cx, bottom, speech, opts, box, viewW) {
  const { scale } = opts;
  const size = 8;
  const { lines, textW } = measureSpeech(ctx, speech.text, size, scale);
  const lineH = Math.max(4, Math.ceil((OFFICE_FONT_PX * 1.35) / scale));
  const w = Math.ceil(textW / scale) + 8;
  const h = lines.length * lineH + 6;

  // 말풍선은 제 방 안에 머무는 편이 읽기 쉽다 — 방보다 넓으면 그때만 캔버스 기준으로 민다
  const lo = w + 2 <= box.w ? box.x + 1 : 1;
  const hi = Math.max(lo, w + 2 <= box.w ? box.x + box.w - w - 1 : viewW - w - 1);
  const left = Math.round(Math.min(Math.max(cx - w / 2, lo), hi));
  const top = Math.round(bottom - h - 2);
  const tail = Math.round(Math.min(Math.max(cx, left + 3), left + w - 4));
  return { left, top, w, h, tail, lines, lineH, size };
}

// 말풍선 두 종류. 세션에서 읽어온 말(detail·최근 지시·서브에이전트 보고)은 흰 말풍선에
// 파란 띠를 얹어 눈에 걸리게 하고, 우리가 써 둔 상투구·잡담은 어두운 말풍선으로 물러나게 한다.
// 말풍선만 보고 "저건 실제 상황인가 그냥 분위기인가"를 가릴 수 있어야 한다.
const BUBBLE_STYLE = {
  real: { fill: '#f2f4f9', line: '#222732', text: '#1d2026', tag: COLORS.bubbleTag },
  idle: { fill: '#333b4a', line: '#596375', text: '#e2e8f2', tag: null },
};

function bubblesOverlap(a, b) {
  return a.left < b.left + b.w + 1 && b.left < a.left + a.w + 1 && a.top < b.top + b.h + 1 && b.top < a.top + a.h + 1;
}

function paintBubble(ctx, g, speech, labels) {
  const { left, top, w, h, tail, lines, lineH, size } = g;
  const st = BUBBLE_STYLE[speech.kind] ?? BUBBLE_STYLE.real;
  ctx.globalAlpha = speech.alpha;
  rect(ctx, left + 1, top, w - 2, h, st.line); // 모서리를 깎은 외곽선
  rect(ctx, left, top + 1, w, h - 2, st.line);
  rect(ctx, left + 2, top + 1, w - 4, h - 2, st.fill);
  rect(ctx, left + 1, top + 2, w - 2, h - 4, st.fill);
  // 세션에서 읽어온 말은 왼쪽에 파란 띠를 세워 표시한다 — 색만으로는 알아채기 어렵다
  if (st.tag) rect(ctx, left + 2, top + 3, 1, h - 6, st.tag);
  rect(ctx, tail - 1, top + h, 3, 2, st.line); // 꼬리
  rect(ctx, tail - 1, top + h - 1, 2, 1, st.fill);
  ctx.globalAlpha = 1;

  lines.forEach((line, i) => {
    labels.push({
      x: left + w / 2 + (st.tag ? 1 : 0), // 띠만큼 글자를 살짝 밀어 가운데를 맞춘다
      y: top + 3 + i * lineH + (lineH - 1),
      text: line,
      color: st.text,
      size,
      align: 'center',
      alpha: speech.alpha,
    });
  });
}

// 자리(3/4 뷰). 모니터는 게 왼쪽 옆에 둔다 — 정면에 두면 캐릭터가 통째로 가린다.
//   y+6  의자 등받이
//   y+8  게 (자리에 있을 때만)
//   y+10 모니터 (책상 위 왼쪽)
//   y+20 책상 상판 → 게 하반신을 가려 앉은 것처럼 보인다
//   y+32 비서 (서브에이전트가 있을 때)
//   y+37 이름표
//   y+40 컨텍스트 게이지
//
// 이름표·게이지는 drawSeatTag가 따로 그린다. 회의실은 그 둘이 상판 위 명패라
// 테이블을 그린 뒤에 얹어야 해서, 몸통과 순서를 떼어놓을 수 있어야 한다.
function drawSeatBody(ctx, seat, t, hover, selected) {
  const { worker } = seat;
  const cx = seatCx(seat);
  const seated = sitsNow(seat);
  const dim = worker.mood === 'stopped';
  const isSel = selected === worker.key;
  const near = seat.side === 'near';
  seat.aideAnchor = null; // 매 프레임 다시 정한다 — 말풍선 위치가 여기에 달려 있다

  // 자리를 비운 게가 선택돼 있으면 빈 책상을 통째로 칠하는 대신 테두리만 두른다
  const mark = isSel ? COLORS.sel : hover === worker.key ? '#ffffff' : null;
  if (mark) {
    ctx.globalAlpha = isSel ? 0.6 : 0.28;
    ctx.strokeStyle = mark;
    ctx.lineWidth = 1;
    ctx.strokeRect(seat.x + 2.5, seat.y + seat.dy.mark + 0.5, seat.w - 5, seat.dy.markH);
    ctx.globalAlpha = 1;
  }

  const station = seat.box.theme.station;
  const sit = station === 'lowtable' ? drawCushion : drawChair;

  if (dim) ctx.globalAlpha = 0.45;
  // 가까운 쪽은 등받이가 뷰어 쪽이라 게보다 나중에 그린다 (아래쪽 drawChairBack)
  if (!near) sit(ctx, cx, seat.y + 15, !seated); // 어깨 높이 — 더 올리면 등받이가 눈 뒤 액자처럼 보인다

  if (seated) {
    const slump = worker.mood === 'typing' ? 0 : 1;
    const bob = worker.mood === 'typing' && Math.floor(t / 150) % 2 ? 1 : 0;
    const top = seat.y + SEAT_HEAD + bob + slump;
    drawSprite(ctx, clawdSeated(worker, t, station), cx - SPR.stand.w / 2, top);
    if (near) drawChairBack(ctx, cx, top);
  }

  // 회의실은 상판도 비품도 자리 것이 아니다 — 블록에 하나씩 따로 그린다
  if (!seat.side) {
    drawSurface(ctx, seat, t);
    drawGear(ctx, seat, t);
  }
  if (dim) ctx.globalAlpha = 1;

  // 서브에이전트가 붙어 있으면 비서가 자리 옆에 서서 보고한다.
  //
  // **앉아 있을 때만이다.** 자리를 비운 게는 drawWanderer가 그리고 그쪽도 비서를 데려가므로
  // (drawAidesBeside), 여기서 앉음 여부를 안 보면 한 세션의 비서가 두 곳에 동시에 선다 —
  // 대기로 앞에 나설 때·걸어 나갈 때·자리로 돌아올 때 다 그랬다.
  // 보고 말풍선이 붙는 자리(seat.aideAnchor)도 두 함수가 서로 덮어써서 그리는 순서에
  // 달려 있었는데, 한쪽만 그리게 되면서 그것도 하나로 정해진다.
  if (seated && worker.aides?.length) drawAides(ctx, seat, t);

  if (seated) seat.actor = { x: cx, y: seat.y + 20, seated: true };
}

// 명패는 흰 카드 위에 얹히므로 바닥 이름표와 같은 밝은 색을 쓰면 읽히지 않는다.
function tagColor(worker, plate, isSel) {
  if (plate) return isSel ? '#6b4a00' : '#2b313b';
  if (isSel) return COLORS.sel;
  // 헤매는 자리도 밝게 둔다 — 흐려 놓으면 퇴근한 자리처럼 보여 눈에 안 걸린다
  return worker.mood === 'typing' || worker.mood === 'stuck' ? COLORS.label : COLORS.labelDim;
}

// 이름표와 컨텍스트 게이지. 회의실 먼 쪽 자리에서는 바닥이 아니라 상판 위 명패에 얹힌다.
function drawSeatTag(ctx, seat, scale, labels, selected) {
  const { worker } = seat;
  const seated = sitsNow(seat);
  const isSel = selected === worker.key;
  const plate = seat.side === 'far';

  // 명패는 상판을 그린 뒤라야 얹을 수 있어 여기서 그린다. 카드 폭에 맞춰 자른 이름을
  // 되돌려주므로 라벨도 그걸 쓴다 — 자리를 비운 동안에도 카드는 접힌 채 남는다.
  const text = plate ? drawNamePlate(ctx, seat, scale, seated, isSel) : seated ? seatName(seat) : '';
  if (!seated) return;

  // 이름을 숨겨도 게이지는 남긴다 — 이름표가 아니라 상태 표시다.
  // 자리는 그대로 두므로 게이지 높이는 이름이 있을 때와 같다.
  if (text) {
    labels.push({
      x: seatCx(seat),
      y: seat.y + seat.dy.name,
      text,
      color: tagColor(worker, plate, isSel),
      size: 8,
      align: 'center',
    });
  }
  if (worker.context?.pct != null) drawContextBar(ctx, seatCx(seat), seat.y + seat.dy.bar, worker.context.pct);
}

// 회의실은 한 테이블을 두 줄이 나눠 쓰므로 그리는 순서가 곧 앞뒤 관계다.
// 먼 쪽 게 → 밀어 넣은 빈 의자 → 상판 → 명패 → 자료 → 가까운 쪽 게 → 이름표.
function drawMeetingRoom(ctx, box, scale, t, labels, hover, selected) {
  for (const blk of box.blocks) {
    for (const seat of blk.far) drawSeatBody(ctx, seat, t, hover, selected);
    for (const seat of blk.near) {
      if (!sitsNow(seat)) drawTuckedChair(ctx, seatCx(seat), blk.top);
    }
    drawMeetingTable(ctx, box, blk);
    for (const seat of blk.far) drawSeatTag(ctx, seat, scale, labels, selected);
    for (const seat of blk.near) drawPlaceSetting(ctx, seat, blk.top, t);
    for (const seat of blk.near) {
      drawSeatBody(ctx, seat, t, hover, selected);
      drawSeatTag(ctx, seat, scale, labels, selected);
    }
  }
}

// 자리를 떠나 돌아다니는 캐릭터. y가 클수록 앞쪽이라 나중에 그린다.
//
// 걸을 때 몸통을 1px 띄우던 것을 걷어냈다. 띄우는 박자가 걷기 프레임과 같아서 발을 든
// 1px과 정확히 상쇄됐고, 그 결과 딛는 발이 두 프레임 내내 같은 높이에 붙어 있었다 —
// 걷는 게 아니라 발을 붙인 채 몸만 들썩이는 모습이었다. 걸음은 다리로만 만든다.
function drawWanderer(ctx, seat, pos, t, labels, hover, selected, chat) {
  const { worker } = seat;
  const spr = clawdStanding(worker, t, pos, chat);
  const x = Math.round(pos.x);
  const y = Math.round(pos.y); // 발 위치
  const top = y - spr.h;
  const isSel = selected === worker.key;

  seat.actor = { x, y, seated: false };

  if (isSel || hover === worker.key) {
    ctx.globalAlpha = isSel ? 0.3 : 0.15;
    rect(ctx, x - 9, y - 2, 18, 3, isSel ? COLORS.sel : '#ffffff');
    ctx.globalAlpha = 1;
  }

  ctx.globalAlpha = 0.35;
  rect(ctx, x - 6, y - 1, 12, 2, COLORS.shadow);
  ctx.globalAlpha = 1;

  // 정지 상태는 앉은 몸과 같은 투명도로 걷는다 — 안 그러면 또렷한 몸으로 걸어와
  // 흐린 채 앉는 순간 톤이 툭 바뀐다.
  const dim = worker.mood === 'stopped';
  if (dim) ctx.globalAlpha = 0.45;
  drawSprite(ctx, spr, x - spr.w / 2, top);
  if (dim) ctx.globalAlpha = 1;
  if (worker.aides?.length) drawAidesBeside(ctx, seat, pos, t);

  // 전환(hold·out·in) 중에는 게들이 자리 앞에 13~26px 간격으로 늘어서므로 이름표를 한 줄에
  // 다 적으면 서로 덧찍힌다 — x 순서 홀짝으로 두 줄에 나눠 적는다. 산책 중에는 구역이 넓어 불필요.
  const stag = seat.phase && seat.phase.mode !== 'walk' ? frontStagger(seat) : 0;
  const name = seatName(seat);
  if (name) {
    labels.push({
      x,
      y: y + 8 + stag,
      text: name,
      color: isSel ? COLORS.sel : COLORS.labelDim,
      size: 8,
      align: 'center',
    });
  }
  if (worker.context?.pct != null) drawContextBar(ctx, x, y + 11 + stag, worker.context.pct);
  return top;
}

// 자리에 붙일 이름. layout()이 설정을 반영해 넣어둔 seat.name을 쓴다 — 빈 문자열이면 이름표가 없다.
function seatName(seat) {
  const s = seat.name ?? seat.worker.name;
  return s.length > 15 ? s.slice(0, 14) + '…' : s;
}

function shortLabel(text, n) {
  const s = String(text ?? '');
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

// ── 게끼리 마주쳤을 때. 둘 다 멈춰 서 있고 가까우면 한 쌍으로 묶어 대화를 시킨다.
// 대화 내용도 시간·키 해시로만 정해지므로 상태를 따로 들고 있지 않다.
function chatSpeech(pairKey, seg, role, f) {
  const [lo, hi] = role === 0 ? CHAT_A : CHAT_B;
  if (f < lo || f >= hi) return null;
  const span = (hi - lo) * SEG_MS;
  const line = chatLines(pairKey, seg)[role];
  if (!line) return null;
  // 잡담은 전부 우리가 써 둔 문장이다 — 어두운 말풍선
  return { text: line, alpha: fade((f - lo) * SEG_MS, span, 220), kind: 'idle' };
}

function findChats(walkers) {
  const chats = new Map();
  for (let i = 0; i < walkers.length; i++) {
    const a = walkers[i];
    if (chats.has(a.seat.worker.key) || a.pos.moving) continue;
    for (let j = i + 1; j < walkers.length; j++) {
      const b = walkers[j];
      if (chats.has(b.seat.worker.key) || b.pos.moving) continue;
      if (a.seat.box !== b.seat.box) continue;
      if (Math.abs(a.pos.x - b.pos.x) > CHAT_NEAR_X) continue;
      if (Math.abs(a.pos.y - b.pos.y) > CHAT_NEAR_Y) continue;
      // 역할은 키 순서로 고정 — 프레임마다 질문·대답이 뒤바뀌지 않게
      const first = a.seat.worker.key < b.seat.worker.key ? a : b;
      const second = first === a ? b : a;
      const pairKey = `${first.seat.worker.key}|${second.seat.worker.key}`;
      chats.set(first.seat.worker.key, { pairKey, role: 0 });
      chats.set(second.seat.worker.key, { pairKey, role: 1 });
      break;
    }
  }
  return chats;
}

// ── 미니 창. 방을 그리지 않고 클로드만 모아 세운다.
//
// 큰 창의 `layout`/`render`를 배율만 낮춰 쓰던 것을 걷어냈다. 220px 폭에서는 방·벽·비품이
// 화면을 다 먹고 게가 5%로 줄어드는데, 곁눈질로 알고 싶은 것은 "누가 나를 기다리는가" 하나다.
// 방 단위로 자르던 것(상위 세 방)도 같이 없앴다 — 네 번째 방의 대기가 안 보였다.
//
// **전원 서 있다.** 걷기만 끄고 앉히면 `isSeated`가 waiting을 앉음으로 보지 않아 `clawdSeated`가
// `asleep`을 골라, **나를 기다리는 게가 자는 모습**으로 그려진다(머리 위 gBang과 정면충돌).
// 서 있게 두면 대기가 `armsHigh`(손 든 자세)로 읽히고, 의자·책상·자리 전환·잡담·비품 코드를
// 통째로 안 탄다 — 그래서 여기는 `layout`/`render`에 플래그를 얹지 않고 따로 짠 함수다.
//
// 세로 구성(칸 위를 0으로, 논리 좌표):
//   +0  상태 기호 말풍선(11)   +13 게 머리(12)   +25 발 = actor.y
//   그 아래로 상세도만큼 — 이름 → 경과 시간 → 컨텍스트 막대
const M_PAD = 3;
const M_GLYPH_H = 11; // drawGlyphBubble이 쓰는 높이
const M_GLYPH_GAP = 2; // 기호 밑 → 머리
const M_BODY_H = 12; // 게 키 (SPR.stand.h)
const M_BAR_H = 4; // drawContextBar
const M_BAR_GAP = 2;
const M_ROW_GAP = 4;
const M_FRONT_MIN_W = 34; // 앞줄 한 칸 — 이름이 서너 글자는 들어갈 폭
// 이름·경과를 떼어낸 상세도(0)에서는 게(16)와 게이지(24)만 들어가면 된다. 여기서도 34를 요구하면
// 최소 크기 창에서 열이 모자라 줄이 늘어나고, 그 줄이 세로에 안 들어가 **앞줄이 접혔다**.
const M_FRONT_BARE_W = 26;
// 칸 폭의 위 끝. 창을 넓히면 남는 폭을 칸에 다 나눠 주는데, 그러면 게 셋이 창 양 끝으로
// 흩어져 "모아 놓은" 꼴이 아니게 된다 — 칸은 이만큼까지만 넓히고 줄째로 가운데에 놓는다.
const M_FRONT_MAX_W = 58;
const M_BACK_W = 20; // 뒷줄 한 칸 — 게 16px + 좌우 2px
// 뒷줄이 화면 절반을 먹으면 앞줄이 밀린다. 넘치는 만큼은 `+n`으로 접는다.
const M_BACK_ROWS_MAX = 3;
const M_HEAD_H = M_GLYPH_H + M_GLYPH_GAP + M_BODY_H; // 칸 위 → 발
// 남는 높이를 위아래로 나누는 비율(위쪽 몫). 반씩 나누면 **위가 많이 비어 보인다** —
// 칸마다 기호 말풍선 자리(11px)를 늘 비워 두는데 뒷줄의 일하는 게에는 기호가 없어서,
// 뒷줄 위로 22px(화면 기준)이 늘 빈 띠로 남는다. 그만큼을 아래로 넘긴다.
const M_TOP_BIAS = 1 / 4;

// 앞줄에 서는 상태 — 나를 기다리거나 막혔거나 실패한 것. 이름·경과·게이지를 다 달아 준다.
const MINI_FRONT_MOODS = ['waiting', 'stuck', 'failed'];
// 줄 세우는 순서. 방이 아니라 **상태**가 순위를 정한다 — 큰 창의 roomScore가 failed를
// 0점으로 세서 실패만 있는 방이 뒤로 밀렸던 것이 여기서 없어진다.
//
// stopped가 맨 뒤인 이유: 이 앱에서 멈춘 세션은 흐리게 그리고(drawSeatBody) 방 조명을 내릴 때도
// 살아 있는 것으로 세지 않는다(LIVE_MOODS). 뒷줄에서도 일하는 것보다 앞에 세울 이유가 없다.
const MINI_RANK = { waiting: 0, stuck: 1, failed: 2, typing: 3, idle: 4, stopped: 5 };

// 같은 급끼리는 **오래된 것이 앞**이다. statusAt은 단조 증가하므로 새로 생긴 대기가 줄 끝에
// 붙고 이미 서 있던 게의 자리는 밀리지 않는다 — 눌렀는데 다른 게가 눌리면 곁눈질이 안 된다.
function miniCmp(a, b) {
  const ra = MINI_RANK[a.worker.mood] ?? 9;
  const rb = MINI_RANK[b.worker.mood] ?? 9;
  if (ra !== rb) return ra - rb;
  const sa = a.worker.statusAt ?? Infinity;
  const sb = b.worker.statusAt ?? Infinity;
  if (sa !== sb) return sa - sb;
  return a.worker.key < b.worker.key ? -1 : a.worker.key > b.worker.key ? 1 : 0;
}

// 방을 헐어 게만 두 줄로 나눈다. 퇴근한 것(done)은 세우지 않는다 — 12시간 남는 목록이라
// 뒷줄을 채워 봐야 곁눈질에 도움이 안 된다.
export function miniRoster(rooms) {
  const front = [];
  const back = [];
  for (const room of rooms ?? []) {
    for (const worker of room.workers ?? []) {
      if (worker.mood === 'done') continue;
      (MINI_FRONT_MOODS.includes(worker.mood) ? front : back).push({ worker, room });
    }
  }
  return { front: front.sort(miniCmp), back: back.sort(miniCmp) };
}

// 몇 열·몇 줄·어느 상세도로 세울까. **순수 함수다** — 인원수와 크기만 받으므로 node로 테스트된다.
//
// 상세도 셋(2 이름+경과 · 1 이름 · 0 게이지만)을 **다 계산해 보고 고른다.** 전에는 들어가는
// 가장 높은 상세도를 탐욕스럽게 집었는데, 상세도가 오르면 칸 최소 폭도 올라(M_FRONT_BARE_W →
// M_FRONT_MIN_W) 열이 줄고 앞줄이 한 줄 늘어난다. 그 한 줄이 뒷줄 자리를 다 먹어서
// **창을 키웠는데 보이는 게가 줄어드는** 구간이 생겼다(폭 220에서 높이 200→220에 7마리→3마리).
//
// 고르는 기준은 사전식이다: `앞줄 인원 → 뒷줄 인원 → 상세도`. 이름은 마우스를 올려 볼 수
// 있지만(#128) 안 보이는 게는 올려 볼 수도 없다.
export function miniPlan({ w, h, front = 0, back = 0, scale = 2 }) {
  // 글자는 확대 밖에서 12px 고정으로 그린다 — 줄 간격을 논리 좌표로 잡으려면 배율로 나눠야 한다
  const lineH = Math.max(4, Math.ceil((OFFICE_FONT_PX * 1.2) / scale));
  const nameDy = Math.max(3, Math.ceil((OFFICE_FONT_PX + 3) / scale)); // 발 → 이름 baseline
  const innerW = Math.max(M_BACK_W, Math.floor(w) - M_PAD * 2);
  const availH = Math.max(M_HEAD_H, Math.floor(h) - M_PAD * 2);

  const backCols = Math.max(1, Math.floor(innerW / M_BACK_W));
  const blockH = (rows, unit) => (rows > 0 ? rows * unit + (rows - 1) * M_ROW_GAP : 0);
  const fitRows = (room) => (room < M_HEAD_H ? 0 : Math.floor((room + M_ROW_GAP) / (M_HEAD_H + M_ROW_GAP)));

  // 상세도 하나로 끝까지 짜 본다. 앞줄을 먼저 앉히고 남은 높이를 뒷줄에 준다.
  function planFor(detail) {
    // 칸의 최소 폭은 **상세도가 정한다** — 글자를 떼면 좁아도 되고, 그만큼 열이 늘어 줄이 줄어든다
    const cols = Math.max(
      1,
      Math.min(Math.max(1, front), Math.floor(innerW / (detail >= 1 ? M_FRONT_MIN_W : M_FRONT_BARE_W))),
    );
    const frontRowH = M_HEAD_H + (detail >= 2 ? nameDy + lineH : detail >= 1 ? nameDy : 0) + M_BAR_GAP + M_BAR_H;
    let rows = front > 0 ? Math.ceil(front / cols) : 0;
    let frontShown = front;
    let foldedFront = 0;
    // 상세도를 다 깎아도 세로가 모자라면 앞줄도 자른다 — 창을 최소로 줄인 경우의 마지막 수단이다.
    // 폭 때문에 잘리는 일은 없다: 열이 줄면 줄이 늘어난다.
    if (blockH(rows, frontRowH) > availH) {
      rows = Math.max(1, Math.floor((availH + M_ROW_GAP) / (frontRowH + M_ROW_GAP)));
      frontShown = Math.min(front, rows * cols);
      foldedFront = front - frontShown;
    }
    const frontH = blockH(rows, frontRowH);

    // 뒷줄은 앞줄이 자리를 잡은 뒤 남은 높이만큼만 선다
    const space = availH - frontH - (rows > 0 ? M_ROW_GAP : 0);
    const wantRows = back > 0 ? Math.ceil(back / backCols) : 0;
    // 뒷줄을 먼저 최대한 세우고, **남는 자리가 있을 때만** 접힌 개수를 적는다.
    // 전에는 `+n` 한 줄(lineH ≈ 8)을 먼저 떼어 뒀는데, 그 8px 때문에 뒷줄 한 줄(25px = 게 넷)이
    // 통째로 날아가는 구간이 있었다(220×200에서 뒷줄 넷 대신 `+14` 한 줄만 남았다).
    // 총원은 22px 손잡이에 늘 적혀 있으므로 게를 세우는 쪽이 낫다.
    const backRows = Math.min(wantRows, fitRows(space), M_BACK_ROWS_MAX);
    const backShown = Math.min(back, backRows * backCols);
    const foldedBack = back - backShown;
    const backH = blockH(backRows, M_HEAD_H);
    const foldH = foldedBack > 0 && space - backH - (backRows > 0 ? M_ROW_GAP : 0) >= lineH ? lineH : 0;

    return {
      cols,
      cellW: Math.min(M_FRONT_MAX_W, Math.floor(innerW / cols)),
      rows,
      detail,
      frontShown,
      foldedFront,
      backCols,
      backRows,
      backShown,
      foldedBack,
      lineH,
      nameDy,
      innerW,
      availH,
      frontRowH,
      // 덩이를 세로로 놓는 자리. 가운데보다 위로 붙인다(M_TOP_BIAS) — 위로 다 붙이면 아래가
      // 통째로 빈 바닥이 되어 떠 보이고, 반씩 나누면 기호 자리 때문에 위가 많이 비어 보인다.
      top:
        M_PAD +
        Math.max(
          0,
          Math.floor((availH - (foldH + backH + (backRows || foldH ? M_ROW_GAP : 0) + frontH)) * M_TOP_BIAS),
        ),
      foldH,
      backH,
      frontH,
    };
  }

  // 앞줄이 많이 서는 쪽 → 뒷줄이 많이 서는 쪽 → 상세도가 높은 쪽
  const better = (a, b) =>
    a.frontShown !== b.frontShown
      ? a.frontShown > b.frontShown
      : a.backShown !== b.backShown
        ? a.backShown > b.backShown
        : a.detail > b.detail;

  let best = planFor(0);
  for (const d of [1, 2]) {
    const cand = planFor(d);
    if (better(cand, best)) best = cand;
  }
  return best;
}

// 칸 하나를 만든다. **자리가 고정이라 actor를 여기서 채운다** — 돌아다니지 않으므로 그릴 때
// 갱신할 것이 없고, 첫 프레임 전에도 클릭 판정(pickAt)이 걸린다.
function miniSeat(entry, hue, { x, y, w, h, feet, front, detail, nameOf }) {
  return {
    worker: entry.worker,
    room: entry.room,
    hue,
    name: nameOf ? nameOf(entry.worker) : entry.worker.name,
    front,
    detail,
    x,
    y,
    w,
    h,
    feet,
    actor: { x: Math.round(x + w / 2), y: feet, seated: false },
  };
}

// 미니의 레이아웃. `layout`과 달리 **보이는 창의 크기를 그대로 받는다** — 확대도 이동도 없어서
// 사무실이 창보다 커질 일이 없고, 그래서 pan이 늘 0이다.
// 돌려주는 모양은 `layout`과 맞춰 둔다(seats·width·height) — pickAt을 그대로 쓴다.
export function layoutMini(rooms, maxW, maxH, opts = {}) {
  const { nameOf, scale = 2 } = opts;
  const list = rooms ?? [];
  const hues = assignHues(list);
  const { front, back } = miniRoster(list);
  const plan = miniPlan({ w: maxW, h: maxH, front: front.length, back: back.length, scale });
  const seats = [];

  // 뒷줄이 위, 앞줄이 아래 — 앞에 선 것이 아래라야 원근이 맞고, 이름표가 붙는 줄이 바닥에 선다
  let y = plan.top + plan.foldH;
  for (let r = 0; r < plan.backRows; r++) {
    const from = r * plan.backCols;
    const n = Math.min(plan.backCols, plan.backShown - from);
    if (n <= 0) break;
    const left = M_PAD + Math.floor((plan.innerW - n * M_BACK_W) / 2);
    for (let i = 0; i < n; i++) {
      const e = back[from + i];
      seats.push(
        miniSeat(e, hues.get(e.room.key), {
          x: left + i * M_BACK_W,
          y,
          w: M_BACK_W,
          h: M_HEAD_H,
          feet: y + M_HEAD_H,
          front: false,
          detail: 0,
          nameOf,
        }),
      );
    }
    y += M_HEAD_H + M_ROW_GAP;
  }
  // 마지막 뒷줄 뒤에 붙은 간격이 곧 두 줄 사이 간격이다. 뒷줄이 아예 없고 접힘 표시만 있을
  // 때도 한 칸은 떼어 준다 — `+7`이 앞줄 게의 기호 말풍선에 닿는다.
  if (plan.backRows === 0 && plan.foldH) y += M_ROW_GAP;

  for (let r = 0; r < plan.rows; r++) {
    const from = r * plan.cols;
    const n = Math.min(plan.cols, plan.frontShown - from);
    if (n <= 0) break;
    const left = M_PAD + Math.floor((plan.innerW - n * plan.cellW) / 2);
    for (let i = 0; i < n; i++) {
      const e = front[from + i];
      seats.push(
        miniSeat(e, hues.get(e.room.key), {
          x: left + i * plan.cellW,
          y,
          w: plan.cellW,
          h: plan.frontRowH,
          feet: y + M_HEAD_H,
          front: true,
          detail: plan.detail,
          nameOf,
        }),
      );
    }
    y += plan.frontRowH + M_ROW_GAP;
  }

  return { boxes: [], seats, width: Math.max(1, maxW), height: Math.max(1, maxH), mini: plan };
}

// 미니의 자세. 앉은 모습이 없으므로 상태를 **자세로만** 구분한다 —
// 뒷줄에는 이름표도 없어서 두드리는 손(typing)·자는 모습(stopped)·그냥 서 있는 것(idle)이
// 유일한 구분이다. 머리 위 기호는 그 위에 얹힌다(glyphKeyFor).
function clawdMini(worker, t) {
  switch (worker.mood) {
    case 'waiting':
      return SPR.armsHigh; // 손을 들고 부른다
    case 'stuck':
      // 아주 느리게 팔을 들었다 내린다 = 머리 긁적. 두드리는 150ms와 확연히 달라야 한다
      return Math.floor(t / 700) % 2 ? SPR.armsHigh : SPR.stand;
    case 'stopped':
      return SPR.asleep;
    case 'typing':
      return Math.floor(t / 150) % 2 ? SPR.armsUp : SPR.stand;
    default:
      return SPR.stand; // idle · failed — 실패는 머리 위 gCross가 말한다
  }
}

function drawMiniSeat(ctx, seat, t, labels, opts) {
  const { hover, selected, scale, noteOf, tint, plan } = opts;
  const { worker } = seat;
  const cx = seat.actor.x;
  const feet = seat.feet;
  const spr = clawdMini(worker, t);
  const isSel = selected === worker.key;

  if (isSel || hover === worker.key) {
    ctx.globalAlpha = isSel ? 0.3 : 0.15;
    rect(ctx, cx - 9, feet - 2, 18, 3, isSel ? COLORS.sel : '#ffffff');
    ctx.globalAlpha = 1;
  }

  ctx.globalAlpha = 0.35;
  rect(ctx, cx - 6, feet - 1, 12, 2, COLORS.shadow);
  ctx.globalAlpha = 1;
  // 방을 안 그리는 대신 **방 색을 발판에 남긴다** — 어느 방의 게인지 힌트가 이것뿐이다
  if (seat.hue != null) rect(ctx, cx - 7, feet, 14, 1, hsl(seat.hue, 36, 31, tint));

  const dim = worker.mood === 'stopped';
  if (dim) ctx.globalAlpha = 0.45;
  drawSprite(ctx, spr, cx - spr.w / 2, feet - spr.h);
  if (dim) ctx.globalAlpha = 1;

  // 상태 기호. 큰 창처럼 머리 **옆**에 붙이면 좁은 칸에서 옆 게를 덮으므로 늘 머리 위 가운데다.
  const glyph = SPR[glyphKeyFor(worker, { slot: slotNow(), tms: t })] ?? null;
  if (glyph) {
    const float = worker.mood === 'waiting' ? Math.round(Math.sin(t / 260) * 1.5) : Math.round(Math.sin(t / 900) * 1);
    drawGlyphBubble(ctx, cx, feet - spr.h - M_GLYPH_GAP + float, glyph);
  }

  if (!seat.front) return;

  // **이름을 가려도 줄은 그대로 비운다** — 이름이 있을 때와 게이지 높이가 달라지면
  // 이름을 가린 화면에서 줄이 들쭉날쭉해진다(큰 창의 drawSeatTag와 같은 판단이다).
  let y = feet;
  if (seat.detail >= 1) {
    y += plan.nameDy;
    const name = seatName(seat);
    if (name) {
      labels.push({
        x: cx,
        y,
        text: fitText(ctx, name, (seat.w - 3) * scale),
        color: isSel ? COLORS.sel : COLORS.label,
        size: 8,
        align: 'center',
      });
    }
  }
  if (seat.detail >= 2) {
    y += plan.lineH;
    const note = noteOf ? noteOf(worker) : '';
    if (note) {
      labels.push({
        x: cx,
        y,
        // 대기만 색을 준다 — 나머지는 기호가 이미 말하고 있다
        color: worker.mood === 'waiting' ? '#d8a33a' : COLORS.labelDim,
        text: fitText(ctx, note, (seat.w - 3) * scale),
        size: 8,
        align: 'center',
      });
    }
  }
  if (worker.context?.pct != null) drawContextBar(ctx, cx, y + M_BAR_GAP, worker.context.pct, Math.min(24, seat.w - 4));
}

// 미니를 그린다. 방·바닥무늬·비품·의자·책상·말풍선·전환이 전부 없으므로 `render`와 공유하는 것은
// 바닥(drawFloor)·기호(drawGlyphBubble)·게이지(drawContextBar)·글자 꼬리(paintLabels)뿐이다.
export function renderMini(ctx, view, opts) {
  const { scale, dpr, t, hover, selected, noteOf } = opts;
  const labels = [];
  const plan = view.mini ?? miniPlan({ w: view.width, h: view.height, scale });
  const tint = nightTint(slotNow());
  view.tint = tint;

  ctx.setTransform(scale * dpr, 0, 0, scale * dpr, 0, 0);
  ctx.imageSmoothingEnabled = false;
  drawFloor(ctx, { x: 0, y: 0, w: ctx.canvas.width / (scale * dpr), h: ctx.canvas.height / (scale * dpr) }, tint);

  // 두 줄을 가르는 선. 뒷줄이 없으면 그을 것도 없다.
  if (plan.rows > 0 && (plan.backRows > 0 || plan.foldH)) {
    const y = plan.top + plan.foldH + plan.backH + Math.floor(M_ROW_GAP / 2);
    ctx.globalAlpha = 0.5;
    rect(ctx, M_PAD, y, plan.innerW, 1, shade(COLORS.wall, tint.l));
    ctx.globalAlpha = 1;
  }

  // 이름·경과를 칸 폭에 맞춰 자르려면(fitText) 재는 글꼴이 실제로 그릴 글꼴이어야 한다
  ctx.font = labelFont();
  const seatOpts = { hover, selected, scale, noteOf, tint, plan };
  for (const seat of view.seats) drawMiniSeat(ctx, seat, t, labels, seatOpts);

  // 접힌 뒷줄. 안 보이는 게가 몇인지는 적어야 한다 — 없으면 "게가 사라졌다"가 된다.
  const folded = plan.foldedBack + plan.foldedFront;
  if (folded > 0 && plan.foldH) {
    labels.push({
      x: M_PAD + plan.innerW / 2,
      y: plan.top + plan.foldH,
      text: `+${folded}`,
      color: COLORS.labelDim,
      size: 8,
      align: 'center',
    });
  }

  paintLabels(ctx, labels, { scale, dpr });
}

// 캔버스는 **보이는 창**이고 사무실이 그 안에서 움직인다(app.mjs의 panX·panY).
// 세계 좌표 → 화면은 `world * scale + pan`이다. 전에는 캔버스가 사무실만큼 컸는데,
// 그러면 8배로 확대했을 때 수천만 픽셀짜리 비트맵을 매 프레임 다시 그리고 바닥도 거기서 끝난다.
export function render(ctx, view, opts) {
  const { scale, dpr, t, hover, selected, pan = { x: 0, y: 0 } } = opts;
  const labels = [];

  // 자리·바닥 전환 단계를 먼저 정한다 — 아래 그리는 순서가 전부 이걸 본다.
  // 진행도는 앵커의 seenAt(렌더러가 그 상태를 처음 본 시각)부터 잰다.
  const now = Date.now();
  pruneAnchors(view.seats);
  for (const seat of view.seats) {
    const a = anchorOf(seat, now);
    seat.anchor = a;
    // a.mode는 아직 지난 프레임의 단계다 — phaseOf가 "직전에 앉아 있었는가"를 그걸로 판단한다
    seat.phase = phaseOf(seat.worker, now - a.seenAt, a.mode);
    // 단계가 넘어갈 때 **출발점만** 다시 잡는다(진행 시각은 그대로). hold에서 out으로 넘어갈 때
    // 자리 앞에서 출발해야 모서리를 자르지 않는다 — 안 하면 hold 시작 지점에서 바닥으로 직선을 긋는다.
    if (a.mode !== seat.phase.mode) {
      a.mode = seat.phase.mode;
      a.from = a.last;
    }
    // 앉아 있는 동안엔 posFor가 불리지 않아 a.last가 낡는다 — 창 크기가 바뀌어 방이 옮겨진 뒤
    // 일어나면 옛 좌표(책상 줄 안쪽까지 70px 어긋난 지점)에서 출발했다. 매 프레임 현재 자리
    // 앞으로 갱신해 두면 일어나는 순간이 항상 지금 레이아웃 기준이다.
    if (seat.phase.mode === 'sit') a.last = deskFront(seat);
  }

  // 심야 조명. 레이아웃이 아니라 **그리는 순간**에 정하므로 창 크기를 다시 재지 않아도
  // 시간대가 바뀌면 다음 프레임부터 반영된다.
  const tint = nightTint(slotNow());
  view.tint = tint;
  // 방마다 다르다 — 퇴근한 방은 그 위에 한 번 더 어두워진다
  for (const box of view.boxes) box.tint = roomTint(box.room, tint);

  ctx.setTransform(scale * dpr, 0, 0, scale * dpr, pan.x * dpr, pan.y * dpr);
  ctx.imageSmoothingEnabled = false;
  // 보이는 창을 세계 좌표로 되돌려 그만큼만 바닥을 깐다
  drawFloor(
    ctx,
    { x: -pan.x / scale, y: -pan.y / scale, w: ctx.canvas.width / (scale * dpr), h: ctx.canvas.height / (scale * dpr) },
    tint,
  );
  for (const box of view.boxes) drawRoom(ctx, box, labels, t);

  // 자리 줄 먼저, 그다음 바닥의 게들을 y 순으로 — 앞에 선 게가 뒤를 가린다.
  for (const box of view.boxes) {
    if (box.blocks) {
      drawMeetingRoom(ctx, box, scale, t, labels, hover, selected);
      continue;
    }
    for (const seat of box.seats) {
      drawSeatBody(ctx, seat, t, hover, selected);
      drawSeatTag(ctx, seat, scale, labels, selected);
    }
  }

  const walkers = view.seats
    .filter((s) => !sitsNow(s))
    .map((seat) => ({ seat, pos: posFor(seat, t) }))
    .sort((a, b) => a.pos.y - b.pos.y);
  // 잡담은 **바닥을 어슬렁거리는 놈끼리만** 시킨다.
  // 나를 기다리는 놈은 짝이 잡히면 glyphKeyFor가 느낌표를 접고 대사도 잡담으로 바뀌어,
  // 정작 불러야 할 때 옆자리와 수다를 떠는 꼴이 된다. 자리를 오가는 중인 놈도 마찬가지로
  // 끼우지 않는다 — 다 했다는 표시를 들고 걸어 나가는 길에 붙잡혀 서면 안 된다.
  const chats = findChats(
    walkers.filter((w) => w.seat.worker.mood !== 'waiting' && w.seat.phase.mode === 'walk'),
  );

  const speakers = [];
  for (const { seat, pos } of walkers) {
    const chat = chats.get(seat.worker.key);
    const top = drawWanderer(ctx, seat, pos, t, labels, hover, selected, chat);
    speakers.push({ seat, top, pos, chat });
  }
  for (const seat of view.seats) {
    if (sitsNow(seat)) speakers.push({ seat, top: seat.y + SEAT_HEAD, pos: null, chat: null });
  }

  // 상태 기호는 머리 옆에 붙는 작은 것이라 겹칠 일이 없다 — 먼저 다 그린다.
  // 단 전환(hold·out·in) 중에는 게들이 16~18px 간격으로 늘어서므로 옆(cx+12)에 붙이면
  // 옆 게의 몸을 덮는다 — 그때만 제 머리 위 가운데로 올린다(13px 폭이라 간격 안에 든다).
  const said = [];
  for (const { seat, top, pos, chat } of speakers) {
    const { worker } = seat;
    const cx = seat.actor?.x ?? seat.x + SLOT_W / 2;
    const inTransit = seat.phase && seat.phase.mode !== 'walk' && seat.phase.mode !== 'sit';
    // 잡담 짝이 **상대의 대답 구간**에 있는가 — 먼저 말한 쪽 머리에 하트를 띄울 조건이다.
    // 구간 경계(CHAT_B)는 이 파일이 들고 있으므로 판정만 해서 넘긴다.
    const answering = Boolean(chat) && (pos?.f ?? 0) >= CHAT_B[0] && (pos?.f ?? 0) < CHAT_B[1];
    const glyph =
      SPR[glyphKeyFor(worker, { chat, answering, phase: seat.phase, slot: slotNow(), tms: t })] ?? null;
    if (glyph) {
      const float =
        worker.mood === 'waiting' ? Math.round(Math.sin(t / 260) * 1.5) : Math.round(Math.sin(t / 900) * 1);
      if (inTransit) drawGlyphBubble(ctx, cx, top - 1 + float, glyph);
      else drawGlyphBubble(ctx, cx + 12, top + 4 + float, glyph);
    }
    // 기호가 머리 위로 올라간 동안엔 말풍선이 그 위로 더 비켜야 한다
    const speechGap = glyph ? (inTransit ? 15 : 6) : 2;

    // 비서가 보고하는 동안엔 본인은 입을 다문다 — 둘이 동시에 떠들면 말풍선이 겹친다
    const report = seat.aideAnchor ? reportFor(worker, t) : null;
    if (report) {
      said.push({ seat, speech: report, cx: seat.aideAnchor.x, bottom: seat.aideAnchor.top - 1, prio: 3 });
      continue;
    }
    // 막 끝냈다·막 시작했다는 한마디는 주기를 기다리지 않고 바로 띄운다.
    // 우선순위를 잡담보다 높게 둬서 좁은 방에서 다른 말풍선에 밀려 접히지 않게 한다.
    const move = seat.phase?.note ? moveSpeech(worker, seat.phase.note) : null;
    if (move) {
      said.push({ seat, speech: move, cx, bottom: top - speechGap, prio: 3 });
      continue;
    }
    const speech = chat
      ? chatSpeech(chat.pairKey, pos.seg, chat.role, pos.f)
      : speechFor(worker, t, seat.box.theme.lines);
    // 기호 말풍선이 이미 떠 있으면 혼잣말은 그 위로 비켜준다
    if (speech) said.push({ seat, speech, cx, bottom: top - speechGap, prio: chat ? 2 : 1 });
  }

  // 좁은 방에서 둘이 동시에 긴 말을 하면 말풍선이 서로 덮어 아무것도 읽히지 않는다.
  // 중요한 것(비서 보고 → 잡담 → 혼잣말)부터 놓고, 이미 놓인 것과 겹치면 이번엔 접는다.
  // 순서가 프레임마다 같으므로 깜빡이지 않는다.
  said.sort((a, b) => b.prio - a.prio || a.seat.y - b.seat.y || a.seat.x - b.seat.x);
  const placed = [];
  for (const s of said) {
    const g = measureBubble(ctx, s.cx, s.bottom, s.speech, opts, s.seat.box, view.width);
    if (placed.some((p) => bubblesOverlap(p, g))) continue;
    placed.push(g);
    paintBubble(ctx, g, s.speech, labels);
  }

  paintLabels(ctx, labels, { scale, dpr, pan });
}

// 텍스트는 확대 밖에서 — 픽셀 확대에 딸려가면 읽을 수 없다.
// 픽셀 폰트는 글자 원점이 정수여야 또렷하다. textAlign에 맡기면 가운데 정렬에서
// 0.5px이 남아 서브픽셀 안티에일리어싱이 끼므로, 직접 재서 정수로 반올림한다.
// 큰 창과 미니가 같은 꼬리를 쓴다 — 글자를 그리는 규칙이 두 벌이면 한쪽만 흐려진다.
function paintLabels(ctx, labels, { scale, dpr, pan = { x: 0, y: 0 } }) {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  ctx.font = labelFont();
  for (const l of labels) {
    ctx.fillStyle = l.color;
    const shift = l.align === 'center' ? ctx.measureText(l.text).width / 2 : l.align === 'right' ? ctx.measureText(l.text).width : 0;
    if (l.alpha != null) ctx.globalAlpha = l.alpha;
    // 확대 변환 밖이므로 사무실이 놓인 자리를 여기서 더해 준다
    ctx.fillText(l.text, Math.round(l.x * scale + pan.x - shift), Math.round(l.y * scale + pan.y));
    if (l.alpha != null) ctx.globalAlpha = 1;
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
}
