// 세션 트랜스크립트(~/.claude/projects/<cwd>/<sessionId>.jsonl)에서 "지금 무슨 일을 하는지"를 캐낸다.
//
// 왜 필요한가: 백그라운드 잡은 ~/.claude/jobs/<id>/state.json에 detail·needs·tokens를 남기지만,
// 터미널 세션(kind: interactive)은 그런 파일이 없다. 그래서 예전에는 터미널 세션 카드가
// 이름·PID만 있는 빈 껍데기였다. 트랜스크립트에는 양쪽 모두에 대해 다음이 들어 있다.
//
//   {"type":"ai-title","aiTitle":"..."}                    세션 제목 (Claude가 붙인다)
//   {"type":"last-prompt","lastPrompt":"..."}              마지막으로 받은 지시
//   {"type":"system","subtype":"away_summary","content":…}  자리를 비운 사용자에게 남긴 요약
//   {"type":"pr-link","prNumber":170,"prUrl":"..."}        연결된 MR
//   {"type":"mode","mode":"normal"}                        현재 모드
//   {"type":"assistant","message":{"model":…,"usage":{…}}} 컨텍스트 사용량
//   {"type":"user"|"assistant","timestamp":"…"}            턴 경계 → 타임라인
//
// 파일이 수십 MB까지 자라므로 뒤쪽 일부만 읽고, 크기·mtime이 그대로면 캐시를 재사용한다.
import fs from 'node:fs/promises';
import path from 'node:path';
import { CLAUDE_DIR } from './paths.mjs';

const TAIL_BYTES = 320 * 1024; // 마지막 몇 턴이면 충분하다
const MAX_LINE = 200 * 1024; // 이보다 긴 줄은 파싱 비용이 아까워 건너뛴다
// 결과를 끝까지 기다리는 옛 방식(동기) Agent 호출만 이 범위에서 찾는다. 아주 옛날에
// 죽은 채로 남은 호출까지 세지 않으려는 것이다.
const AGENT_LOOKBACK = 500;
// 비동기 에이전트는 "끝났다"는 알림이 따로 오므로 줄 수로 자르지 않는다. 대신 알림 없이
// 이만큼 오래된 호출은 세션이 중간에 죽어 남은 유령으로 본다.
const AIDE_MAX_AGE_MS = 3 * 60 * 60 * 1000;
const MAX_AIDES = 4;
// 타임라인에 쓸 턴 개수. 패널은 6개만 보여주는데, 주운 것 중 일부가 걸러질 수 있어 여유를 둔다.
// 뒤에서부터 이만큼 모으면 파싱을 멈추므로 훑는 줄 수의 상한 노릇도 한다.
const MAX_TURNS = 8;

// 모델별 컨텍스트 창 크기. 확인 시점 2026-07 기준 — 1M 계열이 기본이고 haiku만 200K다.
// 모델 id에 `[1m]`이 붙어 오는 경우(예: claude-opus-4-8[1m])도 1M로 본다.
const CONTEXT_LIMITS = [
  [/\[1m\]/i, 1_000_000],
  [/haiku/i, 200_000],
  [/(fable|mythos)-5/i, 1_000_000],
  [/opus-(5|4-6|4-7|4-8)/i, 1_000_000],
  [/sonnet-(5|4-6)/i, 1_000_000],
];
const DEFAULT_LIMIT = 200_000; // 그보다 옛 모델(4-5, 3-x 등)

export function contextLimitFor(model) {
  if (!model) return null;
  for (const [re, limit] of CONTEXT_LIMITS) if (re.test(model)) return limit;
  return DEFAULT_LIMIT;
}

// Claude Code는 cwd의 영숫자 아닌 문자를 전부 '-'로 바꿔 프로젝트 폴더를 만든다.
// (D:\AIProject\gowrite → D--AIProject-gowrite)
export function projectDirName(cwd) {
  return String(cwd ?? '').replace(/[^a-zA-Z0-9]/g, '-');
}

