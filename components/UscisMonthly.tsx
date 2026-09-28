import { Anchor, Stack, Table, Text, Title } from "@mantine/core";
import React from "react";
import MoreDetails from "./MoreDetails";
import { formatMedian } from "./estimate";
import { formatChange, formatCount, MIN_CHANGE_BASE } from "./uscis";
import type { MonthlyNumbers } from "./monthlyNumbers";
import { ChangeStat, Stat } from "./UscisStats";
import classes from "./UscisStats.module.css";

/** The id of the monthly section, for links to it from the top of the page */
export const MONTHLY_SECTION_ID = "monthly";

function formatAverage(months: number | null): string {
  return months === null ? "n/a" : formatMedian(months);
}

/** A form number that a line does not break at its hyphen ("I-" / "130") */
function FormNumber({ children }: React.PropsWithChildren) {
  return <span style={{ whiteSpace: "nowrap" }}>{children}</span>;
}

/** USCIS's monthly numbers for a form, or a category of it: the newest
 * month's figures, with their change since the month before, and a table of
 * the last few months. `who` names what they are for: "I-485 (Family)". */
export default function UscisMonthly({
  form,
  who,
  monthly,
}: {
  form: string;
  who: string;
  monthly: MonthlyNumbers;
}) {
  const { points, wholeForm, combined, source, notes } = monthly;
  const current = points[points.length - 1];
  const previous = points[points.length - 2];
  const over6Share =
    current.pending === 0 ? null : current.pendingOver6Months / current.pending;
  return (
    <Stack gap="sm" id={MONTHLY_SECTION_ID}>
      <Title order={2}>Monthly numbers: {current.label}</Title>
      <Text>
        USCIS also publishes a few numbers for the{" "}
        <FormNumber>{wholeForm ? form : who}</FormNumber> every month. They are
        newer than the quarterly numbers on the rest of this page. USCIS counts
        them separately, so the two do not always match.
        {wholeForm && (
          <>
            {" "}
            These numbers are for all <FormNumber>{form}</FormNumber> categories
            together: this report does not split the{" "}
            <FormNumber>{form}</FormNumber> by category.
          </>
        )}
      </Text>
      <div className={classes.boxes}>
        <ChangeStat
          label={`Pending at the end of ${current.label}`}
          value={formatCount(current.pending)}
          change={formatChange(
            previous?.pending,
            current.pending,
            MIN_CHANGE_BASE,
          )}
          higherIsBetter={false}
          versus="previous month"
        />
        <ChangeStat
          label={`Decided in ${current.label}`}
          value={formatCount(current.decided)}
          change={formatChange(
            previous?.decided,
            current.decided,
            MIN_CHANGE_BASE,
          )}
          higherIsBetter={true}
          versus="previous month"
        />
        <Stat
          label="Average time to decide"
          value={formatAverage(current.averageMonths)}
          line={
            previous === undefined || previous.averageMonths === null
              ? null
              : `${previous.label}: ${formatAverage(previous.averageMonths)}`
          }
          lineColor="dimmed"
        />
        <Stat
          label="Waiting over 6 months"
          value={formatCount(current.pendingOver6Months)}
          line={
            over6Share === null
              ? null
              : `${Math.round(over6Share * 100)}% of those pending`
          }
          lineColor="dimmed"
        />
      </div>
      {/* narrow enough for a 360px phone without wrapping a cell: "mo" for
          months, as on the form list, and no column for filings */}
      <Table.ScrollContainer minWidth={280}>
        <Table
          striped
          withTableBorder
          horizontalSpacing={4}
          fz="sm"
          style={{ whiteSpace: "nowrap" }}
        >
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Month</Table.Th>
              <Table.Th ta="right">Decided</Table.Th>
              <Table.Th ta="right">Pending</Table.Th>
              <Table.Th ta="right">Average time</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {[...points].reverse().map((point) => (
              <Table.Tr key={point.month}>
                <Table.Td>{point.label}</Table.Td>
                <Table.Td ta="right">{formatCount(point.decided)}</Table.Td>
                <Table.Td ta="right">{formatCount(point.pending)}</Table.Td>
                <Table.Td ta="right">
                  {point.averageMonths === null
                    ? "n/a"
                    : `${point.averageMonths.toFixed(1)} mo`}
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>
      <MoreDetails label="About these numbers">
        <Text size="sm">
          Average time to decide is the average time from filing to decision of
          the cases USCIS decided in that month. When USCIS decides many old
          cases, it goes up. It is often longer than USCIS&rsquo;s median time,
          which the estimate at the top of this page uses, so it is not the time
          a new case will take.
        </Text>
        <Text size="sm">
          Pending and waiting over 6 months are counted on the last day of each
          month. Decided is approvals plus denials.
          {combined &&
            " For all categories together, we add up the categories, and the average time is the average over all of their decisions."}
        </Text>
        {notes.map(({ label, text }) => (
          <Text size="sm" key={`${label} ${text}`}>
            USCIS&rsquo;s note for {label}: &ldquo;{text}&rdquo;
          </Text>
        ))}
        <Text size="sm">
          Source: USCIS&rsquo;s{" "}
          <Anchor href={source} target="_blank" rel="noopener" inherit>
            Application Processing Data for {current.label}
          </Anchor>{" "}
          (CSV), a report it makes every month for Congress.
        </Text>
      </MoreDetails>
    </Stack>
  );
}
