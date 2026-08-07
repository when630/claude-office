// ~/.claude 아래 세션·잡 파일을 읽어 사무실 한 장면으로 정리한다.
// `claude agents`가 쓰는 것과 같은 파일들 — CLI를 스폰하지 않아 가볍다.
//
// 백그라운드 잡은 jobs/<id>/state.json에 상세를 남기지만 터미널 세션은 그렇지 않다.
// 그래서 양쪽 모두 트랜스크립트(main/transcript.mjs)를 함께 읽어 제목·마지막 지시·
// 진행 요약·연결된 MR·컨텍스트 사용량을 채운다.
import fs from 'node:fs/promises';
import path from 'node:path';
import { CLAUDE_DIR, roomKeyOf } from './paths.mjs';
import { readTranscript } from './transcript.mjs';
import { readUsage } from './usage.mjs';
import { readNotes, noteNeeds } from './notify-tap.mjs';
import { readTasks } from './tasks.mjs';
import { readPromptLog, lastPromptFor } from './prompts.mjs';
import { readTouchedFiles } from './files.mjs';
import { groupOf, labelOf } from './rooms.mjs';

export { CLAUDE_DIR };

// 종료된 잡을 "퇴근 목록"에 남겨두는 기간
const RECENT_DONE_MS = 1000 * 60 * 60 * 12;

async function readJson(file) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch {
    return null;
  }
}

async function readdirSafe(dir) {
  try {
    return await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

// jsonl은 쓰는 도중에 읽으면 마지막 줄이 잘려 있다 — 파싱 실패한 줄은 조용히 버린다.
async function readLastJsonl(file, count, maxBytes = 64 * 1024) {
  let fh;
  try {
    fh = await fs.open(file, 'r');
    const { size } = await fh.stat();
    const start = Math.max(0, size - maxBytes);
    const buf = Buffer.alloc(size - start);
    await fh.read(buf, 0, buf.length, start);
    const lines = buf.toString('utf8').split('\n');
    if (start > 0) lines.shift(); // 앞이 잘린 줄
    const out = [];
    for (let i = lines.length - 1; i >= 0 && out.length < count; i--) {
      const line = lines[i].trim();
      if (!line) continue;
      try {
        out.unshift(JSON.parse(line));
      } catch {
        /* 쓰는 중이라 깨진 줄 */
      }
    }
    return out;
  } catch {
    return [];
  } finally {
    await fh?.close();
  }
}

// Windows에서도 동작한다. EPERM은 "남의 프로세스지만 살아있음".
function isAlive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === 'EPERM';
  }
}

function trimText(s, n = 240) {
  if (typeof s !== 'string') return '';
  const flat = s.replace(/\s+/g, ' ').trim();
  return flat.length > n ? flat.slice(0, n) + '…' : flat;
}

async function collectJobs() {
  const jobsDir = path.join(CLAUDE_DIR, 'jobs');
  const entries = await readdirSafe(jobsDir);
  const jobs = new Map();
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const dir = path.join(jobsDir, e.name);
    const state = await readJson(path.join(dir, 'state.json'));
    if (!state) continue;
    const timeline = await readLastJsonl(path.join(dir, 'timeline.jsonl'), 12);
    jobs.set(e.name, { id: e.name, dir, state, timeline });
  }
  return jobs;
}

// 실제 대화가 쌓이는 세션 id. 백그라운드 잡은 자기 sessionId가 아니라 resumeSessionId 쪽에
// 대화 파일이 생긴다 — 트랜스크립트도, Notification 훅의 session_id도 이 값으로 맞춰야 한다.
function sessionIdOf(s, job) {
  return job?.state?.resumeSessionId || s.sessionId;
}

async function collectSessions() {
  const dir = path.join(CLAUDE_DIR, 'sessions');
  const entries = await readdirSafe(dir);
  const out = [];
  for (const e of entries) {
    if (!e.isFile() || !e.name.endsWith('.json')) continue;
    const s = await readJson(path.join(dir, e.name));
    if (s?.pid) out.push(s);
  }
  return out;
}

