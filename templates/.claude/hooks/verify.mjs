#!/usr/bin/env node
// Claude Code hook (wired in .claude/settings.json).
//   stop           Before Claude ends a turn, re-run the fast checks for each area whose files changed since the
//                  last green run. A failure exits 2, which sends the output back to Claude to fix first.
//   subagent-stop  The same checks when a subagent finishes, but only for one that worked in its own worktree
//                  (e.g. /implement-spec workers). Stop does not fire for subagents, so without this they are never gated.
//   format         After an Edit/Write, format the edited file. A formatter error (e.g. a syntax error) goes back to Claude.
// A stop also measures CLAUDE.md and docs/progress.md (LENGTH_LIMITED_DOCS): over the limit is a warning to the user that does
//                  not block; over 1.5x the limit blocks, but only when this run edited that file (an old long file must not block other work).
// The last green run is kept per worktree in <git-dir>/claude-verify.json, so an unchanged area is not re-checked.
// {gitDir} in a command is this worktree's git dir (e.g. a build output that must not lock the dev server's bin/).
//
// วิธีใช้: ใส่ CHECKS หนึ่งชุดต่อหนึ่งส่วนประกอบ (โฟลเดอร์) ให้แต่ละชุดจบใน ~30 วินาที
// area คือ regex ของ path ที่ถ้าเปลี่ยนแล้วต้องตรวจชุดนี้ cwd คือโฟลเดอร์ที่รันคำสั่ง (โปรเจกต์ส่วนเดียวใช้ ".")
// cmds เป็นรายการคำสั่ง หรือฟังก์ชันที่รับไฟล์ที่เปลี่ยน (path จากราก repo) แล้วคืนรายการคำสั่ง
// area ใส่ไฟล์ของส่วนอื่นที่ส่วนนี้พึ่งได้ เช่น ไฟล์สัญญา API ที่ ui ใช้ หรือไฟล์ตั้งค่า build ที่รากคลัง
// ตัวอย่างข้างล่างเป็นแค่ stack ตัวอย่าง ชื่อโฟลเดอร์ (api/, ui/, app/) ให้เปลี่ยนตามโปรเจกต์จริง
// เทสต์ที่ช้า (integration ที่ต้องใช้ DB จริง, e2e, build แอปเต็ม) ไม่ต้องใส่ ให้เขียนไว้ใน CLAUDE.md ว่ารันก่อน commit
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const CHECKS = [
  // Go: หนึ่งชุดต่อ go module (ไม่ใช่ต่อโดเมน) area รวมไฟล์ที่ถูก go:embed ด้วย เช่น สัญญา SQL template
  // module อยู่ที่รากคลัง
  // { name: "go", area: /\.(go|mod|sum|sql|gohtml|yaml)$/, cwd: ".", cmds: ["go build ./...", "go vet ./...", "go test -short ./..."] },
  // module อยู่ในโฟลเดอร์ api/ ของคลังที่มีหลายส่วนประกอบ
  // { name: "api", area: /^api\/.*\.(go|mod|sum|sql)$/, cwd: "api", cmds: ["go build ./...", "go vet ./..."] },
  //
  // Node / Next.js / TypeScript (ไฟล์สัญญา API ที่ ui ใช้อยู่ใน area ด้วย แก้สัญญาแล้ว ui ถูกตรวจทันที)
  // { name: "ui", area: /^ui\/.*\.(tsx?|mjs|cjs|js|json)$|^api\/openapi\.json$/, cwd: "ui", needs: "node_modules",
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
  // { name: "tooling", area: /^scripts\/.*\.mjs$/, cwd: ".",
  //   cmds: (files) => [...files.map((f) => `node --check ${f}`), `node --test "scripts/*.test.mjs"`] },
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
  // { match: /\.go$/, cmd: (file) => ["gofmt", ["-w", file]] },
  // { match: /\.py$/, cmd: (file) => ["ruff", ["format", file]] },
  // needs: ข้ามเมื่อยังไม่ได้ติดตั้ง (path จากรากของ worktree ที่ไฟล์อยู่) ใส่ทุกตัวที่เรียกของใน node_modules หรือ venv
  // เพราะ worktree ที่ agent เพิ่งสร้างยังไม่ได้ติดตั้ง ถ้าไม่ใส่ hook จะล้มทุกครั้งที่ agent แก้ไฟล์ · cmd รับ (file, base) base = รากของ worktree นั้น
  // { match: /^.*[\\/]ui[\\/].*\.(tsx?|css)$/, needs: "ui/node_modules", cmd: (file) => ["node", ["ui/node_modules/prettier/bin/prettier.cjs", "--write", file]] },
];

const OUTPUT_TAIL_LINES = 60;
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
    how: "ฟีเจอร์ที่ merge แล้วเหลือแถวเดียว (ชื่อ · commit ที่ merge · ลิงก์ .scratch/<ฟีเจอร์>/) ย้ายประวัติขั้นและเรื่องที่ตัดสินแล้วทั้งก้อนไป .scratch/<ฟีเจอร์>/log.md (ห้ามสรุปทิ้ง) ตามพรอมต์ P9",
  },
];

const input = parseInput();
const mode = process.argv[2];
const root = mode === "subagent-stop" ? subagentWorktree() : projectRoot();
if (!root) process.exit(0); // nothing of this project to check

if (mode === "format") format();
else if (mode === "stop" || mode === "subagent-stop") stop();

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
  const head = gitText(root, "rev-parse", "HEAD");
  const changed = changedFiles(stamp.head ?? worktreeBase(gitDir), head);

  const failures = [];
  for (const check of CHECKS) {
    const files = changed.filter((f) => check.area.test(f));
    if (files.length === 0) continue;
    const print = fingerprint(files);
    if (stamp.checks[check.name] === print) continue;

    const dir = path.join(root, check.cwd);
    if (check.needs && !existsSync(path.join(dir, check.needs))) {
      failures.push(`[${check.name}] ไม่มี ${check.cwd}/${check.needs} ให้รัน \`npm ci\` ใน ${check.cwd}/ ก่อน แล้วจบงานใหม่`);
      continue;
    }
    const cmds = typeof check.cmds === "function" ? check.cmds(files) : check.cmds;
    const failed = cmds.some((cmd) => {
      const r = spawnSync(cmd.replaceAll("{gitDir}", gitDir), { cwd: dir, shell: true, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
      if (r.status === 0) return false;
      failures.push(`[${check.name}] \`${cmd}\` ล้ม (exit ${r.status}) ใน ${check.cwd}/\n${tail(`${r.stdout}${r.stderr}`)}`);
      return true;
    });
    if (!failed) stamp.checks[check.name] = print;
  }

  const warnings = [];
  for (const doc of LENGTH_LIMITED_DOCS) {
    const notice = docNotice(doc);
    if (notice?.level === "red" && changed.includes(doc.file)) failures.push(`[${doc.name}] ${notice.text}`);
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
  const reportHash = sha(report);
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
