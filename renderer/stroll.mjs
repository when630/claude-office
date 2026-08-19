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
import { chatLines, hashStr } from './talk.mjs';
import { STROLL_DEFAULTS } from '../shared/stroll-choices.mjs';

// 한 화면에 세울 수 있는 인원의 기본값. 세션이 스물이어도 바탕화면이 게로 덮이면 안 된다.
// 실제로 쓰는 값은 설정에서 온다(설정 > 일반 > 바탕화면 산책).
export const STROLL_MAX = STROLL_DEFAULTS.strollMax;

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
// 내려놓거나 떨어져 선 뒤 잠깐 멈칫하는 시간 — 놓자마자 걸어가 버리면 놓아 준 자리가 안 보인다
const LAND_MS = 420;
// 포탈에서 떨어지는 높이와 가속도(px/ms²). 45px이면 반 초쯤 떨어진다 —
// 더 높이면 화면 위쪽에서 포탈이 잘리고, 더 낮으면 떨어진 것이 아니라 튀어나온 것이 된다.
// 구멍은 **게가 나오기 시작하는 평면**이다. 처음엔 머리 위로 한참 띄웠는데, 그러면 게가
// 이미 다 나온 채로 구멍 아래에 떠 있어 "거기서 나왔다"가 아니라 "구멍 밑에 있다"가 됐다.
// 이제 게는 이 높이에서 시작해 아래로 나온다 — 구멍 너머의 몸은 그리는 쪽이 잘라 낸다.
const DROP_H = 45;
const GRAVITY = 0.0004;
// 포탈이 열리고 · 게가 떨어지는 동안 열린 채 있다가 · 닫히는 시간
const PORTAL_OPEN_MS = 220;
const PORTAL_HOLD_MS = 520;
const PORTAL_CLOSE_MS = 260;
// 목적지에 닿았다고 볼 거리, 그리고 다음 목적지까지 쉬는 시간
const NEAR = 1.2;
const REST_MIN = 900;
const REST_SPAN = 2600;
// 가라앉는 깊이와 속도. **떨어지는 것이 아니라 빨려 들어가는 것이라 등속이다** —
// 나올 때처럼 중력을 주었더니 마지막 두 프레임에 훅 사라져서, 들어간 것이 아니라
// 그 자리에서 꺼진 것으로 보였다(굽어서 확인했다).
const SINK_H = 22;
const SINK_SPEED = 0.045;
// 손에서 놓았을 때 처지는 높이. **곧장 그 자리에 서면 놓은 것이 아니라 붙인 것으로 보인다** —
// 짧게 떨어져야 손을 떠난 순간이 생긴다.
const DROP_SHORT = 14;
// 집어 든 채로 이만큼 움직이면 어지러워한다(논리 px 누적). 옮기기만 한 게까지 어지럽게
// 만들면 자리를 바꿀 때마다 별이 돌아, 어지러움이 상태가 아니라 배경 무늬가 된다.
const SHAKE_LIMIT = 420;
const DIZZY_MS = 1800;
// 뛰기 — 목적지를 고를 때 이 확률로 달린다. 속도는 이만큼 곱한다.
const RUN_CHANCE = 0.28;
const RUN_MULT = 2.3;
// 커서가 이만큼 가까우면 걷다 말고 쳐다본다. 커서를 놓아 두기만 해도 게가 계속 멈춰 서면
// 산책이 아니게 되므로 **가까운 동안만** 멈추고, 커서가 가만히 있으면 곧 제 갈 길을 간다.
const LOOK_NEAR = 34;
const LOOK_MS = 1400;
// 잡담 — 이만큼 가까이 오면 말을 튼다. 한 마디씩 주고받고 헤어진다.
//
// **만남을 기다리지 않고 만들러 간다**(aim의 VISIT_CHANCE). 각자 아무 데나 목적지를 고르면
// 넓은 화면에서 둘이 스무 픽셀 안에 서는 일이 거의 없어, 잡담이 있으나 마나 한 기능이 됐다.
const CHAT_NEAR = 30;
const CHAT_MS = 4200;
const CHAT_SAY_MS = 1900; // 한 사람이 말하고 있는 시간
const CHAT_COOL_MS = 6000; // 헤어진 뒤 다시 말 걸기까지
// 다음 목적지를 이 확률로 **다른 게 옆**에 잡는다 — 그래야 마주친다
const VISIT_CHANCE = 0.34;
// 술래잡기 — 쉬고 있는 둘을 골라 잠깐 쫓게 한다
const CHASE_CHANCE = 0.006; // 프레임마다 굴린다(30fps에서 5~6초에 한 번쯤)
const CHASE_MS = 5200;
const CHASE_CATCH = 12;
// 폴짝. 잡히거나 반가울 때 한 번 뛴다. **얼마나 뜨는지는 여기서 안 정한다** —
// `pet.hop`은 0에서 1까지의 정도이고, 몇 px로 그릴지는 그리는 쪽이 안다(stroll-view의 HOP_H).
const HOP_MS = 380;
// 쉬는 모습 — 할 일 없이 이만큼 지나면 기지개를 켜거나 잠깐 존다
// 26초로 두었더니 걷는 중간중간 자꾸 기지개가 나와, 산책이 아니라 몸풀기가 됐다
const REST_LONG_MS = 62_000;
const STRETCH_MS = 1300;
const NAP_MS = 9000;
const NAP_CHANCE = 0.45;
// 발자국. 이만큼 걸을 때마다 하나 남고(뛰면 더 성글게), 이 시간 동안 흐려진다.
const TRACK_GAP = 7;
const TRACK_GAP_RUN = 11;
const TRACK_MS = 1100;
const TRACK_MAX = 90;

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
  // tracks는 게가 밟고 지나간 자국이다. 게가 사라져도 자국은 제 시간까지 남으므로
  // pet에 딸리지 않고 세계가 들고 있는다.
  return { pets: new Map(), tracks: [], w: 0, h: 0 };
}

