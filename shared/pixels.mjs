// 픽셀 데이터 — 한 글자 = 한 픽셀. 렌더러(캔버스)와 아이콘 생성기(PNG)가 함께 쓴다.
// 브라우저 API를 참조하지 않아야 main 프로세스에서도 import할 수 있다.
export const PALETTE = {
  '.': null,
  k: '#171a1f', // 눈 — 흰자 없이 검은 사각 하나다
  w: '#f4f6fb', // 흰색 (소품 전용)
  r: '#cc785c', // 몸통 — 음영 없는 단색 하나다 (레퍼런스가 그렇다)
  g: '#4f9d5d', // 잎
  G: '#3d7a49',
  p: '#a8613a', // 화분
  P: '#c2794c',
  C: '#d9dee8', // 머그
  v: '#6f7a8f', // 김
  b: '#6fb3d2', // 정수기 물통
  n: '#e4e9f1', // 정수기 몸통
  N: '#a9b3c4', // 정수기 그늘
  // ── 사무실 비품용 (아래부터는 소품 전용)
  s: '#6f7887', // 금속 밝은 면
  S: '#4b535f', // 금속 그늘
  d: '#2b313b', // 어두운 패널·꺼진 화면
  x: '#14171d', // 거의 검정 (틈·구멍)
  z: '#b9c2d0', // 밝은 회색 (종이·플라스틱)
  l: '#ffd98a', // 조명 빛
  y: '#f2c14e', // 노랑 (LED·포스트잇)
  o: '#e08a3c', // 주황 (음료·물고기)
  i: '#c94f4f', // 빨강 (경고 LED·소화기)
  t: '#3f8f6e', // 초록 (정상 LED)
  e: '#8fd6b4', // 민트
  u: '#7b5bd6', // 보라 (포스터)
  a: '#6fd3ee', // 물·유리
  A: '#2f6f86', // 깊은 물·유리 테두리
  m: '#8a6039', // 나무 밝은 면
  M: '#5c3f26', // 나무 그늘
  q: '#3a4557', // 소파 천 그늘
  Q: '#4e5c72', // 소파 천
};

// ── Claw'd (16×12). 네모난 클레이색 몸통 · 눈높이에서 좌우로 뻗은 짧은 팔 · 검은 사각 눈 · 네 다리.
//
// 레퍼런스를 그대로 옮긴 규칙 셋:
//   1) **위는 평평하다.** 처음에 좌우 덩어리를 몸통 위로 올려 그렸더니 팔이 아니라 뿔이 됐다.
//      팔은 위로 세우지 말고 옆으로 낸다 — 몸통 x2~13(12px), 팔이 좌우로 2px씩 삐져나와
//      그 줄만 16px이 된다.
//   2) **팔은 눈과 같은 높이다.** 아래로 내리면 팔이 아니라 옆구리 지방으로 읽힌다.
//   3) **음영이 없다.** 하이라이트도 그늘도 없는 단색 한 겹이다. 위 모서리에 밝은 줄을 한 번
//      넣어 봤는데 몸의 굴곡이 아니라 머리띠로 보였다. 어두운 바닥 위에서는 실루엣만으로 충분하다.
//
// 그래서 자세 차이는 전부 **실루엣**으로만 낸다 — 팔 높이, 다리 들림, 눈 모양.
// 앉은 자리에서는 상판이 하반신을 덮어 다리가 안 보이므로, 타이핑은 팔을 한 줄 올렸다
// 내리는 것으로 만든다(팔은 눈 높이라 상판 위에 늘 남는다).
//
// 다리는 3줄(r9~r11) 네 짝, 폭 2px씩. 가운데 틈만 2px로 넓혀야 앞다리·뒷다리로 갈라 보인다.
// 눈은 흰자 없는 검은 사각 2×2. 흰자를 넣으면 이 크기에서 눈이 번져 표정이 흐려진다.
export const CLAWD_STAND = [
  '..rrrrrrrrrrrr..',
  '..rrrrrrrrrrrr..',
  '..rrrrrrrrrrrr..',
  'rrrkkrrrrrrkkrrr', // 팔 — 좌우로 2px, 눈과 같은 줄
  'rrrkkrrrrrrkkrrr',
  'rrrrrrrrrrrrrrrr',
  '..rrrrrrrrrrrr..',
  '..rrrrrrrrrrrr..',
  '..rrrrrrrrrrrr..',
  '..rr.rr..rr.rr..',
  '..rr.rr..rr.rr..',
  '..rr.rr..rr.rr..',
];

// 팔을 한 줄 올렸다 — 타이핑 두 프레임 중 하나. 몸통 1px 흔들림과 같은 박자로 번갈아 쓴다.
export const CLAWD_ARMS_UP = [
  '..rrrrrrrrrrrr..',
  '..rrrrrrrrrrrr..',
  'rrrrrrrrrrrrrrrr',
  'rrrkkrrrrrrkkrrr',
  'rrrkkrrrrrrkkrrr',
  '..rrrrrrrrrrrr..',
  '..rrrrrrrrrrrr..',
  '..rrrrrrrrrrrr..',
  '..rrrrrrrrrrrr..',
  '..rr.rr..rr.rr..',
  '..rr.rr..rr.rr..',
  '..rr.rr..rr.rr..',
];

