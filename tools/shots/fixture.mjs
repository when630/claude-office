// README 캡처용 가짜 스냅샷.
//
// 평소에는 한 화면에 같이 안 나오는 상태(입력 대기 · 실패 · 헤맴 · 승인받은 계획 ·
// 서브에이전트 · 할 일)를 한 사무실에 모아 둔다. 진짜 세션을 기다려서는 이런 화면을
// 만들 수 없다.
//
// **두 언어를 한 곳에서 낸다.** 말풍선 · 타임라인 · 할 일은 UI 사전이 아니라 스냅샷에서
// 오므로 언어마다 다른 픽스처가 필요한데, 파일을 둘로 나눠 두면 한쪽만 고치고 잊는다.
// `s(ko, en)`으로 짝을 쓰는 자리에 나란히 둬서 갈라지지 않게 한다.

// 픽스처의 "지금". **고정값이라야 한다** — 실제 시계로 찍으면 기다린 시간·가동 시간이
// `0분`·`방금`으로 박히고, 두 언어 캡처의 숫자도 서로 어긋난다.
// 굽는 쪽에서 페이지의 `Date`를 이 값으로 갈아 끼운다(tools/bake-readme.mjs).
export const NOW = Date.parse('2026-08-04T15:50:30+09:00');

const min = (n) => NOW - n * 60_000;
const iso = (n) => new Date(min(n)).toISOString();

