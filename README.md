# project-kickstart

ชุดเริ่มโปรเจกต์ใหม่สำหรับทำงานคู่กับ Claude Code มีแผนลำดับขั้น พรอมต์พร้อมใช้ และไฟล์แม่แบบที่คัดลอกเข้า repo ใหม่ได้ทันที
ใช้ได้กับทุกรูปแบบ: Web API · เว็บ full-stack · frontend · mobile · desktop · console/CLI · background service · library หรือหลายส่วนรวมกัน

## เริ่มตรงไหน

**ครั้งแรกบนเครื่องนี้ ทำสองอย่างนี้ก่อน** (ครั้งเดียวต่อเครื่อง): ติดตั้ง Git และ Node.js แล้วทำตามหัวข้อ "สิ่งที่ต้องมีบนเครื่อง" (สกิลที่ต้องมี) กับ "ติดตั้งสกิล `/kickstart`" ด้านล่าง จากนั้นเปิด session ใหม่ ไม่งั้น `/kickstart` จะยังไม่ขึ้น
ชุดนี้ clone ได้จาก `https://github.com/jrppor/project-kickstart` และใช้กับแอป Claude (Code tab) ตอนนี้ยังไม่ได้ยืนยันว่าใช้กับ Claude Code แบบ CLI ได้ครบทุกส่วน (ขั้น 2.5 และ 3 ใช้ browser pane ของแอป)

1. อ่าน [01-playbook.md](01-playbook.md) หนึ่งรอบ เพื่อดูภาพรวมว่ามีกี่ขั้นและแต่ละขั้นต้องได้อะไร
2. สร้างโฟลเดอร์โปรเจกต์ใหม่ เปิด session ของแอป Claude ในโฟลเดอร์นั้น แล้วพิมพ์ `/kickstart`
3. ทำตามกล่อง "▶ ต่อไป" ท้ายทุกคำตอบ ขั้นที่ Claude ทำเองได้ สกิลจะทำให้เลย ขั้นที่ต้องใช้สกิลที่คุณต้องพิมพ์เอง
   (เช่น `/grill-with-docs`, `/to-spec`, `/to-tickets`, `/implement`) กล่องจะบอกบรรทัดที่ต้องพิมพ์
4. อยากรู้ว่าทำถึงไหน พิมพ์ `/kickstart status` · เริ่มฟีเจอร์ใหม่ พิมพ์ `/kickstart feature <ชื่อ>`

**มีโปรเจกต์อยู่แล้ว?** ไม่ต้องสร้าง repo ใหม่ เปิด session ในโฟลเดอร์ของ repo นั้นแล้วพิมพ์ `/kickstart adopt`
Claude จะสำรวจแบบอ่านอย่างเดียวก่อน แล้วเพิ่ม CLAUDE.md, ADR ของสิ่งที่ตัดสินไปแล้ว มาตรฐานที่ตรงกับโค้ดเดิม และด่านตรวจ บน branch แยก โดยไม่แก้โค้ดของแอป
(รายละเอียดอยู่ในหัวข้อ "นำไปใช้กับโปรเจกต์ที่มีอยู่แล้ว" ของ playbook)

ไม่ต้องคัดลอกพรอมต์จาก [02-prompts.md](02-prompts.md) เอง สกิลอ่านไฟล์นั้นให้ (ยังเปิดดูหรือคัดลอกเองได้ถ้าต้องการ)

### ติดตั้งสกิล `/kickstart` (ครั้งเดียวต่อเครื่อง)

สกิลอยู่ใน [skill/](skill/) ของ repo นี้ ลิงก์เข้าโฟลเดอร์สกิลของ Claude เพื่อให้แก้ที่ repo นี้แล้วมีผลทันที
รันคำสั่งจากโฟลเดอร์ที่ clone ชุดนี้ไว้ (clone ไว้ที่ไหนก็ได้ สกิลหาโฟลเดอร์ของชุดจากลิงก์เอง ห้ามคัดลอกโฟลเดอร์ `skill/` ไปแทนการลิงก์)

Windows (PowerShell):

```powershell
New-Item -ItemType Directory -Force "$env:USERPROFILE\.claude\skills" | Out-Null
cmd /c mklink /J "$env:USERPROFILE\.claude\skills\kickstart" "$PWD\skill"
```

ถ้าลิงก์ `kickstart` มีอยู่แล้ว คำสั่งจะแจ้ง error ซึ่งไม่เป็นไร (ลบลิงก์เดิมก่อนถ้าต้องการชี้ไปโฟลเดอร์ใหม่)

macOS และ Linux (ยังไม่ได้ลองบนเครื่องจริง):

