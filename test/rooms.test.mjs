// 방 묶기와 별칭 (main/rooms.mjs).
//
// 방 = 작업 디렉터리라서 모노레포를 쓰면 방이 열 개씩 뜬다. 요점은 **묶기가 근태 기록의 방
// 이름을 건드리지 않는 것**이다 — 그건 collect가 histRoom을 따로 실어 보내는 것으로 지킨다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groupOf, labelOf, parentOf, sanitizeGroups, sanitizeAlias } from '../main/rooms.mjs';

test('등록한 부모 아래 방은 그 부모 이름으로 묶인다', () => {
  const groups = ['D:\\repo'];
  assert.equal(groupOf('D:\\repo\\packages\\web', groups), 'repo');
  assert.equal(groupOf('D:\\repo\\packages\\api', groups), 'repo');
  // 등록 안 한 곳은 그대로 둔다 (부르는 쪽이 원래 이름으로 떨어진다)
  assert.equal(groupOf('D:\\other\\web', groups), null);
});

test('구분자와 대소문자를 가리지 않는다', () => {
  // Windows는 대소문자를 안 가리고, 같은 경로가 / 와 \\ 로 섞여 온다
  assert.equal(groupOf('d:/REPO/web', ['D:\\repo']), 'repo');
  assert.equal(groupOf('D:\\repo\\web', ['d:/repo/']), 'repo');
});

test('가장 깊이 맞는 묶음이 이긴다', () => {
  // 둘 다 등록돼 있으면 더 구체적인 쪽 — 안 그러면 세분화가 불가능하다
  const groups = ['D:\\repo', 'D:\\repo\\packages'];
  assert.equal(groupOf('D:\\repo\\packages\\web', groups), 'packages');
  assert.equal(groupOf('D:\\repo\\apps\\admin', groups), 'repo');
});

test('이름이 겹치는 형제 폴더를 먹지 않는다', () => {
  // `D:\repo`가 `D:\repository`를 삼키면 안 된다 — 경계를 구분자로 끊어 본다
  assert.equal(groupOf('D:\\repository\\web', ['D:\\repo']), null);
  // 자기 자신은 묶음이 아니다 (그 방 하나만 있는 묶음은 뜻이 없다)
  assert.equal(groupOf('D:\\repo', ['D:\\repo']), null);
});

test('별칭이 있으면 그 이름으로 부른다', () => {
  assert.equal(labelOf('src', { src: '게시판 백엔드' }), '게시판 백엔드');
  // 없으면 방 이름 그대로 — 빈 문자열도 별칭 없음으로 본다
  assert.equal(labelOf('src', {}), 'src');
  assert.equal(labelOf('src', { src: '' }), 'src');
  assert.equal(labelOf('src', null), 'src');
});

test('부모 경로는 루트에서 멈춘다', () => {
  assert.equal(parentOf('D:\\repo\\packages\\web'), 'D:\\repo\\packages');
  // 드라이브 루트까지 올라가면 온 사무실이 한 방이 된다 — 묶을 것이 없다고 답한다
  assert.equal(parentOf('D:\\web'), '');
  assert.equal(parentOf('/web'), '');
  assert.equal(parentOf(''), '');
});

test('손으로 고친 설정을 좁게 받는다', () => {
  // 앱이 못 뜨게 하지 않는 것이 목적이다
  assert.deepEqual(sanitizeGroups(null), []);
  assert.deepEqual(sanitizeGroups(['D:\\a', 'D:\\a', '', 42, 'D:\\b']), ['D:\\a', 'D:\\b']);
  // 같은 경로가 구분자만 다르게 두 번 오면 하나로 본다
  assert.deepEqual(sanitizeGroups(['D:\\a', 'd:/a/']), ['D:\\a']);

  assert.deepEqual(sanitizeAlias(null), {});
  assert.deepEqual(sanitizeAlias({ a: '  이름  ', b: '', c: 42 }), { a: '이름' });
  // 너무 긴 별칭은 자른다 — 이름표가 방을 뚫고 나가지 않게
  assert.equal(sanitizeAlias({ a: 'x'.repeat(80) }).a.length, 40);
});
