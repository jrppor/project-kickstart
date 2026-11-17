// ตรวจกฎห้าม (deny) ใน .claude/settings.json กับคำสั่งที่ลำดับงานต้องใช้ (กำลังลอง · I-031)
// กฎห้ามจับทั้งบรรทัดคำสั่งด้วยรูปแบบข้อความ กฎที่กว้างเกินจึงบล็อกงานปกติได้ เช่น `git * -c *` เคยบล็อก `git switch -c`
// แก้กฎห้ามเมื่อไร ให้เพิ่มคำสั่งที่กฎนั้นต้องกันลง MUST_BLOCK และคำสั่งปกติที่หน้าตาใกล้กันลง MUST_PASS
// ข้อจำกัด: การจับคู่เป็นการประมาณ (`*` แทนอักขระอะไรก็ได้ ที่เหลือเทียบตรงตัว) ไม่ได้จำลองการแยกคำสั่งพ่วง
// หรือการถอดเครื่องหมายคำพูดของ Claude Code เทสต์เขียวจึงไม่ได้แปลว่ากฎกันได้ครบ
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const file = process.env.SETTINGS_FILE ?? new URL("../.claude/settings.json", import.meta.url);
const deny = JSON.parse(readFileSync(file, "utf8")).permissions?.deny ?? [];
const bashDeny = deny.filter((r) => r.startsWith("Bash(") && r.endsWith(")")).map((r) => r.slice(5, -1));
const toRegex = (p) => new RegExp("^" + p.split("*").map((s) => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*") + "$", "s");
const hits = (cmd) => bashDeny.filter((p) => toRegex(p).test(cmd));

// คำสั่งที่ขั้น 5 ถึง 7 ใช้จริง ต้องไม่ชนกฎห้ามข้อใด
const MUST_PASS = [
  "git switch -c feature-x",
  "git checkout -b feature-x",
  "git worktree add -b ticket-01 .claude/worktrees/ticket-01",
  'git merge --no-ff ticket-01 -m "merge ticket 01"',
  'git commit -m "settings: narrow the -c rule to -c key=value"',
  'git commit -m "docs: explain why [x] changed?"',
  "git -C .claude/worktrees/ticket-01 status --short",
  "git -C .claude/worktrees/ticket-01 log --oneline -5",
];
// คำสั่งที่กฎห้ามมีไว้กัน ต้องชนอย่างน้อยหนึ่งกฎ
const MUST_BLOCK = [
  "git push --force origin main",
  'git commit --no-verify -m "x"',
  "git -C . -c core.fsmonitor=calc status",
  "git -C . --config-env=core.fsmonitor=X status",
  "git -C . diff --output=leak.txt",
];

for (const cmd of MUST_PASS) test(`ไม่ถูกห้าม: ${cmd}`, () => assert.deepEqual(hits(cmd), []));
for (const cmd of MUST_BLOCK) test(`ถูกห้าม: ${cmd}`, () => assert.notEqual(hits(cmd).length, 0));
