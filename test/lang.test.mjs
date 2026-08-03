// 사전 두 파일의 키 모양이 같은가 (shared/lang/*.mjs).
//
// 문서에 "두 파일의 키 모양이 같아야 하고, en이 없는 키의 대체값이다"라고 적혀 있는데 그걸
// 지키는 검사가 없었다. 없는 키는 t()가 **키 문자열을 그대로** 돌려주므로 화면에
// `att.tab.mine`이 적히는 것으로만 드러난다 — 눈으로 볼 때까지 조용하다.
//
// 실제로 #97 작업 중에 ko의 `att.tab.mine`이 사라진 것을 이 검사로 잡았다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import ko from '../shared/lang/ko.mjs';
import en from '../shared/lang/en.mjs';

// 대사 목록(배열)은 언어마다 길이가 달라도 되므로 잎으로 본다.
function keysOf(obj, prefix = '') {
  return Object.entries(obj).flatMap(([k, v]) =>
    v && typeof v === 'object' && !Array.isArray(v) ? keysOf(v, `${prefix}${k}.`) : [`${prefix}${k}`],
  );
}

const koKeys = new Set(keysOf(ko));
const enKeys = new Set(keysOf(en));

test('한국어에만 있는 키가 없다', () => {
  // en은 대체값이므로 en에 없는 키는 다른 언어에서도 못 쓴다
  assert.deepEqual([...koKeys].filter((k) => !enKeys.has(k)), []);
});

test('영어에만 있는 키가 없다', () => {
  // 이쪽이 비면 한국어 화면에 키 문자열이 그대로 뜬다
  assert.deepEqual([...enKeys].filter((k) => !koKeys.has(k)), []);
});

test('같은 키의 자리 표시자도 같다', () => {
  // `{n}`을 한쪽에서 빼먹으면 그 언어에서만 숫자가 사라진다
  const holes = (s) => (typeof s === 'string' ? [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort() : []);
  const dig = (obj, key) => key.split('.').reduce((cur, part) => cur?.[part], obj);
  const bad = [];
  for (const key of koKeys) {
    const a = holes(dig(ko, key));
    const b = holes(dig(en, key));
    if (a.join(',') !== b.join(',')) bad.push(`${key}: ko{${a}} en{${b}}`);
  }
  assert.deepEqual(bad, []);
});

test('빈 문구가 없다', () => {
  // 빈 문자열은 화면에 아무것도 안 나오는 것과 같아 조용히 사라진다
  const bad = [];
  for (const [dict, name] of [
    [ko, 'ko'],
    [en, 'en'],
  ]) {
    const dig = (obj, key) => key.split('.').reduce((cur, part) => cur?.[part], obj);
    for (const key of keysOf(dict)) {
      const v = dig(dict, key);
      if (typeof v === 'string' && v.trim() === '') bad.push(`${name}:${key}`);
      if (Array.isArray(v) && v.length === 0) bad.push(`${name}:${key} (빈 목록)`);
    }
  }
  assert.deepEqual(bad, []);
});
