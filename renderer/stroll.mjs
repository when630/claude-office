// 산책 모드의 **움직임**. 그리는 일은 stroll-view.mjs가 한다.
//
// 여기를 따로 떼어 둔 이유는 큰 창과 사정이 반대이기 때문이다. 사무실에서는 게의 자리가
// 시각(`t`)만으로 정해져서(`walkPos`) 상태를 들고 있을 필요가 없었다 — 같은 순간이면 늘
// 같은 자리다. 바탕화면에서는 그럴 수 없다: 사람이 게를 **집어 옮기고**, 놓으면 떨어지고,
// 걷다 말고 일이 들어오면 **그 자리에** 앉는다. 자리가 지나온 길에 달려 있으므로 프레임
// 사이에 상태가 남아야 한다.
//
// 그래서 이 파일은 캔버스를 모르고 `now`와 `dt`를 인자로 받는다 — main/notify.mjs가
// Electron을 모르는 것과 같은 이유이고, 그래서 test/stroll.test.mjs가 돈다.
import { miniRoster } from './render.mjs';

// 한 화면에 세울 수 있는 최대 인원. 세션이 스물이어도 바탕화면이 게로 덮이면 안 된다.
export const STROLL_MAX = 6;

// 걷는 속도(논리 px/ms). 큰 창의 산책과 같은 느긋함이다 — 데스크톱에서 빠르게 지나다니면
// 곁눈질이 아니라 방해가 된다.
const SPEED = 0.018;
// 바닥에서 띄우는 여백과 줄 간격. 게가 여러 마리일 때 **줄을 나눠** 서로 덜 겹치게 한다.
// 여백이 3px이 아닌 것은 **노트북이 발보다 앞(아래)에 놓이기 때문이다** — 맨 아랫줄에서
// 일을 시작하면 상판이 화면 밖으로 잘려 나간다.
const GROUND = 8;
const LANE_H = 9;
const LANES = 4;
// 노트북을 펴고 접는 데 걸리는 시간. 펴는 쪽이 느린 것은 "꺼내는 동작"이 보여야 하기 때문이다.
const OPEN_MS = 520;
const SHUT_MS = 300;
// 떨어지는 가속도(px/ms²) — 화면 높이만큼 떨어져도 1초 안쪽이다.
const GRAVITY = 0.0004;
// 착지 뒤 휘청이는 시간
const LAND_MS = 420;
// 목적지에 닿았다고 볼 거리, 그리고 다음 목적지까지 쉬는 시간
const NEAR = 1.2;
const REST_MIN = 900;
const REST_SPAN = 2600;
// 화면 밖 여백 — 등장·퇴장은 이만큼 밖에서 시작하고 끝난다
const OFFSCREEN = 22;

// 화면에 내보낼 게를 급한 순으로. **미니 창의 줄 세우기를 그대로 쓴다** — "무엇이 급한가"의
// 답이 화면마다 갈리면 같은 앱이 자기 모순에 빠진다(shared/status.mjs가 있는 이유와 같다).
// 앞줄(대기·헤맴·서버 장애·실패)이 먼저고 그다음이 뒷줄이며, 퇴근한 것은 miniRoster가 뺀다.
export function strollCast(rooms, limit = STROLL_MAX) {
  const { front, back } = miniRoster(rooms ?? []);
  return [...front, ...back].slice(0, Math.max(1, limit || STROLL_MAX));
}

// 이 세션은 지금 무엇을 하고 있어야 하나.
//
// `work`만이 자세를 **바꾸는 것이 아니라 자리를 붙잡는다** — 일을 받으면 걷다 말고 그 자리에
// 앉아 노트북을 편다. 나머지는 서 있거나(halt) 걷거나(walk) 둘 중 하나이고, 무슨 표정인지는
// 그리는 쪽이 mood를 보고 정한다.
export function wantAct(worker) {
  if (worker?.mood === 'typing') return 'work';
  if (worker?.mood === 'idle' || worker?.mood === 'done') return 'walk';
  // 대기·헤맴·실패·정지·서버 장애 — 전부 멈춰 서서 사람을 기다리는 상태다
  return 'halt';
}

function baseY(lane, h) {
  return Math.max(12, h - GROUND - lane * LANE_H);
}

