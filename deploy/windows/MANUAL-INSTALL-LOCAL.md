# คู่มือติดตั้งระบบ ROMEO HR บนเครื่อง Server ในร้าน (Local)

ระบบทั้งหมด (หน้าเว็บ HR, แอปพนักงาน และส่วนรับข้อมูลจากเครื่องสแกน) รันเป็น Windows service ตัวเดียวชื่อ **`ROMEO-HR`** บนเครื่อง server ในร้าน และใช้ฐานข้อมูล MongoDB ในเครื่องเดียวกัน

นี่คือ **โหมด local** (`DEPLOY_MODE=local`) — เทียบกับโหมด online ได้ที่ [`deploy/README.md`](../README.md)

```
เครื่องสแกน ──LAN──►  Server ในร้าน 192.168.0.253 (service ROMEO-HR + MongoDB)  ◄── คอม/มือถือ ของ HR และพนักงาน
```

---

## ค่าที่ใช้ในคู่มือนี้

| รายการ | ค่า |
|---|---|
| IP เครื่อง server | `192.168.0.253` |
| Subnet mask | `255.255.255.0` |
| Gateway (router) | `192.168.0.1` |
| DNS | `8.8.8.8` และ `1.1.1.1` |
| โฟลเดอร์ระบบ | `C:\HR-Management` |
| ชื่อ service | `ROMEO-HR` |
| Port ระบบ | `80` |
| ฐานข้อมูล | `mongodb://127.0.0.1:27017/romeo-hr` |
| โฟลเดอร์ backup | `D:\ROMEO-backup` |
| หน้าเว็บ HR | `http://192.168.0.253` |
| แอปพนักงาน | `http://192.168.0.253/me` |

> ทุกคำสั่งในคู่มือนี้ พิมพ์ใน **Command Prompt (cmd)** ที่เปิดแบบ **Run as administrator**
> (กด Start → พิมพ์ `cmd` → คลิกขวา → Run as administrator)

---

## ขั้นที่ 0 — เตรียมเครื่อง Server

1. ใช้ Windows 10 หรือ 11 ต่อ **สาย LAN** เข้า router ของร้าน และควรต่อ **UPS** (server ต้องเปิด 24 ชั่วโมง)
2. ตั้ง **IP คงที่**: Settings → Network & internet → **Ethernet** → IP assignment → **Edit** → เลือก **Manual** → เปิด **IPv4** แล้วใส่

   | ช่อง | ค่า |
   |---|---|
   | IP address | `192.168.0.253` |
   | Subnet mask | `255.255.255.0` |
   | Gateway | `192.168.0.1` |
   | Preferred DNS | `8.8.8.8` |
   | Alternate DNS | `1.1.1.1` |

   กด **Save**
3. ตรวจว่าออกอินเทอร์เน็ตได้

   ```
   ping github.com
   ```

   ต้องมีบรรทัด `Reply from ...` (ถ้าขึ้น `could not find host` = ยังไม่ได้ใส่ DNS)

---

## ขั้นที่ 1 — ติดตั้งโปรแกรม 5 ตัว

| # | โปรแกรม | ดาวน์โหลดที่ | วิธีติดตั้ง |
|---|---|---|---|
| 1 | **Node.js** | nodejs.org → เวอร์ชัน **LTS** → Windows Installer (.msi) | กด Next ตามค่าเริ่มต้น |
| 2 | **Git** | git-scm.com → Download for Windows → **64-bit Git for Windows Setup** | กด Next ตามค่าเริ่มต้น — หน้า "Adjusting your PATH environment" ต้องเป็น **Git from the command line and also from 3rd-party software** |
| 3 | **MongoDB Community Server** | mongodb.com/try/download/community → การ์ด **MongoDB Community Server Download** → กด **Select Package** → Platform **Windows x64**, Package **msi** → Download | เลือก **Complete** → ติ๊ก **Install MongoD as a Service** → เอาติ๊ก **Install MongoDB Compass** ออกได้ |
| 4 | **MongoDB Database Tools** | mongodb.com/try/download/database-tools → Version **100.20.0** (หรือล่าสุด), Platform **Windows x86_64**, Package **msi** | กด Next ตามค่าเริ่มต้น |
| 5 | **NSSM** | nssm.cc/download → ลิงก์ **Featured pre-release: nssm 2.24-101-g897c7ad** (ไฟล์ zip) | แตกไฟล์ → สร้างโฟลเดอร์ `C:\nssm` → คัดลอกไฟล์ `win64\nssm.exe` ไปไว้ที่ **`C:\nssm\nssm.exe`** |

