// 방을 어떻게 묶고 무엇으로 부를지.
//
// 방 = 작업 디렉터리라서 모노레포나 워크트리를 쓰면 방이 열 개씩 뜬다. 검색·고정·접기는
// **다 그린 다음 가려 주는** 것이고, 이건 애초에 하나로 세는 것이다.
//
// ## 근태 기록과 어긋나지 않게
//
// 방 이름은 근태(main/history.mjs)가 남기는 유일한 식별자다. 묶기가 그걸 바꾸면 과거 기록과
// 이어지지 않는다 — 어제까지 `web`으로 쌓인 시간이 오늘부터 `repo`로 들어가면 둘 다 반쪽이 된다.
//
// 그래서 갈랐다. **근태는 언제나 작업 디렉터리 이름 그대로 남긴다**(`histRoom`), 묶기와 별칭은
// 화면·설정에만 쓴다(`room`). 지난 기록은 지난 이름으로 읽히고, 사무실은 지금 규칙으로 보인다.
import path from 'node:path';
import { roomKeyOf } from './paths.mjs';

// 경로 비교용 정규화. Windows는 대소문자를 안 가리고 구분자가 둘이다.
function norm(p) {
  return String(p ?? '')
    .replace(/[\\/]+/g, '/')
    .replace(/\/+$/, '')
    .toLowerCase();
}

// 묶을 부모 경로 목록. 손으로 고친 settings.json이 앱을 못 뜨게 하지 않도록 좁게 받는다.
export function sanitizeGroups(v) {
  if (!Array.isArray(v)) return [];
  const seen = new Set();
  const out = [];
  for (const p of v) {
    if (typeof p !== 'string' || !p.trim()) continue;
    const key = norm(p);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(p);
  }
  return out.slice(0, 40);
}

// 방 이름 → 손으로 붙인 별칭. 빈 문자열은 "별칭 없음"이라 버린다.
export function sanitizeAlias(v) {
  const out = {};
  if (!v || typeof v !== 'object') return out;
  for (const [key, name] of Object.entries(v)) {
    if (typeof key !== 'string' || !key) continue;
    if (typeof name !== 'string') continue;
    const trimmed = name.replace(/\s+/g, ' ').trim().slice(0, 40);
    if (trimmed) out[key] = trimmed;
  }
  return out;
}

// 이 작업 디렉터리가 어느 묶음에 드는가. 안 들면 null.
//
// **가장 깊이 맞는 것을 고른다** — `D:\repo`와 `D:\repo\packages`가 둘 다 등록돼 있으면
// 더 구체적인 쪽이 이긴다. 경계는 구분자로 끊어 본다(`D:\repo`가 `D:\repository`를 먹지 않게).
export function groupOf(cwd, groups) {
  const target = norm(cwd);
  if (!target || !groups?.length) return null;
  let best = null;
  for (const raw of groups) {
    const prefix = norm(raw);
    if (!prefix || target === prefix) continue; // 자기 자신은 묶음이 아니다
    if (!target.startsWith(prefix + '/')) continue;
    if (!best || prefix.length > norm(best).length) best = raw;
  }
  return best ? roomKeyOf(best) : null;
}

// 화면에 쓸 방 이름. 별칭이 있으면 그것, 없으면 key 그대로.
export function labelOf(key, alias) {
  return alias?.[key] || key;
}

// 이 방을 묶을 때 등록할 부모 경로. 설정 창의 "부모로 묶기"가 이 값을 보낸다 —
// 사용자가 경로를 손으로 적지 않게 하려는 것이다.
export function parentOf(cwd) {
  if (!cwd) return '';
  const parent = path.dirname(String(cwd).replace(/[\\/]+$/, ''));
  // 루트(`D:\`·`/`)까지 올라가면 묶을 것이 없다 — 온 사무실이 한 방이 된다
  return !parent || parent === cwd || /^([a-zA-Z]:[\\/]?|[\\/])$/.test(parent) ? '' : parent;
}
