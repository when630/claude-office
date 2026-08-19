// 산책 창의 껍데기 — 스냅샷을 받고, 프레임을 돌리고, 마우스를 다룬다.
//
// 큰 창·미니와 같은 페이지를 쓰지 않는다. 저 둘은 상단바·목록·패널을 공유하니 `?mini=1`로
// 갈라 쓰는 값이 있었지만, 산책에는 **DOM이 캔버스 하나뿐**이다. 같은 app.mjs를 태우면
// 쓰지도 않을 2천 줄이 창마다 한 벌씩 돌게 된다.
import { OFFICE_FONT_PX, OFFICE_FONT_FAMILY } from './render.mjs';
import { setLang } from '../shared/i18n.mjs';
import {
  createWorld,
  stepStroll,
  strollCast,
  strollTracks,
  saying,
  petAt,
  petsInBox,
  orderMove,
} from './stroll.mjs';
import { renderStroll } from './stroll-view.mjs';
import {
  STROLL_MAXES,
  STROLL_SCALES,
  STROLL_SPEEDS,
  STROLL_DEFAULTS,
  pickStroll,
} from '../shared/stroll-choices.mjs';

const canvas = document.getElementById('stroll');
const ctx = canvas.getContext('2d');

// 게를 몇 배로 그릴까. 2배(32px)가 바탕화면에서 눈에 걸리면서도 창을 가리지 않는 기본값이고,
// 화면 크기와 취향을 타는 값이라 설정 창에서 고른다(설정 > 일반 > 바탕화면 산책).
// **창이 뜬 뒤로는 안 바뀐다** — 세 모습이 배타적이라 산책 중에는 설정 창이 떠 있지 않고,
// 다음에 갈아탈 때 새 창이 저장된 값을 읽어 온다.
let scale = STROLL_DEFAULTS.strollScale;
let speed = STROLL_DEFAULTS.strollSpeed;
// 프레임 제한. 걷기·타이핑이 150ms 단위라 30fps면 충분하고, 화면을 덮는 투명 창을
// 60fps로 다시 칠하면 아무것도 안 하는 동안에도 GPU가 계속 돈다.
const FRAME_MS = 33;
// 누른 채 이만큼 움직이거나 이 시간을 넘기면 클릭이 아니라 **집어 든 것**이다
const DRAG_SLOP = 4;
const CLICK_MS = 400;

let dpr = Math.min(window.devicePixelRatio || 1, 2);
let state = { rooms: [] };
let limit = STROLL_DEFAULTS.strollMax;
const world = createWorld();
let pets = [];

let pointer = null; // 마지막 커서 자리 (창 좌표, CSS px)
let hover = null; // 지금 커서 밑의 게 key
let grab = null; // 잡고 있는 게 { key, dx, dy, at, moved }
let drag = null; // stepStroll에 넘길 { key, x, y }
let passThrough = true; // 지금 창이 클릭을 통과시키고 있는가
let frozen = false; // 헤드리스로 굽을 때만 켠다 (__stroll.freeze)

// ── 지휘 (Ctrl+Shift)
//
// 이 창은 평소 클릭을 통과시키므로 키를 받을 자리가 없다. 그런데 **통과 중에 전달되는
// mousemove에는 수식키 상태가 실려 온다** — 실제 마우스 입력으로 확인했다. 그래서 별도 창도
// 전역 단축키도 없이 `ctrlKey && shiftKey`만 보면 된다.
let command = false; // 지금 지휘 모드인가
let box = null; // 그리는 중인 선택 상자 (창 좌표)
const selected = new Set(); // 고른 게의 key
// 상자를 안 끄는 동안에는 이 하나를 돌려 쓴다 — 30fps로 빈 Set을 새로 만들 이유가 없다
const NO_KEYS = new Set();
let inBox = NO_KEYS; // 지금 상자 안에 들어와 있는 게의 key (아직 고른 것은 아니다)
const picks = new Map(); // 고른 직후 이펙트를 돌릴 게 — key → 시작 시각(performance.now)
let marks = []; // 누른 자리에 찍히는 표식 (논리 좌표)

