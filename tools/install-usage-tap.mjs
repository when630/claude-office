// statusline에 사용량 tap을 심는/빼는 CLI. 로직은 main/usage-tap.mjs에 있다.
//
//   node tools/install-usage-tap.mjs            심기 (이미 심어져 있으면 아무 것도 안 한다)
//   node tools/install-usage-tap.mjs --remove   빼기
//
// 패키징본에는 npm도 tools/도 들어가지 않는다 — 설치본에서는 트레이 아이콘 > "사용량 연동"을 쓴다.
// 여기는 레포에서 바로 돌릴 때의 입구일 뿐이고, 하는 일은 트레이 메뉴와 완전히 같다.
import { installTap, removeTap, manualGuide, reasonText } from '../main/usage-tap.mjs';
import { t, setLang, resolveLang } from '../shared/i18n.mjs';

// 여기는 Electron이 없어 app.getLocale()을 못 쓴다. 앱은 설정(settings.lang)을 보지만
// CLI에는 설정 창이 없으니 시스템 로케일이 유일한 근거다.
setLang(resolveLang('auto', Intl.DateTimeFormat().resolvedOptions().locale));

const remove = process.argv.includes('--remove');
const res = remove ? removeTap() : installTap();

if (res.ok && res.already) {
  console.log(t(remove ? 'cli.nothingInstalled' : 'cli.alreadyInstalled', { file: res.file }));
  process.exit(0);
}

if (res.ok) {
  console.log(t(remove ? 'cli.removed' : 'cli.installed', { file: res.file }));
  console.log(t('cli.backup', { file: res.backup }));
  if (!remove) {
    console.log(t('cli.varName', { name: res.varName }));
    console.log(t(res.hadBom ? 'cli.bomKept' : 'cli.bomAdded'));
    console.log(t('cli.next'));
  }
  process.exit(0);
}

console.log(reasonText(res.reason));
if (res.command) console.log(t('tap.command', { cmd: res.command }));
if (res.error) console.log(res.error);
if (res.reason !== 'write-failed') {
  console.log('');
  console.log(manualGuide());
}
process.exit(1);
