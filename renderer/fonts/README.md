# 번들한 폰트

두 벌이 서로 다른 영역을 맡는다.

| 파일 | 쓰는 곳 | 라이선스 |
|---|---|---|
| `MonaS12TextKR.woff2` | 캔버스(사무실) 안의 글자만 | OFL 1.1 — `OFL.txt` |
| `PretendardVariable.woff2` | 껍데기 전부 (상단바·패널·설정·출근부) | OFL 1.1 — `PretendardOFL.txt` |

## 왜 Pretendard까지 넣었나

전에는 `style.css`가 `font-family: 'Pretendard', 'Malgun Gothic', …`로 선언만 해 두었다.
**설치한 사람만 Pretendard를 봤고 나머지는 조용히 Malgun Gothic으로 떨어졌다.** 자간과 숫자
폭이 달라 `font-variant-numeric: tabular-nums`로 맞춰 둔 표·게이지 정렬까지 사람마다 어긋났고,
어느 쪽이 "제대로 된 화면"인지 알 방법이 없었다. 폰트를 화면 규격의 일부로 보기로 하고 파일을
넣었다 (#112).

## 들어 있는 폰트

### PretendardVariable.woff2

[Pretendard](https://github.com/orioncactus/pretendard) **Variable** 배포본.

- 폰트가 스스로 밝히는 판: `Version 1.309` · `Copyright © 2023 Kil Hyung-jin`
- 가변 폰트라 **한 파일이 100~900을 다 낸다** — 굵기별 파일이 없고 합성 볼드도 아니다.
  `@font-face`에 `font-weight: 100 900`으로 범위를 적어야 700이 실제 축으로 나온다
- 2.0MB. 서브셋을 굽지 않고 통째로 넣었다 — 한글 완성형·Latin·기호를 다 담고, 굽는 단계를
  빌드에 하나 더 만들지 않는 편을 택했다
- **라이선스: SIL Open Font License 1.1** — `PretendardOFL.txt` 첨부. Pretendard는 Inter ·
  Source · M PLUS 1에서 파생해서 저작권 표시가 넷이다(첨부 파일 머리말에 그대로 있다).
  예약 폰트명 "Pretendard"

### MonaS12TextKR.woff2

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

둘 다 `src: local(…)`을 앞에 두었으므로 **시스템에 설치된 같은 이름의 폰트가 파일보다
우선한다**(Mona는 이모지까지 쓰고 싶으면 통합판을 설치하면 된다).

- 껍데기 서체를 바꾸려면 `renderer/style.css`의 `@font-face`와 `:root`의 `font-family` 한 줄
- 캔버스 서체를 바꾸려면 `@font-face`와 `renderer/render.mjs`의
  `OFFICE_FONT` / `OFFICE_FONT_FAMILY`를 같이

캔버스 쪽은 둘 다 없으면 `Galmuri11` → `Malgun Gothic` → `monospace` 순으로 조용하게
내려간다. 말풍선 폭은 글자 폭을 실제로 재서 잡으므로 어느 폰트로 떨어지든 레이아웃은 멀쩡하다.

## 로드 경로

껍데기(DOM)는 `@font-face`만으로 알아서 로드된다. **캔버스는 아니다** — DOM 텍스트가 아니라서
선언만으로는 로드되지 않고, `renderer/app.mjs`가 `document.fonts.load('12px MonaS12')`로 직접
불러온 뒤 글자 폭 캐시(`clearTextCache`)를 버린다. 이 단계를 빼면 조용히 대체 폰트로 그려진다.
