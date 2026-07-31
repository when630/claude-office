# claude-office 저장소 규약

앱이 무엇이고 어떻게 도는지는 [README](README.md)와 [docs/architecture.md](docs/architecture.md) 참고.
여기는 작업 규약만 적는다.

## 브랜치·커밋

- 통합 브랜치는 `main` 하나 — 직접 커밋하지 않고 PR로만 합친다 (GitHub Flow)
- 이슈 선행: 이슈를 먼저 만들고 번호를 브랜치·커밋에 꿴다. 급했으면 사후에라도 만든다
- 브랜치: `<타입>/<이슈번호>-<슬러그>` — 예: `feat/1-mac-support`
- 커밋: `<타입>: <요약> (#<이슈번호>)` — 타입 어휘는 `feat` `fix` `refactor` `docs` `chore`
- 머지는 머지 커밋 유지(스쿼시 안 함), 머지 후 소스 브랜치 삭제

## 라벨

- `type:` 축이 필수이고 이슈당 하나만 — 어휘는 커밋 타입과 동일
- 보조: `s:blocked` `s:needs-info`, 공개 저장소 예약 어휘 `good first issue`
- 새 라벨은 즉석에서 만들지 않는다 — "이 라벨로 걸러 볼 일이 있는가"부터

## 검증

머지 전에 이것을 돌린다:

```powershell
npm run icons                        # 아이콘이 다시 구워지는지 (렌더 결과를 눈으로 확인)
node --check main/index.mjs          # 고친 .mjs마다
npx electron-builder --win --dir     # 설치본 없이 패키징 회귀 확인
```

맥 빌드는 Windows에서 못 굽는다 — CI(태그 푸시)에서 확인한다.

## 릴리스

`git tag vX.Y.Z && git push origin vX.Y.Z` → CI가 Windows·macOS를 빌드해 draft 릴리스
하나에 모은다 → 릴리스 노트 쓰고 Publish. 로컬에서 `--publish`를 돌리지 않는다
(같은 태그에 릴리스가 갈라졌던 전례가 있다).