// 두 팔을 번쩍 든 자세 — 입력 대기. 사람을 부르는 몸짓이라야 한다.
//
// 팔을 몸통 맨 윗줄에 맞춰 올리면 그 줄이 통째로 채워져 팔이 아니라 **넓은 챙**으로 보인다.
// 단색이라 붙은 픽셀은 하나로 읽히기 때문이다. 그래서 몸통을 한 줄 내리고 팔만 위로 내밀어,
// 맨 윗줄에 떨어진 두 덩어리가 남게 한다 — 이 한 줄이 "들었다"를 만드는 전부다.
export const CLAWD_ARMS_HIGH = [
  'rr............rr',
  'rrrrrrrrrrrrrrrr',
  'rrrrrrrrrrrrrrrr',
  'rrrkkrrrrrrkkrrr',
  '..rkkrrrrrrkkr..',
  '..rrrrrrrrrrrr..',
  '..rrrrrrrrrrrr..',
  '..rrrrrrrrrrrr..',
  '..rrrrrrrrrrrr..',
  '..rr.rr..rr.rr..',
  '..rr.rr..rr.rr..',
  '..rr.rr..rr.rr..',
];

// 걷는 두 프레임. 네발짐승답게 **대각선 짝**으로 딛는다 — 왼쪽 바깥 + 오른쪽 안쪽이
// 한 짝, 그 반대가 다른 짝이다. 뜬 발은 맨 아랫줄만 지워 1px 든다.
//
// 안쪽 두 짝 / 바깥 두 짝으로 갈라 봤더니 네 발이 동시에 같은 방향으로 움직여 걷는 게
// 아니라 깡충 뛰는 모습이 됐다. 대각선으로 엇갈려야 걸음으로 읽힌다.
//
// 두 프레임 다 딛는 발이 맨 아랫줄까지 내려온다 — 그래야 접지선이 흔들리지 않는다.
// (그래서 drawWanderer는 걸을 때 몸통을 띄우지 않는다. 띄우면 그 1px이 발 든 높이와
//  같아서 서로 상쇄되고, 발이 제자리에 붙어 있는 것처럼 보인다.)
export const CLAWD_STEP_A = [
  '..rrrrrrrrrrrr..',
  '..rrrrrrrrrrrr..',
  '..rrrrrrrrrrrr..',
  'rrrkkrrrrrrkkrrr',
  'rrrkkrrrrrrkkrrr',
  'rrrrrrrrrrrrrrrr',
  '..rrrrrrrrrrrr..',
  '..rrrrrrrrrrrr..',
  '..rrrrrrrrrrrr..',
  '..rr.rr..rr.rr..',
  '..rr.rr..rr.rr..',
  '..rr.....rr.....',
];

export const CLAWD_STEP_B = [
  '..rrrrrrrrrrrr..',
  '..rrrrrrrrrrrr..',
  '..rrrrrrrrrrrr..',
  'rrrkkrrrrrrkkrrr',
  'rrrkkrrrrrrkkrrr',
  'rrrrrrrrrrrrrrrr',
  '..rrrrrrrrrrrr..',
  '..rrrrrrrrrrrr..',
  '..rrrrrrrrrrrr..',
  '..rr.rr..rr.rr..',
  '..rr.rr..rr.rr..',
  '.....rr.....rr..',
];

// 눈 감고 늘어진 상태 — 팔이 어깨 아래로 흘러내리고, 눈은 아랫줄만 남는다.
// 감은 눈(아랫줄만)과 웃는 눈(윗줄만)이 이 크기에서 둘을 가르는 유일한 수단이다.
export const CLAWD_ASLEEP = [
  '..rrrrrrrrrrrr..',
  '..rrrrrrrrrrrr..',
  '..rrrrrrrrrrrr..',
  '..rrrrrrrrrrrr..',
  '..rkkrrrrrrkkr..',
  '..rrrrrrrrrrrr..',
  'rrrrrrrrrrrrrrrr', // 팔이 아래로 처졌다
  'rrrrrrrrrrrrrrrr',
  'rrrrrrrrrrrrrrrr',
  '..rr.rr..rr.rr..',
  '..rr.rr..rr.rr..',
  '..rr.rr..rr.rr..',
];

// 옆 사람과 떠드는 자세 — 눈을 레퍼런스의 웃는 얼굴(> <)로 바꾼다.
// 획이 세 줄이라 팔 줄(r3~r5)과 정확히 겹친다.
export const CLAWD_CHAT = [
  '..rrrrrrrrrrrr..',
  '..rrrrrrrrrrrr..',
  '..rrrrrrrrrrrr..',
  'rrrkrrrrrrrrkrrr',
  'rrrrkrrrrrrkrrrr',
  'rrrkrrrrrrrrkrrr',
  '..rrrrrrrrrrrr..',
  '..rrrrrrrrrrrr..',
  '..rrrrrrrrrrrr..',
  '..rr.rr..rr.rr..',
  '..rr.rr..rr.rr..',
  '..rr.rr..rr.rr..',
];

