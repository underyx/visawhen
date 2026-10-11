import { Accordion, Anchor, Chip, Group, Text } from "@mantine/core";
import Link from "next/link";
import React, { useId, useState } from "react";
import classes from "./NvcAudience.module.css";

// Who NVC's times are for, by case, as one element with three parts to
// open. On a phone the parts are the rows of one slip, like the policy
// notices' row above it; from sm up they are chips in a row, and the picked
// one's line shows under them. Every part's title names a group of
// visitors, short enough for one line of a phone's row and for the three
// chips to share a row (measured in the site's font at 360px and 1280px),
// and its line says what the times mean for them.

interface Part {
  key: string;
  title: string;
  line: React.ReactNode;
}

const PARTS: Part[] = [
  {
    key: "other",
    title: "K visas, DV, SIV and adoptions",
    line: "These times do not apply to fiancé(e) visas, diversity visas, special immigrant visas or adoptions.",
  },
  {
    key: "relatives",
    title: "Spouse, parent or child of a US citizen",
    line: (
      <>
        NVC usually takes weeks.{" "}
        <Anchor component={Link} href="/consulates">
          The interview queue at your consulate
        </Anchor>{" "}
        is usually your longest wait.
      </>
    ),
  },
  {
    key: "preference",
    title: "Family and employment preference",
    line: (
      <>
        Your priority date is usually your longest wait, often years. NVC asks
        for your documents once the{" "}
        <Anchor component={Link} href="/visa-bulletin">
          Visa Bulletin
        </Anchor>
        &rsquo;s Dates for Filing chart passes it, and you get an interview once
        the Final Action Dates chart does.
      </>
    ),
  },
];

export default function NvcAudience() {
  const [picked, setPicked] = useState("");
  const chipName = useId();
  const labelId = useId();
  const part = PARTS.find(({ key }) => key === picked);
  return (
    <>
      {/* order={2}: the rows are sections of the page, beside the queues'
          headings, not parts of the policy notices' row above them */}
      <Accordion
        multiple
        variant="contained"
        order={2}
        className={classes.phone}
        classNames={{ item: classes.item, label: classes.label }}
      >
        {PARTS.map(({ key, title, line }) => (
          <Accordion.Item key={key} value={key}>
            <Accordion.Control>
              <Text span size="sm">
                {title}
              </Text>
            </Accordion.Control>
            <Accordion.Panel>
              <Text size="sm">{line}</Text>
            </Accordion.Panel>
          </Accordion.Item>
        ))}
      </Accordion>
      <div className={classes.desktop}>
        {/* The lead and the chips flow as one row, wrapping together */}
        <Chip.Group multiple={false} value={picked} onChange={setPicked}>
          <Group gap="xs" role="radiogroup" aria-labelledby={labelId}>
            <Text size="sm" fw={600} span id={labelId}>
              Your case:
            </Text>
            {PARTS.map(({ key, title }) => (
              <Chip key={key} value={key} variant="outline" name={chipName}>
                {title}
              </Chip>
            ))}
          </Group>
        </Chip.Group>
        {part !== undefined && (
          <Text size="sm" mt="xs">
            {part.line}
          </Text>
        )}
      </div>
    </>
  );
}