// 걸은 자리에 자국을 남긴다. **일정 거리마다**이지 일정 시간마다가 아니다 —
// 시간으로 재면 뛸 때 자국이 촘촘해져 발자국이 아니라 줄이 된다.
function leaveTrack(world, pet, moved, now) {
  pet.walked = (pet.walked ?? 0) + moved;
  const gap = pet.dash ? TRACK_GAP_RUN : TRACK_GAP;
  if (pet.walked < gap) return;
  pet.walked = 0;
  // 좌우 번갈아 찍는다 — 한 점만 남기면 자국이 아니라 흘린 부스러기로 보인다
  pet.foot = pet.foot === 1 ? -1 : 1;
  world.tracks.push({ x: pet.x + pet.foot * 3, y: pet.y, t0: now, run: !!pet.dash });
  if (world.tracks.length > TRACK_MAX) world.tracks.splice(0, world.tracks.length - TRACK_MAX);
}

// 게 하나를 만든다 — **설 자리 위에 포탈이 열리고 거기서 떨어진다.**
//
// 처음엔 화면 좌우 밖에서 걸어 들어오게 했다. 두 가지가 어긋났다:
//   - 넓은 화면에서는 걸어 들어오는 데만 10초가 넘게 걸린다. 산책으로 막 갈아탄 참이면
//     그동안 **일하던 게가 노트북 대신 걸어다니는** 그림이 되어 화면이 거짓말을 한다
//   - 산책은 좌우가 아니라 **화면 전체**를 쓰는데, 등장만 좌우 끝에서 시작하니 세로로
//     자유롭게 다니는 나머지 연출과 결이 맞지 않았다
//
// 떨어지는 자리가 곧 설 자리다(`gy`). 그래서 어디로 떨어질지 그림자가 미리 알려 준다.
function spawn(entry, { w, h, now, rng }) {
  const area = strollArea(w, h);
  const x = area.x0 + rng() * (area.x1 - area.x0);
  // **내려앉는 자리는 화면 위쪽을 비운다** — 구멍이 그만큼 더 위에 떠야 하는데, 맨 위에
  // 내려앉으면 그 구멍이 화면 밖으로 잘린다. 착지한 뒤에는 위로도 자유롭게 걸어간다.
  const top = Math.min(area.y0 + DROP_H, (area.y0 + area.y1) / 2);
  const y = top + rng() * Math.max(0, area.y1 - top);
  return {
    key: entry.worker.key,
    entry,
    x,
    y: y - DROP_H, // 포탈 바로 아래에서 시작해 떨어진다
    gx: x,
    gy: y,
    dir: rng() < 0.5 ? 1 : -1,
    act: 'warp',
    warpAt: now,
    portal: 0, // 포탈이 열린 정도 0..1 — 그리는 쪽이 이 값만 본다
    // 구멍이 뜨는 자리. **여기서 셈해 넘긴다** — 떨어지는 높이를 그리는 쪽에도 적어 두면
    // 한쪽만 고쳤을 때 게가 구멍이 아닌 허공에서 나온다
    portalY: y - DROP_H,
    vy: 0,
    until: 0,
    lap: 0, // 노트북을 편 정도 0..1
    moving: false,
    born: now,
    seed: Math.floor(rng() * 1e6),
  };
}

