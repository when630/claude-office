// README 캡처를 두 언어로 굽는다 → docs/images/{en,ko}/
//
//   npm run shots              여섯 장 × 두 언어
//   npm run shots -- --cand    후보를 몇 장 더 남긴다 (눈으로 고를 때)
//
// 앱을 띄우지 않는다. 렌더러만 화면 밖에 띄우고 가짜 preload(tools/shots/preload.cjs)로
// `window.office`를 세운 뒤, 픽스처를 `__office.push`로 밀어 넣고 `capturePage`로 찍는다.
// 자세한 배경과 함정은 docs/architecture.md의 "디버그 입구"에 있다. 요약하면:
//
//   · 최상위에서 `await app.whenReady()`를 하면 교착한다
//   · 화면 밖 창은 **보이게**(show: true) 띄워야 컴포지터가 프레임을 낸다
//   · 하드웨어 가속을 끄지 않으면 `capturePage`가 UnknownVizError로 튕긴다
//   · 첫 캡처는 버린다. DOM 레이어만 낡은 프레임으로 남는 일이 있어 폭을 재서 확인한다
//   · 두 언어를 같은 경과 시각에 찍어야 클로드 자세까지 겹친다
//   · Windows에서는 main의 console.log가 터미널에 안 나온다 — 진행 상황은 stderr로 낸다
import { app, BrowserWindow } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { buildFixture } from './shots/fixture.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const OUT = path.join(ROOT, 'docs/images');
const PRELOAD = path.join(ROOT, 'tools/shots/preload.cjs');
const LANGS = ['en', 'ko'];

const W = 1760; // 좁으면 오른쪽 패널이 잘린 채 찍힌다
const H = 1020;
const MINI_W = 560;
const MINI_H = 240;
const SETTLE = 1800; // push 뒤 이만큼 기다린 순간을 두 언어가 똑같이 쓴다

const CAND = process.argv.includes('--cand');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// GUI 서브시스템이라 stdout이 터미널에 닿지 않는 환경이 있다. stderr는 나온다.
const log = (s) => process.stderr.write(s + '\n');

app.disableHardwareAcceleration();
// 창을 갈아 끼울 때 앞 창을 먼저 없애면 Electron이 앱을 종료해 다음 loadFile이 끊긴다
app.on('window-all-closed', () => {});
// 사용자가 띄워 둔 진짜 앱과 캐시를 나눠 쓰지 않는다
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'claude-office-shots-')));

// ── 캡처

async function capture(win) {
  for (let i = 0; i < 8; i++) {
    try {
      return await win.webContents.capturePage();
    } catch {
      await wait(250);
    }
  }
  throw new Error('capturePage가 계속 튕긴다');
}

// 레이아웃이 창 폭을 다 쓰고 있는지 재고, 프레임을 몇 장 버려 낡은 합성을 밀어낸다.
//
// **캔버스는 새 프레임인데 DOM 레이어만 낡은** 그림이 나온 적이 있다(0.4.0 캡처의
// office.png — 상단바와 목록이 잘리고 패널이 통째로 빠졌다). 그림만 봐서는 스냅샷 탓으로
// 보이므로 여기서 재서 걸러 준다.
async function settle(win, n = 3) {
  const geo = await win.webContents.executeJavaScript(`(() => {
    // 미니에서는 #topbar도 DOM에 남아 있지만 감춰져 있어 폭이 0이다 — 손잡이를 잰다
    const t = document.getElementById(document.body.classList.contains('mini') ? 'mini-bar' : 'topbar');
    return { bar: t.getBoundingClientRect().width, inner: window.innerWidth };
  })()`);
  if (Math.abs(geo.bar - geo.inner) > 2) log(`  ! 레이아웃 폭이 안 맞는다 bar=${geo.bar} inner=${geo.inner}`);
  for (let i = 0; i < n; i++) {
    await capture(win);
    await wait(180);
  }
}

