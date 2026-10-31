import { sortBy } from "./sortBy";
import {
  Alert,
  Anchor,
  Badge,
  Divider,
  Group,
  Stack,
  Text,
} from "@mantine/core";
import React from "react";
import { daysBetween, formatShortDate } from "./dates";
import { useToday } from "./Freshness";
import MoreDetails from "./MoreDetails";
import { ChipRow, NoteChip } from "./NoteChip";
import {
  type ConsulatePage,
  hasEnded,
  hasStarted,
  isUnchecked,
  namesPage,
  type PolicyEntry,
  policiesFor,
  staysOpen,
} from "./policy";

// The policy entries of data/policy.json on a page, in two parts, so that a
// consulate page can keep its own notices above the interview card and the
// news row below it: PolicyNotices, the few entries without which the card
// cannot be read, open; and PolicyNews, every other entry as a chip in a
// "Recent news:" row that opens it as a note, as /nvc has had since Bence
// chose that over a collapsed accordion (the numbers come first).

/** How long an entry stays up after it ends */
const SHOW_ENDED_DAYS = 60;

/** Whether an entry ended so long ago that it is no longer shown: by today
 * on the client, and by the day it was last checked while prerendering. */
function hasExpired(entry: PolicyEntry, today: string | null): boolean {
  return (
    entry.end !== null &&
    daysBetween(entry.end, today ?? entry.lastChecked) > SHOW_ENDED_DAYS
  );
}

/** An entry's body, its sources and the day it was last checked */
function EntryBody({ entry }: { entry: PolicyEntry }) {
  return (
    <>
      {/* A blank line in the body starts a new paragraph. */}
      {entry.body.split("\n\n").map((paragraph) => (
        <Text key={paragraph} size="sm">
          {paragraph}
        </Text>
      ))}
      <Text size="sm">
        {entry.sources.length === 1 ? "Source" : "Sources"}:{" "}
        {entry.sources.map((source, index) => (
          <React.Fragment key={source.url}>
            {index > 0 && "; "}
            <Anchor href={source.url} target="_blank" rel="noopener noreferrer">
              {source.label}
            </Anchor>
          </React.Fragment>
        ))}
        .
      </Text>
      <Text size="sm">Last checked {formatShortDate(entry.lastChecked)}.</Text>
    </>
  );
}

/** An entry's summary, with its body, sources and the day it was last
 * checked behind "Details", or, with `open`, under a rule: in a note that
 * opened from a chip, the visitor has already asked for the entry. Its
 * status and end date stay in view, as badges, since they change what the
 * summary means. */
function EntryDetails({
  entry,
  today,
  open = false,
}: {
  entry: PolicyEntry;
  today: string | null;
  open?: boolean;
}) {
  // The badges wrap instead of cutting their text short on narrow screens,
  // their lines starting on the left like the text under them.
  const badgeProps = {
    tt: "none",
    maw: "100%",
    h: "auto",
    radius: "sm",
    styles: { label: { whiteSpace: "normal", textAlign: "left" } },
  } as const;
  // Everything here is in the body colour, not dimmed. Links keep the site's
  // violet, which is 7.1:1 on the highlighter yellow of an official notice.
  return (
    <Stack gap="xs">
      {(entry.status === "reported" || entry.end !== null) && (
        <Group gap="xs">
          {entry.status === "reported" && (
            <Badge {...badgeProps} variant="filled" color="ink">
              News reports only; no State Department notice
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
      <Text size="sm">{entry.summary}</Text>
      {open ? (
        <>
          <Divider />
          <EntryBody entry={entry} />
        </>
      ) : (
        <MoreDetails name={`Details: ${entry.title}`}>
          <EntryBody entry={entry} />
        </MoreDetails>
      )}
    </Stack>
  );
}

/** A post's own page or one of its visa class pages. The page of a
 * nonimmigrant class that does not go through NVC passes `immigrant` false,
 * and leaves out the notices about immigrant visas only. */
interface ConsulatePageProps {
  consulate: ConsulatePage;
  immigrant?: boolean;
  page?: undefined;
}

/** Any other page, by its path, "/nvc" */
interface OtherPageProps {
  page: string;
  consulate?: undefined;
  immigrant?: undefined;
}

type Props = ConsulatePageProps | OtherPageProps;

/** The entries a page shows now, and today's date, which decides it. */
function useShownEntries({ consulate, immigrant, page }: Props) {
  // The prerendered page is served for weeks, so which entries have started,
  // have expired or have gone unchecked too long is decided on the client
  // only.
  const today = useToday();
  const shown = policiesFor({ consulate, page, immigrant }).filter(
    (entry) =>
      hasStarted(entry, today) &&
      !hasExpired(entry, today) &&
      !isUnchecked(entry, today),
  );
  return { today, shown };
}

/** The notices a consulate page's interview card cannot be read without
 * (staysOpen), open, above the card: a pause at the post itself, or a pause
 * at every post. The other pages have none: their news row says it all. */
export function PolicyNotices(props: ConsulatePageProps) {
  const { today, shown } = useShownEntries(props);
  const notices = shown.filter((entry) => staysOpen(entry, props.consulate));
  if (notices.length === 0) return null;
  return (
    <>
      {notices.map((entry) => (
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
    </>
  );
}

/** The page's other entries, each a chip labelled by `entry.label` in a
 * "Recent news:" row, which opens the entry as a note, or nothing when
 * there is none. On a consulate page the entries that name the page (its
 * post, the country of most of its applicants or its visa class) come
 * first, then the `expanded` ones, then the rest; on any other page the
 * row keeps the file's order. */
export function PolicyNews(props: Props) {
  const { today, shown } = useShownEntries(props);
  const { consulate } = props;
  const news =
    consulate === undefined
      ? shown
      : sortBy(
          shown.filter((entry) => !staysOpen(entry, consulate)),
          (entry) =>
            namesPage(entry, consulate) ? 0 : entry.expanded === true ? 1 : 2,
        );
  if (news.length === 0) return null;
  return (
    <ChipRow lead="Recent news:">
      {news.map((entry) => (
        <NoteChip key={entry.id} label={entry.label}>
          <EntryDetails entry={entry} today={today} open />
        </NoteChip>
      ))}
    </ChipRow>
  );
}