const missDirCache = new Map(); // sessionId → 실제 파일 경로 (규칙이 안 맞을 때 찾아낸 것)

async function findByScan(sessionId) {
  if (missDirCache.has(sessionId)) return missDirCache.get(sessionId);
  const root = path.join(CLAUDE_DIR, 'projects');
  let found = null;
  try {
    for (const e of await fs.readdir(root, { withFileTypes: true })) {
      if (!e.isDirectory()) continue;
      const candidate = path.join(root, e.name, `${sessionId}.jsonl`);
      try {
        await fs.access(candidate);
        found = candidate;
        break;
      } catch {
        /* 이 폴더엔 없다 */
      }
    }
  } catch {
    /* projects 폴더가 없다 */
  }
  missDirCache.set(sessionId, found);
  return found;
}

async function locate(cwd, sessionId) {
  const guess = path.join(CLAUDE_DIR, 'projects', projectDirName(cwd), `${sessionId}.jsonl`);
  try {
    await fs.access(guess);
    return guess;
  } catch {
    return findByScan(sessionId);
  }
}

async function readTail(file, size) {
  let fh;
  try {
    fh = await fs.open(file, 'r');
    const start = Math.max(0, size - TAIL_BYTES);
    const len = size - start;
    if (len <= 0) return '';
    const buf = Buffer.alloc(len);
    await fh.read(buf, 0, len, start);
    const text = buf.toString('utf8');
    return start > 0 ? text.slice(text.indexOf('\n') + 1) : text; // 앞이 잘린 줄은 버린다
  } catch {
    return null;
  } finally {
    await fh?.close();
  }
}

