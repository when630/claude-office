// 단축키를 사람이 읽는 꼴로. 저장은 Electron Accelerator 문법 그대로 두고
// (`CommandOrControl+Alt+O`) 보여줄 때만 눌러 편다 — 칸을 다 잡아먹고, 사람이 실제로
// 누르는 키의 이름도 아니다.
//
// 왜 맥과 윈도를 다르게 적는가: **키캡에 새겨진 것을 그대로 적는다**가 기준이다.
// 맥 키보드에는 `Alt`라는 이름이 없고(⌥ Option) 수식키는 기호로 읽는다 — 글자로 적으면
// 어느 키인지 한 번 더 옮겨 읽어야 한다. 윈도는 반대로 키캡에 기호가 없으니 `⌃⌥O`는
// 아무것도 알려주지 않는다. 그래서 기호는 맥에서만 쓴다.
//
// 지금 부르는 곳은 설정 창(renderer)뿐이다 — main의 등록 실패 알림도 이 표기를 썼는데 그
// 알림 자체를 걷어냈다(#139). 그래도 `shared`에 남겨 둔다: 플랫폼 표기는 화면 어디서 적든
// 같아야 하는 것이고, 트레이 메뉴처럼 main이 조합을 적을 자리가 생기면 그때 쓰는 곳이다.
const MAC = {
  CommandOrControl: '⌘',
  Command: '⌘',
  Cmd: '⌘',
  Super: '⌘',
  Control: '⌃',
  Ctrl: '⌃',
  Alt: '⌥',
  Option: '⌥',
  Shift: '⇧',
};
const WIN = {
  CommandOrControl: 'Ctrl',
  Command: 'Win',
  Cmd: 'Win',
  Super: 'Win',
  Control: 'Ctrl',
  Ctrl: 'Ctrl',
  Alt: 'Alt',
  Option: 'Alt',
  Shift: 'Shift',
};

// 맥은 수식키를 누르는 순서가 아니라 정해진 순서로 적는다(Apple 관례) — ⌘⌥O와 ⌥⌘O가
// 섞이면 같은 조합이 다른 것으로 보인다.
const MAC_ORDER = ['⌃', '⌥', '⇧', '⌘'];

// 화면에 그대로 나가는 문자열. 빈 값은 빈 문자열이다 — "이 자리는 안 쓴다"는 뜻이라
// 부르는 쪽이 `없음` 같은 문구로 갈아 끼운다.
export function accelLabel(accel, mac = false) {
  const table = mac ? MAC : WIN;
  const mods = [];
  const keys = [];
  for (const part of String(accel ?? '')
    .split('+')
    .filter(Boolean)) {
    const mod = table[part];
    // 같은 수식키가 두 이름으로 들어와도(Cmd+Command) 기호는 하나만 적는다
    if (mod) {
      if (!mods.includes(mod)) mods.push(mod);
      continue;
    }
    keys.push(part.length === 1 ? part.toUpperCase() : part);
  }
  if (!mods.length && !keys.length) return '';
  if (!mac) return [...mods, ...keys].join('+');
  mods.sort((a, b) => MAC_ORDER.indexOf(a) - MAC_ORDER.indexOf(b));
  // 맥은 기호를 붙여 쓴다 — `⌥+⌘+O`처럼 더하기를 끼우는 표기는 맥 어디에도 없다
  return [...mods, ...keys].join('');
}

// 설명 문구에 들어가는 "수식키 목록". 사전에는 자리(`{mods}`)만 두고 여기서 채운다 —
// 문구는 언어마다 다르지만 키 이름은 언어가 아니라 플랫폼에 따라 갈린다.
export function modHint(mac = false) {
  return (mac ? [MAC.CommandOrControl, MAC.Alt, MAC.Shift] : [WIN.CommandOrControl, WIN.Alt, WIN.Shift]).join(' · ');
}
