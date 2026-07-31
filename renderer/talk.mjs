// 혼잣말과 잡담. 상태별 상투구를 돌리되, 세션이 실제로 뭘 하고 있는지(detail·needs)를 섞어
// 말풍선만 봐도 대충 상황이 읽히게 한다.
//
// 대사는 전부 시간 + 키 해시로만 고르므로 상태를 들고 있지 않다 — 창을 다시 그려도
// 같은 순간엔 같은 말을 한다.
//
// 문장 자체는 사전(shared/lang/*.mjs)에 있고 여기는 "언제 무엇을 고르는지"만 정한다.
// 목록 길이가 언어마다 달라도 되도록 고를 때마다 길이를 다시 읽는다 — 인덱스를 미리
// 캐시하면 언어를 바꿨을 때 없는 자리를 집어 빈 말풍선이 뜬다.
//
// 애니메이션 시각 인자를 `tms`로 부르는 이유: 이 파일에서 `t`는 사전을 읽는 함수다.
// 렌더러의 다른 곳에서는 `t`가 시각이지만, 여기서 둘이 겹치면 조용히 엉뚱한 것을 부른다.
import { t, fmtDur } from '../shared/i18n.mjs';

export function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

// 같은 seed·index면 늘 같은 값 — 프레임마다 다시 계산해도 말이 흔들리지 않는다.
export function rnd(seed, i) {
  let h = (seed ^ Math.imul(i + 1, 2654435761)) >>> 0;
  h ^= h >>> 15;
  h = Math.imul(h, 2246822507) >>> 0;
  h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
}

// 목록에서 하나 고르기. 빈 목록이면 빈 문자열 — 사전에 없는 키를 집었을 때 터지지 않게.
function pick(pool, seed, i) {
  return Array.isArray(pool) && pool.length ? pool[Math.floor(rnd(seed, i) * pool.length)] : '';
}

// 시간대에 따라 섞어 넣는 한마디 — 밤늦게 야근하는 놈이 있으면 티가 난다.
// 구간은 언어와 무관하므로 여기 두고, 문장만 사전에서 가져온다.
const TIME_SLOTS = [
  { from: 0, to: 5, key: 'lateNight' },
  { from: 5, to: 9, key: 'earlyMorning' },
  { from: 9, to: 12, key: 'morning' },
  { from: 12, to: 14, key: 'lunch' },
  { from: 14, to: 18, key: 'afternoon' },
  { from: 18, to: 22, key: 'evening' },
  { from: 22, to: 24, key: 'night' },
];

function timeLines(now = new Date()) {
  const h = now.getHours();
  const slot = TIME_SLOTS.find((s) => h >= s.from && h < s.to);
  return slot ? t(`talk.time.${slot.key}`) : [];
}

// 둘이 마주쳤을 때 주고받는 대화 — [먼저 말하는 쪽, 대답하는 쪽]
export function chatLines(pairKey, index) {
  const seed = hashStr(`${pairKey}#${index}`);
  const duos = t('talk.duos');
  return pick(duos, seed, 3) || ['', ''];
}

// ── 비서 보고. 서브에이전트가 돌고 있는 동안 옆에 선 비서가 진행 상황을 읊는다.
// {label} 서브에이전트가 받은 지시, {kind} 종류, {n} 붙어 있는 수.
const AIDE_CYCLE = 6400;
const AIDE_SHOW = 4600;

// 지금 비서가 뭐라고 보고하는지. 서브에이전트가 없으면 null.
export function reportFor(worker, tms) {
  const aides = worker.aides ?? [];
  if (!aides.length) return null;
  const seed = hashStr(`${worker.key}#aide`);
  const tt = tms + (seed % AIDE_CYCLE);
  const f = tt % AIDE_CYCLE;
  if (f > AIDE_SHOW) return null;

  const i = Math.floor(tt / AIDE_CYCLE);
  const a = aides[i % aides.length];
  // 여럿이 붙었으면 가끔은 머릿수부터 알린다
  const which = aides.length > 1 && i % 3 === 0 ? 'many' : a.label ? 'labeled' : 'bare';
  const tpl = pick(t(`talk.aide.${which}`), seed, i);
  if (!tpl) return null;
  const text = tpl
    .replace('{label}', trim(a.label, 34))
    .replace('{kind}', a.kind || 'agent')
    .replace('{n}', String(aides.length));
  // 실제로 읽어온 값(받은 지시·종류·머릿수)이 들어간 문장만 "세션 기반"으로 본다
  const real = /\{(label|kind|n)\}/.test(tpl);
  return { text, alpha: fade(f, AIDE_SHOW), kind: real ? 'real' : 'idle' };
}