ติดตั้งครบแล้ว **ปิดหน้าต่าง cmd ทั้งหมด** แล้วเปิด cmd แบบ Run as administrator ใหม่ ตรวจว่า

```
git --version
node --version
sc query MongoDB
```

- `git` และ `node` ต้องขึ้นเลขเวอร์ชัน
- `sc query MongoDB` ต้องขึ้น `STATE : 4 RUNNING`
  (ถ้า MongoDB ไม่ยอม RUNNING อาจเป็นเพราะ CPU เก่ามาก ไม่รองรับ AVX → ให้ใช้ MongoDB เวอร์ชัน 4.4 แทน)

---

## ขั้นที่ 2 — ดึงโค้ดและติดตั้งระบบ

```
cd C:\
git clone https://github.com/navintarBT/HR-Management.git HR-Management
cd C:\HR-Management
powershell -ExecutionPolicy Bypass -File deploy\windows\install.ps1
```

- ถ้า GitHub ขอล็อกอิน → ล็อกอินบัญชี GitHub ที่เข้าถึงโค้ดได้
- ขั้นนี้ใช้เวลาหลายนาที (ดาวน์โหลดแพ็กเกจ + build หน้าเว็บ) เครื่องต้องมีอินเทอร์เน็ต

สคริปต์ `install.ps1` จะทำให้เองทั้งหมด:
- ติดตั้งแพ็กเกจ และ build หน้าเว็บ
- สร้างไฟล์ตั้งค่า `server\.env` พร้อมรหัสลับใหม่ และตั้ง **`DEPLOY_MODE=local`** (server แจกหน้าเว็บเอง และรูปหลักฐานไม่มีเพดาน)
- สร้าง Windows service **`ROMEO-HR`** — เปิดเองเมื่อเปิดเครื่อง, รอ MongoDB, ถ้าล้มจะเปิดใหม่เอง
- เปิด Firewall port 80 และปิดการ Sleep ของเครื่อง

**ผลที่ต้องได้** (ตัวเขียวท้ายสุด):

```
Server is up.
Web app:  http://192.168.0.253
Scanners (COMM > Cloud Server Setting): Server Mode ADMS, Server Address 192.168.0.253, Port 80, HTTPS off, Domain Name off
```

**ตรวจ:**
1. เปิดเบราว์เซอร์บนเครื่อง server → `http://localhost/api/health` → ต้องขึ้น `{"ok":true,"mode":"local"}`
2. ตรวจโหมด:

   ```
   findstr DEPLOY_MODE C:\HR-Management\server\.env
   ```

   ต้องขึ้น `DEPLOY_MODE=local`

> รัน `install.ps1` ซ้ำได้เสมอ — ไฟล์ `.env` เดิม (รหัสลับ) จะไม่ถูกแทนที่

---

## ขั้นที่ 3 — ย้ายข้อมูลจาก MongoDB Atlas (ระบบออนไลน์เดิม)

1. เข้า Render → service ของ backend → **Environment** → คัดลอกค่า **`MONGO_URI`**
   ⚠️ ค่านี้มีรหัสผ่านฐานข้อมูล — **ห้ามส่งให้ใคร ห้ามแคปหน้าจอที่มีค่านี้**
