// 샌드박스 preload — ESM을 쓸 수 없으므로 CJS로 둔다.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('office', {
  // main이 1.5초마다 밀어주는 스냅샷
  onState: (cb) => ipcRenderer.on('office:state', (_e, state) => cb(state)),
  // 알림을 클릭했을 때 해당 자리를 열어달라는 신호
  onSelect: (cb) => ipcRenderer.on('office:select', (_e, key) => cb(key)),
  getState: () => ipcRenderer.invoke('office:getState'),
  meta: () => ipcRenderer.invoke('office:meta'),
  openExternal: (url) => ipcRenderer.send('office:open-external', url),
  copy: (text) => ipcRenderer.send('office:copy', text),
  // 세션의 작업 디렉터리에서 attach 명령을 실행하는 터미널을 띄운다 — id만 넘긴다
  openTerminal: (target) => ipcRenderer.invoke('office:openTerminal', target),
  // 승인받은 계획서(.md)를 기본 편집기로 — 경로 검증은 main이 한다
  openPlan: (file) => ipcRenderer.invoke('office:openPlan', file),
  // 출근부 — 오늘·최근 7일 집계 (main/history.mjs)
  history: () => ipcRenderer.invoke('office:history'),
  // 설정 창의 알림 설정 — 종류별 on/off와 방해금지 (트레이 메뉴와 같은 값)
  getNotify: () => ipcRenderer.invoke('office:getNotify'),
  setNotify: (patch) => ipcRenderer.invoke('office:setNotify', patch),
  // 어느 모습으로 쓸까 — 'normal'(큰 창) · 'mini'(작게 띄워 두는 사무실) · 'stroll'(바탕화면 산책).
  // 셋 다 별도 창이라 렌더러는 갈아타 달라고만 한다.
  getMode: () => ipcRenderer.invoke('office:getMode'),
  setMode: (mode) => ipcRenderer.send('office:setMode', mode),
  // 미니·산책에서 게를 누르면 큰 창이 올라오며 그 세션이 펼쳐진다
  selectSession: (key) => ipcRenderer.send('office:select-session', key),
  // 산책 창이 커서 밑을 알려 온다 — 게 위에 있는 동안만 클릭을 먹는다
  strollPass: (on) => ipcRenderer.send('office:stroll-pass', on),
  // 전역 단축키 — 저장된 조합과 못 잡은 조합을 함께 돌려준다
  getHotkeys: () => ipcRenderer.invoke('office:getHotkeys'),
  setHotkeys: (patch) => ipcRenderer.invoke('office:setHotkeys', patch),
  // 설정 창의 표시 설정 — 저장된 뒤의 값을 되돌려준다
  getView: () => ipcRenderer.invoke('office:getView'),
  setView: (patch) => ipcRenderer.invoke('office:setView', patch),
  // 언어. 트레이 메뉴에서도 바꿀 수 있으므로 밀어주는 쪽(onLang)도 있어야 한다.
  setLang: (pref) => ipcRenderer.invoke('office:setLang', pref),
  onLang: (cb) => ipcRenderer.on('office:lang', (_e, payload) => cb(payload)),
});
