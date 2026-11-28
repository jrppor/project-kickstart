#!/usr/bin/env node
// Claude Code hook (wired in .claude/settings.json).
//   stop           Before Claude ends a turn, re-run the fast checks for each area whose files changed since the
//                  last green run. A failure exits 2, which sends the output back to Claude to fix first.
//   subagent-stop  The same checks when a subagent finishes, but only for one that worked in its own worktree
//                  (e.g. /implement-spec workers). Stop does not fire for subagents, so without this they are never gated.
//   format         After an Edit/Write, format the edited file. A formatter error (e.g. a syntax error) goes back to Claude.
//   commit         PreToolUse on Bash and PowerShell: blocks `git commit` while a check area with changed files has no green run for those files.
//                  It re-runs nothing; it only reads the last green run that `stop` (and `slow`) recorded. Any other command exits at once.
//   slow           On trial, not wired in settings.json yet (project-kickstart I-048). A second Stop hook with "asyncRewake": true:
//                  once the fast gate is green it runs SLOW_CHECKS in the background, so the turn ends without waiting.
//                  Red exits 2, which wakes Claude with the output; green says nothing. One run at a time per worktree.
//   worktree-create WorktreeCreate: makes the worktree itself (replacing Claude Code's own worktree creation) and returns its
//                  real-case path, so isolation: "worktree" also works from a lowercase-drive session (project-kickstart I-050).
//   session-start  Adds context only when the situation calls for it: the worktree rules (WORKTREE_RULES) when the session
//                  was opened inside a linked worktree.
//   subagent-start The worktree rules for every subagent that may write (not the read-only types in READ_ONLY_AGENTS).
// A stop also measures CLAUDE.md and docs/progress.md (LENGTH_LIMITED_DOCS): over the limit is a warning to the user that does
//                  not block; over 1.5x the limit blocks, but only when this run edited that file (an old long file must not block other work).
// The last green run is kept per worktree in <git-dir>/claude-verify.json, so an unchanged area is not re-checked.
// {gitDir} in a command is this worktree's git dir (e.g. a build output that must not lock the dev server's bin/).
//
// วิธีใช้: ใส่ CHECKS หนึ่งชุดต่อหนึ่งส่วนประกอบ (โฟลเดอร์) ให้แต่ละชุดจบใน ~30 วินาที
// area คือ regex ของ path ที่ถ้าเปลี่ยนแล้วต้องตรวจชุดนี้ cwd คือโฟลเดอร์ที่รันคำสั่ง (โปรเจกต์ส่วนเดียวใช้ ".")
// cmds เป็นรายการคำสั่ง หรือฟังก์ชันที่รับไฟล์ที่เปลี่ยน (path จากราก repo) แล้วคืนรายการคำสั่ง
// area ใส่ไฟล์ของส่วนอื่นที่ส่วนนี้พึ่งได้ เช่น ไฟล์สัญญา API ที่ ui ใช้ หรือไฟล์ตั้งค่า build ที่รากคลัง
// needs คือไฟล์หรือโฟลเดอร์ (จาก cwd) ที่ต้องมีก่อนรัน เช่น node_modules หรือ .venv · install คือคำสั่งติดตั้งที่จะบอกเมื่อยังไม่มี
// ตัวอย่างข้างล่างเป็นแค่ stack ตัวอย่าง ชื่อโฟลเดอร์ (api/, ui/, app/) ให้เปลี่ยนตามโปรเจกต์จริง
// เทสต์ที่ช้า (integration ที่ต้องใช้ DB จริง, e2e, build แอปเต็ม) ไม่ต้องใส่ ให้เขียนไว้ใน CLAUDE.md ว่ารันก่อน commit
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

const CHECKS = [
  // Go: หนึ่งชุดต่อ go module (ไม่ใช่ต่อโดเมน) area รวมไฟล์ที่ถูก go:embed ด้วย เช่น สัญญา SQL template
  // module อยู่ที่รากคลัง
  // { name: "go", area: /\.(go|mod|sum|sql|gohtml|yaml)$/, cwd: ".", cmds: ["go build ./...", "go vet ./...", "go test -short ./..."] },
  // module อยู่ในโฟลเดอร์ api/ ของคลังที่มีหลายส่วนประกอบ
  // { name: "api", area: /^api\/.*\.(go|mod|sum|sql)$/, cwd: "api", cmds: ["go build ./...", "go vet ./..."] },
  //
  // Node / Next.js / TypeScript (ไฟล์สัญญา API ที่ ui ใช้อยู่ใน area ด้วย แก้สัญญาแล้ว ui ถูกตรวจทันที)
  // { name: "ui", area: /^ui\/.*\.(tsx?|mjs|cjs|js|json)$|^api\/openapi\.json$/, cwd: "ui", needs: "node_modules", install: "npm ci",
  //   cmds: ["npx tsc --noEmit", "npx eslint .", "npx vitest run --silent"] },
  //
  // .NET: build ลง git dir เพื่อไม่ชนกับ dotnet run ที่ล็อก bin/ ไว้
  // fast.slnf คือ solution filter ที่มีแค่ project ของโค้ดกับเทสต์เร็ว (unit + architecture) ไม่ build ทั้ง solution
  // และรัน dotnet test ครั้งเดียว ไม่แยกทีละ project
  // { name: "api", area: /^(api\/.*\.(cs|csproj|json)|Directory\.(Build|Packages)\.props|global\.json|\.editorconfig|.*\.slnx?|.*\.slnf)$/, cwd: ".",
  //   cmds: [`dotnet build fast.slnf -nologo -v q -clp:ErrorsOnly --artifacts-path "{gitDir}/claude-verify-build"`,
  //          `dotnet test fast.slnf --no-build -nologo -v q --artifacts-path "{gitDir}/claude-verify-build"`] },
  //
  // สคริปต์ของคลัง: ตรวจทุกไฟล์ที่แก้ (cmds เป็นฟังก์ชัน) แล้วรันเทสต์ของสคริปต์
  // area รวม .claude/hooks/ และ .claude/settings.json ด้วย เพื่อให้แก้ด่านหรือแก้กฎแล้วเทสต์ของมัน (scripts/verify.test.mjs · scripts/settings-rules.test.mjs) รันให้
  // { name: "tooling", area: /^(scripts|\.claude\/hooks)\/.*\.mjs$|^\.claude\/settings\.json$/, cwd: ".",
  //   cmds: (files) => [...files.filter((f) => f.endsWith(".mjs")).map((f) => `node --check "${f}"`), `node --test "scripts/*.test.mjs"`] },
  //
  // Python
  // { name: "app", area: /^(src|tests)\/.*\.py$|^pyproject\.toml$/, cwd: ".", cmds: ["ruff check .", "pytest -q -x"] },
  //
  // โปรเจกต์ส่วนเดียว เช่น CLI หรือ library ภาษา Go (golden test อยู่ใน go test)
  // { name: "cli", area: /\.(go|mod|sum)$|^testdata\//, cwd: ".", cmds: ["go build ./...", "go vet ./...", "go test ./... -short"] },
  //
  // Flutter (mobile/desktop) ไม่ต้อง build แอปเต็มในด่าน
  // { name: "app", area: /^(lib|test)\/.*\.dart$|^pubspec\.yaml$/, cwd: ".", cmds: ["flutter analyze", "flutter test"] },
];

