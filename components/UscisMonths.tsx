import { Anchor, Stack, Table, Text } from "@mantine/core";
import React from "react";
import type { MonthlyNumbers } from "./monthlyNumbers";
import { formatCount } from "./uscis";

/** The last few months of a form's numbers, the newest first, under the
 * quarterly chart: filings, decisions and the pile at the end of each month,
 * the same three things the chart draws. */
export default function UscisMonths({ monthly }: { monthly: MonthlyNumbers }) {
  const { points, source, notes } = monthly;
  return (
    <Stack gap="xs">
      <Text>The last {points.length} months, one by one:</Text>
      {/* narrow enough for a 360px phone without wrapping a cell */}
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
              <Table.Th ta="right">Filed</Table.Th>
              <Table.Th ta="right">Decided</Table.Th>
              <Table.Th ta="right">Pending</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {[...points].reverse().map((point) => (
              <Table.Tr key={point.quarter}>
                <Table.Td>{point.label}</Table.Td>
                <Table.Td ta="right">{formatCount(point.received)}</Table.Td>
                <Table.Td ta="right">{formatCount(point.completions)}</Table.Td>
                <Table.Td ta="right">{formatCount(point.pending)}</Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>
      {notes.map(({ label, text }) => (
        <Text size="sm" c="dimmed" key={`${label} ${text}`}>
          USCIS&rsquo;s note for {label}: &ldquo;{text}&rdquo;
        </Text>
      ))}
      <Text size="xs" c="dimmed">
        Pending is counted on the last day of each month. USCIS counts months
        and quarters separately, so these can differ a little from the chart.
        Source: USCIS&rsquo;s{" "}
        <Anchor href={source} target="_blank" rel="noopener" inherit>
          Application Processing Data
        </Anchor>{" "}
        reports.
      </Text>
    </Stack>
  );
}
