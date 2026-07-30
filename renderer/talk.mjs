// 혼잣말과 잡담. 상태별 상투구를 돌리되, 세션이 실제로 뭘 하고 있는지(detail·needs)를 섞어
// 말풍선만 봐도 대충 상황이 읽히게 한다.
//
// 대사는 전부 시간 + 키 해시로만 고르므로 상태를 들고 있지 않다 — 창을 다시 그려도
// 같은 순간엔 같은 말을 한다.

export function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

// 같은 seed·index면 늘 같은 값 — 프레임마다 다시 계산해도 말이 흔들리지 않는다.
export function rnd(seed, i) {
  let h = (seed ^ Math.imul(i + 1, 2654435761)) >>> 0;
  h ^= h >>> 15;
  h = Math.imul(h, 2246822507) >>> 0;
  h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
}

const LINES = {
  typing: [
    '음… 이 함수 왜 이렇게 길지',
    '테스트부터 돌려보자',
    '여기 타입이 안 맞네',
    '한 줄만 더 고치면 될 것 같은데',
    '이거 아까 고친 데 아닌가?',
    '팔이 짧아서 오타가 나네',
    '커밋 메시지 뭐라고 쓰지',
    '로그 좀 보자 로그…',
    '아 이 변수명 누가 지었어',
    '들여쓰기가 섞여 있다',
    '이 조건문 부정이 두 번 걸렸네',
    '캐시를 안 지웠구나',
    '어제 나는 무슨 생각이었을까',
    '주석이 코드보다 오래됐다',
    '이 파일만 1200줄이야',
    '됐다 돌아간다 건드리지 말자',
    '아 여기 await 빠졌다',
    '정규식은 나중에 나를 괴롭힌다',
    '재현은 되는데 원인을 모르겠다',
    '일단 로그를 더 박아보자',
    '이 라이브러리 문서가 없다',
    '탭이냐 스페이스냐 그것이 문제로다',
    '리팩터링은 다음 나에게 맡긴다',
    '괄호 하나 때문에 30분 썼다',
    '빌드가 3분이라 커피 각인데',
    'null 체크를 여기도 해야 하나',
    '지금 고친 게 맞는 파일인가',
    '이름만 바꿔도 읽히긴 하네',
  ],
  idle: [
    '조용하네…',
    '커피나 한 잔 할까',
    '다음 일은 언제 오려나',
    '스트레칭 좀 하고',
    '팔이 뻐근하다',
    '화분에 물 줘야 하는데',
    '잠깐 쉬는 거다, 노는 거 아니고',
    '할 일이 없으면 불안하다',
    '책상 좀 치울까',
    '창밖이나 볼까',
    '아무도 안 부르네',
    '대기 중인 게도 일하는 거다',
    '심심하면 문서라도 읽어야지',
    '정수기 물이 시원하다',
    '옆방은 바쁜가 보다',
    '오늘 걸음 수가 부족하다',
    '발톱 손질 좀 해야겠다',
    '이럴 때 이슈나 훑어볼까',
    '한가한 게 제일 좋은 신호다',
    '누가 커피 사줬으면',
    '의자가 삐걱거린다',
    '점심 뭐 먹지',
  ],
  waiting: [
    '저기요, 이것 좀 봐주세요',
    '답 기다리는 중…',
    '여보세요? 계세요?',
    '이대로 진행해도 되나요',
    '확인만 해주면 바로 갑니다',
    '허락 한 번만 주세요',
    '둘 중 뭘 고를까요',
    '여기서 멈춰 있습니다',
    '팔 들고 기다립니다',
    '자리 비우신 건가요…',
    '한 마디만 해주시면 됩니다',
    '기다리는 것도 일입니다만',
    '되돌릴 수 없는 작업이라서요',
    '제 판단으로 해도 될까요',
    '이 파일 지워도 되나요',
    '터미널 좀 봐주세요',
  ],
  done: [
    '끝! 다 했다',
    '오늘도 한 건 했다',
    '이제 퇴근각인가',
    '커밋까지 완료',
    '테스트 전부 초록불',
    '깔끔하게 마무리했다',
    '이건 좀 잘한 것 같은데',
    '다음 일 주세요',
    'MR 올려뒀습니다',
    '기록 남기고 마칩니다',
    '팔을 걷어붙인 보람이 있다',
    '한 번에 통과했다',
  ],
  failed: [
    '아… 망했다',
    '뭐가 문제였지',
    '로그 다시 보자',
    '이건 내 잘못이 아닌 것 같은데',
    '환경 문제였으면 좋겠다',
    '다시 처음부터…',
    '팔이 미끄러졌다',
    '분명 로컬에선 됐는데',
    '원인은 알겠는데 고칠 방법이…',
    '한 번만 더 돌려보자',
    '이 에러 메시지 불친절하다',
    '기록은 남겨두자',
  ],
  stopped: [
    '…',
    '잠깐 멈춤',
    '누가 날 껐다',
    '여기까지만',
    '전원이 나갔다',
    '다음에 이어서 하자',
    '중단됨. 이유는 모름',
  ],
};