// 포탈이 얼마나 열려 있나. 열리고(OPEN) → 게가 떨어지는 동안 열린 채로 있다가(HOLD) → 닫힌다.
function portalOpen(age) {
  if (age < PORTAL_OPEN_MS) return age / PORTAL_OPEN_MS;
  if (age < PORTAL_OPEN_MS + PORTAL_HOLD_MS) return 1;
  return Math.max(0, 1 - (age - PORTAL_OPEN_MS - PORTAL_HOLD_MS) / PORTAL_CLOSE_MS);
}

// 한 프레임. `drag`는 지금 손에 잡힌 게({ key, x, y })이고 없으면 null이다.
// ── 놀이
//
// **전부 `idle`일 때만 걸린다.** 일하는 중이거나 나를 기다리는 게가 잡담을 하거나 졸고 있으면
// 그 순간 이 화면은 상태를 알려 주는 창이 아니라 그냥 장식이 된다. 놀이에 들어가는 판정마다
// `wantAct(...) === 'walk'`를 확인하는 이유다.

// 지금 놀 수 있는 게인가 — 쉬는 중이고, 이미 다른 놀이에 붙잡혀 있지 않다.
function freeToPlay(pet, live, now) {
  if (pet.act !== 'walk' && pet.act !== 'look') return false;
  if (pet.talk || pet.chase) return false;
  const entry = live.get(pet.key);
  return !!entry && wantAct(entry.worker) === 'walk' && (pet.chatCool ?? 0) < now;
}

// 가까이 선 둘을 짝지어 말을 트게 한다. **한 프레임에 한 쌍만** — 여럿이 동시에 말풍선을
// 띄우면 바탕화면이 대화창이 된다.
function pairChats(world, live, now) {
  // **걷는 중이어도 말을 튼다.** 둘 다 멈춰 서 있기를 기다렸더니 스쳐 지나가기만 했다 —
  // 가까워진 순간 서로 멈춰 세우는 편이 "마주쳤다"에 가깝다.
  const idle = [...world.pets.values()].filter((p) => freeToPlay(p, live, now));
  for (let i = 0; i < idle.length; i++) {
    for (let j = i + 1; j < idle.length; j++) {
      const a = idle[i];
      const b = idle[j];
      if (Math.hypot(a.x - b.x, a.y - b.y) > CHAT_NEAR) continue;
      // 역할은 키 순서로 고정한다 — 프레임마다 누가 먼저 말하는지가 뒤바뀌면 안 된다
      const [first, second] = a.key < b.key ? [a, b] : [b, a];
      const pairKey = `${first.key}|${second.key}`;
      first.talk = { pairKey, role: 0, t0: now };
      second.talk = { pairKey, role: 1, t0: now };
      return;
    }
  }
}

