// Claude Code 자체 통계 읽기 (main/stats.mjs).
//
// 핵심은 "어디까지의 기록인지"다 — 이 집계는 통계 화면을 열 때만 다시 계산되므로 낡아 있는
// 것이 정상이고, 낡은 숫자를 현재값처럼 보여주면 그게 거짓말이 된다.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'office-stats-'));
process.env.CLAUDE_CONFIG_DIR = root;
const { readCodeStats, staleDays } = await import('../main/stats.mjs');

const FILE = path.join(root, 'stats-cache.json');

// 실측한 파일 모양 그대로 (version 4)
const CACHE = {
  version: 4,
  lastComputedDate: '2026-07-08',
  dailyActivity: [
    { date: '2026-07-06', messageCount: 2578, sessionCount: 6, toolCallCount: 727 },
    { date: '2026-07-07', messageCount: 4027, sessionCount: 2, toolCallCount: 2122 },
    { date: '2026-07-08', messageCount: 3124, sessionCount: 3, toolCallCount: 859 },
  ],
  dailyModelTokens: [{ date: '2026-07-08', tokensByModel: { 'claude-opus-4-6': 1000 } }],
  modelUsage: {
    'claude-opus-4-5-20251101': {
      inputTokens: 23727,
      outputTokens: 121361,
      cacheReadInputTokens: 175003073,
      cacheCreationInputTokens: 6000181,
    },
    'claude-opus-4-6': { inputTokens: 99, outputTokens: 3751, cacheReadInputTokens: 1309035, cacheCreationInputTokens: 0 },
    'never-used': { inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 },
  },
  totalSessions: 161,
  totalMessages: 46767,
  longestSession: { sessionId: 'x', duration: 337302333, messageCount: 2071 },
  firstSessionDate: '2026-01-27T05:57:47.263Z',
  hourCounts: { 8: 3, 9: 27, 14: 23 },
};

before(() => {
  fs.writeFileSync(FILE, JSON.stringify(CACHE), 'utf8');
});

after(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

test('일별·시간대·모델을 정리해 온다', async () => {
  const got = await readCodeStats();
  assert.equal(got.computedTo, '2026-07-08');
  assert.deepEqual(
    got.days.map((d) => d.messages),
    [2578, 4027, 3124],
  );
  // 시간대는 0~23을 다 채워 보낸다 — 화면이 빈 칸을 고민하지 않게
  assert.equal(got.hours.length, 24);
  assert.equal(got.hours[9], 27);
  assert.equal(got.hours[0], 0);
  assert.equal(got.totalSessions, 161);
  assert.equal(got.longestSessionMs, 337302333);
});

test('모델별 토큰은 많이 쓴 순이고 안 쓴 모델은 빠진다', async () => {
  const got = await readCodeStats();
  assert.deepEqual(
    got.models.map((m) => m.model),
    ['claude-opus-4-5-20251101', 'claude-opus-4-6'],
  );
  // 입력 + 캐시 생성 + 캐시 읽기 + 출력
  assert.equal(got.models[0].tokens, 23727 + 6000181 + 175003073 + 121361);
});

test('날짜는 로컬 자정으로 읽는다', async () => {
  const got = await readCodeStats();
  const d = new Date(got.days[0].at);
  // `2026-07-06`을 그대로 Date에 넣으면 UTC로 해석돼 한국 시간에서 하루가 밀린다
  assert.equal(d.getDate(), 6);
  assert.equal(d.getMonth(), 6);
});

test('빠진 날수는 어제를 기준으로 센다', () => {
  const stats = { computedToAt: new Date(2026, 6, 8).getTime() };
  // 7/9이 오늘이면 어제(7/8)까지 들어 있으니 빠진 것이 없다
  assert.equal(staleDays(stats, new Date(2026, 6, 9, 15).getTime()), 0);
  // 7/10이 오늘이면 7/9 하루가 빠졌다
  assert.equal(staleDays(stats, new Date(2026, 6, 10, 3).getTime()), 1);
  assert.equal(staleDays(stats, new Date(2026, 7, 3, 10).getTime()), 25);
});

test('오늘은 빠진 날로 세지 않는다', () => {
  // 캐시는 설계상 어제까지만 담는다. 오늘을 세면 늘 "1일 빠졌다"가 되어 표시가 뜻을 잃는다.
  const stats = { computedToAt: new Date(2026, 6, 8).getTime() };
  assert.equal(staleDays(stats, new Date(2026, 6, 8, 23, 59).getTime()), 0);
  // 기준 값이 없으면 셀 수 없다
  assert.equal(staleDays(null), null);
  assert.equal(staleDays({}), null);
});

test('모양이 다르거나 없으면 null이다', async () => {
  // dailyActivity가 없으면 쓸 수 없다 — 화면에서 이 자리가 사라진다
  fs.writeFileSync(FILE, JSON.stringify({ version: 99 }), 'utf8');
  assert.equal(await readCodeStats(), null);
  fs.writeFileSync(FILE, '{ 반쪽', 'utf8');
  assert.equal(await readCodeStats(), null);
  fs.rmSync(FILE);
  assert.equal(await readCodeStats(), null);
});