// 시간대에 따라 섞어 넣는 한마디 — 밤늦게 야근하는 놈이 있으면 티가 난다.
const TIME_LINES = [
  { from: 5, to: 9, lines: ['아침 공기가 좋다', '벌써 출근했다', '오늘은 일찍 왔네', '해가 뜬다'] },
  { from: 9, to: 12, lines: ['오전이 제일 잘 돌아간다', '집중 잘 되는 시간', '커피 두 잔째'] },
  { from: 12, to: 14, lines: ['점심 먹고 졸리다', '밥 먹고 오니 코드가 낯설다', '식후 산책 중'] },
  { from: 14, to: 18, lines: ['오후는 길다', '나른한데 마감은 온다', '커피 한 잔 더 할까'] },
  { from: 18, to: 22, lines: ['오늘은 야근인가', '해 지는 거 봤다', '퇴근 얘기는 꺼내지 말자'] },
  { from: 22, to: 24, lines: ['이 시간까지 뭐 하는 거지', '밤에 고친 코드는 무섭다', '내일의 나에게 맡기자'] },
  { from: 0, to: 5, lines: ['새벽엔 팔이 시리다', '자야 하는데', '이 시간의 나를 믿지 마라', '아무도 안 본다'] },
];

function timeLines(now = new Date()) {
  const h = now.getHours();
  const slot = TIME_LINES.find((s) => h >= s.from && h < s.to);
  return slot?.lines ?? [];
}

// 둘이 마주쳤을 때 주고받는 대화 — [먼저 말하는 쪽, 대답하는 쪽]
const DUOS = [
  ['빌드 됐어?', '아직 도는 중'],
  ['그거 네가 고쳤어?', '나 아니야'],
  ['커피 마실래?', '팔이 떨려서 안 돼'],
  ['이 브랜치 머지해도 돼?', '조금만 기다려'],
  ['오늘 몇 시에 퇴근해?', '그런 게 있었나'],
  ['테스트 왜 깨졌어?', '내 쪽은 초록불인데'],
  ['그 파일 나도 건드렸어', '아 충돌이다'],
  ['점심 뭐 먹었어?', '아무것도 안 먹었어'],
  ['이거 리뷰 좀', '지금은 손이 없어'],
  ['옆방 시끄럽지 않아?', '서버실이라 어쩔 수 없어'],
  ['나 지금 막혔어', '로그 먼저 봐'],
  ['그 라이브러리 써봤어?', '문서가 없어서 포기했어'],
  ['팔 관리 어떻게 해?', '자주 안 쓰는 게 최고야'],
  ['MR 번호 뭐였지', '내가 올린 게 아니라서'],
  ['잠깐 자리 봐줄래?', '어디 가는데'],
  ['이 코드 누가 썼어?', '3년 전 우리 중 누군가'],
  ['오늘 알람 몇 개 왔어?', '세는 걸 포기했어'],
  ['화분에 물 줬어?', '어제 줬다고 했잖아'],
  ['그 이슈 아직 열려 있어?', '아무도 안 건드려'],
  ['배포는 언제 해?', '금요일은 아니야'],
  ['정규식 도와줄 수 있어?', '그건 아무도 못 도와'],
  ['왜 여기 서 있어?', '기다리는 중이야'],
  ['수고했어', '너도'],
  ['이 회의 필요했나', '나한테 묻지 마'],
  ['타입 에러 봤어?', '무시하면 사라져'],
  ['새로 온 게 있대', '자리는 어디야'],
  ['프린터 또 걸렸어', '그건 원래 그래'],
  ['캐시 지웠어?', '그 생각을 못 했다'],
  ['조금만 조용히 해줄래', '나 아무 말도 안 했어'],
  ['같이 퇴근할래?', '난 아직 도는 중이야'],
];

