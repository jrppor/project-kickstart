// /kickstart: ตรวจว่าสกิลที่ชุดเรียกใช้มีไฟล์อยู่บนเครื่อง (รันจากโฟลเดอร์โปรเจกต์)
// สกิลที่ตั้ง disable-model-invocation ไม่อยู่ในรายการที่ Claude เห็น จึงต้องตรวจจากไฟล์
// พิมพ์เฉพาะที่ขาด ไม่พิมพ์อะไรเลยถ้าครบ · exit 0 เสมอ (เตือน ไม่บล็อก)
// KICKSTART_HOME แทนโฟลเดอร์ home ได้ (ใช้ตอนทดสอบ)
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const REQUIRED = ['setup-matt-pocock-skills', 'grill-with-docs', 'to-spec', 'to-tickets', 'implement', 'code-review'];
const RECOMMENDED = ['implement-spec', 'tdd', 'diagnosing-bugs', 'handoff', 'improve-codebase-architecture'];

const dirs = [join(process.env.KICKSTART_HOME || homedir(), '.claude', 'skills'), join(process.cwd(), '.claude', 'skills')];
const missing = (names) => names.filter((n) => !dirs.some((d) => existsSync(join(d, n, 'SKILL.md'))));

const req = missing(REQUIRED);
const rec = missing(RECOMMENDED);
if (req.length) console.log(`ขาด (จำเป็น): ${req.join(' ')}`);
if (rec.length) console.log(`ขาด (แนะนำ): ${rec.join(' ')}`);
if (req.length || rec.length) console.log('ติดตั้ง: npx skills@latest add mattpocock/skills (ถ้าติดตั้งแบบปลั๊กอินของ Claude Code ไว้แล้ว ข้อความนี้อาจผิด ข้ามได้)');
