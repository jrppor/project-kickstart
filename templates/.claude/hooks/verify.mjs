#!/usr/bin/env node
// Claude Code hook (wired in .claude/settings.json).
//   stop    Before Claude ends a turn, re-run the fast checks for each area whose files changed since the
//           last green run. A failure exits 2, which sends the output back to Claude to fix first.
//   format  After an Edit/Write, format the edited file. A formatter error (e.g. a syntax error) goes back to Claude.
// The last green run is kept per worktree in <git-dir>/claude-verify.json, so an unchanged area is not re-checked.
// {gitDir} in a command is this worktree's git dir (e.g. a build output that must not lock the dev server's bin/).
//
// วิธีใช้: ใส่ CHECKS หนึ่งชุดต่อหนึ่งส่วนประกอบ (โฟลเดอร์) ให้แต่ละชุดจบใน ~30 วินาที
// area คือ regex ของ path ที่ถ้าเปลี่ยนแล้วต้องตรวจชุดนี้ cwd คือโฟลเดอร์ที่รันคำสั่ง (โปรเจกต์ส่วนเดียวใช้ ".")
// ตัวอย่างข้างล่างเป็นแค่ stack ตัวอย่าง ชื่อโฟลเดอร์ (api/, ui/, app/) ให้เปลี่ยนตามโปรเจกต์จริง
// เทสต์ที่ช้า (integration ที่ต้องใช้ DB จริง, e2e, build แอปเต็ม) ไม่ต้องใส่ ให้เขียนไว้ใน CLAUDE.md ว่ารันก่อน commit
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const CHECKS = [
  // Go
  // { name: "api", area: /^api\/.*\.(go|mod|sum)$/, cwd: "api", cmds: ["go build ./...", "go vet ./..."] },
  //
  // Node / Next.js / TypeScript
  // { name: "ui", area: /^ui\/.*\.(tsx?|mjs|cjs|js|json)$/, cwd: "ui", needs: "node_modules",
  //   cmds: ["npx tsc --noEmit", "npx eslint .", "npx vitest run --silent"] },
  //
  // .NET (build ลง git dir เพื่อไม่ชนกับ dotnet run ที่ล็อก bin/ ไว้)
  // { name: "api", area: /^(api\/.*\.(cs|csproj|props|json)|.*\.slnx?)$/, cwd: ".",
  //   cmds: [`dotnet build -nologo -v q -clp:ErrorsOnly --artifacts-path "{gitDir}/claude-verify-build"`,
  //          `dotnet test tests/My.UnitTests --no-build -nologo -v q --artifacts-path "{gitDir}/claude-verify-build"`] },
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
];

const OUTPUT_TAIL_LINES = 60;

const input = parseInput();
let root;
try {
  root = gitText(input.cwd || process.cwd(), "rev-parse", "--show-toplevel");
} catch {
  process.exit(0); // not inside the repo: nothing to check
}

if (process.argv[2] === "format") format();
else if (process.argv[2] === "stop") stop();

function parseInput() {
  try {
    return JSON.parse(readFileSync(0, "utf8") || "{}");
  } catch {
    return {};
  }
}

function format() {
  const file = input.tool_input?.file_path;
  const formatter = file && FORMATTERS.find((f) => f.match.test(file));
  if (!formatter || !existsSync(file)) return;
  const [bin, args] = formatter.cmd(file);
  const r = spawnSync(bin, args, { encoding: "utf8" });
  if (r.status !== 0) {
    process.stderr.write(`${bin} ${path.relative(root, file)} ไม่ผ่าน:\n${r.stderr || r.error?.message}`);
    process.exit(2);
  }
}

function stop() {
  const gitDir = gitText(root, "rev-parse", "--absolute-git-dir");
  const stampPath = path.join(gitDir, "claude-verify.json");
  const stamp = readJson(stampPath);
  stamp.checks ??= {};
  const head = gitText(root, "rev-parse", "HEAD");
  const changed = changedFiles(stamp.head, head);

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
    const failed = check.cmds.some((cmd) => {
      const r = spawnSync(cmd.replaceAll("{gitDir}", gitDir), { cwd: dir, shell: true, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
      if (r.status === 0) return false;
      failures.push(`[${check.name}] \`${cmd}\` ล้ม (exit ${r.status}) ใน ${check.cwd}/\n${tail(`${r.stdout}${r.stderr}`)}`);
      return true;
    });
    if (!failed) stamp.checks[check.name] = print;
  }

  if (failures.length === 0) {
    stamp.head = head;
    delete stamp.lastFailure;
    writeJson(stampPath, stamp);
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
  return execFileSync("git", ["-C", cwd, "-c", "core.quotepath=false", ...args], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
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
