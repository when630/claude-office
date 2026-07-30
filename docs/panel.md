# 오른쪽 패널

캐릭터(또는 그 자리)를 클릭하면 그 세션의 컨텍스트 게이지·붙어 있는 서브에이전트·지금 상황·최근 지시·
연결된 MR·타임라인이 뜨고,
맨 아래 `claude attach <id>`(터미널 세션은 `claude --resume <sessionId>`) 복사 버튼이 있다.

**아무것도 선택하지 않았을 때**는 현재 시각과 계정 상태가 기본 화면이다.

- 큰 시계 + 날짜 (1초마다 갱신)
- 출근 인원 · 작업 중 · 입력 대기 · 최고 컨텍스트 · 붙어 있는 서브에이전트 수
  (+ [예비 슬롯](data-sources.md#빈-예비-슬롯은-출근시키지-않는다)이 있으면 그 개수와 설명)
- **세션(5시간)·주간(7일) 사용률** 프로그레스 바 + 초기화 시각 + 남은 시간
- 모델 · 컨텍스트 창 크기 · 추론 강도 · Fast 모드
- 앱/Electron 버전과 읽고 있는 `~/.claude` 경로
- 최근 12시간 내 퇴근한 작업

## 폰트

**사무실(캔버스) 안의 글자만 픽셀 폰트를 쓴다.** 상단바와 오른쪽 패널은 Pretendard 그대로다.
[Mona](https://github.com/MonadABXY/mona-font)의 획을 편 변형 **Mona S** 12px 한글 텍스트판을
`renderer/fonts/MonaS12TextKR.woff2`로 넣어 뒀다 (SIL OFL 1.1, `renderer/fonts/OFL.txt`).
한글 완성형 11,172자 + Basic Latin 100% 커버.

- 시스템에 `MonaS12`가 설치돼 있으면 `src: local('MonaS12')`이 먼저 걸려 그쪽을 쓴다
- 둘 다 없으면 `Galmuri11` → `Malgun Gothic` → `monospace` 순으로 조용히 내려간다
- 비트맵 폰트는 한 크기에서만 또렷하므로 확대 배율과 무관하게 **12px 고정**으로 그린다
  (`OFFICE_FONT`·`OFFICE_FONT_PX`). 굵기도 400 하나만 쓴다 — 볼드 페이스가 없으면 브라우저가
  합성 볼드로 픽셀을 번지게 하므로, 방 이름 강조는 색으로 한다
- 글자 원점을 정수로 반올림해 그린다. `textAlign: center`에 맡기면 0.5px이 남아
  서브픽셀 안티에일리어싱이 껴서 픽셀 폰트가 흐려진다
- **캔버스는 DOM 텍스트가 아니라서 `@font-face` 선언만으로는 폰트가 로드되지 않는다.**
  `app.mjs`가 `document.fonts.load('12px MonaS12')`로 직접 불러온 뒤 글자 폭 캐시를 비운다

말풍선 크기는 글자 폭을 실측해서 잡으므로 어느 폰트로 떨어져도 레이아웃이 깨지지 않는다.

## 사용량은 왜 tap이 필요한가

세션·주간 사용률은 Claude Code가 **statusline 스크립트의 stdin으로만** 넘겨준다. `~/.claude` 어디에도
파일로 남지 않고 CLI에도 꺼낼 명령이 없다. 그래서 statusline이 받은 payload를 그대로
`~/.claude/office-usage.json`에 떨어뜨리게 해두고 앱은 그 파일만 읽는다.

심고 빼는 입구는 두 개인데 하는 일은 같다 (`main/usage-tap.mjs` 하나를 공유한다).

- **트레이 아이콘 > 사용량 연동 (statusline)** — 설치본에서 쓰는 길. 체크하면 심고, 끄면 뺀다
- 레포에서 바로 돌릴 때는 CLI도 있다

```powershell
npm run usage-tap          # statusline 스크립트에 심기 (.bak 백업을 남긴다)
npm run usage-tap:remove   # 빼기
```

`settings.json`의 `statusLine.command`에서 `.ps1` 경로를 찾아 stdin을 읽는 줄 바로 뒤에
네 줄짜리 `try { … } catch { }` 블록을 넣는다. 실패해도 statusline 자체는 그대로 돌고,
`# >>> claude-office usage tap >>>` 마커로 감싸 두어 여러 번 실행해도 한 번만 심긴다.
PowerShell 5.1이 한글 주석을 cp949로 읽지 않도록 저장할 때 BOM을 붙인다.
자동으로 못 찾으면 직접 넣을 수 있는 코드를 알려준다(트레이는 대화상자로, CLI는 표준출력으로).
tap이 없으면 그 칸에 안내만 뜨고 나머지 기능은 전부 그대로 동작한다.
