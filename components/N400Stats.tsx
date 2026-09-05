import { Paper, SimpleGrid, Text, Title } from "@mantine/core";
import {
  formatChange,
  formatCount,
  formatMonths,
  formatPercent,
  QuarterPoint,
} from "./n400";

interface StatProps {
  label: string;
  value: string;
  /** Change vs. the previous quarter, already formatted */
  change: string | null;
  /** Whether an increase is good news (approvals) or bad (waits, backlog) */
  higherIsBetter: boolean;
}

function Stat({ label, value, change, higherIsBetter }: StatProps) {
  const isIncrease = change?.startsWith("+");
  const isDecrease = change?.startsWith("−");
  const color =
    change === null || change === "unchanged"
      ? "dimmed"
      : isIncrease === higherIsBetter || isDecrease === !higherIsBetter
      ? "teal.8"
      : "red.8";
  return (
    <Paper withBorder p="md" radius="md">
      <Text size="sm" c="dimmed" fw={500}>
        {label}
      </Text>
      <Title order={3}>{value}</Title>
      <Text size="sm" c={color}>
        {change === null ? " " : `${change} vs. previous quarter`}
      </Text>
    </Paper>
  );
}

interface Props {
  points: QuarterPoint[];
}

/** The four headline figures of the newest quarter, with their change since
 * the quarter before. */
export default function N400Stats({ points }: Props) {
  const current = points[points.length - 1];
  const previous = points[points.length - 2];
  return (
    <SimpleGrid cols={{ base: 2, sm: 4 }} spacing="sm">
      <Stat
        label="Estimated wait"
        value={formatMonths(current.waitMonths)}
        change={formatChange(previous?.waitMonths, current.waitMonths)}
        higherIsBetter={false}
      />
      <Stat
        label="Pending applications"
        value={formatCount(current.pending)}
        change={formatChange(previous?.pending, current.pending)}
        higherIsBetter={false}
      />
      <Stat
        label={`Decided in ${current.label}`}
        value={formatCount(current.completions)}
        change={formatChange(previous?.completions, current.completions)}
        higherIsBetter={true}
      />
      <Stat
        label="Approval rate"
        value={formatPercent(current.approvalRate)}
        change={
          current.approvalRate === null ||
          previous?.approvalRate === null ||
          previous?.approvalRate === undefined
            ? null
            : formatChange(
                Math.round(previous.approvalRate * 100),
                Math.round(current.approvalRate * 100),
              )
        }
        higherIsBetter={true}
      />
    </SimpleGrid>
  );
}
