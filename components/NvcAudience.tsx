import { Anchor, Group, Popover, Stack, Text } from "@mantine/core";
import Link from "next/link";
import React, { useEffect, useRef, useState } from "react";
import { InfoIcon } from "./icons";
import classes from "./NvcAudience.module.css";

// Who NVC's times are for, as two rows of chips: the cases they are for,
// each a button that opens a note on what the times mean for that case,
// and the cases they are not for, as plain pills. The note is between a
// tooltip and a dialog (Bence's ask): a mouse opens it by hovering, a tap
// or a click opens it until a tap or click elsewhere, and it holds a link.

/** How long a note stays open after the mouse leaves its chip, so that it
 * can be moved onto the note itself */
const LEAVE_MS = 150;

interface Note {
  label: string;
  note: React.ReactNode;
}

const FOR: Note[] = [
  {
    label: "Spouse, parent or child of a US citizen",
    note: (
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
    label: "Family and employment preference",
    note: (
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

const NOT_FOR = ["K visas", "DV", "SIV", "Adoptions"];

/** A chip that opens its note on hover (a mouse) or on a tap or click */
function NoteChip({ label, note }: Note) {
  // pinned: opened by a tap or click, until one elsewhere; hovered: by the
  // mouse, until it leaves the chip and the note
  const [pinned, setPinned] = useState(false);
  const [hovered, setHovered] = useState(false);
  const leaving = useRef<ReturnType<typeof setTimeout>>(undefined);
  const opened = pinned || hovered;
  const close = () => {
    setPinned(false);
    setHovered(false);
  };
  // A finger's tap also fires pointerenter, and no pointerleave until the
  // next tap elsewhere, so only a mouse hovers.
  const enter = (event: React.PointerEvent) => {
    if (event.pointerType !== "mouse") return;
    clearTimeout(leaving.current);
    setHovered(true);
  };
  const leave = (event: React.PointerEvent) => {
    if (event.pointerType !== "mouse") return;
    leaving.current = setTimeout(() => setHovered(false), LEAVE_MS);
  };
  useEffect(() => () => clearTimeout(leaving.current), []);
  return (
    // withinPortal false: the note follows its chip in the page, so that
    // the Tab key reaches the link in it
    <Popover
      opened={opened}
      onDismiss={close}
      position="bottom-start"
      withArrow
      shadow="md"
      withinPortal={false}
      classNames={{ dropdown: classes.note }}
    >
      <Popover.Target>
        <button
          type="button"
          className={classes.chip}
          onClick={() => (opened ? close() : setPinned(true))}
          onPointerEnter={enter}
          onPointerLeave={leave}
        >
          {label}
          <InfoIcon className={classes.icon} />
        </button>
      </Popover.Target>
      <Popover.Dropdown onPointerEnter={enter} onPointerLeave={leave}>
        <Text size="sm">{note}</Text>
      </Popover.Dropdown>
    </Popover>
  );
}

export default function NvcAudience() {
  return (
    <Stack gap="xs">
      <Group gap="xs">
        <Text size="sm" fw={600} span>
          For:
        </Text>
        {FOR.map((entry) => (
          <NoteChip key={entry.label} {...entry} />
        ))}
      </Group>
      <Group gap="xs">
        <Text size="sm" fw={600} span>
          Not for:
        </Text>
        {NOT_FOR.map((label) => (
          <span key={label} className={classes.pill}>
            {label}
          </span>
        ))}
      </Group>
    </Stack>
  );
}
