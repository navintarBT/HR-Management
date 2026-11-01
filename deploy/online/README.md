# โหมด online — Render + Vercel + MongoDB Atlas

```
เครื่องสแกน ──อินเทอร์เน็ต (HTTPS)──►  Render (API)  ◄──  Vercel (หน้าเว็บ)  ◄── คอม/มือถือ ทุกที่
                                         │
                                   MongoDB Atlas
```

ภาพรวมทั้ง 2 โหมด: [`deploy/README.md`](../README.md)

---

## ส่วนประกอบและการตั้งค่า

> ค่าด้านล่างคือสิ่งที่ระบบต้องการ — ถ้าใน Render/Vercel ตั้งไว้ต่างจากนี้เล็กน้อย (เช่น `npm install` แทน `npm ci`) และใช้งานได้อยู่แล้ว ไม่ต้องเปลี่ยน
> ค่าที่ต้องมีแน่ๆ คือ Environment ของ Render และ `VITE_API_URL` ของ Vercel

### Render — API (โฟลเดอร์ `server`)

| รายการ | ค่า |
|---|---|
| Root Directory | `server` |
| Build Command | `npm ci` |
| Start Command | `node src/index.js` |
| Branch | `main` (push แล้ว deploy เอง) |

**Environment** (Render → service → Environment):

| ตัวแปร | ค่า |
|---|---|
| `DEPLOY_MODE` | `online` |
| `MONGO_URI` | URI ของ Atlas ต่อท้ายด้วย `/hr_system` (เป็นความลับ) |
| `JWT_SECRET` | ข้อความสุ่มยาวๆ (เป็นความลับ — เปลี่ยนแล้วทุกคนต้องล็อกอินใหม่) |
| `JWT_EXPIRES_IN` | `7d` |
| `CLIENT_ORIGIN` | ที่อยู่หน้าเว็บบน Vercel (สำหรับ CORS) |
| `EVIDENCE_DB_LIMIT_MB` | ไม่ต้องใส่ (ค่าเริ่มต้น 450 = Atlas ฟรี) — ถ้าอัปเกรด Atlas ให้ใส่ขนาดของแพ็กเกจ เช่น `4500` |

> ไม่ต้องใส่ `CLIENT_DIST` — ใส่เมื่อไหร่ server จะถือว่าเป็นโหมด local

### Vercel — หน้าเว็บ (โฟลเดอร์ `client`)

| รายการ | ค่า |
|---|---|
| Root Directory | `client` |
| Framework | Vite |
| Build Command | `npm run build` |
| Output Directory | `dist` |
| Environment Variable | `VITE_API_URL` = `https://backendhr.minnyone.com/api` |

`client/vercel.json` ส่งทุกหน้าไปที่แอป (รวม `/me` ของแอปพนักงาน) — ไม่ต้องตั้งเพิ่ม

### MongoDB Atlas — ฐานข้อมูล

- ฐานข้อมูลชื่อ `hr_system`
- ตรวจแพ็กเกจและพื้นที่: cloud.mongodb.com → Database → ดู tier ของ cluster (M0 = ฟรี 512MB) และ Storage ที่ใช้ไป
- เปลี่ยนรหัสผ่าน: Database Access → ผู้ใช้ → Edit → Edit Password → **แล้วแก้ `MONGO_URI` ใน Render ทันที**

---

## ตั้งเครื่องสแกน (โหมด online)

เมนู COMM → **ตั้งค่าคลาวด์เซิร์ฟเวอร์**

| รายการ | ค่า |
|---|---|
| รูปแบบเซิร์ฟเวอร์ | ADMS |
| เปิดการใช้งานชื่อโดเมน | **เปิด** |
| เซิร์ฟเวอร์แอดเดรส | `backendhr.minnyone.com` |
| HTTPS | **เปิด** (พอร์ตจะเป็น 443 เอง — ไม่มีช่องให้ใส่) |
| พร็อกซี | ปิด |

และเมนู COMM → **Ethernet**: Gateway = router ของร้าน, DNS = `8.8.8.8` (ต้องออกอินเทอร์เน็ตได้) — วันเวลาในเครื่องต้องถูก (HTTPS ไม่ยอมต่อถ้าวันที่ผิด)
เครื่องที่ติดต่อมาครั้งแรกจะขึ้น **ລໍຖ້າອະນຸມັດ** ในเมนู ເຄື່ອງສະແກນ → กด **ອະນຸມັດເຄື່ອງນີ້** → เปิด **ຊິງ**

---

## การดูแลประจำ

| งาน | วิธี |
|---|---|
| อัปเดตระบบ | `git push` ไปที่ `main` → Render และ Vercel deploy เอง → ดูผลใน Render → Events / Logs |
| ตรวจว่าระบบทำงาน | `https://backendhr.minnyone.com/api/health` → `{"ok":true,"mode":"online"}` |
| ดู error | Render → service → **Logs** |
| เครื่องสแกนยังส่งข้อมูลไหม | หน้าเว็บ **ຕັ້ງຄ່າແຜນວຽກ → ເຄື່ອງສະແກນ** |
| แก้ข้อมูลพนักงาน | หน้าเว็บ HR ตามปกติ (เข้าได้จากทุกที่) |
| สคริปต์กับข้อมูลจริง (เช่น ใส่ชื่ออังกฤษ) | รันจากคอมที่พัฒนา ซึ่ง `server\.env` ชี้ไปที่ Atlas: `cd server` → `npm run fill-english-names` |

---

## ข้อจำกัดของโหมด online ที่ต้องรู้

- **พื้นที่ Atlas แบบฟรี (512MB)** — รูปหลักฐานจากแอปพนักงานเก็บในฐานข้อมูล ประมาณ 100MB/วัน → ถึงเพดาน 450MB ในไม่กี่วัน แล้วพนักงานจะส่งรูปไม่ได้ (ระบบ HR ส่วนอื่นยังใช้ได้) — ต้องอัปเกรด Atlas หรือย้ายรูปไปเก็บที่อื่น
- **รูปโปรไฟล์พนักงาน** เก็บเป็นไฟล์บนดิสก์ของ Render — ถ้าไม่ได้ต่อ Persistent Disk รูปจะหายเมื่อ deploy ใหม่
- **Atlas แบบฟรีไม่มี backup ให้** — ควรมีการสำรองข้อมูลแยก
- เครื่องสแกนต้องออกอินเทอร์เน็ตได้ — ถ้าเน็ตร้านหลุด เครื่องสแกนจะเก็บการสแกนไว้ แล้วส่งให้เองเมื่อเน็ตกลับมา
