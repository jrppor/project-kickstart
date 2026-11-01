# รูปแบบโปรเจกต์

ลำดับขั้นใน [01-playbook.md](01-playbook.md) ใช้ได้กับทุกรูปแบบ สิ่งที่ต่างกันคือ **โครงเปล่าที่รันได้** (ขั้นที่ 3) หน้าตาเป็นอย่างไร
**Claude ดูผลงานเองได้อย่างไร** **ด่านตรวจรันอะไร** และ **หมวดไหนใน `CODING_STANDARDS.md` ที่ต้องเก็บไว้**
เลือกรูปแบบตั้งแต่ขั้นที่ 0 แล้วบันทึกเป็น ADR ในขั้นที่ 2 โปรเจกต์เดียวอาจมีหลายส่วนประกอบก็ได้ เช่น API + mobile + worker

## เลือกรูปแบบจากคำถามเดียว: "ใครหรืออะไรใช้งานสิ่งนี้ ผ่านช่องทางไหน"

| ใช้งานผ่าน | รูปแบบ |
|---|---|
| ระบบหรือแอปอื่นเรียกผ่าน HTTP/gRPC | Web API / backend |
| คนเปิดผ่านเบราว์เซอร์ และ server อยู่ในโปรเจกต์เดียวกัน | เว็บ full-stack |
| คนเปิดผ่านเบราว์เซอร์ และเรียก API ที่มีอยู่แล้ว | frontend อย่างเดียว |
| คนเปิดผ่านเบราว์เซอร์ และ API แยกเป็นอีกส่วน | Web API + UI แยกกัน |
| คนใช้บนมือถือ | mobile |
| คนใช้บนเครื่อง Windows/macOS | desktop |
| คนหรือสคริปต์สั่งผ่าน terminal | console / CLI |
| ไม่มีคนสั่ง ทำงานเองตามเวลาหรือตามงานที่เข้าคิว | background service / worker |
| โค้ดของคนอื่น import ไปใช้ | library / SDK |

---

## ตารางเปรียบเทียบ

| รูปแบบ | ตัวอย่าง stack | โครงเปล่าที่รันได้ (ขั้นที่ 3) | Claude ดูผลเองอย่างไร | ด่านตรวจเร็ว (`CHECKS`) | หมวดตามส่วนประกอบที่เก็บ |
|---|---|---|---|---|---|
| **Web API / backend** | Go + Gin · ASP.NET Core · Spring Boot · NestJS | `/healthz` ที่ต่อที่เก็บข้อมูลจริง + endpoint ของโดเมนหนึ่งตัว | integration test ผ่าน HTTP · เรียกด้วย curl · Swagger | build · lint/vet · unit · architecture test | SQL · API |
| **เว็บ full-stack** | Next.js (server actions, route handlers) · Nuxt · SvelteKit | หน้าเดียวที่อ่านและเขียนข้อมูลจริงผ่านโค้ดฝั่ง server | browser pane ผ่าน `launch.json` · e2e (Playwright) | typecheck · lint · unit | FE · SQL ถ้ามี DB · API ถ้าเปิด route ให้ภายนอก |
| **frontend อย่างเดียว** | Angular · React + Vite · Vue | หน้าเดียวที่เรียก API จริง หรือ mock ตามสัญญาของ API | browser pane ผ่าน `launch.json` | typecheck · lint · unit | FE |
| **Web API + UI แยกกัน** | Go/.NET + Next.js | `/healthz` + หน้าเดียวที่เรียก API ผ่านเส้นทางที่ตั้งใจไว้จริง | browser pane + integration test ของ API | แยก `CHECKS` ต่อโฟลเดอร์ | SQL · API · FE |
| **mobile** | Flutter · React Native · .NET MAUI · Kotlin · Swift | หน้าจอแรกที่โหลดข้อมูลจริง และ build ติดตั้งบน emulator ได้ | widget/unit test · รันบน emulator แล้วให้ Claude ดูหน้าจอ (computer use) | analyze/lint · unit (build เต็มช้าเกินไปสำหรับด่าน) | APP · API ถ้าเรียก backend |
| **desktop** | Electron · Tauri · WPF · WinUI · .NET MAUI | หน้าต่างแรกที่ทำงานหลักได้หนึ่งอย่าง และแพ็กเกจติดตั้งได้ | unit test · Playwright สำหรับ Electron · รันแอปแล้วให้ Claude ดูหน้าจอ (computer use) | build · unit | APP |
| **console / CLI** | Go (cobra) · .NET (System.CommandLine) · Node · Python | คำสั่งเดียวที่รับ input แล้วเขียน output พร้อม `--help` | รันคำสั่งจริงแล้วเทียบผลกับไฟล์คำตอบ (golden/snapshot) | build · unit · golden test | CLI |
| **background service / worker** | queue consumer · scheduled job · Windows service · .NET Worker | รับงานหนึ่งชิ้นแล้วเกิดผลที่ตรวจได้ และหยุดทำงานอย่างเรียบร้อย | integration test ใส่งานเข้าคิว (container) แล้วตรวจผล · อ่าน log | build · unit | WORKER · SQL ถ้ามี DB |
| **library / SDK** | NuGet · npm · Go module · Maven | public API หนึ่งตัว + ตัวอย่างการใช้ที่รันได้ + build เป็นแพ็กเกจได้ | รันเทสต์และตัวอย่าง | build · unit · ตรวจว่า public API ไม่เปลี่ยนโดยไม่ตั้งใจ | LIB |

