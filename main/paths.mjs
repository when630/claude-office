// ~/.claude 위치 한 곳. collect·transcript·usage가 서로를 import하지 않도록 여기로 뺐다.
import path from 'node:path';
import os from 'node:os';

export const CLAUDE_DIR = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');

// claude-office가 읽는 사용량 스냅샷. statusline이 받은 payload를 그대로 떨어뜨린 파일.
export const USAGE_FILE = path.join(CLAUDE_DIR, 'office-usage.json');

// 지금 무엇을 기다리는지 — Notification 훅이 세션별로 하나씩 떨어뜨린다(main/notify-tap.mjs).
// 세션마다 파일 하나를 덮어쓰므로 자라지 않는다.
export const NOTIFY_DIR = path.join(CLAUDE_DIR, 'office-notify');

// 내가 친 프롬프트 이력 — Claude Code가 프로젝트·세션·시각과 함께 한 줄씩 남긴다(main/prompts.mjs).
// **우리 근태 파일(userData/history.jsonl)과 이름만 같고 다른 파일이다.** 그쪽은 앱이 쓰고,
// 이쪽은 Claude Code가 쓴다 — 우리는 읽기만 한다.
export const PROMPT_LOG = path.join(CLAUDE_DIR, 'history.jsonl');

// 작업 디렉터리 → 방 이름. 경로의 마지막 조각이 방 이름이 된다.
//
// collect(세션의 cwd)와 prompts(이력 줄의 project)가 같은 셈법을 써야 같은 방으로 묶인다.
// 서로 import하면 순환이 되므로 여기 둔다 — 이 파일의 용도가 그것이다.
export function roomKeyOf(cwd) {
  if (!cwd) return 'unknown';
  const norm = String(cwd).replace(/[\\/]+$/, '');
  return norm.split(/[\\/]/).pop() || norm;
}
