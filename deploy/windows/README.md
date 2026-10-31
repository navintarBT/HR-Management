# ຕິດຕັ້ງລະບົບ ROMEO HR ໃນເຄື່ອງ server Windows ທີ່ຮ້ານ

ລະບົບທັງໝົດ (ໜ້າເວັບ, API ແລະ ບ່ອນຮັບຂໍ້ມູນຈາກເຄື່ອງສະແກນ) ແລ່ນເປັນ Windows service ດຽວຊື່ `ROMEO-HR`:

```
ເຄື່ອງສະແກນ SenseFace 2A ──LAN──►  server ໃນຮ້ານ (service ROMEO-HR)  ◄── ບຣາວເຊີຂອງຜູ້ໃຊ້
                                          │
                                     MongoDB (ໃນເຄື່ອງ)
```

ເຄື່ອງສະແກນສົ່ງຂໍ້ມູນເຂົ້າ server ໂດຍກົງ — ບໍ່ຕ້ອງມີຄອມຕົວກາງ (Caddy) ອີກ.

## 1. ກຽມເຄື່ອງ

- ຕັ້ງ IP ຄົງທີ່ ເຊັ່ນ `192.168.99.10` (ຈອງ IP ໃນ router ຫຼື ຕັ້ງໃນ Windows)
- ຕໍ່ UPS — server ຕ້ອງເປີດ 24 ຊົ່ວໂມງ
- `install.ps1` ປິດການ Sleep ໃຫ້ເອງ

## 2. ໂປຣແກຣມທີ່ຕ້ອງຕິດຕັ້ງກ່ອນ

| ໂປຣແກຣມ | ໃຊ້ເຮັດຫຍັງ | ໝາຍເຫດ |
| --- | --- | --- |
| Node.js (LTS) | ແລ່ນລະບົບ | nodejs.org |
| Git | ດຶງ ແລະ ອັບເດດໂຄດ | git-scm.com |
| NSSM | ໃຫ້ລະບົບແລ່ນເປັນ service | nssm.cc — ວາງ `nssm.exe` ໄວ້ທີ່ `C:\nssm\nssm.exe` |
| MongoDB Community Server | ຖານຂໍ້ມູນ | ເລືອກ "Install MongoD as a Service" |
| MongoDB Database Tools | ສຳຮອງ ແລະ ຍ້າຍຂໍ້ມູນ | ມີ `mongodump`, `mongorestore` |

ຖ້າຈະໃຊ້ MongoDB Atlas ຕໍ່ (ບໍ່ມີຖານຂໍ້ມູນໃນເຄື່ອງ): ຂ້າມ MongoDB Community Server ແລະ ຂັ້ນຕອນທີ 4 — ແຕ່ server ຕ້ອງມີອິນເຕີເນັດຕະຫຼອດ.

## 3. ດຶງໂຄດ ແລະ ຕິດຕັ້ງ

ເປີດ PowerShell ແບບ **Run as administrator**:

```powershell
cd C:\
git clone https://github.com/navintarBT/HR-Management.git ROMEO-HR
cd C:\ROMEO-HR
powershell -ExecutionPolicy Bypass -File deploy\windows\install.ps1
```

- ຄ່າເລີ່ມຕົ້ນ: port `80`, ຖານຂໍ້ມູນ `mongodb://127.0.0.1:27017/romeo-hr`
- ໃຊ້ Atlas ຕໍ່: ເພີ່ມ `-MongoUri "<MONGO_URI ຂອງ Atlas>"` — ແລ້ວ **ປິດ server ເກົ່າ (Render)**: ສອງ server ໃສ່ຖານຂໍ້ມູນດຽວກັນ ຈະແລ່ນວຽກອັດຕະໂນມັດ (ຕັດຂາດ, ສະຫຼັບຕຳແໜ່ງ, ...) ຊ້ຳກັນ 2 ຊຸດ
- port 80 ມີໂປຣແກຣມອື່ນໃຊ້ແລ້ວ: ເພີ່ມ `-Port 4000`

