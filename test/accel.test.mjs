// 단축키를 보여주는 꼴 (shared/accel.mjs).
//
// 화면에만 나가는 문자열이라 틀려도 앱은 잘 돈다 — 맥에서 `Cmd+Alt+O`라고 적혀 있던 것도
// 실제로 맥에서 열어 볼 때까지 아무도 몰랐다(#133). 그래서 표기를 검사로 못 박아 둔다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { accelLabel, modHint } from '../shared/accel.mjs';

test('맥은 키캡에 새겨진 기호로, 구분자 없이 붙인다', () => {
  assert.equal(accelLabel('CommandOrControl+Alt+O', true), '⌥⌘O');
  assert.equal(accelLabel('CommandOrControl+Alt+Shift+M', true), '⌥⇧⌘M');
  assert.equal(accelLabel('Control+Alt+W', true), '⌃⌥W');
});

test('맥은 누른 순서가 아니라 정해진 순서로 적는다 (⌃ ⌥ ⇧ ⌘)', () => {
  // 저장된 문자열의 순서가 어떻든 화면의 순서는 하나여야 한다
  assert.equal(accelLabel('Shift+Alt+CommandOrControl+O', true), '⌥⇧⌘O');
});

test('윈도는 글자 그대로 — 기호가 키캡에 없다', () => {
  assert.equal(accelLabel('CommandOrControl+Alt+O', false), 'Ctrl+Alt+O');
  assert.equal(accelLabel('CommandOrControl+Alt+Shift+M', false), 'Ctrl+Alt+Shift+M');
});

test('한 글자 키는 대문자로, 여러 글자 키는 그대로', () => {
  assert.equal(accelLabel('Alt+o', true), '⌥O');
  assert.equal(accelLabel('Alt+F1', false), 'Alt+F1');
});

test('같은 수식키가 두 이름으로 와도 한 번만 적는다', () => {
  assert.equal(accelLabel('Command+Cmd+O', true), '⌘O');
});

test('빈 값은 빈 문자열 — 부르는 쪽이 문구로 갈아 끼운다', () => {
  for (const empty of ['', null, undefined, '+']) assert.equal(accelLabel(empty, true), '');
});

test('설명에 들어가는 수식키 목록도 플랫폼을 따른다', () => {
  assert.equal(modHint(true), '⌘ · ⌥ · ⇧');
  assert.equal(modHint(false), 'Ctrl · Alt · Shift');
});