// 일하는 중인데 진전이 없는가.
//
// mood가 여섯이던 시절에 빠져 있던 상태다 — 같은 도구 에러를 반복하거나 몇 분째 대화 파일에
// 아무것도 안 붙는 세션이 "열심히 타자 치는 중"으로만 보였다. 기다리는 세션은 불러 주면서
// 헤매는 세션은 못 본 척한 셈이다.
//
// 신호는 둘. 어느 쪽이든 걸리면 stuck으로 본다.
//  - 도구가 **연달아 실패**하고 있다 (transcript.mjs의 scanErrorRun)
//  - 대화 파일이 한동안 **안 자랐다** (mtime). 멈췄거나 도구 하나에 붙들려 있다는 뜻이다
//
// 무진전 문턱을 넉넉히 잡은 이유: 긴 빌드·테스트·설치는 정상적으로 조용하다. 그동안 대화
// 파일에는 아무것도 안 쓰인다(도구 결과가 와야 다음 줄이 붙는다). 문턱이 짧으면 정상적으로
// 오래 걸리는 일을 전부 "헤맨다"고 부르게 되고, 그러면 이 상태 자체를 아무도 안 믿는다.
export const STUCK_ERRORS = 3;
export const STUCK_QUIET_MS = 10 * 60 * 1000;

export function isStuck(tr, now = Date.now()) {
  if (!tr) return false;
  if ((tr.errorRun ?? 0) >= STUCK_ERRORS) return true;
  return tr.at != null && now - tr.at >= STUCK_QUIET_MS;
}

// 헤매기 **직전**. 대화 파일이 조용해지기 시작했지만 아직 stuck 문턱에 못 닿은 구간이다.
//
// 새 상태를 만드는 것이 아니다 — mood는 그대로 `typing`이고 화면에 표시(말줄임)만 얹는다.
// 문턱이 넉넉해서(10분) 그 전까지는 열심히 타자 치는 모습과 구분이 안 됐던 구간을,
// "헤맨다"고 부르기 전에 사람 눈에 먼저 보이게 하는 것이다.
//
// 판정을 여기서 하는 이유: 문턱을 아는 곳이 한 군데여야 한다. 렌더러에 ms를 넘기면
// 그쪽도 문턱을 들고 있게 되고, 그러면 한쪽만 고치는 일이 생긴다.
export const SLOWING_QUIET_MS = STUCK_QUIET_MS / 2;

export function isSlowing(tr, mood, now = Date.now()) {
  if (mood !== 'typing' || tr?.at == null) return false;
  const quiet = now - tr.at;
  return quiet >= SLOWING_QUIET_MS && quiet < STUCK_QUIET_MS;
}

// Claude 서버 쪽 문제로 응답을 못 받고 있는가 — 화면에서는 어지러워한다.
//
// `stuck`과 갈라 두는 이유: `stuck`은 "돌고는 있는데 진전이 없다"이고 이쪽은 **아예 돌지
// 못한다.** 턴이 에러로 끝나면 status가 `idle`로 떨어지므로, 이 판정이 없으면 게가 자리에서
// 일어나 태평하게 방을 어슬렁거린다 — 내 잘못이 아닌 이유로 일이 멈춘 순간인데 사무실은
// 한가한 그림이었다.
//
// `slowing`과 같은 처지라 **새 mood를 만들지 않는다.** mood는 그대로 두고 표시만 얹는다.
// 하나는 이게 status와 직교하기 때문이다 — 에러 뒤 그대로 쉬고 있으면 `idle`, 사용자가 다시
// 던졌으면 `busy`이고, 어느 쪽이든 "서버가 죽어 있다"는 사실은 같다. mood로 만들면 그 조합을
// 다 나열해야 하고 근태·통계·미니뷰의 mood 목록까지 전부 갈라진다.
//
// 판정은 여기서 한다 — 문턱을 아는 곳이 한 군데여야 한다(isSlowing과 같은 이유).
//
// 시간 문턱이 필요한 이유: 트랜스크립트 꼬리에는 **회복하지 못한 채 끝난 세션의 에러 줄이
// 그대로 남는다**(뒤에 정상 응답이 없으니 scanApiFail의 연속도 끊기지 않는다). 문턱이 없으면
// 어제 장애를 만난 세션이 오늘까지 어지러워한다. 넉넉히 잡은 쪽은 실측 때문이다 —
// 529 한 번의 내부 재시도에 3.5분이 걸렸고, 문턱이 그보다 짧으면 정작 서버가 죽어 있는
// 동안에 표시가 꺼진다.
export const BROKEN_FRESH_MS = 8 * 60 * 1000;

