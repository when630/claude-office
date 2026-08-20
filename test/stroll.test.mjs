// 산책 모드의 움직임 (renderer/stroll.mjs).
//
// 여기서 붙잡는 것은 **눈으로 확인하기 가장 비싼 것들**이다. 산책은 바탕화면 위에서 몇 분에
// 한 번 일어나는 일이라(일이 들어와 앉고, 끝나서 접고, 세션이 사라져 걸어 나가고) 화면을
// 굽어 보는 것으로는 그 순간을 잡을 수 없다.
//
// stroll.mjs는 캔버스를 모르지만 render.mjs(miniRoster)를 통해 줄 세우기를 빌려 오고,
// render.mjs는 모듈 로드 때 sprites.mjs가 canvas를 만든다. **document를 최소한으로 세워**
// 열어 준다 (mini.test.mjs·walk.test.mjs와 같은 수법).
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

const { createWorld, stepStroll, strollCast, wantAct, saying, petAt, petHitBox, petsInBox, orderMove, throwPet, strollArea, STROLL_MAX } =
  await import(
  '../renderer/stroll.mjs'
);

const W = 400;
const H = 200;

function worker(key, mood = 'idle', over = {}) {
  return { key, mood, name: key, statusAt: 1000, context: null, ...over };
}

function rooms(...specs) {
  // 실제 스냅샷의 방 모양 그대로 — 화면에 적히는 이름은 label이다(main/collect.mjs)
  return specs.map(([name, ...workers]) => ({ key: name, label: name, cwd: name, workers }));
}

// 프레임을 돌린다. 시각은 16ms 단위로 흐르고, 실제 rAF처럼 dt를 그대로 넘긴다.
function run(world, cast, { frames = 60, dt = 16, t0 = 10_000, drag = null, rng = () => 0.5 } = {}) {
  let pets = [];
  for (let i = 0; i < frames; i++) {
    pets = stepStroll(world, cast, { w: W, h: H, now: t0 + i * dt, dt, drag: drag?.(i) ?? null, rng });
  }
  return pets;
}

function find(pets, key) {
  return pets.find((p) => p.key === key) ?? null;
}

test('내보낼 인원은 상한을 넘지 않고 급한 것이 먼저다', () => {
  const many = rooms([
    'proj',
    worker('a', 'idle'),
    worker('b', 'typing'),
    worker('c', 'waiting'),
    worker('d', 'idle'),
    worker('e', 'stuck'),
    worker('f', 'idle'),
    worker('g', 'idle'),
    worker('h', 'idle'),
  ]);
  const cast = strollCast(many, 3);
  assert.equal(cast.length, 3);
  // 대기·헤맴이 유휴보다 앞이다 — 미니 창의 앞줄 판정을 그대로 쓴다
  const keys = cast.map((e) => e.worker.key);
  assert.ok(keys.includes('c'), `대기가 빠졌다: ${keys}`);
  assert.ok(keys.includes('e'), `헤맴이 빠졌다: ${keys}`);
  assert.ok(!keys.includes('g'), `유휴가 급한 것을 밀어냈다: ${keys}`);
});

test('퇴근한 세션은 아예 안 나간다', () => {
  const cast = strollCast(rooms(['proj', worker('a', 'done'), worker('b', 'idle')]));
  assert.deepEqual(
    cast.map((e) => e.worker.key),
    ['b'],
  );
});

test('상한을 안 주면 기본값이다', () => {
  const w = Array.from({ length: 20 }, (_, i) => worker(`w${i}`, 'idle'));
  assert.equal(strollCast(rooms(['proj', ...w])).length, STROLL_MAX);
});

test('무엇을 하고 있어야 하는가 — 일을 받으면 앉고 나머지는 서거나 걷는다', () => {
  assert.equal(wantAct(worker('a', 'typing')), 'work');
  assert.equal(wantAct(worker('a', 'idle')), 'walk');
  assert.equal(wantAct(worker('a', 'waiting')), 'halt');
  assert.equal(wantAct(worker('a', 'stuck')), 'halt');
  assert.equal(wantAct(worker('a', 'failed')), 'halt');
  assert.equal(wantAct(worker('a', 'stopped')), 'halt');
});

test('등장은 화면 밖에서 걸어오는 것이 아니라 포탈에서 떨어지는 것이다', () => {
  const world = createWorld();
  const cast = strollCast(rooms(['proj', worker('a', 'idle')]));
  const first = find(stepStroll(world, cast, { w: W, h: H, now: 10_000, dt: 16, rng: () => 0.4 }), 'a');

  assert.equal(first.act, 'warp');
  // 좌우 화면 밖이 아니라 **설 자리 위**에서 시작한다
  assert.ok(first.x > 0 && first.x < W, `화면 밖에서 나타났다: ${first.x}`);
  assert.ok(first.y < first.gy, `떨어질 높이가 없다: ${first.y} → ${first.gy}`);
  // 구멍은 **게가 나오기 시작하는 평면**이다 — 그 위의 몸은 그리는 쪽이 잘라 내므로,
  // 여기가 어긋나면 게가 구멍 밑에 떠 있는 그림이 된다
  assert.equal(Math.round(first.portalY), Math.round(first.y));
  assert.ok(first.portalY < first.gy, `구멍이 설 자리보다 아래다: ${first.portalY}`);

  // 포탈이 다 열릴 때까지는 떨어지지 않는다 — 구멍도 없는데 게가 먼저 나오면 안 된다
  const opening = find(run(world, cast, { frames: 6, t0: 10_016 }), 'a');
  assert.equal(Math.round(opening.y), Math.round(first.y), '포탈이 열리기 전에 떨어졌다');
  assert.ok(opening.portal > 0 && opening.portal < 1, `포탈이 안 열리는 중이다: ${opening.portal}`);

  // 떨어져서 제자리에 선다. **여기서 프레임을 더 돌리면 안 된다** — 착지 뒤 멈칫이 끝나면
  // 새 목적지로 걷기 시작해서, 그때의 y는 내려앉은 자리가 아니다.
  const landed = find(run(world, cast, { frames: 45, t0: 10_200 }), 'a');
  assert.equal(Math.round(landed.y), Math.round(landed.gy), `안 내려앉았다: ${landed.y}`);
  assert.equal(landed.act, 'land', `아직 떨어지는 중이다: ${landed.act}`);
});

