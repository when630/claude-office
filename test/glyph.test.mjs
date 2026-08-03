// 머리 옆 기호 고르기 (renderer/talk.mjs의 glyphKeyFor).
//
// 시간대와 시각을 인자로 받는 순수 함수라 새벽까지 기다리지 않고 확인할 수 있다.
// 스프라이트가 아니라 키를 돌려주므로 canvas 없이 node로 돈다(sprites.mjs는 모듈 로드 때
// document.createElement를 부른다 — 그래서 render.mjs 자체는 여기서 import할 수 없다).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { glyphKeyFor } from '../renderer/talk.mjs';

const w = (over = {}) => ({ key: 'pid:1000', mood: 'idle', ...over });

test('상태별 기호는 그대로다', () => {
  assert.equal(glyphKeyFor(w({ mood: 'waiting' })), 'gBang');
  assert.equal(glyphKeyFor(w({ mood: 'stuck' })), 'gStuck');
  assert.equal(glyphKeyFor(w({ mood: 'done' })), 'gCheck');
  assert.equal(glyphKeyFor(w({ mood: 'failed' })), 'gCross');
  assert.equal(glyphKeyFor(w({ mood: 'stopped' })), 'gZzz');
  // 평소 타이핑·유휴에는 아무것도 안 붙는다
  assert.equal(glyphKeyFor(w({ mood: 'typing' })), null);
  assert.equal(glyphKeyFor(w({ mood: 'idle' })), null);
});

test('전환 표시가 상태보다 먼저다', () => {
  // 걸어 나가는 동안에도 ✓가 붙어 있어야 "다 하고 나가는 것"으로 읽힌다
  assert.equal(glyphKeyFor(w({ mood: 'idle' }), { phase: { note: 'done' } }), 'gCheck');
  assert.equal(glyphKeyFor(w({ mood: 'typing' }), { phase: { note: 'start' } }), 'gSpark');
});

test('잡담 중에는 기호를 접는다 — 하트만 예외', () => {
  const chat0 = { pairKey: 'a|b', role: 0 };
  const chat1 = { pairKey: 'a|b', role: 1 };
  // 내가 말하는 동안에는 아무것도 안 띄운다
  assert.equal(glyphKeyFor(w(), { chat: chat0, answering: false }), null);
  // 상대가 답하는 동안 먼저 말한 쪽(role 0)에만 하트
  assert.equal(glyphKeyFor(w(), { chat: chat0, answering: true }), 'gHeart');
  // 답하는 쪽은 자기 말풍선이 떠 있으니 겹치지 않게 접는다
  assert.equal(glyphKeyFor(w(), { chat: chat1, answering: true }), null);
  // 기다리는 놈은 애초에 잡담 짝에서 빠지지만, 짝이 잡혀도 느낌표가 하트로 바뀌지는 않는다
  assert.equal(glyphKeyFor(w({ mood: 'waiting' }), { chat: chat1, answering: true }), null);
});

test('헤매기 직전에는 말줄임을 얹는다', () => {
  // 판정은 main이 한다(collect의 isSlowing) — 여기서는 표시만
  assert.equal(glyphKeyFor(w({ mood: 'typing', slowing: true })), 'gDots');
  assert.equal(glyphKeyFor(w({ mood: 'typing', slowing: false })), null);
  // 이미 stuck으로 넘어갔으면 말줄임이 아니라 헤매는 기호다
  assert.equal(glyphKeyFor(w({ mood: 'stuck', slowing: true })), 'gStuck');
});

test('심야에 어슬렁거리면 콧노래를 흥얼거린다', () => {
  // 주기가 있어 늘 뜨지는 않는다 — 한 주기 안에서 뜨는 순간이 있어야 하고, 안 뜨는 순간도 있어야 한다
  const at = (tms) => glyphKeyFor(w({ mood: 'idle' }), { slot: 'lateNight', tms });
  const seen = new Set();
  for (let tms = 0; tms < 4200 * 6; tms += 300) seen.add(at(tms));
  assert.ok(seen.has('gNote'), '심야에 한 번은 흥얼거려야 한다');
  assert.ok(seen.has(null), '늘 띄우면 장식이 된다');

  // 다른 시간대에는 안 뜬다
  for (const slot of ['morning', 'lunch', 'afternoon', 'evening', 'night', '']) {
    const hits = [];
    for (let tms = 0; tms < 4200 * 6; tms += 300) hits.push(glyphKeyFor(w({ mood: 'idle' }), { slot, tms }));
    assert.ok(
      hits.every((h) => h === null),
      `${slot}에는 콧노래가 없어야 한다`,
    );
  }
  // 일하는 중이면 새벽이라도 흥얼거리지 않는다
  assert.equal(glyphKeyFor(w({ mood: 'typing' }), { slot: 'lateNight', tms: 0 }), null);
});

test('같은 순간이면 늘 같은 기호다', () => {
  // 상태를 들고 있지 않아야 창을 다시 그려도 흔들리지 않는다
  const opts = { slot: 'lateNight', tms: 12_345 };
  assert.equal(glyphKeyFor(w({ mood: 'idle' }), opts), glyphKeyFor(w({ mood: 'idle' }), opts));
});
