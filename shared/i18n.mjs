// 화면에 나가는 모든 문구를 한 곳으로 모은다 — main과 renderer가 같은 사전을 쓴다.
//
// 왜 모듈 하나에 현재 언어를 들고 있는가: main과 renderer는 서로 다른 프로세스라 각자
// 제 사본을 갖는다. 그래서 각 프로세스가 시작할 때 setLang()을 한 번 부르면 그 뒤로는
// t()를 부르는 곳마다 언어를 넘겨줄 필요가 없다 — 문구를 쓰는 자리가 200군데가 넘어서
// 인자로 끌고 다니면 그게 곧 빠뜨리는 자리가 된다.
//
// 사전은 순수 데이터다(shared/lang/*.mjs). 언어에 따라 **셈법**이 달라지는 것(기간·시각)만
// 여기서 분기한다 — 사전에 함수를 섞으면 어느 쪽을 봐야 하는지가 흐려진다.
import en from './lang/en.mjs';
import ko from './lang/ko.mjs';

export const LANGS = ['en', 'ko'];
// 언어 고르는 자리(트레이 메뉴·설정 창)에 그대로 쓴다. 언어 이름은 그 언어로 적는다 —
// 읽을 수 없는 언어로 적힌 항목은 고를 수가 없다.
export const LANG_NAMES = { en: 'English', ko: '한국어' };

const DICT = { en, ko };
const LOCALE = { en: 'en-US', ko: 'ko-KR' };

let lang = 'en';

// 설정값('auto' | 'en' | 'ko')과 OS 로케일에서 실제로 쓸 언어를 정한다.
// 모르는 값은 auto로 본다 — 손으로 고친 settings.json이 앱을 못 뜨게 하지는 않는다.
export function resolveLang(pref, systemLocale = '') {
  if (LANGS.includes(pref)) return pref;
  return String(systemLocale).toLowerCase().startsWith('ko') ? 'ko' : 'en';
}

export function setLang(next) {
  lang = LANGS.includes(next) ? next : 'en';
  return lang;
}

export function getLang() {
  return lang;
}

// Intl에 넘기는 로케일. 시각·날짜는 직접 짜지 않고 이걸로 넘긴다.
export function locale() {
  return LOCALE[lang];
}

function dig(dict, key) {
  let cur = dict;
  for (const part of key.split('.')) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = cur[part];
  }
  return cur;
}

// 없는 키는 en으로 떨어지고, 그것도 없으면 키를 그대로 돌려준다 —
// 문장 하나가 빠졌을 때 화면이 비는 것보다 키가 보이는 편이 고치기 쉽다.
function lookup(key) {
  const hit = dig(DICT[lang], key);
  if (hit !== undefined) return hit;
  const fallback = dig(DICT.en, key);
  return fallback === undefined ? key : fallback;
}

// 사전에 있는 키인지. t()는 없는 키를 키 그대로 돌려주므로 그것만으로는 구분이 안 된다 —
// 실패 사유처럼 "아는 것은 문구로, 모르는 것은 뭉뚱그린 문구로" 갈라야 하는 자리에서 쓴다.
export function has(key) {
  return dig(DICT[lang], key) !== undefined || dig(DICT.en, key) !== undefined;
}

// 문자열이면 `{이름}` 자리를 채워 돌려주고, 배열·객체(대사 목록 같은 것)는 그대로 돌려준다.
export function t(key, params) {
  const val = lookup(key);
  if (typeof val !== 'string' || !params) return val;
  return val.replace(/\{(\w+)\}/g, (whole, name) => (name in params ? String(params[name]) : whole));
}

// ── 기간
//
// 언어마다 셈법이 아니라 붙이는 꼬리가 다르다. 조각(시·분·초)을 여기서 나누고
// 꼬리만 사전에서 가져온다 — `1시간 35분` ↔ `1h 35m`.
function unit(n, key, pad = false) {
  const num = pad ? String(n).padStart(2, '0') : String(n);
  return t(`unit.${key}`, { n: num });
}

