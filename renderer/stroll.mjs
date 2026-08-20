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
import { chatLines, slotNow } from './talk.mjs';
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
// 던지기 — 놓는 순간의 커서 속도(논리 px/ms)가 이 문턱을 넘으면 떨어지는 대신 날아간다.
// 그 아래는 여느 놓기(drop)다. 상한은 화면 밖으로 쏘아 보내는 손을 잡는다 — 밖으로 나간
// 게는 가장자리 튕김이 있어도 벽에 몇 번씩 부딪히는 그림이 된다.
const THROW_MIN = 0.35;
const THROW_MAX = 1.1;
// 바닥 속도가 잦아드는 시간 상수 — 0.8px/ms로 던지면 280px쯤 미끄러지고 선다
const THROW_DECAY_MS = 350;
// 공중 높이는 **폴짝 단위**(pet.hop과 같은 눈금)로 잰다 — 몇 px로 그릴지는 그리는 쪽 몫이다.
// 중력을 폴짝 높이(HOP_H=7px)로 나눈 값이라 떨어지는 감은 포탈 낙하와 같다.
const AIR_G = GRAVITY / 7;
// 처음 뜨는 높이(폴짝 단위). 세게 던질수록 높이 뜨되 두 배가 상한이다 —
// 그림자 셈(1 - hop·0.45)이 뒤집히지 않는 한계 안이기도 하다.
const THROW_APEX_MIN = 0.9;
const THROW_APEX_MAX = 2;
// 튕김 — 이 비율로 잦아들고, 이 아래로 약해지면 그대로 선다
const BOUNCE = 0.45;
const BOUNCE_STOP = 0.003;
// 이보다 세게 던져졌으면 착지 후 어지럽다
const THROW_DIZZY = 0.7;
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
// 명령받은 자리에 여럿이 설 때 벌어지는 간격 — 한 점으로 보내면 겹쳐 서서 몇 마리인지 안 보인다
const ORDER_SPREAD = 15;
// 폴짝. 잡히거나 반가울 때 한 번 뛴다. **얼마나 뜨는지는 여기서 안 정한다** —
// `pet.hop`은 0에서 1까지의 정도이고, 몇 px로 그릴지는 그리는 쪽이 안다(stroll-view의 HOP_H).
const HOP_MS = 380;
// 쉬는 모습 — 할 일 없이 이만큼 지나면 기지개를 켜거나 잠깐 존다
// 26초로 두었더니 걷는 중간중간 자꾸 기지개가 나와, 산책이 아니라 몸풀기가 됐다
const REST_LONG_MS = 62_000;
const STRETCH_MS = 1300;
const NAP_MS = 9000;
const NAP_CHANCE = 0.45;
// 쉬는 모습은 시간대를 탄다 — 구간 이름은 talk.mjs의 slotNow에서 온다(렌더러가 시각 경계를
// 따로 들면 한쪽만 고치는 일이 생긴다). 심야에는 더 자주(문턱이 짧고) 더 깊이(존다) 쉬고,
// 점심·오후에는 기지개 대신 캔을 홀짝이기도 한다 — 자판기 앞 풍경의 산책판이다.
const NIGHT_SLOTS = ['night', 'lateNight'];
const SIP_SLOTS = ['lunch', 'afternoon'];
const REST_LONG_NIGHT_MS = 34_000;
const NAP_CHANCE_NIGHT = 0.8;
const SIP_CHANCE = 0.5;
const SIP_MS = 5200;
// ── 에러코드 악당. 가끔 포탈에서 나타나 쉬는 게들을 습격하는 **연출 이벤트**다 —
// 일하는·기다리는 게는 표적이 아니고, 공격당한 게도 일이 들어오면 즉시 복구된다.
// 걷지 않고 떠다닌다(다리가 없다). 놀이 도구와 같은 공용 쿨다운을 쓰고 동시에 안 뜬다.
export const VILLAIN_KEY = '__villain';
const VILLAIN_CHANCE = 0.0006;
const VILLAIN_MAX_MS = 22_000; // 이걸 버티면 제풀에 포탈로 도망간다
const VILLAIN_HP = 4; // 종이에 세 대 맞으면(hp 1) 망치 피니셔가 배정된다
const VILLAIN_GLIDE = 0.03;
const VILLAIN_DASH = 0.11;
const RAGE_MS = 6000; // 난동이 이만큼 이어지면 게들이 반격을 시작한다
const ATTACK_GAP_MIN = 1400;
const ATTACK_GAP_SPAN = 1400;
// 돌진 — 조준하며 부들부들(aim) → 내달린다(dash). 경로에 걸린 게는 던지기 물리로 날아간다.
const CHARGE_AIM_MS = 650;
const CHARGE_HIT = 9;
const KNOCK_V = 0.55;
// 글리치 빔 — 파편 하나가 날아가고, 맞은 게는 잠깐 화면이 찢어진다
const SHOT_V = 0.13;
const SHOT_HIT = 7;
const SHOT_TTL = 2400;
const GLITCH_MS = 2600;
// 버그 뿌리기 — 지나간 자리에 남고, 게가 밟기 직전 기겁하며 폴짝 피한다
const BUGS_MS = 2600;
const BUG_GAP = 9;
const BUG_TTL = 7000;
const BUG_NEAR = 10;
// 반격 — 종이 뭉치 투척과 망치 피니셔. 무기는 게 옆에 톡 열리는 미니 포탈로 온다.
const PAPER_V = 0.2;
const PAPER_HIT = 8;
const PAPER_GAP_MIN = 2000;
const PAPER_GAP_SPAN = 1000;
const ARM_FX_MS = 700;
const SWING_MS = 420;
const KO_MS = 700; // 납작해져 있는 시간 — 바로 가라앉으면 맞은 것이 아니라 꺼진 것이 된다

