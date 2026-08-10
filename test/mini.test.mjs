// 미니 창의 줄 세우기 (renderer/render.mjs의 miniRoster·miniPlan·layoutMini).
//
// 미니에서 눈으로 확인하기 가장 어려운 두 가지를 여기서 붙잡는다:
//   - **자리가 밀리지 않는가** — 새 대기가 생겼을 때 이미 서 있던 게의 순번이 바뀌면
//     눌렀는데 다른 게가 눌린다. 곁눈질용 창에서 그건 곧 오작동이다.
//   - **앞줄이 살아남는가** — 창을 최소로 줄였을 때 접히는 것은 뒷줄이어야 한다.
//     화면을 굽어 보면 알 수 있지만 220px·420px을 매번 눈으로 세는 것은 회귀 테스트가 아니다.
//
// render.mjs는 모듈 로드 때 sprites.mjs가 canvas를 만들므로 node로는 안 열린다.
// **document를 최소한으로 세워** 열어 준다 (walk.test.mjs와 같은 수법).
import { test } from 'node:test';
import assert from 'node:assert/strict';

globalThis.document = {
  createElement: () => ({
    width: 0,
    height: 0,
    getContext: () => ({
      fillStyle: '',
      fillRect() {},
      clearRect() {},
      drawImage() {},
      getImageData: () => ({ data: new Uint8ClampedArray(4) }),
      putImageData() {},
    }),
  }),
};

const { miniRoster, miniPlan, layoutMini, pickAt } = await import('../renderer/render.mjs');

// 방 하나에 워커 몇. miniRoster가 보는 필드만 채운다.
function room(key, workers) {
  return { key, label: key, cwd: `/${key}`, workers };
}

// statusAt은 **절대 시각**이다 (main/collect.mjs) — 작을수록 오래된 상태다
function w(key, mood, statusAt = 1000) {
  return { key, name: key, mood, statusAt };
}

const keys = (list) => list.map((e) => e.worker.key);

// 미니 기본 크기(420×300)와 최소 크기(220×150)에서 무대에 남는 논리 크기.
// 무대는 창에서 손잡이 22px과 여백 12px을 뺀 만큼이고, 미니 배율은 2다 (pickScale).
const BIG = { w: Math.floor((420 - 12) / 2), h: Math.floor((300 - 22 - 12) / 2) };
const SMALL = { w: Math.floor((220 - 12) / 2), h: Math.floor((150 - 22 - 12) / 2) };

test('앞줄에는 나를 기다리는 것만 선다 — 퇴근한 것은 세우지 않는다', () => {
  const { front, back } = miniRoster([
    room('a', [w('k1', 'waiting'), w('k2', 'typing'), w('k3', 'done')]),
    room('b', [w('k4', 'stuck'), w('k5', 'idle'), w('k6', 'stopped')]),
  ]);
  assert.deepEqual(keys(front), ['k1', 'k4']);
  assert.deepEqual(keys(back), ['k2', 'k5', 'k6']);
});

test('실패도 앞줄에 선다 — 큰 창의 roomScore는 이걸 0점으로 셌다', () => {
  const { front, back } = miniRoster([room('a', [w('busy', 'typing'), w('boom', 'failed')])]);
  assert.deepEqual(keys(front), ['boom']);
  assert.deepEqual(keys(back), ['busy']);
});

test('상태 우선순위대로 선다 — 대기 → 헤맴 → 실패', () => {
  const { front } = miniRoster([
    room('a', [w('f', 'failed', 100), w('s', 'stuck', 100), w('wt', 'waiting', 100)]),
  ]);
  assert.deepEqual(keys(front), ['wt', 's', 'f']);
});

// 서버 장애(main/collect.mjs의 isBroken)는 mood가 아니라 그 위에 얹히는 표시라, mood만
// 보던 앞줄 판정에 안 걸렸다 — 그 세션은 대개 `idle`이라 뒷줄에서 이름도 없이 서 있었다.
const broken = (key, mood, statusAt = 1000) => ({ ...w(key, mood, statusAt), broken: true });

test('서버 장애로 멈춘 세션도 앞줄이다 — mood는 대개 idle이다', () => {
  const { front, back } = miniRoster([room('a', [broken('down', 'idle'), w('busy', 'typing')])]);
  assert.deepEqual(keys(front), ['down']);
  assert.deepEqual(keys(back), ['busy']);
});

test('서버 장애는 헤맴과 실패 사이다 — 세션 목록의 묶음 순서와 같다', () => {
  const { front } = miniRoster([
    room('a', [w('f', 'failed', 100), broken('b', 'idle', 100), w('s', 'stuck', 100), w('wt', 'waiting', 100)]),
  ]);
  assert.deepEqual(keys(front), ['wt', 's', 'b', 'f']);
});

