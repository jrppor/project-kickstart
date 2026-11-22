# กติกาเมื่อทำงานใน worktree (agent ย่อยและ `claude --worktree`)

<!-- ไฟล์นี้ hook ส่งเข้าบริบทให้เองตอนเริ่ม agent ย่อย และตอนเริ่ม session ที่เปิดใน worktree (`.claude/hooks/verify.mjs`)
     จึงไม่ต้องอยู่ใน CLAUDE.md เขียนให้สั้น เติมในขั้นที่ 3 ด้วยคำสั่งที่รันผ่านจริง -->
- `.env` ถูกคัดลอกมาให้แล้วผ่าน `.worktreeinclude` ไม่ต้องสร้างใหม่ และอ่านไม่ได้ (กฎ deny) ชื่อตัวแปรดูจาก `.env.example`
- ติดตั้ง dependency ก่อนเริ่มงาน: `<เช่น npm --prefix ui ci>`
- ใช้พอร์ตของตัวเอง ห้าม kill process ตามพอร์ต (อาจเป็นของ agent อื่นหรือของผู้ใช้)
- เทสต์ช้าที่ใช้ DB/Redis: `<ตั้งชื่อ DB ของเทสต์ต่อ worktree อย่างไร · "แยกให้เองแล้ว (testcontainers)" · หรือ "ห้ามรันพร้อม agent อื่น">`
- ลองด้วยมือหรือบนเบราว์เซอร์ด้วย DB/Redis ของตัวเองแบบเดียวกับเทสต์ ห้ามสร้างผู้ใช้หรือข้อมูลทดสอบใน DB ของ dev
- เขียนไฟล์ด้วย Write/Edit ไม่ใช้ heredoc หรือคำสั่งหลายตัวต่อกันใน Bash (ตัวกันของ worktree จะปฏิเสธ)
- ห้ามใช้คำสั่งในรายการ `ask` ของ `.claude/settings.json` (เช่น `rm -rf`, `Remove-Item -Recurse`, `git reset --hard`, `git clean`, `git checkout --`, `git restore`)
  agent เบื้องหลังจะค้างรอผู้ใช้กดอนุญาตโดยไม่มีใครเห็น ไฟล์ชั่วคราวให้เขียนลงโฟลเดอร์ชื่อใหม่ทุกรอบแทนการลบของเดิม
  ย้อนไฟล์ที่แก้ผิดด้วย Edit หรืออ่าน `git show HEAD:<path>` แล้ว Write ทับ · อ่านไฟล์ของ worktree อื่นด้วย Read หรือ `git -C <path> show` ไม่ใช้ `cd <path> && cat`
  ถ้า branch ไม่ได้แตกจากจุดที่ควรเป็น ให้หยุดแล้วรายงาน ไม่ reset เอง