test('포탈은 게가 선 뒤에 닫힌다', () => {
  const world = createWorld();
  const cast = strollCast(rooms(['proj', worker('a', 'idle')]));
  stepStroll(world, cast, { w: W, h: H, now: 30_000, dt: 16, rng: () => 0.4 });

  // 착지 직후(멈칫하는 동안)에도 구멍은 아직 남아 있다 — 서자마자 사라지면 튀어나온 것이
  // 아니라 원래 거기 있던 것으로 보인다
  const justLanded = find(run(world, cast, { frames: 45, t0: 30_016 }), 'a');
  assert.equal(justLanded.act, 'land');
  assert.ok(justLanded.portal > 0, '서자마자 구멍이 사라졌다');

  // 시간이 더 지나면 닫힌다
  const later = find(run(world, cast, { frames: 60, t0: 31_100 }), 'a');
  assert.equal(later.portal, 0, `구멍이 안 닫힌다: ${later.portal}`);
});

test('떨어지는 중에 일을 받아도 착지한 자리에서 노트북을 편다', () => {
  const world = createWorld();
  const idle = strollCast(rooms(['proj', worker('a', 'idle')]));
  const born = find(stepStroll(world, idle, { w: W, h: H, now: 20_000, dt: 16, rng: () => 0.4 }), 'a');
  const spot = born.gy;

  const busy = strollCast(rooms(['proj', worker('a', 'typing')]));
  const pet = find(run(world, busy, { frames: 160, t0: 20_016 }), 'a');
  assert.equal(pet.act, 'work');
  assert.equal(Math.round(pet.y), Math.round(spot), `떨어지다 말고 공중에 앉았다: ${pet.y}`);
  assert.ok(pet.lap > 0.9, `노트북이 안 펴졌다: ${pet.lap}`);
});

test('일이 들어오면 걷다 말고 그 자리에서 노트북을 편다', () => {
  const world = createWorld();
  const idle = strollCast(rooms(['proj', worker('a', 'idle')]));
  run(world, idle, { frames: 700, rng: () => 0.1 });
  const before = find(stepStroll(world, idle, { w: W, h: H, now: 20_000, dt: 16 }), 'a').x;

  const busy = strollCast(rooms(['proj', worker('a', 'typing')]));
  const pets = run(world, busy, { frames: 60, t0: 20_100 });
  const pet = find(pets, 'a');
  assert.equal(pet.act, 'work');
  // **자리를 옮기지 않는다** — 일을 받았다고 어딘가로 걸어가 앉으면 그 순간을 놓친다
  assert.ok(Math.abs(pet.x - before) < 1, `앉으면서 움직였다: ${before} → ${pet.x}`);
  assert.ok(pet.lap > 0.9, `노트북이 안 펴졌다: ${pet.lap}`);
  assert.equal(pet.moving, false);
});

test('일이 끝나면 노트북을 접고 나서 걷는다 — 접는 동안은 자리를 안 뜬다', () => {
  const world = createWorld();
  const busy = strollCast(rooms(['proj', worker('a', 'typing')]));
  run(world, busy, { frames: 700, rng: () => 0.1 });
  const at = find(run(world, busy, { frames: 1, t0: 30_000 }), 'a').x;

  const idle = strollCast(rooms(['proj', worker('a', 'idle')]));
  // 접는 데 300ms — 그 절반쯤에서는 아직 노트북이 남아 있고 자리도 그대로다
  const mid = find(run(world, idle, { frames: 9, t0: 30_100 }), 'a');
  assert.equal(mid.act, 'work');
  assert.ok(mid.lap > 0 && mid.lap < 1, `접는 중이 아니다: ${mid.lap}`);
  assert.ok(Math.abs(mid.x - at) < 1, `접으면서 움직였다: ${at} → ${mid.x}`);

  const after = find(run(world, idle, { frames: 200, t0: 30_300 }), 'a');
  assert.equal(after.lap, 0);
  assert.ok(after.act === 'walk', `다시 안 걷는다: ${after.act}`);
});

test('일을 끝내면 접고 나서 폴짝 뛰고 기지개를 켠다 — 자리는 그대로다', () => {
  const world = createWorld();
  const busy = strollCast(rooms(['proj', worker('a', 'typing')]));
  run(world, busy, { frames: 700, rng: () => 0.1 });
  const at = find(run(world, busy, { frames: 1, t0: 40_000 }), 'a').x;

  // 일이 끝났다 — typing → idle이 산책에서 "끝난 순간"이다 (done은 명단에서 빠져 가라앉는다)
  const idle = strollCast(rooms(['proj', worker('a', 'idle')]));
  let hopped = null;
  let stretched = null;
  for (let i = 0; i < 200 && !stretched; i++) {
    const p = find(stepStroll(world, idle, { w: W, h: H, now: 40_016 + i * 16, dt: 16, rng: () => 0.5 }), 'a');
    if (p.act === 'hop') hopped = p;
    if (hopped && p.act === 'stretch') stretched = p;
  }
  assert.ok(hopped, '접고 나서 폴짝을 안 뛴다');
  assert.ok(stretched, '폴짝 뒤에 기지개가 없다');
  assert.ok(Math.abs(stretched.x - at) < 1, `자축하며 자리를 떴다: ${at} → ${stretched.x}`);
});

