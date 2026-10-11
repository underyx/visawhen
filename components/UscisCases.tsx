import { Anchor, Stack, Text } from "@mantine/core";
import Link from "next/link";
import React from "react";
import { type CategoryRange, PRIORITY_DATE_CUTOFFS } from "./estimate";
import { ChipRow, NoteChip } from "./NoteChip";

// The special cases of a USCIS form's page and of its office pages, as a
// "Special cases:" row of chips under the figures (modelled on
// NvcAudience): who is in each category, the categories whose wait is the
// priority date, premium processing, an approval rate that is not what the
// word suggests, and an office that almost never approves these cases. A
// note says only what the page does not show already (Bence). Nothing when
// no chip applies.

export interface Case {
  label: string;
  note: React.ReactNode;
}

/** A category of the page, for the chip on who is in each */
export interface CaseView {
  /** "Immediate Relative", or "All categories" */
  name: string;
  /** Who is in the category, from the reports' footnotes
   * (officeCategoryWho); null for all categories together, and for a
   * category the reports say nothing about */
  who: string | null;
}

/** The "Priority date" note, per form and category of
 * PRIORITY_DATE_CATEGORIES: what USCIS's decision is, and is not, of the
 * wait. `before` ends where the cutoff dates link follows; `after` comes
 * after it. (The timeline's step reads PRIORITY_DATE_TEXT instead.) */
const PRIORITY_DATE_NOTES: Record<
  string,
  Record<string, { before: string; after?: string }>
> = {
  "I-130": {
    "all-other-relative": {
      before:
        "All Other Relative (F1–F4): USCIS's approval is only the first step. When your relative can immigrate depends on the priority date:",
    },
  },
  "I-485": {
    employment: {
      before:
        "Employment: USCIS can approve the I-485 only once your priority date is current, so your wait depends on it:",
      after:
        "The median is of cases USCIS decided, whose dates were already current.",
    },
  },
};

interface Options {
  /** The page's categories, all categories together last; the chip on who
   * is in each is shown when there is more than one */
  views: CaseView[];
  form: string;
  /** The national ranges, for the categories whose wait is the priority
   * date */
  ranges?: CategoryRange[];
  /** What to know about premium processing of the form
   * (PREMIUM_PROCESSING), where USCIS offers it */
  premium?: { note: string };
  /** What the form's approval rate is a rate of, where USCIS's counts are
   * not what the words suggest */
  approvalNote?: string;
  /** Whether the office almost never approves the cases shown
   * (rarelyApproves) */
  rarelyApproved?: boolean;
}

/** The chips that apply, in the row's order. */
export function uscisCases({
  views,
  form,
  ranges = [],
  premium,
  approvalNote,
  rarelyApproved = false,
}: Options): Case[] {
  const cases: Case[] = [];
  if (views.length > 1)
    cases.push({
      label: "Which category?",
      note: (
        <Stack gap="xs">
          {views
            .filter(({ who }) => who !== null)
            .map(({ name, who }) => (
              <Text size="sm" key={name}>
                <Text span inherit fw={700}>
                  {name}:
                </Text>{" "}
                {who}
              </Text>
            ))}
          <Text size="sm">
            All categories together is nobody&rsquo;s own queue: pick yours.
          </Text>
        </Stack>
      ),
    });
  const priorityDate = ranges.filter((range) => range.priorityDate);
  if (priorityDate.length > 0)
    cases.push({
      label: "Priority date",
      note: (
        <Stack gap="xs">
          {priorityDate.map((range) => {
            const note = PRIORITY_DATE_NOTES[form]?.[range.key] ?? {
              before: `${range.name}: the wait depends on your priority date:`,
            };
            return (
              <Text size="sm" key={range.key}>
                {note.before} see{" "}
                <Anchor
                  component={Link}
                  href={PRIORITY_DATE_CUTOFFS[range.key] ?? "/visa-bulletin"}
                >
                  today&rsquo;s cutoff dates
                </Anchor>
                .{note.after !== undefined && ` ${note.after}`}
              </Text>
            );
          })}
        </Stack>
      ),
    });
  if (premium !== undefined)
    cases.push({
      label: "Premium processing",
      note: <Text size="sm">{premium.note}</Text>,
    });
  if (approvalNote !== undefined)
    cases.push({
      label: "Approval rate",
      note: <Text size="sm">{approvalNote}</Text>,
    });
  if (rarelyApproved)
    cases.push({
      label: "Almost none approved",
      note: (
        <Text size="sm">
          An office that almost never approves a kind of case is usually
          screening or holding it; the cases are then sent to another office to
          be decided. So its pace says little about your wait.
        </Text>
      ),
    });
  return cases;
}

/** The row of the chips (uscisCases), or nothing when none applies. */
export default function UscisCases({ cases }: { cases: Case[] }) {
  if (cases.length === 0) return null;
  return (
    <ChipRow lead="Special cases:">
      {cases.map(({ label, note }) => (
        <NoteChip key={label} label={label}>
          {note}
        </NoteChip>
      ))}
    </ChipRow>
  );
}