// 이 게가 서는 바닥. 들려 있는 동안 그림자가 남을 자리라 그리는 쪽도 이것을 본다 —
// 여백과 줄 간격을 양쪽에 적어 두면 하나를 고칠 때 그림자만 딴 데 남는다.
export function petFloor(pet, h) {
  return baseY(pet?.lane ?? 0, h);
}

// 가장 한산한 줄. 같은 줄에 몰리면 게가 서로를 덮는다.
function pickLane(pets, near = null, h = 0) {
  if (near != null) {
    // 놓아 준 자리에서 가장 가까운 줄 — 손으로 옮긴 결과를 존중한다
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < LANES; i++) {
      const d = Math.abs(baseY(i, h) - near);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return best;
  }
  const count = new Array(LANES).fill(0);
  for (const p of pets) count[p.lane] = (count[p.lane] ?? 0) + 1;
  let best = 0;
  for (let i = 1; i < LANES; i++) if (count[i] < count[best]) best = i;
  return best;
}

export function createWorld() {
  return { pets: new Map(), w: 0, h: 0 };
}

function spawn(world, entry, { w, h, now, rng }) {
  const fromLeft = rng() < 0.5;
  const lane = pickLane([...world.pets.values()]);
  return {
    key: entry.worker.key,
    entry,
    lane,
    x: fromLeft ? -OFFSCREEN : w + OFFSCREEN,
    y: baseY(lane, h),
    dir: fromLeft ? 1 : -1,
    act: 'in',
    // **들어온 쪽 가까이에 선다.** 반대편을 목표로 주면 넓은 화면에서는 걸어 들어오는 데만
    // 수십 초가 걸려, 켜자마자 아무도 없는 바탕화면을 한참 보게 된다.
    goal: Math.round(fromLeft ? w * (0.05 + rng() * 0.15) : w * (0.8 + rng() * 0.15)),
    until: 0,
    lap: 0, // 노트북을 편 정도 0..1
    vy: 0,
    moving: true,
    born: now,
    seed: Math.floor(rng() * 1e6),
  };
}

// 한 프레임. `drag`는 지금 손에 잡힌 게({ key, x, y })이고 없으면 null이다.
export function stepStroll(world, cast, { w, h, now, dt, drag = null, rng = Math.random } = {}) {
  world.w = w;
  world.h = h;
  const live = new Map(cast.map((e) => [e.worker.key, e]));

  // 새로 온 게
  for (const [key, entry] of live) {
    if (!world.pets.has(key)) world.pets.set(key, spawn(world, entry, { w, h, now, rng }));
    else world.pets.get(key).entry = entry;
  }

  const step = Math.min(dt, 64); // 창이 가려졌다 돌아왔을 때 한 프레임에 순간이동하지 않게

  for (const pet of [...world.pets.values()]) {
    const gone = !live.has(pet.key);
    // 목록에서 빠진 게는 화면 밖으로 걸어 나간다 — 그 자리에서 사라지면 눈이 그것을 놓친다
    if (gone && pet.act !== 'out' && pet.act !== 'held' && pet.act !== 'fall') {
      pet.act = 'out';
      pet.lap = 0;
      pet.goal = pet.x < w / 2 ? -OFFSCREEN : w + OFFSCREEN;
      pet.until = 0;
    }

    if (drag && drag.key === pet.key) {
      pet.act = 'held';
      pet.x = drag.x;
      pet.y = drag.y;
      pet.vy = 0;
      pet.moving = false;
      pet.lap = 0;
      continue;
    }

    // 손에서 놓인 순간 — 떨어진다
    if (pet.act === 'held') {
      pet.act = 'fall';
      pet.vy = 0;
    }

    if (pet.act === 'fall') {
      pet.vy += GRAVITY * step;
      pet.y += pet.vy * step;
      pet.lane = pickLane([], pet.y, h);
      const floor = baseY(pet.lane, h);
      if (pet.y >= floor) {
        pet.y = floor;
        pet.vy = 0;
        pet.act = 'land';
        pet.until = now + LAND_MS;
      }
      pet.x = Math.min(Math.max(pet.x, 4), Math.max(4, w - 4));
      pet.moving = false;
      continue;
    }

    if (pet.act === 'land') {
      pet.moving = false;
      if (now >= pet.until) {
        pet.act = 'walk';
        pet.goal = nextGoal(pet, w, rng);
        pet.until = 0;
      }
      continue;
    }

    // 줄이 바뀌었거나 화면 크기가 달라졌으면 바닥을 다시 잡는다
    pet.y = baseY(pet.lane, h);

    if (pet.act === 'in' || pet.act === 'out') {
      const arrived = advance(pet, step, w, pet.act === 'out' ? 0 : NEAR);
      if (arrived) {
        if (pet.act === 'out') world.pets.delete(pet.key);
        else {
          pet.act = 'walk';
          pet.until = now + REST_MIN;
          pet.goal = nextGoal(pet, w, rng);
        }
      }
      continue;
    }

    const want = gone ? 'walk' : wantAct(pet.entry.worker);

    // 노트북 — 일을 받으면 펴고, 일이 끝나면 접는다. **접는 중에도 자리를 뜨지 않는다**
    if (want === 'work') {
      pet.lap = Math.min(1, pet.lap + step / OPEN_MS);
      pet.act = 'work';
      pet.moving = false;
      continue;
    }
    if (pet.lap > 0) {
      pet.lap = Math.max(0, pet.lap - step / SHUT_MS);
      pet.act = 'work';
      pet.moving = false;
      if (pet.lap > 0) continue;
    }

    if (want === 'halt') {
      pet.act = 'halt';
      pet.moving = false;
      continue;
    }

    // 산책 — 목적지까지 걷고, 닿으면 잠깐 쉬었다 새 목적지를 고른다
    pet.act = 'walk';
    if (now < pet.until) {
      pet.moving = false;
      continue;
    }
    if (advance(pet, step, w, NEAR)) {
      pet.moving = false;
      pet.until = now + REST_MIN + rng() * REST_SPAN;
      pet.goal = nextGoal(pet, w, rng);
    }
  }

  // 아래에 있는 게를 나중에 그려야 앞에 온다
  return [...world.pets.values()].sort((a, b) => a.y - b.y || (a.key < b.key ? -1 : 1));
}