**หมวดตามส่วนประกอบ** หมายถึงหมวดใน `CODING_STANDARDS.md` ที่ใช้เฉพาะบางรูปแบบ (SQL, API, FE, UI, APP, CLI, WORKER, LIB) หมวดส่วนกลางใช้กับทุกรูปแบบเสมอ
**ทุกรูปแบบที่มีหน้าจอ** (เว็บ full-stack, frontend, Web API + UI, mobile, desktop) ต้องทำ **ขั้นที่ 2.5 ออกแบบหน้าจอ** และเก็บหมวด **UI** ไว้ด้วย ส่วน Web API, CLI, worker และ library ข้ามขั้นนี้ได้

## ขั้นออกแบบ (2.5) ในแต่ละรูปแบบที่มีหน้าจอ

| รูปแบบ | design system ที่มักใช้ | prototype ทำด้วยอะไร | ข้อควรระวัง |
|---|---|---|---|
| เว็บ (full-stack, frontend, Web API + UI) | MUI · shadcn/ui · Angular Material หรือ token ของเราเอง | HTML ที่กดได้จาก `/frontend-design` | ระบบหลังบ้านเน้นตารางและฟอร์มที่อ่านง่าย แสดงข้อมูลแน่นแต่ไม่รก |
| mobile | Material 3 (Android) · Human Interface Guidelines (iOS) · theme ของ Flutter/React Native | HTML ขนาดจอมือถือ หรือหน้าจอจริงบน emulator | เป้าแตะต้องใหญ่พอ · ข้อความไทยยาวกว่าอังกฤษ · ขนาดตัวอักษรตามที่ระบบตั้ง |
| desktop | Fluent (Windows) · HIG (macOS) · theme ของ Electron/Tauri | HTML ขนาดหน้าต่าง desktop หรือหน้าต่างจริง | keyboard shortcut · ย่อขยายหน้าต่างได้ · หลายจอและ DPI สูง |

---

## หมายเหตุรายรูปแบบ

**Web API / backend**
- ถ้าไม่มีหน้าเว็บ ไม่ต้องมี `launch.json` ให้ Claude ดูผลผ่าน integration test และ curl
- สัญญา API (OpenAPI หรือ proto) คือสิ่งที่ส่งมอบ ให้เขียนตั้งแต่ ticket แรก และ commit ไฟล์สัญญาพร้อมเทสต์เทียบ (ดูหมายเหตุ Web API + UI ด้านล่าง)

**Web API + UI แยกกัน: สัญญาที่ตรวจได้**
- backend สร้าง OpenAPI จากโค้ด แล้ว commit ไฟล์สัญญาไว้ (เช่น `backend/openapi.v1.json`) มีเทสต์เทียบสัญญาที่โค้ดสร้างจริงกับไฟล์นั้น อัปเดตด้วยตัวแปรเช่น `UPDATE_OPENAPI=1`
- ให้เทสต์นี้สร้างสัญญาได้โดยไม่ต้องต่อ DB หรือ Redis จริง จะได้อยู่ในด่านเร็ว (ถ้าเทสต์นี้ต้องมี DB จะหลุดจากด่าน และแก้ DTO แล้วไม่เห็นแดงจนกว่าจะรันเทสต์ช้า)
- ui generate type จากไฟล์สัญญา (`openapi-typescript` → `npm run gen:api`) มีเทสต์ตรวจว่า type ตรงกับสัญญา และใส่ไฟล์สัญญาไว้ใน `area` ของเช็ก ui ใน `verify.mjs`
- ไฟล์สัญญาและ type ที่ generate ไม่ผ่าน formatter (เช่น ใส่ใน `.prettierignore`) และเมื่อ merge ชนกัน ให้สร้างใหม่ แทนการแก้ conflict
- .NET: ตั้ง `JsonNumberHandling.Strict` ไม่อย่างนั้นสัญญาจะประกาศตัวเลขเป็น `integer|string`

