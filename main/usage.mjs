// 계정 사용량(5시간 세션 / 7일 주간)과 모델 정보.
//
// 이 값은 Claude Code가 statusline 스크립트의 stdin으로만 넘겨준다 — ~/.claude 아래
// 어디에도 남지 않는다. 그래서 statusline이 받은 payload를 그대로 파일로 떨어뜨리게 해두고
// (아래 SNIPPET 참고) 여기서는 그 파일만 읽는다. 파일이 없으면 조용히 null.
//
// payload 모양 (Claude Code 2.1.x):
//   { model:{id,display_name}, version, cost:{total_cost_usd,…},
//     context_window:{context_window_size,used_percentage,…},
//     rate_limits:{ five_hour:{used_percentage,resets_at}, seven_day:{…} } }
//   resets_at은 Unix epoch(초).
import fs from 'node:fs/promises';
import { USAGE_FILE } from './paths.mjs';

// statusline 스크립트에 한 줄 심는 코드. README와 tools/install-usage-tap.mjs가 같은 걸 쓴다.
export const SNIPPET_MARK = 'claude-office usage tap';

const STALE_MS = 1000 * 60 * 30; // 30분 넘게 갱신이 없으면 "오래됨"으로 표시

let cache = { mtimeMs: 0, value: null };

function limit(part) {
  if (!part) return null;
  const pct = Number(part.used_percentage);
  if (!Number.isFinite(pct)) return null;
  const resets = Number(part.resets_at);
  return {
    pct: Math.max(0, Math.min(100, Math.round(pct * 10) / 10)),
    resetsAt: Number.isFinite(resets) && resets > 0 ? resets * 1000 : null,
  };
}

export async function readUsage() {
  let st;
  try {
    st = await fs.stat(USAGE_FILE);
  } catch {
    return null; // tap이 아직 안 깔렸다
  }
  if (cache.value && cache.mtimeMs === st.mtimeMs) return cache.value;

  let raw;
  try {
    // statusline이 쓰는 순간과 겹치면 잘린 JSON을 볼 수 있다 — 그때는 직전 값을 유지한다
    raw = JSON.parse(await fs.readFile(USAGE_FILE, 'utf8'));
  } catch {
    // 겹친 순간이면 다음 틱에 풀린다. 그런데 파일이 **계속** 깨져 있는 경우도 있다 —
    // statusline이 stdin을 cp949로 읽어 한글이 부서지면 JSON이 영구히 못 읽힌다.
    // 그때 옛 값을 그대로 보여주면 거짓말이 되므로 깨졌다는 사실을 실어 보낸다.
    return cache.value ? { ...cache.value, broken: true } : { at: st.mtimeMs, broken: true, session: null, week: null };
  }

  const value = {
    at: st.mtimeMs,
    stale: Date.now() - st.mtimeMs > STALE_MS,
    version: raw.version ?? null,
    // 이 payload를 준 세션. 모델·추론 강도·Fast는 계정 값이 아니라 **이 세션의 값**이므로,
    // 어느 세션인지 알아야 엉뚱한 자리에 적지 않을 수 있다.
    sessionId: raw.session_id ?? null,
    model: raw.model?.display_name ?? raw.model?.id ?? null,
    effort: raw.effort?.level ?? null,
    fastMode: raw.fast_mode === true,
    thinking: raw.thinking?.enabled === true,
    contextWindow: Number(raw.context_window?.context_window_size) || null,
    costUsd: Number(raw.cost?.total_cost_usd) || 0,
    session: limit(raw.rate_limits?.five_hour),
    week: limit(raw.rate_limits?.seven_day),
  };
  cache = { mtimeMs: st.mtimeMs, value };
  return value;
}
