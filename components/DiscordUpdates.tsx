import { Anchor, Text } from "@mantine/core";
import React from "react";
import { DiscordIcon } from "./icons";
import { DISCORD_URL } from "./links";

// The numbers of /nvc and of the N-400's page are posted to the site's
// Discord server when they change (data/notify.ts), pinging a role that
// members give themselves when they join (the server's onboarding question)
// or later, under Channels & Roles. These pages and the footer say so in
// one quiet line (Bence: "not in obnoxious ways"): small, dimmed, with a
// link, and no button or banner. The header's Discord button is hidden on
// phones, so the footer's line is the Discord link every screen has.

/** The forms whose new numbers data/notify.ts posts, with what the alert is
 * for: the line goes on their pages and on no other form's */
export const FORM_ALERTS: Readonly<Record<string, string>> = {
  "N-400": "when USCIS posts new monthly N-400 numbers",
};

/** The Discord logo at the text's size, sitting on its baseline */
function InlineDiscordIcon() {
  return (
    <DiscordIcon
      style={{ verticalAlign: "-0.125em", marginInlineEnd: "0.4em" }}
    />
  );
}

function DiscordLink() {
  return (
    <Anchor href={DISCORD_URL} target="_blank" rel="noopener">
      Discord
    </Anchor>
  );
}

/** The line under a page's figures. `when` says what the alert is for:
 * the N-400's page shows quarters, but the alert comes with each month. */
export default function DiscordUpdates({ when }: { when: string }) {
  return (
    <Text size="sm" c="dimmed">
      <InlineDiscordIcon />
      Get an alert on <DiscordLink /> {when}.
    </Text>
  );
}

/** The footer's line, which names the numbers. */
export function DiscordFooterLine() {
  return (
    <Text size="sm" mt="sm">
      <InlineDiscordIcon />
      Get an alert on <DiscordLink /> when NVC or N-400 numbers change.
    </Text>
  );
}