// ── 미니 포탈 소환. 놀이 도구는 게가 오가는 것과 **같은 문**으로 온다 — 이 화면의 물건이
// 나타나는 길은 포탈 하나뿐이라야 세계가 안 갈라진다. 도구는 놀고 나면 같은 구멍으로 반납된다.
//
// 쿨다운은 도구 공용이다 — 공이 걷히자마자 러그가 내려오면 바탕화면이 서커스가 된다.
const PLAY_COOL_MS = 90_000;
const PROP_DROP_H = 22;
// 비치볼 — 쉬는 둘이 공을 소환해 주고받는다. 차는 쪽이 걸어가 차고, 받는 쪽은 서서 본다.
const BALL_CHANCE = 0.0025; // 프레임마다 (모두 쉴 때 30fps 기준 십몇 초에 한 번)
const BALL_KICKS_MAX = 6;
const BALL_MAX_MS = 26_000;
const BALL_DECAY_MS = 520; // 찬 공이 미끄러지는 시간 상수 — 세기는 거리에서 역산한다
const BALL_V_MAX = 0.22;
const BALL_LIFT = 0.011; // 차인 공이 뜨는 세기(폴짝 단위) — 튀지 않는 공은 공이 아니라 돌이다
const KICK_NEAR = 6;
const BALL_STOP = 0.008;
// 피크닉 — 셋 이상 쉬면 러그와 간식이 내려오고, 둘레에 둘러서서 담소한다
const GATHER_CHANCE = 0.0012;
const GATHER_MIN = 3;
const GATHER_MAX = 5;
const GATHER_MS = 16_000;
// 둘레에 서는 거리 — 게 몸(반폭 8·키 13)이 러그(26×7, 중심 앵커)를 안 덮는 최소치다.
// 좁게 세웠더니 앞에 선 게 하나가 러그를 통째로 가렸다(굽어서 확인).
const GATHER_RX = 22;
const GATHER_RY = 17;

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
  // pet에 딸리지 않고 세계가 들고 있는다. props는 포탈로 소환된 놀이 도구,
  // villain은 에러코드 악당(한 번에 하나), bugs는 악당이 흘린 버그다.
  return { pets: new Map(), tracks: [], props: [], villain: null, bugs: [], playCool: 0, w: 0, h: 0 };
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
  // 붙박인 게는 놀이에 안 낀다 — 놀이는 자리를 옮기는데 머물라는 명령이 먼저다.
  // 공놀이·피크닉에 붙잡힌 게, 무기를 든 게(악당과 싸우는 중)도 겹으로 안 끼운다.
  if (pet.talk || pet.chase || pet.order || pet.stay || pet.playBall || pet.gathering || pet.armed) return false;
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

// ── 소환된 도구의 한살이. state는 셋이다: 포탈에서 떨어지는 중(in) → 노는 중(live) →
// 포탈로 돌아가는 중(out). 게의 warp/sink와 같은 시간표(portalOpen)를 쓴다.

function clampBox(v, lo, hi) {
  return Math.min(Math.max(v, lo), hi);
}

// 이 게가 지금 놀이(또는 싸움)를 계속할 수 있나 — 일·명령·손이 끼어들면 못 한다.
// (chat·sip은 피크닉 손님이 러그 앞에서 짓는 모습이라 놀이의 일부고, 기지개·낮잠은
// 잠깐 쉬는 것이라 자격이 끊기지 않는다 — 끊으면 쉴 때마다 무기를 뺏었다 다시 준다)
const PLAYABLE_ACTS = new Set(['walk', 'look', 'hop', 'chat', 'sip', 'stretch', 'nap']);

function canPlay(world, live, key) {
  const pet = world.pets.get(key);
  if (!pet) return false;
  const entry = live.get(key);
  if (!entry || wantAct(entry.worker) !== 'walk') return false;
  if (pet.order || pet.stay) return false;
  return PLAYABLE_ACTS.has(pet.act);
}

// 도구를 반납한다 — 그 자리에 포탈이 다시 열리고 도구가 가라앉는다. 붙잡힌 게들은 풀린다.
function endProp(world, prop, now) {
  if (prop.state === 'out') return;
  prop.state = 'out';
  prop.warpAt = now;
  prop.portalY = prop.y;
  prop.rvx = 0;
  prop.rvy = 0;
  prop.vz = 0;
  prop.air = 0;
  for (const key of prop.players ?? []) {
    const p = world.pets.get(key);
    if (p) p.playBall = false;
  }
  for (const key of prop.guests ?? []) {
    const p = world.pets.get(key);
    if (!p) continue;
    p.gathering = false;
    if (p.act === 'chat' || p.act === 'sip') p.act = 'walk';
  }
}

// 쉬는 둘이 공을 소환한다 — 둘 사이 어디쯤에 미니 포탈이 열리고 공이 떨어진다.
function startBall(world, live, now, rng, area) {
  if (world.props.length || world.villain || now < world.playCool) return;
  if (rng() >= BALL_CHANCE) return;
  const idle = [...world.pets.values()].filter((p) => freeToPlay(p, live, now));
  if (idle.length < 2) return;
  const a = idle[Math.floor(rng() * idle.length) % idle.length];
  const rest = idle.filter((p) => p !== a);
  const b = rest[Math.floor(rng() * rest.length) % rest.length];
  if (!a || !b) return;
  const gy = clampBox((a.y + b.y) / 2, area.y0 + PROP_DROP_H, area.y1 - 4);
  world.props.push({
    kind: 'ball',
    state: 'in',
    x: clampBox((a.x + b.x) / 2 + (rng() - 0.5) * 30, area.x0 + 12, area.x1 - 12),
    y: gy - PROP_DROP_H,
    gy,
    portalY: gy - PROP_DROP_H,
    vy: 0,
    warpAt: now,
    portal: 0,
    born: now,
    players: [a.key, b.key],
    turn: 0,
    kicks: 0,
    rvx: 0,
    rvy: 0,
    vz: 0,
    air: 0,
  });
  a.playBall = true;
  b.playBall = true;
}

// 셋 이상 쉬면 피크닉 — 러그가 내려오고, 손님마다 둘레의 제 자리가 정해진다.
function startGather(world, live, now, rng, area) {
  if (world.props.length || world.villain || now < world.playCool) return;
  if (rng() >= GATHER_CHANCE) return;
  const idle = [...world.pets.values()].filter((p) => freeToPlay(p, live, now));
  if (idle.length < GATHER_MIN) return;
  const guests = idle.slice(0, GATHER_MAX);
  const cx = guests.reduce((s, p) => s + p.x, 0) / guests.length;
  const cy = guests.reduce((s, p) => s + p.y, 0) / guests.length;
  const x = clampBox(cx, area.x0 + GATHER_RX + 12, area.x1 - GATHER_RX - 12);
  const gy = clampBox(cy, area.y0 + PROP_DROP_H + GATHER_RY, area.y1 - GATHER_RY - 2);
  const spots = {};
  guests.forEach((p, i) => {
    // 위(-π/2)에서 시작해 고르게 두른다 — 러그 뒤쪽부터 채워야 앞이 덜 가려진다
    const ang = -Math.PI / 2 + (i / guests.length) * Math.PI * 2;
    spots[p.key] = {
      gx: clampBox(x + Math.cos(ang) * GATHER_RX, area.x0, area.x1),
      gy: clampBox(gy + Math.sin(ang) * GATHER_RY, area.y0, area.y1),
    };
    p.gathering = true;
  });
  world.props.push({
    kind: 'rug',
    state: 'in',
    x,
    y: gy - PROP_DROP_H,
    gy,
    portalY: gy - PROP_DROP_H,
    vy: 0,
    warpAt: now,
    portal: 0,
    born: now,
    guests: guests.map((p) => p.key),
    spots,
    until: now + GATHER_MS,
  });
}