function trim(s, n) {
  if (!s) return '';
  const flat = String(s).replace(/\s+/g, ' ').trim();
  return flat.length > n ? flat.slice(0, n - 1) + '…' : flat;
}

// 상투구 대신 내보낼 "진짜" 한마디
function realLine(worker) {
  if (worker.mood === 'waiting' && worker.needs) return trim(worker.needs, 52);
  if (worker.detail) return trim(worker.detail, 52);
  if (worker.mood === 'typing' && (worker.lastPrompt || worker.intent))
    return trim(worker.lastPrompt || worker.intent, 52);
  if (worker.title) return trim(worker.title, 52);
  return '';
}

// 자리를 오갈 때 하는 한마디. 일을 끝내고 일어설 때와 일을 받아 앉으러 갈 때.
//
// 대사는 statusAt으로 고른다 — 전환 한 번 동안에는 같은 말이어야 하고(프레임마다 바뀌면
// 읽을 수 없다), 다음 번에는 다른 말이 나와야 한다.
export function moveSpeech(worker, note) {
  if (note !== 'done' && note !== 'start') return null;
  const seed = hashStr(worker.key) + Math.floor((worker.statusAt ?? 0) / 1000);
  const text = pick(t(`talk.move.${note}`), seed, 3);
  return text ? { text, alpha: 1, kind: 'idle' } : null;
}

// 얼마나 기다렸는지. 오래 방치된 대기가 눈에 띄어야 한다.
//
// 1분 안쪽은 적지 않는다 — "0분째"는 정보가 아니라 소음이고, 금방 답할 프롬프트까지
// 재촉하는 꼴이 된다. worker.statusAt은 status가 'waiting'으로 바뀐 절대 시각이므로
// 스냅샷이 늦게 와도 여기서 직접 세면 시간이 맞는다.
function waitedLine(worker) {
  if (worker.mood !== 'waiting' || !worker.statusAt) return '';
  const waited = Date.now() - worker.statusAt;
  if (waited < 60_000) return '';
  return t('talk.waiting', { d: fmtDur(waited) });
}

const CYCLE = 8000; // 한마디 주기
const SHOW = 4800; // 떠 있는 시간
const FADE = 420;

export function fade(f, show = SHOW, fadeMs = FADE) {
  if (f < fadeMs) return f / fadeMs;
  if (f > show - fadeMs) return Math.max(0, (show - f) / fadeMs);
  return 1;
}

// 지금 이 순간 이 캐릭터가 뭐라고 중얼거리는지. 말이 없는 구간이면 null.
// extra는 방 종류별 대사 — 개발실에서만 하는 말 같은 것.
export function speechFor(worker, tms, extra = []) {
  const seed = hashStr(worker.key);
  const tt = tms + (seed % CYCLE); // 다 같이 입을 열지 않도록 위상을 흩는다
  const f = tt % CYCLE;
  if (f > SHOW) return null;

  const i = Math.floor(tt / CYCLE);
  // 기다리는 중이면 셋을 돌린다: 무엇을 기다리는지 → 얼마나 기다렸는지 → 재촉하는 상투구.
  // 경과 시간도 세션에서 나온 값이라 'real'(흰 말풍선)로 보낸다.
  const waited = waitedLine(worker);
  if (waited && i % 3 === 1) return { text: waited, alpha: fade(f), kind: 'real' };

  const real = realLine(worker);
  const base = t(`talk.lines.${worker.mood}`);
  // 일하는 중이 아니면 방 분위기와 시간대 얘기도 한다
  const flavour = worker.mood === 'typing' || worker.mood === 'waiting' ? [] : [...extra, ...timeLines()];
  const pool = flavour.length && rnd(seed, i * 7 + 1) < 0.3 ? flavour : (Array.isArray(base) ? base : t('talk.lines.idle'));
  const useReal = Boolean(real) && i % 2 === 0;
  const text = useReal ? real : pick(pool, seed, i);
  if (!text) return null;

  // kind는 말풍선 색을 가른다 — 세션에서 읽어온 말인지, 우리가 써 둔 상투구인지
  return { text, alpha: fade(f), kind: useReal ? 'real' : 'idle' };
}
