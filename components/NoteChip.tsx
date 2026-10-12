import { CloseButton, Group, Popover, Stack, Text } from "@mantine/core";
import { useClickOutside, useMediaQuery } from "@mantine/hooks";
import React, { useEffect, useId, useRef, useState } from "react";
import classes from "./NoteChip.module.css";

// A row of chips that each open a note (the NVC page's recent news and
// special cases). From sm up the note is between a tooltip and a dialog
// (Bence's ask): a mouse opens it by hovering, a click opens it until a
// click elsewhere or Escape, and it can hold links. On a phone it is a
// panel across the bottom of the screen with a close button, which stays
// while the page scrolls behind it, so a long note can be read.
//
// The site's conventions for chips and notes (Bence's, from the pass that
// moved the pages' asides into chips):
// - A plain chip, for a piece of news or a special case, has no icon.
// - A warning about our own reading of the numbers (a queue that has
//   stalled, USCIS deciding fewer cases, old data, an interview month not
//   moving) is a chip with tone="warning", icon={<WarningIcon />} and a
//   title, as /nvc's "stalled" chip is. It carries a TemporaryNotice's
//   meaning without its hourglass; TemporaryNotice stays for open slips
//   that qualify a figure they sit under.
// - A row's lead is "Recent news:" or "Special cases:", and nothing else.
//   The rows go in a <Stack gap="xs">, news first.
// - A note's content is <Text size="sm">, or a Stack of them with gap
//   "xs". A note never holds a MoreDetails toggle: the visitor has already
//   asked for it, so details go under a <Divider />. MoreDetails stays for
//   toggles in the page body.

/** How long a note stays open after the mouse leaves its chip, so that it
 * can be moved onto the note itself */
const LEAVE_MS = 150;

/** A click outside closes the note; a touch or mouse-down does not, so
 * that scrolling the page leaves it open */
const OUTSIDE_EVENTS = ["click"];

/** The phone layout, below Mantine's sm breakpoint (48em) */
const PHONE = "(max-width: 47.99em)";

/** Sent on the document when a note opens, with its id: every other open
 * note closes, so that a pinned note and a hovered one never overlap */
const OPEN_EVENT = "vw-note-open";

interface NoteChipProps {
  /** The chip's text */
  label: string;
  /** An icon before the text, such as a warning sign */
  icon?: React.ReactNode;
  /** The note's heading, when the label alone is not one: "Stalled" opens
   * "Document review has stalled". Without it the phone panel is headed by
   * the label, and the note from sm up has no heading. */
  title?: string;
  /** "warning": the chip is highlighted, as a yellow notice is, for bad
   * news, such as a queue that has stalled */
  tone?: "warning";
}

/** A chip that opens its note on hover (a mouse) or on a tap or click */
export function NoteChip({
  label,
  icon,
  title,
  tone,
  children,
}: React.PropsWithChildren<NoteChipProps>) {
  // pinned: opened by a tap or click, until one elsewhere; hovered: by the
  // mouse, until it leaves the chip and the note
  const [pinned, setPinned] = useState(false);
  const [hovered, setHovered] = useState(false);
  const leaving = useRef<ReturnType<typeof setTimeout>>(undefined);
  const phone = useMediaQuery(PHONE, false);
  const id = useId();
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
  useEffect(() => {
    if (opened)
      document.dispatchEvent(new CustomEvent(OPEN_EVENT, { detail: id }));
  }, [opened, id]);
  useEffect(() => {
    const onOpen = (event: Event) => {
      if ((event as CustomEvent<string>).detail === id) return;
      clearTimeout(leaving.current);
      setPinned(false);
      setHovered(false);
    };
    document.addEventListener(OPEN_EVENT, onOpen);
    return () => document.removeEventListener(OPEN_EVENT, onOpen);
  }, [id]);
  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "Escape") close();
  };
  // The chip is among the nodes a click may land on without closing the
  // panel: the tap that opens it reaches the document after the panel has
  // appeared, and would close it again.
  const [chipNode, setChipNode] = useState<HTMLButtonElement | null>(null);
  const [sheetNode, setSheetNode] = useState<HTMLDivElement | null>(null);
  useClickOutside(close, OUTSIDE_EVENTS, [sheetNode, chipNode]);

  const chip = (
    <button
      ref={setChipNode}
      type="button"
      className={classes.chip}
      data-tone={tone}
      onClick={() => (opened ? close() : setPinned(true))}
      onPointerEnter={enter}
      onPointerLeave={leave}
      onKeyDown={onKeyDown}
      {...(phone
        ? {
            "aria-haspopup": "dialog" as const,
            "aria-expanded": opened,
            "aria-controls": opened ? id : undefined,
          }
        : {})}
    >
      {icon}
      {/* The label's box is trimmed to its capitals and baseline (text-box),
          so that the text sits centred in the pill in every browser */}
      <span className={classes.label}>{label}</span>
    </button>
  );

  if (phone)
    return (
      <>
        {chip}
        {opened && (
          <div
            ref={setSheetNode}
            id={id}
            role="dialog"
            aria-labelledby={`${id}-title`}
            className={classes.sheet}
            onKeyDown={onKeyDown}
          >
            <Group
              justify="space-between"
              align="flex-start"
              wrap="nowrap"
              className={classes.sheetHead}
            >
              <Text id={`${id}-title`} fw={700}>
                {title ?? label}
              </Text>
              <CloseButton aria-label="Close" onClick={close} />
            </Group>
            {children}
          </div>
        )}
      </>
    );

  return (
    // withinPortal false: the note follows its chip in the page, so that
    // the Tab key reaches what is in it. hideDetached false: Mantine hides
    // a note whose chip has scrolled out of view, and a long news note
    // could then never be read to its end, nor its links reached with Tab.
    <Popover
      opened={opened}
      onDismiss={close}
      position="bottom-start"
      withArrow
      shadow="md"
      withinPortal={false}
      hideDetached={false}
      clickOutsideEvents={OUTSIDE_EVENTS}
      classNames={{ dropdown: classes.note }}
    >
      <Popover.Target>{chip}</Popover.Target>
      {/* A titled note is named by its title, not by its chip's label:
          "Document review has stalled", not "stalled" */}
      <Popover.Dropdown
        onPointerEnter={enter}
        onPointerLeave={leave}
        aria-labelledby={title === undefined ? undefined : `${id}-title`}
      >
        <div className={classes.noteBody}>
          {title === undefined ? (
            children
          ) : (
            <Stack gap="xs">
              <Text id={`${id}-title`} fw={700}>
                {title}
              </Text>
              {children}
            </Stack>
          )}
        </div>
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
    <Group gap={8}>
      <Text size="xs" fw={700} span>
        {lead}
      </Text>
      {children}
    </Group>
  );
}