// 공이 서 있나 — 서 있어야 차례인 게가 다가가 찬다. 구르는 공을 쫓아가 차면 헛발질 루프가 된다.
function ballStopped(prop) {
  return prop.air <= 0 && prop.vz === 0 && Math.hypot(prop.rvx, prop.rvy) < BALL_STOP;
}

// 뻥 — 상대 쪽으로 찬다. 세기는 거리에서 역산하므로 대충 상대 앞에 가서 선다.
function kickBall(world, ball, kicker, rng) {
  const mateKey = ball.players.find((k) => k !== kicker.key);
  const mate = world.pets.get(mateKey);
  const dx = (mate?.x ?? ball.x) + (rng() - 0.5) * 26 - ball.x;
  const dy = (mate?.y ?? ball.y) + (rng() - 0.5) * 14 - ball.y;
  const h = Math.hypot(dx, dy) || 1;
  const v = Math.min(BALL_V_MAX, Math.max(24, h) / BALL_DECAY_MS);
  ball.rvx = (dx / h) * v;
  ball.rvy = (dy / h) * v;
  ball.vz = BALL_LIFT;
  ball.air = 0.01;
  ball.turn = ball.players.indexOf(mateKey);
  ball.kicks++;
}

// 도구 한 프레임 — 포탈 시간표, 낙하, 구르기, 끝낼 때 판정.
function stepProps(world, live, { now, step, area }) {
  for (const prop of [...world.props]) {
    if (prop.warpAt != null) {
      prop.portal = portalOpen(now - prop.warpAt);
      if (prop.portal <= 0 && prop.state === 'live') prop.warpAt = null;
    }

    // 붙잡힌 게들의 사정이 먼저다 — 일이 들어온 선수·손님은 즉시 빠진다
    if (prop.state !== 'out') {
      if (prop.kind === 'ball' && !prop.players.every((k) => canPlay(world, live, k))) {
        endProp(world, prop, now);
      } else if (prop.kind === 'rug') {
        const stayed = prop.guests.filter((k) => canPlay(world, live, k));
        if (stayed.length !== prop.guests.length) {
          for (const key of prop.guests) {
            if (stayed.includes(key)) continue;
            const p = world.pets.get(key);
            if (p) p.gathering = false;
          }
          prop.guests = stayed;
        }
        if (stayed.length < 2 || now >= prop.until) endProp(world, prop, now);
      }
    }

    if (prop.state === 'in') {
      // 포탈이 다 열린 뒤에 떨어진다 — 게의 등장과 같은 순서다
      if (now - prop.warpAt >= PORTAL_OPEN_MS) {
        prop.vy += GRAVITY * step;
        prop.y += prop.vy * step;
        if (prop.y >= prop.gy) {
          prop.y = prop.gy;
          prop.vy = 0;
          prop.state = 'live';
        }
      }
      continue;
    }

    if (prop.state === 'live' && prop.kind === 'ball') {
      const f = Math.exp(-step / BALL_DECAY_MS);
      prop.x += prop.rvx * BALL_DECAY_MS * (1 - f);
      prop.y += prop.rvy * BALL_DECAY_MS * (1 - f);
      prop.rvx *= f;
      prop.rvy *= f;
      if (prop.x < area.x0 || prop.x > area.x1) {
        prop.x = clampBox(prop.x, area.x0, area.x1);
        prop.rvx = -prop.rvx * 0.7;
      }
      if (prop.y < area.y0 || prop.y > area.y1) {
        prop.y = clampBox(prop.y, area.y0, area.y1);
        prop.rvy = -prop.rvy * 0.7;
      }
      // 통통 — 차일 때 받은 수직 속도가 튕기며 잦아든다
      prop.air += prop.vz * step;
      prop.vz -= AIR_G * step;
      if (prop.air <= 0) {
        prop.air = 0;
        prop.vz = prop.vz < 0 ? -prop.vz * 0.5 : 0;
        if (prop.vz < 0.002) prop.vz = 0;
      }
      if ((prop.kicks >= BALL_KICKS_MAX && ballStopped(prop)) || now - prop.born > BALL_MAX_MS) endProp(world, prop, now);
      continue;
    }

    if (prop.state === 'out') {
      // 게의 sink와 같은 결 — 구멍이 열린 뒤 잠기고, 구멍이 닫히면 사라진다
      const age = now - prop.warpAt;
      if (age >= PORTAL_OPEN_MS) prop.y = Math.min(prop.portalY + SINK_H * 0.6, prop.y + SINK_SPEED * step);
      if (age > PORTAL_OPEN_MS && prop.portal <= 0) {
        world.props.splice(world.props.indexOf(prop), 1);
        world.playCool = now + PLAY_COOL_MS;
      }
    }
  }
}

// ── 에러코드 악당의 한살이. 포탈에서 떨어져(in) 난동을 부리고(live), 게들의 반격이나
// 사용자의 던지기에 납작해져(ko) 같은 포탈로 반납된다(sink). 시간을 다 쓰면 그냥 도망간다.

function startVillain(world, live, now, rng, area) {
  if (world.villain || world.props.length || now < world.playCool) return;
  if (rng() >= VILLAIN_CHANCE) return;
  const targets = [...world.pets.values()].filter((p) => canPlay(world, live, p.key));
  if (!targets.length) return;
  const top = Math.min(area.y0 + DROP_H, (area.y0 + area.y1) / 2);
  const gy = top + rng() * Math.max(0, area.y1 - top);
  world.villain = {
    state: 'in',
    x: clampBox(area.x0 + 20 + rng() * Math.max(1, area.x1 - area.x0 - 40), area.x0, area.x1),
    y: gy - DROP_H,
    gy,
    portalY: gy - DROP_H,
    vy: 0,
    warpAt: now,
    portal: 0,
    born: now,
    hp: VILLAIN_HP,
    dir: 1,
    mode: null,
    nextAt: 0,
    shots: [],
    papers: [],
    flinch: 0,
    shake: 0,
    hammerKey: null,
    koAt: 0,
  };
}

// 무기와 표적 표시를 걷는다 — 악당이 물러가는 모든 길이 여기를 지난다
function clearFighters(world) {
  for (const pet of world.pets.values()) {
    pet.armed = null;
    pet.armFx = 0;
  }
  if (world.villain) world.villain.hammerKey = null;
}

// 납작 — 맞아서 나가는 길. KO_MS 동안 눌려 있다가 포탈로 가라앉는다.
function koVillain(world, vil, now) {
  vil.state = 'ko';
  vil.koAt = now;
  vil.mode = null;
  vil.hp = 0;
  clearFighters(world);
}

// 도망 — 제 시간을 다 썼거나 때릴 게가 없다. 납작해지지 않고 곧장 구멍으로 사라진다.
function fleeVillain(world, vil, now) {
  vil.state = 'sink';
  vil.warpAt = now;
  vil.portalY = vil.y;
  vil.mode = null;
  clearFighters(world);
}

