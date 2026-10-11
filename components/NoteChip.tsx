import { Group, Popover, Text } from "@mantine/core";
import React, { useEffect, useRef, useState } from "react";
import classes from "./NoteChip.module.css";

// A row of chips that each open a note (the NVC page's recent news and
// special cases). The note is between a tooltip and a dialog (Bence's ask):
// a mouse opens it by hovering, a tap or a click opens it until a tap or
// click elsewhere or Escape, and it can hold links and a "Details" toggle.

/** How long a note stays open after the mouse leaves its chip, so that it
 * can be moved onto the note itself */
const LEAVE_MS = 150;

/** A chip that opens its note on hover (a mouse) or on a tap or click */
export function NoteChip({
  label,
  children,
}: React.PropsWithChildren<{ label: string }>) {
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
    // the Tab key reaches what is in it
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
        </button>
      </Popover.Target>
      <Popover.Dropdown onPointerEnter={enter} onPointerLeave={leave}>
        {children}
      </Popover.Dropdown>
    </Popover>
  );
}

/** A lead ("Recent news:") and its chips, flowing as one wrapping line.
 * The lead is the chips' size, so that it takes as little of a phone's
 * first line as it can. */
export function ChipRow({
  lead,
  children,
}: React.PropsWithChildren<{ lead: string }>) {
  return (
    <Group gap="xs">
      <Text size="xs" fw={700} span>
        {lead}
      </Text>
      {children}
    </Group>
  );
}