function save(img, file, box, zoom = 1) {
  const { width, height } = img.getSize();
  const b = box
    ? {
        x: Math.max(0, Math.round(box.x)),
        y: Math.max(0, Math.round(box.y)),
        width: Math.min(Math.round(box.width), width - Math.round(box.x)),
        height: Math.min(Math.round(box.height), height - Math.round(box.y)),
      }
    : null;
  let out = b ? img.crop(b) : img;
  if (zoom > 1) {
    const s = out.getSize();
    // 픽셀 아트라 정수배로만 키운다
    out = out.resize({ width: s.width * zoom, height: s.height * zoom, quality: 'best' });
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, out.toPNG());
  const s = out.getSize();
  log(`  ✓ ${path.relative(OUT, file).replace(/\\/g, '/')}  ${s.width}x${s.height}`);
}

// ── 말풍선이 떠 있는 순간 고르기
//
// 말풍선은 8초 주기로 4.8초만 떠 있고 위상이 세션 키 해시로 흩어져 있다(talk.mjs).
// 고정된 시각에 찍으면 십중팔구 없는 프레임이 잡힌다. 캔버스라 DOM으로 물어볼 수도 없으니
// **찍어서 흰 픽셀을 센다** — 말풍선 바닥이 render.mjs의 BUBBLE_STYLE.real(#f2f4f9)이다.

const isWhite = (b, o) => b[o] > 240 && b[o + 1] > 238 && b[o + 2] > 236;

function whitePixels(img) {
  const bmp = img.toBitmap(); // BGRA
  let n = 0;
  for (let o = 0; o < bmp.length; o += 4) if (isWhite(bmp, o)) n++;
  return n;
}

// **가장 긴 가로 흰 줄.** 총 픽셀 수로 고르면 ❗ 풍선처럼 늘 떠 있는 것이 표를 나눠 가져
// 짧은 대사("3분째 기다리는 중")가 이긴다 — 긴 줄이 곧 긴 문장이고, 캡처에 실려야 하는
// 것은 무엇을 묻는지다.
function widestWhiteRun(img) {
  const { width, height } = img.getSize();
  const bmp = img.toBitmap();
  let best = 0;
  for (let y = 0; y < height; y++) {
    let run = 0;
    for (let x = 0; x < width; x++) {
      if (isWhite(bmp, (y * width + x) * 4)) {
        if (++run > best) best = run;
      } else run = 0;
    }
  }
  return best;
}

// 점수가 높은 순으로 몇 장. **표본 간격을 띄운다** — 이웃 프레임은 점수가 거의 같아
// 한 순간이 상위권을 독차지하는데, 후보는 다른 순간이라야 갈아 끼울 값어치가 있다.
async function grabTop(win, box, score, { tries, gap, keep = 4, apart = 6 }) {
  const shots = [];
  for (let i = 0; i < tries; i++) {
    const img = await capture(win);
    shots.push({ img, n: score(img.crop(box)), i });
    await wait(gap);
  }
  shots.sort((a, b) => b.n - a.n);
  const picks = [];
  for (const s of shots) {
    if (picks.length >= keep) break;
    if (picks.every((p) => Math.abs(p.i - s.i) >= apart)) picks.push(s);
  }
  log(`    말풍선 점수: ${picks.map((p) => `${p.n}@${p.i}`).join(' ')}`);
  return picks;
}

// 후보는 `--cand`일 때만 남긴다. 첫 장이 늘 본편이다.
function saveWithCands(picks, dir, name, box, zoom) {
  picks.forEach((p, i) => {
    if (i && !CAND) return;
    save(p.img, path.join(dir, i === 0 ? `${name}.png` : `_cand/${name}-${i}.png`), box, zoom);
  });
}

// ── 창

function open(extra = {}) {
  // 화면 밖에 **보이게** 띄운다. 숨긴 창은 rAF가 throttle되고 컴포지터가 프레임을 제시하지
  // 않아 애니메이션의 특정 순간이 잡히지 않는다.
  return new BrowserWindow({
    show: true,
    x: -4200,
    y: -4200,
    width: W,
    height: H,
    frame: false,
    skipTaskbar: true,
    focusable: false,
    ...extra,
    webPreferences: { preload: PRELOAD, contextIsolation: true, sandbox: false },
  });
}

