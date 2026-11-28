#!/usr/bin/env node
// Claude Code hook (wired in .claude/settings.json).
//   stop           Before Claude ends a turn, re-run the fast checks for each area whose files changed since the
//                  last green run. A failure exits 2, which sends the output back to Claude to fix first.
//   subagent-stop  The same checks when a subagent finishes, but only for one that worked in its own worktree
//                  (e.g. /implement-spec workers). Stop does not fire for subagents, so without this they are never gated.
//   format         After an Edit/Write, format the edited file. A formatter error (e.g. a syntax error) goes back to Claude.
//   commit         PreToolUse on Bash: blocks `git commit` while a check area with changed files has no green run for those files.
//                  It re-runs nothing; it only reads the last green run that `stop` recorded. Any other Bash command exits at once.
//   isolation-guard PreToolUse on Agent: refuses isolation: "worktree" on Windows when the session path starts with a lowercase drive.
//   worktree-create WorktreeCreate (on trial, not wired in the template's settings.json): makes the worktree itself and returns its
//                  real-case path, so isolation: "worktree" also works from a lowercase-drive session (project-kickstart I-050).
//   session-start  Adds context only when the situation calls for it: the worktree rules (WORKTREE_RULES) when the session
//                  was opened inside a linked worktree, and a warning when a Windows session path starts with a lowercase drive.
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
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
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
// รันคำสั่งของด่านผ่านตัวคุมเล็กๆ ที่ฆ่าทั้งต้นไม้โปรเซสเมื่อเกินเวลา (timeout ของ spawnSync ฆ่าได้แค่ shell ตัวหุ้ม โปรเซสลูกบน Windows ค้างต่อ)
// ผ่านการทดสอบบน Windows แล้ว ส่วน macOS/Linux ใช้ process group (detached + kill -pid) ยังไม่ได้ลองบนเครื่องจริง
const CHECK_RUNNER = `
const { spawn, spawnSync } = require("node:child_process");
const [cmd, ms] = [process.argv[1], Number(process.argv[2])];
const win = process.platform === "win32";
const child = spawn(cmd, { shell: true, stdio: "inherit", detached: !win });
const timer = setTimeout(() => {
  if (win) spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"]);
  else try { process.kill(-child.pid, "SIGKILL"); } catch {}
  process.exit(124);
}, ms);
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
const LOWERCASE_DRIVE_NOTE =
  "path ของ session นี้ขึ้นต้นด้วยไดรฟ์ตัวเล็ก (เปิดจากส่วนขยาย VS Code) บน Claude Code บางรุ่น การเรียก agent แบบ isolation: worktree จะถูกปฏิเสธ " +
  "(Refusing to use … as an isolation worktree) ก่อนเริ่มงานที่ให้ agent ย่อยทำขนานกัน ให้บอกผู้ใช้ว่าควรเปิด session จาก path ที่ขึ้นต้นด้วยไดรฟ์ตัวใหญ่ " +
  "(แอป Claude หรือ terminal) หรือทำทีละใบ อย่าสร้าง worktree เองแทนโดยไม่ถามผู้ใช้";

const input = parseInput();
const mode = process.argv[2];
if (mode === "session-start" || mode === "subagent-start") {
  startContext();
  process.exit(0);
}
if (mode === "isolation-guard") {
  isolationGuard();
  process.exit(0);
}
if (mode === "worktree-create") {
  worktreeCreate();
  process.exit(0);
}
// PreToolUse รันทุกคำสั่ง Bash: ที่ไม่ใช่ git commit ออกทันที ก่อนเรียก git ใดๆ
if (mode === "commit" && !GIT_COMMIT.test(String(input.tool_input?.command ?? ""))) process.exit(0);
const root = mode === "subagent-stop" ? subagentWorktree() : projectRoot();
if (!root) process.exit(0); // nothing of this project to check

if (mode === "format") format();
else if (mode === "commit") commitGate();
else if (mode === "stop" || mode === "subagent-stop") {
  stop();
  if (mode === "subagent-stop") unlockOwnWorktree();
}

// ก่อน git commit (PreToolUse): ไม่รันเช็กซ้ำ แค่ดูว่าส่วนที่มีไฟล์เปลี่ยนมีผลเขียวล่าสุดตรงกับไฟล์ตอนนี้หรือไม่ ไม่ตรง = บล็อก
// ด่านรันตอนจบเทิร์น แต่ commit ระหว่างเทิร์นไม่มีอะไรกั้น (project-kickstart I-043)
function commitGate() {
  const gitDir = gitText(root, "rev-parse", "--absolute-git-dir");
  const stamp = readJson(path.join(gitDir, "claude-verify.json"));
  const changed = changedFiles(stamp.head ?? worktreeBase(gitDir), currentHead());
  const stale = CHECKS.filter((check) => {
    const files = changed.filter((f) => check.area.test(f));
    return files.length > 0 && stamp.checks?.[check.name] !== fingerprint(files);
  }).map((check) => check.name);
  if (stale.length === 0) return;
  process.stderr.write(
    `ยังไม่ commit: ด่านยังไม่เขียวกับไฟล์ที่เปลี่ยนในส่วน ${stale.join(", ")} (ไม่เคยรัน หรือไฟล์เปลี่ยนหลังรันครั้งล่าสุด)\n` +
      `รันด่านก่อน: echo {} | node .claude/hooks/verify.mjs stop แก้ที่แดงให้เขียว แล้วค่อย commit ใหม่\n`,
  );
  process.exit(2);
}

// PreToolUse ของเครื่องมือ Agent: บน Windows ที่ path ของ session ขึ้นต้นด้วยไดรฟ์ตัวเล็ก Claude Code บางรุ่นปฏิเสธ isolation: worktree
// ทุกครั้งและทิ้ง worktree ที่ locked ไว้ จึงปฏิเสธการเรียกนั้นก่อนสร้าง (project-kickstart I-045 · ถอดออกเมื่อ Claude Code แก้ ดู I-027)
// ตั้ง KICKSTART_ISOLATION_OK=1 ใน environment เพื่อข้ามเมื่อรุ่นที่ใช้แก้แล้ว
function isolationGuard() {
  if (input.tool_input?.isolation !== "worktree" || process.env.KICKSTART_ISOLATION_OK === "1" || createsOwnWorktrees()) return;
  if (process.platform !== "win32" || !/^[a-z]:/.test(input.cwd || process.cwd())) return;
  process.stderr.write(
    "ไม่สร้าง worktree แยก: session นี้เปิดจาก path ไดรฟ์ตัวเล็ก (c:\\…) Claude Code บางรุ่นปฏิเสธ isolation: worktree ในกรณีนี้ทุกครั้งและทิ้ง worktree ที่ locked ไว้ " +
      "ห้ามลองซ้ำ และห้ามสร้าง worktree เองแทนโดยไม่ถามผู้ใช้ ให้บอกผู้ใช้ว่าควรเปิด session ใหม่จาก path ที่ขึ้นต้นด้วยไดรฟ์ตัวใหญ่ (แอป Claude หรือ terminal) หรือทำทีละใบด้วย /implement\n",
  );
  process.exit(2);
}

// โปรเจกต์ต่อ hook WorktreeCreate ไว้หรือไม่ (ด่านสร้าง worktree เอง จึงไม่ต้องปฏิเสธหรือเตือนเรื่องไดรฟ์ตัวเล็ก)
function createsOwnWorktrees() {
  const base = process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd();
  return ["settings.json", "settings.local.json"].some((name) => (readJson(path.join(base, ".claude", name)).hooks?.WorktreeCreate ?? []).length > 0);
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
  if (mode === "session-start" && process.platform === "win32" && /^[a-z]:/.test(here) && !createsOwnWorktrees()) notes.push(LOWERCASE_DRIVE_NOTE);
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

  const failures = [];
  const failedKeys = []; // which check and command failed, without its output (timings in the output change every run)
  for (const check of CHECKS) {
    const files = changed.filter((f) => check.area.test(f));
    if (files.length === 0) continue;
    const print = fingerprint(files);
    if (stamp.checks[check.name] === print) continue;

    const dir = path.join(root, check.cwd);
    if (check.needs && !existsSync(path.join(dir, check.needs))) {
      const install = check.install ? `ให้รัน \`${check.install}\`` : "ให้ติดตั้ง dependency ของส่วนนี้";
      failures.push(`[${check.name}] ไม่มี ${check.cwd}/${check.needs} ${install} ใน ${check.cwd}/ ก่อน แล้วจบงานใหม่`);
      failedKeys.push(`${check.name}:needs`);
      continue;
    }
    const cmds = typeof check.cmds === "function" ? check.cmds(files) : check.cmds;
    const failed = cmds.some((cmd) => {
      const r = spawnSync(process.execPath, ["-e", CHECK_RUNNER, cmd.replaceAll("{gitDir}", gitDir), String(CHECK_TIMEOUT_MS)], { cwd: dir, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, timeout: CHECK_TIMEOUT_MS + 15_000 });
      if (r.status === 0) return false;
      const timedOut = r.status === 124 || r.error?.code === "ETIMEDOUT";
      const why = timedOut ? `เกิน ${CHECK_TIMEOUT_MS / 1000} วินาที คำสั่งค้างหรือช้าเกินสำหรับด่าน` : `exit ${r.status}`;
      failures.push(`[${check.name}] \`${cmd}\` ล้ม (${why}) ใน ${check.cwd}/\n${tail(`${r.stdout ?? ""}${r.stderr ?? ""}`)}`);
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
