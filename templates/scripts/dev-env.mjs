// ไฟล์ environment ของเครื่อง dev (.env ที่รากคลัง ไม่เข้า git): อ่านค่า และสร้าง secret ที่ยังไม่มีให้ครั้งแรก

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';

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

/**
 * ใส่ค่าสุ่ม 48 ไบต์ให้ทุกชื่อใน names ที่ยังไม่มีหรือค่าว่าง แล้วคืนรายชื่อที่สร้าง
 * ค่าที่มีอยู่แล้วไม่แตะต้อง เพราะ secret เปลี่ยน = token หรือข้อมูลที่เข้ารหัสไว้แล้วใช้ไม่ได้
 */
export function ensureSecrets(file, names) {
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