// 지금 이 게가 하고 있는 말. 없으면 null.
export function saying(pet, now) {
  if (!pet.talk) return null;
  const age = now - pet.talk.t0;
  const mine = pet.talk.role === 0 ? age < CHAT_SAY_MS : age >= CHAT_SAY_MS && age < CHAT_SAY_MS * 2;
  if (!mine) return null;
  const lines = chatLines(pet.talk.pairKey, Math.floor(pet.talk.t0 / 1000));
  return lines[pet.talk.role] || null;
}

// 쉬고 있는 둘을 골라 술래잡기를 시킨다.
function startChase(world, live, now, rng) {
  if (rng() >= CHASE_CHANCE) return;
  const idle = [...world.pets.values()].filter((p) => freeToPlay(p, live, now));
  if (idle.length < 2) return;
  const a = idle[Math.floor(rng() * idle.length) % idle.length];
  const rest = idle.filter((p) => p !== a);
  const b = rest[Math.floor(rng() * rest.length) % rest.length];
  if (!a || !b) return;
  a.chase = { key: b.key, role: 'it', until: now + CHASE_MS };
  b.chase = { key: a.key, role: 'run', until: now + CHASE_MS };
}

// 커서와 게 사이 거리. 논리 좌표끼리 잰다.
function nearPointer(pet, pointer) {
  if (!pointer) return false;
  return Math.hypot(pointer.x - pet.x, pointer.y - (pet.y - 6)) < LOOK_NEAR;
}

