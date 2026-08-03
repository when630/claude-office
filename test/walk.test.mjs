// 걷는 좌표가 프레임 사이에 튀지 않는가 (renderer/render.mjs의 walkPos).
//
// 이 앱은 점프를 없애려고 앵커까지 도입했고 문서에 "프레임 간 최대 이동량 0.6px"을 적어 뒀는데,
// 그걸 지키는 테스트가 없었다. 비품 앞에 들르기(#64)가 **걷는 목표를 갈아 끼우는** 변경이라
// 여기서 붙잡는다 — 목표가 어디든 보간이 그대로면 이동량도 그대로여야 한다.
//
// render.mjs는 모듈 로드 때 sprites.mjs가 canvas를 만들므로 node로는 안 열린다.
// **document를 최소한으로 세워** 열어 준다 (node --test는 파일마다 별도 프로세스라 새지 않는다).
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

const { walkPos } = await import('../renderer/render.mjs');
const { SPR } = await import('../renderer/sprites.mjs');

// 자리 하나. 실제 layout()이 만드는 것 중 walkPos가 보는 필드만 채운다.
function makeSeat({ idx = 0, count = 1, props = [], mood = 'idle' } = {}) {
  const floor = { x: 20, y: 200, w: 300, h: 60 };
  return {
    worker: { key: `pid:${1000 + idx}`, mood },
    floor,
    idx,
    count,
    x: 20 + idx * 52,
    y: 120,
    box: {
      floor,
      props,
      hang: { x: floor.x + Math.floor(floor.w / 2), y: floor.y + floor.h - 6 },
    },
  };
}

const prop = (key, x) => ({ key, spr: SPR[key], x, y: 250 });

// 16ms 간격으로 걸어 보며 프레임 간 이동량의 최대치를 잰다.
function maxStep(seat, { from = 0, to = 5200 * 12, step = 16 } = {}) {
  let prev = walkPos(seat, from);
  let worst = 0;
  for (let t = from + step; t <= to; t += step) {
    const now = walkPos(seat, t);
    worst = Math.max(worst, Math.abs(now.x - prev.x), Math.abs(now.y - prev.y));
    prev = now;
  }
  return worst;
}

test('비품에 들러도 프레임 간 이동량이 나빠지지 않는다', () => {
  // 문서의 "0.6px"은 **전환**(자리↔바닥) 수치다. 자유 산책은 한 구간에 방을 가로지르므로
  // 원래 그보다 빠르다 — 그래서 절대값이 아니라 **비품이 없을 때와 비교**한다.
  // 목표를 갈아 끼웠을 뿐 보간은 그대로이므로 나빠질 이유가 없다.
  const props = [prop('vending', 25), prop('cooler', 60), prop('sofa', 280)];
  //
  // 여유를 30% 둔다. 들르는 지점이 조금 멀면 그 구간의 걷는 거리가 미세하게 길어지는데
  // (실측 0.64 → 0.67px) 그건 점프가 아니다. **점프는 수십 px 단위로 나타난다** — 이 테스트가
  // 잡으려는 것은 그것이다.
  const base = maxStep(makeSeat());
  const withProps = maxStep(makeSeat({ props }));
  assert.ok(withProps <= base * 1.3, `기준 ${base.toFixed(2)}px → ${withProps.toFixed(2)}px로 나빠졌다`);
});

test('여럿이 나눠 쓰는 방에서도 나빠지지 않는다', () => {
  const props = [prop('vending', 25), prop('arcade', 150), prop('sofa', 280)];
  for (let idx = 0; idx < 4; idx++) {
    const base = maxStep(makeSeat({ idx, count: 4 }));
    const worst = maxStep(makeSeat({ idx, count: 4, props }));
    assert.ok(worst <= base * 1.3, `idx ${idx}: ${base.toFixed(2)}px → ${worst.toFixed(2)}px`);
  }
});

test('비품 앞에 선 지점은 자기 구역 안이다', () => {
  // 남의 구역을 밟으면 두 마리가 같은 자리에 겹쳐 선다.
  // (모임 구간은 일부러 구역을 벗어나 가운데로 모이므로 여기서 세지 않는다 — atProp만 본다.)
  const props = [prop('vending', 25), prop('cooler', 60), prop('arcade', 150), prop('sofa', 280)];
  let sawVisit = false;
  for (let idx = 0; idx < 4; idx++) {
    const seat = makeSeat({ idx, count: 4, props });
    const full = { x0: seat.floor.x + 10, x1: seat.floor.x + seat.floor.w - 10 };
    const band = (full.x1 - full.x0) / 4;
    const lo = Math.max(full.x0, full.x0 + band * (idx - 0.25));
    const hi = Math.min(full.x1, full.x0 + band * (idx + 1.25));
    for (let t = 0; t < 5200 * 20; t += 200) {
      const p = walkPos(seat, t);
      if (!p.atProp) continue;
      sawVisit = true;
      assert.ok(p.x >= lo - 0.01 && p.x <= hi + 0.01, `idx ${idx} t=${t} → x=${p.x.toFixed(1)}`);
    }
  }
  assert.ok(sawVisit, '비품 앞에 서는 순간이 한 번은 있어야 한다');
});

test('걷는 동안 방 바닥을 벗어나지 않는다', () => {
  const props = [prop('vending', 25), prop('sofa', 280)];
  const seat = makeSeat({ props });
  const f = seat.floor;
  for (let t = 0; t < 5200 * 20; t += 100) {
    const p = walkPos(seat, t);
    assert.ok(p.x >= f.x && p.x <= f.x + f.w, `t=${t} x=${p.x.toFixed(1)}`);
    assert.ok(p.y >= f.y && p.y <= f.y + f.h, `t=${t} y=${p.y.toFixed(1)}`);
  }
});

test('같은 순간이면 늘 같은 자리다', () => {
  // 상태를 안 들고 있어야 창을 다시 그려도 같은 곳에 있다
  const props = [prop('vending', 25), prop('sofa', 280)];
  const seat = makeSeat({ props });
  for (const t of [0, 1234, 5200, 5200 * 4 + 77, 5200 * 9]) {
    assert.deepEqual(walkPos(seat, t), walkPos(makeSeat({ props }), t));
  }
});

test('멈춰 선 동안에만 비품 앞이다', () => {
  // 걸어가는 중에 컵이 생기면 안 된다
  const seat = makeSeat({ props: [prop('cooler', 60)] });
  let sawWalkingWithProp = false;
  for (let t = 0; t < 5200 * 12; t += 16) {
    const p = walkPos(seat, t);
    if (p.moving && p.atProp) sawWalkingWithProp = true;
  }
  assert.equal(sawWalkingWithProp, false);
});
