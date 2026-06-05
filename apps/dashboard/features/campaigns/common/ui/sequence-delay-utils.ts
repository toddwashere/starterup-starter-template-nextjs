const MINUTES_PER_DAY = 1440;

export function delayDaysToMinutes(days: number) {
  return Math.max(0, Math.round(days)) * MINUTES_PER_DAY;
}

export function delayMinutesToDays(minutes: number) {
  return Math.max(0, Math.round(minutes / MINUTES_PER_DAY));
}

export function getDelayDayOptions(currentDays: number) {
  const baseOptions = Array.from({ length: 31 }, (_, days) => days);
  return baseOptions.includes(currentDays) ? baseOptions : [...baseOptions, currentDays];
}