// 페이지의 시계를 픽스처의 "지금"으로 갈아 끼운다. 실제 시계로 찍으면 기다린 시간과
// 가동 시간이 `0분`·`방금`으로 박히고, 두 언어의 숫자도 서로 어긋난다.
// `new Date()`가 객체를 돌려주므로 생성자를 감싸도 instanceof는 살아 있다.
const freezeClock = (win, at) =>
  win.webContents.executeJavaScript(`(() => {
    const FIXED = ${at};
    const Real = Date;
    const Fake = function (...a) { return a.length ? new Real(...a) : new Real(FIXED); };
    Fake.now = () => FIXED;
    Fake.parse = Real.parse;
    Fake.UTC = Real.UTC;
    Fake.prototype = Real.prototype;
    window.Date = Fake;
    return true;
  })()`);

// `mini`면 `?mini=1`로 띄운다. 미니는 방을 그리지 않으므로 방 개수로 확인하지 않는다.
async function boot(win, lang, fixture, { mini = false } = {}) {
  await win.loadFile(path.join(ROOT, 'renderer/index.html'), mini ? { query: { mini: '1' } } : undefined);
  await freezeClock(win, fixture.state.ts);
  await win.webContents.executeJavaScript(`document.fonts.load('12px MonaS12')`);
  await win.webContents.executeJavaScript(`document.fonts.load('13px "Pretendard Variable"')`);
  await win.webContents.executeJavaScript(`window.__office.lang(${JSON.stringify(lang)}); true`);
  // push가 조용히 실패하면 캔버스가 텅 빈 채로 저장된다 — 던진 것과 그린 방 개수를 확인한다
  const pushed = await win.webContents.executeJavaScript(
    `(() => { try { window.__office.push(${JSON.stringify(fixture.state)}); return window.__office.layout.boxes.length; } catch (e) { return 'ERR ' + e.message; } })()`,
  );
  if (typeof pushed !== 'number') throw new Error(`스냅샷을 밀어 넣지 못했다: ${pushed}`);
  if (!mini && pushed === 0) throw new Error('스냅샷은 들어갔는데 방이 하나도 안 그려졌다');
  // 화면 밖 창에는 resize가 오지 않는다 — 앱이 쓰는 경로를 직접 두드려 레이아웃을 다시 잡는다
  await win.webContents.executeJavaScript(`window.dispatchEvent(new Event('resize')); true`);
  await wait(SETTLE);
}

// 패널을 **내용 높이에 맞춰** 자른다. 패널은 창 높이를 다 쓰므로 그대로 찍으면 아래가 텅 빈다.
// `scrollHeight`는 못 쓴다 — 내용이 상자보다 짧으면 상자 높이를 돌려주기 때문이다.
// 마지막 자식의 밑선을 직접 재야 실제 내용 끝이 나온다.
const panelCrop = (win, scrollSel) =>
  win.webContents.executeJavaScript(`(() => {
    const p = document.getElementById('panel').getBoundingClientRect();
    const body = document.querySelector(${JSON.stringify(scrollSel)});
    const foot = document.querySelector('.jump');
    let bottom = document.getElementById('panel-view').getBoundingClientRect().top;
    for (const el of body ? body.children : []) bottom = Math.max(bottom, el.getBoundingClientRect().bottom);
    const pad = body ? parseFloat(getComputedStyle(body).paddingBottom) || 0 : 0;
    const need = bottom - p.top + pad + (foot ? foot.getBoundingClientRect().height : 0);
    return { x: p.left, y: p.top, width: p.width, height: Math.min(p.height, Math.ceil(need)) };
  })()`);

async function selectSeat(win, key) {
  await win.webContents.executeJavaScript(`window.__office.select(${JSON.stringify(key)}); true`);
  await wait(600);
  await settle(win, 3);
}

// ── 여섯 장