test('입력 대기는 서버가 죽어도 대기다 — 부름이 먼저다', () => {
  // 서버가 죽어 있어도 나를 부르고 있으면 그쪽이 더 급한 소식이다 (shared/status.mjs).
  const { front } = miniRoster([room('a', [w('s', 'stuck', 100), broken('wt', 'waiting', 100)])]);
  assert.deepEqual(keys(front), ['wt', 's']);
});

test('같은 상태끼리는 오래 기다린 것이 앞이다', () => {
  const { front } = miniRoster([
    room('a', [w('new', 'waiting', 9000), w('old', 'waiting', 1000), w('mid', 'waiting', 5000)]),
  ]);
  assert.deepEqual(keys(front), ['old', 'mid', 'new']);
});

// 이게 이 파일의 핵심이다. 대기 시간은 단조 증가하므로 새로 생긴 대기는 늘 줄 끝에 붙어야 한다.
test('새 대기가 생겨도 이미 서 있던 게의 순번은 그대로다', () => {
  const before = miniRoster([room('a', [w('one', 'waiting', 1000), w('two', 'waiting', 2000), w('busy', 'typing', 500)])]);
  assert.deepEqual(keys(before.front), ['one', 'two']);

  // busy가 답을 물어 왔다 — 방금 대기로 바뀌었으므로 statusAt이 가장 늦다
  const after = miniRoster([room('a', [w('one', 'waiting', 1000), w('two', 'waiting', 2000), w('busy', 'waiting', 7000)])]);
  assert.deepEqual(keys(after.front), ['one', 'two', 'busy']);
  // 앞의 둘은 자리를 지켰다
  assert.equal(keys(after.front).indexOf('one'), keys(before.front).indexOf('one'));
  assert.equal(keys(after.front).indexOf('two'), keys(before.front).indexOf('two'));
});

test('statusAt이 없는 것은 같은 급의 뒤로 밀린다 — 키 순으로 갈린다', () => {
  const { back } = miniRoster([
    room('a', [{ key: 'zz', name: 'zz', mood: 'idle' }, { key: 'aa', name: 'aa', mood: 'idle' }, w('has', 'idle', 10)],),
  ]);
  assert.deepEqual(keys(back), ['has', 'aa', 'zz']);
});

test('기본 크기에서는 앞줄이 이름·경과·게이지를 다 달고 한 줄에 선다', () => {
  const plan = miniPlan({ ...BIG, front: 2, back: 5, scale: 2 });
  assert.equal(plan.detail, 2);
  assert.equal(plan.rows, 1);
  assert.equal(plan.frontShown, 2);
  assert.equal(plan.foldedFront, 0);
  assert.equal(plan.foldedBack, 0, '기본 크기에 다섯은 다 들어간다');
});

test('최소 크기에서도 앞줄은 남고 접히는 것은 뒷줄이다', () => {
  const plan = miniPlan({ ...SMALL, front: 2, back: 5, scale: 2 });
  assert.equal(plan.frontShown, 2, '앞줄은 상세도를 깎아서라도 남긴다');
  assert.equal(plan.foldedFront, 0);
  assert.equal(plan.foldedBack, 5, '뒷줄은 줄째로 접힌다');
});

// 실측에서 걸린 것 — 셋이면 두 열에 두 줄이 되어 세로에 안 들어가 앞줄이 접혔다.
// 상세도 0에서는 이름을 떼므로 칸이 좁아도 되고, 그러면 세 열이 한 줄에 선다.
test('최소 크기에 대기가 셋이어도 앞줄은 접히지 않는다', () => {
  const plan = miniPlan({ ...SMALL, front: 3, back: 5, scale: 2 });
  assert.equal(plan.foldedFront, 0);
  assert.equal(plan.rows, 1, '이름을 떼고 한 줄에 세운다');
  assert.equal(plan.cols, 3);
});

test('앞줄이 많으면 상세도가 먼저 깎이고, 그래도 안 들어가면 마지막에 접힌다', () => {
  const plan = miniPlan({ ...SMALL, front: 6, back: 0, scale: 2 });
  assert.equal(plan.detail, 0, '이름·경과를 떼고 게이지만 남긴다');
  assert.ok(plan.frontShown >= plan.cols, '적어도 한 줄은 세운다');
  assert.equal(plan.frontShown + plan.foldedFront, 6);
});

