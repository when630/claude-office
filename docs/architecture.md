# 구조

```
main/index.mjs      앱 수명주기 · 창 · 트레이 · 알림 · 폴링 · 설정(settings.json)
main/paths.mjs      ~/.claude 위치 (서로 import하지 않게 여기로 뺐다)
main/collect.mjs    세션·잡·트랜스크립트·사용량 → 스냅샷 한 장
main/transcript.mjs 대화 파일 꼬리에서 제목·상황·MR·컨텍스트·비서 캐내기
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
renderer/fonts/     사무실 영역 픽셀 폰트 (Mona S 12px, OFL 1.1)
shared/pixels.mjs   픽셀 데이터 — 렌더러와 아이콘 생성기가 공유
tools/make-icons.mjs        캐릭터 픽셀 → PNG (의존성 없이 직접 인코딩) — 맥 메뉴바용 16px 변형도 굽는다
tools/install-usage-tap.mjs 위 로직의 CLI 껍데기 (npm run usage-tap)
test/               `npm test` (node --test, 의존성 없음) — 알림 문턱 판정 · attach 명령 조립
.github/workflows/release.yml  v* 태그 푸시 → Windows·macOS를 빌드해 Releases 초안 하나에 올린다
```

## 손댈 만한 곳

- `shared/pixels.mjs` — 한 글자가 한 픽셀, 팔레트는 파일 맨 위. 행 길이가 어긋나면 바로 에러가 난다
- `renderer/themes.mjs` — 사무실 종류(설정 창의 목록도 여기서 나온다). `station`이 자리 모양을,
  `props`·`wall`이 비품을 정한다
  (둘 다 `renderer/sprites.mjs`의 `SPR` 키 — 회의실 벽의 `screen`만 예외로 `drawScreen()`이 직접 그린다). 자리 모양을 새로 만들려면 `render.mjs`의
  `drawSurface`·`drawGear`·`clawdSeated`에 분기를 추가한다
- `renderer/talk.mjs` — 혼잣말(`LINES`), 시간대 대사(`TIME_LINES`), 잡담(`DUOS`), 비서 보고(`AIDE_LINES`),
  주기(`CYCLE`·`SHOW`). 문장을 고를 때 `kind`를 실어 보내면 말풍선 색이 그에 따라 갈린다
- `renderer/render.mjs` — 방 크기(`SLOT_W`·`SLOT_H`·`FLOOR_BASE`), 자리 배치(`DY_DESK` 주석에 y좌표 정리 · 그리는 곳은 `drawSurface`·`drawGear`·`clawdSeated`),
  돌아다니는 범위·속도(`bandBounds`·`SEG_MS`), 모이는 주기(`HANG_EVERY`), 잡담 거리(`CHAT_NEAR_X`),
  말풍선 색(`BUBBLE_STYLE`), 방 색상 `HUES`
- `main/collect.mjs` — `moodOf`(상태 판정), `RECENT_DONE_MS`(퇴근 목록 유지 기간),
  `isSpare`(빈 예비 슬롯 판정)
- `main/transcript.mjs` — `TAIL_BYTES`(읽는 꼬리 길이), `CONTEXT_LIMITS`(모델별 컨텍스트 창),
  `scanAides`(비서 찾기)·`AIDE_MAX_AGE_MS`(알림 없이 남은 호출을 유령으로 볼 기준)
- `main/notify.mjs` — 재알림 문턱(`WAIT_STEPS_MS`), 트레이가 깜빡이기 시작하는 시점(`BLINK_AFTER_MS`),
  컨텍스트·사용량 문턱(`CONTEXT_STEPS`·`USAGE_STEPS`), 알림 종류(`NOTIFY_KINDS` — 트레이 메뉴와 짝이다).
  문턱을 건드렸으면 `npm test`로 확인한다 (시각을 인자로 받으므로 30분을 기다릴 필요가 없다)
- `main/terminal.mjs` — 터미널을 띄우는 방법(`openWindows`·`openMac`), 셸에 넘길 id의 허용 문자(`ID_OK`).
  다른 터미널 앱을 쓰려면 여기에 분기를 넣는다
- `main/history.mjs` — 무엇을 남길지(`diffEvents`), 시간을 어떻게 셀지(`summarize`·`BUCKET`),
  보존 기간(`RETAIN_MS`), 대기 목록에 올릴 최소 길이(`WAIT_WORTH_MS`).
  시각을 인자로 받으므로 하루를 기다리지 않고 `test/history.test.mjs`가 확인한다
- `main/notify-tap.mjs` — 훅이 돌릴 스크립트(`scriptSource` — `.mjs`라 ESM이다),
  받은 문구를 쓸지 정하는 규칙(`noteNeeds`·`NOTE_SLACK_MS`), 남은 파일을 버릴 기준(`NOTE_MAX_AGE_MS`)
- `main/index.mjs` — `POLL_MS`, `BLINK_MS`(깜빡임 주기), `signature`(스냅샷 중복 전송 판정에서 뺄 필드)

## 디버그 입구

DevTools 콘솔에서 `__office.push(state)` / `__office.select(key)`로 임의 상태를 밀어넣어
입력 대기·실패처럼 평소 안 나오는 화면을 확인할 수 있다. `__office.view({ names, roomThemes })`는
설정을 **저장하지 않고** 바꿔 보는 입구다 — 헤드리스로 화면을 굽어 확인할 때 쓴다.
(이 README·docs의 캡처도 그렇게 구운 것이다.)