// 머그를 들고 한숨 돌리는 자세 — 정수기·커피머신 앞에서 쓴다.
//
// 컵은 오른팔 끝에 매달아 가슴 높이에 둔다. 어깨 위로 올려 놓으면 들고 있는 게 아니라
// 얹어 둔 상자로 보이고, 눈 옆에 붙이면 눈에 들러붙는다.
// 손잡이(가운데 줄에서 1px 밖으로)가 컵을 컵으로 만드는 전부다 — 이게 없으면 회색 덩어리고,
// 가운데를 흰 픽셀로 파면 손잡이가 아니라 뚫린 구멍으로 보인다.
export const CLAWD_SIP = [
  '..rrrrrrrrrrrr..',
  '..rrrrrrrrrrrr..',
  '..rrrrrrrrrrrr..',
  'rrrkkrrrrrrkkrrr',
  'rrrkkrrrrrrkkrrr',
  'rrrrrrrrrrrrrCC.',
  '..rrrrrrrrrrrCCC', // 손잡이
  '..rrrrrrrrrrrCC.',
  '..rrrrrrrrrrrr..',
  '..rr.rr..rr.rr..',
  '..rr.rr..rr.rr..',
  '..rr.rr..rr.rr..',
];

// 어지러운 두 프레임 — 서버 장애로 응답을 못 받는 세션. 좌우로 번갈아 갸우뚱한다.
//
// **12px에서 머리를 회전시킬 방법은 없다.** 6px짜리 낱장도 각도별로 따로 그려야 했던
// 것과 같은 사정이다(SHEET_TILT_*). 그래서 기울기를 **줄마다 어긋내서** 낸다 —
// 머리 세 줄은 2px, 팔·어깨 줄은 1px, 그 아래는 제자리다. 하반신을 붙잡아 두므로
// 접지선이 안 흔들린다(걷기에서 몸통 띄우기를 걷어낸 것과 같은 판단이다).
//
// **계단이라야 기울기로 읽힌다.** 처음에는 상반신을 통째로 1px만 밀었는데, 확대해서
// 데이터로 보면 어긋나 있지만 실제 크기로 그려 보면 stand와 구분이 안 됐다 — 12px에서
// 1px 평행이동은 기울기가 아니라 노이즈다. 두 단으로 어긋내면 그 사이에 생기는 턱이
// 목·어깨 노릇을 해서 "고개가 넘어갔다"가 된다.
//
// **눈도 머리를 따라 2px 간다.** 팔 줄은 원래 0~15를 꽉 채워 1px밖에 못 미는데, 눈만
// 머리와 같이 2px 옮겼다. 눈을 어깨와 함께 1px만 옮기면 머리는 넘어갔는데 눈은 몸통
// 중심에 남아, 고개가 기운 것이 아니라 머리가 옆으로 미끄러진 모습이 된다.
//
// 눈 모양은 stand와 같은 2×2 검은 사각 그대로다. 소용돌이 눈으로 바꿔 볼 수도 있었지만
// 이 크기에서 눈 모양은 감은 눈(아랫줄)·웃는 눈(윗줄)이 이미 다 쓰고 있어, 셋째 눈을
// 만들면 그 둘까지 흐려진다. 어지러움은 **고개의 기울기와 머리 위 별**이 말한다.
export const CLAWD_TILT_L = [
  'rrrrrrrrrrrr....', // 머리 — 2px
  'rrrrrrrrrrrr....',
  'rrrrrrrrrrrr....',
  'rkkrrrrrrkkrrrr.', // 팔·어깨 — 1px, 눈만 머리와 함께 2px
  'rkkrrrrrrkkrrrr.',
  'rrrrrrrrrrrrrrr.',
  '..rrrrrrrrrrrr..', // 여기부터 제자리 — 접지선을 붙잡는다
  '..rrrrrrrrrrrr..',
  '..rrrrrrrrrrrr..',
  '..rr.rr..rr.rr..',
  '..rr.rr..rr.rr..',
  '..rr.rr..rr.rr..',
];

export const CLAWD_TILT_R = [
  '....rrrrrrrrrrrr',
  '....rrrrrrrrrrrr',
  '....rrrrrrrrrrrr',
  '.rrrrkkrrrrrrkkr',
  '.rrrrkkrrrrrrkkr',
  '.rrrrrrrrrrrrrrr',
  '..rrrrrrrrrrrr..',
  '..rrrrrrrrrrrr..',
  '..rrrrrrrrrrrr..',
  '..rr.rr..rr.rr..',
  '..rr.rr..rr.rr..',
  '..rr.rr..rr.rr..',
];

// 머리 위를 도는 별. 모양은 하나고 **궤도의 앞뒤는 색으로 낸다**(sprites.mjs의 dizzy ↔
// dizzyFar) — 뒤쪽을 1px 점으로 줄여 봤더니 한 바퀴의 절반 동안 별이 먼지처럼 사그라들어
// 도는 것이 아니라 깜빡이는 것으로 보였다. 멀면 흐릴 뿐 사라지지는 않는다.
//
// 별은 화면에서 **둘**이 반대편에 놓여 돈다(render.mjs의 DIZZY_STARS). 하나면 뒤쪽
// 반원에 있는 동안 머리 위가 텅 비어 회전축이 안 보인다.
export const DIZZY_STAR = [
  '.k.',
  'kkk',
  '.k.',
];

