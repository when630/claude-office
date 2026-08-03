// 이 세션이 만진 파일 — `~/.claude/file-history/<sessionId>/<경로해시>@v<버전>`.
//
// 엔트리 하나가 **파일 내용 스냅샷**이다(실측: tsx 원본 7,885바이트가 그대로 들어 있었다).
// 편집할 때마다 `@v2` · `@v3`처럼 새 엔트리가 생긴다.
//
// **파일 이름은 얻을 수 없다.** 엔트리 이름이 경로의 해시(`06baf9de0651d69c`)고 파일 안에도
// 경로 메타가 없다 — 해시에서 경로를 되돌릴 방법이 없다. 그래서 여기서 낼 수 있는 것은
// "몇 개를 만졌나 / 몇 번 고쳤나"까지다. 경로가 필요하면 트랜스크립트의 `Edit`/`Write`
// tool_use에서 따로 가져와야 하고 그건 이 파일의 일이 아니다.
//
// 그 대신 **내용을 열지 않는다.** 디렉터리 이름만 읽으니 싸고, 남의 소스 코드를 앱 메모리에
// 올리지 않으며, 경로를 모르니 프라이버시 문제도 애초에 생기지 않는다.
import fs from 'node:fs/promises';
import path from 'node:path';
import { CLAUDE_DIR } from './paths.mjs';

const cache = new Map(); // 디렉터리 → { mtimeMs, count, value }

// 여기서는 **디렉터리 mtime을 캐시 열쇠로 써도 된다.** 할 일 목록(main/tasks.mjs)과 다른 점은
// 편집이 기존 엔트리를 덮어쓰지 않고 새 버전 엔트리를 **추가**한다는 것이다 — 추가는 NTFS에서도
// 디렉터리 mtime을 바꾼다. 엔트리 수도 같이 열쇠에 넣어 혹시 모를 경우를 막는다.
export async function readTouchedFiles(sessionId) {
  if (!sessionId) return null;
  const dir = path.join(CLAUDE_DIR, 'file-history', sessionId);

  let st;
  try {
    st = await fs.stat(dir);
  } catch {
    return null; // 이 세션은 아직 아무것도 안 고쳤다
  }

  let names;
  try {
    names = await fs.readdir(dir);
  } catch {
    return null;
  }
  // `.`으로 시작하는 잠금·표식 파일은 세지 않는다
  const entries = names.filter((n) => !n.startsWith('.'));
  if (!entries.length) return null;

  const hit = cache.get(dir);
  if (hit && hit.mtimeMs === st.mtimeMs && hit.count === entries.length) return hit.value;

  // `<해시>@v<버전>` — `@` 앞이 파일 하나를 가리킨다. 버전이 여럿이면 그만큼 고친 것이다.
  const seen = new Set();
  for (const name of entries) {
    const at = name.lastIndexOf('@');
    seen.add(at > 0 ? name.slice(0, at) : name);
  }

  const value = { files: seen.size, edits: entries.length, at: st.mtimeMs };
  if (cache.size > 200) cache.clear();
  cache.set(dir, { mtimeMs: st.mtimeMs, count: entries.length, value });
  return value;
}
