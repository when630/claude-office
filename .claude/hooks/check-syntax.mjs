// PostToolUse(Edit|Write): 편집된 .mjs/.cjs를 node --check에 통과시킨다.
// 문법 오류면 exit 2 — stderr가 Claude에게 피드백으로 전달돼 바로 고치게 된다.
// (CLAUDE.md의 "고친 .mjs마다 node --check" 수동 절차를 대체한다)
import { spawnSync } from 'node:child_process';

let raw = '';
process.stdin.on('data', (d) => (raw += d));
process.stdin.on('end', () => {
  let file = '';
  try {
    file = JSON.parse(raw || '{}').tool_input?.file_path ?? '';
  } catch {
    /* 입력이 JSON이 아니면 검사할 것도 없다 */
  }
  if (!/\.(mjs|cjs)$/i.test(file)) process.exit(0);

  const r = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (r.status !== 0) {
    process.stderr.write(r.stderr || `node --check 실패: ${file}\n`);
    process.exit(2);
  }
  process.exit(0);
});
