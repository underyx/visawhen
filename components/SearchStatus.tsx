import { Text, VisuallyHidden } from "@mantine/core";
import React from "react";

interface Props {
  /** What the visitor typed */
  term: string;
  /** How many rows match it */
  count: number;
  /** What the rows are: ["consulate", "consulates"] */
  noun: [string, string];
  /** What to try instead, shown when nothing matches */
  hint: React.ReactNode;
}

/** Says what a list page's search box found: nothing, with a hint of what to
 * try instead, or, for screen readers only, how many rows match. It is a
 * live region that stays on the page, so that screen readers announce each
 * change as the visitor types. It is empty most of the time, so its callers
 * put it in one <div> with the search box: as a Stack child of its own it
 * would cost a gap above and below nothing. */
export default function SearchStatus({ term, count, noun, hint }: Props) {
  const searching = term.trim() !== "";
  return (
    <div role="status">
      {searching && count === 0 ? (
        <Text mt="xs">
          No {noun[1]} match &ldquo;{term.trim()}&rdquo;. {hint}
        </Text>
      ) : searching ? (
        <VisuallyHidden>
          {count} {count === 1 ? `${noun[0]} matches` : `${noun[1]} match`}
        </VisuallyHidden>
      ) : null}
    </div>
  );
}
