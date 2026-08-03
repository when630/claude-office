// 세션이 승인받은 계획 찾기 (main/transcript.mjs의 scanPlan).
//
// 세션과 계획 파일을 잇는 단서는 `ExitPlanMode` tool_use의 `planFilePath` 하나뿐이다.
// 계획 경로는 Write·Read·Agent 줄에도 나타나지만 그건 "이 세션이 승인받은 계획"이 아니다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scanPlan } from '../main/transcript.mjs';

function exitPlan(plan, planFilePath, ts = '2026-07-31T09:00:00.000Z') {
  return JSON.stringify({
    type: 'assistant',
    timestamp: ts,
    message: { content: [{ type: 'tool_use', name: 'ExitPlanMode', input: { plan, planFilePath } }] },
  });
}

const PLAN = '# A-7 운영반영 자동 리스트 — 백엔드 풀구현 계획\n\n## Context\n표 파싱은 없다.';

test('ExitPlanMode에서 경로와 제목을 뽑는다', () => {
  const got = scanPlan([exitPlan(PLAN, 'C:\\Users\\me\\.claude\\plans\\twinkling-jumping-pearl.md')]);
  assert.equal(got.file, 'C:\\Users\\me\\.claude\\plans\\twinkling-jumping-pearl.md');
  // 첫 제목 줄에서 `#`을 떼어낸 것
  assert.equal(got.title, 'A-7 운영반영 자동 리스트 — 백엔드 풀구현 계획');
  assert.equal(got.at, Date.parse('2026-07-31T09:00:00.000Z'));
});

test('플랜을 두 번 짰으면 마지막 것이다', () => {
  const got = scanPlan([
    exitPlan('# 옛 계획', '/p/.claude/plans/old.md', '2026-07-31T09:00:00.000Z'),
    exitPlan('# 새 계획', '/p/.claude/plans/new.md', '2026-07-31T11:00:00.000Z'),
  ]);
  assert.equal(got.file, '/p/.claude/plans/new.md');
  assert.equal(got.title, '새 계획');
});

test('계획 경로가 다른 도구에 실려 있어도 무시한다', () => {
  // Write로 계획을 파일에 쓴 흔적, Read로 남의 계획을 읽은 흔적 — 둘 다 승인이 아니다
  const lines = [
    JSON.stringify({
      type: 'assistant',
      message: {
        content: [
          { type: 'tool_use', name: 'Write', input: { file_path: '/p/.claude/plans/other.md', content: '# 남의 계획' } },
        ],
      },
    }),
    JSON.stringify({
      type: 'assistant',
      message: { content: [{ type: 'tool_use', name: 'Read', input: { file_path: '/p/.claude/plans/other.md' } }] },
    }),
  ];
  assert.equal(scanPlan(lines), null);
});

test('제목 줄이 없으면 첫 줄을 제목으로 쓴다', () => {
  const got = scanPlan([exitPlan('설정 로딩 경로를 정리한다.\n\n두 번째 줄', '/p/.claude/plans/x.md')]);
  assert.equal(got.title, '설정 로딩 경로를 정리한다.');
});

test('파일 경로가 없어도 제목만으로 돌려준다', () => {
  // 계획 파일을 안 남기는 경우 — 패널에 제목만 적고 열기 버튼은 안 붙인다
  const got = scanPlan([exitPlan('# 제목만 있는 계획', undefined)]);
  assert.equal(got.file, '');
  assert.equal(got.title, '제목만 있는 계획');
});

test('계획이 없으면 null이다', () => {
  assert.equal(scanPlan([]), null);
  assert.equal(scanPlan(['', 'not json', '{"type":"user"}']), null);
  // 이름만 스치고 tool_use가 아닌 줄
  assert.equal(scanPlan(['{"text":"ExitPlanMode 얘기를 했다"}']), null);
});

test('둘 다 비면 그 줄은 건너뛴다', () => {
  // plan도 planFilePath도 없는 호출 — 붙일 것이 없다
  assert.equal(scanPlan([exitPlan('', '')]), null);
});