// 알림·트레이·출근부용. 분 아래는 접는다 — "0분"은 정보가 아니라 소음이다.
export function fmtDur(ms) {
  const m = Math.max(0, Math.round(ms / 60000));
  if (m < 60) return unit(m, 'min');
  const h = Math.floor(m / 60);
  return m % 60 ? `${unit(h, 'hour')} ${unit(m % 60, 'min')}` : unit(h, 'hour');
}

// 패널의 "가동 / 갱신". 하루를 넘기면 일 단위까지 올라간다.
export function fmtAge(ms) {
  if (ms == null) return '—';
  const m = Math.floor(ms / 60000);
  if (m < 1) return t('unit.justNow');
  if (m < 60) return unit(m, 'min');
  const h = Math.floor(m / 60);
  if (h < 24) return `${unit(h, 'hour')} ${unit(m % 60, 'min')}`;
  return `${unit(Math.floor(h / 24), 'day')} ${unit(h % 24, 'hour')}`;
}

// "얼마 전"까지 붙인 꼴. 한국어는 `방금 전`으로 자연스럽게 이어지지만 영어의 `just now`는
// 그 자체로 완성된 말이라 `ago`를 붙이면 "just now ago"가 된다 — 그래서 통째로 갈아 낀다.
export function fmtAgo(ms) {
  if (ms == null) return '—';
  return ms < 60_000 ? t('unit.justNowAgo') : t('unit.ago', { d: fmtAge(ms) });
}

// 초기화까지 남은 시간 — 1초마다 갱신되므로 짧게, 대신 초까지.
export function fmtLeft(ms) {
  if (ms == null) return '—';
  if (ms <= 0) return t('usage.resetDone');
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${unit(h, 'hour')} ${unit(m, 'min')}`;
  if (m > 0) return `${unit(m, 'min')} ${unit(s, 'sec', true)}`;
  return unit(s, 'sec');
}

// 기다린 시간. 방금 뜬 프롬프트인지 20분째 방치된 것인지가 초 단위에서 갈린다.
export function fmtWaitedDur(ms) {
  const s = Math.floor(Math.max(0, ms) / 1000);
  if (s < 60) return unit(s, 'sec');
  const m = Math.floor(s / 60);
  if (m < 60) return `${unit(m, 'min')} ${unit(s % 60, 'sec', true)}`;
  const h = Math.floor(m / 60);
  return `${unit(h, 'hour')} ${unit(m % 60, 'min')}`;
}

// ── 시각·날짜. 직접 짜지 않고 Intl에 로케일을 넘긴다.
export function fmtTime(at) {
  const d = new Date(at);
  if (Number.isNaN(+d)) return '';
  return d.toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit', hour12: false });
}

export function fmtClock(at = Date.now()) {
  return new Date(at).toLocaleTimeString(locale(), { hour12: false });
}

// 출근부의 구간 표시 — `7/31`. 짧아야 하고 앞뒤로 붙어 나오므로 두 언어가 같다.
export function fmtDay(at) {
  const d = new Date(at);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

// 초기화 시각. 주간 초기화는 이틀 뒤라 시각만 적으면 "04:00"이 오늘인지 모레인지 알 수 없다.
export function fmtWhen(at) {
  if (!at) return '';
  const d = new Date(at);
  if (Number.isNaN(+d)) return '';
  const time = fmtTime(at);
  return d.toDateString() === new Date().toDateString() ? time : `${fmtDay(at)} ${time}`;
}

// 토큰 수. 언어와 무관하지만 세는 자리가 셋(패널·알림·상단바)이라 여기 둔다.
export function fmtTokens(n) {
  if (!n) return '—';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n % 1_000_000 ? 2 : 0)}M`;
  if (n >= 1000) return `${Math.round(n / 1000)}K`;
  return String(n);
}

// 컨텍스트 창처럼 딱 떨어지는 수는 소수점 없이
export function fmtLimit(n) {
  if (!n) return '—';
  if (n % 1_000_000 === 0) return `${n / 1_000_000}M`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  return `${Math.round(n / 1000)}K`;
}
