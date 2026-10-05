import dayjs from 'dayjs';

// Localized (Lao, via the global dayjs.locale('lo') set in contexts/color-mode.tsx)
// weekday names for a day-of-week picker, independent of any specific date.
// 0 = Sunday .. 6 = Saturday, matching dayjs's own .day()/Employee.defaultRestDay.
export const WEEKDAY_OPTIONS = Array.from({ length: 7 }, (_, i) => ({
  value: i,
  label: dayjs().day(i).format('dddd'),
}));