test('일이 대기로 바뀌면 자축하지 않는다 — 끝난 것이 아니라 나를 부르는 것이다', () => {
  const world = createWorld();
  const busy = strollCast(rooms(['proj', worker('a', 'typing')]));
  run(world, busy, { frames: 700, rng: () => 0.1 });

  const wait = strollCast(rooms(['proj', worker('a', 'waiting')]));
  for (let i = 0; i < 120; i++) {
    const p = find(stepStroll(world, wait, { w: W, h: H, now: 41_000 + i * 16, dt: 16 }), 'a');
    assert.notEqual(p.act, 'hop', '기다리라는데 폴짝 뛴다');
  }
  assert.equal(find(stepStroll(world, wait, { w: W, h: H, now: 43_000, dt: 16 }), 'a').act, 'halt');
});

test('자축 중에 일이 다시 들어오면 즉시 걷힌다', () => {
  const world = createWorld();
  const busy = strollCast(rooms(['proj', worker('a', 'typing')]));
  run(world, busy, { frames: 700, rng: () => 0.1 });

  const idle = strollCast(rooms(['proj', worker('a', 'idle')]));
  // 접기(300ms)가 끝나 폴짝이 시작된 참을 잡는다
  let t = 44_000;
  let p = null;
  for (let i = 0; i < 60; i++) {
    p = find(stepStroll(world, idle, { w: W, h: H, now: t + i * 16, dt: 16 }), 'a');
    if (p.act === 'hop') {
      t = t + i * 16;
      break;
    }
  }
  assert.equal(p.act, 'hop');

  const again = find(stepStroll(world, busy, { w: W, h: H, now: t + 16, dt: 16 }), 'a');
  assert.equal(again.act, 'work', '일을 받았는데 아직 자축 중이다');
  assert.equal(again.hop, 0, '공중에 뜬 채로 노트북을 폈다');
});

test('입력 대기는 멈춰 선다', () => {
  const world = createWorld();
  const cast = strollCast(rooms(['proj', worker('a', 'waiting')]));
  const pets = run(world, cast, { frames: 700, rng: () => 0.1 });
  const pet = find(pets, 'a');
  assert.equal(pet.act, 'halt');
  assert.equal(pet.moving, false);
});

test('집어 들면 커서를 따라오고, 놓으면 살짝 처졌다 선다', () => {
  const world = createWorld();
  const cast = strollCast(rooms(['proj', worker('a', 'idle')]));
  run(world, cast, { frames: 700, rng: () => 0.1 });

  // 잡고 화면 위쪽으로 끌어올린다
  const held = run(world, cast, { frames: 20, t0: 22_000, drag: () => ({ key: 'a', x: 120, y: 40 }) });
  const up = find(held, 'a');
  assert.equal(up.act, 'held');
  assert.equal(up.x, 120);
  assert.equal(up.y, 40);

  // 놓으면 **곧장 서지 않고 조금 처진다** — 놓은 자리에 딱 붙어 서면 손을 떠난 순간이 없다
  const dropped = find(run(world, cast, { frames: 2, t0: 22_400 }), 'a');
  assert.equal(dropped.act, 'drop');
  assert.ok(dropped.y > 40, `놓았는데 안 처진다: ${dropped.y}`);
  assert.equal(Math.round(dropped.x), 120, '옆으로 흘렀다');

  // 처지는 것은 잠깐이고 곧 선다. **놓은 자리 근처를 벗어나지 않는다**
  const stood = find(run(world, cast, { frames: 25, t0: 22_450 }), 'a');
  assert.equal(stood.act, 'land');
  assert.ok(stood.y > 40 && stood.y <= 40 + 16, `너무 멀리 떨어졌다: ${stood.y}`);

  // 멈칫이 끝나면 거기서부터 다시 걷는다 — 원래 있던 곳으로 되돌아가지 않는다
  const after = find(run(world, cast, { frames: 30, t0: 23_200 }), 'a');
  assert.equal(after.act, 'walk');
  assert.ok(Math.abs(after.y - 54) < 14, `놓은 높이를 버렸다: ${after.y}`);
});

test('흔들어 놓으면 어지러워하고, 그냥 옮기면 안 그렇다', () => {
  const world = createWorld();
  const cast = strollCast(rooms(['proj', worker('a', 'idle')]));
  run(world, cast, { frames: 60, rng: () => 0.4 });

  // 한 번에 옮기기만 한 경우 — 별이 돌면 자리를 바꿀 때마다 어지러운 셈이 된다
  run(world, cast, { frames: 10, t0: 60_000, drag: () => ({ key: 'a', x: 300, y: 90 }) });
  const calm = find(run(world, cast, { frames: 40, t0: 60_200 }), 'a');
  assert.notEqual(calm.act, 'dizzy');

  // 좌우로 흔든 경우. **놓고 나서 처지고(≈260ms) 서는(420ms) 것까지 지나야** 비틀거린다
  run(world, cast, { frames: 40, t0: 61_000, drag: (i) => ({ key: 'a', x: i % 2 ? 120 : 320, y: 90 }) });
  const shaken = find(run(world, cast, { frames: 60, t0: 61_700 }), 'a');
  assert.equal(shaken.act, 'dizzy', '흔들었는데 멀쩡하다');

  // 어지러움은 잠깐이고 곧 다시 걷는다
  const over = find(run(world, cast, { frames: 40, t0: 64_000 }), 'a');
  assert.notEqual(over.act, 'dizzy');
});