export function chatLines(pairKey, index) {
  const seed = hashStr(`${pairKey}#${index}`);
  return DUOS[Math.floor(rnd(seed, 3) * DUOS.length)];
}

// ── 비서 보고. 서브에이전트가 돌고 있는 동안 옆에 선 비서가 진행 상황을 읊는다.
// {label} 서브에이전트가 받은 지시, {kind} 종류, {n} 붙어 있는 수.
const AIDE_LINES = [
  '{label} 확인 중입니다',
  '{label} — 아직 돌고 있습니다',
  '{label} 마무리 단계입니다',
  '{label} 쪽은 제가 봅니다',
  '{label} 결과 오면 바로 알려드립니다',
  '{label} 절반쯤 왔습니다',
  '{label} 취합해 두겠습니다',
];
const AIDE_LINES_BARE = [
  '{kind} 하나 돌고 있습니다',
  '{kind} 쪽은 제가 봅니다',
  '결과 나오면 바로 알려드립니다',
  '아직 회신이 없습니다',
  '조금만 더 걸립니다',
  '제가 정리해서 올리겠습니다',
  '지금 확인하고 있습니다',
];
const AIDE_LINES_MANY = [
  '보조 {n}명 붙었습니다',
  '{n}건 동시에 돌고 있습니다',
  '{n}명 결과를 모으는 중입니다',
];

const AIDE_CYCLE = 6400;
const AIDE_SHOW = 4600;

// 지금 비서가 뭐라고 보고하는지. 서브에이전트가 없으면 null.
export function reportFor(worker, t) {
  const aides = worker.aides ?? [];
  if (!aides.length) return null;
  const seed = hashStr(`${worker.key}#aide`);
  const tt = t + (seed % AIDE_CYCLE);
  const f = tt % AIDE_CYCLE;
  if (f > AIDE_SHOW) return null;

  const i = Math.floor(tt / AIDE_CYCLE);
  const a = aides[i % aides.length];
  // 여럿이 붙었으면 가끔은 머릿수부터 알린다
  const pool = aides.length > 1 && i % 3 === 0 ? AIDE_LINES_MANY : a.label ? AIDE_LINES : AIDE_LINES_BARE;
  const tpl = pool[Math.floor(rnd(seed, i) * pool.length)];
  const text = tpl
    .replace('{label}', trim(a.label, 34))
    .replace('{kind}', a.kind || 'agent')
    .replace('{n}', String(aides.length));
  // 실제로 읽어온 값(받은 지시·종류·머릿수)이 들어간 문장만 "세션 기반"으로 본다
  const real = /\{(label|kind|n)\}/.test(tpl);
  return { text, alpha: fade(f, AIDE_SHOW), kind: real ? 'real' : 'idle' };
}

function trim(s, n) {
  if (!s) return '';
  const flat = String(s).replace(/\s+/g, ' ').trim();
  return flat.length > n ? flat.slice(0, n - 1) + '…' : flat;
}

// 상투구 대신 내보낼 "진짜" 한마디
function realLine(worker) {
  if (worker.mood === 'waiting' && worker.needs) return trim(worker.needs, 52);
  if (worker.detail) return trim(worker.detail, 52);
  if (worker.mood === 'typing' && (worker.lastPrompt || worker.intent))
    return trim(worker.lastPrompt || worker.intent, 52);
  if (worker.title) return trim(worker.title, 52);
  return '';
}