export function stepStroll(
  world,
  cast,
  { w, h, now, dt, drag = null, rng = Math.random, speed = 1, pointer = null } = {},
) {
  world.w = w;
  world.h = h;
  const area = strollArea(w, h);
  const live = new Map(cast.map((e) => [e.worker.key, e]));

  // 새로 온 게 — 모드를 막 켰든 산책 중에 세션이 생겼든 **같은 포탈로 떨어진다**
  for (const [key, entry] of live) {
    if (!world.pets.has(key)) world.pets.set(key, spawn(entry, { w, h, now, rng }));
    else world.pets.get(key).entry = entry;
  }

  const step = Math.min(dt, 64); // 창이 가려졌다 돌아왔을 때 한 프레임에 순간이동하지 않게

  // 놀 짝을 먼저 정한다 — 게 하나씩 도는 아래 루프에서는 둘을 같이 볼 수 없다
  pairChats(world, live, now);
  startChase(world, live, now, rng);

  for (const pet of [...world.pets.values()]) {
    // 포탈은 **어느 상태에 있든 제 시간표대로 닫힌다.** 떨어지는 동안만 갱신했더니 착지 뒤
    // 멈칫하는 사이(land) 시간이 멈춰, 게가 다시 걸을 때까지 구멍이 열린 채로 남았다.
    if (pet.warpAt != null) {
      pet.portal = portalOpen(now - pet.warpAt);
      if (pet.portal <= 0 && pet.act !== 'warp' && pet.act !== 'sink') pet.warpAt = null;
    }

    const gone = !live.has(pet.key);
    // 목록에서 빠진 게는 **발밑에 열린 구멍으로 가라앉는다.** 그 자리에서 그냥 사라지면 눈이
    // 그것을 놓치고, 전에 쓰던 "화면 밖으로 걸어 나가기"는 넓은 화면에서 수십 초가 걸렸다 —
    // 세션은 이미 끝났는데 게만 한참 남아 있었다. 들어오는 길과 같은 구멍으로 나간다.
    if (gone && pet.act !== 'sink' && pet.act !== 'held') {
      pet.act = 'sink';
      pet.lap = 0;
      pet.warpAt = now; // 포탈 시간표를 처음부터 다시 쓴다
      pet.portalY = pet.y; // 구멍은 선 자리에 열린다
      pet.vy = 0;
      pet.until = 0;
    }

    if (drag && drag.key === pet.key) {
      // 흔들린 거리를 잰다 — 놓을 때 어지러운지가 여기서 정해진다
      if (pet.act === 'held') pet.shake = (pet.shake ?? 0) + Math.abs(drag.x - pet.x) + Math.abs(drag.y - pet.y);
      else pet.shake = 0;
      pet.act = 'held';
      pet.x = drag.x;
      pet.y = drag.y;
      pet.moving = false;
      pet.lap = 0;
      continue;
    }

    // 손에서 놓인 순간. **곧장 서지 않고 조금 처진다** — 놓은 자리에 딱 붙어 서면 손을
    // 떠난 순간이 없어서, 놓은 것이 아니라 붙여 둔 것으로 보인다.
    // 많이 흔들렸으면 어지러운 채로 내려온다.
    if (pet.act === 'held') {
      pet.act = 'drop';
      pet.vy = 0;
      pet.gy = Math.min(area.y1, pet.y + DROP_SHORT);
      pet.dizzyUntil = (pet.shake ?? 0) > SHAKE_LIMIT ? now + DIZZY_MS : 0;
      pet.shake = 0;
      pet.x = Math.min(Math.max(pet.x, area.x0), area.x1);
    }

    // 놓인 뒤 짧게 떨어지는 중
    if (pet.act === 'drop') {
      pet.moving = false;
      pet.vy += GRAVITY * step;
      pet.y += pet.vy * step;
      if (pet.y >= pet.gy) {
        pet.y = pet.gy;
        pet.vy = 0;
        pet.act = 'land';
        pet.until = now + LAND_MS;
      }
      continue;
    }

    if (pet.act === 'land') {
      pet.moving = false;
      if (now >= pet.until) {
        // 흔들려서 내려왔으면 서자마자 비틀거린다
        pet.act = pet.dizzyUntil > now ? 'dizzy' : 'walk';
        if (pet.act === 'walk') aim(pet, area, rng, world);
        pet.until = 0;
      }
      continue;
    }

    // 흔들린 뒤에는 별을 돌리며 비틀거린다. **일이 들어오면 즉시 걷어낸다** —
    // 무슨 상태인지가 장난에 가려지면 이 화면이 파는 유일한 것을 잃는다.
    if (pet.act === 'dizzy') {
      const busy = !gone && wantAct(pet.entry.worker) !== 'walk';
      if (busy || now >= pet.dizzyUntil) {
        pet.dizzyUntil = 0;
        pet.act = 'walk';
        aim(pet, area, rng, world);
      } else {
        pet.moving = false;
        continue;
      }
    }

    // 포탈에서 떨어지는 중. 포탈이 다 열릴 때까지는 아직 나오지 않는다.
    if (pet.act === 'warp') {
      pet.moving = false;
      if (now - pet.warpAt < PORTAL_OPEN_MS) continue;
      pet.vy += GRAVITY * step;
      pet.y += pet.vy * step;
      if (pet.y >= pet.gy) {
        pet.y = pet.gy;
        pet.vy = 0;
        pet.act = 'land';
        pet.until = now + LAND_MS;
      }
      continue;
    }
    // 구멍으로 가라앉는 중. 구멍이 다 열린 뒤에 잠기기 시작하고, 구멍이 닫히면 사라진다.
    if (pet.act === 'sink') {
      pet.moving = false;
      const age = now - pet.warpAt;
      // 다 잠긴 뒤로는 더 내려가지 않는다 — 구멍이 닫힐 때까지 화면 밖으로 흘러갈 이유가 없다
      if (age >= PORTAL_OPEN_MS) pet.y = Math.min(pet.portalY + SINK_H, pet.y + SINK_SPEED * step);
      if (age > PORTAL_OPEN_MS && pet.portal <= 0) world.pets.delete(pet.key);
      continue;
    }

    // 창이 작아졌거나 모니터가 바뀌었으면 화면 안으로 당긴다 — 밖에 남으면 영영 안 보인다
    if (outsideArea(pet, area)) {
      clampToArea(pet, area);
      aim(pet, area, rng, world);
    }

    const want = gone ? 'walk' : wantAct(pet.entry.worker);

    // **놀이는 일 앞에서 즉시 걷힌다.** 일을 받았는데 아직 잡담 중이거나 졸고 있으면
    // 그 세션이 무엇을 하고 있는지가 장난에 가려진다.
    if (want !== 'walk' && (pet.talk || pet.chase || pet.act === 'nap' || pet.act === 'stretch')) {
      pet.talk = null;
      pet.chase = null;
      if (pet.act === 'nap' || pet.act === 'stretch') pet.act = 'walk';
    }

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

    // 폴짝 — 몸이 포물선으로 떴다 내려온다. **그림자는 바닥에 남아 작아진다**(그리는 쪽) —
    // 몸만 올라가면 뛴 것이 아니라 화면이 흔들린 것으로 보인다.
    if (pet.act === 'hop') {
      const age = now - pet.hopAt;
      pet.moving = false;
      if (age < HOP_MS) {
        pet.hop = Math.sin((age / HOP_MS) * Math.PI);
        continue;
      }
      pet.hop = 0;
      pet.act = 'walk';
      pet.until = now + REST_MIN;
      aim(pet, area, rng, world);
    }

    // 잡담 중 — 마주 보고 한 마디씩 주고받는다. 그동안은 걷지 않는다.
    if (pet.talk) {
      if (now - pet.talk.t0 < CHAT_MS) {
        pet.act = 'chat';
        pet.moving = false;
        continue;
      }
      pet.talk = null;
      pet.chatCool = now + CHAT_COOL_MS; // 헤어지자마자 또 말을 걸면 두 마리가 붙박이가 된다
      // 이야기가 잘 끝나면 폴짝 뛰고 간다
      if (rng() < 0.4) {
        pet.act = 'hop';
        pet.hopAt = now;
        pet.hop = 0;
        continue;
      }
    }

    // 술래잡기 — 술래는 상대를 향해, 도망자는 반대쪽으로 달린다
    if (pet.chase) {
      const other = world.pets.get(pet.chase.key);
      const caught = other && Math.hypot(other.x - pet.x, other.y - pet.y) < CHASE_CATCH;
      if (!other || now >= pet.chase.until || caught) {
        pet.chase = null;
        pet.chatCool = now + CHAT_COOL_MS;
        pet.dash = false;
        // 잡히면 폴짝 뛰고 흩어진다
        pet.act = 'hop';
        pet.hopAt = now;
        pet.hop = 0;
        continue;
      }
      pet.act = 'walk';
      pet.dash = true;
      if (pet.chase.role === 'it') {
        pet.gx = other.x;
        pet.gy = other.y;
      } else {
        // 도망은 술래 반대쪽 — 화면 밖으로 나가지 않게 안으로 당긴다
        pet.gx = Math.min(Math.max(pet.x + (pet.x - other.x), area.x0), area.x1);
        pet.gy = Math.min(Math.max(pet.y + (pet.y - other.y), area.y0), area.y1);
      }
      const was = { x: pet.x, y: pet.y };
      advance(pet, step, NEAR, speed * RUN_MULT);
      leaveTrack(world, pet, Math.abs(pet.x - was.x) + Math.abs(pet.y - was.y), now);
      continue;
    }

    // 커서가 가까이 오면 걷다 말고 **멈춰서 쳐다본다.** 커서가 계속 옆에 있어도 잠깐이면
    // 다시 걷는다 — 마우스를 어디 놓아 두었다고 게가 영영 서 있으면 산책이 아니다.
    if (pointer && nearPointer(pet, pointer)) {
      if (pet.lookAt == null) pet.lookAt = now;
      if (now - pet.lookAt < LOOK_MS) {
        pet.act = 'look';
        pet.moving = false;
        continue;
      }
    } else {
      pet.lookAt = null;
    }

    // 기지개와 낮잠 — 할 일 없이 오래 지나면 나온다. 자다가 일이 들어오면 위에서 걷어진다.
    if (pet.act === 'stretch' || pet.act === 'nap') {
      pet.moving = false;
      if (now < pet.until) continue;
      pet.act = 'walk';
      pet.restSince = now;
      aim(pet, area, rng, world);
      pet.until = 0;
    }
    if (pet.restSince == null) pet.restSince = now;
    if (now - pet.restSince > REST_LONG_MS && now >= pet.until) {
      const nap = rng() < NAP_CHANCE;
      pet.act = nap ? 'nap' : 'stretch';
      pet.until = now + (nap ? NAP_MS : STRETCH_MS);
      pet.moving = false;
      pet.restSince = now;
      continue;
    }

    // 산책 — 목적지까지 걷고, 닿으면 잠깐 쉬었다 새 목적지를 고른다
    pet.act = 'walk';
    if (now < pet.until) {
      pet.moving = false;
      continue;
    }
    const was = { x: pet.x, y: pet.y };
    if (advance(pet, step, NEAR, speed * (pet.dash ? RUN_MULT : 1))) {
      pet.moving = false;
      pet.dash = false;
      pet.until = now + REST_MIN + rng() * REST_SPAN;
      aim(pet, area, rng, world);
    } else {
      leaveTrack(world, pet, Math.abs(pet.x - was.x) + Math.abs(pet.y - was.y), now);
    }
  }

  // 자국은 제 시간이 지나면 지운다. 게가 사라져도 그 자국은 남아 흐려진다.
  if (world.tracks.length) world.tracks = world.tracks.filter((k) => now - k.t0 < TRACK_MS);

  // 아래에 있는 게를 나중에 그려야 앞에 온다 — 세로로도 다니게 된 뒤로 이 순서가 곧 원근이다
  return [...world.pets.values()].sort((a, b) => a.y - b.y || (a.key < b.key ? -1 : 1));
}