// 서브에이전트가 붙었을 때 옆에 서서 보고하는 비서. 본체(16×12)보다 작게 그려
// "옆에 붙은 한 명"으로 읽히게 한다 — 몸통 8px · 10줄(팔까지 10px).
//
// **작게 그리는 것보다 위 규칙을 지키는 게 먼저다.** 처음에는 몸통 8px를 평평한 사각으로 두고
// 클립보드를 든 오른팔만 냈는데, 그렇게 하면 본체의 정체성이 통째로 사라진다. 확대해 보지 않고
// 데이터만 보면 "작아진 것"처럼 보이지만, 실제 크기로 부모 옆에 세워 보면 **다른 생물**로 읽혔다:
//   - 팔이 좌우로 삐져나오지 않아 실루엣이 그냥 직사각형이다 (이게 가장 컸다)
//   - 8px 몸통에 2px 눈을 1px 간격으로 붙이니 눈이 얼굴을 다 덮어 표정이 딴 것이 된다
//   - 다리가 1px이라 통통한 네 다리가 아니라 가느다란 선 네 개로 보인다
//   - 클립보드는 이 크기에서 손에 든 물건이 아니라 **떠 있는 흰 사각**으로 읽힌다
//
// 그래서 팔·눈·다리를 본체 규칙대로 되돌리고 클립보드를 버렸다. 클립보드가 쓰던 3px이
// 왼팔 자리를 먹고 있었고, 비서라는 것은 옆에 서서 하는 보고 말풍선이 이미 알려준다.
//
// **다리는 네 짝이어야 한다.** 8px 몸통에 2px 다리 네 짝은 들어가지 않아(11px 필요) 세 짝으로
// 줄여 봤는데, 다리 수는 실루엣에서 바로 세어지는 것이라 그것만으로 다른 생물이 된다.
// 그래서 몸통을 본체와 같은 12px로 키우고 **다리 줄을 본체에서 그대로 가져왔다**
// (2+1+2+2+2+1+2 — 가운데 틈만 두 배라 앞다리·뒷다리로 갈라 보인다).
// 작아 보이게 하는 몫은 키(11줄 vs 12줄)와 짧은 팔(1px vs 2px)이 맡는다.
//
// **비서가 든 것은 낱장 서류가 아니라 결재판이다.** 흰 종이 뭉치만 매달아 봤더니 세 가지가 걸렸다:
//   - 팔은 눈높이(2~4줄)인데 종이는 그 아래(5~7줄)에 있어 **손에서 떨어져 보인다**
//   - 보고 프레임에서 팔만 올라가고 종이는 제자리라 **손을 따라 움직이지 않는다**
//   - 어두운 방에서 흰 덩어리가 게보다 먼저 눈에 들어온다
//
// 그래서 **테두리 있는 판(S) + 안에 종이(w) + 위에 클립(s)**으로 바꿨다. 어두운 테두리가 배경과
// 물건을 갈라 주므로 흰 덩어리로 번지지 않고, 판 자체가 물건의 경계를 갖는다.
// 판은 **팔과 같은 줄에서 시작해** 팔(x13)이 판 테두리(x14)를 붙잡고, 보고 프레임에서
// **팔과 함께 한 줄 올라간다** — 이게 "들고 있다"를 만드는 전부다.
// 클립은 윗줄을 좁히고 밝은 금속색을 써서 실루엣만으로 읽히게 했다(글줄은 이 크기에서
// 글자가 아니라 파인 홈이 되므로 넣지 않는다).
export const CLAWD_AIDE = [
  '.rrrrrrrrrrrr.....',
  '.rrrrrrrrrrrr.....',
  'rrrkkrrrrkkrrr.ss.', // 팔 — 좌우로 1px, 눈과 같은 줄 · 판 위 클립
  'rrrkkrrrrkkrrrSwwS', // 팔(x13)이 판 테두리(x14)를 잡는다
  'rrrrrrrrrrrrrrSwwS',
  '.rrrrrrrrrrrr.SwwS',
  '.rrrrrrrrrrrr.SSSS',
  '.rrrrrrrrrrrr.....',
  '.rr.rr..rr.rr.....',
  '.rr.rr..rr.rr.....',
  '.rr.rr..rr.rr.....',
];

// 팔을 한 줄 올린 프레임 — 보고할 때 번갈아 쓴다. 본체의 STAND↔ARMS_UP와 같은 방식으로,
// 팔이 삐져나온 줄(꽉 찬 줄)을 눈 아래에서 눈 위로 옮겨 "들었다"를 만들고,
// **결재판도 같이 한 줄 올린다** — 판만 제자리에 두면 손에서 떨어진 것처럼 보인다.
export const CLAWD_AIDE_UP = [
  '.rrrrrrrrrrrr.....',
  'rrrrrrrrrrrrrr.ss.',
  'rrrkkrrrrkkrrrSwwS',
  'rrrkkrrrrkkrrrSwwS',
  '.rrrrrrrrrrrr.SwwS',
  '.rrrrrrrrrrrr.SSSS',
  '.rrrrrrrrrrrr.....',
  '.rrrrrrrrrrrr.....',
  '.rr.rr..rr.rr.....',
  '.rr.rr..rr.rr.....',
  '.rr.rr..rr.rr.....',
];