ສະຄຣິບຈະສ້າງ `server\.env` (ພ້ອມ `JWT_SECRET` ໃໝ່), ຕິດຕັ້ງ service, ເປີດ Firewall ແລະ ບອກທີ່ຢູ່ສຳລັບເປີດໜ້າເວັບ ແລະ ຕັ້ງເຄື່ອງສະແກນ. ແລ່ນຊ້ຳໄດ້ — `.env` ທີ່ມີຢູ່ແລ້ວຈະບໍ່ຖືກແທນທີ່.

## 4. ຍ້າຍຂໍ້ມູນຈາກ Atlas

```powershell
powershell -ExecutionPolicy Bypass -File deploy\windows\migrate-from-atlas.ps1 `
  -AtlasUri "<MONGO_URI ເກົ່າທີ່ຕັ້ງໄວ້ໃນ Render>" `
  -OldApiBase "https://<ທີ່ຢູ່ server ເກົ່າ>/api"
```

ສຳເນົາຂໍ້ມູນທັງໝົດ (ລວມບັນຊີຜູ້ໃຊ້) ມາຖານຂໍ້ມູນໃນເຄື່ອງ ແລະ ຮູບພະນັກງານທີ່ຍັງມີຢູ່ server ເກົ່າ. ທຸກຄົນເຂົ້າສູ່ລະບົບດ້ວຍລະຫັດເດີມໄດ້ (ແຕ່ຕ້ອງ login ໃໝ່ເທື່ອໜຶ່ງ). ແລ່ນຄັ້ງທີສອງຕ້ອງໃສ່ `-Overwrite` — ຂໍ້ມູນໃນເຄື່ອງຈະຖືກແທນທີ່ດ້ວຍຂໍ້ມູນຈາກ Atlas.

**ລຳດັບມື້ປ່ຽນ (ບໍ່ໃຫ້ການສະແກນຫາຍ):**

1. ຕິດຕັ້ງ, ຍ້າຍຂໍ້ມູນ ແລະ ທົດລອງໃຊ້ server ໃໝ່ກ່ອນ — ເຄື່ອງສະແກນຍັງສົ່ງໄປ server ເກົ່າ
2. ມື້ປ່ຽນ: ຢຸດ service Caddy ໃນຄອມຕົວກາງ — ເຄື່ອງສະແກນຈະເກັບການສະແກນໄວ້ໃນເຄື່ອງ ແລະ ລໍຖ້າສົ່ງ
3. ຍ້າຍຂໍ້ມູນຄັ້ງສຸດທ້າຍດ້ວຍ `-Overwrite`
4. ຕັ້ງເຄື່ອງສະແກນໃຫ້ຊີ້ມາ server ໃໝ່ (ຂັ້ນຕອນທີ 5) — ການສະແກນທີ່ຄ້າງຢູ່ຈະສົ່ງເຂົ້າມາເອງ
5. ກວດວ່າທຸກຢ່າງຖືກຕ້ອງແລ້ວ ຈຶ່ງປິດ server ເກົ່າ (Render) ແລະ ໜ້າເວັບເກົ່າ (Vercel)

## 5. ຕັ້ງເຄື່ອງສະແກນ SenseFace 2A

ຊື່ເມນູອາດຕ່າງກັນເລັກນ້ອຍຕາມເຟີມແວ:

1. ປ່ຽນເປັນໂໝດລົງເວລາ **T&A PUSH** (ເມນູປະມານ System → Device Type Setting) — ເຮັດກ່ອນລົງທະບຽນພະນັກງານ ເພາະການປ່ຽນໂໝດອາດລຶບຂໍ້ມູນໃນເຄື່ອງ
2. COMM → Ethernet: IP ໃນວົງດຽວກັນ ເຊັ່ນ `192.168.99.21` ແລະ Gateway ຂອງ router
3. COMM → Cloud Server Setting:
   - Server Mode = **ADMS**
   - Enable Domain Name = **OFF**
   - Server Address = IP ຂອງ server (ເຊັ່ນ `192.168.99.10`)
   - Server Port = `80` (ຫຼື port ທີ່ໃຊ້ຕອນຕິດຕັ້ງ)
   - HTTPS = **OFF**, Proxy = **OFF**
