import type { I18nProvider } from '@refinedev/core';

// Minimal Lao dictionary covering the translation keys Refine's core/antd
// packages actually call internally (SaveButton, DeleteButton confirm,
// notifications, error pages). Everything else in this app is written
// directly in Lao rather than routed through i18n.
const dictionary: Record<string, string> = {
  'buttons.save': 'ບັນທຶກ',
  'buttons.cancel': 'ຍົກເລີກ',
  'buttons.clear': 'ລ້າງ',
  'buttons.filter': 'ກັ່ນຕອງ',
  'buttons.logout': 'ອອກຈາກລະບົບ',
  'buttons.confirm': 'ທ່ານແນ່ໃຈບໍ?',
  'buttons.delete': 'ລຶບ',
  'buttons.refresh': 'ໂຫລດໃໝ່',
  'buttons.notAccessTitle': 'ທ່ານບໍ່ມີສິດເຂົ້າເຖິງໜ້ານີ້',
  'notifications.success': 'ສໍາເລັດ',
  'notifications.error': 'ເກີດຂໍ້ຜິດພາດ (ລະຫັດ: {{statusCode}})',
  'notifications.undoable': 'ທ່ານມີເວລາ {{seconds}} ວິນາທີເພື່ອຍົກເລີກ',
  'notifications.createSuccess': 'ສ້າງ {{resource}} ສໍາເລັດແລ້ວ',
  'notifications.createError': 'ເກີດຂໍ້ຜິດພາດໃນການສ້າງ {{resource}} (ລະຫັດ: {{statusCode}})',
  'notifications.editSuccess': 'ແກ້ໄຂ {{resource}} ສໍາເລັດແລ້ວ',
  'notifications.editError': 'ເກີດຂໍ້ຜິດພາດໃນການແກ້ໄຂ {{resource}} (ລະຫັດ: {{statusCode}})',
  'notifications.deleteSuccess': 'ລຶບ {{resource}} ສໍາເລັດແລ້ວ',
  'notifications.deleteError': 'ເກີດຂໍ້ຜິດພາດໃນການລຶບ {{resource}} (ລະຫັດ: {{statusCode}})',
  'notifications.importProgress': 'ກໍາລັງນໍາເຂົ້າ: {{processed}}/{{total}}',
  'pages.error.404': 'ຂໍອະໄພ, ບໍ່ພົບໜ້ານີ້.',
  'pages.error.backHome': 'ກັບໄປໜ້າຫຼັກ',
  'pages.error.info': 'ທ່ານອາດລືມເພີ່ມອົງປະກອບ {{action}} ໃຫ້ຊັບພະຍາກອນ {{resource}}.',

  // Refine looks up `${resource}.${resource}` for a resource's display name in
  // notifications (e.g. "Successfully created {{resource}}") before falling
  // back to the raw English singular — map every resource so those toasts
  // read in Lao end-to-end instead of mixing in an English word.
  'employees.employees': 'ພະນັກງານ',
  'departments.departments': 'ພະແນກ',
  'positions.positions': 'ຕໍາແໜ່ງ',
  'attendance-logs.attendance-logs': 'ປະຫວັດການສະແກນ',
  'attendance-daily.attendance-daily': 'ລາຍງານການສະແກນ',
  'leaves.leaves': 'ໃບລາ',
  'overtime.overtime': 'OT',
  'shifts.shifts': 'ກະ',
  'shift-swaps.shift-swaps': 'ສະຫຼັບກະ',
  'medicine-expenses.medicine-expenses': 'ຄ່າຢາ',
  'substitute-rule.substitute-rule': 'ກົດ "ມາແທນ"',
};

function interpolate(template: string, params?: Record<string, any>): string {
  if (!params) return template;
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, key) => (params[key] !== undefined ? String(params[key]) : ''));
}

export const i18nProvider: I18nProvider = {
  // Refine calls this both as translate(key, paramsObject, defaultString) and,
  // for resource-name lookups (e.g. `${resource}.${resource}`), as the
  // i18next-style translate(key, defaultString) — a plain string in the
  // second slot is a default value, not interpolation params.
  translate: (key: string, optionsOrDefault?: any, maybeDefault?: string) => {
    const isDefaultAsSecondArg = typeof optionsOrDefault === 'string';
    const options = isDefaultAsSecondArg ? undefined : optionsOrDefault;
    const defaultMessage = isDefaultAsSecondArg ? optionsOrDefault : maybeDefault;
    const template = dictionary[key] ?? defaultMessage ?? key;
    return interpolate(template, options);
  },
  changeLocale: async () => undefined,
  getLocale: () => 'lo',
};
