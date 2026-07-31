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
  // 출근부 — 오늘·최근 7일 집계 (main/history.mjs)
  history: () => ipcRenderer.invoke('office:history'),
  // 설정 창의 알림 설정 — 종류별 on/off와 방해금지 (트레이 메뉴와 같은 값)
  getNotify: () => ipcRenderer.invoke('office:getNotify'),
  setNotify: (patch) => ipcRenderer.invoke('office:setNotify', patch),
  // 설정 창의 표시 설정 — 저장된 뒤의 값을 되돌려준다
  getView: () => ipcRenderer.invoke('office:getView'),
  setView: (patch) => ipcRenderer.invoke('office:setView', patch),
  // 언어. 트레이 메뉴에서도 바꿀 수 있으므로 밀어주는 쪽(onLang)도 있어야 한다.
  setLang: (pref) => ipcRenderer.invoke('office:setLang', pref),
  onLang: (cb) => ipcRenderer.on('office:lang', (_e, payload) => cb(payload)),
});