// 고른 게마다 이펙트를 켤 시각. **한꺼번에 켜면 화면이 한 번 번쩍이고 만다** —
// 가운데에서 바깥으로 시차를 주면 하나씩 호명되는 것으로 읽힌다.
function armPicks(list, mid, now) {
  for (const pet of list) {
    const away = Math.hypot(pet.x - mid.x, pet.y - mid.y);
    picks.set(pet.key, now + Math.min(200, away * 1.6));
  }
}

// 표식 하나. 오래된 것은 그릴 때 걸러지므로 여기서는 개수만 막는다.
function mark(m) {
  marks.push({ ...m, t0: performance.now() });
  if (marks.length > 8) marks = marks.slice(-8);
}

// 상자를 실제로 끌었는가. 톡 누른 것과 갈라야 하는 자리가 둘이라 여기 모아 둔다.
function drawnBox(b) {
  return Math.abs(b.x1 - b.x0) > 3 || Math.abs(b.y1 - b.y0) > 3;
}

// 상자를 게가 사는 좌표계로. 창 좌표로 그려 놓고 논리 좌표로 재는 자리가 셋이다.
function boxLogical(b) {
  return { x0: b.x0 / scale, y0: b.y0 / scale, x1: b.x1 / scale, y1: b.y1 / scale };
}

// 고른 게들을 감싸는 자리 — 그룹핑 표식이 여기로 조여든다
function boundsOf(list) {
  if (!list.length) return null;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const p of list) {
    x0 = Math.min(x0, p.x - 9);
    x1 = Math.max(x1, p.x + 9);
    y0 = Math.min(y0, p.y - 15);
    y1 = Math.max(y1, p.y + 2);
  }
  return { x0, y0, x1, y1 };
}

function logical() {
  return { w: canvas.clientWidth / scale, h: canvas.clientHeight / scale };
}

function resize() {
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(canvas.clientWidth * dpr);
  canvas.height = Math.round(canvas.clientHeight * dpr);
}

// 클릭을 먹을지 통과시킬지. **바뀔 때만 알린다** — 마우스가 움직일 때마다 IPC를 태우면
// 커서를 흔드는 것만으로 초당 수백 번이 오간다.
function setPassThrough(on) {
  if (on === passThrough) return;
  passThrough = on;
  window.office?.strollPass?.(on);
  // 지휘 중이면 커서를 감춘 채로 둔다 — 여기서 되돌리면 십자가 두 겹이 된다
  document.body.style.cursor = command ? 'none' : on ? 'default' : 'grab';
}

function tick(now) {
  requestAnimationFrame(tick);
  if (now - tick.last < FRAME_MS) return;
  const dt = tick.last ? now - tick.last : FRAME_MS;
  tick.last = now;

  const { w, h } = logical();
  if (!w || !h) return;

  // 얼려 두면 그리기만 한다 — 헤드리스로 굽을 때 특정 순간(구멍을 반쯤 통과한 참 같은)을
  // 잡으려면 시간이 멈춰 있어야 한다. 켜는 곳은 `__stroll.freeze` 하나뿐이다.
  if (!frozen)
    pets = stepStroll(world, strollCast(state.rooms, limit), {
      w,
      h,
      now: Date.now(),
      dt,
      drag,
      speed,
      // 커서는 논리 좌표로 넘긴다 — 게가 사는 좌표계가 그것이다
      pointer: pointer && !grab ? { x: pointer.x / scale, y: pointer.y / scale } : null,
    });

  // 지금 하는 말. 그리는 쪽이 문자열만 보게 여기서 붙여 둔다.
  for (const pet of pets) pet.say = saying(pet, Date.now());

  // **커서 밑을 매 프레임 다시 본다.** 마우스가 가만히 있어도 게가 걸어와 커서 밑으로
  // 들어올 수 있는데, 그때 mousemove는 오지 않는다.
  if (command) {
    // 지휘 중에는 커서가 게 위에 있든 없든 창이 클릭을 먹는다
    hover = pointer ? (petAt(pets, pointer.x, pointer.y, scale)?.key ?? null) : null;
  } else if (grab) {
    hover = grab.key;
  } else if (pointer) {
    const hit = petAt(pets, pointer.x, pointer.y, scale);
    hover = hit?.key ?? null;
    setPassThrough(!hit);
  } else {
    hover = null;
    setPassThrough(true);
  }

  // 사라진 게는 선택에서도 빠진다
  if (selected.size) {
    for (const key of selected) if (!world.pets.has(key)) selected.delete(key);
  }

  // **상자 안은 매 프레임 다시 센다.** 상자를 안 움직여도 게가 걸어서 들고 난다 —
  // mousemove에서만 세면 가만 든 게가 표시 없이 잡히거나, 빠져나간 게가 표시를 달고 있다.
  // 아직 톡 누르기만 한 참이면 비워 둔다 — 상자에 크기가 없어도 판정에 여유(petsInBox)가
  // 있어서 옆에 선 게가 곧장 켜지는데, 그 상태로 떼면 선택은 오히려 풀린다
  inBox =
    box && drawnBox(box)
      ? new Set(petsInBox(pets, boxLogical(box)).map((p) => p.key))
      : NO_KEYS;

  renderStroll(ctx, pets, {
    scale,
    dpr,
    t: now,
    hover,
    font: `${OFFICE_FONT_PX}px ${OFFICE_FONT_FAMILY}, monospace`,
    tracks: strollTracks(world, Date.now()),
    selected,
    inBox,
    picks,
    // 상자는 창 좌표로 그렸으므로 논리 좌표로 바꿔 넘긴다
    box: box && boxLogical(box),
    command,
    cursor: command && pointer ? { x: pointer.x / scale, y: pointer.y / scale, ready: selected.size > 0 } : null,
    marks,
  });
}
tick.last = 0;

