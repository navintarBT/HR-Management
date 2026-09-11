# ລະບົບ HR + ລົງເວລາ (MVP)

ລະບົບບໍລິຫານງານບຸກຄະລາກອນທີ່ເນັ້ນ **ການລົງເວລາເຂົ້າ-ອອກດ້ວຍເຄື່ອງສະແກນ** ພ້ອມຂໍ້ມູນຕົວຢ່າງຄົບຖ້ວນ
ແລ່ນໄດ້ທັງໝົດເທິງເຄື່ອງ local ໂດຍບໍ່ຕ້ອງມີເຄື່ອງສະແກນແທ້ (ມີປຸ່ມ "ຈໍາລອງການສະແກນນິ້ວ" ຢູ່ໜ້າເວັບ)

## Tech stack

- **Frontend:** React + Vite + [Refine](https://refine.dev) (`@refinedev/core`, `@refinedev/antd`) + Ant Design
- **Backend:** Node.js + Express + Mongoose
- **Database:** MongoDB (ແລ່ນຜ່ານ docker-compose)
- **Auth:** JWT + role-based (`admin`, `manager`, `employee`)

## ໂຄງສ້າງໂປຣເຈັກ

```
/server              Express API + Mongoose models + seed script
/client              React + Vite + Refine + Ant Design
/docker-compose.yml  MongoDB
```

## ວິທີແລ່ນ

### 1. ເລີ່ມ MongoDB

```bash
docker compose up -d
```

### 2. ຕິດຕັ້ງ ແລະ ແລ່ນ backend

```bash
cd server
cp .env.example .env
npm install
npm run seed   # ລ້າງຂໍ້ມູນເກົ່າແລ້ວສ້າງຂໍ້ມູນຕົວຢ່າງທັງໝົດ
npm run dev    # http://localhost:4000
```

### 3. ຕິດຕັ້ງ ແລະ ແລ່ນ frontend

```bash
cd client
cp .env.example .env
npm install
npm run dev    # http://localhost:5173
```

ເປີດເບຣົາເຊີໄປທີ່ `http://localhost:5173` ແລ້ວເຂົ້າສູ່ລະບົບດ້ວຍບັນຊີຕົວຢ່າງທາງລຸ່ມ
(ໜ້າ login ມີປຸ່ມກອກໃຫ້ອັດຕະໂນມັດ)

## ບັນຊີສໍາລັບທົດລອງໃຊ້

ສ້າງຈາກ `npm run seed`:

| Role | Email | Password |
|---|---|---|
| admin/HR | `admin@hr-demo.local` | `Admin@123` |
| manager | `manager@hr-demo.local` | `Manager@123` |
| employee | `employee@hr-demo.local` | `Employee@123` |

ຂໍ້ມູນຕົວຢ່າງທີ່ seed ໃຫ້:
- 4 ພະແນກ, 4 ຕໍາແໜ່ງງານ, ພະນັກງານ 18 ຄົນ (16 active / 2 inactive)
- Log ການສະແກນເຂົ້າ-ອອກຍ້ອນຫຼັງ ~30 ວັນ (ວັນທໍາມະດາ) ຕໍ່ພະນັກງານ 1 ຄົນ ພ້ອມປະມວນຜົນເປັນບົດລາຍງານລາຍວັນ (ມາຊ້າ/OT/ຂາດງານແບບສຸ່ມ)
- ຄໍາຂໍລາ 5 ລາຍການ (ທັງສະຖານະ pending / approved / rejected)

## ຄຸນສົມບັດຫຼັກ

1. **Auth + ສິດທິ**: login ດ້ວຍ JWT, 3 role (admin/HR, manager, employee)
2. **ຈັດການພະນັກງານ**: CRUD ເຕັມຮູບແບບ ຄົ້ນຫາ/ກັ່ນຕອງ/ແບ່ງໜ້າ
3. **ພະແນກ/ຕໍາແໜ່ງງານ**: CRUD ຜ່ານໜ້າ "ພະແນກ / ຕໍາແໜ່ງ"
4. **ລົງເວລາ (Attendance)**:
   - `POST /api/attendance/push` — endpoint ຮັບຂໍ້ມູນຈາກເຄື່ອງສະແກນ (payload ແບບ JSON: `{ deviceId, userId, timestamp }`)
   - ປຸ່ມ **"ຈໍາລອງການສະແກນນິ້ວ"** ຢູ່ໜ້າ UI ສໍາລັບທົດສອບໂດຍບໍ່ຕ້ອງມີເຄື່ອງແທ້
   - ລະບົບປະມວນຜົນ log ອັດຕະໂນມັດເປັນບົດລາຍງານລາຍວັນ (ເວລາເຂົ້າ/ອອກ, ຊົ່ວໂມງເຮັດວຽກ, ມາຊ້າ, OT)
   - ບົດລາຍງານລາຍວັນ + ປະຫວັດການສະແກນດິບ ພ້ອມຕົວກອງພະນັກງານ/ຊ່ວງວັນທີ
5. **ການລາ**: ຂໍລາ, ອະນຸມັດ/ປະຕິເສດ (manager/admin), ສະແດງສະຖານະດ້ວຍ Tag ສີ
6. **ແດຊບອດ**: ສະຫຼຸບຍອດມື້ນີ້ + ກຣາບແນວໂນ້ມຍ້ອນຫຼັງ 14 ວັນ (ສະແດງທັນທີຫຼັງ login)

## ໝາຍເຫດການເຊື່ອມຕໍ່ເຄື່ອງສະແກນແທ້

ເຄື່ອງສະແກນລາຍນິ້ວມື/ບັດ ຍີ່ຫໍ້ ZKTeco ສ່ວນຫຼາຍລົມກັນດ້ວຍໂປຣໂຕຄອນ **ADMS**
(HTTP ແບບຂໍ້ຄວາມ tab-separated ທີ່ path `/iclock/cdata`, ບໍ່ແມ່ນ JSON) ເຊິ່ງແຕກຕ່າງຈາກ
endpoint `POST /api/attendance/push` ທີ່ສ້າງໄວ້ສໍາລັບ MVP ນີ້

ໄຟລ໌ [`server/src/routes/admsStub.js`](server/src/routes/admsStub.js) ມີ stub handler
ພ້ອມຄອມເມັນ `TODO` ອະທິບາຍຈຸດທີ່ຕ້ອງເພີ່ມ (parse ATTLOG, map deviceUserId → employee,
ຕອບກັບເປັນ plain text `OK`) ສໍາລັບການເຊື່ອມຕໍ່ເຄື່ອງແທ້ໃນເຟສຕໍ່ໄປ

## .env ທີ່ຕ້ອງຕັ້ງຄ່າ

- `server/.env.example` → `MONGO_URI`, `JWT_SECRET`, `JWT_EXPIRES_IN`, `PORT`, `CLIENT_ORIGIN`
- `client/.env.example` → `VITE_API_URL` (ຄ່າເລີ່ມຕົ້ນ `/api` ໃຊ້ຜ່ານ Vite dev proxy ໄປທີ່ backend ພອດ 4000)
