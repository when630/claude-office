# 구조

```
main/index.mjs      앱 수명주기 · 창 · 트레이 · 알림 · 폴링 · 설정(settings.json)
main/paths.mjs      ~/.claude 위치 (서로 import하지 않게 여기로 뺐다)
main/collect.mjs    세션·잡·트랜스크립트·사용량 → 스냅샷 한 장
main/transcript.mjs 대화 파일 꼬리에서 제목·상황·MR·컨텍스트·비서 캐내기
main/usage.mjs      office-usage.json → 5시간·주간 사용률
main/usage-tap.mjs  statusline에 사용량 tap 심기/빼기 (트레이·CLI 공용 로직)
main/updater.mjs    GitHub Releases 자동 업데이트 — 받아두고 트레이 재시작 또는 종료 시 설치
main/preload.cjs    contextBridge (샌드박스라 CJS여야 한다)
renderer/           픽셀 렌더러 (app · render · sprites · themes · talk · style)
renderer/fonts/     사무실 영역 픽셀 폰트 (Mona S 12px, OFL 1.1)
shared/pixels.mjs   픽셀 데이터 — 렌더러와 아이콘 생성기가 공유
tools/make-icons.mjs        캐릭터 픽셀 → PNG (의존성 없이 직접 인코딩)
tools/install-usage-tap.mjs 위 로직의 CLI 껍데기 (npm run usage-tap)
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
- `main/index.mjs` — `POLL_MS`, `signature`(스냅샷 중복 전송 판정에서 뺄 필드)

## 디버그 입구

DevTools 콘솔에서 `__office.push(state)` / `__office.select(key)`로 임의 상태를 밀어넣어
입력 대기·실패처럼 평소 안 나오는 화면을 확인할 수 있다. `__office.view({ names, roomThemes })`는
설정을 **저장하지 않고** 바꿔 보는 입구다 — 헤드리스로 화면을 굽어 확인할 때 쓴다.
(이 README·docs의 캡처도 그렇게 구운 것이다.)
