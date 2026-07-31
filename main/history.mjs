// 근태 기록 — 스냅샷에서 상태 전이만 골라 한 줄씩 남기고, 물어보면 집계해 돌려준다.
//
// 스냅샷을 그대로 쌓으면 파일이 폭발한다(1.5초에 한 장). 바뀐 것만 남기면 유휴 사무실에서는
// 아무것도 안 쓰이고, 실제로 하루가 수백 줄에 그친다.
//
// 남기는 것은 **방(작업 디렉터리 이름)까지다.** 세션 이름·cwd·지시 내용은 남기지 않는다 —
// 지난 기록에는 이름 가리기 설정을 적용할 방법이 없고(그 세션은 이미 사라졌다),
// 근태 집계에 필요하지도 않다.
//
// 판정과 집계는 순수 함수로 두고 파일 I/O만 아래에 모았다 — 시간에 달린 로직이라 테스트가 필요하다.
import fs from 'node:fs';
import path from 'node:path';
import { t } from '../shared/i18n.mjs';

// 기록을 얼마나 들고 있을지. 앱 시작할 때 이보다 오래된 줄을 덜어낸다.
export const RETAIN_MS = 14 * 24 * 60 * 60 * 1000;

// "오래 기다리게 한 순간" 목록에 올릴 최소 길이. 총 대기 시간에는 다 들어가지만,
// 바로 답한 문답까지 목록에 올리면 정작 방치된 것이 묻힌다.
const WAIT_WORTH_MS = 60_000;

// mood를 세 갈래로 접는다. done·failed·stopped는 자리에 남아 있을 뿐 일하는 것도,
// 나를 기다리는 것도 아니라 idle로 본다.
const BUCKET = { typing: 'busy', waiting: 'wait' };

function bucketOf(mood) {
  return BUCKET[mood] ?? 'idle';
}

function indexWorkers(snapshot) {
  const map = new Map();
  for (const room of snapshot?.rooms ?? []) {
    for (const w of room.workers ?? []) map.set(w.key, w);
  }
  return map;
}

// 컨텍스트는 있을 때만 싣는다 — undefined 필드는 JSON.stringify가 빼 주므로 줄이 짧아진다
function ctxOf(w) {
  const pct = w.context?.pct;
  return typeof pct === 'number' ? pct : undefined;
}

// 스냅샷 두 장의 차이 → 남길 이벤트.
//
// `at`은 startedAt·statusAt이 아니라 **관측 시각**으로 통일한다. 과거 시각을 섞으면 파일의
// 시간 순서가 깨지고(append-only인데 뒤로 간다) 재생이 꼬인다. 정확도는 폴링 간격(1.5초)이면 충분하다.
export function diffEvents(prev, next, now = Date.now()) {
  const events = [];
  const before = indexWorkers(prev);
  const after = indexWorkers(next);

  for (const [key, w] of after) {
    const was = before.get(key);
    if (!was) events.push({ at: now, ev: 'on', key, room: w.room, mood: w.mood, ctx: ctxOf(w) });
    else if (was.mood !== w.mood) events.push({ at: now, ev: 'mood', key, room: w.room, mood: w.mood, ctx: ctxOf(w) });
  }
  for (const [key, w] of before) {
    if (!after.has(key)) events.push({ at: now, ev: 'off', key, room: w.room, ctx: ctxOf(w) });
  }
  return events;
}

// 앱이 켜졌다는 표시. 재생할 때 열려 있던 구간을 여기서 끊는다 —
// 앱이 꺼져 있던 동안은 아무것도 못 봤으므로 그 시간을 근태로 세면 거짓이 된다.
export function bootEvent(now = Date.now()) {
  return { at: now, ev: 'boot' };
}

// 로컬 자정 기준. "오늘"은 사용자가 보는 오늘이어야 한다(UTC로 자르면 아침에 어제가 된다).
export function dayStart(now = Date.now(), daysAgo = 0) {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - daysAgo);
  return d.getTime();
}