// **창을 키웠는데 보이는 게가 줄어드는 일이 없어야 한다.** 전에는 있었다 — 폭 220에서 높이를
// 200 → 220으로 키우면 7마리(앞줄 3 + 뒷줄 4)가 3마리로 줄었다. 상세도가 오르면 칸 최소 폭도
// 올라 열이 줄고 앞줄이 한 줄 늘어나는데, 그 한 줄이 뒷줄 자리를 다 먹었다.
//
// **상세도의 단조성은 불변식이 아니다** — 뒷줄을 살리려고 일부러 내려간다(폭 420·높이 190에서
// 상세도 2 대신 1을 골라 뒷줄 여섯을 세운다). 그걸 지키려 들면 이 버그를 다시 심는다.
// 총합이 아니라 **사전식**으로 잰다. 총합 단조성은 "앞줄이 최우선"과 충돌한다 — 창이 조금 커져
// 접혀 있던 앞줄 게 하나가 펴질 때, 그 한 줄이 뒷줄 넷을 밀어내는 구간이 있다. 나를 기다리는
// 게 하나가 뒷줄 넷보다 앞이므로 그건 옳은 거래다. 지켜야 하는 것은 이 둘이다:
//   - 창이 커질 때 앞줄이 줄지 않는다
//   - 앞줄이 그대로면 뒷줄도 줄지 않는다  ← 여기가 깨져 있었다
test('창을 키웠을 때 앞줄이 줄지 않고, 앞줄이 그대로면 뒷줄도 줄지 않는다', () => {
  for (let w = SMALL.w; w <= BIG.w * 2; w += 2) {
    for (const [front, back] of [
      [0, 3],
      [1, 4],
      [2, 6],
      [2, 14],
      [3, 6],
      [4, 10],
      [6, 20],
      [8, 30],
    ]) {
      let prev = null;
      for (let h = 20; h <= BIG.h * 3; h += 1) {
        const p = miniPlan({ w, h, front, back, scale: 2 });
        if (prev) {
          const where = `폭 ${w}·높이 ${h} (대기 ${front}·작업 ${back})`;
          assert.ok(p.frontShown >= prev.frontShown, `${where}: 앞줄이 ${prev.frontShown} → ${p.frontShown}으로 줄었다`);
          if (p.frontShown === prev.frontShown) {
            assert.ok(p.backShown >= prev.backShown, `${where}: 뒷줄이 ${prev.backShown} → ${p.backShown}으로 줄었다`);
          }
        }
        prev = p;
      }
    }
  }
});

// `+n` 한 줄(≈8px)을 확보하려고 뒷줄 한 줄(25px = 게 넷)을 내주던 구간이 있었다.
// 총원은 22px 손잡이에 늘 적혀 있으므로 게를 세우는 쪽이 낫다.
test('접힌 개수를 적으려고 뒷줄을 내주지 않는다', () => {
  for (let w = SMALL.w; w <= BIG.w; w += 2) {
    for (let h = 30; h <= BIG.h; h += 1) {
      const p = miniPlan({ w, h, front: 2, back: 14, scale: 2 });
      if (p.foldH > 0) continue; // 적을 자리가 있었던 경우는 논외
      // 접힘 표시를 뺀 만큼으로 뒷줄이 한 줄이라도 더 섰어야 한다면 실패다
      const roomForOneMore = p.availH - p.frontH - (p.rows > 0 ? 4 : 0) - p.backH - (p.backRows > 0 ? 4 : 0);
      assert.ok(
        p.foldedBack === 0 || roomForOneMore < 25,
        `폭 ${w}·높이 ${h}: 뒷줄 한 줄이 더 들어갈 자리(${roomForOneMore})가 남았는데 ${p.foldedBack}마리를 접었다`,
      );
    }
  }
});

// 접힌 개수와 세운 개수를 합치면 늘 전원이다 — 어느 크기에서도 게가 조용히 사라지지 않는다
test('세운 것과 접힌 것을 합치면 전원이다', () => {
  for (const w of [SMALL.w, 140, BIG.w]) {
    for (const h of [20, SMALL.h, 90, BIG.h]) {
      for (const [front, back] of [
        [0, 0],
        [2, 6],
        [5, 14],
        [9, 31],
      ]) {
        const p = miniPlan({ w, h, front, back, scale: 2 });
        assert.equal(p.frontShown + p.foldedFront, front, `앞줄 셈이 안 맞는다 (${w}×${h})`);
        assert.equal(p.backShown + p.foldedBack, back, `뒷줄 셈이 안 맞는다 (${w}×${h})`);
      }
    }
  }
});

// 창을 좁히면 열이 줄고 줄이 늘어난다 — 접히는 것은 세로가 모자랄 때뿐이어야 한다.
// 폭은 창의 최소치(220px)부터 훑는다. 그보다 좁은 창은 만들 수 없다 (main/index.mjs의 minWidth).
test('폭이 좁아도 앞줄은 접히지 않는다 — 열이 줄면 줄이 늘어난다', () => {
  for (let width = SMALL.w; width <= BIG.w; width += 4) {
    const plan = miniPlan({ w: width, h: BIG.h, front: 4, back: 0, scale: 2 });
    assert.equal(plan.foldedFront, 0, `폭 ${width}에서 앞줄이 접혔다`);
    assert.equal(plan.frontShown, 4);
    assert.ok(plan.cols * plan.rows >= 4);
  }
});

