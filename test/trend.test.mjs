// 하루 단위 대기 추이 (main/history.mjs의 dailyTrend).
//
// 시각을 인자로 받으므로 하루를 기다리지 않고 확인한다. 핵심은 **앱을 안 켠 날과 0인 날이
// 구분되는가**다 — 안 켠 날을 0으로 그리면 "그날은 아무도 안 기다렸다"는 거짓말이 된다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dailyTrend, dayStart, bootEvent } from '../main/history.mjs';

const MIN = 60_000;
// 오늘 15시로 못 박는다 — 자정 근처에서 돌아도 결과가 흔들리지 않게
const NOW = new Date(2026, 6, 31, 15, 0, 0).getTime();
const day = (i) => dayStart(NOW, i);

test('7일치를 오래된 날부터 돌려준다', () => {
  const got = dailyTrend([bootEvent(day(3) + MIN)], { days: 7, now: NOW });
  assert.equal(got.length, 7);
  assert.equal(got[0].at, day(6));
  assert.equal(got[6].at, day(0));
});

test('그 날 기다린 시간만 담는다', () => {
  // 어제 10분 기다리고 답했다
  const events = [
    bootEvent(day(1) + 60 * MIN),
    { at: day(1) + 61 * MIN, ev: 'on', key: 'k', room: 'r', mood: 'idle' },
    { at: day(1) + 62 * MIN, ev: 'mood', key: 'k', room: 'r', mood: 'waiting' },
    { at: day(1) + 72 * MIN, ev: 'mood', key: 'k', room: 'r', mood: 'typing' },
    { at: day(1) + 80 * MIN, ev: 'off', key: 'k', room: 'r' },
  ];
  const got = dailyTrend(events, { days: 7, now: NOW });
  const yesterday = got.find((d) => d.at === day(1));
  assert.equal(Math.round(yesterday.waitMs / MIN), 10);
  assert.equal(Math.round(yesterday.busyMs / MIN), 8);
  assert.ok(yesterday.observed);
});

test('앱을 안 켠 날과 0인 날이 다르다', () => {
  // 이틀 전에만 앱을 켰고 아무도 안 기다렸다
  const events = [bootEvent(day(2) + 30 * MIN)];
  const got = dailyTrend(events, { days: 7, now: NOW });
  const seen = got.find((d) => d.at === day(2));
  const unseen = got.find((d) => d.at === day(5));

  // 켰지만 대기가 없던 날 — 관측했으므로 0으로 그려도 맞다
  assert.equal(seen.waitMs, 0);
  assert.equal(seen.observed, true);
  // 아예 안 켠 날 — 0이 아니라 "모른다"다
  assert.equal(unseen.waitMs, 0);
  assert.equal(unseen.observed, false);
});

test('자정을 넘긴 대기는 날짜별로 쪼개 담는다', () => {
  // 어제 23시부터 오늘 1시까지 두 시간 기다렸다
  const events = [
    bootEvent(day(1) + 22 * 60 * MIN),
    { at: day(1) + 23 * 60 * MIN, ev: 'on', key: 'k', room: 'r', mood: 'waiting' },
    { at: day(0) + 60 * MIN, ev: 'mood', key: 'k', room: 'r', mood: 'typing' },
  ];
  const got = dailyTrend(events, { days: 7, now: NOW });
  // 어제 몫 1시간, 오늘 몫 1시간 — 한쪽에 두 시간을 다 넣으면 그날의 그림이 틀어진다
  assert.equal(Math.round(got.find((d) => d.at === day(1)).waitMs / MIN), 60);
  assert.equal(Math.round(got.find((d) => d.at === day(0)).waitMs / MIN), 60);
});

test('오늘 칸은 지금까지만 센다', () => {
  // 지금도 기다리는 중 — 자정까지 채우면 아직 오지 않은 시간을 세게 된다
  const events = [
    bootEvent(day(0) + 14 * 60 * MIN),
    { at: day(0) + 14 * 60 * MIN, ev: 'on', key: 'k', room: 'r', mood: 'waiting' },
  ];
  const today = dailyTrend(events, { days: 7, now: NOW }).find((d) => d.at === day(0));
  assert.equal(Math.round(today.waitMs / MIN), 60); // 14시 → 15시(now)
});

test('기록이 없으면 이레 다 안 켠 날이다', () => {
  const got = dailyTrend([], { days: 7, now: NOW });
  assert.equal(got.length, 7);
  assert.ok(got.every((d) => d.observed === false && d.waitMs === 0));
});