```bash
mkdir -p ~/.claude/skills && ln -s "$PWD/skill" ~/.claude/skills/kickstart
```

## ลำดับขั้นโดยย่อ

```text
0 โจทย์หนึ่งหน้า        docs/brief.md + รูปแบบโปรเจกต์            P0
1 ตั้ง repo             templates + /setup-matt-pocock-skills  P1
2 คำศัพท์ + ตัดสินใจ     /grill-with-docs → GLOSSARY.md + ADR    P2
2.5 ออกแบบหน้าจอ        ADR ด้านการออกแบบ + แผนผังหน้าจอ + prototype (เฉพาะที่มีหน้าจอ)   P2.5
3 โครงเปล่าที่รันได้      3a ผังโฟลเดอร์ (รออนุมัติ) → 3b walking skeleton + ด่านตรวจ → 3c สกิลยกระบบ  P3a–P3c
── วนต่อฟีเจอร์ ─────────────────────────────────────────────────────
4 สเปก                 คุย → /to-spec                          P4
5 ticket               /to-tickets (ชิ้นแนวตั้ง + blocked by)     P5
6 ลงมือ                /implement หรือ /implement-spec          P6
7 รีวิว + merge         /code-review + /security-review + เทสต์ช้า + คนรีวิว   P7
8 ดูแล                 /diagnosing-bugs · /improve-codebase-architecture · /handoff   P8–P9
── โปรเจกต์ที่มีอยู่แล้ว ──────────────────────────────────────────────
A นำเข้า               สำรวจ → แม่แบบ (รวมกับของเดิม) → ADR ย้อนหลัง → ด่านตรวจ แล้วเข้า 4   PA1–PA4
```

งานเล็ก (1–3 วัน) ทำแค่ 0 แบบย่อ → 1 → 3 แล้วลงมือด้วย `/tdd` ได้เลย

## ในโฟลเดอร์นี้

