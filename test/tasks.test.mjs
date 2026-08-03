// 세션이 세운 할 일 목록 읽기 (main/tasks.mjs).
//
// CLAUDE_CONFIG_DIR을 임시 폴더로 돌려놓고 파일을 직접 깔아 확인한다 — paths.mjs가 import 시점에
// 환경변수를 읽으므로 **env를 세운 뒤에 동적 import**해야 한다.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'office-tasks-'));
process.env.CLAUDE_CONFIG_DIR = root;
const { readTasks } = await import('../main/tasks.mjs');

const tasksDir = (sid) => path.join(root, 'tasks', sid);

function put(sid, items) {
  const dir = tasksDir(sid);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, '.lock'), '');
  fs.writeFileSync(path.join(dir, '.highwatermark'), String(items.length));
  for (const it of items) {
    fs.writeFileSync(
      path.join(dir, `${it.id}.json`),
      JSON.stringify({ description: '', activeForm: `${it.subject} 중`, blocks: [], blockedBy: [], ...it }),
    );
  }
}

before(() => {
  // 실측한 세 가지 상태와 열 개를 넘는 id — 문자열 정렬이면 11이 2보다 앞에 온다
  put('with-todos', [
    { id: '1', subject: '설계', status: 'completed' },
    { id: '2', subject: '구현', status: 'in_progress' },
    { id: '3', subject: '검증', status: 'pending', blockedBy: ['2'] },
    { id: '4', subject: '문서', status: 'pending', blockedBy: ['1'] },
    { id: '11', subject: '릴리스', status: 'pending' },
  ]);
  // 실측 32개 중 28개가 이 꼴이었다 — 잠금 파일만 있고 항목이 없다
  fs.mkdirSync(tasksDir('empty'), { recursive: true });
  fs.writeFileSync(path.join(tasksDir('empty'), '.lock'), '');
  fs.writeFileSync(path.join(tasksDir('empty'), '.highwatermark'), '0');
});

after(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

test('할 일이 없는 세션은 null이다', async () => {
  // 디렉터리가 아예 없는 쪽과 잠금 파일만 있는 쪽 둘 다
  assert.equal(await readTasks('no-such-session'), null);
  assert.equal(await readTasks('empty'), null);
  assert.equal(await readTasks(''), null);
  assert.equal(await readTasks(null), null);
});

test('머릿수를 세고 id 순서를 지킨다', async () => {
  const got = await readTasks('with-todos');
  assert.equal(got.total, 5);
  assert.equal(got.done, 1);
  // 11이 마지막이어야 한다 — 문자열 정렬이면 '11' < '2'라 둘째로 올라온다
  assert.deepEqual(
    got.items.map((i) => i.id),
    ['1', '2', '3', '4', '11'],
  );
});

test('진행 중인 항목만 active로 올라온다', async () => {
  const got = await readTasks('with-todos');
  assert.deepEqual(
    got.active.map((a) => a.id),
    ['2'],
  );
  // activeForm은 말풍선에 그대로 실려 나가는 값이다
  assert.equal(got.active[0].activeForm, '구현 중');
});

test('막힌 항목은 안 끝난 것만 센다', async () => {
  const got = await readTasks('with-todos');
  const byId = new Map(got.items.map((i) => [i.id, i]));
  // 2는 아직 in_progress라 3은 막혀 있다
  assert.deepEqual(byId.get('3').blockedBy, ['2']);
  // 1은 completed이므로 4는 막힌 게 아니다
  assert.deepEqual(byId.get('4').blockedBy, []);
  assert.equal(got.blocked, 1);
});

test('제자리에서 다시 쓴 파일도 다시 읽는다', async () => {
  // NTFS는 있는 파일을 덮어써도 **디렉터리 mtime을 안 바꾼다.** status가 바뀌는 것은 항목 추가가
  // 아니라 제자리 덮어쓰기라, 디렉터리만 캐시 열쇠로 삼으면 이 전이를 영원히 못 본다.
  const before = await readTasks('with-todos');
  assert.equal(before.done, 1);

  const file = path.join(tasksDir('with-todos'), '2.json');
  const item = JSON.parse(fs.readFileSync(file, 'utf8'));
  fs.writeFileSync(file, JSON.stringify({ ...item, status: 'completed' }));
  // mtime 해상도가 거칠어 같은 값이 나올 수 있으니 명시적으로 밀어 둔다
  const later = new Date(Date.now() + 5000);
  fs.utimesSync(file, later, later);

  const after2 = await readTasks('with-todos');
  assert.equal(after2.done, 2);
  assert.deepEqual(after2.active, []);
  // 2가 끝났으니 3은 더 이상 막혀 있지 않다
  assert.equal(after2.blocked, 0);
});

test('반쪽 파일은 조용히 버린다', async () => {
  // 쓰는 도중에 읽으면 JSON이 잘려 있다 — 그것 때문에 목록 전체가 사라지면 안 된다
  fs.writeFileSync(path.join(tasksDir('with-todos'), '12.json'), '{"id":"12","subj');
  const got = await readTasks('with-todos');
  assert.equal(got.total, 5);
  assert.ok(!got.items.some((i) => i.id === '12'));
});
