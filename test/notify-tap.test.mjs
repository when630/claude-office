// Notification 훅으로 받은 문구를 "무엇을 기다리는지"로 쓸지 판정하는 규칙 (main/notify-tap.mjs).
// 심고 빼는 쪽은 사용자 settings.json을 건드리므로 실기기 확인이고, 여기서는 판정만 붙잡는다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { noteNeeds } from '../main/notify-tap.mjs';

const T0 = Date.parse('2026-07-31T09:00:00Z');

function note(over = {}) {
  return { at: T0, sessionId: 's1', cwd: '/p', type: 'permission_prompt', title: '권한 필요', message: '', ...over };
}

test('권한 확인은 문구를 그대로 쓴다', () => {
  assert.equal(noteNeeds(note({ message: 'Bash 명령을 실행할 권한이 필요합니다' }), T0), 'Bash 명령을 실행할 권한이 필요합니다');
});

test('message가 비면 title로 떨어진다', () => {
  assert.equal(noteNeeds(note({ message: '' }), T0), '권한 필요');
  assert.equal(noteNeeds(note({ message: '', title: '' }), T0), '');
});

test('유휴 알림은 기다리는 내용이 아니라 쓰지 않는다', () => {
  // idle_prompt는 "한동안 조용하다"는 뜻이다 — 무엇을 묻는 게 아니다
  assert.equal(noteNeeds(note({ type: 'idle_prompt', message: 'Claude is waiting for your input' }), T0), '');
});

test('지난 대기의 잔재는 버린다', () => {
  const MIN = 60_000;
  // 대기가 시작되기 10분 전에 온 알림 — 그때 답한 다른 프롬프트다
  assert.equal(noteNeeds(note({ at: T0 - 10 * MIN, message: '옛 질문' }), T0), '');
  // 대기 시작 직전(1분 여유 안)은 받아준다 — 훅이 먼저 돌고 status가 따라오는 순서라서
  assert.equal(noteNeeds(note({ at: T0 - 20_000, message: '방금 질문' }), T0), '방금 질문');
  // 대기 시작 뒤에 온 것은 당연히 받는다
  assert.equal(noteNeeds(note({ at: T0 + 5_000, message: '새 질문' }), T0), '새 질문');
});

test('알림이 없거나 statusAt을 모르면 조용히 넘어간다', () => {
  assert.equal(noteNeeds(null, T0), '');
  assert.equal(noteNeeds(undefined, undefined), '');
  // statusAt이 없으면(세션 파일에 없던 경우) 시각 비교를 건너뛴다
  assert.equal(noteNeeds(note({ message: '질문' }), null), '질문');
});