test('휙 놓으면 날아가 미끄러지다 서고, 세게 던져졌으면 어지럽다', () => {
  const world = createWorld();
  const cast = strollCast(rooms(['proj', worker('a', 'idle')]));
  run(world, cast, { frames: 700, rng: () => 0.1 });
  run(world, cast, { frames: 5, t0: 800_000, drag: () => ({ key: 'a', x: 80, y: 100 }) });
  assert.equal(throwPet(world, 'a', 0.9, 0), true, '문턱을 넘겼는데 안 던져진다');

  let flew = 0;
  let rose = 0;
  let sawDizzy = false;
  let pet = null;
  for (let i = 0; i < 400; i++) {
    pet = find(stepStroll(world, cast, { w: W, h: H, now: 800_100 + i * 16, dt: 16, rng: () => 0.5 }), 'a');
    if (pet.act === 'throw') {
      flew++;
      if (pet.hop > 0.3) rose++;
    }
    if (pet.act === 'dizzy') sawDizzy = true;
    assert.ok(pet.x >= 0 && pet.x <= W, `날다가 화면을 나갔다: ${pet.x}`);
  }
  assert.ok(flew > 10, `날지 않았다: ${flew}프레임`);
  assert.ok(rose > 3, '몸이 뜨지 않았다 — 던진 게 아니라 밀린 것이다');
  assert.ok(pet.x > 200, `던진 방향으로 안 갔다: ${pet.x}`);
  assert.ok(sawDizzy, '세게 던져졌는데 멀쩡하다');
  assert.equal(pet.hop, 0, '뜬 채로 끝난다');
});

test('살살 놓으면 던져지지 않는다 — 여느 놓기다', () => {
  const world = createWorld();
  const cast = strollCast(rooms(['proj', worker('a', 'idle')]));
  run(world, cast, { frames: 700, rng: () => 0.1 });
  run(world, cast, { frames: 5, t0: 900_000, drag: () => ({ key: 'a', x: 200, y: 100 }) });
  assert.equal(throwPet(world, 'a', 0.1, 0.05), false, '문턱 아래인데 던져졌다');
  const pet = find(run(world, cast, { frames: 2, t0: 900_100 }), 'a');
  assert.equal(pet.act, 'drop', '놓기로 안 이어진다');
});

test('가장자리로 던지면 튕겨서 화면 안에 남는다', () => {
  const area = strollArea(W, H);
  const world = createWorld();
  const cast = strollCast(rooms(['proj', worker('a', 'idle')]));
  run(world, cast, { frames: 700, rng: () => 0.1 });
  run(world, cast, { frames: 5, t0: 950_000, drag: () => ({ key: 'a', x: 30, y: 50 }) });
  // 상한(THROW_MAX)보다 센 값 — 왼쪽 위 모서리로 쏜다
  assert.equal(throwPet(world, 'a', -2.4, -1.8), true);
  for (let i = 0; i < 300; i++) {
    const pet = find(stepStroll(world, cast, { w: W, h: H, now: 950_100 + i * 16, dt: 16, rng: () => 0.5 }), 'a');
    assert.ok(pet.x >= area.x0 - 0.01 && pet.x <= area.x1 + 0.01, `옆으로 나갔다: ${pet.x}`);
    assert.ok(pet.y >= area.y0 - 0.01 && pet.y <= area.y1 + 0.01, `위아래로 나갔다: ${pet.y}`);
  }
});

test('일하거나 기다리는 중이면 흔들려도 어지러워하지 않는다', () => {
  const world = createWorld();
  const busy = strollCast(rooms(['proj', worker('a', 'typing')]));
  run(world, busy, { frames: 60, rng: () => 0.4 });
  run(world, busy, { frames: 40, t0: 70_000, drag: (i) => ({ key: 'a', x: i % 2 ? 120 : 320, y: 90 }) });
  const pet = find(run(world, busy, { frames: 60, t0: 70_700 }), 'a');
  // 무슨 상태인지가 장난에 가려지면 이 화면이 파는 유일한 것을 잃는다
  assert.equal(pet.act, 'work');
});

test('걸으면 자국이 남고 제 시간에 지워진다', () => {
  const world = createWorld();
  const cast = strollCast(rooms(['proj', worker('a', 'idle')]));
  const pet = find(run(world, cast, { frames: 120, rng: () => 0.4 }), 'a');
  // 쉬는 중일 수 있으므로 **걷게 세워 둔다** — 자국은 걸어야 남는 것이라 쉬는 참을 재면 안 된다
  pet.until = 0;
  pet.act = 'walk';
  pet.gx = W - 20;
  pet.gy = pet.y;
  run(world, cast, { frames: 90, t0: 20_000 });
  assert.ok(world.tracks.length > 0, '걸었는데 자국이 없다');
  // 쌓이기만 하면 화면이 자국으로 덮인다
  assert.ok(world.tracks.length <= 90, `자국이 너무 많다: ${world.tracks.length}`);

  const before = world.tracks.length;
  // 아무도 안 움직인 채로 시간만 흐르면 자국은 사라진다
  stepStroll(world, cast, { w: W, h: H, now: 60_000, dt: 16 });
  assert.ok(world.tracks.length < before, `자국이 안 지워진다: ${before} → ${world.tracks.length}`);
});

test('위아래로도 다닌다 — 아래쪽 띠에 붙어 있지 않는다', () => {
  const world = createWorld();
  const cast = strollCast(rooms(['proj', worker('a', 'idle')]));
  run(world, cast, { frames: 700, rng: () => 0.1 });

  const seen = new Set();
  let pets = [];
  for (let i = 0; i < 6000; i++) {
    pets = stepStroll(world, cast, { w: W, h: H, now: 80_000 + i * 16, dt: 16 });
    const pet = find(pets, 'a');
    if (pet) seen.add(Math.round(pet.y / 10));
  }
  // 높이가 한 자리에 묶여 있지 않아야 한다
  assert.ok(seen.size >= 4, `높이가 ${seen.size}가지뿐이다 — 아래쪽에 붙어 있다`);
  const ys = [...seen].map((k) => k * 10);
  assert.ok(Math.max(...ys) - Math.min(...ys) > H / 4, `오르내린 폭이 좁다: ${Math.min(...ys)}~${Math.max(...ys)}`);
});