// เทสต์ที่ช้าเกินด่านตอนจบเทิร์น (โหมด slow · อยู่ระหว่างลอง ยังไม่ต่อ hook ใน settings.json) รูปเดียวกับ CHECKS ปล่อยว่าง = ไม่มีอะไรเปลี่ยนเลย
// รันเบื้องหลังหลังด่านเร็วเขียว แดงแล้ว Claude ถูกปลุกพร้อมผล และ git commit ถูกบล็อกจนกว่าจะเขียวกับไฟล์ชุดนั้น
// ชุดที่ใช้โฟลเดอร์ build ร่วมกับชุดใน CHECKS ให้ใส่ cwd เดียวกัน ด่านเร็วจะหยุดรอบที่ยังรันอยู่ก่อนรันในโฟลเดอร์นั้น
const SLOW_CHECKS = [
  // { name: "app-full", area: /^(lib|test|integration_test)\/.*\.dart$|^pubspec\.yaml$/, cwd: ".", cmds: ["flutter test integration_test"] },
];

const FORMATTERS = [
  // cmd คืน [โปรแกรม, argument] รันตรงโดยไม่ผ่าน shell: บน Windows ห้ามใช้ npx/npm/pnpm (เป็นไฟล์ .cmd) ให้เรียก node กับ path ของสคริปต์แทน
  // โปรแกรมที่หาไม่เจอบนเครื่อง = ข้ามพร้อมคำเตือน ไม่บล็อกการแก้ไฟล์
  // { match: /\.go$/, cmd: (file) => ["gofmt", ["-w", file]] },
  // { match: /\.py$/, cmd: (file) => ["ruff", ["format", file]] },
  // needs: ข้ามเมื่อยังไม่ได้ติดตั้ง (path จากรากของ worktree ที่ไฟล์อยู่) ใส่ทุกตัวที่เรียกของใน node_modules หรือ venv
  // เพราะ worktree ที่ agent เพิ่งสร้างยังไม่ได้ติดตั้ง ถ้าไม่ใส่ hook จะล้มทุกครั้งที่ agent แก้ไฟล์ · cmd รับ (file, base) base = รากของ worktree นั้น
  // { match: /^.*[\\/]ui[\\/].*\.(tsx?|css)$/, needs: "ui/node_modules", cmd: (file) => ["node", ["ui/node_modules/prettier/bin/prettier.cjs", "--write", file]] },
];

