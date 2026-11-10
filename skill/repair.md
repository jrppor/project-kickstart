# /kickstart · รายการซ่อมโปรเจกต์ที่ตั้งก่อนชุดรุ่นปัจจุบัน

รุ่นรายการซ่อม: 1 (เพิ่มหรือแก้ข้อไหนในไฟล์นี้ ให้เพิ่มเลขนี้ และแก้เลขเดียวกันในข้อ 3 ของ "ขั้นตอนทุกครั้ง" ใน `SKILL.md`)

ตรวจทุกข้อกับ repo ข้อที่ขาดให้ซ่อม บอกผู้ใช้ว่าเพิ่มอะไร แล้ว commit แยก จบแล้วเขียน `รุ่นซ่อม: 1` ต่อท้ายบรรทัดหัวของ `docs/progress.md`

- `CLAUDE.md` ไม่มีหัวข้อ "ลำดับงาน" หรือ "เตรียม worktree" → คัดลอกจาก `KIT/templates/CLAUDE.md` แล้วเติมค่าจริงของโปรเจกต์
- `.claude/settings.json` ไม่มี hook `SubagentStop` หรือ `verify.mjs` ไม่มีโหมด `subagent-stop` → agent ใน worktree ไม่ผ่านด่าน
  ให้คัดลอกส่วนท้ายของ `KIT/templates/.claude/hooks/verify.mjs` (ตั้งแต่ `const OUTPUT_TAIL_LINES` ลงไป) และ hook จากแม่แบบ settings โดยคง `CHECKS`/`FORMATTERS` ของโปรเจกต์ไว้
- ไม่มี `.worktreeinclude` แต่มี `.env` ที่ git ignore → สร้างจากแม่แบบ
- Edit/Write ใน auto mode ช้าครั้งละหลายวินาที (ดู `permissionDecision` ของ Edit ใน transcript ถ้าเป็น `classifier`) และ `~/.claude/settings.json` ไม่มีกฎ `Edit(//...)` ครอบโฟลเดอร์ของโปรเจกต์ → เสนอตั้งกฎระดับผู้ใช้ตามขั้น 1 ข้อ 4 ของ playbook (ถามโฟลเดอร์ บอกข้อแลก รอคำตอบตกลง ถ้าระบบไม่ให้แก้ให้บอกบรรทัดที่ต้องเพิ่ม) · `Edit(/**)` ใน `.claude/settings.json` ของโปรเจกต์ไม่ต้องเพิ่ม (ใช้ได้เฉพาะเมื่อโฟลเดอร์ trust แล้ว)
- หัวข้อ "เตรียม worktree" ไม่มีข้อห้ามใช้คำสั่งในรายการ `ask` หรือข้อห้ามสร้างข้อมูลทดสอบใน DB ของ dev → เพิ่มจากแม่แบบ
- `FORMATTERS` ตัวที่เรียกของใน `node_modules` หรือ venv แต่ไม่มี `needs` → เพิ่ม `needs` (ไม่งั้น hook ล้มทุกครั้งที่ agent แก้ไฟล์ใน worktree ที่ยังไม่ได้ติดตั้ง)
- `verify.mjs` ไม่มี `CLAUDE_MD_LIMIT` → คัดลอกส่วนท้ายแบบเดียวกับข้อบน · CLAUDE.md ไม่มีตาราง "ก่อนแตะเรื่องไหน อ่านอะไร" → เพิ่มจากแม่แบบ ถ้าเกินเพดานให้ทำตาม "ย้ายรายละเอียดออกจาก CLAUDE.md" ใน P9
- `verify.mjs` ไม่มี `PROGRESS_LIMIT` (หรือ `LENGTH_LIMITED_DOCS`) → คัดลอกส่วนท้ายแบบเดียวกับข้อบน · `docs/progress.md` เกิน 8,000 ตัวอักษร → ทำตามพรอมต์ "ย้ายประวัติออกจาก docs/progress.md" ใน P9 (ตัดมาทั้งก้อนไป `.scratch/<ฟีเจอร์>/log.md` ห้ามสรุปใหม่ พิสูจน์ด้วยโทเคนใน backtick)
- ต้องยกระบบเพื่อดูผล (เว็บ API worker mobile desktop) แต่ไม่มี `.claude/skills/run-*/` หรือ CLAUDE.md ไม่มีบรรทัด "การตรวจบนระบบจริง" → ทำตาม **P3c** (สคริปต์ยกระบบที่คัดลอกต่อใบงานใน `.scratch/` รวมเข้าสกิลนั้น)
- **`.claude/settings.json` ห้ามเขียนเอง** auto mode ปฏิเสธการแก้ไฟล์สิทธิ์ของตัวเองทุกครั้ง (Self-Modification) และห้ามหาทางอ้อม
  ให้เขียนไฟล์ที่รวมแล้ว (ของเดิมทั้งหมด + ส่วนที่ขาดจากแม่แบบ) ไว้ที่ `.scratch/settings.proposed.json` แล้วบอกผู้ใช้ว่าเพิ่มอะไร
  พร้อมคำสั่งเดียวให้รันเอง: `mv .scratch/settings.proposed.json .claude/settings.json` ห้าม commit ไฟล์ proposed
  หลังผู้ใช้ย้ายแล้ว ตรวจว่าเป็น JSON ที่ถูกต้องแล้ว commit `.claude/settings.json` · hook ใหม่ทำงานเมื่อเปิด session ใหม่
  ซ่อมข้ออื่นต่อได้โดยไม่ต้องรอ