export function isBroken(tr, now = Date.now()) {
  const fail = tr?.apiFail;
  if (!fail?.run) return false;
  // 시각을 못 읽었으면(줄이 깨졌거나 옛 형식) 대화 파일이 마지막으로 자란 시각으로 대신한다 —
  // 에러 줄이 곧 마지막 줄이므로 그게 사실상 같은 값이다.
  const at = fail.at ?? tr.at;
  return at != null && now - at < BROKEN_FRESH_MS;
}

// status(실시간) → needs → state(스냅샷) 순으로 캐릭터의 기분을 정한다.
//
// `status: "waiting"`은 Claude Code가 **사용자 답을 기다리는 동안** 직접 넣어 주는 값이다 —
// 권한 확인, 선택지(AskUserQuestion), 플랜 승인 같은 것들. 이걸 안 보면 'idle'로 떨어져
// 게가 자리에서 일어나 산책을 시작하고, 정작 나를 부르고 있다는 신호가 어디에도 안 뜬다.
//
// 트랜스크립트로는 이걸 알 수 없다. 실측해 보면 선택지가 떠 있는 동안 대화 파일에는
// **아무것도 안 쓰인다**(답한 뒤에야 tool_use 줄이 붙는다). 세션 파일의 status가 유일한 단서다.
function moodOf(session, job, tr, now) {
  const st = job?.state ?? {};
  if (session.status === 'busy') return isStuck(tr, now) ? 'stuck' : 'typing';
  if (session.status === 'waiting') return 'waiting';
  if (st.needs) return 'waiting';
  if (st.state === 'failed') return 'failed';
  if (st.state === 'stopped') return 'stopped';
  if (st.state === 'done') return 'done';
  return 'idle';
}

// 지금 붙어 있는 서브에이전트("비서") 목록.
// 백그라운드 잡은 state.json의 fan[]을 데몬이 실시간으로 갱신해 주므로 그게 가장 빠르고,
// 터미널 세션은 그런 파일이 없어 트랜스크립트에서 찾아 쓴다(transcript.mjs의 scanAides).
function aidesOf(state, tr) {
  // fan은 종류를 'agent'로 뭉뚱그리는데 트랜스크립트는 subagent_type을 안다.
  // 양쪽 다 agentId를 들고 있으니 id로 맞춰 붙여 종류를 살린다.
  const script = new Map((tr?.aides ?? []).filter((a) => a.id).map((a) => [a.id, a]));
  const fan = Array.isArray(state.fan) ? state.fan : [];
  const live = fan
    // 끝난 놈은 fan에서 바로 빠지지 않고 doneAt만 붙는다 — 그대로 두면 유령이 서 있다
    .filter((f) => f && f.kind !== 'shell' && !f.doneAt)
    .slice(0, 4)
    .map((f) => {
      const s = script.get(f.id);
      const kind = f.kind && f.kind !== 'agent' ? f.kind : s?.kind || f.kind || 'agent';
      return { kind: trimText(kind, 24), label: trimText(f.label || s?.label || '', 60) };
    });
  if (live.length) return live;

  // 트랜스크립트 쪽은 받은 지시까지 들고 온다 — 수만 아는 inFlight보다 이쪽이 낫다
  const fromScript = (tr?.aides ?? []).map((a) => ({ kind: a.kind, label: a.label }));
  if (fromScript.length) return fromScript;

  // 그것도 없으면 tasks 수만큼은 이름표 없이 서 있게 한다
  const tasks = Number(state.inFlight?.tasks || 0);
  if (tasks > 0) {
    const kinds = Array.isArray(state.inFlight?.kinds) ? state.inFlight.kinds : [];
    return Array.from({ length: Math.min(tasks, 4) }, (_, i) => ({
      kind: trimText(kinds[i] || 'agent', 24),
      label: '',
    }));
  }
  return [];
}

