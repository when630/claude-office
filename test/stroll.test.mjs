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

const { createWorld, stepStroll, strollCast, wantAct, petAt, petHitBox, strollArea, STROLL_MAX } = await import(
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

test('모드를 켜는 순간 있던 세션은 걸어 들어오지 않는다', () => {
  const world = createWorld();
  // 산책으로 갈아타는 것은 "지금 사무실을 내놓는" 일이다 — 일하던 게가 화면 밖에서
  // 걸어 들어오는 동안 노트북을 안 펴고 있으면 그건 지금 상태가 아니다
  const cast = strollCast(rooms(['proj', worker('a', 'typing'), worker('b', 'idle')]));
  const pets = stepStroll(world, cast, { w: W, h: H, now: 10_000, dt: 16, rng: () => 0.4 });
  for (const p of pets) {
    assert.notEqual(p.act, 'in', `${p.key}가 밖에서 걸어 들어온다`);
    assert.ok(p.x > 0 && p.x < W, `${p.key}가 화면 밖에 있다: ${p.x}`);
  }
  // 그리고 일하던 것은 곧장 노트북을 편다
  const busy = find(run(world, cast, { frames: 60, t0: 10_100 }), 'a');
  assert.equal(busy.act, 'work');
  assert.ok(busy.lap > 0.9, `노트북이 안 펴졌다: ${busy.lap}`);
});

test('나중에 합류한 세션은 화면 밖에서 걸어 들어온다', () => {
  const world = createWorld();
  const none = [];
  stepStroll(world, none, { w: W, h: H, now: 10_000, dt: 16 });

  const cast = strollCast(rooms(['proj', worker('a', 'idle')]));
  const first = find(stepStroll(world, cast, { w: W, h: H, now: 10_016, dt: 16, rng: () => 0.1 }), 'a');
  assert.equal(first.act, 'in');
  assert.ok(first.x < 0 || first.x > W, `화면 안에서 나타났다: ${first.x}`);

  const pet = find(run(world, cast, { frames: 700, t0: 10_100, rng: () => 0.1 }), 'a');
  assert.ok(pet.x > 0 && pet.x < W, `화면 안으로 못 들어왔다: ${pet.x}`);
  assert.notEqual(pet.act, 'in');
});

test('걸어 들어오는 중에 일을 받으면 그 자리에서 노트북을 편다', () => {
  const world = createWorld();
  stepStroll(world, [], { w: W, h: H, now: 20_000, dt: 16 });
  const idle = strollCast(rooms(['proj', worker('a', 'idle')]));
  // 화면 안으로 발을 들일 만큼만 걷게 둔다
  const walking = find(run(world, idle, { frames: 120, t0: 20_016, rng: () => 0.1 }), 'a');
  assert.equal(walking.act, 'in');
  assert.ok(walking.x > 0, `아직 화면 밖이다: ${walking.x}`);
  const at = walking.x;

  const busy = strollCast(rooms(['proj', worker('a', 'typing')]));
  const pet = find(run(world, busy, { frames: 60, t0: 22_000 }), 'a');
  assert.equal(pet.act, 'work', '등장을 끝까지 마치느라 일을 못 받았다');
  assert.ok(Math.abs(pet.x - at) < 2, `일을 받고도 더 걸어갔다: ${at} → ${pet.x}`);
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

test('입력 대기는 멈춰 선다', () => {
  const world = createWorld();
  const cast = strollCast(rooms(['proj', worker('a', 'waiting')]));
  const pets = run(world, cast, { frames: 700, rng: () => 0.1 });
  const pet = find(pets, 'a');
  assert.equal(pet.act, 'halt');
  assert.equal(pet.moving, false);
});

test('집어 들면 커서를 따라오고, 놓으면 그 자리에 선다', () => {
  const world = createWorld();
  const cast = strollCast(rooms(['proj', worker('a', 'idle')]));
  run(world, cast, { frames: 700, rng: () => 0.1 });

  // 잡고 화면 위쪽으로 끌어올린다
  const held = run(world, cast, { frames: 20, t0: 40_000, drag: () => ({ key: 'a', x: 120, y: 40 }) });
  const up = find(held, 'a');
  assert.equal(up.act, 'held');
  assert.equal(up.x, 120);
  assert.equal(up.y, 40);

  // 놓는다 — **떨어지지 않는다.** 위아래로 자유롭게 다니는 화면에는 바닥이 없다
  const dropped = find(run(world, cast, { frames: 2, t0: 40_400 }), 'a');
  assert.equal(dropped.act, 'land');
  assert.equal(Math.round(dropped.y), 40, `놓았는데 자리가 움직였다: ${dropped.y}`);
  assert.equal(Math.round(dropped.x), 120);

  // 멈칫하는 동안에도 그 자리다
  const still = find(run(world, cast, { frames: 10, t0: 40_500 }), 'a');
  assert.equal(Math.round(still.y), 40);

  // 멈칫이 끝나면 거기서부터 다시 걷는다 — 원래 있던 곳으로 되돌아가지 않는다
  const after = find(run(world, cast, { frames: 30, t0: 41_000 }), 'a');
  assert.equal(after.act, 'walk');
  assert.ok(Math.abs(after.y - 40) < 12, `놓은 높이를 버렸다: ${after.y}`);
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

test('목록에서 빠지면 화면 밖으로 걸어 나간 뒤에 사라진다', () => {
  const world = createWorld();
  const cast = strollCast(rooms(['proj', worker('a', 'idle')]));
  run(world, cast, { frames: 700, rng: () => 0.1 });

  const leaving = find(run(world, [], { frames: 2, t0: 50_000 }), 'a');
  assert.equal(leaving.act, 'out', '그 자리에서 사라졌다');

  const gone = run(world, [], { frames: 3000, t0: 50_100 });
  assert.equal(find(gone, 'a'), null, '나가고도 남아 있다');
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
      if (prev != null) assert.ok(Math.abs(p.x - prev) <= 1.2, `${p.key}가 튀었다: ${prev} → ${p.x}`);
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
