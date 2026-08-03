// 내가 시킨 것 — `~/.claude/history.jsonl`.
//
// 줄 하나가 프롬프트 하나다. 실측한 모양:
//   {"display":"…","pastedContents":{},"timestamp":1785716544816,
//    "project":"D:\\AIProject\\claude-office","sessionId":"2981cdfb-…"}
//
// 이 파일이 메우는 구멍이 둘이다.
//
//  1) **근태에 없던 축.** 출근부는 게가 얼마나 일했는지만 센다 — 내가 얼마나 시켰는지는
//     어디에도 없었다. 이 파일에는 프로젝트·시각이 박혀 있어 방별로 셀 수 있다.
//  2) **꼬리 밖으로 밀려난 마지막 지시.** 트랜스크립트에서 캐내는 `lastPrompt`는 뒤쪽
//     320KB(`TAIL_BYTES`) 안에 있어야 잡힌다. 도구 결과가 그 안을 꽉 채우면 사라진다.
//
// **문장은 세지 않는다.** 근태 파일에는 개수만 남기고(정확히는 아무것도 남기지 않고 물어볼 때마다
// 이 파일을 다시 센다) 문장은 화면에 띄울 뿐이다 — 근태의 원칙이 "이름·경로·지시를 남기지
// 않는다"이므로 그 원칙을 프롬프트에도 그대로 적용한다.
import fs from 'node:fs/promises';
import { PROMPT_LOG, roomKeyOf } from './paths.mjs';

// 파일이 끝없이 자란다(Claude Code가 덜어내지 않는다). 뒤쪽만 읽는다 —
// 실측 816KB에 반년치가 들어 있었으므로 1MB면 "오늘"과 "최근 7일"에는 한참 넉넉하다.
const TAIL_BYTES = 1024 * 1024;
// 붙여넣은 내용이 실린 줄은 아주 길 수 있다. 파싱 비용이 아까워 건너뛴다.
const MAX_LINE = 256 * 1024;

let cache = null; // { size, mtimeMs, entries }

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

// 이력 줄들. 시각 오름차순. 파일이 없으면 빈 배열.
//
// 이 파일은 **내가 프롬프트를 넣을 때만** 자란다. 그래서 크기·mtime 캐시가 거의 항상 맞고,
// 1.5초 폴링마다 다시 파싱하는 일은 실제로 일어나지 않는다.
export async function readPromptLog() {
  let st;
  try {
    st = await fs.stat(PROMPT_LOG);
  } catch {
    return [];
  }
  if (cache && cache.size === st.size && cache.mtimeMs === st.mtimeMs) return cache.entries;

  const text = await readTail(PROMPT_LOG, st.size);
  if (text == null) return [];

  const entries = [];
  for (const line of text.split('\n')) {
    const s = line.trim();
    if (!s || s.length > MAX_LINE) continue;
    try {
      const j = JSON.parse(s);
      if (typeof j?.timestamp !== 'number') continue;
      entries.push({
        at: j.timestamp,
        display: typeof j.display === 'string' ? j.display : '',
        project: typeof j.project === 'string' ? j.project : '',
        sessionId: typeof j.sessionId === 'string' ? j.sessionId : '',
      });
    } catch {
      /* 쓰는 도중에 읽어 잘린 줄 */
    }
  }
  entries.sort((a, b) => a.at - b.at);

  cache = { size: st.size, mtimeMs: st.mtimeMs, entries };
  return entries;
}

// 그 세션에 마지막으로 넣은 지시. 없으면 빈 문자열.
// 뒤에서 앞으로 훑으니 처음 만난 것이 마지막이다.
export function lastPromptFor(entries, sessionId) {
  if (!sessionId) return '';
  for (let i = entries.length - 1; i >= 0; i--) {
    if (entries[i].sessionId === sessionId) return entries[i].display;
  }
  return '';
}

// [from, to] 구간에 내가 몇 번 시켰나. 방별로도 센다.
//
// **문장은 담지 않는다** — 여기서 나온 값은 출근부 화면으로 가고, 그 화면의 원칙이
// "지시 내용은 남기지도 보여주지도 않는다"다. 세는 것은 머릿수와 방 이름까지다.
export function summarizePrompts(entries, { from, to }) {
  const rooms = new Map();
  let count = 0;
  for (const e of entries) {
    if (e.at < from || e.at > to) continue;
    count++;
    const room = roomKeyOf(e.project);
    rooms.set(room, (rooms.get(room) ?? 0) + 1);
  }
  return {
    count,
    rooms: [...rooms.entries()]
      .map(([room, n]) => ({ room, count: n }))
      .sort((a, b) => b.count - a.count || a.room.localeCompare(b.room)),
  };
}
