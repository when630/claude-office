// Claude Code가 스스로 계산해 두는 통계 — `~/.claude/stats-cache.json`.
//
// 왜 읽는가: 근태(main/history.mjs)는 **앱이 돌던 동안만** 기록한다. 껐다 켠 사이는 볼 수
// 없었으니 세면 거짓이 된다. 그 구멍을 메울 유일한 후보가 Claude Code 자신의 집계다.
//
// ## 언제 갱신되는가 (번들을 뜯어 확인했다)
//
// 갱신은 **통계 화면을 열 때만** 일어난다. 주기적으로 도는 것이 아니다. 대략 이렇게 돈다.
//
//   const cache = readCache();
//   if (!cache.lastComputedDate)            → 전체 히스토리를 스캔해 캐시를 만든다
//   else if (cache.lastComputedDate < 어제) → 빠진 날만 스캔해 병합하고 다시 쓴다
//   결과 = 캐시 + (오늘분은 매번 트랜스크립트를 다시 스캔)
//
// 그래서 두 가지가 따라온다.
//
//  1) `lastComputedDate`가 오래됐다는 것은 **데이터가 없다는 뜻이 아니라 그동안 통계 화면을
//     안 봤다는 뜻**이다. 실측한 내 파일은 한 달째 그대로였다
//  2) 캐시는 **어제까지만** 담는다. 오늘분은 애초에 여기 없다
//
// ## 그래서 이 파일이 지키는 것
//
// - **읽기만 한다. 절대 쓰지 않는다.** Claude Code가 잠금까지 걸고 쓰는 파일이다 —
//   끼어들면 남의 캐시를 깨뜨린다
// - `lastComputedDate`를 그대로 실어 보내 **어디까지의 기록인지 화면에 적게** 한다.
//   낡은 숫자를 현재값처럼 보여주면 그게 거짓말이 된다(사용량의 stale 표시와 같은 원칙)
// - **방별로는 못 쓴다.** `dailyActivity`에 프로젝트별 분해가 없다(전체 합계뿐). 그래서
//   출근부의 방별 표와 나란히 놓을 수 없고, 출처를 밝힌 별도 자리여야 한다
import fs from 'node:fs/promises';
import path from 'node:path';
import { CLAUDE_DIR } from './paths.mjs';

const STATS_FILE = path.join(CLAUDE_DIR, 'stats-cache.json');

// 화면에 늘어놓을 일수. 파일에는 그보다 많이 들어 있을 수 있다(실측 28일).
const DAYS = 28;
// 모델별 토큰은 많이 쓴 쪽 몇 개만.
const MODELS = 4;

let cache = null; // { size, mtimeMs, value }

function num(v) {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

// `YYYY-MM-DD` → 로컬 자정. 날짜 문자열을 그대로 Date에 넣으면 UTC로 해석돼 하루가 밀린다.
function dayMs(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s ?? ''));
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime();
}

// 모델별 토큰 합계. statusline과 같은 셈법(입력 + 캐시 생성 + 캐시 읽기 + 출력)으로 뭉친다 —
// 여기서 알고 싶은 것은 "어느 모델을 많이 썼나"이지 캐시 적중률이 아니다.
function modelTotals(usage) {
  if (!usage || typeof usage !== 'object') return [];
  return Object.entries(usage)
    .map(([model, u]) => ({
      model,
      tokens: num(u?.inputTokens) + num(u?.cacheCreationInputTokens) + num(u?.cacheReadInputTokens) + num(u?.outputTokens),
    }))
    .filter((m) => m.tokens > 0)
    .sort((a, b) => b.tokens - a.tokens)
    .slice(0, MODELS);
}

// Claude Code의 집계. 파일이 없거나 모양이 다르면 null — 그러면 화면에서 이 자리가 사라진다.
export async function readCodeStats() {
  let st;
  try {
    st = await fs.stat(STATS_FILE);
  } catch {
    return null;
  }
  if (cache && cache.size === st.size && cache.mtimeMs === st.mtimeMs) return cache.value;

  let j;
  try {
    j = JSON.parse(await fs.readFile(STATS_FILE, 'utf8'));
  } catch {
    return null; // 쓰는 도중이거나 모양이 바뀌었다
  }
  if (!Array.isArray(j?.dailyActivity)) return null;

  const days = j.dailyActivity
    .filter((d) => dayMs(d?.date) != null)
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-DAYS)
    .map((d) => ({
      date: d.date,
      at: dayMs(d.date),
      messages: num(d.messageCount),
      sessions: num(d.sessionCount),
      tools: num(d.toolCallCount),
    }));

  // 시간대 분포는 `{ "9": 27, … }` 꼴이다. 0~23을 다 채워 보내 화면이 빈 칸을 고민하지 않게 한다.
  const hourCounts = j.hourCounts && typeof j.hourCounts === 'object' ? j.hourCounts : {};
  const hours = Array.from({ length: 24 }, (_, h) => num(hourCounts[String(h)]));

  const value = {
    // 신뢰 구간의 끝. 화면은 이걸로 "어디까지의 기록"인지 적는다.
    computedTo: j.lastComputedDate ?? null,
    computedToAt: dayMs(j.lastComputedDate),
    // 파일이 마지막으로 쓰인 시각 — 통계 화면을 마지막으로 본 시각이기도 하다
    at: st.mtimeMs,
    days,
    hours,
    models: modelTotals(j.modelUsage),
    totalSessions: num(j.totalSessions),
    totalMessages: num(j.totalMessages),
    longestSessionMs: num(j.longestSession?.duration),
    firstAt: j.firstSessionDate ? Date.parse(j.firstSessionDate) || null : null,
  };

  cache = { size: st.size, mtimeMs: st.mtimeMs, value };
  return value;
}

// 이 집계가 담고 있지 않은 날이 며칠인가. 0이면 어제까지 다 들어 있다.
//
// 캐시는 설계상 **어제까지만** 담으므로 오늘은 애초에 빠진 것으로 세지 않는다 —
// 그걸 세면 늘 "1일 빠졌다"가 되어 표시가 의미를 잃는다.
export function staleDays(stats, now = Date.now()) {
  if (!stats?.computedToAt) return null;
  const yesterday = new Date(now);
  yesterday.setHours(0, 0, 0, 0);
  yesterday.setDate(yesterday.getDate() - 1);
  const gap = Math.round((yesterday.getTime() - stats.computedToAt) / 86_400_000);
  return gap > 0 ? gap : 0;
}