// ── 바닥 소품
// ── 산책 모드에서만 쓰는 자세 셋 (renderer/stroll-view.mjs)
//
// 바탕화면에는 책상이 없다. 큰 창에서 "작업 중"은 의자에 앉아 상판 뒤에서 팔을 놀리는
// 것이었는데, 여기서는 게가 맨바닥에 있으므로 **앉는 것부터 그려야** 노트북을 펼 수 있다.

// 바닥에 앉은 몸. 다리 세 줄을 걷어내고 **한 줄로 눌러 좌우로 1px씩 퍼뜨린다** —
// 다리를 그냥 지우면 하반신이 잘린 몸통이 되고, 접힌 다리를 그리려 하면 이 폭에서는
// 얼룩으로 읽힌다. 바닥에 닿는 줄이 몸통보다 넓은 것만이 "주저앉았다"를 만든다.
export const CLAWD_SIT = [
  '..rrrrrrrrrrrr..',
  '..rrrrrrrrrrrr..',
  '..rrrrrrrrrrrr..',
  'rrrkkrrrrrrkkrrr',
  'rrrkkrrrrrrkkrrr',
  'rrrrrrrrrrrrrrrr',
  '..rrrrrrrrrrrr..',
  '..rrrrrrrrrrrr..',
  '..rrrrrrrrrrrr..',
  '.rrrrrrrrrrrrrr.',
];

// 앉아서 팔을 한 줄 올린 프레임 — 노트북 타이핑. CLAWD_ARMS_UP과 같은 박자로 번갈아 쓴다.
// 노트북 상판이 하반신을 덮으므로 화면에 남는 것은 눈과 팔뿐이고, 그 한 줄이 전부다.
export const CLAWD_SIT_UP = [
  '..rrrrrrrrrrrr..',
  '..rrrrrrrrrrrr..',
  'rrrrrrrrrrrrrrrr',
  'rrrkkrrrrrrkkrrr',
  'rrrkkrrrrrrkkrrr',
  '..rrrrrrrrrrrr..',
  '..rrrrrrrrrrrr..',
  '..rrrrrrrrrrrr..',
  '..rrrrrrrrrrrr..',
  '.rrrrrrrrrrrrrr.',
];

// 집어 들렸을 때. 팔은 CLAWD_ARMS_HIGH처럼 위로 뻗고 **다리는 한 줄 더 길어진다.**
//
// 처음엔 들린 티를 내려고 다리를 좌우로 벌려 봤는데, 네 짝이 제각기 퍼지자 게가 아니라
// 거미가 됐다(굽어서 확인했다). 이 크기에서 다리는 **개수와 간격이 실루엣**이라 간격을
// 건드리면 다른 생물이 된다. 늘어뜨리기만 하고, 버둥은 두 프레임의 길이 차로 낸다 —
// A는 넷 다 길고 B는 안쪽 두 짝만 남는다. 걷기가 대각선 짝으로 딛는 것과 같은 수법이다.
//
// 공중에 떠 있다는 것 자체는 자세가 아니라 **그림자가 말한다**(stroll-view의 drawPet —
// 들린 동안 그림자는 바닥에 남고 몸만 커서를 따라 올라간다).
export const CLAWD_HELD_A = [
  'rr............rr',
  'rrrrrrrrrrrrrrrr',
  'rrrrrrrrrrrrrrrr',
  'rrrkkrrrrrrkkrrr',
  '..rkkrrrrrrkkr..',
  '..rrrrrrrrrrrr..',
  '..rrrrrrrrrrrr..',
  '..rrrrrrrrrrrr..',
  '..rrrrrrrrrrrr..',
  '..rr.rr..rr.rr..',
  '..rr.rr..rr.rr..',
  '..rr.rr..rr.rr..',
  '..rr.rr..rr.rr..',
  '..rr.rr..rr.rr..',
];

export const CLAWD_HELD_B = [
  'rr............rr',
  'rrrrrrrrrrrrrrrr',
  'rrrrrrrrrrrrrrrr',
  'rrrkkrrrrrrkkrrr',
  '..rkkrrrrrrkkr..',
  '..rrrrrrrrrrrr..',
  '..rrrrrrrrrrrr..',
  '..rrrrrrrrrrrr..',
  '..rrrrrrrrrrrr..',
  '..rr.rr..rr.rr..',
  '..rr.rr..rr.rr..',
  '..rr.rr..rr.rr..',
  '.....rr..rr.....',
  '.....rr..rr.....',
];

export const PLANT = [
  '....gg....',
  '..G.gg.G..',
  '.Gg.gg.gG.',
  'G.g.GG.g.G',
  '.Gg.gg.gG.',
  '..G.gg.G..',
  '...ggg....',
  '....g.....',
  '..pppppp..',
  '..pPPPPp..',
  '..pPPPPp..',
  '...pPPp...',
  '...pppp...',
];

export const CACTUS = [
  '..gg....',
  '.gGGg...',
  '.gGGg.g.',
  '.gGGg.g.',
  '.gGGggg.',
  'g.gGGg..',
  'g.gGGg..',
  'gggGGg..',
  '..gGGg..',
  'pppppppp',
  'pPPPPPPp',
  '.pPPPPp.',
  '.pppppp.',
];