4. ຕັ້ງວັນທີ, ເວລາ ແລະ ເຂດເວລາ (GMT+7) ໃຫ້ຖືກ — ລະບົບໃຊ້ເວລາຂອງເຄື່ອງສະແກນໂດຍກົງ
5. ກວດໃນໜ້າ **ຕັ້ງຄ່າແຜນວຽກ → ເຄື່ອງສະແກນ**: ເຄື່ອງຈະຂຶ້ນພາຍໃນ 1–2 ນາທີ ພ້ອມຊື່ລຸ້ນ ແລະ "ຖາມຫາຄຳສັ່ງລ່າສຸດ" ມີເວລາ. ຖ້າຂຶ້ນ "ເຄື່ອງຢູ່ໂໝດຄວບຄຸມປະຕູ" = ຍັງບໍ່ໄດ້ປ່ຽນເປັນ T&A PUSH
6. ເຄື່ອງທີ່ຕິດຕໍ່ມາຄັ້ງທຳອິດຈະຂຶ້ນ **ລໍຖ້າອະນຸມັດ** — ທຽບ serial ກັບສະຕິກເກີຫຼັງເຄື່ອງ ແລ້ວກົດ **ອະນຸມັດເຄື່ອງນີ້** (ບັນຊີ admin). ກ່ອນອະນຸມັດ ການສະແກນຈາກເຄື່ອງນັ້ນຍັງບໍ່ເຂົ້າລະບົບ, ແຕ່ເຄື່ອງເກັບໄວ້ ແລະ ສົ່ງເຂົ້າມາເອງຫຼັງອະນຸມັດ. ເຄື່ອງທີ່ຍ້າຍມາພ້ອມຂໍ້ມູນຈາກ Atlas (ຂັ້ນຕອນທີ 4) ອະນຸມັດຢູ່ແລ້ວ
7. ເປີດ "ຊິງ" ຂອງເຄື່ອງໃນໜ້ານັ້ນ ເພື່ອສົ່ງພະນັກງານທັງໝົດໄປເຄື່ອງ

## 6. ສຳຮອງຂໍ້ມູນທຸກມື້

```powershell
powershell -ExecutionPolicy Bypass -File deploy\windows\backup.ps1 -BackupDir D:\ROMEO-backup -Register
```

ສຳຮອງຖານຂໍ້ມູນ ແລະ ຮູບພະນັກງານທຸກມື້ເວລາ 03:30, ເກັບໄວ້ 30 ມື້. **ຄວນສຳເນົາໂຟນເດີ backup ອອກນອກເຄື່ອງເປັນປະຈຳ** (USB ຫຼື Google Drive) — ຖ້າ disk ເສຍ ຂໍ້ມູນທີ່ຢູ່ໃນເຄື່ອງດຽວຈະຫາຍໝົດ.

ກູ້ຄືນ (ແທນທີ່ຂໍ້ມູນປັດຈຸບັນທັງໝົດ):

```powershell
mongorestore --uri mongodb://127.0.0.1:27017 --drop D:\ROMEO-backup\<ວັນທີ>\db
```

ແລ້ວສຳເນົາໂຟນເດີ `uploads` ຈາກ backup ຄືນໄປໄວ້ທີ່ `server\uploads`.

## 7. ອັບເດດລະບົບ

```powershell
powershell -ExecutionPolicy Bypass -File deploy\windows\update.ps1
```

ດຶງໂຄດໃໝ່, build ໜ້າເວັບ ແລະ restart service.

## 8. ເຂົ້າໃຊ້ຈາກນອກຮ້ານ

ງ່າຍສຸດ: ຕິດຕັ້ງ Tailscale ໃນ server ແລະ ໃນມືຖື/ຄອມທີ່ຈະໃຊ້ ແລ້ວເປີດ `http://<ຊື່ server ໃນ Tailscale>` — ບໍ່ຕ້ອງເປີດ port ໃນ router.

## ແກ້ບັນຫາ

- ກວດວ່າລະບົບແລ່ນຢູ່: ເປີດ `http://localhost/api/health` ໃນ server ຕ້ອງໄດ້ `{"ok":true}`
- Log: `server\logs\server.log`
- Restart: `C:\nssm\nssm.exe restart ROMEO-HR` (ຫຼື Services → ROMEO HR server)
- ເຄື່ອງສະແກນບໍ່ເຂົ້າ: ກວດ IP ແລະ port ໃນເຄື່ອງ, Firewall, ແລະ ວ່າ server ກັບເຄື່ອງສະແກນຢູ່ວົງ LAN ດຽວກັນ
