import { Anchor, Text } from "@mantine/core";
import Link from "next/link";
import React from "react";
import { ChipRow, NoteChip } from "./NoteChip";

// Who a post's interview months are for: a chip for each kind of case the
// months do not cover, or that needs more, which opens a note saying so.
// Only on a post's own page: each class page is one case. Four chips pack
// into three lines of a 360px phone after "Special cases:", and the "Dual
// nationals" exception comes first, only while the page says that most of
// the post's applicants' visas are suspended. Family preference and
// employment share a chip: as two, the row took a fourth line.

interface Props {
  /** "london" */
  postSlug: string;
  /** "London" */
  postName: string;
  /** Whether the post has a K1 page, for the K visas' note to point to */
  hasK1Page: boolean;
  /** Whether the page says that most applicants' visas are suspended (the
   * interview card's suspension slip) */
  suspended: boolean;
}

export default function ConsulateAudience({
  postSlug,
  postName,
  hasK1Page,
  suspended,
}: Props) {
  return (
    <ChipRow lead="Special cases:">
      {suspended && (
        <NoteChip label="Dual nationals">
          <Text size="sm">
            Dual nationals who apply with the passport of a country the
            suspension does not cover are an exception: they can get a visa.
          </Text>
        </NoteChip>
      )}
      <NoteChip label="Family preference and employment">
        <Text size="sm">
          You also need a current priority date in the{" "}
          <Anchor component={Link} href="/visa-bulletin">
            Visa Bulletin
          </Anchor>{" "}
          before NVC schedules your interview.
        </Text>
      </NoteChip>
      <NoteChip label="K visas">
        <Text size="sm">
          State publishes no interview-scheduling data for K visas.
          {hasK1Page && (
            <>
              {" "}
              See{" "}
              {/* Plain anchor: the class page's _next/data JSON is not
                  deployed (see the note in components/ListRow.tsx) */}
              <Anchor href={`/consulates/${postSlug}/k1`}>
                {postName}&rsquo;s K1 page
              </Anchor>{" "}
              for visas issued.
            </>
          )}
        </Text>
      </NoteChip>
      <NoteChip label="Diversity visas">
        <Text size="sm">
          State&rsquo;s scheduling tool does not cover diversity visas.
        </Text>
      </NoteChip>
      <NoteChip label="Other classes">
        <Text size="sm">
          Adoptions, widows and widowers, VAWA self-petitioners, returning
          residents, special immigrants and Amerasians are not in State&rsquo;s
          tool.
        </Text>
      </NoteChip>
    </ChipRow>
  );
}
