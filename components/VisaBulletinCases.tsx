import { Anchor, Text } from "@mantine/core";
import React from "react";
import { ADJUSTMENT_FILING_CHARTS_URL } from "./links";
import { ChipRow, NoteChip } from "./NoteChip";
import type { Area } from "./visaBulletin";

// The special cases of a Visa Bulletin area page, as chips that each open a
// note (NoteChip's conventions): which chart decides for people filing in
// the US, a spouse born in a country with a shorter line, and the spouse
// and children who come along on the same priority date. The notes put
// cross-chargeability and derivative status in plain words; Bence reads
// them before they change.

/** Who a person born in one of the separately listed countries can borrow a
 * line from, and who can use the line of every other country */
function spouseBornElsewhere(area: Area): string {
  if (area.key === "all")
    return "Your spouse and children can use this line too, even if they were born in China, India, Mexico or the Philippines, as long as they immigrate with you.";
  return "If your spouse was born in a country with a shorter line, you can use that country's line, as long as your spouse immigrates with you. A child can use either parent's country.";
}

export default function VisaBulletinCases({ area }: { area: Area }) {
  return (
    <ChipRow lead="Special cases:">
      <NoteChip label="Applying in the US">
        <Text size="sm">
          If you are in the US and will file Form I-485, USCIS says each month
          which of the two charts you must go by. See{" "}
          <Anchor
            href={ADJUSTMENT_FILING_CHARTS_URL}
            target="_blank"
            rel="noopener noreferrer"
          >
            USCIS&rsquo;s filing charts page
          </Anchor>
          .
        </Text>
      </NoteChip>
      <NoteChip label="Spouse born elsewhere">
        <Text size="sm">{spouseBornElsewhere(area)}</Text>
      </NoteChip>
      <NoteChip label="Spouse and children">
        <Text size="sm">
          Your spouse and your unmarried children under 21 get their visas with
          you, on your priority date. They do not need their own petition.
        </Text>
      </NoteChip>
    </ChipRow>
  );
}
