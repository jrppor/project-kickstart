// ตรวจกฎห้าม (deny) ใน .claude/settings.json กับคำสั่งที่ลำดับงานต้องใช้
// กฎห้ามจับทั้งบรรทัดคำสั่งด้วยรูปแบบข้อความ กฎที่กว้างเกินจึงบล็อกงานปกติได้ เช่น `git * -c *` เคยบล็อก `git switch -c`
// แก้กฎห้ามเมื่อไร ให้เพิ่มคำสั่งที่กฎนั้นต้องกันลง MUST_BLOCK และคำสั่งปกติที่หน้าตาใกล้กันลง MUST_PASS
// ข้อจำกัด: การจับคู่เป็นการประมาณ (`*` แทนอักขระอะไรก็ได้ ที่เหลือเทียบตรงตัว) ไม่ได้จำลองการแยกคำสั่งพ่วง
// หรือการถอดเครื่องหมายคำพูดของ Claude Code เทสต์เขียวจึงไม่ได้แปลว่ากฎกันได้ครบ
// รู้อยู่แล้วและคงไว้: ข้อความ commit ที่มี ` -n ` `--no-verify` หรือ `--output` ชนกฎห้ามของแม่แบบ (แคบลงแล้วเลี่ยง --no-verify ได้)
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const file = process.env.SETTINGS_FILE ?? new URL("../.claude/settings.json", import.meta.url);
const deny = JSON.parse(readFileSync(file, "utf8")).permissions?.deny ?? [];
const bashDeny = deny.filter((r) => r.startsWith("Bash(") && r.endsWith(")")).map((r) => r.slice(5, -1));
const toRegex = (p) => new RegExp("^" + p.split("*").map((s) => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*") + "$", "s");
const hits = (cmd) => bashDeny.filter((p) => toRegex(p).test(cmd));
const bashAsk = (JSON.parse(readFileSync(file, "utf8")).permissions?.ask ?? []).filter((r) => r.startsWith("Bash(") && r.endsWith(")")).map((r) => r.slice(5, -1));
const askHits = (cmd) => bashAsk.filter((p) => toRegex(p).test(cmd));

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

// คำสั่งทำลายข้อมูลต้องถูกถามก่อน รวมรูปที่มีตัวเลือกคั่นกลาง (กฎ ask จับรูปตรงตัว รูปที่ไม่ตรงจะรันโดยไม่ถาม)
const MUST_ASK = [
  "docker compose down -v",
  "docker compose -p wt01 down -v",
  "docker compose -p wt01 down --volumes",
  "git checkout -- a.txt",
  "git -C .claude/worktrees/ticket-01 checkout -- a.txt",
  "git -C .claude/worktrees/ticket-01 reset --hard",
  "git -C .claude/worktrees/ticket-01 clean -fd",
  "git -C . branch -D ticket-01",
  "git -C .claude/worktrees/ticket-01 restore a.txt",
  "git -C . stash drop",
  "git -C . worktree remove --force .claude/worktrees/ticket-01",
  "rm -rf build",
];
// คำสั่งปกติที่หน้าตาใกล้กัน ต้องไม่ถูกถาม (รู้อยู่แล้วและคงไว้: git -C <path> commit ที่ข้อความมีคำว่า restore หรือ reset --hard ถูกถามด้วย)
const MUST_NOT_ASK = [
  "docker compose -p wt01 down",
  "git checkout -b feature-x",
  "git -C .claude/worktrees/ticket-01 status --short",
  "git -C . branch -d ticket-01",
  'git -C .claude/worktrees/ticket-01 commit -m "fix: clean up unused imports"',
  'git commit -m "docs: docker compose -p x down -v explained"',
];
for (const cmd of MUST_ASK) test(`ถูกถามก่อน: ${cmd}`, () => assert.notEqual(askHits(cmd).length, 0));
for (const cmd of MUST_NOT_ASK) test(`ไม่ถูกถาม: ${cmd}`, () => assert.deepEqual(askHits(cmd), []));

// กฎฝั่ง PowerShell (project-kickstart I-042) ลองกับ Claude Code จริงแล้วว่า: จับคู่แบบไม่แยกตัวพิมพ์ และชื่อย่อของ cmdlet (rm · ri · del)
// ถูกแปลงเป็นชื่อเต็มก่อนเทียบกฎ เทสต์นี้จำลองแค่ข้อแรก จึงเขียนคำสั่งลบด้วยชื่อเต็ม
// ไม่มีกฎคู่ของ `git branch -D`: เพราะไม่แยกตัวพิมพ์ กฎนั้นจะถาม `git branch -d` (ลบ branch ที่ merge แล้ว) ไปด้วย
const psRules = (kind) => (JSON.parse(readFileSync(file, "utf8")).permissions?.[kind] ?? []).filter((r) => r.startsWith("PowerShell(") && r.endsWith(")")).map((r) => r.slice(11, -1));
const psAsk = psRules("ask");
const psDeny = psRules("deny");
const psHits = (rules, cmd) => rules.filter((p) => new RegExp(toRegex(p).source, "si").test(cmd));
const MUST_ASK_PS = [
  "git restore .",
  "git stash drop",
  "git -C . reset --hard",
  "git -C . clean -fd",
  "git -C . checkout -- a.txt",
  "git -C . worktree remove --force wt2",
  "docker compose -p wt01 down -v",
  "docker compose -p wt01 down --volumes",
  "docker volume rm data",
  "Remove-Item -Recurse -Force build",
  "Remove-Item build -r",
];
const MUST_NOT_ASK_PS = ["git branch -d ticket-01", "git status --short", "docker compose -p wt01 down", "Remove-Item notes.txt", 'git commit -m "docs: tidy"'];
const MUST_BLOCK_PS = ["git push --force origin main", "git push origin main --force", 'git commit --no-verify -m "x"', "git -C . push --force origin main"];
for (const cmd of MUST_ASK_PS) test(`PowerShell ถูกถามก่อน: ${cmd}`, () => assert.notEqual(psHits(psAsk, cmd).length, 0));
for (const cmd of MUST_NOT_ASK_PS) test(`PowerShell ไม่ถูกถาม: ${cmd}`, () => assert.deepEqual(psHits(psAsk, cmd), []));
for (const cmd of MUST_BLOCK_PS) test(`PowerShell ถูกห้าม: ${cmd}`, () => assert.notEqual(psHits(psDeny, cmd).length, 0));
// เพิ่มกฎ ask ฝั่ง Bash เมื่อไร ต้องเพิ่มคู่ฝั่ง PowerShell ด้วย ไม่อย่างนั้นคำสั่งเดียวกันหลุดเมื่อ agent เลือกเครื่องมือ PowerShell
const NO_PS_TWIN = new Set(["rm -rf *", "git branch -D *", "git -* branch -D *"]);
test("กฎ ask ของ Bash ทุกข้อมีคู่ฝั่ง PowerShell (ยกเว้นที่ระบุใน NO_PS_TWIN)", () => assert.deepEqual(bashAsk.filter((p) => !NO_PS_TWIN.has(p) && !psAsk.includes(p)), []));

// hook ก่อน git commit ต้องครอบทุกเครื่องมือที่รันคำสั่ง shell ได้ ไม่อย่างนั้น commit ผ่านอีกเครื่องมือหนึ่งไม่ถูกกั้น (project-kickstart I-052)
test("hook ก่อน git commit ครอบทั้ง Bash และ PowerShell", () => {
  const pre = JSON.parse(readFileSync(file, "utf8")).hooks?.PreToolUse ?? [];
  const entry = pre.find((e) => (e.hooks ?? []).some((h) => String(h.command).includes("verify.mjs") && String(h.command).trim().endsWith(" commit")));
  assert.ok(entry, "ไม่พบ hook ของโหมด commit ใน PreToolUse");
  for (const tool of ["Bash", "PowerShell"]) assert.match(tool, new RegExp(`^(${entry.matcher})$`), `matcher ไม่ครอบ ${tool}`);
});
