import {
  Accordion,
  Alert,
  Anchor,
  Badge,
  Group,
  Stack,
  Text,
  Title,
} from "@mantine/core";
import React from "react";
import { daysBetween, formatShortDate, useToday } from "./Freshness";
import { hasEnded, isAboutPost, PolicyEntry, policiesFor } from "./policy";

/** How long an entry stays up after it ends */
const SHOW_ENDED_DAYS = 60;
/** An entry last checked longer ago than this says it may be out of date. */
const MAX_UNCHECKED_DAYS = 30;

/** Whether an entry ended so long ago that it is no longer shown: by today
 * on the client, and by the day it was last checked while prerendering. */
function hasExpired(entry: PolicyEntry, today: string | null): boolean {
  return (
    entry.end !== null &&
    daysBetween(entry.end, today ?? entry.lastChecked) > SHOW_ENDED_DAYS
  );
}

function EntryDetails({
  entry,
  today,
}: {
  entry: PolicyEntry;
  today: string | null;
}) {
  const unchecked =
    today !== null &&
    daysBetween(entry.lastChecked, today) > MAX_UNCHECKED_DAYS;
  // The badges wrap instead of cutting their text short on narrow screens.
  const badgeProps = {
    tt: "none",
    maw: "100%",
    h: "auto",
    radius: "sm",
    styles: { label: { whiteSpace: "normal" } },
  } as const;
  // Everything here is in the body colour, not dimmed, and links in the dark
  // blue of Mantine's light variants: the default blue and gray are too faint
  // to read on the orange of an official notice.
  return (
    <Stack gap="xs">
      {(entry.status === "reported" || entry.end !== null) && (
        <Group gap="xs">
          {entry.status === "reported" && (
            <Badge {...badgeProps} variant="filled" color="gray.7">
              Reported; no State Department notice
            </Badge>
          )}
          {entry.end !== null && (
            <Badge {...badgeProps} variant="default">
              {hasEnded(entry, today) ? "Ended" : "Ends"}{" "}
              {formatShortDate(entry.end)}
            </Badge>
          )}
        </Group>
      )}
      <Text size="sm">{entry.body}</Text>
      <Text size="sm">
        {entry.sources.length === 1 ? "Source" : "Sources"}:{" "}
        {entry.sources.map((source, index) => (
          <React.Fragment key={source.url}>
            {index > 0 && "; "}
            <Anchor
              href={source.url}
              target="_blank"
              rel="noopener noreferrer"
              c="blue.9"
              inherit
            >
              {source.label}
            </Anchor>
          </React.Fragment>
        ))}
        .
      </Text>
      <Text size="sm">
        Last checked {formatShortDate(entry.lastChecked)}
        {unchecked ? (
          <>
            ;{" "}
            <Text span inherit fw={700}>
              this may be out of date
            </Text>
            .
          </>
        ) : (
          "."
        )}
      </Text>
    </Stack>
  );
}

type Props =
  /** A post's own page or one of its visa class pages, "kampala" */
  | { postSlug: string; page?: undefined }
  /** Any other page, by its path, "/nvc" */
  | { page: string; postSlug?: undefined };

/** The policies that affect a page's visas, from data/policy.json: those
 * about the page's post in full, and the rest, such as those about every
 * post, in one collapsed section, so that thousands of pages do not open with
 * the same banners. */
export default function PolicyBanner({ postSlug, page }: Props) {
  // The prerendered page is served for weeks, so which entries have expired
  // or gone unchecked too long is decided on the client only.
  const today = useToday();
  const shown = policiesFor({ postSlug, page }).filter(
    (entry) => !hasExpired(entry, today),
  );
  const postEntries =
    postSlug === undefined
      ? []
      : shown.filter((entry) => isAboutPost(entry, postSlug));
  const otherEntries = shown.filter((entry) => !postEntries.includes(entry));

  return (
    <>
      {postEntries.map((entry) => (
        // role="region", labelled by the title: a standing notice, which
        // screen readers should not announce on load as they do Mantine's
        // default role="alert"
        <Alert
          key={entry.id}
          role="region"
          color={entry.status === "official" ? "orange" : "gray"}
          title={entry.title}
          styles={{ title: { color: "var(--mantine-color-text)" } }}
        >
          <EntryDetails entry={entry} today={today} />
        </Alert>
      ))}
      {otherEntries.length > 0 && (
        // keepMounted={false}: the collapsed entries stay out of the HTML of
        // every page until someone opens them.
        <Accordion variant="contained" order={2} keepMounted={false}>
          <Accordion.Item value="policies">
            <Accordion.Control>
              {`Policy changes that may affect your visa (${otherEntries.length})`}
            </Accordion.Control>
            <Accordion.Panel>
              <Stack gap="lg">
                {otherEntries.map((entry) => (
                  <Stack key={entry.id} gap="xs">
                    <Title order={3} size="h5">
                      {entry.title}
                    </Title>
                    <EntryDetails entry={entry} today={today} />
                  </Stack>
                ))}
              </Stack>
            </Accordion.Panel>
          </Accordion.Item>
        </Accordion>
      )}
    </>
  );
}