async function bake(lang, fixture) {
  const dir = path.join(OUT, lang);
  const win = open();
  await boot(win, lang, fixture);
  await settle(win, 4);

  // 1. 사무실 전경 — 창 전체(목록 · 사무실 · 패널).
  //    흰 픽셀은 **캔버스 안에서만** 센다. 패널 글자가 섞이면 판정이 무의미해진다.
  const canvas = await win.webContents.executeJavaScript(`(() => {
    const r = document.getElementById('office').getBoundingClientRect();
    return { x: Math.round(r.left), y: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) };
  })()`);
  // 넉넉히 훑는다. 걷기 구간이 5.2초이고 **세 구간마다 다 같이 러그로 모이므로**
  // (render.mjs의 HANG_EVERY) 15초 남짓만 훑으면 모인 순간만 후보에 오른다.
  saveWithCands(
    await grabTop(win, canvas, whitePixels, { tries: 70, gap: 700, apart: 10 }),
    dir,
    'office',
  );

  // 2. 입력 대기 — 그 방만 잘라 크게. 방이 화면 어디인지는 __office.layout이 알려준다
  //    (캔버스라 DOM으로는 물어볼 수 없다). 화면 좌표는 `방 좌표 * scale + pan`이다.
  const geo = await win.webContents.executeJavaScript(`(() => {
    const c = document.getElementById('office').getBoundingClientRect();
    const l = window.__office.layout;
    return { left: c.left, top: c.top, scale: l.scale, boxes: l.boxes };
  })()`);
  const b = geo.boxes.find((x) => x.key === 'api-gateway') ?? geo.boxes[0];
  const roomBox = {
    x: Math.round(geo.left + b.x * geo.scale),
    y: Math.round(geo.top + b.y * geo.scale),
    width: Math.round(b.w * geo.scale),
    height: Math.round(b.h * geo.scale),
  };
  // 기다리는 클로드는 세 줄을 돌린다(무엇을 기다리는지 → 얼마나 → 재촉). 24초는 훑어야
  // 세 줄이 다 지나가고, 그중 가장 넓은 것이 "무엇을 묻는지"다.
  saveWithCands(
    await grabTop(win, roomBox, widestWhiteRun, { tries: 64, gap: 380 }),
    dir,
    'waiting',
    roomBox,
    Math.max(1, Math.round(1000 / roomBox.width)),
  );

  // 3. 세션 패널 — 서브에이전트 · 승인받은 계획 · 할 일이 다 든 자리를 고른다
  await selectSeat(win, 'sess:e4b4bc3c');
  save(await capture(win), path.join(dir, 'panel.png'), await panelCrop(win, '.panel-body'));

  // 4. 대기 카드 — 같은 패널이지만 기다리는 자리를 고르면 노란 카드가 이름 밑에 선다
  await selectSeat(win, 'sess:a1b2c3d4');
  save(await capture(win), path.join(dir, 'panel-waiting.png'), await panelCrop(win, '.panel-body'));

  // 5. 출근부 — 상단바 버튼이 아니라 패널 탭이다 (#135에서 버튼을 걷어냈다)
  await win.webContents.executeJavaScript(`document.querySelector('[data-panel-tab="att"]').click(); true`);
  await wait(900);
  await settle(win, 3);
  save(await capture(win), path.join(dir, 'attendance.png'), await panelCrop(win, '#att-body'));

  win.destroy();

  // 6. 작게 띄우기 — 같은 렌더러를 `?mini=1`로 띄운 별개의 창이다
  const mini = open({ width: MINI_W, height: MINI_H });
  await boot(mini, lang, fixture, { mini: true });
  await settle(mini, 4);
  save(await capture(mini), path.join(dir, 'mini.png'), null, 2);
  mini.destroy();
}

app.whenReady().then(async () => {
  // 감싸지 않으면 오류가 unhandled rejection으로 조용히 사라지고, 창이 안 닫혀
  // 스크립트가 멈춘 것처럼 보인다
  try {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-office-fixture-'));
    for (const lang of LANGS) {
      log(`── ${lang}`);
      const fixture = buildFixture(lang);
      // preload는 창을 만들 때마다 다시 돌면서 이 환경변수를 읽는다
      const file = path.join(tmp, `${lang}.json`);
      fs.writeFileSync(file, JSON.stringify(fixture));
      process.env.SHOT_FIXTURE = file;
      await bake(lang, fixture);
    }
    fs.rmSync(tmp, { recursive: true, force: true });
    log('끝');
  } catch (e) {
    log('실패: ' + (e?.stack ?? e));
    app.exit(1);
  }
  app.quit();
});
