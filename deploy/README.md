# การติดตั้งระบบ ROMEO HR — 2 โหมด

โค้ดชุดเดียวกัน ใช้ได้ 2 แบบ **ไม่ต้องแก้โค้ดเวลาสลับ** — ต่างกันแค่ "การตั้งค่า" และ "ที่อยู่ของข้อมูล"
ตัวสลับหลักคือค่า **`DEPLOY_MODE`** ของ server (`online` หรือ `local`) — server จะเลือกค่าที่เหลือให้เอง (`server/src/config/deployMode.js`)

| | 🌐 **online** (ใช้อยู่ตอนนี้) | 🏠 **local** (เครื่อง server ในร้าน) |
|---|---|---|
| คู่มือ | [`deploy/online/README.md`](online/README.md) | [`deploy/windows/MANUAL-INSTALL-LOCAL.md`](windows/MANUAL-INSTALL-LOCAL.md) |
| API (server) | Render | Windows service `ROMEO-HR` |
| หน้าเว็บ | Vercel | server ตัวเดียวกัน (`CLIENT_DIST`) |
| ฐานข้อมูล | MongoDB Atlas | MongoDB ในเครื่อง server |
| ที่ตั้งค่า | Render → Environment, Vercel → Environment Variables | `server\.env` บนเครื่อง server (`install.ps1` สร้างให้) |
| `DEPLOY_MODE` | `online` | `local` |
| เพดานรูปหลักฐาน | 450MB (Atlas ฟรี) — ตั้ง `EVIDENCE_DB_LIMIT_MB` ถ้าอัปเกรด | ไม่มีเพดาน |
| อัปเดตระบบ | `git push` → Render + Vercel deploy เอง | `git push` → รัน `update.ps1` บนเครื่อง server |
| ตั้งเครื่องสแกน | ชื่อโดเมน **เปิด**, `backendhr.minnyone.com`, HTTPS **เปิด** | ชื่อโดเมน **ปิด**, `192.168.0.253`, port `80`, HTTPS **ปิด** |
| Backup | Atlas (แบบฟรีไม่มี backup ให้) | `backup.ps1` ทุกคืน → `D:\ROMEO-backup` |
| ตรวจว่าระบบทำงาน | `https://backendhr.minnyone.com/api/health` → `"mode":"online"` | `http://localhost/api/health` → `"mode":"local"` |

## กติกา

- **ห้ามแก้โค้ดเพื่อสลับโหมด** — ทุกอย่างที่ต่างกันอยู่ในการตั้งค่า (ตารางด้านบน)
- **ห้ามมี 2 server ใช้ฐานข้อมูลเดียวกัน** — เช่น ตั้ง server ในร้านให้ต่อ Atlas ตอนที่ Render ยังเปิดอยู่ งานอัตโนมัติ (ตัดขาด, สลับตำแหน่ง ฯลฯ) จะทำซ้ำ 2 ชุด
- **ใช้ระบบจริงได้ทีละโหมดเท่านั้น** — โหมดที่ไม่ได้ใช้ให้ปิดไว้ ไม่งั้นจะมีคนบันทึกข้อมูลผิดที่
- `/api/health` บอกโหมดเสมอ — ถ้าไม่แน่ใจว่ากำลังใช้ระบบไหน ให้เปิดดู

## สลับโหมด

**online → local**: ทำตาม [`MANUAL-INSTALL-LOCAL.md`](windows/MANUAL-INSTALL-LOCAL.md) ขั้นที่ 0–6 (ติดตั้ง → ย้ายข้อมูลจาก Atlas → วันย้ายจริง → ปิด Render/Vercel)

**local → online**:
1. หยุด server ในร้าน: `C:\nssm\nssm.exe stop ROMEO-HR`
2. ย้ายข้อมูลในร้านขึ้น Atlas:
   `mongodump --uri mongodb://127.0.0.1:27017/romeo-hr --gzip --out D:\to-atlas`
   แล้ว `mongorestore --uri "<MONGO_URI ของ Atlas ไม่ต้องมีชื่อฐานข้อมูลต่อท้าย>" --gzip --drop --nsFrom "romeo-hr.*" --nsTo "hr_system.*" D:\to-atlas`
3. เปิด Render และ Vercel (ตั้งค่าตาม [`deploy/online/README.md`](online/README.md))
4. ตั้งเครื่องสแกนเป็นแบบ online (ตารางด้านบน)
5. ปิด service ในร้านถาวร: `sc config ROMEO-HR start= disabled`

## ปิดโหมดที่ไม่ได้ใช้

**ใช้ online อยู่ → ปิดเครื่องร้าน** (cmd แบบ admin ที่เครื่อง server):

```
C:\nssm\nssm.exe stop ROMEO-HR
sc config ROMEO-HR start= disabled
schtasks /change /tn "ROMEO-HR backup" /disable
```

เปิดกลับ: `sc config ROMEO-HR start= auto` → `C:\nssm\nssm.exe start ROMEO-HR` → `schtasks /change /tn "ROMEO-HR backup" /enable`

**ใช้ local อยู่ → ปิดระบบออนไลน์**: Suspend service บน Render และปิดโปรเจกต์บน Vercel
