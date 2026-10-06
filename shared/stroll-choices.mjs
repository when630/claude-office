// 산책 모드에서 고를 수 있는 값 — 인원 · 크기 · 속도.
//
// **세 곳이 같은 목록을 봐야 해서 여기에 있다.** 설정 창이 내주는 선택지(renderer/app.mjs),
// 저장할 때 걸러 내는 문(main/index.mjs의 sanitizeView), 그 값으로 실제로 그리는 산책 창
// (renderer/stroll-app.mjs)이 각자 목록을 들면 한쪽만 늘렸을 때 **고른 값이 조용히
// 되돌아온다** — 창에는 새 값이 선택된 채로 실제로는 옛 값으로 도는 것이 제일 나쁘다.
//
// 범위만 막고 아무 수나 받아 봤더니 같은 문제가 났다: 설정 창의 select는 목록에서 고르므로
// settings.json에 7을 적어 넣으면 화면에는 6이 선택된 채로 일곱 마리가 나간다.
// 그래서 자유롭게 적는 것을 포기하고 **고른 값 중 하나**로 못 박았다.
export const STROLL_MAXES = [2, 4, 6, 8, 12, 20];
// 크기는 **정수배만** — 픽셀 아트라 반 칸에서 획이 뭉갠다(큰 창의 배율과 다른 점이다).
export const STROLL_SCALES = [2, 3, 4];
export const STROLL_SPEEDS = [0.6, 1, 1.6];

// 어느 모니터에 내보낼까 — 'primary'(주 모니터) 또는 Electron display.id(정수). 모니터 목록은
// 돌 때만 알 수 있으므로 여기서는 모양만 정하고, 없는 id는 쓰는 쪽(main의 strollArea)이 주 모니터로 돌린다.
export const STROLL_DISPLAY_PRIMARY = 'primary';
export function pickStrollDisplay(v) {
  if (v === STROLL_DISPLAY_PRIMARY || v == null) return STROLL_DISPLAY_PRIMARY;
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : STROLL_DISPLAY_PRIMARY;
}

export const STROLL_DEFAULTS = { strollMax: 6, strollScale: 2, strollSpeed: 1, strollDisplay: STROLL_DISPLAY_PRIMARY };

export function pickStroll(v, allowed, fallback) {
  const n = Number(v);
  return allowed.includes(n) ? n : fallback;
}
