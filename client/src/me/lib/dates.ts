import dayjs from 'dayjs';

const DAYS = ['ອາທິດ', 'ຈັນ', 'ອັງຄານ', 'ພຸດ', 'ພະຫັດ', 'ສຸກ', 'ເສົາ'];
const MONTHS = ['ມັງກອນ', 'ກຸມພາ', 'ມີນາ', 'ເມສາ', 'ພຶດສະພາ', 'ມິຖຸນາ', 'ກໍລະກົດ', 'ສິງຫາ', 'ກັນຍາ', 'ຕຸລາ', 'ພະຈິກ', 'ທັນວາ'];

// "ສຸກ 30 ຕຸລາ" (with the year when it isn't this year).
export function shiftDayLabel(dateKey: string) {
  const d = dayjs(dateKey);
  const year = d.year() !== dayjs().year() ? ` ${d.year()}` : '';
  return `${DAYS[d.day()]} ${d.date()} ${MONTHS[d.month()]}${year}`;
}

export const timeLabel = (value?: string | null) => (value ? dayjs(value).format('HH:mm') : '');
export const dateTimeLabel = (value?: string | null) => (value ? dayjs(value).format('DD/MM/YYYY HH:mm') : '-');
export const KIND_LABEL = { in: 'ເຂົ້າວຽກ', out: 'ອອກວຽກ' } as const;
