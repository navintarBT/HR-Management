// Shared between ປະຫວັດການສະແກນເຂົ້າ-ອອກວຽກ (per-day labels) and ລາຍງານການສະແກນ
// (per-employee monthly tier counts) — kept in one place so the two pages
// can never drift on where the "ຊ້າ" / "ຊ້າເກີນ X" / "ຊ້າເກີນ Y" boundaries
// actually fall. graceMinutes/severeLateMinutes are read off the specific
// AttendanceDaily record (the shift category's policy AS OF when that day
// was computed), not looked up live, so a later policy change never
// reshuffles a day that's already been processed.

// e.g. 60 -> "1 ຊົ່ວໂມງ", 90 -> "1 ຊົ່ວໂມງ 30 ນາທີ", 45 -> "45 ນາທີ".
export function formatMinutes(minutes: number): string {
  if (minutes < 60) return `${minutes} ນາທີ`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} ຊົ່ວໂມງ ${rest} ນາທີ` : `${hours} ຊົ່ວໂມງ`;
}

export type LateTier = 'mild' | 'moderate' | 'severe';

export function lateTier(lateMinutes: number, graceMinutes?: number | null, severeLateMinutes?: number | null): LateTier {
  if (severeLateMinutes && lateMinutes > severeLateMinutes) return 'severe';
  if (graceMinutes && lateMinutes > graceMinutes) return 'moderate';
  return 'mild';
}

export function lateLabel(lateMinutes: number, graceMinutes?: number | null, severeLateMinutes?: number | null): string {
  const tier = lateTier(lateMinutes, graceMinutes, severeLateMinutes);
  if (tier === 'severe') return `ຊ້າເກີນ ${formatMinutes(severeLateMinutes!)}`;
  if (tier === 'moderate') return `ຊ້າເກີນ ${formatMinutes(graceMinutes!)}`;
  return 'ຊ້າ';
}
