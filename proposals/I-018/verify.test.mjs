// เทสต์ของ .claude/hooks/verify.mjs รันด้วย `node --test "scripts/*.test.mjs"`
// ทำงานกับสำเนาของ verify.mjs ในคลังชั่วคราว โดยฉีด CHECKS/FORMATTERS ทดสอบและลดเวลา timeout ไม่แตะไฟล์จริง
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const gate = join(dirname(fileURLToPath(import.meta.url)), '..', '.claude', 'hooks', 'verify.mjs');

function repo({ checks = '', formatters = '', commit = true } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'verify-test-'));
  const git = (...args) => spawnSync('git', ['-C', dir, '-c', 'user.email=t@t', '-c', 'user.name=t', ...args], { encoding: 'utf8' });
  git('init', '-q');
  if (commit) git('commit', '-q', '--allow-empty', '-m', 'init');
  mkdirSync(join(dir, '.claude', 'hooks'), { recursive: true });
  const source = readFileSync(gate, 'utf8')
    .replace('const CHECK_TIMEOUT_MS = 120_000;', 'const CHECK_TIMEOUT_MS = 1000;')
    .replace('const CHECKS = [', `const CHECKS = [\n${checks}`)
    .replace('const FORMATTERS = [', `const FORMATTERS = [\n${formatters}`);
  writeFileSync(join(dir, '.claude', 'hooks', 'verify.mjs'), source);
  return dir;
}

function run(dir, mode, input = {}) {
  const r = spawnSync(process.execPath, [join(dir, '.claude', 'hooks', 'verify.mjs'), mode], {
    cwd: dir, input: JSON.stringify(input), encoding: 'utf8', env: { ...process.env, CLAUDE_PROJECT_DIR: dir },
  });
  return { status: r.status, out: r.stdout, err: r.stderr };
}

const check = (name, area, cmd, extra = '') => `  { name: ${JSON.stringify(name)}, area: ${area}, cwd: ".", ${extra} cmds: [${JSON.stringify(cmd)}] },\n`;
const done = (dir) => rmSync(dir, { recursive: true, force: true });

test('a failing check blocks, and the same failure with changing output lets the turn end', () => {
  const dir = repo({ checks: check('bad', '/a\\.txt$/', `node -e "console.log(Date.now());process.exit(1)"`) });
  writeFileSync(join(dir, 'a.txt'), 'x');
  assert.equal(run(dir, 'stop').status, 2);
  const second = run(dir, 'stop', { stop_hook_active: true });
  assert.equal(second.status, 0);
  assert.match(second.out, /ผลเดิมซ้ำ/);
  done(dir);
});

test('a repo with no commit yet does not crash the gate', () => {
  const dir = repo({ commit: false });
  assert.equal(run(dir, 'stop').status, 0);
  done(dir);
});

test('a missing dependency names the install command of the check', () => {
  const dir = repo({ checks: check('py', '/a\\.txt$/', 'node -e 0', 'needs: ".venv", install: "uv sync",') });
  writeFileSync(join(dir, 'a.txt'), 'x');
  const r = run(dir, 'stop');
  assert.equal(r.status, 2);
  assert.match(r.err, /uv sync/);
  done(dir);
});

test('a formatter that is not installed is skipped with a warning, never blocks', () => {
  const dir = repo({ formatters: '  { match: /a\\.txt$/, cmd: (f) => ["no-such-formatter-xyz", [f]] },\n' });
  const file = join(dir, 'a.txt');
  writeFileSync(file, 'x');
  const r = run(dir, 'format', { tool_input: { file_path: file } });
  assert.equal(r.status, 0);
  assert.match(r.out, /ข้าม formatter/);
  done(dir);
});

test('a hanging check is cut at the timeout and its child process is killed too', () => {
  // the child writes alive.txt after 3s; if the whole process tree was killed at 1s the file never appears
  const dir = repo({ checks: check('hang', '/a\\.txt$/', `node -e "setTimeout(()=>require('fs').writeFileSync('alive.txt','x'),3000)"`) });
  writeFileSync(join(dir, 'a.txt'), 'x');
  const started = Date.now();
  const r = run(dir, 'stop');
  assert.equal(r.status, 2);
  assert.match(r.err, /เกิน 1 วินาที/);
  assert.ok(Date.now() - started < 8000);
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 3500);
  assert.equal(existsSync(join(dir, 'alive.txt')), false);
  done(dir);
});