// 사용자가 잡아 던졌다 — 던지기 물리로 구르다 서면 납작해져 반납된다(즉시 격퇴).
// 살살 놓으면(문턱 아래) 아무것도 안 해서 held → drop으로 처졌다가 다시 난동을 부린다.
export function throwVillain(world, vx, vy) {
  const vil = world.villain;
  if (!vil || vil.state !== 'held') return false;
  const speed = Math.hypot(vx, vy);
  if (speed < THROW_MIN) return false;
  const k = Math.min(1, THROW_MAX / speed);
  vil.state = 'toss';
  vil.tvx = vx * k;
  vil.tvy = vy * k;
  vil.air = 0;
  vil.vz = Math.sqrt(2 * THROW_APEX_MAX * AIR_G);
  vil.mode = null;
  clearFighters(world);
  return true;
}

// 악당 클릭 판정 — 게보다 먼저 짚는다(stroll-app). 스프라이트(12×10)보다 넉넉하다.
export function villainAt(world, px, py, scale = 2) {
  const vil = world.villain;
  if (!vil || (vil.state !== 'live' && vil.state !== 'held' && vil.state !== 'drop')) return false;
  const w = 26 * scale;
  const h = 24 * scale;
  const x = vil.x * scale;
  const y = vil.y * scale;
  return px >= x - w / 2 && px <= x + w / 2 && py >= y - h && py <= y + 6 * scale;
}

// 다음 공격을 고른다 — 셋 중 하나를 난수로.
function pickAttack(vil, targets, now, rng, area) {
  const kind = ['charge', 'beam', 'bugs'][Math.min(2, Math.floor(rng() * 3))];
  const mate = targets[Math.floor(rng() * targets.length) % targets.length];
  if (kind === 'charge') vil.mode = { kind, phase: 'aim', until: now + CHARGE_AIM_MS, key: mate.key };
  else if (kind === 'beam') vil.mode = { kind, until: now + 500, key: mate.key };
  else
    vil.mode = {
      kind,
      until: now + BUGS_MS,
      gx: area.x0 + rng() * (area.x1 - area.x0),
      gy: area.y0 + rng() * (area.y1 - area.y0),
      trail: 0,
    };
}

function clampVil(vil, area) {
  vil.x = clampBox(vil.x, area.x0, area.x1);
  vil.y = clampBox(vil.y, area.y0, area.y1);
}

function runAttack(world, live, vil, now, step, area, rng) {
  const m = vil.mode;
  if (m.kind === 'charge') {
    if (m.phase === 'aim') {
      vil.shake = 1; // 부들부들 — 그리는 쪽이 이 값으로 떤다
      const t = world.pets.get(m.key);
      if (t) vil.dir = t.x > vil.x ? 1 : -1;
      if (now >= m.until) {
        vil.shake = 0;
        if (!t) {
          vil.mode = null;
          vil.nextAt = now + 600;
          return;
        }
        // 조준이 끝난 순간의 자리로 내달린다 — 그 사이 걸은 만큼은 빗나간다(그게 재미다)
        const dx = t.x - vil.x;
        const dy = t.y - vil.y;
        const h = Math.hypot(dx, dy) || 1;
        m.phase = 'dash';
        m.vx = (dx / h) * VILLAIN_DASH;
        m.vy = (dy / h) * VILLAIN_DASH;
        m.until = now + Math.min(1400, h / VILLAIN_DASH + 260);
      }
      return;
    }
    vil.x += m.vx * step;
    vil.y += m.vy * step;
    if (vil.x < area.x0 || vil.x > area.x1 || vil.y < area.y0 || vil.y > area.y1) {
      clampVil(vil, area);
      m.until = now; // 벽에 박으면 거기서 끝
    }
    // 경로에 걸린 쉬는 게는 날아간다 — 박치기는 던지기와 같은 물리다
    for (const pet of world.pets.values()) {
      if (!canPlay(world, live, pet.key)) continue;
      if (Math.hypot(pet.x - vil.x, pet.y - vil.y) < CHARGE_HIT)
        knockPet(pet, m.vx * (KNOCK_V / VILLAIN_DASH), m.vy * (KNOCK_V / VILLAIN_DASH), { dizzy: true });
    }
    if (now >= m.until) {
      vil.mode = null;
      vil.nextAt = now + ATTACK_GAP_MIN + rng() * ATTACK_GAP_SPAN;
    }
    return;
  }
  if (m.kind === 'beam') {
    const t = world.pets.get(m.key);
    if (t) vil.dir = t.x > vil.x ? 1 : -1;
    if (now >= m.until) {
      if (t) {
        const dx = t.x - vil.x;
        const dy = t.y - 6 - (vil.y - 6);
        const h = Math.hypot(dx, dy) || 1;
        vil.shots.push({ x: vil.x, y: vil.y - 6, vx: (dx / h) * SHOT_V, vy: (dy / h) * SHOT_V, age: 0 });
      }
      vil.mode = null;
      vil.nextAt = now + ATTACK_GAP_MIN + rng() * ATTACK_GAP_SPAN;
    }
    return;
  }
  // bugs — 목적지로 흘러가며 버그를 흘린다
  const dx = m.gx - vil.x;
  const dy = m.gy - vil.y;
  const h = Math.hypot(dx, dy);
  if (h > 2) {
    const mx = (dx / h) * VILLAIN_GLIDE * 1.6 * step;
    const my = (dy / h) * VILLAIN_GLIDE * 1.1 * step;
    vil.x += mx;
    vil.y += my;
    vil.dir = dx > 0 ? 1 : -1;
    m.trail += Math.abs(mx) + Math.abs(my);
    if (m.trail >= BUG_GAP) {
      m.trail = 0;
      world.bugs.push({ x: vil.x + (rng() - 0.5) * 6, y: vil.y + 1, t0: now });
      if (world.bugs.length > 40) world.bugs.splice(0, world.bugs.length - 40);
    }
  }
  if (now >= m.until || h <= 2) {
    vil.mode = null;
    vil.nextAt = now + ATTACK_GAP_MIN + rng() * ATTACK_GAP_SPAN;
  }
}

// 글리치 파편 — 맞은 게는 잠깐 화면이 찢어진다(act glitch, 그리는 쪽이 세 조각으로 어긋낸다)
function stepShots(world, live, vil, now, step, area) {
  if (!vil.shots.length) return;
  vil.shots = vil.shots.filter((s) => {
    s.age += step;
    s.x += s.vx * step;
    s.y += s.vy * step;
    if (s.age > SHOT_TTL || s.x < area.x0 - 4 || s.x > area.x1 + 4 || s.y < 0 || s.y > area.y1 + 4) return false;
    for (const pet of world.pets.values()) {
      if (!canPlay(world, live, pet.key)) continue;
      if (Math.hypot(pet.x - s.x, pet.y - 6 - s.y) < SHOT_HIT) {
        pet.act = 'glitch';
        pet.glitchUntil = now + GLITCH_MS;
        pet.armed = null;
        pet.moving = false;
        return false;
      }
    }
    return true;
  });
}

