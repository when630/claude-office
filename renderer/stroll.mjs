// 산책 모드의 **움직임**. 그리는 일은 stroll-view.mjs가 한다.
//
// 여기를 따로 떼어 둔 이유는 큰 창과 사정이 반대이기 때문이다. 사무실에서는 게의 자리가
// 시각(`t`)만으로 정해져서(`walkPos`) 상태를 들고 있을 필요가 없었다 — 같은 순간이면 늘
// 같은 자리다. 바탕화면에서는 그럴 수 없다: 사람이 게를 **집어 옮기고**, 걷다 말고 일이
// 들어오면 **그 자리에** 앉는다. 자리가 지나온 길에 달려 있으므로 프레임 사이에 상태가 남아야 한다.
//
// 그래서 이 파일은 캔버스를 모르고 `now`와 `dt`를 인자로 받는다 — main/notify.mjs가
// Electron을 모르는 것과 같은 이유이고, 그래서 test/stroll.test.mjs가 돈다.
import { miniRoster } from './render.mjs';

// 한 화면에 세울 수 있는 최대 인원. 세션이 스물이어도 바탕화면이 게로 덮이면 안 된다.
export const STROLL_MAX = 6;

// 걷는 속도(논리 px/ms). 큰 창의 산책과 같은 느긋함이다 — 데스크톱에서 빠르게 지나다니면
// 곁눈질이 아니라 방해가 된다.
//
// **위아래가 더 느리다.** 정면에서 본 그림이라 세로 이동은 앞뒤(깊이)로 읽히는데, 가로와
// 같은 속도로 오르내리면 걷는 것이 아니라 화면 위를 미끄러지는 것으로 보인다.
const SPEED_X = 0.018;
const SPEED_Y = 0.011;
// 화면 가장자리에서 남기는 여백.
// 위는 **머리 위 말풍선 몫**이고(게 12~14px + 기호 11px + 사이 3px), 아래는 **노트북 몫**이다
// — 상판이 발보다 4px 앞(아래)에 놓이므로 그만큼 없으면 일하는 순간 노트북이 잘린다.
const EDGE_X = 10;
const EDGE_TOP = 30;
const EDGE_BOTTOM = 7;
// 노트북을 펴고 접는 데 걸리는 시간. 펴는 쪽이 느린 것은 "꺼내는 동작"이 보여야 하기 때문이다.
const OPEN_MS = 520;
const SHUT_MS = 300;
// 내려놓은 뒤 잠깐 멈칫하는 시간 — 놓자마자 걸어가 버리면 놓아 준 자리가 안 보인다
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

// 게가 다닐 수 있는 자리. **화면 전체다** — 아래쪽 띠에만 묶어 두었더니 바탕화면 맨 밑에
// 게가 줄지어 붙어 있는 그림이 됐다. 창들 사이를 가로질러 다녀야 사무실이지 장식이 아니다.
//
// 좁은 화면에서도 위아래가 뒤집히지 않게 y는 반드시 `y0 < y1`로 나온다.
export function strollArea(w, h) {
  const top = Math.min(EDGE_TOP, Math.max(1, h / 2));
  return {
    x0: EDGE_X,
    x1: Math.max(EDGE_X + 1, w - EDGE_X),
    y0: top,
    y1: Math.max(top + 1, h - EDGE_BOTTOM),
  };
}

function clampToArea(pet, area) {
  pet.x = Math.min(Math.max(pet.x, area.x0), area.x1);
  pet.y = Math.min(Math.max(pet.y, area.y0), area.y1);
}

function outsideArea(pet, area) {
  return pet.x < area.x0 || pet.x > area.x1 || pet.y < area.y0 || pet.y > area.y1;
}

export function createWorld() {
  return { pets: new Map(), w: 0, h: 0 };
}

function spawn(entry, { w, h, now, rng }) {
  const area = strollArea(w, h);
  const fromLeft = rng() < 0.5;
  // 들어오는 높이는 매번 다르다 — 늘 같은 줄로 들어오면 여럿이 한 줄에 겹친다
  const y = area.y0 + rng() * (area.y1 - area.y0);
  return {
    key: entry.worker.key,
    entry,
    x: fromLeft ? -OFFSCREEN : w + OFFSCREEN,
    y,
    // **들어온 쪽 가까이에 선다.** 반대편을 목표로 주면 넓은 화면에서는 걸어 들어오는 데만
    // 수십 초가 걸려, 켜자마자 아무도 없는 바탕화면을 한참 보게 된다.
    gx: Math.round(fromLeft ? w * (0.05 + rng() * 0.15) : w * (0.8 + rng() * 0.15)),
    gy: y,
    dir: fromLeft ? 1 : -1,
    act: 'in',
    until: 0,
    lap: 0, // 노트북을 편 정도 0..1
    moving: true,
    born: now,
    seed: Math.floor(rng() * 1e6),
  };
}