// 사무실 정수기 — 게들이 몰려가는 자리
export const COOLER = [
  '.bbbbb.',
  '.bbbbb.',
  '.bbbbb.',
  '..bbb..',
  'nnnnnnn',
  'nNNNNNn',
  'nNwwwNn',
  'nNNNNNn',
  'nNNNNNn',
  'nnnnnnn',
  '.n...n.',
];

// 서버 랙 — LED는 렌더러가 위에 덧그려 깜빡인다
export const SERVER_RACK = [
  'ssssssssss',
  'sddddddddS',
  'sdtddddddS',
  'sddddddddS',
  'sdddddtddS',
  'ssssssssss',
  'sddddddddS',
  'sdtddddddS',
  'sddddddddS',
  'sddddddtdS',
  'ssssssssss',
  'sddddddddS',
  'sdtddddddS',
  'sddddddddS',
  'ssssssssss',
  '.s......s.',
];

export const BOOKSHELF = [
  'mmmmmmmmmmmmmm',
  'miyuiotziyuotm',
  'miyuiotziyuotm',
  'mmmmmmmmmmmmmm',
  'mtoizyuiotziym',
  'mtoizyuiotziym',
  'mmmmmmmmmmmmmm',
  'muizyotiuzyoim',
  'muizyotiuzyoim',
  'mmmmmmmmmmmmmm',
  'miotzyuiotzyum',
  'miotzyuiotzyum',
  'mmmmmmmmmmmmmm',
  'MMMMMMMMMMMMMM',
  '.M..........M.',
  '.M..........M.',
];

export const SOFA = [
  '.QQQQQQQQQQQQQQQQ.',
  'QQqqqqqqqqqqqqqqQQ',
  'QqqqqqqqqqqqqqqqqQ',
  'QqqqqqqqqqqqqqqqqQ',
  'QQqqqqqqqqqqqqqqQQ',
  'QQQQQQQQQQQQQQQQQQ',
  'QqqqqqqqqqqqqqqqqQ',
  'QqqqqqqqqqqqqqqqqQ',
  'QQQQQQQQQQQQQQQQQQ',
  '.x..............x.',
];

export const VENDING = [
  'ssssssssssss',
  'sSSSSSSSSSSs',
  'sSaaaaaaaaSs',
  'sSaiiayyaaSs',
  'sSaaaaaaaaSs',
  'sSaooattaaSs',
  'sSaaaaaaaaSs',
  'sSauuaeeaaSs',
  'sSaaaaaaaaSs',
  'sSSSSSSSSSSs',
  'sdddddddddds',
  'sddyyyddddds',
  'sddyyyddddds',
  'sdddddddddds',
  'sddxxxxxddds',
  'ssssssssssss',
  '.s........s.',
  '.s........s.',
];

export const COFFEE = [
  'sssssssss',
  'sdddddddS',
  'sdyyyyydS',
  'sdddddddS',
  'sssssssss',
  's.......s',
  's..CCC..s',
  's.CwwwC.s',
  's.CwwwC.s',
  's..CCC..s',
  'sssssssss',
  'sdddddddS',
  'sssssssss',
];

export const PRINTER = [
  '.ssssssssss.',
  'ssssssssssss',
  'sdddddddddds',
  'sddwwwwwwdds',
  'ssssssssssss',
  'sSSSSSSSSSSs',
  'sSttSSSSSSSs',
  'ssssssssssss',
  '.s........s.',
];

export const TRASH = [
  '.sssss.',
  'sssssss',
  'sdSSSdS',
  'sdSSSdS',
  'sdSSSdS',
  'sdSSSdS',
  '.sssss.',
];

export const FAN = [
  '..sssss..',
  '.sszzzss.',
  'sszzzzzss',
  'szzzsszzs',
  'szzsszzzs',
  'sszzzzzss',
  '.sszzzss.',
  '..sssss..',
  '....s....',
  '....s....',
  '....s....',
  '...sss...',
  '..sssss..',
  '.sssssss.',
];

export const FISHTANK = [
  'ssssssssssssss',
  'sAAAAAAAAAAAAs',
  'sAaaaaaaaaaaAs',
  'sAaaoaaaaaaaAs',
  'sAaaaaaaaiaaAs',
  'sAaaaaaaaaaaAs',
  'sAaeaaaaaeaaAs',
  'sAgeaaaaageaAs',
  'sAzzzzzzzzzzAs',
  'ssssssssssssss',
  '.s..........s.',
];

export const CABINET = [
  'sssssssssss',
  'sSSSSSSSSSs',
  'sSzzzzzzzSs',
  'sSSSSSSSSSs',
  'sSSSSSSSSSs',
  'sssssssssss',
  'sSSSSSSSSSs',
  'sSzzzzzzzSs',
  'sSSSSSSSSSs',
  'sssssssssss',
  'sSSSSSSSSSs',
  'sSzzzzzzzSs',
  'sSSSSSSSSSs',
  'sssssssssss',
];

