import { Anchor, Stack, Text } from "@mantine/core";
import Link from "next/link";
import React from "react";
import { ChipRow, NoteChip } from "./NoteChip";

// Who NVC's times are for: a chip for each kind of case, which opens a note
// on what the times mean for it, or that they do not apply to it. The order
// (the family-based cases, then employment, then the rest) packs the chips
// into three lines of a 360px phone, after "Special cases:".

interface Case {
  label: string;
  note: React.ReactNode;
}

const VISA_BULLETIN = (
  <>
    Your priority date is usually your longest wait, often years. NVC asks for
    your documents once the{" "}
    <Anchor component={Link} href="/visa-bulletin">
      Visa Bulletin
    </Anchor>
    &rsquo;s Dates for Filing chart passes it, and you get an interview once the
    Final Action Dates chart does.
  </>
);

const CASES: Case[] = [
  {
    label: "Family visas",
    note: (
      <Stack gap="xs">
        <Text size="sm">
          <Text span inherit fw={700}>
            Spouses, parents and children of US citizens:
          </Text>{" "}
          NVC usually takes weeks.{" "}
          <Anchor component={Link} href="/consulates">
            The interview queue at your consulate
          </Anchor>{" "}
          is usually your longest wait.
        </Text>
        <Text size="sm">
          <Text span inherit fw={700}>
            Other relatives:
          </Text>{" "}
          {VISA_BULLETIN}
        </Text>
      </Stack>
    ),
  },
  {
    label: "K visas",
    note: (
      <Text size="sm">
        These times do not apply to K (fiancé(e)) visas. NVC only passes your
        approved petition on to the consulate.
      </Text>
    ),
  },
  { label: "Employment visas", note: <Text size="sm">{VISA_BULLETIN}</Text> },
  {
    label: "Diversity visas",
    note: (
      <Text size="sm">
        These times do not apply to diversity visas. The Kentucky Consular
        Center handles DV cases, not NVC.
      </Text>
    ),
  },
  {
    label: "Special immigrant visas",
    note: (
      <Text size="sm">
        These times do not apply to special immigrant visas.
      </Text>
    ),
  },
  {
    label: "Adoptions",
    note: <Text size="sm">These times do not apply to adoptions.</Text>,
  },
];

export default function NvcAudience() {
  return (
    <ChipRow lead="Special cases:">
      {CASES.map(({ label, note }) => (
        <NoteChip key={label} label={label}>
          {note}
        </NoteChip>
      ))}
    </ChipRow>
  );
}