test('세로가 가로보다 빠르지 않다 — 위아래로 미끄러지면 걸음이 아니다', () => {
  const world = createWorld();
  const cast = strollCast(rooms(['proj', worker('a', 'idle')]));
  run(world, cast, { frames: 700, rng: () => 0.1 });
  let prev = find(stepStroll(world, cast, { w: W, h: H, now: 90_000, dt: 16 }), 'a');
  let lastY = prev.y;
  for (let i = 1; i < 1500; i++) {
    const pet = find(stepStroll(world, cast, { w: W, h: H, now: 90_000 + i * 16, dt: 16 }), 'a');
    assert.ok(Math.abs(pet.y - lastY) <= 0.75, `세로로 튀었다: ${lastY} → ${pet.y}`);
    lastY = pet.y;
  }
});

test('목록에서 빠지면 발밑 구멍으로 가라앉아 사라진다', () => {
  const world = createWorld();
  const cast = strollCast(rooms(['proj', worker('a', 'idle')]));
  run(world, cast, { frames: 200, rng: () => 0.4 });
  const at = find(run(world, cast, { frames: 1, t0: 50_000 }), 'a');
  const spot = { x: at.x, y: at.y };

  const leaving = find(run(world, [], { frames: 2, t0: 50_016 }), 'a');
  assert.equal(leaving.act, 'sink', '그 자리에서 그냥 사라졌다');
  // 구멍은 **선 자리에** 열린다 — 어디론가 걸어가서 사라지면 눈이 놓친다
  assert.equal(Math.round(leaving.portalY), Math.round(spot.y));
  assert.equal(Math.round(leaving.x), Math.round(spot.x));

  // 구멍이 다 열릴 때까지는 잠기지 않는다
  const opening = find(run(world, [], { frames: 4, t0: 50_050 }), 'a');
  assert.equal(Math.round(opening.y), Math.round(spot.y), '구멍도 없는데 가라앉았다');

  // 잠기기 시작하면 아래로 내려간다
  const sinking = find(run(world, [], { frames: 12, t0: 50_300 }), 'a');
  assert.ok(sinking.y > spot.y, `안 가라앉는다: ${sinking.y}`);

  // 구멍이 닫히면 사라진다 — 화면 끝까지 걸어 나갈 때와 달리 1초면 끝난다
  const gone = run(world, [], { frames: 80, t0: 50_500 });
  assert.equal(find(gone, 'a'), null, '가라앉고도 남아 있다');
});

test('프레임 사이에 튀지 않는다 — 창이 가려졌다 돌아와도', () => {
  const world = createWorld();
  const cast = strollCast(rooms(['proj', worker('a', 'idle'), worker('b', 'idle')]));
  run(world, cast, { frames: 700, rng: () => 0.1 });

  let last = new Map(stepStroll(world, cast, { w: W, h: H, now: 60_000, dt: 16 }).map((p) => [p.key, p.x]));
  for (let i = 1; i < 400; i++) {
    // 5초를 통째로 건너뛴 프레임도 섞는다 (창이 가려져 rAF가 멈췄던 경우)
    const dt = i % 97 === 0 ? 5000 : 16;
    const pets = stepStroll(world, cast, { w: W, h: H, now: 60_000 + i * 16, dt });
    for (const p of pets) {
      const prev = last.get(p.key);
      // 뛸 때는 그만큼 더 간다(RUN_MULT) — 한 프레임 상한 64ms에 뛰는 속도를 곱한 값이다
      if (prev != null) assert.ok(Math.abs(p.x - prev) <= 2.8, `${p.key}가 튀었다: ${prev} → ${p.x}`);
      last.set(p.key, p.x);
    }
  }
});

test('화면 안에서만 걷는다', () => {
  const area = strollArea(W, H);
  const world = createWorld();
  const cast = strollCast(rooms(['proj', worker('a', 'idle'), worker('b', 'idle'), worker('c', 'idle')]));
  let pets = run(world, cast, { frames: 600 });
  for (let i = 0; i < 4000; i++) {
    pets = stepStroll(world, cast, { w: W, h: H, now: 70_000 + i * 16, dt: 16 });
    for (const p of pets) {
      if (p.act === 'in' || p.act === 'out') continue;
      assert.ok(p.x >= 0 && p.x <= W, `${p.key}가 화면을 벗어났다: ${p.x}`);
      // 위는 말풍선 몫, 아래는 노트북 몫을 남긴다 — 잘리면 무슨 상태인지가 안 보인다
      assert.ok(p.y >= area.y0 && p.y <= area.y1, `${p.key}의 발이 다닐 자리 밖이다: ${p.y}`);
    }
  }
});

test('여럿이면 서로 다른 높이로 들어온다', () => {
  const world = createWorld();
  const cast = strollCast(rooms(['proj', worker('a'), worker('b'), worker('c'), worker('d')]));
  // 들어오는 높이는 난수로 갈린다 — 고정 rng를 주면 넷이 한 줄에 겹친다
  let seed = 0;
  const rng = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);
  const pets = run(world, cast, { frames: 5, rng });
  assert.equal(new Set(pets.map((p) => Math.round(p.y))).size, 4, '넷이 같은 높이로 들어왔다');
});

test('클릭은 앞에 있는 게가 먼저 잡힌다', () => {
  const back = { key: 'back', x: 50, y: 100, lane: 2 };
  const front = { key: 'front', x: 50, y: 140, lane: 0 };
  // 그리는 순서는 y 오름차순(뒤 → 앞)이고, 짚는 것은 그 역순이어야 한다
  const hit = petAt([back, front], 50 * 2, 135 * 2, 2);
  assert.equal(hit.key, 'front');
});