// 종이 뭉치 — 맞을 때마다 악당이 움찔 밀리고 체력이 준다. 바닥은 1 — 마지막 한 방은 망치 몫이다.
function stepPapers(world, vil, now, step) {
  if (!vil.papers.length) return;
  vil.papers = vil.papers.filter((p) => {
    p.age += step;
    p.x += p.vx * step;
    p.y += p.vy * step;
    if (p.age > p.ttl) return false;
    if (vil.state === 'live' && Math.hypot(vil.x - p.x, vil.y - 5 - p.y) < PAPER_HIT) {
      vil.hp = Math.max(1, vil.hp - 1);
      vil.flinch = 1;
      vil.x += p.vx * 30; // 얻어맞은 쪽으로 살짝 밀린다
      vil.y += p.vy * 30;
      return false;
    }
    return true;
  });
}

// 반격 — 쉬는 게마다 옆에 미니 포탈이 톡 열리며 종이 뭉치를 받고, 체력이 바닥나면
// 가장 가까운 게가 망치를 받는다. 자격을 잃은 게(일·명령·손)는 그 자리에서 무장 해제된다.
function armFighters(world, live, vil, now, rng) {
  for (const pet of world.pets.values()) {
    if (!canPlay(world, live, pet.key)) {
      pet.armed = null;
      pet.armFx = 0;
      continue;
    }
    if (!pet.armed) pet.armed = { kind: 'paper', at: now, nextAt: now + 500 + rng() * PAPER_GAP_SPAN };
    // 소환 포탈의 진행도 — 그리는 쪽 시계(rAF)와 이곳(Date.now)이 달라 여기서 셈해 넘긴다
    pet.armFx = Math.min(1, (now - pet.armed.at) / ARM_FX_MS);
    // 자는·기지개 켜는 중에는 던지지 않는다 — 무기만 쥔 채 쉰다
    if (pet.armed.kind === 'paper' && now >= pet.armed.nextAt && vil.state === 'live' && pet.act !== 'nap' && pet.act !== 'stretch') {
      const dx = vil.x - pet.x;
      const dy = vil.y - 5 - (pet.y - 8);
      const h = Math.hypot(dx, dy) || 1;
      vil.papers.push({ x: pet.x, y: pet.y - 8, vx: (dx / h) * PAPER_V, vy: (dy / h) * PAPER_V, age: 0, ttl: h / PAPER_V + 300 });
      pet.armed.nextAt = now + PAPER_GAP_MIN + rng() * PAPER_GAP_SPAN;
      pet.dir = dx > 0 ? 1 : -1;
      if (pet.act === 'walk') {
        pet.act = 'hop'; // 던지는 반동
        pet.hopAt = now;
        pet.hop = 0;
      }
    }
  }
  // 망치는 한 자루 — 맡은 게가 자격을 잃으면 걷고 다음 프레임에 다시 고른다
  if (vil.hammerKey && !canPlay(world, live, vil.hammerKey)) vil.hammerKey = null;
  if (vil.hp <= 1 && !vil.hammerKey) {
    let best = null;
    for (const pet of world.pets.values()) {
      if (!canPlay(world, live, pet.key)) continue;
      const d = Math.hypot(pet.x - vil.x, pet.y - vil.y);
      if (!best || d < best.d) best = { pet, d };
    }
    if (best) {
      vil.hammerKey = best.pet.key;
      best.pet.armed = { kind: 'hammer', at: now, nextAt: 0 };
    }
  }
}

// 악당 한 프레임.
function stepVillain(world, live, { now, step, area, rng, drag }) {
  // 버그는 악당이 사라져도 제 시간까지 남는다
  if (world.bugs.length) world.bugs = world.bugs.filter((b) => now - b.t0 < BUG_TTL);
  const vil = world.villain;
  if (!vil) return;

  if (vil.warpAt != null) {
    vil.portal = portalOpen(now - vil.warpAt);
    if (vil.portal <= 0 && vil.state === 'live') vil.warpAt = null;
  }

  // 손에 잡힌 동안 — 난동이 멈춘다. 던져야 나가고, 살살 놓으면 다시 일어난다.
  if (drag && drag.key === VILLAIN_KEY && (vil.state === 'live' || vil.state === 'held' || vil.state === 'drop')) {
    vil.state = 'held';
    vil.x = drag.x;
    vil.y = drag.y;
    vil.mode = null;
    vil.shake = 0;
    return;
  }
  if (vil.state === 'held') {
    vil.state = 'drop';
    vil.vy = 0;
    vil.gy = Math.min(area.y1, vil.y + DROP_SHORT);
    vil.x = clampBox(vil.x, area.x0, area.x1);
  }
  if (vil.state === 'drop') {
    vil.vy += GRAVITY * step;
    vil.y += vil.vy * step;
    if (vil.y >= vil.gy) {
      vil.y = vil.gy;
      vil.vy = 0;
      vil.state = 'live';
      vil.nextAt = now + 900;
    }
    return;
  }
  if (vil.state === 'in') {
    if (now - vil.warpAt >= PORTAL_OPEN_MS) {
      vil.vy += GRAVITY * step;
      vil.y += vil.vy * step;
      if (vil.y >= vil.gy) {
        vil.y = vil.gy;
        vil.vy = 0;
        vil.state = 'live';
        vil.nextAt = now + 800;
      }
    }
    return;
  }
  if (vil.state === 'toss') {
    const f = Math.exp(-step / THROW_DECAY_MS);
    vil.x += vil.tvx * THROW_DECAY_MS * (1 - f);
    vil.y += vil.tvy * THROW_DECAY_MS * (1 - f);
    vil.tvx *= f;
    vil.tvy *= f;
    if (vil.x < area.x0 || vil.x > area.x1) {
      vil.x = clampBox(vil.x, area.x0, area.x1);
      vil.tvx = -vil.tvx * 0.7;
    }
    if (vil.y < area.y0 || vil.y > area.y1) {
      vil.y = clampBox(vil.y, area.y0, area.y1);
      vil.tvy = -vil.tvy * 0.7;
    }
    vil.air = (vil.air ?? 0) + vil.vz * step;
    vil.vz -= AIR_G * step;
    if (vil.air <= 0) {
      vil.air = 0;
      vil.vz = vil.vz < 0 ? -vil.vz * BOUNCE : 0;
      if (vil.vz < BOUNCE_STOP) vil.vz = 0;
    }
    if (vil.air <= 0 && vil.vz === 0 && Math.hypot(vil.tvx, vil.tvy) < 0.02) koVillain(world, vil, now);
    return;
  }
  if (vil.state === 'ko') {
    if (now - vil.koAt >= KO_MS) {
      vil.state = 'sink';
      vil.warpAt = now;
      vil.portalY = vil.y;
    }
    return;
  }
  if (vil.state === 'sink') {
    const age = now - vil.warpAt;
    if (age >= PORTAL_OPEN_MS) vil.y = Math.min(vil.portalY + SINK_H * 0.7, vil.y + SINK_SPEED * step);
    if (age > PORTAL_OPEN_MS && vil.portal <= 0) {
      world.villain = null;
      world.playCool = now + PLAY_COOL_MS;
    }
    return;
  }

  // ── live
  vil.flinch = Math.max(0, vil.flinch - step / 260);
  stepShots(world, live, vil, now, step, area);
  stepPapers(world, vil, now, step);

  const targets = [...world.pets.values()].filter((p) => canPlay(world, live, p.key));
  if (!targets.length || now - vil.born > VILLAIN_MAX_MS) {
    fleeVillain(world, vil, now);
    return;
  }
  if (now - vil.born > RAGE_MS) armFighters(world, live, vil, now, rng);
  if (!vil.mode && now >= vil.nextAt) pickAttack(vil, targets, now, rng, area);
  if (vil.mode) runAttack(world, live, vil, now, step, area, rng);
}