// 지금 화면에 남아 있는 발자국. 그리는 쪽은 이것만 보면 된다.
export function strollTracks(world, now, ttl = TRACK_MS) {
  return (world.tracks ?? []).map((k) => ({ ...k, fade: Math.max(0, 1 - (now - k.t0) / ttl) }));
}

// 목적지로 한 걸음. 닿았으면 true.
//
// 축마다 속도가 다르므로 **방향은 거리로 정하고 속도는 축이 정한다.** x가 먼저 닿으면 남는
// 것은 세로 성분뿐이라 그 뒤로는 위아래로만 걷는다 — 대각선이 한 번 꺾이지만, 세로로도
// 가로 속도로 내달리는 것보다 걸음으로 읽힌다.
function advance(pet, step, near, speed = 1) {
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
  const mx = (dx / dist) * SPEED_X * speed * step;
  const my = (dy / dist) * SPEED_Y * speed * step;
  // 한 걸음이 남은 거리보다 크면 목적지에 딱 맞춘다 — 넘어갔다 돌아오면 그 자리에서 떤다
  pet.x += Math.abs(mx) > Math.abs(dx) ? dx : mx;
  pet.y += Math.abs(my) > Math.abs(dy) ? dy : my;
  pet.moving = true;
  return false;
}

// 다음 목적지. **너무 가까운 곳은 고르지 않는다** — 한 걸음 걷고 멈추기를 반복하면
// 걷는 것이 아니라 떠는 것으로 보인다.
function aim(pet, area, rng = Math.random, world = null) {
  // 가끔 달린다. **목적지를 고를 때 정한다** — 걷는 도중에 갑자기 빨라지면 걸음이 아니라
  // 화면이 끊긴 것으로 보인다.
  pet.dash = rng() < RUN_CHANCE;

  // 가끔 **다른 게를 찾아간다.** 각자 아무 데나 다니면 넓은 화면에서 마주칠 일이 없어
  // 잡담도 술래잡기도 일어나지 않는다 — 만남은 기다릴 것이 아니라 만들 것이다.
  if (world && rng() < VISIT_CHANCE) {
    const others = [...world.pets.values()].filter((p) => p !== pet && p.act !== 'sink' && p.act !== 'warp');
    if (others.length) {
      const mate = others[Math.min(others.length - 1, Math.floor(rng() * others.length))];
      pet.gx = Math.min(Math.max(mate.x + (rng() < 0.5 ? -12 : 12), area.x0), area.x1);
      pet.gy = Math.min(Math.max(mate.y, area.y0), area.y1);
      return;
    }
  }

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

export const STROLL_TUNING = { SPEED_X, SPEED_Y, EDGE_X, EDGE_TOP, EDGE_BOTTOM, OPEN_MS, SHUT_MS, LAND_MS, DROP_H, SINK_H, HOP_MS };