test('클릭 판정은 스프라이트보다 조금 넉넉하다', () => {
  const pet = { key: 'a', x: 100, y: 50 };
  const box = petHitBox(pet, 2);
  assert.ok(box.w >= 32 && box.h >= 32, `12px 게를 정확히 짚으라고 한다: ${box.w}x${box.h}`);
  // 발밑은 잡히고 머리 위 한참은 안 잡힌다
  assert.ok(petAt([pet], 200, 98, 2));
  assert.equal(petAt([pet], 200, 20, 2), null);
});

test('마주 서면 말을 튼다 — 한 마디씩 주고받고 헤어진다', () => {
  const world = createWorld();
  const cast = strollCast(rooms(['proj', worker('a', 'idle'), worker('b', 'idle')]));
  run(world, cast, { frames: 120, rng: () => 0.4 });

  // 둘을 나란히 세워 둔다 (실제로도 목적지가 겹치면 이렇게 된다)
  const pets = stepStroll(world, cast, { w: W, h: H, now: 100_000, dt: 16 });
  for (const p of pets) {
    p.act = 'walk';
    p.moving = false;
    p.until = 200_000;
    p.y = 120;
    p.chatCool = 0;
  }
  pets[0].x = 100;
  pets[1].x = 108;

  const talking = stepStroll(world, cast, { w: W, h: H, now: 100_016, dt: 16 });
  assert.ok(
    talking.every((p) => p.talk),
    '가까이 섰는데 말을 안 튼다',
  );
  assert.equal(new Set(talking.map((p) => p.talk.pairKey)).size, 1, '서로 다른 상대와 말한다');
  assert.deepEqual(talking.map((p) => p.talk.role).sort(), [0, 1], '역할이 안 갈렸다');

  // 먼저 말하는 쪽이 있고, 그다음이 대답이다 — 둘이 동시에 떠들면 말풍선이 겹친다
  const first = talking.find((p) => p.talk.role === 0);
  const second = talking.find((p) => p.talk.role === 1);
  assert.ok(saying(first, 100_100), '먼저 말할 쪽이 조용하다');
  assert.equal(saying(second, 100_100), null, '둘이 동시에 떠든다');
  assert.ok(saying(second, 102_200), '대답이 없다');

  // 잡담은 끝난다
  const done = find(run(world, cast, { frames: 30, t0: 105_000 }), 'a');
  assert.equal(done.talk, null, '잡담이 안 끝난다');
});

test('일을 받으면 잡담이 즉시 걷힌다', () => {
  const world = createWorld();
  const idle = strollCast(rooms(['proj', worker('a', 'idle'), worker('b', 'idle')]));
  run(world, idle, { frames: 120, rng: () => 0.4 });
  const pets = stepStroll(world, idle, { w: W, h: H, now: 110_000, dt: 16 });
  for (const p of pets) {
    p.act = 'walk';
    p.moving = false;
    p.until = 200_000;
    p.y = 120;
    p.chatCool = 0;
  }
  pets[0].x = 100;
  pets[1].x = 108;
  stepStroll(world, idle, { w: W, h: H, now: 110_016, dt: 16 });

  const busy = strollCast(rooms(['proj', worker('a', 'typing'), worker('b', 'idle')]));
  const pet = find(stepStroll(world, busy, { w: W, h: H, now: 110_032, dt: 16 }), 'a');
  assert.equal(pet.talk, null, '일을 받았는데 아직 떠든다');
  assert.equal(pet.act, 'work');
});

test('커서가 가까이 오면 멈춰 쳐다보고, 곧 제 갈 길을 간다', () => {
  const world = createWorld();
  const cast = strollCast(rooms(['proj', worker('a', 'idle')]));
  const pet = find(run(world, cast, { frames: 120, rng: () => 0.4 }), 'a');
  pet.until = 0;
  pet.act = 'walk';
  pet.gx = W - 20;
  pet.gy = pet.y;

  const at = { x: pet.x + 4, y: pet.y - 6 };
  const looking = find(
    stepStroll(world, cast, { w: W, h: H, now: 120_000, dt: 16, pointer: at }),
    'a',
  );
  assert.equal(looking.act, 'look');
  assert.equal(looking.moving, false);

  // 커서가 계속 옆에 있어도 잠깐이면 다시 걷는다 — 마우스를 놓아 두었다고 굳으면 안 된다
  let last = null;
  for (let i = 0; i < 130; i++) {
    last = find(stepStroll(world, cast, { w: W, h: H, now: 120_016 + i * 16, dt: 16, pointer: at }), 'a');
  }
  assert.notEqual(last.act, 'look', '커서 옆에서 영영 굳었다');
});

test('일하는 게는 커서가 와도 쳐다보지 않는다', () => {
  const world = createWorld();
  const busy = strollCast(rooms(['proj', worker('a', 'typing')]));
  const pet = find(run(world, busy, { frames: 200, rng: () => 0.4 }), 'a');
  const at = { x: pet.x, y: pet.y - 6 };
  const still = find(stepStroll(world, busy, { w: W, h: H, now: 130_000, dt: 16, pointer: at }), 'a');
  assert.equal(still.act, 'work');
});

test('오래 할 일이 없으면 기지개를 켜거나 존다', () => {
  const world = createWorld();
  const cast = strollCast(rooms(['proj', worker('a', 'idle')]));
  run(world, cast, { frames: 120, rng: () => 0.4 });

  // 한참 지난 뒤 다음 목적지를 고르려는 참
  let pet = null;
  for (let i = 0; i < 40; i++) {
    pet = find(stepStroll(world, cast, { w: W, h: H, now: 300_000 + i * 16, dt: 16, rng: () => 0.9 }), 'a');
    if (pet.act === 'stretch' || pet.act === 'nap') break;
  }
  assert.ok(pet.act === 'stretch' || pet.act === 'nap', `안 쉰다: ${pet.act}`);

  // 일이 들어오면 벌떡 일어난다
  const busy = strollCast(rooms(['proj', worker('a', 'typing')]));
  const up = find(stepStroll(world, busy, { w: W, h: H, now: 300_700, dt: 16 }), 'a');
  assert.equal(up.act, 'work', '자다가 일을 못 받는다');
});

