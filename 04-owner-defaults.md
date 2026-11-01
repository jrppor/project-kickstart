# ค่าเริ่มต้นของเจ้าของ

สิ่งที่เจ้าของเลือกซ้ำในโปรเจกต์จริง ขั้นที่ 2 (`/grill-with-docs`) และขั้นที่ 2.5 ใช้เป็น **ค่าตั้งต้น** แทนการถามใหม่ทุกข้อ:
Claude สรุปเป็นรายการให้เจ้าของตอบครั้งเดียวว่า "ใช้ตามนี้" หรือ "ใช้ตามนี้ ยกเว้น X" แล้วถามเฉพาะเรื่องที่ไฟล์นี้ไม่ได้ตอบ
ถ้า brief บังคับต่างจากนี้ ให้ทำตาม brief · ค่าเหล่านี้เป็นค่าตั้งต้น ไม่ใช่กฎ ถ้า Claude เห็นว่าไม่เหมาะกับโปรเจกต์ ให้บอกเหตุผลก่อนเสนอทางอื่น

**ที่มา:** stock-system (2026-11-01) คือที่ที่เจ้าของค้านคำแนะนำของ Claude แล้วเลือกเอง · life-claims และ Claim คือสิ่งที่ใช้อยู่จริง
แก้ไฟล์นี้ได้ตลอดเมื่อเลือกต่างไปจากเดิม เพิ่ม stack ใหม่เมื่อทำโปรเจกต์ stack นั้นจริง

---

## ทุกโปรเจกต์

- **เป้าหมายของโครง:** ให้เหมือนโครงที่องค์กรใหญ่ใช้จริง อ่านแล้วคุ้นเคย ไม่ใช่แบบที่ทดลองหรือเฉพาะกลุ่ม (stock-system 14:26, 15:31)
- **โครงโฟลเดอร์ระดับบนสุด:** หนึ่งโฟลเดอร์ต่อส่วนประกอบ ตั้งแต่วันแรก เช่น `backend/` (`src/` + `tests/`) · `ui/` · `database/` (`migrations/` + `seed/`) · `scripts/` · `docs/`
  ห้ามมี `api/`, `src/`, `tests/` ปนกันที่รากคลัง (stock-system ต้องย้ายเข้า `backend/` ทีหลัง)
- **ชื่อ:** namespace และ project ใช้ชื่อเต็มของระบบ เช่น `StockSystem.*` ไม่ย่อเป็น `Stock.*`
- **ไม่มีโฟลเดอร์ `Common/` หรือ `Shared/` ที่รวมทุกอย่าง** ให้ตั้งชื่อตามหน้าที่ (stock-system 15:39)
- **error ที่คาดได้** คืนเป็น Result หรือ error ที่ระบุชนิดได้ แสดงต่อภายนอกเป็น ProblemDetails (RFC 9457) รูปแบบเดียวทั้งระบบ
- **auth:** บัญชีของระบบเอง · JWT access token อายุสั้น + refresh token ใน HttpOnly cookie ที่หมุนทุกครั้ง · สถานะ session และการเพิกถอนเก็บใน Redis
- **ฐานข้อมูล:** DB-first ด้วยไฟล์ SQL เลขเรียงที่สคริปต์ภายนอกรัน แอปไม่ migrate เอง · DB แยก dev / test / demo
- **dev:** บริการ (DB, Redis, mail) ใน docker compose · รันส่วนประกอบด้วย `scripts/run.mjs` ที่โหลด secret จาก `.env` ที่ไม่เข้า git
- **commit:** Claude commit เองเมื่อจบแต่ละขั้นหรือ ticket โดยไม่ต้องถาม (ยังไม่ push) · ห้ามมีบรรทัด Co-Authored-By ของ Claude

## .NET (backend)

- ASP.NET Core **Controllers** (`[ApiController]`) ไม่ใช่ Minimal APIs
- **Clean Architecture** แบบ layered: `Domain` ← `Application` ← `Infrastructure` / `WebApi` / `Worker` (ที่เป็นจุดประกอบ)
  `Application` แบ่งหนึ่งโฟลเดอร์ต่อฟีเจอร์ · **ไม่ใช้ MediatR** เรียก service ตรงๆ
- Dapper + SQL (ไม่ใช้ EF Core migrations) · FluentValidation ที่ขอบ · Serilog · Central Package Management
- OpenAPI ที่มากับ .NET + Swagger UI เฉพาะ dev · ตั้ง `NumberHandling.Strict` ให้สัญญาเป็น `integer` ไม่ใช่ `integer|string`
- เทสต์: xUnit · Respawn · NetArchTest · fake เขียนเอง ไม่ใช้ mocking library
- `EnforceCodeStyleInBuild` + `TreatWarningsAsErrors` ใน `Directory.Build.props` แทน formatter
- เงินใช้ `decimal(18,2)` ผ่าน value object (Claim) · เวลาใช้ `TimeProvider`

## Go (backend)

- Gin · sentinel error + problem+json · ตารางและคอลัมน์ snake_case · id เป็น UUID · เงินเป็น int64 หน่วยสตางค์ · Clock interface สำหรับเวลา (life-claims)

## เว็บ (frontend)

- React + TypeScript + Vite · MUI · React Router · TanStack Query · React Hook Form + Zod · Vitest + Testing Library · Playwright สำหรับ e2e
- type ของ API generate จากสัญญา OpenAPI (`openapi-typescript`) พร้อมเทสต์ตรวจว่าตรงกับสัญญา
- Next.js เมื่อ brief ต้องการ server rendering หรือ route handler (life-claims, Claim)

## การออกแบบหน้าจอ (ขั้น 2.5)

- **ระบบหลังบ้าน:** ใช้ theme ค่าเริ่มต้นของ component library (MUI) ไม่ตกแต่งเพิ่ม เน้นตารางและฟอร์มที่อ่านง่าย
  **ไม่ใช้สไตล์ "bold" ของ `/frontend-design`** เจ้าของบอกว่าแบบนั้น "เหมือน AI ทำ" (stock-system 15:05)
- **ฟอนต์:** Noto Sans Thai (+ Noto Sans สำหรับอังกฤษ) เป็นค่าแรก (stock-system 15:13)
- **ขนาดจอ:** ระบบหลังบ้านเน้น desktop ≥ 1280px รองรับ tablet · มือถือเฉพาะเมื่อ brief ระบุ
- token ของสีและขนาดมีที่มาที่เดียว (ไฟล์ token ใน `docs/design/` ที่ทั้ง prototype และ theme ของแอปอ่าน)

## วิธีทำงาน

- ขั้นที่ซักถาม (2, 4): ถามทุกเรื่องในรอบเดียวพร้อมคำตอบที่แนะนำ เจ้าของตอบ "ตามแนะนำ ยกเว้น X" ไม่ถามทีละเรื่อง
- ก่อนสร้างไฟล์ของโครงเปล่า แสดงผังโฟลเดอร์ให้เจ้าของอนุมัติก่อน