const OUTPUT_TAIL_LINES = 60;
// เวลาสูงสุดต่อหนึ่งคำสั่งของด่าน คำสั่งที่ค้าง (เช่น เทสต์โหมด watch) ถูกตัดแล้วรายงานเป็นด่านแดง ไม่ปล่อยให้ hook หมดเวลาเงียบๆ
const CHECK_TIMEOUT_MS = 120_000;
// เวลาสูงสุดต่อหนึ่งคำสั่งของ SLOW_CHECKS ต้องน้อยกว่า timeout ของ hook โหมด slow ใน settings.json
const SLOW_TIMEOUT_MS = 900_000;
// hook สองตัวของ Stop เริ่มพร้อมกัน โหมด slow รอเท่านี้ให้ด่านเร็วประกาศว่ากำลังรันก่อน แล้วรอจนด่านเร็วจบ
const SLOW_START_DELAY_MS = 3000;
// รันคำสั่งของด่านผ่านตัวคุมเล็กๆ ที่ฆ่าทั้งต้นไม้โปรเซสเมื่อเกินเวลา (timeout ของ spawnSync ฆ่าได้แค่ shell ตัวหุ้ม โปรเซสลูกบน Windows ค้างต่อ)
// ผ่านการทดสอบบน Windows แล้ว ส่วน macOS/Linux ใช้ process group (detached + kill -pid) ยังไม่ได้ลองบนเครื่องจริง
const CHECK_RUNNER = `
const { spawn, spawnSync } = require("node:child_process");
const [cmd, ms] = [process.argv[1], Number(process.argv[2])];
const win = process.platform === "win32";
const child = spawn(cmd, { shell: true, stdio: "inherit", detached: !win });
const stop = (code) => {
  if (win) spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"]);
  else try { process.kill(-child.pid, "SIGKILL"); } catch {}
  process.exit(code);
};
const timer = setTimeout(() => stop(124), ms);
process.on("SIGTERM", () => stop(143));
child.on("exit", (code) => { clearTimeout(timer); process.exit(code ?? 1); });
child.on("error", () => process.exit(1));
`;
// เพดาน CLAUDE.md ที่รากคลัง นับเป็นตัวอักษร (ไม่ใช่ไบต์ ไม่นับ \r) ทุก session และทุก agent อ่านทั้งไฟล์ก่อนเริ่มงาน
// รายละเอียดเฉพาะเรื่องย้ายไป docs/guides/<เรื่อง>.md แล้วเหลือบรรทัดชี้ทางใน CLAUDE.md
const CLAUDE_MD_LIMIT = { chars: 8000, lineChars: 500, redFactor: 1.5 };
// เพดาน docs/progress.md ใช้กติกาเดียวกัน แต่ไม่จำกัดต่อบรรทัด (แถวของตารางฟีเจอร์เป็นบรรทัดเดียวที่ยาวได้) ฟีเจอร์ที่ merge แล้วเหลือแถวเดียว ประวัติอยู่ที่ .scratch/<ฟีเจอร์>/log.md
const PROGRESS_LIMIT = { chars: 8000, lineChars: Infinity, redFactor: 1.5 };
// ไฟล์ที่ถูกวัดความยาวทุกครั้งที่จบเทิร์น: เหลือง = เตือนผู้ใช้ ไม่บล็อก · แดง (เกิน 1.5 เท่า) = บล็อกเฉพาะเมื่อรอบนั้นแก้ไฟล์นี้เอง
const LENGTH_LIMITED_DOCS = [
  {
    name: "claude-md",
    file: "CLAUDE.md",
    limit: CLAUDE_MD_LIMIT,
    how: "ย้ายรายละเอียดเฉพาะเรื่องไป docs/guides/<เรื่อง>.md ทั้งเนื้อหาเดิม (ห้ามสรุปทิ้ง) แล้วเหลือบรรทัดชี้ทางในตาราง \"ก่อนแตะเรื่องไหน อ่านอะไร\" ของ CLAUDE.md",
  },
  {
    name: "progress",
    file: "docs/progress.md",
    limit: PROGRESS_LIMIT,
    how: "ฟีเจอร์ที่ merge แล้วเหลือแถวเดียว (ชื่อ · commit ที่ merge · วันที่ merge · ลิงก์ .scratch/<ฟีเจอร์>/) ย้ายประวัติขั้นและเรื่องที่ตัดสินแล้วทั้งก้อนไป .scratch/<ฟีเจอร์>/log.md (ห้ามสรุปทิ้ง) ตามพรอมต์ P9",
  },
];

// กติกาที่ใช้เฉพาะตอนทำงานใน worktree อยู่นอก CLAUDE.md แล้วส่งเข้าบริบทตอนเริ่ม (project-kickstart I-037)
const WORKTREE_RULES = "docs/guides/worktree.md";
const GIT_COMMIT = /\bgit\b[^;&|\n]*\scommit(\s|$)/;
const READ_ONLY_AGENTS =/^(Explore|Plan|claude-code-guide|statusline-setup|web-fetch)$/;
// เหตุผลที่ใส่ตอน lock worktree ที่ด่านสร้างเอง (โหมด worktree-create) ด่านปลดเฉพาะ lock ที่มีเหตุผลนี้
const WORKTREE_LOCK_REASON = "claude agent at work (project-kickstart)";

const input = parseInput();
const mode = process.argv[2];
if (mode === "session-start" || mode === "subagent-start") {
  startContext();
  process.exit(0);
}
if (mode === "worktree-create") {
  worktreeCreate();
  process.exit(0);
}
// PreToolUse รันทุกคำสั่งของ Bash และ PowerShell: ที่ไม่ใช่ git commit ออกทันที ก่อนเรียก git ใดๆ
if (mode === "commit" && !GIT_COMMIT.test(String(input.tool_input?.command ?? ""))) process.exit(0);
const root = mode === "subagent-stop" ? subagentWorktree() : projectRoot();
if (!root) process.exit(0); // nothing of this project to check

if (mode === "format") format();
else if (mode === "commit") commitGate();
else if (mode === "slow") await slow();
else if (mode === "stop" || mode === "subagent-stop") {
  stop();
  if (mode === "subagent-stop") unlockOwnWorktree();
}

// ก่อน git commit (PreToolUse): ไม่รันเช็กซ้ำ แค่ดูว่าส่วนที่มีไฟล์เปลี่ยนมีผลเขียวล่าสุดตรงกับไฟล์ตอนนี้หรือไม่ ไม่ตรง = บล็อก
// ด่านรันตอนจบเทิร์น แต่ commit ระหว่างเทิร์นไม่มีอะไรกั้น (project-kickstart I-043) · เทสต์ช้าที่ยังรันอยู่หรือยังไม่เขียวก็บล็อกเช่นกัน (I-048)
function commitGate() {
  const gitDir = gitText(root, "rev-parse", "--absolute-git-dir");
  const stale = staleChecks(gitDir);
  const slowLines = slowStatus(gitDir);
  if (stale.length > 0) {
    process.stderr.write(
      `ยังไม่ commit: ด่านยังไม่เขียวกับไฟล์ที่เปลี่ยนในส่วน ${stale.join(", ")} (ไม่เคยรัน หรือไฟล์เปลี่ยนหลังรันครั้งล่าสุด)\n` +
        `รันด่านก่อน: echo {} | node .claude/hooks/verify.mjs stop แก้ที่แดงให้เขียว แล้วค่อย commit ใหม่\n`,
    );
  }
  if (slowLines.length > 0) {
    process.stderr.write(
      `ยังไม่ commit: เทสต์ช้ายังไม่เขียวกับไฟล์ที่เปลี่ยน\n${slowLines.join("\n")}\n` +
        `รอรอบที่รันอยู่ให้จบ หรือรันเองแล้วรอผล (นาน ให้รันแบบเบื้องหลัง): echo {} | node .claude/hooks/verify.mjs slow\n`,
    );
  }
  if (stale.length > 0 || slowLines.length > 0) process.exit(2);
}