test('심야에는 기지개 대신 존다 — 시간대가 쉬는 모습을 정한다', () => {
  const world = createWorld();
  const cast = strollCast(rooms(['proj', worker('a', 'idle')]));
  // 시각은 로컬 필드로 만든다 — epoch 상수를 쓰면 CI(UTC)와 내 자리(KST)의 시간대가 갈린다
  const NIGHT = new Date(2026, 0, 6, 3, 0, 0).getTime();
  run(world, cast, { frames: 120, t0: NIGHT, rng: () => 0.6 });

  // rng 0.6은 낮이면 기지개(0.6 ≥ 0.45)인데 심야에는 낮잠(0.6 < 0.8)이다
  let pet = null;
  for (let i = 0; i < 3000 && pet?.act !== 'nap'; i++) {
    pet = find(stepStroll(world, cast, { w: W, h: H, now: NIGHT + 62_000 + i * 16, dt: 16, rng: () => 0.6 }), 'a');
    assert.notEqual(pet.act, 'stretch', '심야인데 기지개를 골랐다');
  }
  assert.equal(pet.act, 'nap', '심야인데 안 존다');
});

test('점심에는 캔을 홀짝이기도 하고, 다 마시면 다시 걷는다', () => {
  const world = createWorld();
  const cast = strollCast(rooms(['proj', worker('a', 'idle')]));
  const LUNCH = new Date(2026, 0, 6, 13, 0, 0).getTime();
  run(world, cast, { frames: 120, t0: LUNCH, rng: () => 0.4 });

  // rng 0.4는 점심이면 캔(0.4 < 0.5)이고, 캔이 없는 시간대라면 낮잠(0.4 < 0.45)이 됐을 값이다
  let t = LUNCH + 62_000;
  let pet = null;
  for (let i = 0; i < 3000 && pet?.act !== 'sip'; i++) {
    pet = find(stepStroll(world, cast, { w: W, h: H, now: t + i * 16, dt: 16, rng: () => 0.4 }), 'a');
    if (pet.act === 'sip') t = t + i * 16;
  }
  assert.equal(pet?.act, 'sip', '점심인데 캔을 안 든다');

  const after = find(stepStroll(world, cast, { w: W, h: H, now: t + 6000, dt: 16, rng: () => 0.99 }), 'a');
  assert.notEqual(after.act, 'sip', '캔을 영영 들고 있다');
});

test('아침에는 캔이 안 나온다', () => {
  const world = createWorld();
  const cast = strollCast(rooms(['proj', worker('a', 'idle')]));
  const MORNING = new Date(2026, 0, 6, 10, 0, 0).getTime();
  run(world, cast, { frames: 120, t0: MORNING, rng: () => 0.4 });
  for (let i = 0; i < 3000; i++) {
    const pet = find(stepStroll(world, cast, { w: W, h: H, now: MORNING + 62_000 + i * 16, dt: 16, rng: () => 0.4 }), 'a');
    assert.notEqual(pet.act, 'sip', '아침부터 캔을 든다');
  }
});

test('캔을 들고 있다가도 일이 들어오면 즉시 노트북을 편다', () => {
  const world = createWorld();
  const cast = strollCast(rooms(['proj', worker('a', 'idle')]));
  const LUNCH = new Date(2026, 0, 6, 13, 0, 0).getTime();
  run(world, cast, { frames: 120, t0: LUNCH, rng: () => 0.4 });
  let pet = null;
  let t = LUNCH + 62_000;
  for (let i = 0; i < 3000 && pet?.act !== 'sip'; i++) {
    pet = find(stepStroll(world, cast, { w: W, h: H, now: t + i * 16, dt: 16, rng: () => 0.4 }), 'a');
    if (pet.act === 'sip') t = t + i * 16;
  }
  assert.equal(pet?.act, 'sip');

  const busy = strollCast(rooms(['proj', worker('a', 'typing')]));
  const up = find(stepStroll(world, busy, { w: W, h: H, now: t + 16, dt: 16 }), 'a');
  assert.equal(up.act, 'work', '캔 마시느라 일을 못 받는다');
});

test('만남을 만들러 간다 — 가끔 다른 게 옆을 목적지로 잡는다', () => {
  const world = createWorld();
  const cast = strollCast(rooms(['proj', worker('a', 'idle'), worker('b', 'idle')]));
  run(world, cast, { frames: 200, rng: () => 0.4 });

  // 목적지를 여러 번 고르게 하고, 그중 상대 근처를 고른 적이 있는지 본다.
  // 각자 아무 데나 다니면 넓은 화면에서 마주칠 일이 없어 잡담도 술래잡기도 안 일어난다.
  // 난수를 낮게 고정하면 목적지를 고를 때마다 "찾아가기"를 탄다 — 확률에 기대면 가끔 샌다
  let visited = 0;
  for (let i = 0; i < 400; i++) {
    const pets = stepStroll(world, cast, { w: W, h: H, now: 400_000 + i * 16, dt: 16, rng: () => 0.2 });
    for (const p of pets) {
      const other = pets.find((q) => q !== p);
      if (other && Math.hypot(p.gx - other.x, p.gy - other.y) < 26) visited++;
    }
  }
  assert.ok(visited > 0, '서로를 찾아가지 않는다');
});

