// เทสต์ของ scripts/dev-env.mjs รันด้วย `node --test "scripts/*.test.mjs"` (Node 22+ ไม่รับชื่อโฟลเดอร์อย่างเดียว)
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { ensureSecrets, parseDotEnv } from './dev-env.mjs';

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