// 한 프레임. `drag`는 지금 손에 잡힌 게({ key, x, y })이고 없으면 null이다.
export function stepStroll(world, cast, { w, h, now, dt, drag = null, rng = Math.random } = {}) {
  world.w = w;
  world.h = h;
  const area = strollArea(w, h);
  const live = new Map(cast.map((e) => [e.worker.key, e]));

  // 새로 온 게
  for (const [key, entry] of live) {
    if (!world.pets.has(key)) world.pets.set(key, spawn(entry, { w, h, now, rng }));
    else world.pets.get(key).entry = entry;
  }

  const step = Math.min(dt, 64); // 창이 가려졌다 돌아왔을 때 한 프레임에 순간이동하지 않게

  for (const pet of [...world.pets.values()]) {
    const gone = !live.has(pet.key);
    // 목록에서 빠진 게는 화면 밖으로 걸어 나간다 — 그 자리에서 사라지면 눈이 그것을 놓친다
    if (gone && pet.act !== 'out' && pet.act !== 'held') {
      pet.act = 'out';
      pet.lap = 0;
      pet.gx = pet.x < w / 2 ? -OFFSCREEN : w + OFFSCREEN;
      pet.gy = pet.y;
      pet.until = 0;
    }

    if (drag && drag.key === pet.key) {
      pet.act = 'held';
      pet.x = drag.x;
      pet.y = drag.y;
      pet.moving = false;
      pet.lap = 0;
      continue;
    }

    // 손에서 놓인 순간. **놓은 자리에 그대로 선다** — 위아래로 자유롭게 다니는 화면에는
    // 바닥이 없으므로 떨어질 곳도 없다. 잠깐 멈칫했다가 거기서부터 다시 걷는다.
    if (pet.act === 'held') {
      pet.act = 'land';
      pet.until = now + LAND_MS;
      clampToArea(pet, area);
    }

    if (pet.act === 'land') {
      pet.moving = false;
      if (now >= pet.until) {
        pet.act = 'walk';
        aim(pet, area, rng);
        pet.until = 0;
      }
      continue;
    }

    if (pet.act === 'in' || pet.act === 'out') {
      if (advance(pet, step, pet.act === 'out' ? 0 : NEAR)) {
        if (pet.act === 'out') world.pets.delete(pet.key);
        else {
          pet.act = 'walk';
          pet.until = now + REST_MIN;
          aim(pet, area, rng);
        }
      }
      continue;
    }

    // 창이 작아졌거나 모니터가 바뀌었으면 화면 안으로 당긴다 — 밖에 남으면 영영 안 보인다
    if (outsideArea(pet, area)) {
      clampToArea(pet, area);
      aim(pet, area, rng);
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
    if (advance(pet, step, NEAR)) {
      pet.moving = false;
      pet.until = now + REST_MIN + rng() * REST_SPAN;
      aim(pet, area, rng);
    }
  }

  // 아래에 있는 게를 나중에 그려야 앞에 온다 — 세로로도 다니게 된 뒤로 이 순서가 곧 원근이다
  return [...world.pets.values()].sort((a, b) => a.y - b.y || (a.key < b.key ? -1 : 1));
}

// 목적지로 한 걸음. 닿았으면 true.
//
// 축마다 속도가 다르므로 **방향은 거리로 정하고 속도는 축이 정한다.** x가 먼저 닿으면 남는
// 것은 세로 성분뿐이라 그 뒤로는 위아래로만 걷는다 — 대각선이 한 번 꺾이지만, 세로로도
// 가로 속도로 내달리는 것보다 걸음으로 읽힌다.
function advance(pet, step, near) {
  const dx = pet.gx - pet.x;
  const dy = pet.gy - pet.y;
  const dist = Math.hypot(dx, dy);
  // 닿았으면 **거기서 멈춘다 — 남은 거리를 당겨 붙이지 않는다.** 목적지로 스냅하면 그 한
  // 프레임에 최대 `near`만큼 건너뛰는데, 세로는 한 걸음이 0.2px이라 그게 여섯 걸음짜리
  // 순간이동이 된다(테스트가 잡았다). 1px 못 미친 자리가 곧 다음 걸음의 출발점이면 그만이다.
  if (dist <= near) {
    pet.moving = false;
    return true;
  }
  // 좌우 자세가 없는 캐릭터지만(정면 그림) 방향은 들고 있는다 — 나가는 쪽을 정할 때 쓴다
  if (Math.abs(dx) > 0.01) pet.dir = dx > 0 ? 1 : -1;
  const mx = (dx / dist) * SPEED_X * step;
  const my = (dy / dist) * SPEED_Y * step;
  // 한 걸음이 남은 거리보다 크면 목적지에 딱 맞춘다 — 넘어갔다 돌아오면 그 자리에서 떤다
  pet.x += Math.abs(mx) > Math.abs(dx) ? dx : mx;
  pet.y += Math.abs(my) > Math.abs(dy) ? dy : my;
  pet.moving = true;
  return false;
}

// 다음 목적지. **너무 가까운 곳은 고르지 않는다** — 한 걸음 걷고 멈추기를 반복하면
// 걷는 것이 아니라 떠는 것으로 보인다.
function aim(pet, area, rng = Math.random) {
  const spanX = area.x1 - area.x0;
  const spanY = area.y1 - area.y0;
  const least = Math.min(60, Math.max(8, spanX / 3));
  for (let i = 0; i < 6; i++) {
    const gx = area.x0 + rng() * spanX;
    const gy = area.y0 + rng() * spanY;
    if (Math.hypot(gx - pet.x, gy - pet.y) > least) {
      pet.gx = gx;
      pet.gy = gy;
      return;
    }
  }
  // 여섯 번 굴려도 가까우면 반대편으로 보낸다
  pet.gx = pet.x < (area.x0 + area.x1) / 2 ? area.x1 : area.x0;
  pet.gy = area.y0 + rng() * spanY;
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

export const STROLL_TUNING = { SPEED_X, SPEED_Y, EDGE_X, EDGE_TOP, EDGE_BOTTOM, OPEN_MS, SHUT_MS, LAND_MS, OFFSCREEN };