test('폴짝 뛰면 떴다 내려온다', () => {
  const world = createWorld();
  const cast = strollCast(rooms(['proj', worker('a', 'idle')]));
  const pet = find(run(world, cast, { frames: 120, rng: () => 0.4 }), 'a');
  pet.act = 'hop';
  pet.hopAt = 500_000;
  pet.hop = 0;

  const mid = find(stepStroll(world, cast, { w: W, h: H, now: 500_190, dt: 16 }), 'a');
  assert.ok(mid.hop > 0.9, `안 뜬다: ${mid.hop}`);
  assert.equal(mid.act, 'hop');

  const done = find(stepStroll(world, cast, { w: W, h: H, now: 500_400, dt: 16 }), 'a');
  assert.equal(done.hop, 0, '뜬 채로 끝난다');
  assert.notEqual(done.act, 'hop');
});

test('상자 안의 게만 고른다', () => {
  const pets = [
    { key: 'in', x: 100, y: 100 },
    { key: 'edge', x: 140, y: 100 },
    { key: 'far', x: 300, y: 100 },
    { key: 'above', x: 100, y: 40 },
  ];
  const picked = petsInBox(pets, { x0: 80, y0: 80, x1: 150, y1: 110 }).map((p) => p.key);
  assert.ok(picked.includes('in'));
  assert.ok(picked.includes('edge'));
  assert.ok(!picked.includes('far'), '상자 밖인데 잡혔다');
  assert.ok(!picked.includes('above'), '상자 위인데 잡혔다');

  // 거꾸로 그린 상자도 같아야 한다 — 오른쪽 아래에서 왼쪽 위로 끄는 사람이 있다
  const flipped = petsInBox(pets, { x0: 150, y0: 110, x1: 80, y1: 80 }).map((p) => p.key);
  assert.deepEqual(flipped.sort(), picked.sort());
});

test('부른 자리로 걸어가고, 도착하면 명령이 풀린다', () => {
  const world = createWorld();
  const cast = strollCast(rooms(['proj', worker('a', 'idle')]));
  run(world, cast, { frames: 120, rng: () => 0.4 });

  const n = orderMove(world, ['a'], 60, 150, W, H);
  assert.equal(n, 1);
  const pet = world.pets.get('a');
  assert.ok(pet.order, '명령이 안 실렸다');

  const walking = find(run(world, cast, { frames: 20, t0: 500_000 }), 'a');
  assert.equal(walking.act, 'walk');
  assert.ok(walking.moving, '부르는데 안 움직인다');

  // **명령이 풀리는 순간을 잡는다** — 그 뒤로는 자유 산책이라 어디로 가 있든 상관없다
  let arrived = null;
  for (let i = 0; i < 2000 && !arrived; i++) {
    const p = find(stepStroll(world, cast, { w: W, h: H, now: 500_400 + i * 16, dt: 16 }), 'a');
    if (!p.order) arrived = p;
  }
  assert.ok(arrived, '부른 자리에 영영 못 간다');
  assert.ok(Math.hypot(arrived.x - 60, arrived.y - 150) < 8, `엉뚱한 데 섰다: ${arrived.x},${arrived.y}`);
});

test('여럿을 부르면 겹치지 않게 흩어 선다', () => {
  const world = createWorld();
  const cast = strollCast(rooms(['proj', worker('a'), worker('b'), worker('c'), worker('d')]));
  run(world, cast, { frames: 120, rng: () => 0.4 });

  orderMove(world, ['a', 'b', 'c', 'd'], 200, 120, W, H);
  const goals = ['a', 'b', 'c', 'd'].map((k) => world.pets.get(k).order);
  const seen = new Set(goals.map((g) => `${Math.round(g.gx)},${Math.round(g.gy)}`));
  assert.equal(seen.size, 4, '넷이 같은 점으로 간다');
  // 그래도 부른 자리 근처여야 한다
  for (const g of goals) assert.ok(Math.hypot(g.gx - 200, g.gy - 120) < 40, `너무 멀리 흩어졌다: ${g.gx},${g.gy}`);
});

test('일하는 게도 부르면 노트북을 접고 간다 — 도착하면 다시 편다', () => {
  const world = createWorld();
  const busy = strollCast(rooms(['proj', worker('a', 'typing')]));
  run(world, busy, { frames: 200, rng: () => 0.4 });
  const before = find(run(world, busy, { frames: 1, t0: 600_000 }), 'a');
  assert.equal(before.act, 'work');
  assert.ok(before.lap > 0.9);

  orderMove(world, ['a'], 40, 160, W, H);
  const moving = find(run(world, busy, { frames: 40, t0: 600_016 }), 'a');
  assert.equal(moving.act, 'walk', '부르는데 앉아 있다');
  assert.ok(moving.lap < 0.5, `노트북을 안 접었다: ${moving.lap}`);

  // 도착하면 다시 일한다 — 이동 때문에 상태가 영영 가려지지는 않는다
  const back = find(run(world, busy, { frames: 2000, t0: 601_000 }), 'a');
  assert.equal(back.act, 'work');
  assert.ok(back.lap > 0.9, `도착했는데 노트북을 안 편다: ${back.lap}`);
});

test('부른 게는 노는 데 끼지 않는다', () => {
  const world = createWorld();
  const cast = strollCast(rooms(['proj', worker('a', 'idle'), worker('b', 'idle')]));
  run(world, cast, { frames: 120, rng: () => 0.4 });
  const pets = stepStroll(world, cast, { w: W, h: H, now: 700_000, dt: 16 });
  for (const p of pets) {
    p.act = 'walk';
    p.moving = false;
    p.until = 800_000;
    p.y = 120;
    p.chatCool = 0;
  }
  pets[0].x = 100;
  pets[1].x = 106;
  orderMove(world, [pets[0].key], 300, 150, W, H);

  const after = stepStroll(world, cast, { w: W, h: H, now: 700_016, dt: 16 });
  assert.ok(
    after.every((p) => !p.talk),
    '부른 게가 잡담에 붙잡혔다',
  );
});