// ชื่อชุดของด่านเร็วที่ยังไม่เขียวกับไฟล์ที่เปลี่ยนตอนนี้
function staleChecks(gitDir) {
  const stamp = readJson(path.join(gitDir, "claude-verify.json"));
  const changed = changedFiles(stamp.head ?? worktreeBase(gitDir), currentHead());
  return CHECKS.filter((check) => {
    const files = changed.filter((f) => check.area.test(f));
    return files.length > 0 && stamp.checks?.[check.name] !== fingerprint(files);
  }).map((check) => check.name);
}

// สถานะเทสต์ช้าของ worktree นี้: ผลเขียวและผลล้มล่าสุดอยู่ใน <git-dir>/claude-verify-slow.json รอบที่กำลังรันอยู่ใน claude-verify-slow.lock
// prints = ลายนิ้วมือไฟล์ตอนนี้ของแต่ละชุดที่มีไฟล์เปลี่ยน · due = ชุดที่ยังไม่เขียวกับไฟล์ตอนนี้ · running = รอบที่โปรเซสยังอยู่
function slowState(gitDir) {
  const stamp = { checks: {}, failed: {}, ...readJson(path.join(gitDir, "claude-verify-slow.json")) };
  const changed = changedFiles(stamp.head ?? worktreeBase(gitDir), currentHead());
  const prints = {};
  const due = [];
  for (const check of SLOW_CHECKS) {
    const files = changed.filter((f) => check.area.test(f));
    if (files.length === 0) continue;
    prints[check.name] = fingerprint(files);
    if (stamp.checks[check.name] !== prints[check.name]) due.push({ check, files, print: prints[check.name] });
  }
  const lock = readJson(path.join(gitDir, "claude-verify-slow.lock"));
  return { stamp, prints, due, running: alive(lock.pid) ? lock : null };
}

// บรรทัดสถานะให้ hook ก่อน commit: ชุดไหนกำลังรัน ล้มแล้ว หรือยังไม่ได้รัน · agent ย่อยไม่ถูกบล็อกด้วยเทสต์ช้า เพราะ hook Stop ไม่รันให้ agent ย่อย
// จึงไม่มีรอบของตัวเอง งานของ agent ถูกรันตอน session หลักจบเทิร์น (ไฟล์ที่ commit หลังผลเขียวล่าสุดนับเป็นไฟล์ที่เปลี่ยน)
function slowStatus(gitDir) {
  if (SLOW_CHECKS.length === 0 || input.agent_id) return [];
  const { stamp, due, running } = slowState(gitDir);
  return due.map(({ check, print }) => {
    if (running?.prints[check.name] === print) return `- ${check.name}: กำลังรันอยู่ (เริ่มมาแล้ว ${Math.round((Date.now() - running.started) / 1000)} วินาที)`;
    if (stamp.failed[check.name] === print) return `- ${check.name}: ล้มกับไฟล์ชุดนี้ แก้ให้ผ่านก่อน`;
    return `- ${check.name}: ยังไม่ได้รันกับไฟล์ชุดนี้ (รันให้เองหลังจบเทิร์น)`;
  });
}

