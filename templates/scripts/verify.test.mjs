// เทสต์ของ .claude/hooks/verify.mjs รันด้วย `node --test "scripts/*.test.mjs"`
// ทำงานกับสำเนาของ verify.mjs ในคลังชั่วคราว โดยฉีด CHECKS/FORMATTERS ทดสอบและลดเวลา timeout ไม่แตะไฟล์จริง
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, test } from 'node:test';

const hooks = join(dirname(fileURLToPath(import.meta.url)), '..', '.claude', 'hooks');
const gate = join(hooks, 'verify.mjs');

function repo({ checks = '', formatters = '', commit = true } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'verify-test-'));
  dirs.push(dir);
  const git = (...args) => spawnSync('git', ['-C', dir, '-c', 'user.email=t@t', '-c', 'user.name=t', ...args], { encoding: 'utf8' });
  git('init', '-q');
  // ไฟล์ด่านในคลังทดสอบไม่นับเป็น "ไฟล์ที่เปลี่ยน" ไม่งั้น CHECKS จริงของโปรเจกต์ (เช่นชุดตรวจสคริปต์) ไปรันกับมัน
  writeFileSync(join(dir, '.git', 'info', 'exclude'), '.claude/\n');
  if (commit) git('commit', '-q', '--allow-empty', '-m', 'init');
  // คัดลอกทั้งโฟลเดอร์ hooks เพราะโปรเจกต์อาจมีโมดูลข้างเคียงที่ verify.mjs import (เช่นตัววัดเพดานความยาว)
  cpSync(hooks, join(dir, '.claude', 'hooks'), { recursive: true });
  // แทนที่ CHECKS/FORMATTERS ทั้งก้อนด้วยของทดสอบ ไม่ให้ชุดตรวจจริงของโปรเจกต์ปนเข้ามา และไม่ผูกค่า timeout ตายตัว
  const source = readFileSync(gate, 'utf8')
    .replace(/const CHECK_TIMEOUT_MS = [\d_]+;/, 'const CHECK_TIMEOUT_MS = 1000;')
    .replace(/const CHECKS = \[[\s\S]*?\n\];/, `const CHECKS = [\n${checks}];`)
    .replace(/const FORMATTERS = \[[\s\S]*?\n\];/, `const FORMATTERS = [\n${formatters}];`);
  assert.match(source, /const CHECK_TIMEOUT_MS = 1000;/, 'หา CHECK_TIMEOUT_MS ในไฟล์ด่านไม่เจอ');
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
const dirs = [];
const done = (dir) => rmSync(dir, { recursive: true, force: true });
after(() => dirs.forEach(done));

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
  // the child writes alive.txt after 8s; if the whole process tree was killed at 1s the file never appears
  // 8s, not 3s: taskkill /T itself takes 2-4s on a busy Windows machine, and a margin shorter than that lets the child write
  // the file before it is killed, which made this test fail at random (I-044)
  const dir = repo({ checks: check('hang', '/a\\.txt$/', `node -e "setTimeout(()=>require('fs').writeFileSync('alive.txt','x'),8000)"`) });
  writeFileSync(join(dir, 'a.txt'), 'x');
  const started = Date.now();
  const r = run(dir, 'stop');
  assert.equal(r.status, 2);
  assert.match(r.err, /เกิน 1 วินาที/);
  assert.ok(Date.now() - started < 15000);
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 8500);
  assert.equal(existsSync(join(dir, 'alive.txt')), false);
  done(dir);
});

const commitCmd = (command = 'git commit -m "x"') => ({ tool_name: 'Bash', tool_input: { command } });

test('commit mode blocks a git commit until the gate is green for the changed files, and passes after', () => {
  const dir = repo({ checks: check('app', '/a\\.txt$/', 'node -e 0') });
  writeFileSync(join(dir, 'a.txt'), 'x');
  const blocked = run(dir, 'commit', commitCmd());
  assert.equal(blocked.status, 2);
  assert.match(blocked.err, /app/);
  assert.match(blocked.err, /verify\.mjs stop/);
  assert.equal(run(dir, 'stop').status, 0);
  assert.equal(run(dir, 'commit', commitCmd()).status, 0);
  writeFileSync(join(dir, 'a.txt'), 'changed after the green run');
  assert.equal(run(dir, 'commit', commitCmd()).status, 2);
  done(dir);
});

test('commit mode stays out of the way: other commands, files outside every area, and a red gate that never ran for them', () => {
  const dir = repo({ checks: check('app', '/a\\.txt$/', 'node -e 0') });
  writeFileSync(join(dir, 'a.txt'), 'x');
  assert.equal(run(dir, 'commit', commitCmd('git status --short')).status, 0);
  assert.equal(run(dir, 'commit', commitCmd('git log --grep=commit')).status, 0);
  assert.equal(run(dir, 'commit', { tool_name: 'Bash', tool_input: {} }).status, 0);
  assert.equal(run(dir, 'stop').status, 0);
  writeFileSync(join(dir, 'notes.md'), 'docs only');
  assert.equal(run(dir, 'commit', commitCmd('git -C . commit -m "docs"')).status, 0);
  done(dir);
});

function gitIn(dir, ...args) {
  return spawnSync('git', ['-C', dir, '-c', 'user.email=t@t', '-c', 'user.name=t', ...args], { encoding: 'utf8' });
}

test('subagent-start hands the worktree rules to agents that may write, and nothing to read-only ones', () => {
  const dir = repo();
  mkdirSync(join(dir, 'docs', 'guides'), { recursive: true });
  writeFileSync(join(dir, 'docs', 'guides', 'worktree.md'), '# rules\n<!-- note for people -->\n- use your own port\n');
  const writer = run(dir, 'subagent-start', { cwd: dir, agent_type: 'general-purpose' });
  assert.equal(writer.status, 0);
  const context = JSON.parse(writer.out).hookSpecificOutput;
  assert.equal(context.hookEventName, 'SubagentStart');
  assert.match(context.additionalContext, /use your own port/);
  assert.doesNotMatch(context.additionalContext, /note for people/);
  assert.equal(run(dir, 'subagent-start', { cwd: dir, agent_type: 'Explore' }).out, '');
  done(dir);
});

test('session-start is silent in the main checkout and hands the rules to a session opened in a linked worktree', () => {
  const dir = repo();
  mkdirSync(join(dir, 'docs', 'guides'), { recursive: true });
  writeFileSync(join(dir, 'docs', 'guides', 'worktree.md'), '- use your own port\n');
  gitIn(dir, 'add', 'docs'); gitIn(dir, 'commit', '-q', '-m', 'rules');
  const upper = dir.replace(/^[a-z]:/, (d) => d.toUpperCase());
  assert.equal(run(dir, 'session-start', { cwd: upper }).out, '');
  const tree = join(dir, 'wt');
  gitIn(dir, 'worktree', 'add', '-q', '-b', 't01', tree);
  const inTree = run(dir, 'session-start', { cwd: tree.replace(/^[a-z]:/, (d) => d.toUpperCase()) });
  assert.match(JSON.parse(inTree.out).hookSpecificOutput.additionalContext, /use your own port/);
  gitIn(dir, 'worktree', 'remove', '--force', tree);
  done(dir);
});

test('session-start warns about a lowercase drive letter on Windows only', { skip: process.platform !== 'win32' }, () => {
  const dir = repo();
  const lower = dir.replace(/^[A-Za-z]:/, (d) => d.toLowerCase());
  const out = run(dir, 'session-start', { cwd: lower }).out;
  assert.match(JSON.parse(out).hookSpecificOutput.additionalContext, /isolation: worktree/);
  done(dir);
});
