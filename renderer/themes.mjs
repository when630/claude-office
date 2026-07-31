// 사무실 종류. 방 하나 = 작업 디렉터리 하나인데, 종류가 다르면 벽·바닥·비품이 달라져
// 화면에 방이 여러 개 떠 있어도 서로 구분된다. 방 색(hue)은 별도로 배정되므로
// 여기서는 "무엇이 놓여 있는가"와 "바닥 무늬"만 정한다.
//
// props / wall 값은 renderer/sprites.mjs의 SPR 키다. 앞에서부터 좌·우 번갈아 놓이고,
// 자리가 없으면 조용히 잘린다 — 좁은 방에 억지로 밀어넣지 않는다.
//
// 방 이름(label)과 방별 대사(lines)는 언어를 타므로 사전에서 온다(shared/lang/*.mjs).
// 접근자로 둔 이유: `theme.label`을 쓰는 자리가 렌더러 곳곳에 있고, 언어를 바꿀 때마다
// 이 배열을 다시 만들지 않아도 다음에 읽는 값이 새 언어가 되어야 한다.
import { t } from '../shared/i18n.mjs';

function localized(theme) {
  return {
    ...theme,
    get label() {
      return t(`rooms.${theme.key}.label`);
    },
    get lines() {
      return t(`rooms.${theme.key}.lines`);
    },
  };
}

export const THEMES = [
  {
    key: 'dev',
    station: 'desk',
    floor: 'grid',
    desk: { top: '#8a6039', edge: '#a57645', front: '#5c3f26', leg: '#412d1b' },
    props: ['cooler', 'rack', 'plant', 'trash'],
    wall: ['clock', 'frame'],
  },
  {
    key: 'design',
    station: 'drafting',
    floor: 'wood',
    desk: { top: '#a07a4c', edge: '#c09a66', front: '#6d5030', leg: '#4a3520' },
    props: ['plant', 'lamp', 'cactus', 'cabinet'],
    wall: ['frame', 'window', 'frame'],
  },
  {
    key: 'lounge',
    station: 'lowtable',
    floor: 'wood',
    desk: { top: '#94693f', edge: '#b2854f', front: '#63462a', leg: '#45301c' },
    props: ['coffee', 'sofa', 'vending', 'plant', 'arcade'],
    wall: ['clock', 'frame'],
  },
  {
    key: 'meeting',
    station: 'table',
    floor: 'carpet',
    desk: { top: '#7d6a52', edge: '#9a8467', front: '#584938', leg: '#3d3327' },
    props: ['cooler', 'plant', 'boxes'],
    wall: ['screen', 'clock'],
  },
  {
    key: 'lab',
    station: 'bench',
    floor: 'tile',
    desk: { top: '#7b8290', edge: '#98a0af', front: '#565d69', leg: '#3b4149' },
    props: ['beaker', 'tank', 'cabinet', 'extinguisher'],
    wall: ['window', 'clock'],
  },
  {
    key: 'archive',
    station: 'reading',
    floor: 'tile',
    desk: { top: '#8a7554', edge: '#a68e69', front: '#5f513a', leg: '#423928' },
    props: ['shelf', 'cabinet', 'boxes', 'lamp'],
    wall: ['clock'],
  },
  {
    key: 'server',
    station: 'console',
    floor: 'tile',
    desk: { top: '#6c7380', edge: '#87909e', front: '#4b525d', leg: '#343a42' },
    props: ['rack', 'rack', 'fan', 'extinguisher'],
    wall: ['clock'],
  },
  {
    key: 'ops',
    station: 'desk',
    floor: 'grid',
    desk: { top: '#85643d', edge: '#a37f52', front: '#5a422a', leg: '#3f2e1d' },
    props: ['printer', 'cooler', 'cabinet', 'trash'],
    wall: ['clock', 'window'],
  },
].map(localized);

export const THEME_BY_KEY = new Map(THEMES.map((theme) => [theme.key, theme]));

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