// ── 마우스
//
// 창은 기본적으로 클릭을 통과시키므로(main의 setIgnoreMouseEvents(true, { forward: true }))
// 여기 오는 mousemove는 **통과 중에도** 전달되는 것이다. 그래서 커서가 게 위에 닿는 순간
// 통과를 끄고, 벗어나면 다시 켠다.
// 수식키가 눌린 동안에는 창이 클릭을 먹는다. **떼면 곧장 통과로 돌아간다** —
// 화면을 덮는 창이 마우스를 계속 먹으면 그건 고장이다.
function setCommand(on) {
  if (on === command) return;
  command = on;
  if (!on) {
    box = null;
    inBox = NO_KEYS;
  }
  setPassThrough(!on);
  // 지휘 중에는 **OS 커서를 감추고 캔버스에 직접 그린다**(stroll-view의 drawCursor) —
  // 화살표 그대로면 지금 지휘 중인지가 화면에 드러나지 않는다
  document.body.style.cursor = on ? 'none' : passThrough ? 'default' : 'grab';
}

window.addEventListener('mousemove', (e) => {
  pointer = { x: e.clientX, y: e.clientY };
  setCommand(e.ctrlKey && e.shiftKey);
  if (box) {
    box.x1 = e.clientX;
    box.y1 = e.clientY;
    return;
  }
  if (!grab) return;
  if (Math.abs(e.clientX - grab.at.x) > DRAG_SLOP || Math.abs(e.clientY - grab.at.y) > DRAG_SLOP) grab.moved = true;
  drag = { key: grab.key, x: (e.clientX + grab.dx) / scale, y: (e.clientY + grab.dy) / scale };
});

window.addEventListener('mouseleave', () => {
  pointer = null;
});

// 지휘 중에는 우클릭이 "저리로 가라"다 — 창 메뉴가 뜨면 그 명령이 먹히지 않는다
window.addEventListener('contextmenu', (e) => {
  if (command) e.preventDefault();
});

window.addEventListener('mousedown', (e) => {
  if (command) {
    e.preventDefault();
    // 우클릭 — 고른 게들을 그 자리로 보낸다
    if (e.button === 2) {
      if (selected.size) {
        orderMove(world, selected, e.clientX / scale, e.clientY / scale, logical().w, logical().h);
        mark({ x: e.clientX / scale, y: e.clientY / scale });
      }
      return;
    }
    if (e.button !== 0) return;
    // 좌클릭 — 여기서부터 상자를 그린다
    box = { x0: e.clientX, y0: e.clientY, x1: e.clientX, y1: e.clientY };
    return;
  }
  if (e.button !== 0) return;
  const hit = petAt(pets, e.clientX, e.clientY, scale);
  if (!hit) return;
  grab = {
    key: hit.key,
    // 잡은 지점을 유지한다 — 안 그러면 게가 커서 중심으로 튄다
    dx: hit.x * scale - e.clientX,
    dy: hit.y * scale - e.clientY,
    at: { x: e.clientX, y: e.clientY },
    t: Date.now(),
    moved: false,
  };
  drag = { key: hit.key, x: hit.x, y: hit.y };
  document.body.style.cursor = 'grabbing';
});