// โหมด slow: hook Stop ตัวที่สองแบบ asyncRewake · exit 0 ไม่มีอะไรเข้าบริบท (บรรทัดใน stdout มีไว้ให้คนที่รันเองเห็น) · exit 2 ปลุก Claude ด้วย stderr
async function slow() {
  if (SLOW_CHECKS.length === 0) return;
  const gitDir = gitText(root, "rev-parse", "--absolute-git-dir");
  const fromHook = Boolean(input.hook_event_name);
  const say = (text) => void process.stdout.write(`${text}\n`);
  if (fromHook) await sleep(SLOW_START_DELAY_MS);
  while (alive(readJson(path.join(gitDir, "claude-verify-fast.lock")).pid)) await sleep(500);
  if (staleChecks(gitDir).length > 0) return say("ข้ามเทสต์ช้า: ด่านเร็วยังไม่เขียว");
  const { stamp, due, running } = slowState(gitDir);
  // ไฟล์ชุดที่ล้มไปแล้วไม่รันซ้ำเองตอนจบเทิร์น (ไม่ปลุก Claude วนด้วยผลเดิม) แต่รันเองซ้ำได้เสมอ
  const todo = fromHook ? due.filter((d) => stamp.failed[d.check.name] !== d.print) : due;
  if (todo.length === 0) return say(due.length > 0 ? "ข้ามเทสต์ช้า: ล้มกับไฟล์ชุดนี้ไปแล้ว และไฟล์ยังไม่เปลี่ยน" : "เทสต์ช้า: ไม่มีชุดที่ต้องรัน");
  if (running) return say(`ข้ามเทสต์ช้า: มีรอบที่กำลังรันอยู่ (pid ${running.pid})`);
  const lockPath = path.join(gitDir, "claude-verify-slow.lock");
  rmSync(lockPath, { force: true }); // lock ของโปรเซสที่ตายไปแล้ว
  const mine = { pid: process.pid, started: Date.now(), cwds: todo.map((d) => d.check.cwd), prints: Object.fromEntries(todo.map((d) => [d.check.name, d.print])) };
  try {
    writeFileSync(lockPath, JSON.stringify(mine), { flag: "wx" });
  } catch {
    return; // อีกโปรเซสเริ่มรอบไปก่อนในจังหวะเดียวกัน
  }
  try {
    const failures = new Map();
    for (const { check, files } of todo) {
      const missing = missingNeeds(check);
      if (missing) failures.set(check.name, missing);
      for (const cmd of missing ? [] : typeof check.cmds === "function" ? check.cmds(files) : check.cmds) {
        const r = await runInBackground(cmd, path.join(root, check.cwd), gitDir);
        if (r.status === 0) continue;
        failures.set(check.name, failText(check, cmd, r.status, SLOW_TIMEOUT_MS, r.output));
        break;
      }
    }
    const now = slowState(gitDir);
    if (todo.some((d) => now.prints[d.check.name] !== d.print)) return say("ทิ้งผลเทสต์ช้า: ไฟล์เปลี่ยนระหว่างรัน การจบเทิร์นครั้งถัดไปจะรันใหม่");
    for (const { check, print } of todo) {
      if (failures.has(check.name)) now.stamp.failed[check.name] = print;
      else (now.stamp.checks[check.name] = print), delete now.stamp.failed[check.name];
    }
    if (failures.size === 0 && now.due.length === todo.length) {
      // ทุกชุดเขียว: ขยับจุดเทียบมาที่ HEAD ตอนนี้ แล้วจดลายนิ้วมือเทียบกับจุดใหม่ (ไม่อย่างนั้นไฟล์ที่ commit ไปแล้วทำให้รอบหน้ารันซ้ำ)
      const head = currentHead();
      const dirty = changedFiles(head, head);
      now.stamp.head = head;
      now.stamp.checks = Object.fromEntries(SLOW_CHECKS.map((c) => [c.name, fingerprint(dirty.filter((f) => c.area.test(f)))]));
    }
    writeJson(path.join(gitDir, "claude-verify-slow.json"), now.stamp);
    if (failures.size === 0) return say(`เทสต์ช้าเขียว: ${todo.map((d) => d.check.name).join(", ")}`);
    process.stderr.write(
      `เทสต์ช้าไม่ผ่าน (รันเบื้องหลังหลังจบเทิร์น) แก้ให้ผ่าน หรือบอกผู้ใช้ว่าทำไมแก้ไม่ได้\n` +
        `ไฟล์ชุดเดิมจะไม่ถูกรันซ้ำเอง รันซ้ำเอง: echo {} | node .claude/hooks/verify.mjs slow\n\n${[...failures.values()].join("\n\n")}\n`,
    );
    process.exitCode = 2;
  } finally {
    rmSync(lockPath, { force: true });
  }
}

// รันคำสั่งของเทสต์ช้าแบบไม่บล็อก เพื่อให้รับ SIGTERM ได้ (macOS/Linux: ส่งต่อให้ตัวคุมฆ่าทั้งกลุ่มโปรเซส ยังไม่ได้ลองบนเครื่องจริง · Windows ใช้ taskkill /T จากข้างนอก)
function runInBackground(cmd, dir, gitDir) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, runnerArgs(cmd, gitDir, SLOW_TIMEOUT_MS), { cwd: dir });
    let output = "";
    for (const stream of [child.stdout, child.stderr]) stream.on("data", (data) => (output = (output + data).slice(-200_000)));
    const onTerm = () => (child.kill("SIGTERM"), process.exit(1));
    process.once("SIGTERM", onTerm);
    const end = (status) => (process.off("SIGTERM", onTerm), resolve({ status: status ?? 1, output }));
    child.on("close", end);
    child.on("error", () => end(1));
  });
}

// ด่านเร็วกับเทสต์ช้าไม่รันพร้อมกันในโฟลเดอร์เดียวกัน: ด่านเร็วหยุดรอบเทสต์ช้าที่ไฟล์เปลี่ยนไปแล้ว หรือที่ใช้ cwd ของชุดที่ด่านเร็วกำลังจะรัน
// ผลของรอบนั้นใช้ไม่ได้อยู่แล้ว โหมด slow ของการจบเทิร์นครั้งนี้เริ่มรอบใหม่เองหลังด่านเร็วจบ
function stopSlowRun(gitDir, cwd) {
  const { running, prints } = slowState(gitDir);
  if (!running) return;
  const stale = Object.entries(running.prints).some(([name, print]) => prints[name] !== print);
  if (!stale && !running.cwds.includes(cwd)) return;
  try {
    if (process.platform === "win32") spawnSync("taskkill", ["/PID", String(running.pid), "/T", "/F"]);
    else process.kill(running.pid, "SIGTERM");
  } catch {
    // โปรเซสจบไปก่อนแล้ว
  }
  rmSync(path.join(gitDir, "claude-verify-slow.lock"), { force: true });
}

function alive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function runnerArgs(cmd, gitDir, ms) {
  return ["-e", CHECK_RUNNER, cmd.replaceAll("{gitDir}", gitDir), String(ms)];
}

function failText(check, cmd, status, ms, output) {
  const why = status === 124 ? `เกิน ${ms / 1000} วินาที คำสั่งค้างหรือช้าเกินสำหรับด่าน` : `exit ${status}`;
  return `[${check.name}] \`${cmd}\` ล้ม (${why}) ใน ${check.cwd}/\n${tail(output)}`;
}

function missingNeeds(check) {
  if (!check.needs || existsSync(path.join(root, check.cwd, check.needs))) return null;
  const install = check.install ? `ให้รัน \`${check.install}\`` : "ให้ติดตั้ง dependency ของส่วนนี้";
  return `[${check.name}] ไม่มี ${check.cwd}/${check.needs} ${install} ใน ${check.cwd}/ ก่อน แล้วจบงานใหม่`;
}

