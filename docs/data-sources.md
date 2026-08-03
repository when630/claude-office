# 무엇을 읽는가

`claude agents`가 쓰는 것과 같은 파일들을 main 프로세스에서 직접 읽는다. CLI를 스폰하지 않아 가볍고,
1.5초마다 스냅샷을 떠서 **바뀐 경우에만** 렌더러로 보낸다.

비교할 때는 스냅샷을 뜬 시각(`ts`)을 뺀 서명을 쓴다(`signature`). 그걸 그대로 비교하면 매 틱 값이
달라져 차단이 아무 일도 하지 않고, 아무 일이 없는데도 1.5초마다 IPC와 패널 재생성이 돌아
**패널 스크롤 위치와 텍스트 선택이 계속 풀린다.** 같은 이유로 경과 시간은 상대값이 아니라
절대 시각(`statusAt`)으로 넘긴다 — 상대값이면 여기서 아무리 걸러도 매 틱 달라진다.
유휴 세션만 있는 동안 이 서명은 실측상 완전히 고정된다.

| 소스 | 쓰임 |
|---|---|
| `~/.claude/sessions/<pid>.json` | 살아있는 세션 목록 — 이름·cwd·kind·`jobId`, 그리고 `status`(`busy` / [`waiting`](characters.md#선택지가-뜨면-산책하지-않는다) / `idle`) |
| `~/.claude/jobs/<id>/state.json` | 백그라운드 잡의 detail·`needs`·토큰·연결된 MR |
| `~/.claude/jobs/<id>/timeline.jsonl` | 상태 전이 이력 (마지막 12건) — 백그라운드 잡만 |
| `~/.claude/projects/<cwd>/<sessionId>.jsonl` | **모든 세션**의 제목·최근 지시·진행 요약·MR·컨텍스트 사용량·타임라인 |
| `~/.claude/tasks/<sessionId>/<n>.json` | 세션이 스스로 세운 **할 일 목록** (아래 참고) |
| `~/.claude/office-usage.json` | 계정 사용량 — statusline이 떨어뜨려 준 payload ([사용량 tap](panel.md#사용량은-왜-tap이-필요한가) 참고) |
| `~/.claude/office-notify/<sessionId>.json` | 지금 무엇을 기다리는지 — Notification 훅이 떨어뜨려 준 payload ([훅 tap](notify-hook.md) 참고) |

`process.kill(pid, 0)`으로 살아있는 프로세스만 남기므로, 죽은 세션 파일이 남아 있어도 출근시키지 않는다.
`CLAUDE_CONFIG_DIR`을 설정해 뒀다면 그쪽을 따라간다.

## 빈 예비 슬롯은 출근시키지 않는다

Claude Code 데몬은 백그라운드 세션을 빨리 띄우려고 프로세스를 **미리 데워 둔다**(`daemon/roster.json`의
`source: "spare"`). 이 슬롯도 `sessions/<pid>.json`을 만들기 때문에 그대로 그리면 **프롬프트를 한 번도
받지 않은 빈 프로세스가 정직원처럼 자리에 앉는다** — 출근 인원이 부풀고, 이름도 `8e4edbee` 같은 짧은
id로 떠서 정체를 알 수 없다(name도 intent도 없어 id가 그대로 이름이 된다).

그래서 `collect.mjs`의 `isSpare`가 이런 세션을 사무실에서 빼고, 개수만 `stats.spare`로 넘겨
패널의 **예비 슬롯** 칸에 적는다 — 숨기기만 하면 "있는데 안 보이는 것"이 되므로.

판정은 일부러 빡빡하다. `kind: bg`이고 status가 idle이며 잡 상세·제목·최근 지시·intent·토큰·
컨텍스트·서브에이전트·타임라인이 **전부 비어 있을 때만** 예비로 본다.
터미널 세션은 아예 대상이 아니다 — 갓 띄운 창도 기록이 없지만 그건 곧 사람이 쓸 자리다.

## 터미널 세션도 상세가 나오는 이유

백그라운드 잡은 `state.json`에 detail·needs를 남기지만 **터미널 세션(`kind: interactive`)은 그런 파일이 없다.**
그래서 예전에는 터미널 세션 카드가 이름·PID만 있는 빈 껍데기였다. 지금은 트랜스크립트에서 직접 캐낸다:

| 트랜스크립트 줄 | 쓰임 |
|---|---|
| `{"type":"ai-title","aiTitle":…}` | 세션 제목 (카드 부제) |
| `{"type":"last-prompt","lastPrompt":…}` | **최근 지시** |
| `{"type":"system","subtype":"away_summary",…}` | **지금 상황** (1순위) |
| 마지막 `assistant` 메시지의 텍스트 | **지금 상황** (2순위 — away_summary가 없을 때) |
| `{"type":"pr-link",…}` | 연결된 MR |
| `{"type":"mode","mode":…}` | 현재 모드 |
| 마지막 `assistant`의 `usage` | **컨텍스트 사용량** (`input + cache_creation + cache_read`) · **토큰** |
| `async_launched` 뒤에 완료 알림이 안 온 `agentId` | **지금 돌고 있는 서브에이전트** (옆에 비서가 선다) |
| `timestamp`가 붙은 `user`·`assistant` 줄 | **타임라인** (아래 참고) |

**타임라인은 출처가 두 개다.** 백그라운드 잡은 `timeline.jsonl`에 상태가 바뀔 때마다 요약을
한 줄씩 남겨 주므로 그게 있으면 그걸 쓴다(초록 점 = `done`). 터미널 세션은 그런 파일이 없어
대화에서 턴을 주워 쓴다 — **받은 지시(노란 점) ↔ 한 말(파란 점)** 을 시간순으로 최대 8칸.

턴을 줍는 데는 함정이 둘 있다.

- `last-prompt` 줄에는 **timestamp가 없고** 매 턴 같은 내용이 다시 쓰인다 — 턴 경계로 못 쓴다.
  시각이 붙어 있는 `user`/`assistant` 줄을 쓴다
- `user` 줄에는 사용자가 친 게 아닌 것이 섞여 온다. 도구 결과(`tool_use_id`)는 턴이 아니면서
  줄이 제일 크므로 **JSON 파싱 전에** 문자열로 걸러내고, 슬래시 명령은 `<command-name>` 블록을
  `/이름 인자`로 펴고, 캐비어트·시스템 리마인더는 버린다(`isMeta`가 안 붙어 오는 경우가 있다)

한 턴이 길면 320KB 안에 사용자 지시가 아예 없을 수도 있다(도구 결과가 꽉 채운다). 그때는
`assistant` 쪽 턴만으로 채워지는데, 그래도 "무슨 말을 하며 진행했는지"는 순서대로 보인다.

대화 파일이 수십 MB까지 자라므로 뒤쪽 320KB만 읽고, 크기·mtime이 그대로면 캐시를 재사용한다.
마크다운(표·코드블록·굵게)은 한 줄 텍스트로 눌러 편다. 서브에이전트(`isSidechain`) 사용량은
부모 세션 컨텍스트가 아니므로 세지 않는다.

컨텍스트 퍼센트 계산은 Claude Code statusline이 쓰는 것과 같다. 모델별 창 크기는
`main/transcript.mjs`의 `CONTEXT_LIMITS` — 지금은 haiku만 200K이고 나머지 현행 모델은 1M이다.

## 세션이 세운 할 일 (`main/tasks.mjs`)

항목 하나가 파일 하나다. 실측한 필드는 늘 같았다 —
`{ id, subject, description, activeForm, status, blocks, blockedBy }`.
`status` 어휘는 셋뿐이다: `pending` · `in_progress` · `completed`.

| 값 | 쓰임 |
|---|---|
| 머릿수·끝낸 수 | 패널의 `할 일 2/6`과 진행 막대 |
| `subject` | 아직 안 끝난 항목의 목록 (끝낸 것은 머릿수로 접는다) |
| `activeForm` | **말풍선.** 우리가 요약한 상황보다 그 세션이 쓴 문장이 정확하다 |
| `blockedBy` 중 안 끝난 것 | `#3 끝나야 시작` |

**대부분 세션은 할 일을 안 쓴다** — 실측 32개 디렉터리 중 항목이 있는 것은 4개였고 나머지는
`.lock`·`.highwatermark`만 있었다. 그래서 없을 때는 패널에 블록을 아예 그리지 않는다.

캐시 열쇠는 **파일마다의 mtime + 크기**다. 디렉터리 mtime으로는 안 된다 — NTFS는 이미 있는
파일을 덮어써도 디렉터리 mtime을 안 바꾸는데, 할 일의 status가 바뀌는 것은 항목이 추가되는 게
아니라 `<n>.json`을 제자리에서 다시 쓰는 일이다. 디렉터리만 보면 `pending`에서 `completed`로
넘어간 것을 영원히 못 본다(`test/tasks.test.mjs`가 이걸 붙잡는다).