window.addEventListener('mouseup', () => {
  if (box) {
    const drawn = drawnBox(box);
    selected.clear();
    picks.clear();
    const from = boxLogical(box);
    // 상자를 그렸으면 그 안을 고르고, 톡 누르기만 했으면 선택을 푼다
    let picked = [];
    if (drawn) {
      picked = petsInBox(pets, from);
      for (const p of picked) selected.add(p.key);
    }
    // 상자가 고른 것들을 감싸며 조여든다. 아무것도 못 골랐으면 그 자리로 오므라들어 사라진다.
    const mid = { x: (from.x0 + from.x1) / 2, y: (from.y0 + from.y1) / 2 };
    mark({
      group: true,
      from,
      to: boundsOf(picked) ?? { x0: mid.x - 1, y0: mid.y - 1, x1: mid.x + 1, y1: mid.y + 1 },
    });
    // 상자가 조여드는 동안 게마다 고리가 하나씩 앉는다 — 상자는 "여기까지 묶었다"를,
    // 게의 고리는 "너와 너와 너다"를 말한다
    if (picked.length) armPicks(picked, mid, performance.now());
    box = null;
    inBox = NO_KEYS;
    return;
  }
  if (!grab) return;
  const held = grab;
  grab = null;
  drag = null;
  document.body.style.cursor = passThrough ? 'default' : 'grab';
  // 끌지 않고 톡 눌렀으면 그 세션을 큰 창에서 편다. 끌었으면 놓은 자리에 떨어질 뿐이다.
  if (!held.moved && Date.now() - held.t < CLICK_MS) window.office?.selectSession?.(held.key);
});

window.addEventListener('resize', resize);

function applyState(next) {
  if (next) state = next;
}

function connect() {
  if (!window.office) return;
  window.office.onState(applyState);
  window.office.getState().then(applyState);
  // **언어는 창마다 따로 세운다.** 렌더러는 제 프로세스라 main이 정한 언어를 물어봐야 하는데,
  // 이 창은 글자를 잡담 말풍선에만 쓰다 보니 빠뜨렸다 — 한국어로 쓰는 사람에게 게가 영어로
  // 떠들고 있었다. 트레이에서 언어를 바꾸면 그때도 따라와야 한다(onLang).
  window.office
    .meta?.()
    .then((m) => m?.lang && setLang(m.lang))
    .catch(() => {});
  window.office.onLang?.((p) => p?.lang && setLang(p.lang));
  window.office
    .getView?.()
    .then((v) => {
      // main이 이미 걸러 둔 값이지만(sanitizeView) 한 번 더 본다 — 이 창은 설정 창 없이
      // 뜨므로 값이 이상해도 사람이 고칠 자리가 여기엔 없다
      limit = pickStroll(v?.strollMax, STROLL_MAXES, limit);
      scale = pickStroll(v?.strollScale, STROLL_SCALES, scale);
      speed = pickStroll(v?.strollSpeed, STROLL_SPEEDS, speed);
      resize();
    })
    .catch(() => {
      /* 설정을 못 읽으면 기본값으로 돈다 */
    });
}

// 캔버스는 DOM 텍스트가 아니라서 @font-face 선언만으로는 폰트가 로드되지 않는다
document.fonts?.load(`${OFFICE_FONT_PX}px ${OFFICE_FONT_FAMILY}`).catch(() => {});

resize();
connect();
requestAnimationFrame(tick);

// 헤드리스로 굽을 때 쓰는 입구 — 큰 창의 `__office.push`와 같은 자리다.
// `tuning`은 설정이 실제로 먹었는지 보는 자리다: 이 창에는 설정 UI가 없어서 눈으로는
// 크기가 커진 것과 화면이 작아진 것을 구분할 수 없다.
window.__stroll = {
  push: (next) => applyState(next),
  pets: () => pets,
  tuning: () => ({ scale, speed, limit }),
  world: () => world,
  selected: () => [...selected],
  inBox: () => [...inBox],
  cmd: () => ({ command, box: !!box, passThrough }),
  marks: (list) => {
    marks = list;
  },
  freeze: (on) => {
    frozen = on !== false;
  },
};