// WorktreeCreate: แทนการสร้าง worktree ของ Claude Code ทั้งหมด (agent แบบ isolation: worktree · claude --worktree · EnterWorktree)
// บน Windows ที่ session เปิดจากไดรฟ์ตัวเล็ก Claude Code เทียบ path ของ worktree ที่สร้างเองกับ path ที่ git รายงานแล้วปฏิเสธ
// ด่านจึงสร้างเองแล้วคืน path ตัวพิมพ์จริง (บรรทัดสุดท้ายของ stdout) · แตกจาก HEAD ของ checkout ที่ session อยู่ · คัดลอกไฟล์ตาม .worktreeinclude
// worktree ของ agent ย่อยถูก lock ระหว่างทำงาน (subagent-stop ปลดเมื่อด่านของ worktree นั้นผ่าน) · exit ไม่เป็น 0 = Claude Code ถือว่าสร้างไม่สำเร็จ
function worktreeCreate() {
  const fail = (text) => {
    process.stderr.write(`สร้าง worktree ไม่ได้: ${text}\n`);
    process.exit(1);
  };
  const name = String(input.name ?? "");
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name)) fail(`ชื่อ "${name}" ใช้ไม่ได้ (ใช้ได้เฉพาะตัวอักษร ตัวเลข . _ -)`);
  const here = toplevel(input.cwd) ?? toplevel(process.env.CLAUDE_PROJECT_DIR);
  if (!here) fail("ไม่พบ git repo ของ session นี้");
  const main = gitText(here, "worktree", "list", "--porcelain").split("\n")[0].replace(/^worktree /, "");
  const dir = path.join(main, ".claude", "worktrees", name);
  if (!existsSync(dir)) {
    const branch = `worktree-${name}`;
    let base;
    try {
      base = gitText(here, "rev-parse", "--verify", "HEAD");
      const exists = spawnSync("git", ["-C", main, "rev-parse", "--verify", "--quiet", `refs/heads/${branch}`]).status === 0;
      // lock เฉพาะ worktree ของ agent ย่อย (ชื่อ agent-…) ซึ่งมี subagent-stop มาปลด · worktree ของ session (claude --worktree) ไม่มีใครปลด จึงไม่ lock
      const lock = name.startsWith("agent-") ? ["--lock", "--reason", WORKTREE_LOCK_REASON] : [];
      gitRaw(main, "worktree", "add", ...lock, ...(exists ? [dir, branch] : ["-b", branch, dir, base]));
    } catch (error) {
      fail(String(error.stderr || error.message).trim());
    }
    // จุดเริ่มของ worktree ให้ด่านใช้หาไฟล์ที่ agent commit ไปแล้ว (worktreeBase)
    writeFileSync(path.join(gitText(dir, "rev-parse", "--absolute-git-dir"), "CLAUDE_BASE"), base);
    copyIncluded(here, dir);
  } else if (!toplevel(dir) || path.resolve(toplevel(dir)) !== path.resolve(dir)) {
    fail(`${dir} มีอยู่แล้วแต่ไม่ใช่ worktree ของ repo นี้`);
  }
  process.stdout.write(`${realpathSync.native(dir)}\n`);
}

// ไฟล์ที่ git ignore และตรงกับ .worktreeinclude (syntax เดียวกับ .gitignore) คัดลอกจาก checkout ของ session ไป worktree ใหม่
// Claude Code ไม่ทำขั้นนี้ให้เมื่อโปรเจกต์ต่อ hook WorktreeCreate เอง · คัดลอกไม่ได้ไม่ทำให้การสร้าง worktree ล้ม
function copyIncluded(from, to) {
  const list = path.join(from, ".worktreeinclude");
  if (!existsSync(list)) return;
  try {
    const matched = gitRaw(from, "ls-files", "--others", "--ignored", `--exclude-from=${list}`, "-z").split("\0")
      .filter((f) => f && !f.endsWith("/") && !/(^|\/)(node_modules|\.venv|\.git)\//.test(f) && !f.startsWith(".claude/worktrees/"));
    if (matched.length === 0) return;
    const ignored = spawnSync("git", ["-C", from, "-c", "core.quotepath=false", "check-ignore", "-z", "--stdin"], { input: matched.join("\0"), encoding: "utf8" });
    for (const f of (ignored.stdout ?? "").split("\0").filter(Boolean)) {
      mkdirSync(path.dirname(path.join(to, f)), { recursive: true });
      copyFileSync(path.join(from, f), path.join(to, f));
    }
  } catch (error) {
    process.stderr.write(`คัดลอกไฟล์ตาม .worktreeinclude ไม่ครบ: ${error.message}\n`);
  }
}

// ปลด lock ที่โหมด worktree-create ใส่ไว้ เมื่อ agent ของ worktree นั้นจบและด่านผ่านแล้ว (lock ของคนอื่นไม่แตะ)
function unlockOwnWorktree() {
  try {
    const reason = readFileSync(path.join(gitText(root, "rev-parse", "--absolute-git-dir"), "locked"), "utf8");
    if (reason.trim() === WORKTREE_LOCK_REASON) gitRaw(root, "worktree", "unlock", root);
  } catch {
    // ไม่ได้ lock หรือไม่ใช่ worktree ที่ด่านสร้าง
  }
}

// ส่งข้อความเข้าบริบทเฉพาะเมื่อถึงสถานการณ์ ไม่พิมพ์อะไรเลยเมื่อไม่เข้าเงื่อนไข (session ปกติไม่เสียบริบท)
function startContext() {
  const here = input.cwd || process.cwd();
  const notes = [];
  const top = toplevel(here) ?? toplevel(process.env.CLAUDE_PROJECT_DIR);
  const wanted = mode === "subagent-start" ? !READ_ONLY_AGENTS.test(input.agent_type ?? "") : Boolean(top) && isLinkedWorktree(top);
  const rules = top ? path.join(top, WORKTREE_RULES) : null;
  if (wanted && rules && existsSync(rules)) notes.push(readFileSync(rules, "utf8").replace(/<!--[\s\S]*?-->\n?/g, "").trim());
  if (notes.length === 0) return;
  const hookEventName = mode === "session-start" ? "SessionStart" : "SubagentStart";
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName, additionalContext: notes.join("\n\n") } }));
}

