import { Group, Input, NativeSelect } from "@mantine/core";
import React, { useId, useState } from "react";

/** The first year the lists offer: no line in the Visa Bulletin reaches back
 * further than the early 2000s */
const FIRST_YEAR = 1990;

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

interface Picked {
  year: string;
  month: string;
}

function split(value: string): Picked {
  return { year: value.slice(0, 4), month: value.slice(5, 7) };
}

function join({ year, month }: Picked): string {
  return year !== "" && month !== "" ? `${year}-${month}` : "";
}

/** A month and its year, picked from two lists: the estimates are not
 * precise enough for a day to matter, and two lists are quicker on a phone
 * than a calendar. `value` is "2026-03", or "" until both are picked; a
 * month after today's cannot be picked. */
export default function MonthInput({
  label,
  value,
  onChange,
  today,
  year: fallbackYear,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  /** Today, "2026-10-10", or null before the page knows it */
  today: string | null;
  /** The year the list ends at until today is known */
  year: number;
}) {
  const labelId = useId();
  const [picked, setPicked] = useState<Picked>(() => split(value));
  // a value set from outside, by an address opened or a milestone changed,
  // replaces what was picked; a half-picked month stays while value is ""
  const [seen, setSeen] = useState(value);
  if (value !== seen) {
    setSeen(value);
    if (value !== join(picked)) setPicked(split(value));
  }
  const lastYear = today !== null ? Number(today.slice(0, 4)) : fallbackYear;
  const thisYear = today !== null ? today.slice(0, 4) : null;
  const thisMonth = today !== null ? today.slice(5, 7) : null;
  const pick = (next: Picked) => {
    setPicked(next);
    const joined = join(next);
    const allowed = today === null || joined <= today.slice(0, 7) ? joined : "";
    setSeen(allowed);
    if (allowed !== value) onChange(allowed);
  };
  const years: string[] = [];
  for (let year = lastYear; year >= FIRST_YEAR; year--)
    years.push(String(year));
  return (
    <div role="group" aria-labelledby={labelId}>
      <Input.Label labelElement="div" id={labelId}>
        {label}
      </Input.Label>
      <Group gap="xs" wrap="nowrap" grow>
        <NativeSelect
          aria-label={`${label}: month`}
          value={picked.month}
          onChange={(event) =>
            pick({ ...picked, month: event.currentTarget.value })
          }
          data={[
            { value: "", label: "Month" },
            ...MONTHS.map((name, index) => {
              const month = String(index + 1).padStart(2, "0");
              return {
                value: month,
                label: name,
                disabled:
                  thisMonth !== null &&
                  picked.year === thisYear &&
                  month > thisMonth,
              };
            }),
          ]}
        />
        <NativeSelect
          aria-label={`${label}: year`}
          value={picked.year}
          onChange={(event) =>
            pick({ ...picked, year: event.currentTarget.value })
          }
          data={[
            { value: "", label: "Year" },
            ...years.map((year) => ({
              value: year,
              label: year,
              disabled:
                thisMonth !== null &&
                year === thisYear &&
                picked.month > thisMonth,
            })),
          ]}
        />
      </Group>
    </div>
  );
}
