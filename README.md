# project-kickstart

ชุดเริ่มโปรเจกต์ใหม่สำหรับทำงานคู่กับ Claude Code มีแผนลำดับขั้น พรอมต์พร้อมใช้ และไฟล์แม่แบบที่คัดลอกเข้า repo ใหม่ได้ทันที
ทุกอย่างมาจากสิ่งที่ใช้ได้จริงใน `life-claims` กับ `Claim` (อัปเดตล่าสุด 2026-11-01)

## เริ่มตรงไหน

1. อ่าน [01-playbook.md](01-playbook.md) หนึ่งรอบ เพื่อดูภาพรวมว่ามีกี่ขั้นและแต่ละขั้นต้องได้อะไร
2. เปิด [02-prompts.md](02-prompts.md) ไว้ข้างๆ ระหว่างทำ แล้วคัดลอกพรอมต์ของแต่ละขั้นไปใช้
3. ถึงขั้นที่ 1 ให้ Claude คัดลอก `templates/` เข้า repo ใหม่ (พรอมต์ P1)

## ลำดับขั้นโดยย่อ

```text
0 โจทย์หนึ่งหน้า        docs/brief.md                          P0
1 ตั้ง repo             templates + /setup-matt-pocock-skills  P1
2 คำศัพท์ + ตัดสินใจ     /grill-with-docs → GLOSSARY.md + ADR    P2
3 โครงเปล่าที่รันได้      walking skeleton + ด่านตรวจที่พิสูจน์แล้ว  P3
── วนต่อฟีเจอร์ ─────────────────────────────────────────────────────
4 สเปก                 คุย → /to-spec                          P4
5 ticket               /to-tickets (ชิ้นแนวตั้ง + blocked by)     P5
6 ลงมือ                /implement หรือ /implement-spec          P6
7 รีวิว + merge         /code-review + /security-review + เทสต์ช้า + คนรีวิว   P7
8 ดูแล                 /diagnosing-bugs · /improve-codebase-architecture · /handoff   P8–P9
```

งานเล็ก (1–3 วัน) ทำแค่ 0 แบบย่อ → 1 → 3 แล้วลงมือด้วย `/tdd` ได้เลย

## ในโฟลเดอร์นี้

| ไฟล์ | คืออะไร |
|---|---|
| [01-playbook.md](01-playbook.md) | แผนละเอียด: เป้าหมาย สิ่งที่ทำ เกณฑ์ "เสร็จ" และกับดักของแต่ละขั้น พร้อมเช็กลิสต์หน้าเดียว |
| [02-prompts.md](02-prompts.md) | พรอมต์ P0–P9 สำหรับคัดลอกไปใช้ |
| [templates/CLAUDE.md](templates/CLAUDE.md) | โครง CLAUDE.md: คำสั่ง · ด่านตรวจ · ข้อควรรู้ |
| [templates/.claude/settings.json](templates/.claude/settings.json) | กฎห้าม (force push, `--no-verify`) · กฎที่ต้องถามก่อน (reset --hard, clean, down -v) · ต่อ hooks |
| [templates/.claude/hooks/verify.mjs](templates/.claude/hooks/verify.mjs) | ด่านตรวจก่อนจบเทิร์นที่รันเฉพาะส่วนที่เปลี่ยน มี formatter หลังแก้ไฟล์ และตัวอย่าง `CHECKS` ของ Go, Node, .NET, Python |
| [templates/.claude/launch.json](templates/.claude/launch.json) | ตัวอย่างให้ Claude เปิด dev server ใน browser pane เอง |
| [templates/gitignore-claude.txt](templates/gitignore-claude.txt) | บรรทัดสำหรับ `.gitignore` (ignore เฉพาะ worktree กับ settings ส่วนตัว) |
| [CHANGELOG.md](CHANGELOG.md) | ประวัติการเปลี่ยนแปลงของชุดนี้ พร้อมเหตุผลและโปรเจกต์ที่ลองแล้ว |
| [ideas.md](ideas.md) | ของใหม่ที่รอลองก่อนจะเข้าแผน |

## สิ่งที่ต้องมีบนเครื่อง

- แอป Claude (Code tab) และสกิลชุด `~/.agents/skills` (setup-matt-pocock-skills, grill-with-docs, to-spec, to-tickets, implement, implement-spec, tdd, code-review, diagnosing-bugs, handoff, improve-codebase-architecture)
- `/security-review` มากับ Claude Code ไม่ต้องติดตั้งเพิ่ม (ไม่ใช่ `security-review` ชุดเก่าที่สร้างเอง)
- Git, Node.js (ด่านตรวจเขียนด้วย Node) และเครื่องมือของ stack ที่เลือก
- Docker Desktop ถ้าใช้ docker compose หรือ testcontainers

## ข้อควรจำ

- **เปิด session ในโฟลเดอร์โปรเจกต์เสมอ** ถ้าไม่ทำ hooks และกฎใน `.claude/settings.json` ของโปรเจกต์จะไม่ถูกโหลด
- **commit `.claude/` (ยกเว้น worktrees กับ settings.local.json)** เพื่อให้ worktree ของ agent ได้ด่านตรวจไปด้วย
- **ด่านตรวจต้องเร็ว** แต่ละชุดไม่ควรเกินราว 30 วินาที เทสต์ช้าให้เขียนใน CLAUDE.md ว่ารันก่อน commit
- **ถ้าแก้ `verify.mjs` ในโปรเจกต์ไหนแล้วดีขึ้น** ให้นำกลับมาอัปเดตที่ `templates/` ด้วย ส่วนท้ายไฟล์ (ตั้งแต่ `OUTPUT_TAIL_LINES` ลงไป) เหมือนกันทุกโปรเจกต์

## วิธีอัปเดตชุดนี้

ชุดนี้ต้องตามทันเครื่องมือใหม่ แต่ไม่ไล่ตามเทรนด์ เพราะคู่มือที่ไม่เคยลองจริงแย่กว่าไม่มีคู่มือ

1. **ของใหม่ต้องลองในโปรเจกต์จริงก่อน** จดไว้ใน [ideas.md](ideas.md) ก่อน ลองแล้วได้ผลค่อยย้ายเข้าแผนหรือแม่แบบ
2. **อัปเดตจากความเจ็บปวด ไม่ใช่จากข่าว** แหล่งที่ดีที่สุดคือสิ่งที่พลาดซ้ำในโปรเจกต์ (P9) และผลของ "ตรวจสุขภาพ repo"
3. **ทบทวนทุก 3 เดือน** ดูว่า Claude Code กับสกิลมีอะไรใหม่ และมีขั้นไหนในแผนที่ข้ามเป็นประจำ ขั้นที่ข้ามเป็นประจำให้ตัดทิ้ง
4. **เพิ่มอะไรก็ต้องตัดอะไรด้วย** อย่าให้คู่มือยาวขึ้นเรื่อยๆ
5. **ทุกการเปลี่ยนบันทึกใน [CHANGELOG.md](CHANGELOG.md)** เปลี่ยนอะไร · เพราะอะไร · ลองกับโปรเจกต์ไหนแล้ว

ส่วนที่แทบไม่เปลี่ยนคือหลัก 5 ข้อ ส่วนที่เปลี่ยนนานๆ ครั้งคือลำดับขั้น ส่วนที่เปลี่ยนบ่อยคือคำสั่ง สกิล พรอมต์ และแม่แบบ