test('최소 크기에서 앞줄이 둘은 들어간다', () => {
  const plan = miniPlan({ ...SMALL, front: 2, back: 0, scale: 2 });
  assert.equal(plan.cols, 2);
  assert.equal(plan.rows, 1);
  assert.equal(plan.foldedFront, 0);
});

test('배율이 올라가도 글자 줄 간격이 논리 좌표로 줄어든다', () => {
  const two = miniPlan({ ...BIG, front: 1, back: 1, scale: 2 });
  const four = miniPlan({ ...BIG, front: 1, back: 1, scale: 4 });
  assert.ok(four.lineH < two.lineH, '글자는 확대 밖에서 12px 고정이라 논리 간격이 좁아진다');
  assert.ok(four.nameDy < two.nameDy);
});

test('layoutMini가 만든 자리는 창 안에 있고 클릭 판정이 걸린다', () => {
  const view = layoutMini(
    [room('a', [w('k1', 'waiting', 100), w('k2', 'typing'), w('k3', 'idle')])],
    BIG.w,
    BIG.h,
    { scale: 2, nameOf: (x) => x.name },
  );
  assert.equal(view.seats.length, 3);
  assert.equal(view.boxes.length, 0, '방은 그리지 않는다');
  for (const s of view.seats) {
    assert.ok(s.x >= 0 && s.x + s.w <= BIG.w, `${s.worker.key}가 가로로 넘쳤다`);
    assert.ok(s.y >= 0 && s.y + s.h <= BIG.h, `${s.worker.key}가 세로로 넘쳤다`);
    // 돌아다니지 않으므로 첫 프레임을 그리기 전에도 actor가 채워져 있어야 한다 (pickAt)
    assert.ok(s.actor && Number.isFinite(s.actor.x) && Number.isFinite(s.actor.y));
    assert.equal(s.actor.seated, false);
    assert.ok(s.hue != null, '방 색은 발판에 남긴다');
  }
});

test('앞줄이 뒷줄보다 아래에 선다 — 앞에 선 것이 아래라야 원근이 맞는다', () => {
  const view = layoutMini(
    [room('a', [w('wt', 'waiting', 100), w('busy', 'typing')])],
    BIG.w,
    BIG.h,
    { scale: 2 },
  );
  const front = view.seats.find((s) => s.worker.key === 'wt');
  const back = view.seats.find((s) => s.worker.key === 'busy');
  assert.ok(front.front && !back.front);
  assert.ok(front.feet > back.feet, '앞줄의 발이 더 아래에 있어야 한다');
});

// 미니에서 할 수 있는 일은 게를 누르는 것 하나뿐이다 — 잘못 잡히면 그게 곧 오작동이다.
// 큰 창과 같은 pickAt을 쓰므로(view 모양을 맞춰 뒀다) 그것까지 여기서 확인한다.
test('게마다 자기 자리가 집힌다 — 눌렀는데 옆 게가 잡히지 않는다', () => {
  const view = layoutMini(
    [
      room('api', [w('api-1', 'waiting', 12), w('api-2', 'typing')]),
      room('web', [w('web-1', 'typing'), w('web-2', 'idle')]),
      room('docs', [w('docs-1', 'waiting', 3), w('docs-2', 'failed', 40)]),
    ],
    BIG.w,
    BIG.h,
    { scale: 2, nameOf: (x) => x.name },
  );
  assert.equal(view.seats.length, 6);
  for (const s of view.seats) {
    for (const [why, x, y] of [
      ['몸통', s.actor.x, s.actor.y - 5],
      ['머리', s.actor.x, s.actor.y - 11],
      ['발', s.actor.x, s.actor.y],
      ['칸 가운데', s.x + Math.floor(s.w / 2), s.y + Math.floor(s.h / 2)],
    ]) {
      const hit = pickAt(view, x, y);
      assert.equal(hit?.worker.key, s.worker.key, `${s.worker.key}의 ${why}에서 ${hit?.worker.key}가 잡혔다`);
    }
  }
});

test('대기가 없으면 앞줄이 아예 없다', () => {
  const view = layoutMini([room('a', [w('busy', 'typing'), w('z', 'idle')])], BIG.w, BIG.h, { scale: 2 });
  assert.equal(view.seats.filter((s) => s.front).length, 0);
  assert.equal(view.seats.length, 2);
  assert.equal(view.mini.rows, 0);
});

test('아무도 없으면 자리도 없다 — 안내는 app.mjs가 적는다', () => {
  const view = layoutMini([], BIG.w, BIG.h, { scale: 2 });
  assert.equal(view.seats.length, 0);
  assert.equal(view.width, BIG.w);
  assert.equal(view.height, BIG.h);
});
