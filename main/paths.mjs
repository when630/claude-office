// ~/.claude 위치 한 곳. collect·transcript·usage가 서로를 import하지 않도록 여기로 뺐다.
import path from 'node:path';
import os from 'node:os';

export const CLAUDE_DIR = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');

// claude-office가 읽는 사용량 스냅샷. statusline이 받은 payload를 그대로 떨어뜨린 파일.
export const USAGE_FILE = path.join(CLAUDE_DIR, 'office-usage.json');

// 지금 무엇을 기다리는지 — Notification 훅이 세션별로 하나씩 떨어뜨린다(main/notify-tap.mjs).
// 세션마다 파일 하나를 덮어쓰므로 자라지 않는다.
export const NOTIFY_DIR = path.join(CLAUDE_DIR, 'office-notify');