2. เติมชื่อฐานข้อมูล **`/hr_system`** ต่อท้าย URI แล้วรัน

   ```
   cd C:\HR-Management
   powershell -ExecutionPolicy Bypass -File deploy\windows\migrate-from-atlas.ps1 -AtlasUri "mongodb+srv://<ผู้ใช้>:<รหัสผ่าน>@cluster0.xxxxx.mongodb.net/hr_system" -OldApiBase "https://backendhr.minnyone.com/api"
   C:\nssm\nssm.exe restart ROMEO-HR
   ```

3. ผลที่ต้องได้: `photos: ... copied` และ **`Done.`**
4. เปิด `http://192.168.0.253` จากคอมหรือมือถือในร้าน → ล็อกอินด้วยบัญชีเดิม → ต้องเห็นรายชื่อพนักงานและประวัติการสแกนครบ

> ข้อมูลที่ย้ายมาตอนนี้เป็น **สำเนา** — เครื่องสแกนยังส่งไประบบออนไลน์จนถึงวันย้ายจริง (ขั้นที่ 6)

---

## ขั้นที่ 4 — ตั้ง Backup อัตโนมัติ

```
cd C:\HR-Management
powershell -ExecutionPolicy Bypass -File deploy\windows\backup.ps1 -BackupDir D:\ROMEO-backup -Register
powershell -ExecutionPolicy Bypass -File deploy\windows\backup.ps1 -BackupDir D:\ROMEO-backup
schtasks /query /tn "ROMEO-HR backup"
```

ผลที่ต้องได้:
1. `Daily backup scheduled at 03:30 into D:\ROMEO-backup`
2. `Backup written to D:\ROMEO-backup\<วันที่>...`
3. Status เป็น **Ready**

การทำงานของ backup:
- สำรองฐานข้อมูล (รวมรูปหลักฐาน) และรูปพนักงาน **ทุกวันเวลา 03:30** เก็บไว้ 30 วัน
- **ดิสก์ใกล้เต็ม** → ลบชุดเก่าสุดออกเอง (เก็บชุดล่าสุดไว้เสมอ)
- ดูประวัติได้ที่ `D:\ROMEO-backup\backup.log`
- ถ้าเครื่องมีแค่ไดรฟ์ C: ให้ใช้ `C:\ROMEO-backup` แทน
- **ควรคัดลอกโฟลเดอร์ backup ออกไปเก็บนอกเครื่องเป็นประจำ** (USB หรือ Google Drive)

กู้คืนข้อมูลจาก backup (แทนที่ข้อมูลปัจจุบันทั้งหมด):

```
C:\nssm\nssm.exe stop ROMEO-HR
mongorestore --uri mongodb://127.0.0.1:27017 --gzip --drop D:\ROMEO-backup\<วันที่>\db
C:\nssm\nssm.exe start ROMEO-HR
```

แล้วคัดลอกโฟลเดอร์ `uploads` จาก backup ไปไว้ที่ `C:\HR-Management\server\uploads`

---

## ขั้นที่ 5 — ทดลองใช้ (1–2 วัน)

- [ ] ล็อกอินและลองใช้งานหน้าต่างๆ ที่ `http://192.168.0.253`
- [ ] **ห้ามบันทึกงานจริงในเครื่องนี้ช่วงทดลอง** — วันย้ายจริงจะถูกทับด้วยข้อมูลล่าสุดจากระบบออนไลน์
- [ ] ลบพนักงานทดสอบในระบบออนไลน์ (ถ้ามี) ก่อนวันย้าย จะได้ไม่ติดมาด้วย

---

## ขั้นที่ 6 — วันย้ายจริง

เลือกช่วงเวลาที่มีคนสแกนน้อย แล้วทำตามลำดับ:

1. **หยุดระบบในเครื่อง server**

   ```
   C:\nssm\nssm.exe stop ROMEO-HR
   ```

