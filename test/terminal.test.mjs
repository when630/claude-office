// 터미널 열기 (main/terminal.mjs). 셸에 들어가는 값이라 id 검증이 무너지면 바로 임의 명령
// 실행이 된다 — 창을 실제로 띄우는 부분은 실기기 확인이고, 여기서는 조립 규칙만 붙잡는다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { attachCommand, openTerminal, reasonText } from '../main/terminal.mjs';

test('잡이 있으면 attach, 터미널 세션이면 resume', () => {
  assert.equal(attachCommand({ jobId: 'abc123' }), 'claude attach abc123');
  assert.equal(
    attachCommand({ sessionId: '00893aaf-19fa-41d2-8238-13269b9b3ca0' }),
    'claude --resume 00893aaf-19fa-41d2-8238-13269b9b3ca0',
  );
  // 둘 다 있으면 잡이 먼저 — 백그라운드 잡은 attach로 붙는 게 제 경로다
  assert.equal(attachCommand({ jobId: 'j1', sessionId: 's1' }), 'claude attach j1');
});

test('id가 없으면 명령을 만들지 않는다', () => {
  assert.equal(attachCommand({}), null);
  assert.equal(attachCommand(), null);
  assert.equal(attachCommand({ jobId: '', sessionId: null }), null);
});

test('셸에 끼워 넣을 수 있는 id는 거절한다', () => {
  for (const bad of [
    'x; rm -rf /',
    'a && calc',
    'a | more',
    '$(whoami)',
    '`whoami`',
    'a\nb',
    'a b',
    '../../etc/passwd',
    '"quoted"',
    "'quoted'",
    'a>out.txt',
    'a%APPDATA%',
    'a$HOME',
  ]) {
    assert.equal(attachCommand({ sessionId: bad }), null, `sessionId: ${JSON.stringify(bad)}`);
    assert.equal(attachCommand({ jobId: bad }), null, `jobId: ${JSON.stringify(bad)}`);
  }
  // 길이도 막는다 — 128자까지
  assert.equal(attachCommand({ jobId: 'a'.repeat(128) }), `claude attach ${'a'.repeat(128)}`);
  assert.equal(attachCommand({ jobId: 'a'.repeat(129) }), null);
});

test('id가 없으면 터미널을 띄우지 않고 이유를 돌려준다', async () => {
  const res = await openTerminal({ cwd: process.cwd() });
  // 사유 키는 언어를 타지 않는다 — 부르는 쪽이 키로 분기할 수 있어야 한다
  assert.deepEqual(res, { ok: false, reason: 'no-id' });
  assert.ok(reasonText(res.reason), '이유에는 사람이 읽을 문구가 있어야 한다');
  // 모르는 사유도 빈 문구를 내지 않는다 — 대화상자가 빈 채로 뜨면 무슨 일인지 알 수 없다
  assert.ok(reasonText('nope'), '모르는 사유는 뭉뚱그린 문구로 떨어진다');
});