// 트랜스크립트에 담긴 말은 마크다운이다. 표·코드블록·굵게 표시가 그대로 말풍선에
// 들어가면 읽히지 않으니 한 줄 텍스트로 눌러 편다.
function flat(s, n) {
  if (typeof s !== 'string') return '';
  const one = s
    .replace(/```[\s\S]*?```/g, ' ') // 코드 블록은 통째로 버린다
    .split('\n')
    .filter((l) => !/^\s*\|/.test(l) && !/^\s*[-=|:]{3,}\s*$/.test(l)) // 표·구분선
    .map((l) =>
      l
        .replace(/^\s*#{1,6}\s+/, '') // 제목
        .replace(/^\s*>\s?/, '') // 인용
        .replace(/^\s*[-*+]\s+/, '· '), // 목록
    )
    .join(' ')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1') // 링크·이미지는 글자만
    .replace(/`|\*\*|__/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return one.length > n ? one.slice(0, n) + '…' : one;
}

// 여러 content 블록에 나뉘어 온 assistant 텍스트를 한 줄로 합친다.
function textOf(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .filter((b) => b?.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text)
    .join(' ');
}

// user 줄에는 사용자가 친 말이 아닌 것도 섞여 온다. 도구 결과는 턴이 아니고,
// 슬래시 명령은 태그 블록으로 오므로 "/이름 인자"로 펴고, 캐비어트·리마인더처럼
// 시스템이 끼워 넣은 것은 버린다 (isMeta가 안 붙어 오는 경우가 있다).
function promptText(content) {
  if (Array.isArray(content) && content.some((b) => b?.type === 'tool_result')) return '';
  const raw = textOf(content);
  if (!raw) return '';
  const name = raw.match(/<command-name>([^<]*)<\/command-name>/);
  if (name) {
    const args = raw.match(/<command-args>([^<]*)<\/command-args>/);
    return `${name[1].trim()} ${args?.[1]?.trim() ?? ''}`.trim();
  }
  if (/<(local-command-caveat|system-reminder|command-message|command-stdout|command-output)>/.test(raw)) return '';
  return raw;
}

// 지금 돌고 있는 서브에이전트("비서")를 찾는다.
//
// 함정: 요즘 Agent 도구는 **비동기로 띄우고 곧바로 결과를 돌려준다.**
//   {"toolUseResult":{"status":"async_launched","agentId":"a28…","description":"…"}}
// 그래서 "tool_result가 안 온 tool_use"로 찾으면 에이전트가 몇 분을 돌아도 뜨는 시간은
// 2~3초뿐이다 — 비서가 안 보이던 이유다. 끝났다는 건 나중에 별도 줄로 온다.
//   {"origin":{"kind":"task-notification"}, content:"<task-notification><task-id>a28…"}
// 멈춘 에이전트에게 SendMessage로 다시 시키면 알림 없이 또 돈다.
//
// 그래서 agentId마다 **마지막 사건**을 본다: 띄움·재개면 돌고 있는 것, 알림이면 끝난 것.
// 뒤에서 앞으로 훑으니 처음 만난 사건이 곧 마지막 사건이다.
function scanAides(lines) {
  const seen = new Map(); // agentId → { alive, i, label }
  const kindByTool = new Map(); // Agent tool_use id → subagent_type
  const toolByAgent = new Map(); // agentId → 그 에이전트를 띄운 tool_use id
  const doneTools = new Set(); // 결과가 이미 온 tool_use id (동기 호출을 걸러내는 데 쓴다)
  const sync = []; // 결과를 기다리는 중인 옛 방식 호출

  // 알림 없이 오래 남은 호출은 세션이 중간에 죽은 흔적이다 — 유령을 세우지 않는다.
  const fresh = (ts) => {
    const at = Date.parse(ts || '');
    return !at || Date.now() - at < AIDE_MAX_AGE_MS;
  };
  const mark = (id, alive, i) => {
    if (id && !seen.has(id)) seen.set(id, { alive, i, label: '' });
  };

  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (!line || line.length > MAX_LINE) continue;

    // 결과 id는 JSON 파싱 없이 훑는다 — tool_result 줄이 제일 크다
    if (line.includes('"tool_use_id"')) {
      for (const m of line.matchAll(/"tool_use_id":"([^"]+)"/g)) doneTools.add(m[1]);
    }

    const notify = line.includes('<task-id>');
    const launch = line.includes('"async_launched"');
    const send = line.includes('"name":"SendMessage"');
    const call = line.includes('"name":"Agent"');
    if (!notify && !launch && !send && !call) continue;

    let o;
    try {
      o = JSON.parse(line);
    } catch {
      continue; // 쓰는 중이라 깨진 줄
    }

    // 끝났다는 알림. 같은 알림이 queue-operation 줄과 user 줄로 두 번 온다.
    // 남의 대화를 인용한 글에 <task-id>가 섞여 들어오는 수가 있어 알림 줄인지부터 본다.
    if (notify) {
      const body =
        (o.type === 'queue-operation' && typeof o.content === 'string' && o.content) ||
        (o.origin?.kind === 'task-notification' && typeof o.message?.content === 'string'
          ? o.message.content
          : '');
      if (body.startsWith('<task-notification>')) {
        mark(body.match(/<task-id>([^<]+)<\/task-id>/)?.[1], false, i);
      }
    }

    // 비동기로 띄운 순간. 이름표(description)는 여기에만 있으므로 재개된 놈에게도 채워 준다.
    const res = o.toolUseResult;
    if (launch && res?.status === 'async_launched' && res.agentId) {
      mark(res.agentId, fresh(o.timestamp), i);
      const e = seen.get(res.agentId);
      if (e?.alive) {
        if (!e.label) e.label = flat(res.description ?? '', 60);
        const tid = Array.isArray(o.message?.content)
          ? o.message.content.find((b) => b?.type === 'tool_result')?.tool_use_id
          : null;
        if (tid && !toolByAgent.has(res.agentId)) toolByAgent.set(res.agentId, tid);
      }
    }

    if (o.type !== 'assistant' || !Array.isArray(o.message?.content)) continue;
    for (const b of o.message.content) {
      if (b?.type !== 'tool_use') continue;
      // 멈춘 에이전트에게 다시 시켰다 = 또 돌고 있다. 다시 시킨 말(summary)을 이름표로 쓴다 —
      // 오래 도는 놈은 띄운 줄이 꼬리 밖으로 밀려나 원래 지시를 못 읽는 경우가 많다.
      if (send && b.name === 'SendMessage' && typeof b.input?.to === 'string') {
        mark(b.input.to, fresh(o.timestamp), i);
        const e = seen.get(b.input.to);
        if (e?.alive && !e.label) e.label = flat(b.input.summary ?? '', 60);
      }
      if (!call || b.name !== 'Agent') continue;
      kindByTool.set(b.id, flat(b.input?.subagent_type ?? '', 24) || 'agent');
      // 옛 방식(동기) 호출: 결과가 아직 안 왔으면 그놈이 지금 일하고 있다
      if (!doneTools.has(b.id) && lines.length - i <= AGENT_LOOKBACK) {
        sync.push({ id: b.id, kind: kindByTool.get(b.id), label: flat(b.input?.description ?? '', 60) });
      }
    }
  }

  const live = [...seen]
    .filter(([, e]) => e.alive)
    .sort((a, b) => a[1].i - b[1].i) // 띄운 순서대로 세운다
    .map(([id, e]) => ({ id, kind: kindByTool.get(toolByAgent.get(id)) ?? 'agent', label: e.label }));
  return [...live, ...sync.reverse()].slice(0, MAX_AIDES);
}

// 도구가 연달아 실패하고 있는가. 같은 에러를 반복해 되받는 세션은 겉으로는 열심히 일하는
// 것과 구별되지 않는다 — 그 신호를 여기서 뽑는다.
//
// 줄 단위로 본다. 병렬 호출이면 한 줄에 결과가 여럿 들어오는데, 그 안에 하나라도 성공이
// 있으면 뭔가는 되고 있다는 뜻이라 연속을 끊는다. JSON 파싱 없이 훑는다 — tool_result 줄이
// 가장 크고, 여기서 필요한 건 참·거짓 하나뿐이다.
// 이 세션이 승인받은 계획. 플랜 모드를 빠져나올 때 `ExitPlanMode` tool_use에
// `{ plan, planFilePath }`가 실려 온다 — **세션과 계획 파일을 잇는 유일한 구조적 단서다.**
//
// 실측으로 확인한 것: 계획 경로는 `Write`·`Read`·`Agent` 줄에도 나타나지만 그건 계획을 파일로
// 쓰거나 읽은 흔적일 뿐 "이 세션이 승인받은 계획"이라는 뜻이 아니다(남의 계획을 읽었을 수도 있다).
// 그래서 `ExitPlanMode`만 본다.
//
// 비서(`scanAides`)와 같은 처지라 **따로 뒤에서 앞으로 훑는다.** 플랜은 세션 앞부분에서 한 번
// 승인되므로 본문 파싱 루프가 도중에 멈추기 전에 잘려 나간다. 같은 이유로 대화가 아주 바쁘면
// 꼬리 320KB 밖으로 밀려나 계획이 안 보일 수 있다 — 그건 비서도 같다.
//
// 제목은 `plan` 본문 첫 제목 줄에서 뽑는다. 파일이 지워졌어도 트랜스크립트에 본문이 남아 있어
// 제목만은 나온다.
export function scanPlan(lines) {
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (!line || line.length > MAX_LINE) continue;
    if (!line.includes('"name":"ExitPlanMode"')) continue;

    let o;
    try {
      o = JSON.parse(line);
    } catch {
      continue;
    }
    const content = o?.message?.content;
    if (!Array.isArray(content)) continue;
    for (const c of content) {
      if (c?.type !== 'tool_use' || c.name !== 'ExitPlanMode') continue;
      const file = typeof c.input?.planFilePath === 'string' ? c.input.planFilePath : '';
      const body = typeof c.input?.plan === 'string' ? c.input.plan : '';
      // 첫 `#` 제목 줄. 없으면 첫 비어 있지 않은 줄.
      const head = body
        .split('\n')
        .map((l) => l.trim())
        .find((l) => l.startsWith('#'));
      const first = body.split('\n').map((l) => l.trim()).find(Boolean) ?? '';
      const title = flat((head ?? first).replace(/^#+\s*/, ''), 120);
      if (!file && !title) continue;
      // 뒤에서 앞으로 훑으니 처음 만난 것이 마지막 승인이다 — 플랜을 두 번 짤 수 있다
      return { file, title, at: Date.parse(o.timestamp || '') || null };
    }
  }
  return null;
}

export function scanErrorRun(lines) {
  let run = 0;
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (!line || line.length > MAX_LINE || !line.includes('"tool_use_id"')) continue;
    if (!line.includes('"is_error":true')) break; // 성공한 결과 — 연속이 끊겼다
    run++;
  }
  return run;
}

// 뒤에서 앞으로 훑으며 각 항목의 "가장 최근 것"을 하나씩 줍는다.
function parseTail(text) {
  const out = {
    title: '',
    lastPrompt: '',
    summary: '',
    lastMessage: '',
    mode: '',
    links: [],
    usage: null,
    model: null,
    aides: [],
    plan: null,
    turns: [],
    errorRun: 0,
  };
  const lines = text.split('\n');
  const seenPr = new Set();

  // 비서는 따로 훑는다. 아래 루프는 필요한 걸 다 주우면 도중에 멈추는데,
  // 에이전트를 띄운 줄은 몇 분 전 것이라 그 전에 잘려 나가기 때문이다.
  out.aides = scanAides(lines);
  out.plan = scanPlan(lines);
  out.errorRun = scanErrorRun(lines);

  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (!line || line.length > MAX_LINE) continue;

    // assistant 줄은 전부 usage를 들고 있어 이 한 단어로 걸러낼 수 있다
    const wantsUsage = (!out.usage || !out.lastMessage) && line.includes('cache_read_input_tokens');
    // 터미널 세션은 잡의 timeline.jsonl이 없어 대화에서 턴을 주워 타임라인을 만든다.
    // tool_result 줄은 턴이 아니면서 제일 크므로 파싱 전에 떨궈낸다.
    const wantsTurn =
      out.turns.length < MAX_TURNS &&
      line.includes('"timestamp"') &&
      (line.includes('"type":"assistant"') ||
        (line.includes('"type":"user"') && !line.includes('"tool_use_id"')));
    const wantsMeta =
      (!out.title && line.includes('ai-title')) ||
      (!out.lastPrompt && line.includes('last-prompt')) ||
      (!out.summary && line.includes('away_summary')) ||
      (!out.mode && line.includes('"mode"')) ||
      (out.links.length < 6 && line.includes('pr-link'));
    if (!wantsUsage && !wantsMeta && !wantsTurn) continue;

    let o;
    try {
      o = JSON.parse(line);
    } catch {
      continue; // 쓰는 중이라 깨진 줄
    }

    switch (o.type) {
      case 'ai-title':
        if (!out.title) out.title = flat(o.aiTitle, 90);
        break;
      case 'last-prompt':
        if (!out.lastPrompt) out.lastPrompt = flat(o.lastPrompt, 200);
        break;
      case 'mode':
        if (!out.mode && typeof o.mode === 'string') out.mode = o.mode;
        break;
      case 'pr-link':
        if (o.prUrl && !seenPr.has(o.prUrl) && out.links.length < 6) {
          seenPr.add(o.prUrl);
          out.links.push({ id: String(o.prNumber ?? ''), href: o.prUrl, repo: o.prRepository ?? '' });
        }
        break;
      case 'system':
        if (!out.summary && o.subtype === 'away_summary') out.summary = flat(o.content, 400);
        break;
      case 'user': {
        // 받은 지시 한 줄 = 타임라인 한 칸. 뒤에서 앞으로 훑으니 앞쪽에 끼워 시간순을 유지한다.
        if (!wantsTurn || o.isSidechain || o.isMeta) break;
        const prompt = flat(promptText(o.message?.content), 120);
        if (prompt) out.turns.unshift({ at: o.timestamp, state: 'prompt', detail: prompt });
        break;
      }
      case 'assistant': {
        // 서브에이전트(isSidechain) 사용량은 부모 세션의 컨텍스트가 아니다
        if (o.isSidechain || !o.message) break;
        const u = o.message.usage;
        if (!out.usage && u) {
          out.usage = {
            input: Number(u.input_tokens || 0),
            cacheCreate: Number(u.cache_creation_input_tokens || 0),
            cacheRead: Number(u.cache_read_input_tokens || 0),
            output: Number(u.output_tokens || 0),
          };
          out.model = o.message.model ?? null;
        }
        // 마지막으로 사용자에게 한 말 — away_summary가 없는 터미널 세션의 "지금 상황"이 된다.
        // 도구만 호출한 턴은 텍스트가 없으니 텍스트가 나올 때까지 더 올라간다.
        if (!out.lastMessage) {
          const txt = textOf(o.message.content);
          if (txt.trim()) out.lastMessage = flat(txt, 400);
        }
        // 사용자에게 한 말 한 줄 = 타임라인 한 칸. 도구만 부른 턴은 텍스트가 없어 건너뛴다.
        if (wantsTurn && o.timestamp) {
          const said = flat(textOf(o.message.content), 120);
          if (said) out.turns.unshift({ at: o.timestamp, state: 'said', detail: said });
        }
        break;
      }
      default:
        break;
    }

    if (
      out.usage &&
      out.lastMessage &&
      out.title &&
      out.lastPrompt &&
      out.summary &&
      out.mode &&
      out.turns.length >= MAX_TURNS
    ) {
      break;
    }
  }
  return out;
}