// 지금 화면의 버그들 — 그리는 쪽은 이것만 본다(발자국과 같은 결).
export function strollBugs(world, now) {
  return (world.bugs ?? []).map((b) => ({ ...b, fade: Math.max(0, 1 - (now - b.t0) / BUG_TTL) }));
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

// ── 지휘 (Ctrl+Shift로 고르고 우클릭으로 보낸다)

// 고른 게들을 한 자리로 보낸다. **한 점이 아니라 그 둘레에 흩어 세운다** — 같은 좌표를
// 주면 전부 겹쳐 서서 몇 마리를 보냈는지 화면에서 셀 수 없다.
export function orderMove(world, keys, x, y, w, h) {
  const area = strollArea(w, h);
  const list = [...keys].map((k) => world.pets.get(k)).filter((p) => p && p.act !== 'sink');
  const ring = Math.ceil(Math.sqrt(list.length));
  list.forEach((pet, i) => {
    // 격자로 흩는다 — 원으로 두르면 가운데가 비어 "모였다"로 안 보인다
    const dx = (i % ring) - (ring - 1) / 2;
    const dy = Math.floor(i / ring) - (ring - 1) / 2;
    pet.order = {
      gx: Math.min(Math.max(x + dx * ORDER_SPREAD, area.x0), area.x1),
      gy: Math.min(Math.max(y + dy * ORDER_SPREAD * 0.7, area.y0), area.y1),
    };
    // 명령을 받으면 놀이는 그만둔다 — 부른 곳으로 가는 것이 먼저다
    pet.talk = null;
    pet.chase = null;
    pet.stay = false; // 새 이동 명령이 곧 핀 해제다
    pet.until = 0;
    pet.dash = list.length > 2 || Math.hypot(pet.x - x, pet.y - y) > 120;
  });
  return list.length;
}

// 머물기 — 고른 게들을 지금 향하는(또는 선) 자리에 붙박는다(우클릭을 같은 자리에 두 번).
// 이동 중이면 도착해서 머물고, 도착해 있으면 선 자리에서 머문다. 새 목적지를 안 고를 뿐
// 커서 쳐다보기·쉬기는 그대로다 — 붙박은 게가 조각상이 되면 산책 창이 아니다.
// 풀리는 길은 셋: 다시 이동 명령을 받거나, 손에 집히거나, 일이 들어오거나.
export function pinPets(world, keys) {
  let n = 0;
  for (const k of keys) {
    const pet = world.pets.get(k);
    if (!pet || pet.act === 'sink') continue;
    pet.stay = true;
    n++;
  }
  return n;
}

// 게 하나를 날려 보낸다 — 사용자의 던지기와 악당의 박치기가 같은 물리를 쓴다.
function knockPet(pet, vx, vy, { dizzy = null } = {}) {
  const speed = Math.hypot(vx, vy) || 0.01;
  const k = Math.min(1, THROW_MAX / speed);
  pet.act = 'throw';
  pet.tvx = vx * k;
  pet.tvy = vy * k;
  // 세게 던질수록 높이 뜬다 — 같은 높이로만 뜨면 살살 던진 것과 세게 던진 것이 같은 그림이다
  const apex = Math.min(THROW_APEX_MAX, THROW_APEX_MIN + speed * k);
  pet.hop = 0;
  pet.vz = Math.sqrt(2 * apex * AIR_G);
  pet.hardThrow = dizzy ?? speed * k > THROW_DIZZY;
  pet.lap = 0;
  pet.talk = null;
  pet.chase = null;
  pet.stay = false;
  pet.armed = null;
}

// 손에서 놓는 순간 커서 속도를 실어 던진다(stroll-app의 mouseup). 속도는 논리 px/ms.
//
// 문턱(THROW_MIN)을 못 넘으면 **아무것도 하지 않는다** — 그러면 다음 프레임에 held → drop으로
// 떨어져, 던진 것과 놓은 것이 저절로 갈린다. 문턱이 여기 사는 이유다: 껍데기(stroll-app)가
// 판정까지 들면 테스트가 못 닿는 자리에 물리가 생긴다.
export function throwPet(world, key, vx, vy) {
  const pet = world.pets.get(key);
  if (!pet || pet.act !== 'held') return false;
  if (Math.hypot(vx, vy) < THROW_MIN) return false;
  knockPet(pet, vx, vy);
  pet.shake = 0;
  return true;
}

// 상자 안에 든 게들. 좌표는 논리 단위다.
export function petsInBox(pets, box) {
  const x0 = Math.min(box.x0, box.x1);
  const x1 = Math.max(box.x0, box.x1);
  const y0 = Math.min(box.y0, box.y1);
  const y1 = Math.max(box.y0, box.y1);
  // 게의 몸을 기준으로 본다 — 발끝만 재면 상자로 몸통을 감싸도 안 잡힌다
  return pets.filter((p) => p.x >= x0 - 8 && p.x <= x1 + 8 && p.y >= y0 - 14 && p.y <= y1 + 3);
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
  // 지금이 어느 시간대인가 — 쉬는 모습이 이걸 탄다. 한 프레임에 한 번만 묻는다.
  const slot = slotNow(new Date(now));

  // 새로 온 게 — 모드를 막 켰든 산책 중에 세션이 생겼든 **같은 포탈로 떨어진다**
  for (const [key, entry] of live) {
    if (!world.pets.has(key)) world.pets.set(key, spawn(entry, { w, h, now, rng }));
    else world.pets.get(key).entry = entry;
  }

  const step = Math.min(dt, 64); // 창이 가려졌다 돌아왔을 때 한 프레임에 순간이동하지 않게

  // 놀 짝을 먼저 정한다 — 게 하나씩 도는 아래 루프에서는 둘을 같이 볼 수 없다.
  // 악당이 소환 놀이보다, 소환 놀이가 술래잡기보다 먼저다: 같은 프레임에 여럿 걸리면
  // 드문 쪽이 이겨야 한다. 악당이 있는 동안에는 잡담·술래잡기도 쉰다 — 습격 중의 한가함은
  // 연출이 아니라 버그로 읽힌다.
  startVillain(world, live, now, rng, area);
  startGather(world, live, now, rng, area);
  startBall(world, live, now, rng, area);
  stepProps(world, live, { now, step, area });
  stepVillain(world, live, { now, step, area, rng, drag });
  if (!world.villain) {
    pairChats(world, live, now);
    startChase(world, live, now, rng);
  }

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
      pet.hop = 0; // 날아가는 중에 낚아채면 뜬 높이가 남는다 — 손에 있는 동안 몸이 붕 뜨면 안 된다
      pet.vz = 0;
      pet.stay = false; // 손에 집히면 핀이 풀린다 — 옮겨 놓고도 붙박여 있으면 명령이 유령이 된다
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

    // 던져져 날아가는 중 — 바닥 자리(x·y)는 관성으로 미끄러지고 몸(hop)은 튕기며 잦아든다.
    // 발밑 그림자가 바닥 자리를 따라가므로 "허공을 나는" 게 아니라 "튕기며 미끄러지는" 그림이 된다.
    if (pet.act === 'throw') {
      pet.moving = false;
      // 지수 감쇠의 정적분 — 프레임 길이가 널뛰어도(step 상한 64ms) 궤적이 같다
      const f = Math.exp(-step / THROW_DECAY_MS);
      pet.x += pet.tvx * THROW_DECAY_MS * (1 - f);
      pet.y += pet.tvy * THROW_DECAY_MS * (1 - f);
      pet.tvx *= f;
      pet.tvy *= f;
      // 가장자리에서 튕긴다 — 밖으로 나간 게는 영영 안 보인다
      if (pet.x < area.x0 || pet.x > area.x1) {
        pet.x = Math.min(Math.max(pet.x, area.x0), area.x1);
        pet.tvx = -pet.tvx * 0.7;
      }
      if (pet.y < area.y0 || pet.y > area.y1) {
        pet.y = Math.min(Math.max(pet.y, area.y0), area.y1);
        pet.tvy = -pet.tvy * 0.7;
      }
      // 몸의 포물선(폴짝 단위). 닿을 때마다 잦아드는 만큼만 다시 튄다.
      pet.hop += pet.vz * step;
      pet.vz -= AIR_G * step;
      if (pet.hop <= 0) {
        pet.hop = 0;
        pet.vz = pet.vz < 0 ? -pet.vz * BOUNCE : 0;
        if (pet.vz < BOUNCE_STOP) pet.vz = 0;
      }
      // 다 잦아들면 선다 — 세게 던져졌으면 어지러운 채로
      if (pet.hop <= 0 && pet.vz === 0 && Math.hypot(pet.tvx, pet.tvy) < 0.02) {
        pet.act = 'land';
        pet.until = now + LAND_MS;
        pet.dizzyUntil = pet.hardThrow ? now + LAND_MS + DIZZY_MS : 0;
        pet.hardThrow = false;
      }
      continue;
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

    // 글리치 파편에 맞은 뒤 — 화면이 찢어진 채 부르르 떤다(그리는 쪽이 세 조각으로 어긋낸다).
    // 어지러움과 같은 결: 일이 들어오면 즉시 걷어낸다.
    if (pet.act === 'glitch') {
      const busy = !gone && wantAct(pet.entry.worker) !== 'walk';
      if (busy || now >= pet.glitchUntil) {
        pet.glitchUntil = 0;
        pet.act = 'walk';
        aim(pet, area, rng, world);
      } else {
        pet.moving = false;
        continue;
      }
    }

    // 망치를 내리치는 중 — 반격의 마지막 동작은 악당이 사라져도 끝까지 그린다.
    // 진행도(swingK)를 여기서 셈해 넘긴다: 그리는 쪽 시계(rAF)와 이곳(Date.now)이 다르다.
    if (pet.swingAt) {
      pet.swingK = Math.min(1, (now - pet.swingAt) / SWING_MS);
      if (pet.swingK >= 1) {
        pet.swingAt = 0;
        pet.swingK = 0;
        pet.act = 'hop'; // 해치웠다 — 폴짝
        pet.hopAt = now;
        pet.hop = 0;
      } else {
        pet.act = 'walk';
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

    // 부른 곳으로 가는 중 — **일보다 먼저다.** 일하는 게도 노트북을 접고 걸어가고,
    // 도착하면 아래에서 다시 편다(그동안만 상태가 가려진다).
    if (pet.order) {
      pet.lap = Math.max(0, pet.lap - step / SHUT_MS);
      pet.gx = pet.order.gx;
      pet.gy = pet.order.gy;
      pet.act = 'walk';
      const was = { x: pet.x, y: pet.y };
      if (advance(pet, step, NEAR, speed * (pet.dash ? RUN_MULT : 1))) {
        pet.order = null;
        pet.dash = false;
        pet.moving = false;
        pet.until = now + REST_MIN;
      } else {
        leaveTrack(world, pet, Math.abs(pet.x - was.x) + Math.abs(pet.y - was.y), now);
      }
      continue;
    }

    const want = gone ? 'walk' : wantAct(pet.entry.worker);

    // **놀이는 일 앞에서 즉시 걷힌다.** 일을 받았는데 아직 잡담 중이거나 졸고 있으면
    // 그 세션이 무엇을 하고 있는지가 장난에 가려진다. 폴짝 뛰던 중이면 공중에 뜬 채로
    // 노트북을 펴게 되므로 hop도 같이 걷는다.
    if (
      want !== 'walk' &&
      (pet.talk || pet.chase || pet.act === 'nap' || pet.act === 'stretch' || pet.act === 'sip' || pet.act === 'hop')
    ) {
      pet.talk = null;
      pet.chase = null;
      pet.cheer = false;
      pet.hop = 0;
      if (pet.act === 'nap' || pet.act === 'stretch' || pet.act === 'sip' || pet.act === 'hop') pet.act = 'walk';
    }

    // 노트북 — 일을 받으면 펴고, 일이 끝나면 접는다. **접는 중에도 자리를 뜨지 않는다**
    if (want === 'work') {
      pet.worked = true; // 접었을 때 자축할지 판정하는 표시
      pet.stay = false; // 일이 들어오면 핀이 풀린다 — 일하러 간 게를 붙잡아 둘 이유가 없다
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
      // 접기 끝. 방금까지 일하던 게가 **일을 끝내서** 접은 것이면 그 자리에서 자축한다 —
      // 폴짝 한 번 뛰고 기지개. 곁눈질 화면에서는 이 순간 연출이 곧 "끝났다" 알림이다.
      // 대기·헤맴으로 바뀐 경우(halt)는 끝난 것이 아니라 나를 부르는 것이므로 걷는다.
      const finished = pet.worked && want === 'walk';
      pet.worked = false;
      if (finished) {
        pet.cheer = true; // 폴짝이 끝나면 기지개로 이어진다 — 폴짝만으로는 곁눈질에 안 걸린다
        pet.act = 'hop';
        pet.hopAt = now;
        pet.hop = 0;
        continue;
      }
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
      // 자축의 두 번째 박자 — 내려선 자리에서 기지개를 켜고 나서야 산책으로 돌아간다
      if (pet.cheer) {
        pet.cheer = false;
        pet.act = 'stretch';
        pet.until = now + STRETCH_MS;
        pet.restSince = now;
        continue;
      }
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

    // 망치 피니셔 — 맡은 게는 악당에게 내달려 내리친다. 반격이 걷기·쉬기보다 먼저다.
    const vil = world.villain;
    if (vil && vil.state === 'live' && vil.hammerKey === pet.key && pet.act !== 'hop') {
      pet.act = 'walk';
      pet.dash = true;
      pet.gx = vil.x;
      pet.gy = Math.min(area.y1, vil.y + 2);
      const was = { x: pet.x, y: pet.y };
      if (advance(pet, step, CHARGE_HIT + 1, speed * RUN_MULT)) {
        pet.dash = false;
        pet.swingAt = now; // 내리치기 — 다음 프레임부터 위의 swing 블록이 잇는다
        pet.swingK = 0;
        koVillain(world, vil, now);
      } else {
        leaveTrack(world, pet, Math.abs(pet.x - was.x) + Math.abs(pet.y - was.y), now);
      }
      continue;
    }

    // 소환된 공 — 선수는 공놀이가 걷기·쉬기보다 먼저다(위의 일·명령·손보다는 뒤).
    // 차례인 게가 걸어가 차고, 상대는 공을 보고 선다.
    const ball = world.props.find((p) => p.kind === 'ball' && p.players?.includes(pet.key));
    if (ball && pet.act !== 'hop') {
      if (ball.state !== 'live' || !ballStopped(ball) || ball.players[ball.turn] !== pet.key) {
        pet.act = 'walk';
        pet.moving = false;
        if (Math.abs(ball.x - pet.x) > 1) pet.dir = ball.x > pet.x ? 1 : -1;
        continue;
      }
      pet.act = 'walk';
      pet.gx = ball.x;
      pet.gy = Math.min(area.y1, ball.y + 4); // 공 조금 앞에 선다 — 겹치면 발이 공을 가린다
      const was = { x: pet.x, y: pet.y };
      if (advance(pet, step, KICK_NEAR, speed)) {
        kickBall(world, ball, pet, rng);
        pet.act = 'hop'; // 뻥 — 차는 순간 몸이 뜬다
        pet.hopAt = now;
        pet.hop = 0;
      } else {
        leaveTrack(world, pet, Math.abs(pet.x - was.x) + Math.abs(pet.y - was.y), now);
      }
      continue;
    }

    // 피크닉 — 손님은 러그 둘레 제 자리로 걸어가 러그를 보고 서서 담소한다.
    const rug = world.props.find((p) => p.kind === 'rug' && p.guests?.includes(pet.key));
    if (rug && pet.act !== 'hop') {
      const spot = rug.spots[pet.key];
      if (spot && Math.hypot(pet.x - spot.gx, pet.y - spot.gy) > NEAR + 0.3) {
        pet.act = 'walk';
        pet.gx = spot.gx;
        pet.gy = spot.gy;
        const was = { x: pet.x, y: pet.y };
        advance(pet, step, NEAR, speed);
        leaveTrack(world, pet, Math.abs(pet.x - was.x) + Math.abs(pet.y - was.y), now);
      } else {
        // 절반은 마시고 절반은 떠든다 — 큰 창의 모임(정수기 앞) 풍경과 같은 배합이다
        pet.act = rug.guests.indexOf(pet.key) % 2 ? 'sip' : 'chat';
        pet.moving = false;
        if (Math.abs(rug.x - pet.x) > 1) pet.dir = rug.x > pet.x ? 1 : -1;
      }
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

    // 기지개·낮잠·캔 — 할 일 없이 오래 지나면 나온다. 자다가 일이 들어오면 위에서 걷어진다.
    if (pet.act === 'stretch' || pet.act === 'nap' || pet.act === 'sip') {
      pet.moving = false;
      if (now < pet.until) continue;
      pet.act = 'walk';
      pet.restSince = now;
      aim(pet, area, rng, world);
      pet.until = 0;
    }
    if (pet.restSince == null) pet.restSince = now;
    const night = NIGHT_SLOTS.includes(slot);
    if (now - pet.restSince > (night ? REST_LONG_NIGHT_MS : REST_LONG_MS) && now >= pet.until) {
      let act = 'stretch';
      if (!night && SIP_SLOTS.includes(slot) && rng() < SIP_CHANCE) act = 'sip';
      else if (rng() < (night ? NAP_CHANCE_NIGHT : NAP_CHANCE)) act = 'nap';
      pet.act = act;
      pet.until = now + (act === 'nap' ? NAP_MS : act === 'sip' ? SIP_MS : STRETCH_MS);
      pet.moving = false;
      pet.restSince = now;
      continue;
    }

    // 붙박인 게는 새 목적지를 고르지 않고 그 자리에 선다 — 쉬기(위)와 쳐다보기는 그대로 탄다
    if (pet.stay) {
      pet.act = 'walk';
      pet.moving = false;
      continue;
    }

    // 산책 — 목적지까지 걷고, 닿으면 잠깐 쉬었다 새 목적지를 고른다
    pet.act = 'walk';
    // 발밑의 버그 — 밟기 직전이면 기겁하며 폴짝 뛰고(내려서며 새 목적지를 고른다) 잠깐은
    // 또 안 놀란다. 쿨다운이 없으면 버그밭 위에서 영영 뛰기만 한다.
    if (world.bugs.length && now > (pet.bugCool ?? 0)) {
      const bug = world.bugs.find((b) => Math.hypot(b.x - pet.x, b.y - pet.y) < BUG_NEAR);
      if (bug) {
        pet.bugCool = now + 2600;
        pet.act = 'hop';
        pet.hopAt = now;
        pet.hop = 0;
        continue;
      }
    }
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