export function buildFixture(lang) {
  const s = (ko, en) => (lang === 'en' ? en : ko);

  // 캔버스 이름표가 `name`을 그대로 쓴다 — 빼면 render.mjs가 던지고 사무실이 텅 빈다.
  const worker = (o) => ({
    key: o.key,
    sessionId: o.key.replace(/^\w+:/, ''),
    jobId: null,
    pid: o.pid ?? 30112,
    name: o.name ?? o.room,
    title: o.intent ?? '',
    cwd: o.cwd,
    room: o.room,
    histRoom: o.room,
    kind: 'interactive',
    status: 'idle',
    mood: o.mood,
    slowing: false,
    // 서버 장애는 mood가 아니라 그 위에 얹히는 표시다(main/collect.mjs의 isBroken).
    // brokenAt이 있어야 세션 목록이 "몇 분째 응답이 없다"를 적는다.
    broken: o.broken ?? false,
    brokenAt: o.broken ? (o.brokenAt ?? min(2)) : null,
    detail: o.detail ?? '',
    needs: o.needs ?? null,
    suggestedReply: o.suggestedReply ?? null,
    tokens: o.tokens ?? 0,
    links: [],
    intent: o.intent ?? '',
    lastPrompt: o.lastPrompt ?? '',
    aides: o.aides ?? [],
    tasks: o.tasks ?? null,
    plan: o.plan ?? null,
    files: o.files ?? null,
    mode: o.mode ?? 'normal',
    model: o.model ?? 'claude-fable-5',
    context: o.context ?? null,
    startedAt: o.startedAt ?? min(47),
    updatedAt: min(1),
    statusAt: o.statusAt ?? null,
    timeline: o.timeline ?? [],
  });

  // 모양은 main/tasks.mjs가 정한다 — { id, subject, status, blockedBy }에
  // total·done·active·blocked를 곁들인 꼴이다. blockedBy를 빼면 패널이 터진다.
  const taskList = (items) => ({
    total: items.length,
    done: items.filter((i) => i.status === 'completed').length,
    active: items.filter((i) => i.status === 'in_progress'),
    blocked: items.filter((i) => i.status !== 'completed' && i.blockedBy.length).length,
    items,
  });

  const rooms = [
    {
      key: 'api-gateway',
      label: 'api-gateway',
      cwd: 'D:\\AIProject\\api-gateway',
      workers: [
        worker({
          key: 'sess:a1b2c3d4',
          cwd: 'D:\\AIProject\\api-gateway',
          room: 'api-gateway',
          mood: 'waiting',
          detail: s('npm test 실행 승인을 기다리는 중', 'Waiting for approval to run npm test'),
          needs: s('Bash로 npm test를 실행해도 될까요?', 'Allow Bash to run npm test?'),
          suggestedReply: s('네, 실행해줘', 'Yes, go ahead'),
          intent: s('라우터 테스트 고치기', 'Fixing the router tests'),
          lastPrompt: s('실패한 라우터 테스트부터 봐줘', 'Start with the failing router tests'),
          tokens: 380_000,
          statusAt: min(3),
          context: { tokens: 380_000, limit: 1_000_000, pct: 38 },
          timeline: [
            { at: iso(2), state: 'waiting', detail: s('Bash 승인을 요청했습니다', 'Asked to run Bash') },
            { at: iso(9), state: 'working', detail: s('라우터 테스트를 고쳤습니다', 'Fixed the router tests') },
            { at: iso(17), state: 'working', detail: s('실패한 테스트를 살펴보겠습니다', 'Looking at the failing tests') },
          ],
        }),
        // 서버 장애로 멈춘 세션. **자리를 비운 놈으로 둔다** — 턴이 에러로 끝나면 status가
        // idle로 떨어지는 것이 실제 모습이고, 바닥에서 어지러워하는 편이 캡처에서 잘 읽힌다
        // (자리에 앉으면 상판과 모니터가 몸의 절반을 가린다). 이 방의 다른 하나는 대기라
        // 책상 앞에 서 있으므로 바닥에서 둘이 겹치지 않는다.
        worker({
          key: 'sess:9a9a9a9a',
          cwd: 'D:\\AIProject\\api-gateway',
          room: 'api-gateway',
          mood: 'idle',
          broken: true,
          intent: s('스키마 마이그레이션', 'Schema migration'),
          lastPrompt: s('스키마 바뀐 것 반영해줘', 'Apply the schema change'),
          tokens: 45_000,
          context: { tokens: 45_000, limit: 1_000_000, pct: 5 },
        }),
      ],
    },
    {
      key: 'claude-office',
      label: 'claude-office',
      cwd: 'D:\\AIProject\\claude-office',
      workers: [
        worker({
          key: 'sess:e4b4bc3c',
          cwd: 'D:\\AIProject\\claude-office',
          room: 'claude-office',
          mood: 'typing',
          detail: s('README에 넣을 캡처를 다시 굽는 중', 'Re-baking the README screenshots'),
          intent: s('README 개편', 'Reworking the README'),
          lastPrompt: s(
            'README를 읽는 사람 관점으로 다시 쓰고 캡처도 새로 찍어줘',
            'Rewrite the README from the reader’s side and retake the screenshots',
          ),
          tokens: 720_000,
          context: { tokens: 720_000, limit: 1_000_000, pct: 72 },
          // 비서는 { kind, label } 꼴이라야 한다 — 다른 필드명을 주면 렌더 루프가 죽고
          // 캔버스가 텅 빈 채로 저장된다
          aides: [{ kind: 'Explore', label: s('말풍선을 그리는 곳', 'where speech bubbles are drawn') }],
          files: { files: 14, edits: 38 },
          tasks: taskList([
            { id: '1', subject: s('캡처 하니스를 만든다', 'Build the capture harness'), status: 'completed', blockedBy: [] },
            { id: '2', subject: s('네 장면을 굽는다', 'Bake the four shots'), status: 'completed', blockedBy: [] },
            { id: '3', subject: s('토큰을 세운다', 'Set up the tokens'), status: 'completed', blockedBy: [] },
            { id: '4', subject: s('README 문장을 다시 쓴다', 'Rewrite the README copy'), status: 'in_progress', blockedBy: [] },
            { id: '5', subject: s('한국어판도 맞춘다', 'Match the Korean version'), status: 'pending', blockedBy: ['4'] },
            { id: '6', subject: s('링크가 깨지지 않았는지 본다', 'Check for broken links'), status: 'pending', blockedBy: [] },
          ]),
          plan: {
            file: 'D:\\AIProject\\claude-office\\.claude\\plan-readme.md',
            title: s('README를 읽는 사람 순서로 다시 짠다', 'Reorder the README the way a reader arrives'),
          },
          timeline: [
            { at: iso(4), state: 'working', detail: s('캡처 4장을 docs/images에 저장했습니다', 'Saved 4 screenshots to docs/images') },
            { at: iso(13), state: 'working', detail: s('헤드리스 캡처 하니스를 만들었습니다', 'Built the headless capture harness') },
            { at: iso(27), state: 'working', detail: s('패널 구성부터 살펴보겠습니다', 'Starting with the panel layout') },
            {
              at: iso(38),
              state: 'prompt',
              detail: s(
                'README를 읽는 사람 관점으로 다시 쓰고 캡처도 새로 찍어줘',
                'Rewrite the README from the reader’s side and retake the screenshots',
              ),
            },
          ],
        }),
        worker({
          key: 'sess:f7f7f7f7',
          cwd: 'D:\\AIProject\\claude-office',
          room: 'claude-office',
          mood: 'stuck',
          detail: s('같은 오류를 세 번 만났습니다', 'Hit the same error three times'),
          intent: s('아이콘 굽기 고치기', 'Fixing the icon build'),
          tokens: 210_000,
          context: { tokens: 210_000, limit: 1_000_000, pct: 21 },
        }),
      ],
    },
    {
      key: 'portal',
      label: 'portal',
      cwd: 'D:\\work\\portal',
      workers: [
        worker({
          key: 'sess:11112222',
          cwd: 'D:\\work\\portal',
          room: 'portal',
          mood: 'waiting',
          detail: s('계획 승인을 기다리는 중', 'Waiting for the plan to be approved'),
          needs: s('이 계획으로 진행할까요?', 'Go ahead with this plan?'),
          intent: s('결제 흐름 정리', 'Tidying the checkout flow'),
          tokens: 540_000,
          statusAt: min(1),
          context: { tokens: 540_000, limit: 1_000_000, pct: 54 },
        }),
        // **자리에 앉혀 둔다.** 방을 어슬렁거리는 클로드가 한 방에 둘이면 세 구간마다 오는
        // 모임(render.mjs의 HANG_EVERY)에서 러그 위에 겹쳐 한 덩어리로 찍힌다.
        worker({
          key: 'sess:33334444',
          cwd: 'D:\\work\\portal',
          room: 'portal',
          mood: 'typing',
          detail: s('화면에서 문구를 뽑아내는 중', 'Pulling the strings out of the views'),
          intent: s('i18n 문구 뽑기', 'Extracting i18n strings'),
          tokens: 88_000,
          context: { tokens: 88_000, limit: 1_000_000, pct: 9 },
        }),
      ],
    },
    {
      key: 'billing',
      label: 'billing',
      cwd: 'D:\\work\\billing',
      workers: [
        worker({
          key: 'sess:55556666',
          cwd: 'D:\\work\\billing',
          room: 'billing',
          mood: 'failed',
          detail: s('마이그레이션이 롤백됐습니다', 'The migration rolled back'),
          intent: s('야간 리포트', 'Nightly report'),
          tokens: 96_000,
          // 바닥까지 어질러진 방을 보여주려고 일부러 높게 잡았다
          context: { tokens: 960_000, limit: 1_000_000, pct: 96 },
        }),
      ],
    },
  ];

  const state = {
    ts: NOW,
    rooms,
    recent: [
      { key: 'job:usage-tap', jobId: 'usage-tap', name: 'usage-tap', state: 'done', detail: s('statusline tap 설치 흐름을 정리', 'Tidied the statusline tap setup'), tokens: 210_000, links: [], at: min(25) },
      { key: 'job:release-notes', jobId: 'release-notes', name: 'release-notes', state: 'done', detail: s('릴리스 노트 초안', 'Release notes draft'), tokens: 88_000, links: [], at: min(96) },
      { key: 'job:tray-icons', jobId: 'tray-icons', name: 'tray-icons', state: 'failed', detail: s('아이콘 굽기가 실패했습니다', 'The icon build failed'), tokens: 12_000, links: [], at: min(140) },
    ],
    // 상단바 숫자는 여기서 온다 — 위 workers를 고쳤으면 같이 고쳐야 화면이 맞는다
    stats: { total: 7, typing: 2, stuck: 1, waiting: 2, broken: 1, idle: 0, failed: 1, tokens: 3_185_000, contextMax: 96, aides: 1, spare: 1 },
    usage: {
      at: min(1),
      session: { pct: 42, resetAt: Date.parse('2026-08-04T18:25:00+09:00'), leftMs: 2 * 3600_000 + 34 * 60_000 },
      week: { pct: 63, resetAt: Date.parse('2026-08-06T15:49:00+09:00'), leftMs: 47 * 3600_000 + 58 * 60_000 },
    },
  };

  return {
    state,
    meta: { version: '1.1.0', claudeDir: 'C:\\Users\\you\\.claude', lang, pref: lang, platform: 'win32' },
    view: {
      names: 'show',
      roomThemes: {},
      pinned: ['claude-office'],
      collapsed: [],
      roomGroups: [],
      roomAlias: {},
      roomLevels: {},
      // 방 자리를 **콕 집어 둔다.** 배치는 칸 그리드이고 자동은 세 열로 늘어서므로
      // (renderer/render.mjs의 GRID_COLS) 그대로 두면 사무실이 무대보다 넓어져 캡처의
      // 좌우가 잘린다. 2×2로 앉히면 3배에서 딱 들어가고, 사람이 자리를 정할 수 있다는
      // 것도 그림에 그대로 담긴다.
      roomSlots: {
        'claude-office': [0, 0],
        'api-gateway': [1, 0],
        portal: [0, 1],
        billing: [1, 1],
      },
    },
    // main/index.mjs의 notifySettings()가 돌려주는 모양. kinds·levels·doneAfterMs가 없으면
    // 알림 탭과 방 탭이 그리다 터진다.
    notify: {
      kinds: ['waiting', 'escalate', 'context', 'usage', 'done', 'stuck'],
      notify: { waiting: true, escalate: true, context: true, usage: true, done: false, stuck: false },
      quiet: { on: true, from: '22:00', to: '08:00' },
      doneAfterMs: 3 * 60_000,
      levels: ['off', 'normal', 'keen'],
      roomNotify: { billing: 'off', 'api-gateway': 'keen' },
    },
    hotkeys: {
      hotkeys: {
        toggle: 'CommandOrControl+Alt+O',
        jump: 'CommandOrControl+Alt+W',
        mini: 'CommandOrControl+Alt+M',
      },
      failed: [],
    },
    history: {
      on: true,
      retainDays: 14,
      today: {
        from: '2026-08-04',
        to: '2026-08-04',
        at: NOW,
        sessions: 9,
        busyMs: 4 * 3600_000 + 12 * 60_000,
        waitMs: 38 * 60_000,
        maxCtx: 72,
        rooms: [
          { room: 'claude-office', sessions: 4, busyMs: 2 * 3600_000 + 41 * 60_000, waitMs: 21 * 60_000, idleMs: 3 * 3600_000 + 2 * 60_000 },
          { room: 'portal', sessions: 3, busyMs: 68 * 60_000, waitMs: 12 * 60_000, idleMs: 104 * 60_000 },
          { room: 'api-gateway', sessions: 1, busyMs: 17 * 60_000, waitMs: 5 * 60_000, idleMs: 63 * 60_000 },
          { room: 'billing', sessions: 1, busyMs: 6 * 60_000, waitMs: 0, idleMs: 16 * 60_000 },
        ],
        waits: [
          { room: 'claude-office', ms: 14 * 60_000, at: Date.parse('2026-08-04T10:50:00+09:00') },
          { room: 'portal', ms: 9 * 60_000, at: Date.parse('2026-08-04T12:50:00+09:00') },
          { room: 'api-gateway', ms: 5 * 60_000, at: Date.parse('2026-08-04T14:30:00+09:00') },
          { room: 'claude-office', ms: 4 * 60_000, at: Date.parse('2026-08-04T15:10:00+09:00') },
        ],
        hours: Array.from({ length: 24 }, (_, h) => (h >= 9 && h <= 18 ? (h % 5) + 1 : 0)),
        prompts: { total: 42, rooms: [{ room: 'claude-office', n: 26 }, { room: 'portal', n: 11 }, { room: 'api-gateway', n: 5 }] },
      },
      week: {
        from: '2026-07-29',
        to: '2026-08-04',
        at: NOW,
        sessions: 38,
        busyMs: 26 * 3600_000,
        waitMs: 4 * 3600_000 + 8 * 60_000,
        maxCtx: 96,
        rooms: [
          { room: 'claude-office', sessions: 19, busyMs: 14 * 3600_000, waitMs: 121 * 60_000, idleMs: 20 * 3600_000 },
          { room: 'portal', sessions: 12, busyMs: 8 * 3600_000, waitMs: 74 * 60_000, idleMs: 12 * 3600_000 },
          { room: 'api-gateway', sessions: 7, busyMs: 4 * 3600_000, waitMs: 53 * 60_000, idleMs: 6 * 3600_000 },
        ],
        waits: [
          { room: 'portal', ms: 31 * 60_000, at: Date.parse('2026-08-01T16:20:00+09:00') },
          { room: 'claude-office', ms: 22 * 60_000, at: Date.parse('2026-07-31T11:05:00+09:00') },
        ],
        // 앱이 꺼져 있던 날은 `seen: false`로 둔다 — 0으로 그리지 않고 점선으로 비우는 자리다
        trend: [
          { day: '07-29', ms: 42 * 60_000, seen: true },
          { day: '07-30', ms: 63 * 60_000, seen: true },
          { day: '07-31', ms: 51 * 60_000, seen: true },
          { day: '08-01', ms: 74 * 60_000, seen: true },
          { day: '08-02', ms: 0, seen: false },
          { day: '08-03', ms: 19 * 60_000, seen: true },
          { day: '08-04', ms: 38 * 60_000, seen: true },
        ],
        hours: Array.from({ length: 24 }, (_, h) => (h >= 8 && h <= 20 ? ((h * 7) % 9) + 1 : 0)),
        prompts: { total: 214, rooms: [{ room: 'claude-office', n: 121 }, { room: 'portal', n: 58 }, { room: 'api-gateway', n: 35 }] },
      },
      // 출근부의 `Claude Code` 판. messages·hours를 본다 — tokens만 주면 NaN이 찍힌다
      code: {
        staleDays: 0,
        firstDate: '2026-07-21',
        computedTo: '2026-08-03',
        totalSessions: 48,
        totalMessages: 2080,
        longestSessionMs: 3 * 3600_000 + 12 * 60_000,
        days: [
          { date: '2026-07-28', messages: 240, sessions: 6, tokens: 2_100_000 },
          { date: '2026-07-29', messages: 410, sessions: 9, tokens: 3_400_000 },
          { date: '2026-07-30', messages: 330, sessions: 7, tokens: 2_800_000 },
          { date: '2026-07-31', messages: 520, sessions: 11, tokens: 4_100_000 },
          { date: '2026-08-01', messages: 180, sessions: 5, tokens: 1_600_000 },
          { date: '2026-08-02', messages: 40, sessions: 2, tokens: 400_000 },
          { date: '2026-08-03', messages: 360, sessions: 8, tokens: 3_000_000 },
        ],
        hours: Array.from({ length: 24 }, (_, h) => (h >= 9 && h <= 19 ? ((h * 13) % 11) + 2 : 0)),
        models: [
          { model: 'claude-fable-5', tokens: 12_400_000 },
          { model: 'claude-sonnet-5', tokens: 4_200_000 },
        ],
      },
    },
  };
}
