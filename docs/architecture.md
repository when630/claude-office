# 구조

## 개발 실행

README는 쓰는 사람 몫이라 명령을 적지 않는다. 소스에서 굴리는 법은 여기에 있다.

```powershell
npm install       # 아이콘은 postinstall이 굽는다
npm start         # 개발 실행 (업데이트 검사는 걸리지 않는다)
npm test          # 알림 문턱·attach 명령·언어 전환 판정 (의존성 없이 node --test)
npm run icons     # 캐릭터 픽셀 → PNG 다시 굽기
npm run usage-tap # 세션·주간 사용률을 앱이 읽게 statusline에 한 줄 심는다 (선택)
npm run build     # dist/ 에 Windows 설치본(NSIS) 생성
npm run build:mac # 맥에서 실행하면 dmg+zip 생성 (Windows에서는 못 굽는다)
```

Electron 43 · 런타임 의존성은 자동 업데이트(electron-updater) 하나.
`claude agents`가 쓰는 것과 같은 `~/.claude` 파일들을 직접 읽으므로 Claude Code 외에 아무것도 필요 없다.
브랜치·커밋·릴리스 규약은 [CLAUDE.md](../CLAUDE.md)에 있다.

## 파일 지도

```
main/index.mjs      앱 수명주기 · 창 · 트레이 · 알림 · 폴링 · 설정(settings.json)
main/paths.mjs      ~/.claude 위치와 cwd→방 이름 셈법 (서로 import하지 않게 여기로 뺐다)
main/collect.mjs    세션·잡·트랜스크립트·사용량 → 스냅샷 한 장
main/transcript.mjs 대화 파일 꼬리에서 제목·상황·MR·컨텍스트·비서 캐내기
main/tasks.mjs      세션이 세운 할 일 목록 (tasks/<sessionId>/<n>.json)
main/prompts.mjs    내가 친 프롬프트 이력 (~/.claude/history.jsonl) — 읽기만 한다
main/files.mjs      만진 파일 수·편집 횟수 (file-history/) — 이름만 읽고 내용은 안 본다
main/stats.mjs      Claude Code 자체 집계 (stats-cache.json) — 읽기만 한다
main/rooms.mjs      방 묶기·별칭 (근태의 방 이름은 안 건드린다)
main/usage.mjs      office-usage.json → 5시간·주간 사용률
main/notify.mjs     무엇을 알릴지 — 대기 재알림·컨텍스트·사용량 문턱 판정.
                    Electron을 모르고 `now`를 인자로 받는다(그래서 테스트가 된다)
main/usage-tap.mjs  statusline에 사용량 tap 심기/빼기 (트레이·CLI 공용 로직)
main/notify-tap.mjs Notification 훅 심기/빼기 + 받은 문구 읽기 — 무엇을 기다리는지 알아낸다
main/terminal.mjs   세션의 터미널 열기 (Windows Terminal · Terminal.app) — id만 받아 명령을 조립한다
main/history.mjs    근태 기록 — 상태 전이만 jsonl로 남기고 물어보면 집계한다 (출근부)
main/updater.mjs    GitHub Releases 자동 업데이트 — 받아두고 트레이 재시작 또는 종료 시 설치
                    (서명 없는 맥은 설치가 거부되므로 검사만 하고 알림으로 안내)
main/preload.cjs    contextBridge (샌드박스라 CJS여야 한다)
renderer/           픽셀 렌더러 (app · render · sprites · themes · talk · style)
                    창은 네 덩이다 — 상단바 · 왼쪽 세션 목록(`#rail`) · 사무실 · 오른쪽 패널.
                    양쪽 열은 접을 수 있고 접힘은 설정에 남는다(`view.railOpen`·`view.panelOpen`).
                    패널은 판이 셋(세션 · 출근부 · 설정) — 설정·출근부가 `<dialog>`에서
                    여기로 들어왔다
                    미니 모드는 같은 index.html을 `?mini=1`로 연 **별도 창**이다 — 프레임
                    유무는 창을 만들 때 정해지고 나중에 못 바꾸기 때문이다.
                    캔버스는 큰 창과 **다른 함수**를 탄다(`layoutMini`·`renderMini`) —
                    방을 안 그리고 게만 두 줄로 모아 세운다
