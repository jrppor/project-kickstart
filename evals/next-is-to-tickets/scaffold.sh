# รุ่นซ่อมในไฟล์นี้ต้องตรงกับเลขปัจจุบันใน skill/SKILL.md ไม่อย่างนั้นสกิลจะเข้าโหมดซ่อมแทนการทำกรณี
# โปรเจกต์ขนาดกลางที่ทำขั้น 0 ถึง 3 เสร็จ ฟีเจอร์ booking มี spec แล้ว (ขั้น 4 เสร็จ) แต่ progress.md ยังไม่ได้อัปเดตว่าต้องแตก ticket
set -e
git init -q -b main .
mkdir -p docs/adr docs/agents .scratch/booking .claude/hooks src
printf '{}\n' > .claude/settings.json
printf '// gate\nconst CHECKS = [{ name: "app", cwd: ".", cmds: ["node --test"] }];\n' > .claude/hooks/verify.mjs
printf '# room-booking\n\nเว็บจองห้องประชุมของทีม\n\n| งาน | คำสั่ง |\n|---|---|\n| เทสต์เร็ว | `node --test` |\n' > CLAUDE.md
printf '# CODING_STANDARDS\n' > CODING_STANDARDS.md
printf '# GLOSSARY\n\n- การจอง (booking): การกันห้องประชุมหนึ่งช่วงเวลา\n' > GLOSSARY.md
printf '# brief\n\nเว็บจองห้องประชุมของทีม 30 คน รูปแบบ: เว็บ full-stack\n' > docs/brief.md
printf '# 0001 รูปแบบโปรเจกต์และ stack\n\nเว็บ full-stack ด้วย Node\n' > docs/adr/0001-shape-and-stack.md
printf '# issue tracker\n\nlocal markdown ใน .scratch/<feature>/issues/\n' > docs/agents/issue-tracker.md
printf 'export const ok = true;\n' > src/index.mjs
printf '# spec: booking\n\nผู้ใช้จองห้องประชุมตามช่วงเวลา ห้ามจองซ้อน ยกเลิกได้ก่อนเวลาเริ่ม\n' > .scratch/booking/spec.md
cat > docs/progress.md <<'MD'
# ความคืบหน้า

ดูแลโดย /kickstart · อัปเดตล่าสุด 2026-11-20 · ไฟล์นี้มีเพดาน 8,000 ตัวอักษร (ด่านใน .claude/hooks/verify.mjs) ประวัติขั้นและเรื่องที่ตัดสินแล้วอยู่ที่ .scratch/<ฟีเจอร์>/log.md
ขนาดงาน: กลาง · รูปแบบ: เว็บ full-stack · มีหน้าจอ: ใช่ · รุ่นซ่อม: 16

## ขั้นตั้งต้น

- [x] 0 โจทย์ — docs/brief.md
- [x] 1 ตั้ง repo
- [x] 2 คำศัพท์ + ADR
- [x] 2.5 ออกแบบหน้าจอ
- [x] 3a ผังโฟลเดอร์ที่ผู้ใช้อนุมัติ
- [x] 3b โครงเปล่า + ด่านตรวจ
- [x] 3c สกิลยกระบบ (ข้าม: ไม่ต้องยกอะไรขึ้นมา)

## ฟีเจอร์

| ฟีเจอร์ | branch | ขั้น | ticket | หมายเหตุ |
|---|---|---|---|---|
| booking | feature/booking | 4 สเปก | — | คุยรายละเอียดครบแล้ว |

## รอตัดสิน

ทบทวนโครงสร้างล่าสุด: ยังไม่เคย

## ขั้นถัดไป

ใครทำ: ผู้ใช้พิมพ์
คำสั่ง: `/kickstart`

## ข้ามหรือเปลี่ยนจากแผน
MD
git add -A
git -c user.name=t -c user.email=t@example.invalid commit -q -m "booking: spec"
git checkout -q -b feature/booking
