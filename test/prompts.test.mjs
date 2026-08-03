// 내가 친 프롬프트 이력 읽기·집계 (main/prompts.mjs).
//
// 읽기(readPromptLog)는 CLAUDE_CONFIG_DIR을 임시 폴더로 돌려 확인하고, 집계는 순수 함수라
// 줄을 손으로 만들어 넣는다. paths.mjs가 import 시점에 env를 읽으므로 **env를 세운 뒤에 동적 import**한다.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'office-prompts-'));
process.env.CLAUDE_CONFIG_DIR = root;
const { readPromptLog, lastPromptFor, summarizePrompts } = await import('../main/prompts.mjs');

const LOG = path.join(root, 'history.jsonl');
const T0 = Date.parse('2026-07-31T09:00:00Z');
const MIN = 60_000;

// 실측한 줄 모양 그대로
function line(over = {}) {
  return JSON.stringify({
    display: '고쳐줘',
    pastedContents: {},
    timestamp: T0,
    project: 'D:\\AIProject\\claude-office',
    sessionId: 's1',
    ...over,
  });
}

before(() => {
  fs.writeFileSync(
    LOG,
    [
      line({ timestamp: T0 - 30 * MIN, display: '첫 지시' }),
      line({ timestamp: T0 - 20 * MIN, display: '둘째 지시', sessionId: 's2' }),
      line({ timestamp: T0 - 10 * MIN, display: '/clear', project: 'D:\\AIProject\\gowrite', sessionId: 's3' }),
      line({ timestamp: T0 - 5 * MIN, display: '마지막 지시' }),
      '', // 빈 줄
      '{"display":"반쪽', // 쓰는 도중에 잘린 줄
      line({ timestamp: null, display: '시각이 없는 줄' }),
    ].join('\n') + '\n',
    'utf8',
  );
});

after(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

test('줄을 읽고 시각 순으로 세운다', async () => {
  const got = await readPromptLog();
  assert.equal(got.length, 4); // 빈 줄·반쪽 줄·시각 없는 줄은 버린다
  assert.deepEqual(
    got.map((e) => e.display),
    ['첫 지시', '둘째 지시', '/clear', '마지막 지시'],
  );
});

test('그 세션의 마지막 지시를 집는다', async () => {
  const got = await readPromptLog();
  // s1은 두 줄 있다 — 뒤에서 앞으로 훑으니 나중 것이다
  assert.equal(lastPromptFor(got, 's1'), '마지막 지시');
  assert.equal(lastPromptFor(got, 's3'), '/clear');
  // 모르는 세션·빈 id는 빈 문자열 (collect가 트랜스크립트 쪽 값으로 떨어지게)
  assert.equal(lastPromptFor(got, 'nope'), '');
  assert.equal(lastPromptFor(got, ''), '');
});

test('구간 안의 횟수를 방별로 센다', async () => {
  const got = await readPromptLog();
  const all = summarizePrompts(got, { from: T0 - 60 * MIN, to: T0 });
  assert.equal(all.count, 4);
  // 경로 마지막 조각이 방 이름이고, 많은 쪽이 앞에 온다
  assert.deepEqual(all.rooms, [
    { room: 'claude-office', count: 3 },
    { room: 'gowrite', count: 1 },
  ]);
});

test('구간 밖은 세지 않는다', async () => {
  const got = await readPromptLog();
  // 최근 15분만
  const recent = summarizePrompts(got, { from: T0 - 15 * MIN, to: T0 });
  assert.equal(recent.count, 2);
  assert.deepEqual(recent.rooms, [
    { room: 'claude-office', count: 1 },
    { room: 'gowrite', count: 1 },
  ]);
  // 아무것도 없는 구간
  assert.deepEqual(summarizePrompts(got, { from: T0 + MIN, to: T0 + 2 * MIN }), { count: 0, rooms: [] });
});

test('집계에 지시 내용은 담기지 않는다', () => {
  // 출근부 화면으로 가는 값이다 — 문장이 섞여 들어가면 "지시는 남기지 않는다"가 깨진다
  const out = summarizePrompts([{ at: T0, display: '비밀스러운 지시', project: '/p/room', sessionId: 's' }], {
    from: T0 - MIN,
    to: T0 + MIN,
  });
  assert.ok(!JSON.stringify(out).includes('비밀스러운'));
});

// 이 파일은 Claude Code가 만드는 것이라 없을 수 있다 — 그때 앱이 멈추면 안 된다.
// (경로는 import 시점에 고정되므로 env를 다시 만지지 않고 파일만 치운다. 맨 뒤에 둔 이유다.)
test('파일이 없으면 빈 배열이다', async () => {
  fs.rmSync(LOG);
  assert.deepEqual(await readPromptLog(), []);
});
