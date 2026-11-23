// เทสต์ของ scripts/dev-env.mjs รันด้วย `node --test "scripts/*.test.mjs"` (Node 22+ ไม่รับชื่อโฟลเดอร์อย่างเดียว)
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { ensureSecrets, missingWorktreeEnv, parseDotEnv } from './dev-env.mjs';

function envFile(content) {
  const file = join(mkdtempSync(join(tmpdir(), 'dev-env-')), '.env');
  if (content !== undefined) writeFileSync(file, content);
  return file;
}

test('creates missing secrets and keeps other values', () => {
  const file = envFile('APP_DB_PASSWORD=secret');
  assert.deepEqual(ensureSecrets(file, ['APP_KEY']), ['APP_KEY']);
  const values = parseDotEnv(readFileSync(file, 'utf8'));
  assert.equal(values.APP_DB_PASSWORD, 'secret');
  assert.ok(Buffer.byteLength(values.APP_KEY) >= 32);
});

test('fills a blank line in place and never overwrites an existing value', () => {
  const file = envFile('APP_KEY=\nAPP_OTHER=kept\n');
  ensureSecrets(file, ['APP_KEY', 'APP_OTHER']);
  const first = parseDotEnv(readFileSync(file, 'utf8'));
  assert.equal(first.APP_OTHER, 'kept');
  assert.deepEqual(ensureSecrets(file, ['APP_KEY', 'APP_OTHER']), []);
  assert.equal(parseDotEnv(readFileSync(file, 'utf8')).APP_KEY, first.APP_KEY);
});

test('creates the file when it does not exist', () => {
  const file = envFile();
  assert.deepEqual(ensureSecrets(file, ['APP_KEY']), ['APP_KEY']);
});

test('reads quoted values, inline comments and export lines', () => {
  const values = parseDotEnv('A="q v # kept"\nB=1 # note\nexport C=x\nD=a#b\nE=\'s\'');
  assert.deepEqual(values, { A: 'q v # kept', B: '1', C: 'x', D: 'a#b', E: 's' });
});

test('fills a blank line in place in a CRLF file', () => {
  const file = envFile('APP_KEY=\r\nAPP_OTHER=kept\r\n');
  ensureSecrets(file, ['APP_KEY']);
  const text = readFileSync(file, 'utf8');
  assert.equal(text.match(/APP_KEY=/g).length, 1);
  assert.ok(text.endsWith('APP_OTHER=kept\r\n'));
});

test('worktree guard: names the unset values only inside a linked worktree', () => {
  const main = mkdtempSync(join(tmpdir(), 'wt-guard-'));
  const git = (...args) => execFileSync('git', ['-C', main, '-c', 'user.email=t@t', '-c', 'user.name=t', ...args], { encoding: 'utf8' });
  git('init', '-q', '-b', 'main');
  git('commit', '-q', '--allow-empty', '-m', 'init');
  const tree = join(main, 'wt');
  git('worktree', 'add', '-q', '-b', 't01', tree);
  const required = ['COMPOSE_PROJECT_NAME', 'DB_NAME'];
  assert.deepEqual(missingWorktreeEnv(main, required, {}), [], 'main checkout is the dev checkout');
  assert.deepEqual(missingWorktreeEnv(tree, required, { DB_NAME: 'app_t01' }), ['COMPOSE_PROJECT_NAME']);
  assert.deepEqual(missingWorktreeEnv(tree, required, { COMPOSE_PROJECT_NAME: 'app_t01', DB_NAME: 'app_t01' }), []);
  assert.deepEqual(missingWorktreeEnv(tree, [], {}), [], 'no list = no guard');
});

test('a linked worktree without .env takes the main checkout\'s secrets instead of generating new ones', () => {
  const main = mkdtempSync(join(tmpdir(), 'wt-env-'));
  const git = (...args) => execFileSync('git', ['-C', main, '-c', 'user.email=t@t', '-c', 'user.name=t', ...args], { encoding: 'utf8' });
  git('init', '-q', '-b', 'main');
  git('commit', '-q', '--allow-empty', '-m', 'init');
  writeFileSync(join(main, '.env'), 'APP_KEY=from-main\n');
  const tree = join(main, 'wt');
  git('worktree', 'add', '-q', '-b', 't01', tree);
  assert.deepEqual(ensureSecrets(join(tree, '.env'), ['APP_KEY']), []);
  assert.equal(parseDotEnv(readFileSync(join(tree, '.env'), 'utf8')).APP_KEY, 'from-main');
});