export const BOXES = [
  '..mmmmm..',
  '..mMzMm..',
  '..mMMMm..',
  '..mmmmm..',
  'mmmmmmmmm',
  'mMMMMMMMm',
  'mMMzzzMMm',
  'mMMMMMMMm',
  'mMMMMMMMm',
  'mmmmmmmmm',
];

export const LAMP = [
  '..lll..',
  '.lllll.',
  'lllllll',
  '.sssss.',
  '...s...',
  '...s...',
  '...s...',
  '...s...',
  '...s...',
  '...s...',
  '..sss..',
  '.sssss.',
  'sssssss',
];

export const ARCADE = [
  '.sssssssss.',
  'sSSSSSSSSSs',
  'sSaaaaaaaSs',
  'sSaiiiiiaSs',
  'sSaaaaaaaSs',
  'sSaayyyaaSs',
  'sSaaaaaaaSs',
  'sSSSSSSSSSs',
  'sdddddddddS',
  'sddiddyddds',
  'sdddddddddS',
  'sssssssssss',
  'sSSSSSSSSSs',
  'sSSSSSSSSSs',
  'sSSSSSSSSSs',
  'sssssssssss',
  '.s.......s.',
  '.s.......s.',
];

export const BEAKER = [
  '..zz....',
  '..zz....',
  '..zz....',
  '.zaaz...',
  '.zaaz...',
  'zaaaaz..',
  'zaaaaz..',
  'zttttz..',
  'zttttz..',
  '.zzzz...',
];

export const EXTINGUISHER = [
  '..s..',
  '.sss.',
  'iiiii',
  'iiiii',
  'iiiii',
  'iiiii',
  'iiiii',
  'iwwwi',
  'iiiii',
  'iiiii',
];

// ── 벽 소품 (벽면 ROOM_HEAD 위에 붙는다)
export const CLOCK = [
  '...zzz...',
  '.zzwwwzz.',
  'zzwwwwwzz',
  'zwwwkwwwz',
  'zwwwkkwwz',
  'zwwwwwwwz',
  'zzwwwwwzz',
  '.zzwwwzz.',
  '...zzz...',
];

export const FRAME = [
  'zzzzzzzzzz',
  'zuuuuuuuuz',
  'zuuyyyyuuz',
  'zuyyyyyyuz',
  'zuuyyyyuuz',
  'zuuuuuuuuz',
  'zzzzzzzzzz',
];

export const WINDOW = [
  'ssssssssssssssss',
  'saaaaaassaaaaaas',
  'saaaaaassaaaaaas',
  'saaaaaassaaaaaas',
  'ssssssssssssssss',
  'saaaaaassaaaaaas',
  'saaaaaassaaaaaas',
  'saaaaaassaaaaaas',
  'ssssssssssssssss',
];

// ── 책상 위 소품 (작아야 한다 — 책상 상판은 4px)
export const MUG = [
  '..vv.v..',
  '.v..v.v.',
  '........',
  'CCCCCCC.',
  'CwwwwwC.',
  'CwwwwwCC',
  'CwwwwwC.',
  '.CCCCC..',
];

export const SNACK = [
  '.mmmmmm.',
  'mMMMMMMm',
  'mMoMMoMm',
  'mMMMMMMm',
  'mmmmmmmm',
];

export const STICKY = ['yyyy.', 'yyyy.', '.eeee', '.eeee'];

export const PAPERS = ['..wwwww', '.wwwwww', 'wwwwwww', 'zzzzzzz'];

// ── 바닥에 널브러진 것.
//
// 책상 위 PAPERS는 쌓인 더미라 네 줄인데, 이건 **한 장이 펼쳐진** 것이다.
// **픽셀에서 회전은 변형을 따로 그려 낸다** — 6px짜리를 돌릴 방법이 없으므로 각도가 다른
// 넉 장을 손으로 그린다. 아랫줄을 회색(z)으로 두면 바닥에 닿은 그림자로 읽힌다.
export const SHEET_FLAT = ['.wwwww.', 'wwwwwww', '.zzzzz.'];
export const SHEET_TILT_R = ['..wwww', '.wwwww', 'wwwww.', 'zzzz..'];
export const SHEET_TILT_L = ['wwww..', 'wwwww.', '.wwwww', '..zzzz'];
export const SHEET_NARROW = ['.www.', 'wwwww', 'wwwww', '.zzz.'];

// 오래 앉아 있던 자리에 섞이는 쓰레기.
//
// 이 크기에서는 **모양보다 색이 먼저 읽힌다.** 처음에 넘어진 컵을 머그색으로 그렸더니 낱장과
// 구분이 안 됐다 — 캔은 빨강이라 흰 종이들 사이에서 한눈에 갈린다.
//
// 구겨진 종이는 색이 낱장과 같으므로 **실루엣을 일부러 어긋나게** 둔다. 좌우가 대칭이면
// 눕힌 낱장으로 읽힌다.
export const PAPER_BALL = ['.ww..', 'wwzw.', '.wzzw', '..zz.'];
export const CAN_DOWN = ['.iiii.', 'siyyis', '.zzzz.'];

export const PHONE = ['.ddddd.', 'ddddddd', 'dSSSSSd', 'ddddddd', '.d...d.'];

export const CAN = ['zzzz', 'iiii', 'iyyi', 'iiii', 'iiii', 'zzzz'];

