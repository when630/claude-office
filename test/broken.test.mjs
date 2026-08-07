// 서버 장애로 멈춘 세션 판정과 어지러움 표시
// (main/transcript.mjs의 scanApiFail · main/collect.mjs의 isBroken · renderer/talk.mjs의 showsDizzy).
//
// 실기기로는 Anthropic 쪽이 죽어 있는 순간을 골라야 확인할 수 있는 로직이다. 그래서 실제
// 트랜스크립트에서 뜬 줄 모양을 그대로 옮겨 와 여기서 만든다 — 아래 apiErr가 그 모양이다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scanApiFail } from '../main/transcript.mjs';
import { isBroken, BROKEN_FRESH_MS } from '../main/collect.mjs';
import { showsDizzy, glyphKeyFor } from '../renderer/talk.mjs';

const iso = (ms) => new Date(ms).toISOString();

// 실제 줄에서 판정이 보는 것만 남겼다 — model이 `<synthetic>`인 assistant 줄에
// error·isApiErrorMessage가 붙어 온다.
const apiErr = (kind, at = 0) =>
  JSON.stringify({
    type: 'assistant',
    timestamp: iso(at),
    message: { model: '<synthetic>', content: [{ type: 'text', text: `API Error: ${kind}` }] },
    error: kind,
    isApiErrorMessage: true,
  });

// 정상 응답. usage를 들고 있어야 스캐너가 파싱까지 간다(그 낱말로 걸러낸다).
const said = (at = 0, model = 'claude-opus-5') =>
  JSON.stringify({
    type: 'assistant',
    timestamp: iso(at),
    message: {
      model,
      content: [{ type: 'text', text: '됐습니다' }],
      usage: { input_tokens: 10, cache_read_input_tokens: 100 },
    },
  });

const toolResult = () =>
  JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't1' }] } });

test('서버 에러가 마지막 응답이면 연속을 센다', () => {
  assert.deepEqual(scanApiFail([]), { run: 0, at: null });
  assert.deepEqual(scanApiFail([said(1000)]), { run: 0, at: null });

  const one = scanApiFail([said(1000), apiErr('server_error', 2000)]);
  assert.equal(one.run, 1);
  assert.equal(one.at, 2000);

  // 재시도가 또 죽으면 연속이다. 시각은 **가장 최근 것**이라야 한다 — 문턱을 그것으로 잰다
  const two = scanApiFail([apiErr('server_error', 2000), apiErr('server_error', 5000)]);
  assert.equal(two.run, 2);
  assert.equal(two.at, 5000);
});

test('정상 응답이 뒤에 붙으면 회복한 것으로 본다', () => {
  // 529는 몇 분 뒤 재시도로 풀리는 게 보통이다. 그 뒤에 온 응답 한 줄이 "이제 된다"는 증거다.
  assert.deepEqual(scanApiFail([apiErr('server_error', 2000), said(3000)]), { run: 0, at: null });
  // 도구 결과처럼 assistant가 아닌 줄은 연속을 끊지 않는다
  assert.equal(scanApiFail([apiErr('server_error', 2000), toolResult()]).run, 1);
  // `<synthetic>`은 에러·안내용 가짜 응답이라 회복으로 세지 않는다
  assert.equal(scanApiFail([apiErr('server_error', 2000), said(3000, '<synthetic>')]).run, 1);
});

test('한도·로그인 문제는 서버 고장이 아니다', () => {
  // 429는 서버가 아니라 내 몫을 다 쓴 것이고, 앱에 이미 사용량 게이지가 있다
  assert.deepEqual(scanApiFail([apiErr('rate_limit', 2000)]), { run: 0, at: null });
  assert.deepEqual(scanApiFail([apiErr('authentication_failed', 2000)]), { run: 0, at: null });
  // 서버 에러 앞에 그것이 있어도 뒤에서부터 센 연속은 서버 에러만이다
  assert.equal(scanApiFail([apiErr('rate_limit', 1000), apiErr('server_error', 2000)]).run, 1);
});

test('서브에이전트가 먹은 에러는 세지 않는다', () => {
  // 비서가 529를 먹어도 본체는 멀쩡히 돌 수 있다
  const line = JSON.stringify({
    type: 'assistant',
    isSidechain: true,
    timestamp: iso(2000),
    message: { model: '<synthetic>', content: [] },
    error: 'server_error',
    isApiErrorMessage: true,
  });
  assert.deepEqual(scanApiFail([line]), { run: 0, at: null });
});

test('최근 에러만 어지러움으로 본다', () => {
  const now = Date.now();
  assert.equal(isBroken({ apiFail: { run: 1, at: now - 1000 } }, now), true);
  // 회복하지 못한 채 끝난 세션의 에러 줄은 트랜스크립트 꼬리에 그대로 남는다 —
  // 문턱이 없으면 어제 장애를 만난 세션이 오늘까지 어지러워한다
  assert.equal(isBroken({ apiFail: { run: 1, at: now - BROKEN_FRESH_MS } }, now), false);
  assert.equal(isBroken({ apiFail: { run: 0, at: null } }, now), false);
  assert.equal(isBroken(null, now), false);
  // 시각을 못 읽었으면 대화 파일이 마지막으로 자란 시각으로 대신한다 (에러 줄이 곧 마지막 줄이다)
  assert.equal(isBroken({ apiFail: { run: 1, at: null }, at: now - 1000 }, now), true);
  assert.equal(isBroken({ apiFail: { run: 1, at: null }, at: null }, now), false);
});

test('어지러운 동안에는 상태 기호를 접는다', () => {
  // 궤도가 기호 말풍선 자리(머리 옆)를 지나므로 둘을 같이 띄우면 겹친다.
  // 두 곳이 같은 판정을 봐야 기호와 별이 함께 뜨거나 함께 사라지는 일이 없다.
  const idle = { key: 'a', mood: 'idle', broken: true };
  assert.equal(showsDizzy(idle), true);
  assert.equal(glyphKeyFor(idle), null);

  const typing = { key: 'b', mood: 'typing', broken: true, slowing: true };
  assert.equal(showsDizzy(typing), true);
  assert.equal(glyphKeyFor(typing), null); // 말줄임(gDots)도 접는다 — 조용한 이유는 서버다
});

test('입력 대기와 전환 표시가 어지러움보다 앞이다', () => {
  // 서버가 죽어 있어도 나를 부르는 것이 더 급한 소식이다
  const waiting = { key: 'c', mood: 'waiting', broken: true };
  assert.equal(showsDizzy(waiting), false);
  assert.equal(glyphKeyFor(waiting), 'gBang');

  // ✓·✱는 걸어 나가는 내내 들고 있어야 "다 하고 나가는 것"으로 읽힌다
  const done = { key: 'd', mood: 'idle', broken: true };
  const phase = { mode: 'out', note: 'done' };
  assert.equal(showsDizzy(done, phase), false);
  assert.equal(glyphKeyFor(done, { phase }), 'gCheck');
});

test('고장나지 않았으면 아무것도 안 바뀐다', () => {
  const idle = { key: 'e', mood: 'idle' };
  assert.equal(showsDizzy(idle), false);
  const typing = { key: 'f', mood: 'typing', slowing: true };
  assert.equal(showsDizzy(typing), false);
  assert.equal(glyphKeyFor(typing), 'gDots');
});