**เว็บ full-stack**
- server action และ route handler คือ endpoint ต้องตรวจสิทธิ์ทุกตัวเหมือน API
- แยกโค้ดโดเมนออกจาก component ตั้งแต่โครงเปล่า ไม่อย่างนั้นกฎธุรกิจจะไปกระจายอยู่ในหน้าต่างๆ

**mobile และ desktop**
- การให้ Claude ดูหน้าจอแอป native ใช้ computer use ซึ่งต้องอนุญาตทีละแอป และช้ากว่าการดูเว็บ ให้ใช้กับการเช็กรอบสุดท้าย ส่วนการตรวจประจำให้พึ่งเทสต์
- ด่านตรวจใส่เฉพาะ analyze/lint กับ unit test การ build แอปเต็มให้รันก่อน commit
- ตัดสินเรื่อง offline การอัปเดตเวอร์ชัน และที่เก็บข้อมูลลับบนเครื่อง เป็น ADR ตั้งแต่ขั้นที่ 2

**console / CLI**
- golden test (เทียบ output กับไฟล์คำตอบที่ commit ไว้) คือเครื่องมือหลัก ทำให้ Claude รู้ทันทีว่า output เปลี่ยน
- exit code คือสัญญาของโปรแกรม ต้องเขียนไว้ใน README

**background service / worker**
- ตั้งสมมติฐานไว้ก่อนว่างานอาจถูกส่งซ้ำ (at-least-once) handler ทุกตัวต้อง idempotent ตั้งแต่โครงเปล่า
- ต้องมีวิธีให้คนรู้ว่ายังทำงานอยู่ (health check หรือ heartbeat) และงานที่ล้มซ้ำต้องไปกองไว้ที่ dead-letter ไม่ใช่วนไม่จบ

**library / SDK**
- public API ที่เล็กที่สุดคือเป้าหมาย สิ่งที่ export ออกไปแล้วจะถอนคืนยาก
- ตัวอย่างการใช้ต้องรันได้จริงในเทสต์ ไม่ใช่แค่โค้ดใน README

**หลายส่วนประกอบในคลังเดียว**
- แยกโฟลเดอร์ต่อส่วนประกอบตั้งแต่วันแรก (เช่น `backend/`, `ui/`, `database/`) แล้วตั้ง `CHECKS` แยกต่อโฟลเดอร์ ด่านจะรันเฉพาะส่วนที่แก้
  ไฟล์ตั้งค่าที่รากคลังที่กระทบ build (เช่น `Directory.Build.props`, `global.json`, `.editorconfig`) ใส่ไว้ใน `area` ของส่วนที่ได้รับผลด้วย
- โครงเปล่าต้องพิสูจน์ว่าทุกส่วนต่อกันได้จริงอย่างน้อยหนึ่งเส้นทาง
- รันทุกส่วนด้วย `scripts/run.mjs <ส่วนประกอบ>` (แม่แบบใน `templates/scripts/`) โหลด secret จาก `.env` ที่ไม่เข้า git และสร้าง secret ของ dev ให้เองครั้งแรก
- บริการที่เครื่อง dev อาจมีอยู่แล้วและใช้ร่วมกับโปรเจกต์อื่น (Postgres, Redis) ใส่ใน compose profile แยก (เช่น `standalone`) แล้วให้พอร์ตตั้งค่าได้
- DB และ Redis ของเทสต์แยกจากของ dev (เช่น `app` / `app_test` / `app_demo` และ Redis คนละ logical db) และรับชื่อจาก environment
  ให้ worktree ของ agent หลายตัวรันเทสต์ช้าพร้อมกันได้ ตัวช่วยล้างข้อมูลต้องไม่ยอมล้าง DB ของ dev