// ── 방 종류별 책상 위 작업 도구
// 연구실 실험대에 놓이는 삼각 플라스크 (거품은 렌더러가 덧그린다)
export const FLASK = ['.zz..', '.zz..', 'zaaz.', 'zaaz.', 'ztttz', 'zttts', '.zzz.'];

// 라운지 노트북 — 뚜껑을 세운 모습
export const LAPTOP = ['.sssssss.', '.sdddddS.', '.sdaaadS.', '.sdddddS.', '.sssssss.', 'zzzzzzzzz', 'zSSSSSSSz'];

// 바닥에서 펴는 노트북 — 산책 모드 전용. 책상 위의 LAPTOP(9px)을 그대로 쓰면 게(16px) 앞에서
// **장난감처럼 작아** 무릎에 올린 물건으로 안 읽힌다(나란히 굽어 보고 13px로 넓혔다).
// 15px까지 넓히면 이번엔 게가 노트북 뒤로 숨어 눈만 남는다 — 13이 둘 다 보이는 유일한 폭이다.
export const LAPTOP_OPEN = [
  '.sssssssssss.',
  '.sdddddddddS.',
  '.sdaaaaaaadS.',
  '.sdaaaaaaadS.',
  '.sdddddddddS.',
  '.sssssssssss.',
  'zzzzzzzzzzzzz',
  'zSSSSSSSSSSSz',
];

// 화면에 코드가 흐르는 프레임. 팔을 올린 프레임과 짝지어 번갈아 쓴다 — 몸이 1px 오르내리는
// 것만으로는 타이핑인지 숨쉬는 것인지 알 수 없고, **화면이 같이 깜빡여야** 일하는 것이 된다.
//
// 글줄은 투명이 아니라 **어두운 픽셀**이다. 처음엔 화면을 파서 냈는데, 게가 노트북 뒤에
// 앉아 있으므로 그 구멍으로 몸통이 비쳐 화면에 주황 점이 박혔다(굽어서 확인했다).
export const LAPTOP_OPEN_CODE = [
  '.sssssssssss.',
  '.sdddddddddS.',
  '.sdaaadaaadS.',
  '.sdadaaadadS.',
  '.sdddddddddS.',
  '.sssssssssss.',
  'zzzzzzzzzzzzz',
  'zSSSSSSSSSSSz',
];

// 꺼내서 펴는 두 단계. 접힌 판 → 반쯤 선 화면 → LAPTOP_OPEN.
// 스프라이트로 두는 이유는 클립으로 잘라 올리면 상판 테두리(s)까지 잘려 나가기 때문이다.
export const LAPTOP_SHUT = [
  'zzzzzzzzzzzzz',
  'zSSSSSSSSSSSz',
  '.zzzzzzzzzzz.',
];

export const LAPTOP_HALF = [
  '.sssssssssss.',
  '.sdaaaaaaadS.',
  '.sdddddddddS.',
  'zzzzzzzzzzzzz',
  'zSSSSSSSSSSSz',
];


// 자료실 열람석에 펼쳐진 책
export const BOOK = ['..z...z..', '.zwz.zwz.', 'zwwwzwwwz', 'zwwwzwwwz', 'mmmmmmmmm'];

// 디자인실 제도판 위 펜 통
export const PENCUP = ['u.y.t', 'u.y.t', 'zzzzz', 'zSSSz', 'zzzzz'];

// 회의실 테이블에 놓이는 자료 묶음
export const DOCS = ['..wwww', '.wwwww', 'wwwwww', 'zzzzzz'];

export const HEADSET = ['..kkk..', '.k...k.', 'kk...kk', 'kk...kk', 'k.....k'];

// 말풍선 안 기호 (5×7)
export const G_QUESTION = ['.kkk.', 'k...k', '....k', '..kk.', '..k..', '.....', '..k..'];
export const G_BANG = ['..k..', '..k..', '..k..', '..k..', '..k..', '.....', '..k..'];
export const G_CHECK = ['.....', '....k', '...k.', 'k..k.', '.k.k.', '..k..', '.....'];
export const G_CROSS = ['.....', 'k...k', '.k.k.', '..k..', '.k.k.', 'k...k', '.....'];
export const G_ZZZ = ['kkkk.', '...k.', '..k..', '.k...', 'kkkk.', '.....', '.....'];
export const G_HEART = ['.k.k.', 'kkkkk', 'kkkkk', 'kkkkk', '.kkk.', '..k..', '.....'];
export const G_NOTE = ['...kk', '...kk', '...k.', '...k.', '.kkk.', 'kkk..', '.k...'];
export const G_DOTS = ['.....', '.....', '.....', 'k.k.k', '.....', '.....', '.....'];
export const G_SPARK = ['..k..', 'k.k.k', '.kkk.', 'kk.kk', '.kkk.', 'k.k.k', '..k..'];

// 행 길이가 어긋난 스프라이트를 일찍 잡아낸다
export function assertRect(rows, name = 'sprite') {
  const w = rows[0].length;
  rows.forEach((row, i) => {
    if (row.length !== w) throw new Error(`${name}: row ${i} length ${row.length} !== ${w}`);
  });
  return { w, h: rows.length };
}
