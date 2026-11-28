// เทสต์ของ .claude/hooks/verify.mjs รันด้วย `node --test "scripts/*.test.mjs"`
// ทำงานกับสำเนาของ verify.mjs ในคลังชั่วคราว โดยฉีด CHECKS/FORMATTERS ทดสอบและลดเวลา timeout ไม่แตะไฟล์จริง
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
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
  // the child rewrites alive.txt every 100ms. The gate returns only after taskkill/kill finished, so a dead process tree leaves the
  // file as it was; a surviving child keeps changing it. Nothing here depends on how fast the machine is: the earlier version let
  // the child write once after 3s, which failed at random because taskkill /T takes 2-4s on a busy Windows machine (I-044)
  const dir = repo({ checks: check('hang', '/a\\.txt$/', `node -e "setInterval(()=>require('fs').writeFileSync('alive.txt',String(Date.now())),100)"`) });
  writeFileSync(join(dir, 'a.txt'), 'x');
  const r = run(dir, 'stop');
  assert.equal(r.status, 2);
  assert.match(r.err, /เกิน 1 วินาที/);
  const alive = join(dir, 'alive.txt');
  const beat = () => (existsSync(alive) ? readFileSync(alive, 'utf8') : null);
  const first = beat();
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 2000);
  assert.equal(beat(), first, 'the hanging check\'s child process is still writing after the gate returned');
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

test('worktree-create makes a locked worktree from HEAD, copies the ignored files that .worktreeinclude lists, and returns its real path', () => {
  const dir = repo();
  const git = (...args) => spawnSync('git', ['-C', dir, ...args], { encoding: 'utf8' }).stdout.trim();
  writeFileSync(join(dir, '.gitignore'), '.env\nsecret.txt\n');
  writeFileSync(join(dir, '.worktreeinclude'), '# comment\n.env\n');
  writeFileSync(join(dir, '.env'), 'A=1');
  mkdirSync(join(dir, 'ui'));
  writeFileSync(join(dir, 'ui', '.env'), 'B=2');
  writeFileSync(join(dir, 'secret.txt'), 'not listed');
  const made = run(dir, 'worktree-create', { cwd: dir, name: 'agent-abc123' });
  assert.equal(made.status, 0, made.err);
  const tree = made.out.trim().split('\n').pop();
  assert.equal(tree, realpathSync.native(join(dir, '.claude', 'worktrees', 'agent-abc123')));
  assert.equal(git('-C', tree, 'branch', '--show-current'), 'worktree-agent-abc123');
  assert.equal(git('-C', tree, 'rev-parse', 'HEAD'), git('rev-parse', 'HEAD'));
  assert.equal(readFileSync(join(tree, '.env'), 'utf8'), 'A=1');
  assert.equal(readFileSync(join(tree, 'ui', '.env'), 'utf8'), 'B=2');
  assert.equal(existsSync(join(tree, 'secret.txt')), false);
  assert.equal(readFileSync(join(git('-C', tree, 'rev-parse', '--absolute-git-dir'), 'CLAUDE_BASE'), 'utf8'), git('rev-parse', 'HEAD'));
  assert.match(git('worktree', 'list', '--porcelain'), /locked/);
  // เรียกซ้ำด้วยชื่อเดิมคืน path เดิม ไม่สร้างซ้อน · ชื่อที่พาออกนอกโฟลเดอร์ถูกปฏิเสธ
  assert.equal(run(dir, 'worktree-create', { cwd: dir, name: 'agent-abc123' }).out.trim(), tree);
  assert.equal(run(dir, 'worktree-create', { cwd: dir, name: '../x' }).status, 1);
  // agent ของ worktree นั้นจบและด่านผ่าน: lock ที่ด่านใส่ถูกปลด
  assert.equal(run(dir, 'subagent-stop', { cwd: tree }).status, 0);
  assert.doesNotMatch(git('worktree', 'list', '--porcelain'), /locked/);
  // worktree ของ session (ชื่อไม่ขึ้นต้นด้วย agent-) ไม่ถูก lock เพราะไม่มี subagent-stop มาปลด
  const own = run(dir, 'worktree-create', { cwd: dir, name: 'feature-x' }).out.trim();
  assert.equal(git('-C', own, 'branch', '--show-current'), 'worktree-feature-x');
  assert.doesNotMatch(git('worktree', 'list', '--porcelain'), /locked/);
  for (const t of [tree, own]) spawnSync('git', ['-C', dir, 'worktree', 'remove', '--force', t]);
  done(dir);
});