// 목적지로 한 걸음. 닿았으면 true.
function advance(pet, step, w, near) {
  const d = pet.goal - pet.x;
  if (Math.abs(d) <= near) {
    pet.x = pet.goal;
    pet.moving = false;
    return true;
  }
  pet.dir = d > 0 ? 1 : -1;
  const move = Math.min(Math.abs(d), SPEED * step);
  pet.x += pet.dir * move;
  pet.moving = true;
  return false;
}

// 다음 목적지. **너무 가까운 곳은 고르지 않는다** — 한 걸음 걷고 멈추기를 반복하면
// 걷는 것이 아니라 떠는 것으로 보인다.
function nextGoal(pet, w, rng = Math.random) {
  const lo = 10;
  const hi = Math.max(lo + 1, w - 10);
  const span = hi - lo;
  for (let i = 0; i < 6; i++) {
    const g = lo + rng() * span;
    if (Math.abs(g - pet.x) > Math.min(60, span / 3)) return g;
  }
  return pet.x < (lo + hi) / 2 ? hi : lo;
}

// 게 하나가 차지하는 자리 — 클릭 판정에 쓴다(stroll-app.mjs).
// 실제 스프라이트보다 조금 넉넉하다: 12px 게를 정확히 짚으라고 하면 못 잡는다.
export function petHitBox(pet, scale = 2) {
  const w = 22 * scale;
  const h = 20 * scale;
  return { x: pet.x * scale - w / 2, y: pet.y * scale - h, w, h };
}

export function petAt(pets, px, py, scale = 2) {
  // 앞에 그려진 것(아래쪽)이 먼저 잡혀야 한다 — 그린 순서의 역순으로 훑는다
  for (let i = pets.length - 1; i >= 0; i--) {
    const b = petHitBox(pets[i], scale);
    if (px >= b.x && px <= b.x + b.w && py >= b.y && py <= b.y + b.h) return pets[i];
  }
  return null;
}

export const STROLL_TUNING = { SPEED, GROUND, LANE_H, LANES, OPEN_MS, SHUT_MS, GRAVITY, LAND_MS, OFFSCREEN };