const cache = new Map(); // 파일 경로 → { size, mtimeMs, value }

// 세션 하나의 트랜스크립트 요약. 파일이 없으면 null.
export async function readTranscript(cwd, sessionId) {
  if (!sessionId) return null;
  const file = await locate(cwd, sessionId);
  if (!file) return null;

  // 파일이 안 바뀌었으면 읽지도 않는다 — 대화 하나가 수십 MB까지 자란다
  let st;
  try {
    st = await fs.stat(file);
  } catch {
    return null;
  }
  const hit = cache.get(file);
  if (hit && hit.size === st.size && hit.mtimeMs === st.mtimeMs) return hit.value;

  const text = await readTail(file, st.size);
  if (text == null) return null;

  const parsed = parseTail(text);
  const limit = contextLimitFor(parsed.model);
  // Claude Code의 statusline이 쓰는 것과 같은 계산: 입력 + 캐시 생성 + 캐시 읽기
  const used = parsed.usage
    ? parsed.usage.input + parsed.usage.cacheCreate + parsed.usage.cacheRead
    : null;

  const value = {
    title: parsed.title,
    lastPrompt: parsed.lastPrompt,
    summary: parsed.summary,
    lastMessage: parsed.lastMessage,
    aides: parsed.aides,
    plan: parsed.plan,
    mode: parsed.mode,
    links: parsed.links,
    model: parsed.model,
    turns: parsed.turns,
    context:
      used != null && limit
        ? { tokens: used, limit, pct: Math.min(100, Math.round((used / limit) * 1000) / 10) }
        : null,
    outputTokens: parsed.usage?.output ?? 0,
    // 연달아 실패한 도구 호출 수와 대화 파일이 마지막으로 자란 시각 — 헤매는 세션을
    // 알아보는 두 신호다(main/collect.mjs의 isStuck)
    errorRun: parsed.errorRun,
    at: st.mtimeMs,
  };

  if (cache.size > 200) cache.clear();
  cache.set(file, { size: st.size, mtimeMs: st.mtimeMs, value });
  return value;
}
