// 산책 창의 껍데기 — 스냅샷을 받고, 프레임을 돌리고, 마우스를 다룬다.
//
// 큰 창·미니와 같은 페이지를 쓰지 않는다. 저 둘은 상단바·목록·패널을 공유하니 `?mini=1`로
// 갈라 쓰는 값이 있었지만, 산책에는 **DOM이 캔버스 하나뿐**이다. 같은 app.mjs를 태우면
// 쓰지도 않을 2천 줄이 창마다 한 벌씩 돌게 된다.
import { OFFICE_FONT_PX, OFFICE_FONT_FAMILY } from './render.mjs';
import { createWorld, stepStroll, strollCast, petAt, STROLL_MAX } from './stroll.mjs';
import { renderStroll } from './stroll-view.mjs';

const canvas = document.getElementById('stroll');
const ctx = canvas.getContext('2d');

// 게를 몇 배로 그릴까. 2배(32px)가 바탕화면에서 눈에 걸리면서도 창을 가리지 않는 크기다.
const SCALE = 2;
// 프레임 제한. 걷기·타이핑이 150ms 단위라 30fps면 충분하고, 화면을 덮는 투명 창을
// 60fps로 다시 칠하면 아무것도 안 하는 동안에도 GPU가 계속 돈다.
const FRAME_MS = 33;
// 누른 채 이만큼 움직이거나 이 시간을 넘기면 클릭이 아니라 **집어 든 것**이다
const DRAG_SLOP = 4;
const CLICK_MS = 400;

let dpr = Math.min(window.devicePixelRatio || 1, 2);
let state = { rooms: [] };
let limit = STROLL_MAX;
const world = createWorld();
let pets = [];

let pointer = null; // 마지막 커서 자리 (창 좌표, CSS px)
let hover = null; // 지금 커서 밑의 게 key
let grab = null; // 잡고 있는 게 { key, dx, dy, at, moved }
let drag = null; // stepStroll에 넘길 { key, x, y }
let passThrough = true; // 지금 창이 클릭을 통과시키고 있는가

function logical() {
  return { w: canvas.clientWidth / SCALE, h: canvas.clientHeight / SCALE };
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
  document.body.style.cursor = on ? 'default' : 'grab';
}

function tick(now) {
  requestAnimationFrame(tick);
  if (now - tick.last < FRAME_MS) return;
  const dt = tick.last ? now - tick.last : FRAME_MS;
  tick.last = now;

  const { w, h } = logical();
  if (!w || !h) return;

  pets = stepStroll(world, strollCast(state.rooms, limit), { w, h, now: Date.now(), dt, drag });

  // **커서 밑을 매 프레임 다시 본다.** 마우스가 가만히 있어도 게가 걸어와 커서 밑으로
  // 들어올 수 있는데, 그때 mousemove는 오지 않는다.
  if (grab) {
    hover = grab.key;
  } else if (pointer) {
    const hit = petAt(pets, pointer.x, pointer.y, SCALE);
    hover = hit?.key ?? null;
    setPassThrough(!hit);
  } else {
    hover = null;
    setPassThrough(true);
  }

  renderStroll(ctx, pets, {
    scale: SCALE,
    dpr,
    t: now,
    hover,
    font: `${OFFICE_FONT_PX}px ${OFFICE_FONT_FAMILY}, monospace`,
  });
}
tick.last = 0;

// ── 마우스
//
// 창은 기본적으로 클릭을 통과시키므로(main의 setIgnoreMouseEvents(true, { forward: true }))
// 여기 오는 mousemove는 **통과 중에도** 전달되는 것이다. 그래서 커서가 게 위에 닿는 순간
// 통과를 끄고, 벗어나면 다시 켠다.
window.addEventListener('mousemove', (e) => {
  pointer = { x: e.clientX, y: e.clientY };
  if (!grab) return;
  if (Math.abs(e.clientX - grab.at.x) > DRAG_SLOP || Math.abs(e.clientY - grab.at.y) > DRAG_SLOP) grab.moved = true;
  drag = { key: grab.key, x: (e.clientX + grab.dx) / SCALE, y: (e.clientY + grab.dy) / SCALE };
});

window.addEventListener('mouseleave', () => {
  pointer = null;
});

window.addEventListener('mousedown', (e) => {
  if (e.button !== 0) return;
  const hit = petAt(pets, e.clientX, e.clientY, SCALE);
  if (!hit) return;
  grab = {
    key: hit.key,
    // 잡은 지점을 유지한다 — 안 그러면 게가 커서 중심으로 튄다
    dx: hit.x * SCALE - e.clientX,
    dy: hit.y * SCALE - e.clientY,
    at: { x: e.clientX, y: e.clientY },
    t: Date.now(),
    moved: false,
  };
  drag = { key: hit.key, x: hit.x, y: hit.y };
  document.body.style.cursor = 'grabbing';
});

window.addEventListener('mouseup', () => {
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
  window.office
    .getView?.()
    .then((v) => {
      const n = Number(v?.strollMax);
      if (Number.isFinite(n) && n > 0) limit = Math.min(24, Math.round(n));
    })
    .catch(() => {
      /* 설정을 못 읽으면 기본 인원으로 돈다 */
    });
}

// 캔버스는 DOM 텍스트가 아니라서 @font-face 선언만으로는 폰트가 로드되지 않는다
document.fonts?.load(`${OFFICE_FONT_PX}px ${OFFICE_FONT_FAMILY}`).catch(() => {});

resize();
connect();
requestAnimationFrame(tick);

// 헤드리스로 굽을 때 쓰는 입구 — 큰 창의 `__office.push`와 같은 자리다
window.__stroll = {
  push: (next) => applyState(next),
  pets: () => pets,
};