| ไฟล์ | คืออะไร |
|---|---|
| [01-playbook.md](01-playbook.md) | แผนละเอียด: เป้าหมาย สิ่งที่ทำ เกณฑ์ "เสร็จ" และกับดักของแต่ละขั้น พร้อมเช็กลิสต์หน้าเดียว |
| [skill/](skill/) | สกิล `/kickstart` (`SKILL.md` โหลดทุกครั้ง · `adopt.md`, `repair.md`, `feature-gate.md`, `progress-format.md` อ่านเมื่อถึงโหมดนั้น): หาขั้นปัจจุบันจาก `docs/progress.md` และไฟล์ใน repo · ทำขั้นที่ Claude ทำเองได้ · บอกคำสั่งที่คุณต้องพิมพ์เอง |
| [02-prompts.md](02-prompts.md) | พรอมต์ P0–P9 และ PA1–PA4 (โปรเจกต์ที่มีอยู่แล้ว) ที่ `/kickstart` อ่านไปทำ (คัดลอกใช้เองได้) |
| [04-owner-preferences.md](04-owner-preferences.md) | หลักที่ใช้ทุกโปรเจกต์ ไม่ผูก stack (โครงที่องค์กรคุ้นเคย ชื่อ secret วิธีถามและ commit) แก้ให้ตรงกับวิธีทำงานของคุณได้ |
| [03-project-shapes.md](03-project-shapes.md) | รูปแบบโปรเจกต์ทุกแบบ: โครงเปล่าที่รันได้ · วิธีให้ Claude ดูผลเอง · ด่านตรวจ · หมวดมาตรฐานที่ต้องเก็บ |
| [templates/CLAUDE.md](templates/CLAUDE.md) | โครง CLAUDE.md (เพดาน 8,000 ตัวอักษร): รูปแบบและส่วนประกอบ · คำสั่ง · วิธีดูผลงานจริง · ด่านตรวจ · ตารางชี้ทางไป `docs/guides/` · ข้อควรรู้ |
| [templates/CODING_STANDARDS.md](templates/CODING_STANDARDS.md) | มาตรฐานโค้ดที่ `/code-review` ใช้ตรวจ: ส่วนกลางทุกโปรเจกต์ · หมวดตามส่วนประกอบ (SQL, API, FE, UI, APP, CLI, WORKER, LIB) · ภาคผนวกโดเมน (เงิน ธนาคาร หลักทรัพย์ audit) · ภาคผนวกภาษา (Go, C#, Java, TS/React/Next.js, Angular) |
| [templates/.claude/settings.json](templates/.claude/settings.json) | กฎห้าม (force push รวมรูปแบบ `+refspec` และ `git -C`, `--no-verify`/`commit -n`, อ่าน `.env` และ `.env.production`/`.staging`/`.development`/`.*.local`) · กฎที่ต้องถามก่อน (reset --hard, clean, checkout --, worktree remove --force, rm -rf, down -v) · ต่อ hooks `PostToolUse`, `Stop` และ `SubagentStop` |
| [templates/.claude/hooks/verify.mjs](templates/.claude/hooks/verify.mjs) | ด่านตรวจที่รันเฉพาะส่วนที่เปลี่ยน ก่อนจบเทิร์นของ session หลักและก่อน agent ใน worktree ส่งงาน มี formatter หลังแก้ไฟล์ วัดความยาว CLAUDE.md และ docs/progress.md (เพดาน 8,000 ตัวอักษร เตือนเมื่อเกิน บล็อกเมื่อเกิน 1.5 เท่าและงานนั้นแก้ไฟล์นั้น) และตัวอย่าง `CHECKS` ของ Go, Node, .NET (solution filter), Python, Flutter, สคริปต์ของคลัง และโปรเจกต์ส่วนเดียว |
| [templates/.claude/launch.json](templates/.claude/launch.json) | เฉพาะโปรเจกต์ที่มีหน้าเว็บ: ให้ Claude เปิด dev server และ prototype ใน browser pane เอง ผ่าน `scripts/run.mjs` |
| [templates/scripts/](templates/scripts/) | `run.mjs` รันทีละส่วนประกอบโดยโหลด secret จาก `.env` และสร้าง secret ของ dev ให้ครั้งแรก · `serve` เปิดไฟล์ HTML นิ่ง · `dev-env.mjs` พร้อมเทสต์ · `verify.test.mjs` เทสต์ของด่าน `verify.mjs` (คัดลอกทุกโปรเจกต์ที่ใช้ด่าน รันด้วย `node --test "scripts/*.test.mjs"` ราว 10 วินาที ใช้พิสูจน์ว่าการแก้ด่านไม่ทำให้กลไกหลักพัง) |
| [templates/.worktreeinclude](templates/.worktreeinclude) | ไฟล์ที่ git ignore แต่ worktree ของ agent ต้องมี (`.env`) Claude Code คัดลอกให้ตอนสร้าง worktree |
| [templates/.gitattributes](templates/.gitattributes) | เก็บไฟล์ข้อความเป็น LF ไม่ให้ diff และ worktree เต็มไปด้วยคำเตือน LF/CRLF |
| [templates/gitignore-claude.txt](templates/gitignore-claude.txt) | บรรทัดสำหรับ `.gitignore` (ignore เฉพาะ worktree กับ settings ส่วนตัว) |
| [CHANGELOG.md](CHANGELOG.md) | ประวัติการเปลี่ยนแปลงของชุดนี้ พร้อมเหตุผลและโปรเจกต์ที่ลองแล้ว |
| [ideas.md](ideas.md) | ใบเสนอของใหม่ พร้อมข้อดีข้อเสียและช่องอนุมัติของเจ้าของ |

## สิ่งที่ต้องมีบนเครื่อง

- แอป Claude (Code tab)
- สกิลที่ชุดนี้เรียกใช้ (ตารางด้านล่าง) ชุดหลักมาจากคลัง [mattpocock/skills](https://github.com/mattpocock/skills) ติดตั้งด้วย `npx skills@latest add mattpocock/skills` (เลือกสกิลที่ต้องการและเลือก `setup-matt-pocock-skills` ด้วย) หรือเป็นปลั๊กอินของ Claude Code ตามคู่มือในคลังนั้น ตรวจชื่อสกิลกับคลังนั้นเมื่อ 2026-11-11 ผ่านการค้นหาและอ่านหน้าคลัง ยังไม่ได้ลองติดตั้งตามคำสั่งนี้บนเครื่องใหม่

| สกิล | ใช้ในขั้น | จำเป็นไหม | แหล่งที่มา |
|---|---|---|---|
| `setup-matt-pocock-skills` | 1 | จำเป็น | mattpocock/skills |
| `grill-with-docs` | 2 | จำเป็น | mattpocock/skills |
| `to-spec` · `to-tickets` | 4 · 5 | จำเป็น | mattpocock/skills |
| `implement` · `implement-spec` | 6 | จำเป็น (`implement-spec` เฉพาะที่ขนานหลายใบ) | mattpocock/skills |
| `tdd` | งานเล็ก · 6 | แนะนำ | mattpocock/skills |
| `code-review` | 7 | จำเป็น | mattpocock/skills |
| `diagnosing-bugs` | 8 | แนะนำ | mattpocock/skills |
| `handoff` · `improve-codebase-architecture` | 8 | แนะนำ | mattpocock/skills |
| `domain-modeling` · `grilling` | adopt · ขั้นที่ต้องซักถาม | เสริม | mattpocock/skills |
| `/security-review` | 7 | จำเป็น | มากับ Claude Code (ไม่ใช่ `security-review` ชุดเก่าที่สร้างเอง) |
| `frontend-design` | 2.5 · 4 | เสริม (ไม่มี ทำขั้นนั้นด้วยพรอมต์แทนได้) | ไม่อยู่ใน mattpocock/skills ยังไม่ได้ระบุแหล่งสาธารณะ |
| `project-planner` | 0 (งานใหญ่) | เสริม | ไม่อยู่ใน mattpocock/skills ยังไม่ได้ระบุแหล่งสาธารณะ |
| `run-skill-generator` | 3c | เสริม (ไม่มี ให้ Claude เขียนสกิลยกระบบตามพรอมต์ P3c) | ไม่พบแหล่งสาธารณะ |

- Git, Node.js (ด่านตรวจเขียนด้วย Node) และเครื่องมือของ stack ที่เลือก
- Docker Desktop ถ้าใช้ docker compose หรือ testcontainers

## ข้อควรจำ

- **เปิด session ในโฟลเดอร์โปรเจกต์เสมอ** ถ้าไม่ทำ hooks และกฎใน `.claude/settings.json` ของโปรเจกต์จะไม่ถูกโหลด
- **commit `.claude/` (ยกเว้น worktrees กับ settings.local.json)** เพื่อให้ worktree ของ agent ได้ด่านตรวจไปด้วย ด่านของ agent ทำงานผ่าน hook `SubagentStop` (hook `Stop` ไม่ทำงานตอน agent ย่อยจบ)
- **ด่านตรวจต้องเร็ว** แต่ละชุดไม่ควรเกินราว 30 วินาที เทสต์ช้าให้เขียนใน CLAUDE.md ว่ารันก่อน commit
- **ถ้าแก้ `verify.mjs` ในโปรเจกต์ไหนแล้วดีขึ้น** ให้นำกลับมาอัปเดตที่ `templates/` ด้วย ส่วนท้ายไฟล์ (ตั้งแต่ `OUTPUT_TAIL_LINES` ลงไป) เหมือนกันทุกโปรเจกต์

## วิธีอัปเดตชุดนี้

ชุดนี้ต้องตามทันเครื่องมือใหม่ แต่ไม่ไล่ตามเทรนด์ เพราะคู่มือที่ไม่เคยลองจริงแย่กว่าไม่มีคู่มือ

1. **ของใหม่ต้องผ่านการอนุมัติของเจ้าของ 2 ครั้ง** เขียนเป็นใบเสนอใน [ideas.md](ideas.md) (ประโยชน์ · ข้อดีข้อเสีย · ต้นทุน · ทางเลือก · เกณฑ์วัดผล) แล้วรอเจ้าของ **อนุมัติให้ลอง** ลองในโปรเจกต์จริงตามเกณฑ์ แล้วรอเจ้าของ **อนุมัติให้รับเข้าแผน** อีกครั้ง Claude และงานอัตโนมัติเสนอได้อย่างเดียว ห้ามแก้แผน พรอมต์ หรือแม่แบบตามข้อเสนอที่ยังไม่ได้อนุมัติ
2. **อัปเดตจากความเจ็บปวด ไม่ใช่จากข่าว** แหล่งที่ดีที่สุดคือสิ่งที่พลาดซ้ำในโปรเจกต์ (P9) และผลของ "ตรวจสุขภาพ repo"
3. **ทุก 7 วันมีงานอัตโนมัติสรุปของใหม่** ของ Claude Code สกิล และประกาศของ Anthropic ลง [ideas.md](ideas.md) (commit แล้ว push) คุณเลือกว่าจะลองข้อไหน
   นอกจากนี้ให้สังเกตว่ามีขั้นไหนในแผนที่ข้ามเป็นประจำ ขั้นที่ข้ามเป็นประจำให้ตัดทิ้ง
4. **เพิ่มอะไรก็ต้องตัดอะไรด้วย** อย่าให้คู่มือยาวขึ้นเรื่อยๆ
5. **ทุกการเปลี่ยนบันทึกใน [CHANGELOG.md](CHANGELOG.md)** เปลี่ยนอะไร · เพราะอะไร · ลองกับโปรเจกต์ไหนแล้ว · อนุมัติเมื่อไร (อ้างรหัส `I-NNN` ถ้ามาจาก ideas.md)

ส่วนที่แทบไม่เปลี่ยนคือหลัก 5 ข้อ ส่วนที่เปลี่ยนนานๆ ครั้งคือลำดับขั้น ส่วนที่เปลี่ยนบ่อยคือคำสั่ง สกิล พรอมต์ และแม่แบบ
