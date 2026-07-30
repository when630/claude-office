// statusline에 사용량 tap을 심는/빼는 CLI. 로직은 main/usage-tap.mjs에 있다.
//
//   node tools/install-usage-tap.mjs            심기 (이미 심어져 있으면 아무 것도 안 한다)
//   node tools/install-usage-tap.mjs --remove   빼기
//
// 패키징본에는 npm도 tools/도 들어가지 않는다 — 설치본에서는 트레이 아이콘 > "사용량 연동"을 쓴다.
// 여기는 레포에서 바로 돌릴 때의 입구일 뿐이고, 하는 일은 트레이 메뉴와 완전히 같다.
import { installTap, removeTap, manualGuide, REASONS } from '../main/usage-tap.mjs';

const remove = process.argv.includes('--remove');
const res = remove ? removeTap() : installTap();

if (res.ok && res.already) {
  console.log(remove ? `심어진 tap이 없습니다: ${res.file}` : `이미 심어져 있습니다: ${res.file}`);
  process.exit(0);
}

if (res.ok) {
  console.log(`${remove ? '제거' : '심기'} 완료: ${res.file}`);
  console.log(`백업: ${res.backup}`);
  if (!remove) {
    console.log(`  변수 $${res.varName} 를 사용량 파일에 씁니다.`);
    console.log(`  BOM: ${res.hadBom ? '원래 있었음' : '없어서 새로 붙였음'}`);
    console.log('Claude Code 세션에서 statusline이 한 번 그려지면 앱에 사용량이 뜹니다.');
  }
  process.exit(0);
}

console.log(REASONS[res.reason] ?? res.reason);
if (res.command) console.log(`statusLine 명령: ${res.command}`);
if (res.error) console.log(res.error);
if (res.reason !== 'write-failed') {
  console.log('');
  console.log(manualGuide());
}
process.exit(1);
