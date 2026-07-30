# 사무실 영역 픽셀 폰트

캔버스(사무실) 안의 글자만 이 폰트를 쓴다. 패널·상단바는 Pretendard 그대로.

## 들어 있는 폰트

`MonaS12TextKR.woff2` — [Mona Font](https://github.com/MonadABXY/mona-font) 2026.05.25의
**Mona S**(획을 편 변형) 배포본 중 `web/03_Text/MonaS12TextKR.woff2`.

- 12px 전용 픽셀 폰트. 한글 완성형 11,172자 + Basic Latin 전부를 담았다.
- 한글 자형이 고정된 **텍스트 전용판**이라 `locl`/`font-language-override`
  설정 없이도 한글이 제대로 나온다. 이모지가 없는 대신 통합판(1.2MB)보다 가볍다(781KB).
- **라이선스: SIL Open Font License 1.1** — `OFL.txt` 첨부. 예약 폰트명 "Mona"
  (Mona와 Mona S가 같은 라이선스 파일을 쓴다). 제품에 포함해 배포하는 것은 허용되지만
  폰트 파일 자체를 단독으로 판매하지는 못한다.

볼드 페이스는 일부러 넣지 않았다 — 방 이름 같은 것도 전부 400으로 그린다.
비트맵 폰트에 볼드 페이스가 없으면 브라우저가 합성 볼드를 만들면서 픽셀을 번지게
하기 때문이다(강조는 색으로 한다).

## 다른 폰트로 바꾸기

시스템에 `MonaS12`가 설치돼 있으면 `src: local('MonaS12')`이 먼저 걸리므로
이 파일보다 설치된 폰트가 우선한다(이모지까지 쓰고 싶으면 통합판을 설치하면 된다).
아예 다른 폰트를 쓰려면 `renderer/style.css`의 `@font-face`와
`renderer/render.mjs`의 `OFFICE_FONT` / `OFFICE_FONT_FAMILY`를 같이 고친다.

둘 다 없으면 `Galmuri11` → `Malgun Gothic` → `monospace` 순으로 조용하게 내려간다.
말풍선 폭은 글자 폭을 실제로 재서 잡으므로 어느 폰트로 떨어지든 레이아웃은 멀쩡하다.

## 로드 경로

캔버스는 DOM 텍스트가 아니라서 `@font-face` 선언만으로는 폰트가 로드되지 않는다.
`renderer/app.mjs`가 `document.fonts.load('12px MonaS12')`로 직접 로드한 뒤 글자 폭
캐시(`clearTextCache`)를 버린다. 이 단계를 빼면 조용히 대체 폰트로 그려진다.
