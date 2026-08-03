// 만진 파일 수·편집 횟수 (main/files.mjs).
//
// 엔트리 이름이 `<경로해시>@v<버전>`이라 파일 **이름**은 못 얻는다. 셀 수 있는 것은
// distinct 해시(파일 수)와 엔트리 총수(편집 횟수)까지다.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'office-files-'));
process.env.CLAUDE_CONFIG_DIR = root;
const { readTouchedFiles } = await import('../main/files.mjs');

const histDir = (sid) => path.join(root, 'file-history', sid);

function put(sid, entries) {
  const dir = histDir(sid);
  fs.mkdirSync(dir, { recursive: true });
  for (const name of entries) fs.writeFileSync(path.join(dir, name), 'file contents');
}

before(() => {
  // 실측한 이름 모양 그대로 — 파일 셋을 고쳤고 그중 둘은 두 번씩
  put('busy', [
    '06baf9de0651d69c@v1',
    '06baf9de0651d69c@v2',
    '09c6f430208bb397@v1',
    '09c6f430208bb397@v2',
    '09c6f430208bb397@v3',
    'f5a4d38335dc9c58@v1',
  ]);
  put('one', ['abcdef0123456789@v1']);
  // 잠금·표식 파일만 있는 방
  fs.mkdirSync(histDir('marks'), { recursive: true });
  fs.writeFileSync(path.join(histDir('marks'), '.lock'), '');
});

after(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

test('파일 수와 편집 횟수를 센다', async () => {
  const got = await readTouchedFiles('busy');
  assert.equal(got.files, 3); // distinct 해시
  assert.equal(got.edits, 6); // 엔트리 총수(버전 수)
  assert.equal(typeof got.at, 'number');
});

test('하나만 고쳤으면 하나로 센다', async () => {
  const got = await readTouchedFiles('one');
  assert.deepEqual({ files: got.files, edits: got.edits }, { files: 1, edits: 1 });
});

test('아무것도 안 고친 세션은 null이다', async () => {
  assert.equal(await readTouchedFiles('no-such-session'), null);
  assert.equal(await readTouchedFiles(''), null);
  assert.equal(await readTouchedFiles(null), null);
  // 점으로 시작하는 표식 파일은 세지 않으므로 이것도 null이다
  assert.equal(await readTouchedFiles('marks'), null);
});

test('편집이 늘면 다시 읽는다', async () => {
  const before2 = await readTouchedFiles('busy');
  assert.equal(before2.edits, 6);

  // 편집은 기존 엔트리를 덮어쓰지 않고 **새 버전을 추가**한다 — 추가는 디렉터리 mtime을 바꾸므로
  // 여기서는 디렉터리 mtime을 캐시 열쇠로 써도 된다(할 일 목록과 다른 점이다).
  fs.writeFileSync(path.join(histDir('busy'), 'f5a4d38335dc9c58@v2'), 'x');
  const later = new Date(Date.now() + 5000);
  fs.utimesSync(histDir('busy'), later, later);

  const after2 = await readTouchedFiles('busy');
  assert.equal(after2.edits, 7);
  assert.equal(after2.files, 3); // 같은 파일의 새 버전이라 파일 수는 그대로
});

test('@ 없는 엔트리도 파일 하나로 센다', async () => {
  // 이름 규칙이 바뀌어도 개수는 나와야 한다 — 0이 되는 것보다 낫다
  put('odd', ['plainname']);
  const got = await readTouchedFiles('odd');
  assert.deepEqual({ files: got.files, edits: got.edits }, { files: 1, edits: 1 });
});
