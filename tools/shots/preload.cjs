// 캡처용 가짜 preload. main 프로세스가 없는 자리에 `window.office`를 세운다.
//
// 진짜 앱은 `sandbox: true`로 도는데 여기는 `sandbox: false`다 — 샌드박스 preload에는
// `fs`도 `process.env`도 없어서 미리 정해 둔 응답을 파일에서 읽어 올 수 없다.
//
// **창을 만들 때마다 다시 돈다.** 굽는 쪽이 창 사이에 `SHOT_FIXTURE`를 갈아 끼우면
// 언어별 픽스처를 따로 물릴 수 있다.
const { contextBridge } = require('electron');
const fs = require('fs');

const fixture = JSON.parse(fs.readFileSync(process.env.SHOT_FIXTURE, 'utf8'));

// 표시 설정은 창이 사는 동안 이어져야 한다. 진짜 main은 settings.view를 통째로
// 되돌려주는데, 매번 fixture.view로 되돌리면 앞서 바꾼 값이 조용히 지워진다
// (양쪽 열 접기가 서로를 되살렸다).
let view = { ...fixture.view };

// main이 없으니 아무것도 밀어오지 않는다. 렌더러가 getState()로 한 번 받아 가면 그걸로
// 끝이고, 나머지 상태는 `__office.push`로 밀어 넣는다.
contextBridge.exposeInMainWorld('office', {
  onState: () => {},
  onSelect: () => {},
  onLang: () => {},
  getState: () => Promise.resolve(fixture.state),
  meta: () => Promise.resolve(fixture.meta),
  getView: () => Promise.resolve(view),
  setView: (patch) => {
    view = { ...view, ...(patch ?? {}) };
    return Promise.resolve(view);
  },
  getNotify: () => Promise.resolve(fixture.notify),
  setNotify: (patch) => Promise.resolve({ ...fixture.notify, ...patch }),
  getHotkeys: () => Promise.resolve(fixture.hotkeys),
  setHotkeys: (patch) => Promise.resolve({ ...fixture.hotkeys, ...patch }),
  history: () => Promise.resolve(fixture.history),
  getMini: () => Promise.resolve(false),
  setMini: () => {},
  miniSelect: () => {},
  openTerminal: () => Promise.resolve({ ok: true }),
  openPlan: () => Promise.resolve({ ok: true }),
  openExternal: () => {},
  copy: () => {},
  setLang: (pref) => Promise.resolve({ lang: pref, pref }),
});
