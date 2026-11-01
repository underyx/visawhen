/** How many months apart the x-axis labels of a dated chart can be, closest
 * first. Each one divides a year, or is whole years, so that every year's
 * label is among them. */
const STEPS = [1, 2, 3, 6, 12, 24, 60, 120];

const monthFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  timeZone: "UTC",
});

export interface DateTick {
  x: number;
  label: string;
}

/** The x-axis labels of a chart from `start` to `end`, which `x` places,
 * at least `gap` pixels apart: each year's label on January 1, and the
 * months between, as there is room: "2025", "Apr", "Jul", "Oct", "2026".
 * Without labels at a month, every label would be a month, and the reader
 * would not know which year it is in. When none of the labels falls on
 * January 1, the first one says its year as well: "Apr 2026". */
export function dateTicks(
  start: Date,
  end: Date,
  x: (date: Date) => number,
  gap = 44,
): DateTick[] {
  const first = start.getUTCFullYear() * 12 + start.getUTCMonth();
  const last = end.getUTCFullYear() * 12 + end.getUTCMonth();
  let dates: Date[] = [];
  for (const step of STEPS) {
    dates = [];
    for (let month = first; month <= last; month++) {
      if (month % step !== 0) continue;
      const date = new Date(Date.UTC(Math.floor(month / 12), month % 12, 1));
      if (date >= start && date <= end) dates.push(date);
    }
    const fits = dates.every(
      (date, index) => index === 0 || x(date) - x(dates[index - 1]) >= gap,
    );
    if (fits) break;
  }
  const years = dates.some((date) => date.getUTCMonth() === 0);
  return dates.map((date, index) => ({
    x: x(date),
    label:
      date.getUTCMonth() === 0
        ? String(date.getUTCFullYear())
        : index === 0 && !years
          ? `${monthFormatter.format(date)} ${date.getUTCFullYear()}`
          : monthFormatter.format(date),
  }));
}
