// ไฟล์ environment ของเครื่อง dev (.env ที่รากคลัง ไม่เข้า git): อ่านค่า และสร้าง secret ที่ยังไม่มีให้ครั้งแรก

import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { dirname, join, relative, resolve } from 'node:path';

export function parseDotEnv(text) {
  const values = {};
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (match) values[match[1]] = unquote(match[2]);
  }
  return values;
}

// ค่าในเครื่องหมายคำพูดใช้ตามที่เขียน (มี # และช่องว่างได้) ค่าที่ไม่มีเครื่องหมายคำพูดตัดคอมเมนต์ท้ายบรรทัด (ช่องว่างตามด้วย #) ออก
function unquote(raw) {
  const quoted = /^(["'])(.*)\1(\s+#.*)?$/.exec(raw);
  if (quoted) return quoted[2];
  return raw.replace(/\s+#.*$/, '');
}

// worktree ที่สร้างด้วย git worktree add ไม่มี .env (ไฟล์ไม่เข้า git และ .worktreeinclude ทำงานเฉพาะ worktree ที่ Claude Code สร้าง)
// ถ้าปล่อยให้สร้างค่าลับใหม่ จะไม่ตรงกับของโฟลเดอร์หลักที่ container ใช้อยู่ จึงคัดลอกไฟล์ของโฟลเดอร์หลักมาก่อน (project-kickstart I-038)
function seedFromMainCheckout(file) {
  const dir = dirname(file);
  if (existsSync(file) || !existsSync(dir)) return;
  const git = (flag) => spawnSync('git', ['rev-parse', flag], { cwd: dir, encoding: 'utf8' });
  const [own, common, top] = [git('--git-dir'), git('--git-common-dir'), git('--show-toplevel')];
  if (own.status !== 0 || common.status !== 0 || top.status !== 0) return;
  const commonDir = resolve(dir, common.stdout.trim());
  if (resolve(dir, own.stdout.trim()) === commonDir) return; // โฟลเดอร์หลักเอง
  const source = join(dirname(commonDir), relative(resolve(top.stdout.trim()), resolve(file)));
  if (existsSync(source)) copyFileSync(source, file);
}

/**
 * ใส่ค่าสุ่ม 48 ไบต์ให้ทุกชื่อใน names ที่ยังไม่มีหรือค่าว่าง แล้วคืนรายชื่อที่สร้าง
 * ค่าที่มีอยู่แล้วไม่แตะต้อง เพราะ secret เปลี่ยน = token หรือข้อมูลที่เข้ารหัสไว้แล้วใช้ไม่ได้
 */
export function ensureSecrets(file, names) {
  seedFromMainCheckout(file);
  let text = existsSync(file) ? readFileSync(file, 'utf8') : '';
  const existing = parseDotEnv(text);
  const created = names.filter((name) => !existing[name]);
  for (const name of created) {
    const line = `${name}=${randomBytes(48).toString('base64')}`;
    const blank = new RegExp(`^[ \\t]*${name}[ \\t]*=[ \\t]*(?=\\r?$)`, 'm');
    if (blank.test(text)) text = text.replace(blank, line);
    else text = `${text}${text === '' || text.endsWith('\n') ? '' : '\n'}${line}\n`;
  }
  if (created.length > 0) writeFileSync(file, text);
  return created;
}

/**
 * ตัวกันของ dev (กำลังลอง · I-035): คืนชื่อใน required ที่ยังไม่ได้ตั้ง เมื่อ cwd อยู่ใน worktree ที่ git สร้าง (ไม่ใช่โฟลเดอร์หลัก)
 * อ่านจาก environment ของคำสั่งเท่านั้น ไม่นับ .env เพราะ .env ของ worktree คัดลอกมาจาก dev ค่าที่ลืมตั้งจึงตกไปเป็นของ dev
 * สคริปต์ที่ยก container หรือแตะฐานต้องเรียกก่อนทำงาน และหยุดเมื่อคืนรายชื่อ
 */
export function missingWorktreeEnv(cwd, required, env = process.env) {
  if (required.length === 0) return [];
  const git = (flag) => spawnSync('git', ['rev-parse', flag], { cwd, encoding: 'utf8' });
  const dir = git('--git-dir');
  const common = git('--git-common-dir');
  if (dir.status !== 0 || common.status !== 0) return [];
  if (resolve(cwd, dir.stdout.trim()) === resolve(cwd, common.stdout.trim())) return [];
  return required.filter((name) => !env[name]);
}
