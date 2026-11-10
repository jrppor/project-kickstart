// รันส่วนประกอบของระบบบนเครื่อง dev โดยโหลดค่าจาก .env ที่รากคลัง (ไม่เข้า git) เป็น environment ให้
// แอปอ่าน secret จาก environment เท่านั้น ห้ามมีค่าจริงในไฟล์ config ที่ commit
//
//   node scripts/run.mjs <ส่วนประกอบ>          ตาม COMPONENTS ด้านล่าง
//   node scripts/run.mjs serve <โฟลเดอร์> <พอร์ต>  เปิดไฟล์ HTML นิ่ง เช่น prototype หรือ mockup (ใช้ใน launch.json แทน python)
//
// แก้เฉพาะ COMPONENTS, GENERATED_SECRETS และ toAppEnv ให้ตรงโปรเจกต์ ใช้ใน launch.json และใน README

import { spawn } from 'node:child_process';
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureSecrets, parseDotEnv } from './dev-env.mjs';

// ส่วนประกอบ → [คำสั่ง, argument] ตัวอย่าง (ลบที่ไม่ใช้):
const COMPONENTS = {
  // api: ['dotnet', ['run', '--project', 'backend/src/My.WebApi']],
  // api: ['go', ['run', './api/cmd/api']],
  // worker: ['dotnet', ['run', '--project', 'backend/src/My.Worker']],
  // ui: ['npm', ['--prefix', 'ui', 'run', 'dev']],
};

// secret ของเครื่อง dev ที่สร้างให้เองครั้งแรก (ค่าสุ่ม) แล้วใช้ค่าเดิมตลอด เช่น กุญแจเซ็น token
const GENERATED_SECRETS = [
  // 'APP_AUTH_SIGNING_KEY',
];

// แปลงชื่อใน .env เป็นชื่อที่แอปอ่าน เช่น .NET ใช้ __ แทนระดับของ config
function toAppEnv(env) {
  // env.Database__Password ??= env.APP_DB_PASSWORD;
  // env.Auth__SigningKey ??= env.APP_AUTH_SIGNING_KEY;
  // env.ASPNETCORE_ENVIRONMENT = 'Development';
}

// โปรแกรมที่เป็นไฟล์ .exe จริงบน Windows รันตรงได้ ตัวอื่นรันผ่าน shell
const DIRECT_COMMANDS = ['node', 'dotnet', 'go', 'python', 'cargo', 'java'];

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const [target, ...rest] = process.argv.slice(2);

if (target === 'serve') serve(rest[0], Number(rest[1] ?? 5173));
else run(target);

function run(name) {
  if (!COMPONENTS[name]) {
    console.error(`ใช้: node scripts/run.mjs <${Object.keys(COMPONENTS).join('|')}> หรือ serve <โฟลเดอร์> <พอร์ต>`);
    process.exit(1);
  }
  const dotEnv = join(root, '.env');
  for (const created of ensureSecrets(dotEnv, GENERATED_SECRETS)) console.log(`สร้าง ${created} ใหม่ใน .env ครั้งต่อไปจะใช้ค่าเดิม`);

  const env = { ...process.env };
  if (existsSync(dotEnv)) {
    for (const [key, value] of Object.entries(parseDotEnv(readFileSync(dotEnv, 'utf8')))) env[key] ??= value;
  }
  toAppEnv(env);

  const [command, args] = COMPONENTS[name];
  // บน Windows ตัวรันอย่าง npm, pnpm, yarn, npx, flutter, gradlew เป็นไฟล์ .cmd/.bat ต้องรันผ่าน shell
  const viaShell = process.platform === 'win32' && !DIRECT_COMMANDS.includes(command);
  const child = viaShell
    ? spawn([command, ...args].map(quoteForShell).join(' '), { cwd: root, env, stdio: 'inherit', shell: true })
    : spawn(command, args, { cwd: root, env, stdio: 'inherit' });
  child.on('error', (error) => {
    console.error(`รัน ${command} ไม่ได้: ${error.message}`);
    process.exit(1);
  });
  // ถูกปิดด้วย signal (code เป็น null) ไม่นับว่าสำเร็จ
  child.on('exit', (code) => process.exit(code ?? 1));
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
}

function quoteForShell(arg) {
  return /^[\w@%+=:,./\\-]+$/.test(arg) ? arg : `"${arg.replaceAll('"', '\\"')}"`;
}

function serve(folder, port) {
  const base = join(root, folder ?? '.');
  const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json' };
  createServer((req, res) => {
    let file;
    try {
      file = join(base, normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)));
    } catch {
      return res.writeHead(400).end('bad request');
    }
    if (!file.startsWith(base)) return res.writeHead(403).end();
    if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html');
    if (!existsSync(file)) return res.writeHead(404).end('not found');
    res.writeHead(200, { 'content-type': types[extname(file)] ?? 'application/octet-stream' });
    createReadStream(file).pipe(res);
  }).listen(port, '127.0.0.1', () => console.log(`เปิด ${folder} ที่ http://localhost:${port}`));
}
