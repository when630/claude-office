# 무엇을 기다리는지 알아내기

**트레이 아이콘 > 무엇을 기다리는지 알아내기 (Notification 훅)**

터미널 세션이 대기에 걸리면 앱은 "기다린다"는 사실만 알고 **무엇을 묻는지는 알 수 없었다.**
선택지가 떠 있는 동안 대화 파일에는 아무것도 안 쓰이기 때문이다
([선택지가 뜨면 산책하지 않는다](characters.md#선택지가-뜨면-산책하지-않는다)).
그래서 패널에는 `터미널에 선택지나 확인이 떠 있습니다`라는 뭉뚱그린 문구만 떴다.

Claude Code의 **Notification 훅**은 바로 그 순간에 문구를 넘겨준다. 심어 두면 패널·말풍선·
OS 알림에 실제 내용이 들어온다.

```json
{
  "session_id": "00893aaf-19fa-41d2-8238-13269b9b3ca0",
  "cwd": "D:/AIProject/claude-office",
  "hook_event_name": "Notification",
  "message": "Claude needs your permission to use Bash",
  "title": "Permission needed",
  "notification_type": "permission_prompt"
}
```

## 어떻게 받아 두나

[사용량 tap](panel.md#사용량은-왜-tap이-필요한가)과 같은 얼개다 — 훅이 payload를 파일로
떨어뜨리고 앱은 그 파일만 읽는다.

- 켜면 `~/.claude/settings.json`의 `hooks.Notification`에 항목 하나를 넣는다.
  **남의 Notification 훅은 건드리지 않고**, 뺄 때는 우리가 심은 것만 골라 뺀다
  (스크립트 경로로 알아본다). 고치기 전에 `.bak`을 남긴다
- `matcher`는 생략한다 — `permission_prompt`와 `idle_prompt`를 다 받아야 둘을 가릴 수 있다
- 훅이 돌릴 스크립트는 **켤 때 userData에 써 둔다** (`notify-tap.mjs`).
  패키징본의 asar 안에 있는 파일은 밖에서 `node`로 실행할 수 없다
- 스크립트는 payload를 `~/.claude/office-notify/<session_id>.json`에 **덮어쓴다.**
  세션마다 파일 하나라서 자라지 않는다 (사용량 tap이 파일 하나를 덮어쓰는 것과 같은 이유)
- `node`를 못 찾으면 심지 않고, 손으로 넣을 JSON을 알려준다

**켠 뒤 이미 돌고 있는 세션에는 적용되지 않는다.** 훅은 세션을 띄울 때 읽히므로 새로 띄운
세션부터 문구가 들어온다.

## 무엇을 문구로 쓰나

`message` → 없으면 `title`. 다만 두 가지는 버린다.

- **`idle_prompt`은 쓰지 않는다.** "한동안 조용하다"는 뜻이라 무엇을 묻는 게 아니다.
  대기 판정 자체는 세션 파일의 `status`가 하고, 훅은 문구만 채운다
- **지난 대기의 잔재는 버린다.** 알림 시각이 대기 시작 시각(`statusAt`)보다 1분 이상 앞서면
  그건 이미 답한 다른 프롬프트다. 훅이 먼저 돌고 `status`가 따라오는 순서라서 여유를 1분 준다

백그라운드 잡은 `state.json`의 `needs`가 여전히 우선이다 — 데몬이 직접 써 주는 값이라 더 정확하다.
훅은 그게 없는 터미널 세션을 메운다.

12시간이 넘은 파일은 읽지 않고 지운다. 세션이 끝나도 파일은 남기 때문이다.

## 끄면

훅과 스크립트를 빼고, 패널은 예전처럼 `터미널에 선택지나 확인이 떠 있습니다`로 돌아간다.
**대기 자체를 알리는 일은 그대로다** — 그건 세션 파일의 `status`만 보면 되므로 훅과 무관하다.
