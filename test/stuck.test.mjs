// 헤매는 세션 판정 (main/collect.mjs의 isStuck · main/transcript.mjs의 scanErrorRun).
//
// 실기기로는 도구를 일부러 세 번 연달아 실패시키거나 10분을 기다려야 확인할 수 있는 로직이라
// 여기서 대화 파일 몇 줄과 시각을 손으로 만들어 확인한다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scanErrorRun } from '../main/transcript.mjs';
import { isStuck, STUCK_ERRORS, STUCK_QUIET_MS } from '../main/collect.mjs';

// 실제 트랜스크립트의 tool_result 줄을 최소한으로 흉내 낸다 — 판정이 보는 것은 두 낱말뿐이다.
const ok = (id) => `{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"${id}"}]}}`;
const err = (id) =>
  `{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"${id}","is_error":true}]}}`;
const chat = (text) => `{"type":"assistant","message":{"content":[{"type":"text","text":"${text}"}]}}`;

test('연달아 실패한 도구 호출 수를 뒤에서부터 센다', () => {
  assert.equal(scanErrorRun([]), 0);
  assert.equal(scanErrorRun([chat('hi')]), 0);
  assert.equal(scanErrorRun([ok('t1'), ok('t2')]), 0);
  assert.equal(scanErrorRun([ok('t1'), err('t2'), err('t3')]), 2);
  // 성공이 하나라도 끼면 연속이 끊긴다
  assert.equal(scanErrorRun([err('t1'), ok('t2'), err('t3')]), 1);
  // 도구 결과가 아닌 줄은 연속을 끊지 않는다 — 실패하고 뭐라 말한 뒤 또 실패한 것도 연속이다
  assert.equal(scanErrorRun([err('t1'), chat('다시 해보자'), err('t2')]), 2);
});

test('도구가 연달아 실패하면 헤매는 것으로 본다', () => {
  const now = Date.now();
  assert.equal(isStuck({ errorRun: STUCK_ERRORS, at: now }, now), true);
  assert.equal(isStuck({ errorRun: STUCK_ERRORS - 1, at: now }, now), false);
  assert.equal(isStuck({ errorRun: 0, at: now }, now), false);
});

test('대화 파일이 한동안 안 자라도 헤매는 것으로 본다', () => {
  const now = Date.now();
  assert.equal(isStuck({ errorRun: 0, at: now - STUCK_QUIET_MS }, now), true);
  // 문턱 아래는 정상이다 — 긴 빌드·테스트는 원래 조용하다
  assert.equal(isStuck({ errorRun: 0, at: now - STUCK_QUIET_MS + 1000 }, now), false);
});

test('읽을 대화 파일이 없으면 헤맨다고 하지 않는다', () => {
  const now = Date.now();
  assert.equal(isStuck(null, now), false);
  // mtime을 모르면 무진전인지 알 수 없다 — 모르는 것을 나쁜 쪽으로 단정하지 않는다
  assert.equal(isStuck({ errorRun: 0, at: null }, now), false);
});