function parseInput() {
  try {
    return JSON.parse(readFileSync(0, "utf8") || "{}");
  } catch {
    return {};
  }
}

// The worktree Claude is working in. A Bash `cd` can leave input.cwd outside the repo (a scratch folder) or in
// another repo (a skills folder); then fall back to the project the session was opened in, instead of skipping.
function projectRoot() {
  const project = toplevel(process.env.CLAUDE_PROJECT_DIR);
  const here = toplevel(input.cwd || process.cwd());
  if (here && (!project || sameRepo(here, project))) return here;
  return project;
}

// The worktree a finished subagent worked in, or null when it worked in the main checkout (the session's own Stop
// covers that, and a read-only agent must not be blocked by someone else's unfinished edits).
function subagentWorktree() {
  const project = toplevel(process.env.CLAUDE_PROJECT_DIR) ?? toplevel(input.cwd);
  if (!project) return null;
  for (const dir of [lastCwd(input.agent_transcript_path), input.cwd]) {
    const top = toplevel(dir);
    if (top && sameRepo(top, project) && isLinkedWorktree(top)) return top;
  }
  return null;
}

function lastCwd(transcript) {
  if (!transcript || !existsSync(transcript)) return null;
  const lines = readFileSync(transcript, "utf8").trimEnd().split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      const cwd = JSON.parse(lines[i]).cwd;
      if (cwd) return cwd;
    } catch {
      // a partly written last line
    }
  }
  return null;
}

function toplevel(dir) {
  if (!dir || !existsSync(dir)) return null;
  try {
    return gitText(dir, "rev-parse", "--show-toplevel");
  } catch {
    return null;
  }
}

function sameRepo(a, b) {
  const common = (dir) => path.resolve(dir, gitText(dir, "rev-parse", "--git-common-dir"));
  return common(a) === common(b);
}

function isLinkedWorktree(dir) {
  return path.resolve(dir, gitText(dir, "rev-parse", "--git-dir")) !== path.resolve(dir, gitText(dir, "rev-parse", "--git-common-dir"));
}

function format() {
  const file = input.tool_input?.file_path;
  const formatter = file && FORMATTERS.find((f) => f.match.test(file));
  if (!formatter || !existsSync(file)) return;
  // the worktree the file lives in, not the one the session sits in: an agent may edit across worktrees
  const base = toplevel(path.dirname(file)) ?? root;
  if (formatter.needs && !existsSync(path.join(base, formatter.needs))) return;
  const [bin, args] = formatter.cmd(file, base);
  const r = spawnSync(bin, args, { cwd: base, encoding: "utf8" });
  if (r.error?.code === "ENOENT") {
    // the formatter is not installed on this machine: warn, never block every edit
    process.stdout.write(JSON.stringify({ systemMessage: `ข้าม formatter: ไม่พบโปรแกรม ${bin} บนเครื่องนี้ (ติดตั้ง หรือแก้ FORMATTERS ใน .claude/hooks/verify.mjs)` }));
    return;
  }
  if (r.status !== 0) {
    process.stderr.write(`${bin} ${path.relative(base, file)} ไม่ผ่าน:\n${r.stderr || r.error?.message}`);
    process.exit(2);
  }
}

function stop() {
  const gitDir = gitText(root, "rev-parse", "--absolute-git-dir");
  const stampPath = path.join(gitDir, "claude-verify.json");
  const stamp = readJson(stampPath);
  stamp.checks ??= {};
  const head = currentHead(); // null in a repo with no commit yet
  const changed = changedFiles(stamp.head ?? worktreeBase(gitDir), head);
  if (SLOW_CHECKS.length > 0) {
    // ประกาศว่าด่านเร็วกำลังรัน ให้โหมด slow ของการจบเทิร์นเดียวกันรอ
    const fastLock = path.join(gitDir, "claude-verify-fast.lock");
    writeJson(fastLock, { pid: process.pid });
    process.on("exit", () => rmSync(fastLock, { force: true }));
    stopSlowRun(gitDir);
  }

  const failures = [];
  const failedKeys = []; // which check and command failed, without its output (timings in the output change every run)
  for (const check of CHECKS) {
    const files = changed.filter((f) => check.area.test(f));
    if (files.length === 0) continue;
    const print = fingerprint(files);
    if (stamp.checks[check.name] === print) continue;

    const dir = path.join(root, check.cwd);
    const missing = missingNeeds(check);
    if (missing) {
      failures.push(missing);
      failedKeys.push(`${check.name}:needs`);
      continue;
    }
    if (SLOW_CHECKS.length > 0) stopSlowRun(gitDir, check.cwd);
    const cmds = typeof check.cmds === "function" ? check.cmds(files) : check.cmds;
    const failed = cmds.some((cmd) => {
      const r = spawnSync(process.execPath, runnerArgs(cmd, gitDir, CHECK_TIMEOUT_MS), { cwd: dir, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, timeout: CHECK_TIMEOUT_MS + 15_000 });
      if (r.status === 0) return false;
      const timedOut = r.status === 124 || r.error?.code === "ETIMEDOUT";
      failures.push(failText(check, cmd, timedOut ? 124 : r.status, CHECK_TIMEOUT_MS, `${r.stdout ?? ""}${r.stderr ?? ""}`));
      failedKeys.push(`${check.name}:${cmd}`);
      return true;
    });
    if (!failed) stamp.checks[check.name] = print;
  }

  const warnings = [];
  for (const doc of LENGTH_LIMITED_DOCS) {
    const notice = docNotice(doc);
    if (notice?.level === "red" && changed.includes(doc.file)) {
      failures.push(`[${doc.name}] ${notice.text}`);
      failedKeys.push(`${doc.name}:length`);
    }
    else if (notice) warnings.push(notice.text);
  }

  if (failures.length === 0) {
    stamp.head = head;
    delete stamp.lastFailure;
    writeJson(stampPath, stamp);
    if (warnings.length > 0) process.stdout.write(JSON.stringify({ systemMessage: warnings.join("\n\n") }));
    return;
  }

  const report = failures.join("\n\n");
  const reportHash = sha(failedKeys.join("\n"));
  if (input.stop_hook_active && stamp.lastFailure === reportHash) {
    // Same failure as the previous block: Claude could not fix it, so let the turn end and tell the user.
    writeJson(stampPath, stamp);
    process.stdout.write(JSON.stringify({ systemMessage: `ด่านตรวจยังไม่ผ่าน (ผลเดิมซ้ำ):\n${report}` }));
    return;
  }
  stamp.lastFailure = reportHash;
  writeJson(stampPath, stamp);
  process.stderr.write(`ด่านตรวจไม่ผ่าน แก้ให้ผ่านก่อนจบงาน (หรือบอกผู้ใช้ว่าทำไมแก้ไม่ได้):\n\n${report}\n`);
  process.exit(2);
}