// 자리를 오갈 때 하는 한마디. 일을 끝내고 일어설 때와 일을 받아 앉으러 갈 때.
//
// 대사는 statusAt으로 고른다 — 전환 한 번 동안에는 같은 말이어야 하고(프레임마다 바뀌면
// 읽을 수 없다), 다음 번에는 다른 말이 나와야 한다.
const MOVE_LINES = {
  done: ['다 했다!', '일단 여기까지', '끝냈습니다', '한숨 돌리자', '보고 끝', '커피 마시러 간다'],
  start: ['자, 시작해볼까', '받았습니다', '바로 갑니다', '어디 보자', '이제 좀 해보자', '출발'],
};

export function moveSpeech(worker, note) {
  const pool = MOVE_LINES[note];
  if (!pool) return null;
  const seed = hashStr(worker.key) + Math.floor((worker.statusAt ?? 0) / 1000);
  return { text: pool[Math.floor(rnd(seed, 3) * pool.length)], alpha: 1, kind: 'idle' };
}

// 얼마나 기다렸는지. 오래 방치된 대기가 눈에 띄어야 한다.
//
// 1분 안쪽은 적지 않는다 — "0분째"는 정보가 아니라 소음이고, 금방 답할 프롬프트까지
// 재촉하는 꼴이 된다. worker.statusAt은 status가 'waiting'으로 바뀐 절대 시각이므로
// 스냅샷이 늦게 와도 여기서 직접 세면 시간이 맞는다.
function waitedLine(worker) {
  if (worker.mood !== 'waiting' || !worker.statusAt) return '';
  const m = Math.floor((Date.now() - worker.statusAt) / 60000);
  if (m < 1) return '';
  if (m < 60) return `${m}분째 기다리는 중…`;
  const h = Math.floor(m / 60);
  return `${h}시간 ${m % 60}분째 기다리는 중…`;
}

const CYCLE = 8000; // 한마디 주기
const SHOW = 4800; // 떠 있는 시간
const FADE = 420;

export function fade(f, show = SHOW, fadeMs = FADE) {
  if (f < fadeMs) return f / fadeMs;
  if (f > show - fadeMs) return Math.max(0, (show - f) / fadeMs);
  return 1;
}

// 지금 이 순간 이 캐릭터가 뭐라고 중얼거리는지. 말이 없는 구간이면 null.
// extra는 방 종류별 대사 — 개발실에서만 하는 말 같은 것.
export function speechFor(worker, t, extra = []) {
  const seed = hashStr(worker.key);
  const tt = t + (seed % CYCLE); // 다 같이 입을 열지 않도록 위상을 흩는다
  const f = tt % CYCLE;
  if (f > SHOW) return null;

  const i = Math.floor(tt / CYCLE);
  // 기다리는 중이면 셋을 돌린다: 무엇을 기다리는지 → 얼마나 기다렸는지 → 재촉하는 상투구.
  // 경과 시간도 세션에서 나온 값이라 'real'(흰 말풍선)로 보낸다.
  const waited = waitedLine(worker);
  if (waited && i % 3 === 1) return { text: waited, alpha: fade(f), kind: 'real' };

  const real = realLine(worker);
  const base = LINES[worker.mood] ?? LINES.idle;
  // 일하는 중이 아니면 방 분위기와 시간대 얘기도 한다
  const flavour = worker.mood === 'typing' || worker.mood === 'waiting' ? [] : [...extra, ...timeLines()];
  const pool = flavour.length && rnd(seed, i * 7 + 1) < 0.3 ? flavour : base;
  const useReal = Boolean(real) && i % 2 === 0;
  const text = useReal ? real : pool[Math.floor(rnd(seed, i) * pool.length)];
  if (!text) return null;

  // kind는 말풍선 색을 가른다 — 세션에서 읽어온 말인지, 우리가 써 둔 상투구인지
  return { text, alpha: fade(f), kind: useReal ? 'real' : 'idle' };
}
