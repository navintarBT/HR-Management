import type { Rule } from 'antd/es/form';

// The English name is what the scanners show — they only display Latin
// letters, and their name field holds 24 characters (server: routes/employees.js
// validateNameEn, utils/zkProtocol.js DEVICE_NAME_MAX_BYTES).
export const NAME_EN_MAX = 24;

export const NAME_EN_RULES: Rule[] = [
  { required: true, whitespace: true, message: 'ກະລຸນາປ້ອນຊື່ພາສາອັງກິດ (ສຳລັບເຄື່ອງສະແກນ)' },
  { pattern: /^[A-Za-z0-9 .'-]*$/, message: 'ໃຊ້ໄດ້ສະເພາະຕົວອັກສອນ A-Z, ຕົວເລກ ແລະ ຍະຫວ່າງ' },
  { max: NAME_EN_MAX, message: `ບໍ່ເກີນ ${NAME_EN_MAX} ຕົວ` },
];