2. **ตั้งเครื่องสแกนทุกเครื่อง** — เมนู COMM → **ตั้งค่าคลาวด์เซิร์ฟเวอร์ (Cloud Server Setting)**

   | รายการ | ค่า |
   |---|---|
   | รูปแบบเซิร์ฟเวอร์ | ADMS |
   | เปิดการใช้งานชื่อโดเมน | **ปิด** |
   | เซิร์ฟเวอร์แอดเดรส | `192.168.0.253` |
   | เซิร์ฟเวอร์พอร์ต | `80` |
   | HTTPS | **ปิด** |
   | พร็อกซี | ปิด |

   และเมนู COMM → **Ethernet**: IP อยู่วงเดียวกัน (เช่น `192.168.0.6`, `192.168.0.7`), Subnet `255.255.255.0`, Gateway `192.168.0.1`
   บันทึก แล้วรีสตาร์ทเครื่องสแกน — ช่วงนี้เครื่องสแกนจะ **เก็บการสแกนไว้รอ** (ไม่หาย)

3. **ย้ายข้อมูลรอบสุดท้าย** — คำสั่งเดียวกับขั้นที่ 3 แต่เติม **`-Overwrite`** ต่อท้าย

   ```
   cd C:\HR-Management
   powershell -ExecutionPolicy Bypass -File deploy\windows\migrate-from-atlas.ps1 -AtlasUri "mongodb+srv://<ผู้ใช้>:<รหัสผ่าน>@cluster0.xxxxx.mongodb.net/hr_system" -OldApiBase "https://backendhr.minnyone.com/api" -Overwrite
   ```

4. **เปิดระบบ** — การสแกนที่ค้างไว้จะส่งเข้ามาเอง

   ```
   C:\nssm\nssm.exe start ROMEO-HR
   ```

5. **ตรวจ**
   - เมนู **ຕັ້ງຄ່າແຜນວຽກ → ເຄື່ອງສະແກນ** → ทุกเครื่องต้องขึ้นว่าติดต่อล่าสุดเมื่อไม่กี่นาทีก่อน
   - ลองสแกน 1 ครั้ง → ต้องขึ้นในเมนู **ປະຫວັດການສະແກນ**
   - เครื่องสแกนที่ขึ้น **ລໍຖ້າອະນຸມັດ** → ตรวจ serial แล้วกด **ອະນຸມັດເຄື່ອງນີ້** และเปิด **ຊິງ**

6. **ใส่ชื่อภาษาอังกฤษให้พนักงาน** (สำหรับแสดงบนเครื่องสแกน — ถ้ายังไม่เคยทำ)

   ```
   cd C:\HR-Management\server
   npm run fill-english-names
   npm run fill-english-names -- --apply
   ```

   คำสั่งแรกแสดงรายชื่อให้ตรวจก่อน (บันทึกเป็นไฟล์ `english-names.csv` ด้วย) คำสั่งที่สองบันทึกจริงและส่งชื่อไปเครื่องสแกน

7. **แจ้งผู้ใช้ทุกคน** ให้ใช้ที่อยู่ใหม่ (ต้องล็อกอินใหม่ 1 ครั้ง ด้วยรหัสเดิม)
   - HR: `http://192.168.0.253`
   - พนักงาน: `http://192.168.0.253/me`

8. **ปิดระบบออนไลน์เดิม** — Suspend service บน Render และปิดโปรเจกต์บน Vercel
   (ถ้าไม่ปิด คนที่ยังเปิดเว็บเก่าจะบันทึกข้อมูลลงระบบเก่า ซึ่งจะไม่มาถึงเครื่องร้าน)

9. **เปลี่ยนรหัสผ่านฐานข้อมูล Atlas** (Atlas → Database Access → Edit → Edit Password) หรือ Pause cluster

---

## ขั้นที่ 7 — การดูแลประจำ