// null when the file is missing or within its limit; otherwise { level: "yellow" | "red", text }.
function docNotice({ file: rel, limit: { chars: limit, lineChars, redFactor }, how }) {
  const file = path.join(root, rel);
  if (!existsSync(file)) return null;
  const text = readFileSync(file, "utf8").replaceAll("\r", "");
  const chars = [...text].length;
  const long = text.split("\n").map((line, i) => ({ line: i + 1, length: [...line].length })).filter((l) => l.length > lineChars);
  const red = chars > limit * redFactor || long.some((l) => l.length > lineChars * redFactor);
  if (!red && chars <= limit && long.length === 0) return null;
  const parts = [];
  if (chars > limit) parts.push(`ทั้งไฟล์ ${chars} ตัวอักษร (เพดาน ${limit} แดงเมื่อเกิน ${limit * redFactor})`);
  if (long.length > 0) {
    const shown = long.slice(0, 10).map((l) => `บรรทัด ${l.line} ยาว ${l.length}`).join(" · ");
    parts.push(`บรรทัดเกิน ${lineChars} ตัวอักษร: ${shown}${long.length > 10 ? ` · และอีก ${long.length - 10} บรรทัด` : ""}`);
  }
  const head = red ? `${rel} ยาวเกินเพดานมาก` : `${rel} เกินเพดาน (เตือน ยังไม่บล็อก)`;
  return { level: red ? "red" : "yellow", text: `${head}: ${parts.join(" · ")}\n${how}` };
}

// Where a worktree with no green run yet started, so work an agent already committed is still checked.
// Claude Code records it in <git-dir>/CLAUDE_BASE (not documented, so fall back to the merge-base with the main checkout).
function worktreeBase(gitDir) {
  if (!isLinkedWorktree(root)) return undefined;
  const recorded = path.join(gitDir, "CLAUDE_BASE");
  if (existsSync(recorded)) return readFileSync(recorded, "utf8").trim();
  try {
    const main = gitText(root, "worktree", "list", "--porcelain").split("\n")[0].replace(/^worktree /, "");
    return gitText(root, "merge-base", "HEAD", gitText(main, "rev-parse", "HEAD"));
  } catch {
    return undefined;
  }
}

// Files dirty in the working tree, plus files committed since the last green run.
function changedFiles(sinceHead, head) {
  const files = new Set();
  const entries = gitRaw(root, "status", "--porcelain=v1", "-z", "-uall").split("\0");
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    if (entry.length < 4) continue;
    files.add(entry.slice(3));
    if (entry[0] === "R" || entry[0] === "C") files.add(entries[++i]); // the rename's source path
  }
  if (sinceHead && sinceHead !== head) {
    try {
      for (const f of gitRaw(root, "diff", "--name-only", "-z", sinceHead, head).split("\0")) if (f) files.add(f);
    } catch {
      // the old head is gone (rebased away): the working tree alone is all we can compare
    }
  }
  return [...files];
}

function fingerprint(files) {
  const hash = createHash("sha256");
  for (const f of [...files].sort()) {
    const full = path.join(root, f);
    hash.update(f).update("\0").update(existsSync(full) ? readFileSync(full) : "<deleted>").update("\0");
  }
  return hash.digest("hex");
}

function currentHead() {
  try {
    return gitText(root, "rev-parse", "--verify", "--quiet", "HEAD");
  } catch {
    return null;
  }
}

function gitRaw(cwd, ...args) {
  return execFileSync("git", ["-C", cwd, "-c", "core.quotepath=false", ...args], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });
}

function gitText(cwd, ...args) {
  return gitRaw(cwd, ...args).trim();
}

function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return {};
  }
}

function writeJson(file, value) {
  writeFileSync(file, JSON.stringify(value, null, 2));
}

function sha(text) {
  return createHash("sha256").update(text).digest("hex");
}

function tail(text) {
  return text.trimEnd().split(/\r?\n/).slice(-OUTPUT_TAIL_LINES).join("\n");
}
