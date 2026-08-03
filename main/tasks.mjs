// 세션이 스스로 세운 할 일 목록 — `~/.claude/tasks/<sessionId>/<n>.json`.
//
// 항목 하나가 파일 하나다. 실측한 필드는 늘 같았다(45개 전수):
//   { id, subject, description, activeForm, status, blocks, blockedBy }
// status 어휘는 셋뿐이다 — `pending` · `in_progress` · `completed`.
//
// **대부분 세션은 할 일을 안 쓴다.** 실측 32개 디렉터리 중 항목이 있는 것은 4개였고 나머지는
// `.lock`·`.highwatermark`만 있었다. 그래서 이 함수는 null을 자주 돌려주고, 화면 쪽은
// "있으면 보여주는" 것으로 짜야 한다 — 없을 때 빈 칸이 남으면 안 된다.
import fs from 'node:fs/promises';
import path from 'node:path';
import { CLAUDE_DIR } from './paths.mjs';

// 패널에 늘어놓을 최대 개수. 실측 최대가 18이라 넉넉하다 — 넘치면 앞에서 자른다.
const MAX_ITEMS = 40;

const cache = new Map(); // 디렉터리 → { sig, value }

// 캐시 열쇠를 **파일마다의 mtime+크기**로 잡는다.
//
// 디렉터리 mtime으로는 안 된다: NTFS에서 이미 있는 파일을 덮어써도 **디렉터리 mtime은 안 바뀐다.**
// 할 일의 status가 바뀌는 것은 항목이 추가되는 게 아니라 `<n>.json`을 제자리에서 다시 쓰는
// 일이라, 디렉터리만 보면 `pending`에서 `completed`로 넘어간 것을 영원히 못 본다.
function signature(stats) {
  return stats.map(([name, st]) => `${name}:${st.mtimeMs}:${st.size}`).join('|');
}

// 이 항목이 아직 못 시작하는 상태인가 — 나를 막는 것 중에 안 끝난 것이 있으면 막힌 것이다.
// blockedBy는 항목 id를 담으므로 같은 목록 안에서만 찾으면 된다.
function blockedBy(item, statusById) {
  const list = Array.isArray(item.blockedBy) ? item.blockedBy : [];
  return list.filter((id) => statusById.get(String(id)) !== 'completed').map(String);
}

// id는 파일명이자 문자열("11")이다. 문자열로 정렬하면 11이 2보다 앞에 오므로 수로 센다.
function byId(a, b) {
  const na = Number(a.id);
  const nb = Number(b.id);
  if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
  return String(a.id).localeCompare(String(b.id));
}

function trim(s, n) {
  if (typeof s !== 'string') return '';
  const flat = s.replace(/\s+/g, ' ').trim();
  return flat.length > n ? flat.slice(0, n - 1) + '…' : flat;
}

// 세션 하나의 할 일. 목록이 없으면(대부분) null.
export async function readTasks(sessionId) {
  if (!sessionId) return null;
  const dir = path.join(CLAUDE_DIR, 'tasks', sessionId);

  let names;
  try {
    names = (await fs.readdir(dir)).filter((f) => /^\d+\.json$/.test(f));
  } catch {
    return null; // 디렉터리가 아예 없다
  }
  if (!names.length) return null; // .lock·.highwatermark만 있는 빈 방

  const stats = [];
  await Promise.all(
    names.map(async (name) => {
      try {
        stats.push([name, await fs.stat(path.join(dir, name))]);
      } catch {
        /* 방금 지워졌다 */
      }
    }),
  );
  if (!stats.length) return null;
  stats.sort((a, b) => a[0].localeCompare(b[0]));

  const sig = signature(stats);
  const hit = cache.get(dir);
  if (hit && hit.sig === sig) return hit.value;

  const raw = await Promise.all(
    stats.map(async ([name]) => {
      try {
        return JSON.parse(await fs.readFile(path.join(dir, name), 'utf8'));
      } catch {
        return null; // 쓰는 도중이라 반쪽인 파일
      }
    }),
  );
  const parsed = raw.filter((j) => j && j.subject).sort(byId);
  if (!parsed.length) return null;

  const statusById = new Map(parsed.map((j) => [String(j.id), j.status]));
  const items = parsed.slice(0, MAX_ITEMS).map((j) => ({
    id: String(j.id),
    subject: trim(j.subject, 120),
    // 진행 중인 항목만 activeForm을 쓴다 — 말풍선에 실어 보내는 것이 이 값이다
    activeForm: trim(j.activeForm, 60),
    status: j.status === 'completed' || j.status === 'in_progress' ? j.status : 'pending',
    blockedBy: blockedBy(j, statusById),
  }));

  const value = {
    total: parsed.length,
    done: parsed.filter((j) => j.status === 'completed').length,
    // 여럿이 동시에 in_progress일 수 있다(실측). 말풍선은 첫 놈만 쓰고 패널은 다 보여준다.
    active: items.filter((i) => i.status === 'in_progress'),
    blocked: items.filter((i) => i.status !== 'completed' && i.blockedBy.length).length,
    items,
  };

  if (cache.size > 200) cache.clear();
  cache.set(dir, { sig, value });
  return value;
}