| งาน | คำสั่ง (cmd แบบ admin) |
|---|---|
| อัปเดตระบบเป็นเวอร์ชันล่าสุด | ดูขั้นที่ 8 |
| รีสตาร์ทระบบ | `C:\nssm\nssm.exe restart ROMEO-HR` |
| หยุด / เปิดระบบ | `C:\nssm\nssm.exe stop ROMEO-HR` / `C:\nssm\nssm.exe start ROMEO-HR` |
| ดูสถานะระบบ | `C:\nssm\nssm.exe status ROMEO-HR` (ต้องเป็น `SERVICE_RUNNING`) |
| ตรวจว่าระบบตอบ | เปิด `http://localhost/api/health` → `{"ok":true,"mode":"local"}` |
| ดู log ระบบ | เปิดไฟล์ `C:\HR-Management\server\logs\server.log` |
| ดู log backup | เปิดไฟล์ `D:\ROMEO-backup\backup.log` |
| เพิ่มเครื่องสแกนใหม่ | ตั้งเครื่องตามขั้นที่ 6 ข้อ 2 → เมนู ເຄື່ອງສະແກນ → **ອະນຸມັດເຄື່ອງນີ້** → เปิด **ຊິງ** |

> ชื่อ service **`ROMEO-HR`** เป็นชื่อที่ `install.ps1` ตั้งให้ — ไม่เกี่ยวกับชื่อโฟลเดอร์ ใน Windows Services จะแสดงเป็น "ROMEO HR server"

---

## ขั้นที่ 8 — อัปเดตระบบ หลัง push โค้ดใหม่ขึ้น GitHub

หลัง push จากคอมที่พัฒนาแล้ว เครื่อง server ในร้าน **ไม่ได้อัปเดตเอง** — ต้องสั่งอัปเดตทุกครั้ง

1. ที่เครื่อง server เปิด **cmd แบบ Run as administrator**
2. รันคำสั่งอัปเดต

   ```
   cd C:\HR-Management
   powershell -ExecutionPolicy Bypass -File deploy\windows\update.ps1
   ```

   สคริปต์จะ ดึงโค้ดใหม่ (`git pull`) → ติดตั้งแพ็กเกจ → build หน้าเว็บใหม่ → รีสตาร์ท service `ROMEO-HR`
   ผลที่ต้องได้ (ตัวเขียว): **`Updated and running.`**
3. ตรวจ
   - เปิด `http://192.168.0.253` แล้วกด **Ctrl+F5** เพื่อโหลดหน้าเว็บเวอร์ชันใหม่ (ไม่งั้นอาจยังเห็นของเก่าที่ค้างในเบราว์เซอร์)
   - เปิด `http://localhost/api/health` บนเครื่อง server → `{"ok":true,"mode":"local"}`

**ข้อควรรู้**

- **ถ้าการแก้ไขเกี่ยวกับชุดติดตั้งหรือการตั้งค่า** (เช่น แก้ `install.ps1`) ให้ใช้คำสั่งนี้แทนข้อ 2

  ```
  cd C:\HR-Management
  git pull
  powershell -ExecutionPolicy Bypass -File deploy\windows\install.ps1
  ```

- **ก่อนอัปเดตครั้งใหญ่** ให้ backup ก่อน

  ```
  powershell -ExecutionPolicy Bypass -File deploy\windows\backup.ps1 -BackupDir D:\ROMEO-backup
  ```

- ช่วงที่ Render และ Vercel ยังเปิดอยู่ (ก่อนวันย้ายจริง) ทุกครั้งที่ push ระบบออนไลน์จะอัปเดตเองด้วย — หลังปิด Render/Vercel แล้ว การ push จะไปแค่ GitHub ต้องรัน `update.ps1` ที่เครื่องร้านทุกครั้ง
- **อย่าแก้ไฟล์โค้ดบนเครื่อง server โดยตรง** — `git pull` จะ error ได้ แก้ได้เฉพาะ `server\.env` (ไม่ถูกแตะตอนอัปเดต)