// [from, to] 구간의 근태. 이벤트를 시간순으로 재생하며 mood 구간을 방별로 누적한다.
export function summarize(events, { from, to }) {
  const sorted = [...events].sort((a, b) => a.at - b.at);
  const open = new Map(); // key → { room, bucket, since }
  const rooms = new Map();
  const waits = [];
  let maxCtx = null;

  const roomOf = (name) => {
    // 이름이 빠진 줄을 모으는 자리. 집계할 때 붙이므로 기록 자체는 언어를 타지 않는다 —
    // 지난 기록을 지금 언어로 읽게 하려면 파일에 문구를 남기지 않아야 한다.
    const key = name || t('att.unknownRoom');
    if (!rooms.has(key)) rooms.set(key, { room: key, keys: new Set(), busyMs: 0, waitMs: 0, idleMs: 0 });
    return rooms.get(key);
  };

  // 구간 하나를 닫는다. 담는 것은 [from, to]와 겹치는 만큼이다.
  const close = (key, at) => {
    const cur = open.get(key);
    if (!cur) return;
    open.delete(key);
    const s = Math.max(cur.since, from);
    const e = Math.min(at, to);
    if (e <= s) return;
    const r = roomOf(cur.room);
    r.keys.add(key);
    const ms = e - s;
    if (cur.bucket === 'busy') r.busyMs += ms;
    else if (cur.bucket === 'wait') r.waitMs += ms;
    else r.idleMs += ms;
    // 대기는 얼마나 길었는지를 따로 보고 싶다 — 잘라낸 길이가 아니라 실제 길이를 적는다
    if (cur.bucket === 'wait') waits.push({ room: r.room, at: cur.since, ms: at - cur.since });
  };

  for (const ev of sorted) {
    if (ev.at > to) break;
    if (ev.at >= from && typeof ev.ctx === 'number') maxCtx = Math.max(maxCtx ?? 0, ev.ctx);

    if (ev.ev === 'boot') {
      for (const key of [...open.keys()]) close(key, ev.at);
      continue;
    }
    if (ev.ev === 'off') {
      close(ev.key, ev.at);
      continue;
    }
    // on·mood — 이전 구간을 닫고 새로 연다
    close(ev.key, ev.at);
    open.set(ev.key, { room: ev.room, bucket: bucketOf(ev.mood), since: ev.at });
  }
  // 아직 열려 있는 구간은 구간 끝까지 이어진 것으로 본다
  for (const key of [...open.keys()]) close(key, to);

  const list = [...rooms.values()]
    .map(({ room, keys, busyMs, waitMs, idleMs }) => ({ room, sessions: keys.size, busyMs, waitMs, idleMs }))
    .filter((r) => r.busyMs || r.waitMs || r.idleMs)
    .sort((a, b) => b.busyMs + b.waitMs - (a.busyMs + a.waitMs) || a.room.localeCompare(b.room));

  const everyKey = new Set();
  for (const r of rooms.values()) for (const k of r.keys) everyKey.add(k);

  return {
    from,
    to,
    sessions: everyKey.size,
    busyMs: list.reduce((a, r) => a + r.busyMs, 0),
    waitMs: list.reduce((a, r) => a + r.waitMs, 0),
    idleMs: list.reduce((a, r) => a + r.idleMs, 0),
    rooms: list,
    // 오래 기다리게 한 순간부터 — 이 앱만 낼 수 있는 숫자다.
    // 바로 답한 대기(1분 미만)는 목록에서 뺀다. 그건 방치가 아니라 정상적인 문답이다.
    waits: waits
      .filter((w) => w.ms >= WAIT_WORTH_MS)
      .sort((a, b) => b.ms - a.ms)
      .slice(0, 5),
    maxCtx,
  };
}

// ── 파일 (userData/history.jsonl)

export function appendEvents(file, events) {
  if (!events?.length) return;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, events.map((e) => JSON.stringify(e)).join('\n') + '\n', 'utf8');
  } catch (err) {
    console.error('history append failed:', err.message);
  }
}

export function readEvents(file) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return [];
  }
  const out = [];
  for (const line of text.split('\n')) {
    const s = line.trim();
    if (!s) continue;
    try {
      const e = JSON.parse(s);
      if (typeof e?.at === 'number' && typeof e?.ev === 'string') out.push(e);
    } catch {
      /* 쓰는 도중에 읽어 잘린 줄 */
    }
  }
  return out;
}

// 보존 기간이 지난 줄을 덜어낸다. 앱을 켤 때 한 번 돈다.
export function pruneFile(file, keepMs = RETAIN_MS, now = Date.now()) {
  const events = readEvents(file);
  if (!events.length) return 0;
  const cut = now - keepMs;
  const keep = events.filter((e) => e.at >= cut);
  if (keep.length === events.length) return 0;
  try {
    fs.writeFileSync(file, keep.length ? keep.map((e) => JSON.stringify(e)).join('\n') + '\n' : '', 'utf8');
  } catch (err) {
    console.error('history prune failed:', err.message);
    return 0;
  }
  return events.length - keep.length;
}

export function clearFile(file) {
  try {
    fs.rmSync(file, { force: true });
    return true;
  } catch {
    return false;
  }
}
