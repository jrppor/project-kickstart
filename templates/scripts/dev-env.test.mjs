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