---

## แก้ปัญหาที่พบบ่อย

| อาการ | สาเหตุ / วิธีแก้ |
|---|---|
| `'git' is not recognized ...` | ยังไม่ได้ติดตั้ง Git (มีแค่ไฟล์ตัวติดตั้ง) หรือเปิด cmd ไว้ก่อนติดตั้ง → ติดตั้ง Git แล้ว **เปิด cmd ใหม่** |
| `Could not resolve host: github.com` | เครื่องไม่มี DNS / ออกเน็ตไม่ได้ → ใส่ DNS `8.8.8.8` ตามขั้นที่ 0 แล้วลอง `ping github.com` |
| `mongodump not found` | ยังไม่ได้ติดตั้ง MongoDB Database Tools (ขั้นที่ 1 ข้อ 4) หรือยังไม่ได้เปิด cmd ใหม่หลังติดตั้ง |
| `The specified service does not exist` | พิมพ์ชื่อ service ผิด — ต้องเป็น `ROMEO-HR` / ถ้ายังไม่มีจริง ให้รัน `install.ps1` ใหม่ |
| `'Select-String' / 'Get-ScheduledTask' is not recognized` | เป็นคำสั่งของ PowerShell — ใน cmd ให้ใช้ `findstr` และ `schtasks` แทน |
| `The argument 'deploy\windows\install.ps1' ... does not exist` | ยังไม่ได้อยู่ในโฟลเดอร์ระบบ หรือ clone ไม่สำเร็จ → `cd C:\HR-Management` ก่อน |
| อัปเดตแล้ว `git pull failed` / `Your local changes ... would be overwritten` | มีคนแก้ไฟล์โค้ดบนเครื่อง server → แจ้งผู้พัฒนา อย่าแก้ไฟล์โค้ดบนเครื่อง server เอง |
| อัปเดตแล้วหน้าเว็บยังเหมือนเดิม | เบราว์เซอร์จำหน้าเก่าไว้ → กด **Ctrl+F5** |
| เครื่องสแกนไม่ส่งข้อมูลเข้ามา | ตรวจ IP/port ในเครื่องสแกน, เครื่องสแกนกับ server อยู่วง LAN เดียวกัน, ปิด HTTPS และชื่อโดเมนในเครื่องสแกน, รีสตาร์ทเครื่องสแกน |
| เครื่องสแกนขึ้น **ລໍຖ້າອະນຸມັດ** | เป็นเครื่องที่ติดต่อมาครั้งแรก → กด **ອະນຸມັດເຄື່ອງນີ້** ในเมนู ເຄື່ອງສະແກນ |

---

## Checklist สรุป

- [ ] ขั้นที่ 0 — IP คงที่ + DNS, `ping github.com` ได้
- [ ] ขั้นที่ 1 — Node.js, Git, MongoDB Server (RUNNING), Database Tools, NSSM
- [ ] ขั้นที่ 2 — clone + `install.ps1` → `Server is up.` และ `DEPLOY_MODE=local`
- [ ] ขั้นที่ 3 — ย้ายข้อมูลจาก Atlas → `Done.` และล็อกอินได้
- [ ] ขั้นที่ 4 — backup ตั้งเวลาแล้ว (Ready) และลองรันสำเร็จ
- [ ] ขั้นที่ 5 — ทดลองใช้ 1–2 วัน
- [ ] ขั้นที่ 6 — วันย้ายจริง (หยุดระบบ → ตั้งเครื่องสแกน → ย้ายรอบสุดท้าย → เปิดระบบ → ตรวจ → ชื่ออังกฤษ → แจ้งผู้ใช้ → ปิดระบบออนไลน์ → เปลี่ยนรหัส Atlas)
- [ ] ทุกครั้งที่ push โค้ดใหม่ — ขั้นที่ 8 (`update.ps1` → `Updated and running.` → Ctrl+F5)