// 타임라인. 백그라운드 잡은 timeline.jsonl에 상태가 바뀔 때마다 한 줄씩 남겨 주지만
// 터미널 세션은 그런 파일이 없다 — 그쪽은 대화에서 주워온 턴(받은 지시 ↔ 한 말)을 대신 쓴다.
// 잡 타임라인이 더 낫다(요약된 detail과 실제 상태를 들고 있다). 있으면 그걸 쓴다.
function timelineOf(job, tr) {
  const jobline = job?.timeline ?? [];
  if (jobline.length) {
    return jobline.map((t) => ({ at: t.at, state: t.state, detail: trimText(t.detail || '', 120) }));
  }
  return tr?.turns ?? [];
}

// MR 목록은 state.json(children)과 트랜스크립트(pr-link) 양쪽에서 온다 — url로 합친다.
function mergeLinks(...groups) {
  const seen = new Set();
  const out = [];
  for (const group of groups) {
    if (!Array.isArray(group)) continue;
    for (const l of group) {
      const href = l?.href ?? l?.url ?? l?.prUrl;
      if (!href || seen.has(href)) continue;
      seen.add(href);
      out.push({ id: String(l.id ?? l.prNumber ?? ''), href, repo: l.repo ?? l.prRepository ?? '' });
      if (out.length >= 6) return out;
    }
  }
  return out;
}

// 데몬이 예비로 데워 두는 백그라운드 슬롯 — `~/.claude/daemon`의 spare 풀에서 꺼내 세션 파일까지
// 만들어 두지만 프롬프트를 한 번도 받지 않아 잡 상세도 대화 파일도 없다. 그대로 그리면 빈 프로세스가
// 정직원처럼 자리에 앉아 출근 인원까지 부풀리고, 이름도 짧은 id(`8e4edbee`)로 떠서 정체를 알 수 없다.
//
// 판정은 일부러 빡빡하게 잡았다 — 하나라도 흔적이 있으면 그리는 쪽으로 기운다.
//  - 터미널 세션은 아예 대상이 아니다. 갓 띄운 창도 기록이 없지만 그건 곧 사람이 쓸 자리다
//  - status가 busy면(mood typing) 뺀다. 대화 파일이 아직 안 쓰였을 뿐 지금 일하는 중일 수 있다
function isSpare(w) {
  return (
    w.kind === 'bg' &&
    w.mood === 'idle' &&
    !w.jobId &&
    !w.title &&
    !w.detail &&
    !w.needs &&
    !w.lastPrompt &&
    !w.intent &&
    !w.tokens &&
    !w.context &&
    !w.aides.length &&
    !w.tasks &&
    !w.files &&
    !w.timeline.length
  );
}

