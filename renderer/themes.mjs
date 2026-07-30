// 사무실 종류. 방 하나 = 작업 디렉터리 하나인데, 종류가 다르면 벽·바닥·비품이 달라져
// 화면에 방이 여러 개 떠 있어도 서로 구분된다. 방 색(hue)은 별도로 배정되므로
// 여기서는 "무엇이 놓여 있는가"와 "바닥 무늬"만 정한다.
//
// props / wall 값은 renderer/sprites.mjs의 SPR 키다. 앞에서부터 좌·우 번갈아 놓이고,
// 자리가 없으면 조용히 잘린다 — 좁은 방에 억지로 밀어넣지 않는다.

export const THEMES = [
  {
    key: 'dev',
    label: '개발실',
    station: 'desk',
    floor: 'grid',
    desk: { top: '#8a6039', edge: '#a57645', front: '#5c3f26', leg: '#412d1b' },
    props: ['cooler', 'rack', 'plant', 'trash'],
    wall: ['clock', 'frame'],
    lines: ['빌드 도는 소리가 좋다', '옆자리 팬 소리 좀 크네', '서버 랙에서 열이 올라온다'],
  },
  {
    key: 'design',
    label: '디자인실',
    station: 'drafting',
    floor: 'wood',
    desk: { top: '#a07a4c', edge: '#c09a66', front: '#6d5030', leg: '#4a3520' },
    props: ['plant', 'lamp', 'cactus', 'cabinet'],
    wall: ['frame', 'window', 'frame'],
    lines: ['이 여백이 2픽셀 어긋났다', '색을 하나만 더 줄이면 딱인데', '조명이 따뜻해서 좋다'],
  },
  {
    key: 'lounge',
    label: '라운지',
    station: 'lowtable',
    floor: 'wood',
    desk: { top: '#94693f', edge: '#b2854f', front: '#63462a', leg: '#45301c' },
    props: ['coffee', 'sofa', 'vending', 'plant', 'arcade'],
    wall: ['clock', 'frame'],
    lines: ['커피 향이 여기까지 온다', '소파에 눕고 싶다', '자판기에 잔돈이 없다', '오락기 한 판만…'],
  },
  {
    key: 'meeting',
    label: '회의실',
    station: 'table',
    floor: 'carpet',
    desk: { top: '#7d6a52', edge: '#9a8467', front: '#584938', leg: '#3d3327' },
    props: ['cooler', 'plant', 'boxes'],
    wall: ['screen', 'clock'],
    lines: ['이 회의 꼭 필요했나', '스크린이 안 켜진다', '화이트보드 지워도 되나요'],
  },
  {
    key: 'lab',
    label: '연구실',
    station: 'bench',
    floor: 'tile',
    desk: { top: '#7b8290', edge: '#98a0af', front: '#565d69', leg: '#3b4149' },
    props: ['beaker', 'tank', 'cabinet', 'extinguisher'],
    wall: ['window', 'clock'],
    lines: ['이번 실험은 재현이 안 된다', '어항 물고기가 나를 본다', '플라스크 색이 이상하다'],
  },
  {
    key: 'archive',
    label: '자료실',
    station: 'reading',
    floor: 'tile',
    desk: { top: '#8a7554', edge: '#a68e69', front: '#5f513a', leg: '#423928' },
    props: ['shelf', 'cabinet', 'boxes', 'lamp'],
    wall: ['clock'],
    lines: ['이 문서 3년 전 거다', '박스가 또 늘었다', '먼지 좀 봐'],
  },
  {
    key: 'server',
    label: '서버실',
    station: 'console',
    floor: 'tile',
    desk: { top: '#6c7380', edge: '#87909e', front: '#4b525d', leg: '#343a42' },
    props: ['rack', 'rack', 'fan', 'extinguisher'],
    wall: ['clock'],
    lines: ['여기 시끄럽다', '팬 하나가 죽었다', '왜 이렇게 추워'],
  },
  {
    key: 'ops',
    label: '운영실',
    station: 'desk',
    floor: 'grid',
    desk: { top: '#85643d', edge: '#a37f52', front: '#5a422a', leg: '#3f2e1d' },
    props: ['printer', 'cooler', 'cabinet', 'trash'],
    wall: ['clock', 'window'],
    lines: ['프린터가 또 걸렸다', '알람이 세 개 왔다', '대시보드 초록불 유지 중'],
  },
];

export const THEME_BY_KEY = new Map(THEMES.map((t) => [t.key, t]));

// 같은 화면에 같은 종류가 몰리지 않게, 해시로 고르되 이미 쓴 종류는 옆으로 밀어준다.
//
// picked는 설정에서 손으로 고른 것(방 key → 종류 key)이다. 이건 먼저 못 박고 "이미 쓴 종류"로
// 세어야 한다 — 나중에 처리하면 자동 배정이 그 자리를 차지해 고른 종류가 옆으로 밀려난다.
export function assignThemes(rooms, hashStr, picked) {
  const used = new Set();
  const out = new Map();

  if (picked) {
    for (const room of rooms) {
      const theme = THEME_BY_KEY.get(picked[room.key]);
      if (!theme) continue;
      out.set(room.key, theme);
      used.add(THEMES.indexOf(theme));
    }
  }

  for (const room of rooms) {
    if (out.has(room.key)) continue;
    let idx = hashStr(room.key) % THEMES.length;
    if (used.size < THEMES.length) {
      while (used.has(idx)) idx = (idx + 1) % THEMES.length;
      used.add(idx);
    }
    out.set(room.key, THEMES[idx]);
  }
  return out;
}