renderer/fonts/     번들 폰트 둘 — 사무실 픽셀 폰트(Mona S 12px)와 껍데기 본문
                    (Pretendard Variable). 둘 다 OFL 1.1. **선언만 두고 설치를 기대하지
                    않는다** — 그 전에는 설치한 사람만 Pretendard를 봤다 (renderer/fonts/README.md)
shared/pixels.mjs   픽셀 데이터 — 렌더러와 아이콘 생성기가 공유
shared/i18n.mjs     화면에 나가는 문구 — t()·언어 정하기, 기간·시각 셈법(언어별로 분기하는 것만)
shared/lang/*.mjs   언어별 사전 (순수 데이터 — UI 문구 · 방 이름 · 캐릭터 대사)
tools/make-icons.mjs        캐릭터 픽셀 → PNG (의존성 없이 직접 인코딩) — 맥 메뉴바용 16px 변형도 굽는다
tools/install-usage-tap.mjs 위 로직의 CLI 껍데기 (npm run usage-tap)
test/               `npm test` (node --test, 의존성 없음) — 알림 문턱 판정 · attach 명령 조립
                    · 사전 두 파일의 키 모양 대조(lang.test.mjs — 없는 키는 화면에 키가 적히는
                    것으로만 드러나 눈으로 볼 때까지 조용하다)
.github/workflows/release.yml  v* 태그 푸시 → Windows·macOS를 빌드해 Releases 초안 하나에 올린다
```

## 손댈 만한 곳

- `renderer/style.css` — **껍데기의 값은 다 `:root`에 있다.** 리터럴 hex는 그 정의부 밖에
  하나도 없어야 한다(모서리·글자 크기도 단으로 접혀 있고, 예외는 모양이 값을 정하는 곳뿐 —
  주석에 이유가 적혀 있다). 버튼 생김새는 셋(`.btn`·`.btn-go`·`.btn-toggle`)이고 그 위에
  모양 조각(`.btn-round`·`.btn-pill`·`.btn-wide`·`.btn-quiet`·`.btn-ico`)을 얹는다 —
  **동작을 가리키는 클래스(`.copy`·`.go`·`.hint-btn`…)는 JS가 잡으므로 건드리지 않는다.**
  `display`를 정하는 규칙에는 `[hidden]`을 같이 적는다 — UA의 `[hidden]{display:none}`은
  id·class 규칙에 밀려서, 속성만 켜고 화면은 그대로인 상태가 된다(대기 칩이 그랬고 **캔버스도
  그랬다** — `#office{display:block}`이 이겨서 전부 걸러 놓으면 안내 대신 빈 캔버스가 남았다.
  절대 배치라 안내를 덮는데, 감추는 쪽이 안 듣고 있었다)
- `renderer/app.mjs`의 `ICONS`·`icon()` — 아이콘은 **글자가 아니라 12×12 도형**이다.
  Pretendard에 `▭ ▣ ▤ ▥ ⊞ ◧ ◨ ❗`가 없어서 글자로 찍으면 글자별로 대체 폰트를 찾아 내려간다.
  뼈대에 박힌 것은 `data-icon` 속성으로 채운다(`applyStaticText`)
- `renderer/app.mjs`의 `RAIL_GROUPS` — 왼쪽 목록의 묶음과 순서. **캔버스와 같은 것을 본다**
  (`roomsToDraw`) — 목록에만 있는 세션이 생기면 눌렀는데 자리를 못 찾는다
- `renderer/app.mjs`의 배율·이동 — 자동 배율은 `pickScale`(창 폭), 손으로 정하는 것은
  `SCALES`·`zoomScale`(Ctrl+휠). **반 칸 단위이고 2배가 아래 끝이다** — 글자는 확대 밖에서
  12px로 그리므로 1배까지 줄이면 방보다 글자가 커져 이름표가 서로 덮는다(반 칸에서도 픽셀은
  또렷하다 — 축을 맞춘 `fillRect`는 기기 픽셀로 스냅된다). 줄 나누기는 `baseScale`로 재고
  (확대할 때 방이 다시 접히면 보던 방을 잃는다), `zoomTo`가 커서 밑 좌표를 붙잡는다.
  **옮기는 것은 스크롤이 아니라 사무실을 놓는 자리(`panX`·`panY`)다** — 스크롤은 0보다 작아질 수
  없어 왼쪽 위 꼭짓점에 갇히고, 그러면 모서리 방을 화면 가운데로 데려올 수 없다.
  끌 수 있는 한계는 `clampPan`(어느 점이든 화면 가운데까지, 그 이상은 안 나가 사무실을 잃지 않는다),
  스페이스를 톡 누르면 `centerOffice`. `#stage`는 그래서 `overflow: hidden`이고 캔버스는 absolute다 —
  **캔버스가 안내(`#stage-empty`)를 덮으므로 전부 걸러졌을 때는 캔버스를 감춘다**
- **캔버스는 사무실만큼이 아니라 보이는 창만큼이다**(카메라). 세계 좌표 → 화면은
  `world * scale + pan`이고 `render.mjs`가 `pan`을 받아 변환에 싣는다(글자는 확대 밖이라
  거기서 따로 더한다). 캔버스를 사무실 크기로 잡으면 끌었을 때 **바닥이 캔버스에서 끝나** 종이처럼
  잘려 보이고, 8배에서는 수천만 픽셀짜리 비트맵을 매 프레임 다시 그린다.
  바닥(`drawFloor`)은 보이는 범위를 세계 좌표로 되돌려 그만큼 깔고 **격자는 8px 세계 격자에
  맞춰** 시작한다 — 화면 기준으로 그으면 끌 때마다 격자가 떨린다
- **미니 창은 `render.mjs`의 다른 함수를 탄다** — `layoutMini`·`renderMini`이고, `app.mjs`에서
  갈라지는 곳은 `relayout`·`frame` 둘뿐이다(클릭 판정은 `pickAt`을 그대로 쓴다 — view 모양을
  맞춰 뒀다). 줄 세우는 순서는 `miniRoster`(상태 우선순위 → 오래 기다린 순 → 키), 몇 열·몇 줄·
  어느 상세도로 세울지는 `miniPlan`이다. **둘 다 순수 함수라 `test/mini.test.mjs`가 node로 돈다.**
  `miniPlan`은 상세도 셋을 **다 계산해 보고 고른다**(`planFor`) — 고르는 기준은 사전식으로
  `앞줄 인원 → 뒷줄 인원 → 상세도`다. **들어가는 가장 높은 상세도를 탐욕스럽게 집으면 안 된다** —
  상세도가 오르면 칸 최소 폭도 올라(`M_FRONT_BARE_W` → `M_FRONT_MIN_W`) 열이 줄고 앞줄이 한 줄
  늘어나는데, 그 한 줄이 뒷줄 자리를 다 먹는다. 폭 220에서 높이를 200→220으로 **키우면** 보이는
  게가 7마리에서 3마리로 줄던 것이 그거다. 이름은 마우스를 올려 볼 수 있지만 안 보이는 게는
  올려 볼 수도 없다 — 그래서 접히는 글자(경과 시간)는 호버 줄에 같이 실어 준다.
  접힌 개수(`+n`)는 **뒷줄을 다 세운 뒤 남는 자리에만** 적는다. 그 8px을 먼저 떼어 두면 뒷줄
  한 줄(25px = 게 넷)이 통째로 날아간다 — 총원은 22px 손잡이에 늘 적혀 있다.
  **상세도의 단조성은 불변식이 아니다**(뒷줄을 살리려 일부러 내려간다). 지켜야 하는 것은
  "창이 커질 때 앞줄이 줄지 않고, 앞줄이 그대로면 뒷줄도 줄지 않는다"이고 그것을 테스트가 훑는다.
  **미니에서는 전원 서 있다**(`clawdMini`) — 걷기만 끄고 앉히면 `isSeated`가 waiting을 앉음으로
  보지 않아 `clawdSeated`가 `asleep`을 골라, 나를 기다리는 게가 자는 모습으로 그려진다.
  서 있게 두면 대기가 `armsHigh`로 읽히고 의자·책상·자리 전환·잡담·비품을 통째로 안 탄다
  (그래서 `test/walk.test.mjs`도 손댈 것이 없다). 미니는 **거르기를 따르지 않는다** —
  거르기를 푸는 문(목록·배지)이 그 창에 없어서 걸러 둔 것이 사라진 것으로 읽힌다.
  방을 안 그리니 어느 방인지 짚을 길이 없어서, 게에 마우스를 올리면 22px 손잡이에
  `방 · 이름 · 경과`를 적는다(`setMiniHover`) — 좁은 창에 말풍선을 띄우면 그게 곧 옆 게를 덮는다.
  **값이 아니라 키만 들고 있는다** — 경과 분을 담아 두면 스냅샷이 안 오는 동안 멈춘다
  (상단바의 `shownWaitMin`과 같은 함정이라 1초 타이머가 호버 줄도 같이 갱신한다)
- `shared/pixels.mjs` — 한 글자가 한 픽셀, 팔레트는 파일 맨 위. 행 길이가 어긋나면 바로 에러가 난다
- `renderer/themes.mjs` — 사무실 종류(설정 창의 목록도 여기서 나온다). `station`이 자리 모양을,
  `props`·`wall`이 비품을 정한다
  (둘 다 `renderer/sprites.mjs`의 `SPR` 키 — 회의실 벽의 `screen`만 예외로 `drawScreen()`이 직접 그린다). 자리 모양을 새로 만들려면 `render.mjs`의
  `drawSurface`·`drawGear`·`clawdSeated`에 분기를 추가한다
- `shared/lang/en.mjs`·`ko.mjs` — 문장은 전부 여기 있다(UI 문구 · 방 이름 · 캐릭터 대사).
  두 파일의 키 모양이 같아야 하고, `en`이 없는 키의 대체값이다
- `renderer/talk.mjs` — **언제 무엇을 고르는지**만 정한다(문장은 사전에 있다). 시간대 구간(`TIME_SLOTS`
  — 밖에서는 `slotNow()`로 이름으로 묻는다), 주기(`CYCLE`·`SHOW`·`AIDE_CYCLE`·`HUM_CYCLE`),
  머리 옆 기호(`glyphKeyFor` — 스프라이트가 아니라 키를 돌려주므로 node로 테스트된다),
  모이는 주기(`slotOfSeg`·`hangEveryAt` — 구간 번호에서 시각을 유도한다. "지금"으로 판단하면
  경계에서 걷고 있던 구간의 출발점이 바뀌어 게가 튄다).
  문장을 고를 때 `kind`를 실어 보내면 말풍선 색이 그에 따라 갈린다
- `renderer/render.mjs` — 방 크기(`SLOT_W`·`SLOT_H`·`FLOOR_BASE`). `layout()`은 두 걸음이다 —
  크기를 재고 줄을 나눈 뒤, **줄마다 가장 높은 방에 맞춰** 나머지 방의 바닥을 늘린다
  (회의실은 테이블 때문에 자리 줄 높이가 달라 그대로 두면 줄이 어긋난다), 자리 배치(`DY_DESK` 주석에 y좌표 정리 · 그리는 곳은 `drawSurface`·`drawGear`·`clawdSeated`),
  돌아다니는 범위·속도(`bandBounds`·`SEG_MS`), 모이는 주기(`HANG_EVERY`·`HANG_EVERY_LUNCH`),
  잡담 거리(`CHAT_NEAR_X`), 비품 들르기(`VISIT_EVERY`·`VISIT_KEYS`·`DRINK_KEYS`·`VISIT_GAP` —
  목표만 갈아 끼우고 보간은 안 건드린다. `test/walk.test.mjs`가 점프를 지킨다),
  말풍선 색(`BUBBLE_STYLE`), 방 색상 `HUES`,
  심야 조명(`nightTint`·`NIGHT_L`·`NIGHT_S` — 명도를 내린 만큼 채도를 올려 방 색 구분을 남긴다),
  컨텍스트 서류(`PAPER_STEPS`·`stackPapers`·`paperX` — 문턱은 이름표 밑 막대(`level`)보다
  **일찍** 잡는다. 늦게 잡으면 막대는 노란데 서류는 없는 구간이 생긴다. 자리 모양마다 비어 있는
  끝이 달라 `PAPER_LEFT_STATIONS`로 갈린다 — 회의실만 `drawPlaceSetting`이 따로 얹는다),
  바닥에 널브러진 것(`FLOOR_FROM`·`FLOOR_PER`·`FLOOR_MAX`·`drawFloorMess` — 상판 더미와 **같은
  지점에서 같이** 자라야 한다. 위치와 모양을 장 번호로 정해야 이미 흘린 것이 안 움직인다.
  `LITTER_PAPER`·`LITTER_TRASH`·`TRASH_FROM`),
  방 상태(`roomDone`·`roomTint`·`DONE_L`), 입주 박스(`MOVEIN_MS`·`drawMoveIn` —
  "새로 뜬 방"을 정하는 곳은 `app.mjs`의 `markMoveIn`이다)
- `main/rooms.mjs` — 묶음 판정(`groupOf` — 가장 깊이 맞는 부모가 이기고 경계를 구분자로 끊는다),
  별칭(`labelOf`), 설정 정리(`sanitizeGroups`·`sanitizeAlias`).
  **묶기는 화면용 `room`만 바꾸고 근태용 `histRoom`은 그대로 둔다** — 규칙을 바꿔도 과거 기록과 이어진다
- `main/collect.mjs` — `moodOf`(상태 판정), `RECENT_DONE_MS`(퇴근 목록 유지 기간),
  `isSpare`(빈 예비 슬롯 판정), 헤매는 세션 문턱(`STUCK_ERRORS`·`STUCK_QUIET_MS` — 무진전 쪽은
  긴 빌드가 정상적으로 조용하다는 이유로 넉넉히 잡혀 있다),
  헤매기 직전(`isSlowing`·`SLOWING_QUIET_MS` — 새 상태가 아니라 표시용 신호다)
- `main/transcript.mjs` — `TAIL_BYTES`(읽는 꼬리 길이), `CONTEXT_LIMITS`(모델별 컨텍스트 창),
  `scanAides`(비서 찾기)·`AIDE_MAX_AGE_MS`(알림 없이 남은 호출을 유령으로 볼 기준),
  `scanErrorRun`(연달아 실패한 도구 호출 — 헤매는 세션 판정에 쓴다),
  `scanPlan`(승인받은 계획 — `ExitPlanMode`만 본다. 다른 도구에 실린 계획 경로는 승인이 아니다)
- `main/notify.mjs` — 재알림 문턱(`WAIT_STEPS_MS`), 트레이가 깜빡이기 시작하는 시점(`BLINK_AFTER_MS`),
  컨텍스트·사용량 문턱(`CONTEXT_STEPS`·`USAGE_STEPS`), 완료를 부를 최소 작업 시간(`DONE_MIN_BUSY_MS`),
  알림 종류(`NOTIFY_KINDS`·`NOTIFY_DEFAULTS` — 트레이 메뉴와 짝이다),
  방해금지(`QUIET_DEFAULTS`·`inQuietHours` — 자정을 넘는 구간을 다룬다. 참는 것은 토스트뿐이고
  트레이·상단바는 `index.mjs`가 그대로 그린다),
  방별 세기(`ROOM_LEVELS`·`KEEN_STEPS_MS` — 끈 방은 판정을 다 돌린 뒤 마지막에 걸러낸다),
  소리(`soundFor`·`SOUND_SILENT_KINDS` — 재알림에는 안 낸다. Electron의 `silent`는 끄는 쪽
  스위치라 부르는 쪽에서 뒤집는다),
  적을 이름(`nameOf` — 방에 별칭이 붙었으면 방 이름이 이긴다. 별칭 여부는 `label !== key`로
  알므로 설정을 여기까지 끌어오지 않는다. 트레이 목록도 같은 함수를 쓴다).
  문턱을 건드렸으면 `npm test`로 확인한다 (시각을 인자로 받으므로 30분을 기다릴 필요가 없다)
- `main/tasks.mjs` — 패널에 늘어놓을 최대 개수(`MAX_ITEMS`), 캐시 열쇠(`signature` — 디렉터리
  mtime으로는 제자리 덮어쓰기를 못 본다. 주석에 이유가 있다)
- `main/prompts.mjs` — 읽는 꼬리 길이(`TAIL_BYTES`), 건너뛸 줄 길이(`MAX_LINE`).
  집계(`summarizePrompts`)에 **문장을 담지 않는다** — 출근부 화면으로 가는 값이다
- `main/files.mjs` — 캐시 열쇠(디렉터리 mtime + 엔트리 수). 파일 **이름**은 해시라서 못 얻는다 —
  경로가 필요하면 트랜스크립트의 `Edit`/`Write`에서 가져와야 한다
- `main/stats.mjs` — 화면에 늘어놓을 일수(`DAYS`)·모델 수(`MODELS`), 낡음 판정(`staleDays` —
  오늘은 빠진 날로 세지 않는다. 캐시가 설계상 어제까지만 담기 때문이다),
  날짜 꼴(`isoDay`·`firstDate` — `computedTo`와 짝을 맞춰야 하므로 형식을 여기서 정한다)
- `main/terminal.mjs` — 터미널을 띄우는 방법(`openWindows`·`openMac`), 셸에 넘길 id의 허용 문자(`ID_OK`).
  다른 터미널 앱을 쓰려면 여기에 분기를 넣는다
- `main/history.mjs` — 무엇을 남길지(`diffEvents`), 시간을 어떻게 셀지(`summarize`·`BUCKET`),
  보존 기간(`RETAIN_MS`), 대기 목록에 올릴 최소 길이(`WAIT_WORTH_MS`),
  하루 단위 추이(`dailyTrend` — `observed`가 "앱이 켜져 있었는가"다. 안 켠 날을 0으로 그리면 거짓말이 된다).
  시각을 인자로 받으므로 하루를 기다리지 않고 `test/history.test.mjs`가 확인한다
- `main/notify-tap.mjs` — 훅이 돌릴 스크립트(`scriptSource` — `.mjs`라 ESM이다),
  받은 문구를 쓸지 정하는 규칙(`noteNeeds`·`NOTE_SLACK_MS`), 남은 파일을 버릴 기준(`NOTE_MAX_AGE_MS`)
- `main/index.mjs` — 미니 창의 **항상 위**(`createMini`): Windows에서는 `alwaysOnTop: true`만으로는
  안 된다. 기본 레벨 `floating`은 Electron이 창을 **작업 표시줄 뒤로** 옮기는 레벨이고
  (`behind_task_bar_` — `floating`·`torn-off-menu`·`modal-panel`·`main-menu`·`status`가 대상),
  그 자리는 topmost 띠 아래라서 처음엔 위에 있다가 **다른 창을 누르는 순간 가라앉는다**.
  `pop-up-menu` 이상이 작업 표시줄 위라 그 이동이 일어나지 않는다 — 대신 작업 표시줄을 덮는다.
  맥은 `NSFloatingWindowLevel`이 제대로 도므로 건드리지 않는다(올리면 Dock을 덮는다).
  초점을 잃을 때 `moveTop()`으로 한 번 더 올린다 — 초점을 가져오지 않으므로 방금 누른 창을
  방해하지 않는다.
  레벨을 올린 대가로 작업 표시줄을 덮게 되므로 **자리를 우리가 정한다**(`fitToWorkArea` —
  `screen.getDisplayMatching(bounds).workArea` 안으로 당기고 최소 크기도 여기서 채운다).
  **`move`·`resize`가 아니라 `moved`·`resized`에 건다** — 앞의 둘은 끌고 있는 동안 계속 떠서
  그때 `setBounds`를 부르면 창이 손과 싸운다(Electron도 그 사이의 `setBounds`를
  `WM_EXITSIZEMOVE`까지 미뤄 둔다). Linux에는 `moved`가 없지만 문제도 Windows 것이다.
  `display-metrics-changed`도 듣되 **창을 닫을 때 떼어낸다** — `screen`은 앱 수명 내내 살아 있어
  미니를 여닫을 때마다 청취자가 쌓인다. 작업 표시줄이 **자동 숨김이면 작업 영역이 화면 전체라서
  당길 것이 없다** — 그때는 팝업된 작업 표시줄을 미니가 덮는다(Electron이 주는 지렛대가 레벨
  하나뿐이라 여기까지가 상한이다). `MINI_MIN_H = 200`은 앞줄과 뒷줄이 같이 사는 문턱을
  `miniPlan`으로 훑어 찾은 값이다
- `main/index.mjs` — `POLL_MS`, `BLINK_MS`(깜빡임 주기), `signature`(스냅샷 중복 전송 판정에서 뺄 필드),
  전역 단축키(`HOTKEY_ACTIONS`·`ACCEL_OK`·`applyHotkeys` — 등록 실패는 반환값으로만 오므로
  `hotkeyFailed`에 담아 설정 창까지 올린다), 트레이의 대기 목록(`waitingMenu`·`waitMenuSig` —
  분이 바뀔 때만 메뉴를 다시 짠다)

## 디버그 입구

DevTools 콘솔에서 `__office.push(state)` / `__office.select(key)`로 임의 상태를 밀어넣어
입력 대기·실패처럼 평소 안 나오는 화면을 확인할 수 있다. `__office.view({ names, roomThemes })`와
`__office.lang('en')`은 설정을 **저장하지 않고** 바꿔 보는 입구다 — 헤드리스로 화면을 굽어
확인할 때 쓴다(`lang`은 main을 거치지 않으므로 `'auto'`는 뜻이 없다).
`__office.zoom(n)`은 Ctrl+휠과 같은 길로 배율을 콕 집는다(`null`이면 자동으로 복귀) —
휠 이벤트를 흉내 내지 않고 확대·축소 화면을 굽어 볼 수 있다.
`__office.layout`은 지금 그려진 방 사각형(논리 좌표)·배율·놓인 자리(`pan`)를 돌려준다 —
캡처를 방에 딱 맞게 자르려면 방이 화면 어디인지 알아야 하고, 캔버스라 DOM으로는 물어볼 수 없다.
화면 좌표는 `방 좌표 * scale + pan`이다(캔버스는 보이는 창만큼이고 사무실이 그 안에서 움직인다).

README의 캡처(`docs/images/en`·`docs/images/ko`)도 그렇게 구운 것이다 — 가짜 preload로
`window.office`를 세워 스냅샷을 밀어 넣고, 화면 밖에 **보이게** 띄운 창을 `capturePage`로 찍는다.
숨긴 창은 컴포지터가 프레임을 제시하지 않아 애니메이션 순간이 잡히지 않는다.
두 언어 캡처는 같은 시각(로드 후 경과 ms)에 찍어야 배치가 겹친다.

굽는 스크립트를 새로 짤 때 걸리는 것들:

- **최상위에서 `await app.whenReady()`를 하면 교착한다.** ESM 진입점은 모듈 평가가 끝난 뒤에야
  Electron이 `appCodeLoaded()`를 부르고 그 다음에 `ready`가 뜬다 — 모듈이 ready를 기다리고
  ready가 모듈을 기다린다. `app.whenReady().then(run)` 안에서 다 해야 한다
- 화면 밖 창의 `capturePage`가 **`UnknownVizError`로 튕긴다.** `app.disableHardwareAcceleration()`을
  ready 전에 부르고, 그래도 한 번은 튕기므로 몇 번 다시 부른다
- **가짜 preload를 쓸 때는 `sandbox: false`가 필요하다.** 샌드박스 preload에는 `fs`도
  `process.env`도 없어서 미리 정해 둔 응답을 파일에서 읽을 수 없다(진짜 앱은 샌드박스가 켜져 있다)
- 창이 좁으면 오른쪽 패널이 잘린 채 찍힌다. 패널까지 보려면 1900px쯤 잡는다
- **`?` 캡션처럼 방금 뜬 것이 있으면 캡처가 특히 잘 어긋난다.** 창이 통째로 빠진 그림이
  반복되면 코드를 의심하기 전에 `executeJavaScript`로 **좌표를 직접 재는** 편이 빠르고 정확하다
  (`getBoundingClientRect`) — 실제로 그렇게 재서 캡처만 문제였음을 확인했다
- **첫 `capturePage`는 버리고 두 번째를 쓴다.** 방금 뜬 것(창·캡션)이 커밋되기 전 프레임이
  잡히는 일이 잦다 — 창이 통째로 빠진 그림이 나오면 코드를 의심하기 전에 이것부터 본다.
  한 스크립트에서 배율·상태를 바꿔 가며 여러 장을 이어 굽는다면 **장마다 두세 번 버려야** 한다
  (앞 장과 똑같은 그림이 나오면 그건 낡은 프레임이다)
- **Windows에서는 main 프로세스의 `console.log`가 터미널에 안 나온다** (GUI 서브시스템).
  결과를 눈으로 볼 생각이면 `fs.appendFileSync`로 파일에 적는다. 그리고 `whenReady().then`
  안을 `try/catch`로 감싼다 — 안 그러면 오류가 unhandled rejection으로 조용히 사라지고
  창이 안 닫혀 스크립트가 멈춘 것처럼 보인다
- **화면 밖 창에는 `resize` 이벤트가 오지 않는다.** `win.setSize()`로 창 폭에 따른 판정을
  확인하려면 렌더러에서 `window.dispatchEvent(new Event('resize'))`로 앱이 쓰는 경로를 직접 두드린다
- **캔버스의 클릭 판정은 커서로 찾는다.** 자리 좌표를 손으로 계산하지 말고 `mousemove`를
  격자로 흘려 `canvas.style.cursor === 'pointer'`가 되는 지점을 고르면 그게 히트 테스트에
  걸리는 자리다 — 자리 사각형이 아니라 돌아다니는 게가 표적이라 계산으로는 잘 빗나간다
- **시간대 연출은 페이지의 `Date`를 갈아 끼워 확인한다.** `executeJavaScript`로 `window.Date`를
  시각을 옮긴 것으로 바꾸면 렌더러가 부르는 `new Date()`·`Date.now()`가 다 따라온다 —
  새벽까지 기다리거나 OS 시계를 만질 필요가 없다. **README 캡처에는 이게 필수다** —
  실제 시계로 찍으면 픽스처의 "지금"과 어긋나 `0분`·`방금`이 박힌다
- **창을 갈아 끼울 때 앞 창을 먼저 없애면 안 된다.** 창이 다 닫히는 순간 Electron이 앱을
  종료해(`window-all-closed` 기본 동작) 다음 `loadFile`이 `ERR_FAILED`로 끊긴다.
  두 언어를 이어서 굽는 스크립트라면 `app.on('window-all-closed', () => {})`를 걸어 둔다
- **말풍선이 떠 있는 순간은 찍어서 골라야 한다.** 8초 주기로 4.8초만 떠 있고 위상이 세션 키
  해시로 흩어져 있다(`talk.mjs`) — 고정된 시각에 찍으면 십중팔구 없는 프레임이 잡힌다.
  캔버스라 DOM으로 물어볼 수 없으니 크롭의 흰 픽셀(`BUBBLE_STYLE.real` = `#f2f4f9`)을 센다.
  기다리는 게는 세 줄을 돌리므로(무엇을 기다리는지 → 얼마나 → 재촉) 24초쯤 훑어 **가장 넓은**
  말풍선을 고르면 "무엇을 묻는지"가 걸린다
- 패널을 내용 높이에 맞춰 자를 때 **`scrollHeight`는 못 쓴다** — 내용이 상자보다 짧으면
  상자 높이를 돌려준다. 마지막 자식의 밑선을 직접 재야 실제 내용 끝이 나온다