// `view`는 방 묶기·별칭이다(main/rooms.mjs). 안 넘기면 예전처럼 작업 디렉터리마다 한 방이다.
export async function collect({ groups = [], alias = {} } = {}) {
  const [sessions, jobs, usage] = await Promise.all([collectSessions(), collectJobs(), readUsage()]);
  const now = Date.now();
  const seenJobs = new Set();
  const workers = [];

  // 트랜스크립트는 파일 I/O라 세션마다 병렬로 읽는다 (mtime이 그대로면 캐시가 받아준다)
  const alive = sessions.filter((s) => isAlive(s.pid));
  const scripts = await Promise.all(
    alive.map((s) => {
      const job = s.jobId ? jobs.get(s.jobId) : null;
      return readTranscript(job?.state?.cwd || s.cwd, sessionIdOf(s, job)).catch(() => null);
    }),
  );

  // 세션이 세운 할 일 목록(main/tasks.mjs). 대부분 세션은 안 써서 대개 null이다.
  const todos = await Promise.all(
    alive.map((s) => {
      const job = s.jobId ? jobs.get(s.jobId) : null;
      return readTasks(sessionIdOf(s, job)).catch(() => null);
    }),
  );

  // 이 세션이 만진 파일 수·편집 횟수(main/files.mjs). 디렉터리 이름만 읽어 내용은 안 본다.
  const touched = await Promise.all(
    alive.map((s) => {
      const job = s.jobId ? jobs.get(s.jobId) : null;
      return readTouchedFiles(sessionIdOf(s, job)).catch(() => null);
    }),
  );

  // 내가 친 프롬프트 이력(main/prompts.mjs). 트랜스크립트 꼬리에서 마지막 지시가 밀려났을 때
  // 대신 쓴다 — 파일 하나라 세션 수와 무관하게 한 번만 읽는다.
  const promptLog = await readPromptLog().catch(() => []);

  // Notification 훅을 심어 뒀다면 지금 무엇을 묻고 있는지가 들어온다(main/notify-tap.mjs).
  // 안 심었으면 빈 Map이고 아래는 예전처럼 돈다.
  const notes = readNotes(now);

  alive.forEach((s, i) => {
    const job = s.jobId ? jobs.get(s.jobId) : null;
    if (job) seenJobs.add(job.id);
    const st = job?.state ?? {};
    const tr = scripts[i];
    const mood = moodOf(s, job, tr, now);

    workers.push({
      key: job ? `job:${job.id}` : `pid:${s.pid}`,
      jobId: job?.id ?? null,
      pid: s.pid,
      sessionId: s.sessionId ?? null,
      name: s.name || roomKeyOf(s.cwd) || `pid ${s.pid}`,
      title: tr?.title || '',
      cwd: s.cwd ?? '',
      // 화면·설정이 쓰는 방 이름. 묶기가 켜져 있으면 묶음 이름이 온다.
      room: groupOf(s.cwd, groups) ?? roomKeyOf(s.cwd),
      // **근태가 쓰는 방 이름 — 언제나 작업 디렉터리 그대로다.** 묶기 규칙이 바뀌어도 과거
      // 기록과 이어지도록 갈라 뒀다(main/rooms.mjs 머리말).
      histRoom: roomKeyOf(s.cwd),
      kind: s.kind === 'bg' ? 'bg' : 'interactive',
      status: s.status ?? 'idle',
      mood,
      // 헤매기 직전인가 — mood는 그대로 typing이고 화면에 말줄임만 얹는다
      slowing: isSlowing(tr, mood, now),
      // 서버 쪽 문제로 응답을 못 받고 있는가 — 이것도 mood를 갈아치우지 않고 표시만 얹는다.
      // 화면에서는 머리 위로 별이 돌고 몸이 좌우로 갸우뚱한다.
      broken: isBroken(tr, now),
      // 잡은 state.json의 detail이 가장 최신. 터미널 세션은 그런 파일이 없으니
      // 자리를 비운 사용자에게 남긴 요약(away_summary) → 마지막으로 한 말 순으로 대신한다.
      detail: trimText(st.detail || tr?.summary || tr?.lastMessage || ''),
      // 백그라운드 잡은 state.json에 needs를 남기지만 터미널 세션은 그런 파일이 없다.
      // Notification 훅을 심어 두면 권한 확인·선택지 문구가 그때 그대로 들어온다.
      needs: trimText(st.needs || noteNeeds(notes.get(sessionIdOf(s, job)), s.statusUpdatedAt), 160) || null,
      suggestedReply: trimText(st.suggestedReply || '', 160) || null,
      // 잡은 state.json에 누적 토큰을 남긴다. 터미널 세션은 그게 없어 트랜스크립트에서
      // 계산한 컨텍스트 토큰으로 대신한다 — 같은 척도라 잡 쪽 숫자와도 얼추 맞는다.
      tokens: Number(st.tokens || 0) || Number(tr?.context?.tokens || 0),
      links: mergeLinks(st.children, tr?.links),
      intent: trimText(st.intent || '', 160),
      // 트랜스크립트 쪽이 우선이다 — 그 세션이 직접 남긴 기록이다. 다만 한 턴이 길면 지시가
      // 꼬리 320KB 밖으로 밀려나 사라지므로, 그때는 프롬프트 이력에서 같은 세션의 마지막 줄을 쓴다.
      lastPrompt: trimText(tr?.lastPrompt || lastPromptFor(promptLog, sessionIdOf(s, job)), 200),
      aides: aidesOf(st, tr),
      // 세션이 세운 할 일. 안 쓰는 세션이 대부분이라 null이 기본이다.
      tasks: todos[i] ?? null,
      // 플랜 모드로 승인받은 계획 (ExitPlanMode의 planFilePath). 꼬리 밖으로 밀려나면 null.
      plan: tr?.plan ?? null,
      // 만진 파일 수·편집 횟수. 파일 **이름**은 해시라서 얻을 수 없다(main/files.mjs).
      files: touched[i] ?? null,
      mode: tr?.mode || null,
      model: tr?.model || null,
      context: tr?.context ?? null,
      startedAt: s.startedAt ?? null,
      updatedAt: s.updatedAt ?? null,
      // status가 바뀐 절대 시각. 같은 status로 머무는 동안엔 갱신되지 않으므로(실측)
      // mood가 'waiting'이면 이 값이 곧 **기다리기 시작한 시각**이다.
      //
      // 상대값(경과 ms)으로 넘기지 않는 이유가 두 가지다. 스냅샷이 늦게 와도 렌더러가 1초마다
      // 스스로 셀 수 있고, 매 틱 값이 달라지지 않아 아래 tick()의 중복 전송 차단이 실제로 걸린다.
      statusAt: s.statusUpdatedAt ?? null,
      timeline: timelineOf(job, tr),
    });
  });

  // 살아있지 않지만 최근에 끝난 잡 — 캐릭터로는 안 그리고 "퇴근" 목록에만
  const recent = [];
  for (const job of jobs.values()) {
    if (seenJobs.has(job.id)) continue;
    const last = job.timeline.at(-1);
    const at = last?.at ? Date.parse(last.at) : 0;
    if (!at || now - at > RECENT_DONE_MS) continue;
    recent.push({
      key: `job:${job.id}`,
      jobId: job.id,
      name: job.state.name || job.state.intent || job.id,
      state: job.state.state || 'done',
      detail: trimText(job.state.detail || '', 200),
      tokens: Number(job.state.tokens || 0),
      links: mergeLinks(job.state.children),
      at,
    });
  }
  recent.sort((a, b) => b.at - a.at);

  // 빈 예비 슬롯은 사무실에서 뺀다. 숨기기만 하면 "있는데 안 보이는 것"이 되므로
  // 개수는 stats.spare로 넘겨 패널에 적는다.
  const spare = workers.filter(isSpare);
  const staff = spare.length ? workers.filter((w) => !isSpare(w)) : workers;

  // 방 = 작업 디렉터리
  const byRoom = new Map();
  for (const w of staff) {
    if (!byRoom.has(w.room)) {
      byRoom.set(w.room, { key: w.room, label: labelOf(w.room, alias), cwd: w.cwd, workers: [] });
    }
    byRoom.get(w.room).workers.push(w);
  }
  const rooms = [...byRoom.values()].sort(
    (a, b) => b.workers.length - a.workers.length || a.key.localeCompare(b.key),
  );
  for (const r of rooms) r.workers.sort((a, b) => (a.startedAt ?? 0) - (b.startedAt ?? 0));

  const ctxs = staff.map((w) => w.context?.pct).filter((p) => p != null);
  const stats = {
    total: staff.length,
    typing: staff.filter((w) => w.mood === 'typing').length,
    // 헤매는 자리는 typing에 섞지 않는다 — 섞으면 "작업 중 5"가 되고 구분한 뜻이 사라진다
    stuck: staff.filter((w) => w.mood === 'stuck').length,
    waiting: staff.filter((w) => w.mood === 'waiting').length,
    idle: staff.filter((w) => ['idle', 'done', 'stopped'].includes(w.mood)).length,
    failed: staff.filter((w) => w.mood === 'failed').length,
    tokens: staff.reduce((a, w) => a + w.tokens, 0),
    contextMax: ctxs.length ? Math.max(...ctxs) : null,
    aides: staff.reduce((a, w) => a + w.aides.length, 0),
    spare: spare.length,
  };

  return { ts: now, rooms, recent: recent.slice(0, 12), stats, usage };
}
