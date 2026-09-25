import { Alert, Anchor, Box, Paper, Stack, Text, Title } from "@mantine/core";
import React from "react";
import {
  formatIvMonth,
  IV_CATEGORIES,
  IV_SCHEDULE_URL,
  IvCategory,
  IvSchedule,
  monthsBehind,
} from "./consulates";
import { daysBetween, formatShortDate, useToday } from "./Freshness";
import { hasEnded, overridesUpdate, PolicyEntry } from "./policy";

const VISA_BULLETIN_URL =
  "https://travel.state.gov/content/travel/en/legal/visa-law0/visa-bulletin.html";
const EMBASSIES_URL = "https://www.usembassy.gov/";
/** State updates the tool monthly, so an update older than this means we
 * have missed at least one. */
const MAX_AGE_DAYS = 45;

const CATEGORY_LABELS: Record<IvCategory, string> = {
  relative: "Spouses, children and parents of U.S. citizens",
  preference: "Family preference",
  employment: "Employment",
};

/** What State's tool says about one category at a post, split around the
 * month, which the card sets in bold. */
interface QueueSentence {
  before: string;
  month: string;
  after: string;
  /** Whether State lists the category as current: the month of its update */
  current: boolean;
}

/** "NVC is scheduling cases that became documentarily complete in February
 * 2026 (7 months before State's update)." A current month is said of the
 * whole post only for the one line that stands for all three categories,
 * since a post can be current in one category and years behind in another.
 * With `dated`, the update's date goes in too, for text that is read without
 * the card around it. */
function describeQueue(
  asOf: string,
  cutoff: string,
  wholePost: boolean,
  dated: boolean,
): QueueSentence {
  const lag = monthsBehind(asOf, cutoff);
  const month = formatIvMonth(cutoff);
  const update = dated ? ` of ${formatShortDate(asOf)}` : "";
  if (lag <= 0)
    return {
      before: `State lists ${
        wholePost ? "this post" : "these cases"
      } as current (cases that became documentarily complete in `,
      month,
      after: dated ? `) in its update${update}.` : ").",
      current: true,
    };
  return {
    before: "NVC is scheduling cases that became documentarily complete in ",
    month,
    after: ` (${lag} ${
      lag === 1 ? "month" : "months"
    } before State’s update${update}).`,
    current: false,
  };
}

/** The months State gives for a post, leaving out N/A */
function listedCutoffs(schedule: IvSchedule): string[] {
  return IV_CATEGORIES.map((category) => schedule[category]).filter(
    (cutoff): cutoff is string => cutoff !== null,
  );
}

/** Whether State lists every category it gives a month for at the post as
 * current, so that the post as a whole is listed as current */
export function listsPostAsCurrent(schedule: IvSchedule): boolean {
  const cutoffs = listedCutoffs(schedule);
  return (
    cutoffs.length > 0 &&
    cutoffs.every((cutoff) => monthsBehind(schedule.asOf, cutoff) <= 0)
  );
}

/** The post page's meta description: what the card says about immediate
 * relatives, dated, or null when State gives no month for them there. */
export function describeRelativeQueue(
  postName: string,
  schedule: IvSchedule | null,
): string | null {
  if (schedule === null || schedule.relative === null) return null;
  const { before, month, after, current } = describeQueue(
    schedule.asOf,
    schedule.relative,
    false,
    true,
  );
  return `${postName} immigrant visas for spouses, children and parents of U.S. citizens: ${before}${month}${after}${
    current
      ? " Current can also mean the post is not scheduling these cases; check the embassy’s website."
      : ""
  }`;
}

interface LineProps {
  label: string;
  asOf: string;
  cutoff: string | null;
  wholePost: boolean;
}

function QueueLine({ label, asOf, cutoff, wholePost }: LineProps) {
  let text: React.ReactNode;
  if (cutoff === null) text = "State lists no month (N/A).";
  else {
    const { before, month, after } = describeQueue(
      asOf,
      cutoff,
      wholePost,
      false,
    );
    text = (
      <>
        {before}
        <strong>{month}</strong>
        {after}
      </>
    );
  }
  return (
    <Box>
      <Text size="sm" fw={600}>
        {label}
      </Text>
      <Text>{text}</Text>
    </Box>
  );
}

interface Props {
  postName: string;
  /** The date of State's newest update that we have, "2026-09-23" */
  asOf: string;
  /** The post's line in that update, or null when it does not list the post */
  schedule: IvSchedule | null;
  /** The category to show first; the other two follow it */
  first?: IvCategory;
  /** Shown instead of the categories, for visa classes the tool does not
   * cover */
  note?: string;
  /** Which of the page's cases the queue is for, when the page also counts
   * visas the tool does not cover */
  scope?: string;
  /** The notice, shown above the card, under which the tool's months are no
   * queue at this post, such as a pause of visa services there
   * (scheduleOverrideFor() in policy.ts). Until it ends, the card says so in
   * one line instead of giving a queue. A page that passes this must also
   * keep its <title> and meta description from calling the post current or
   * naming the tool's month. */
  scheduleOverride?: PolicyEntry;
}

/** Which month of documentarily complete cases NVC is scheduling interviews
 * for at a post, from State's IV Scheduling Status Tool. */
export default function IvScheduleCard({
  postName,
  asOf,
  schedule,
  first,
  note,
  scope,
  scheduleOverride,
}: Props) {
  // The prerendered page is served for weeks, so whether the update is stale
  // is decided on the client only.
  const today = useToday();
  const stale = today !== null && daysBetween(asOf, today) > MAX_AGE_DAYS;
  const updated = formatShortDate(asOf);
  const toolLink = (children: React.ReactNode) => (
    <Anchor
      href={IV_SCHEDULE_URL}
      target="_blank"
      rel="noopener noreferrer"
      inherit
    >
      {children}
    </Anchor>
  );
  const embassiesLink = (
    <Anchor
      href={EMBASSIES_URL}
      target="_blank"
      rel="noopener noreferrer"
      inherit
    >
      usembassy.gov
    </Anchor>
  );

  if (note !== undefined)
    return (
      <Paper withBorder p="md" radius="md">
        <Stack gap="sm">
          <Title order={2} size="h3">
            Interview scheduling at {postName}
          </Title>
          <Text>{note}</Text>
        </Stack>
      </Paper>
    );

  const categories =
    first === undefined
      ? IV_CATEGORIES
      : [first, ...IV_CATEGORIES.filter((category) => category !== first)];
  // One line instead of three identical ones, as at the many posts State
  // lists as current in every category
  const wholePost =
    schedule !== null &&
    IV_CATEGORIES.every((category) => schedule[category] === schedule.relative);
  const lines: { label: string; cutoff: string | null }[] =
    schedule === null
      ? []
      : wholePost
      ? [{ label: "All three categories", cutoff: schedule.relative }]
      : categories.map((category) => ({
          label: CATEGORY_LABELS[category],
          cutoff: schedule[category],
        }));
  const cutoffs = schedule === null ? [] : listedCutoffs(schedule);
  // An override that ends later applies in the prerendered page, which
  // cannot know today's date, and on the client until it ends; after that it
  // still applies until State publishes an update dated on or after its end.
  const overridden =
    scheduleOverride !== undefined &&
    overridesUpdate(scheduleOverride, asOf, today);
  const overrideEnded =
    overridden &&
    scheduleOverride !== undefined &&
    hasEnded(scheduleOverride, today);
  const hasQueue = !overridden && cutoffs.length > 0;
  // "Current" can also mean a post is not scheduling the cases at all. Say
  // that of the whole post only when State lists it as current in every
  // category; where another category has a backlog, the post is clearly
  // scheduling immigrant visas.
  const postCurrent =
    hasQueue && schedule !== null && listsPostAsCurrent(schedule);
  const someCurrent =
    hasQueue &&
    !postCurrent &&
    cutoffs.some((cutoff) => monthsBehind(asOf, cutoff) <= 0);

  return (
    <Paper withBorder p="md" radius="md">
      <Stack gap="sm">
        <Title order={2} size="h3">
          Interview scheduling at {postName}
        </Title>
        {stale && (
          <Alert color="yellow">
            This is State&rsquo;s {updated} update, the newest we have;{" "}
            {toolLink("check the tool")} for a newer one.
          </Alert>
        )}
        {schedule === null ? (
          <Text>
            {postName} is not listed in State&rsquo;s interview-scheduling tool;
            {overridden
              ? " see the notice above."
              : " it may not process immigrant visas."}
          </Text>
        ) : overridden && cutoffs.length > 0 ? (
          <Text>
            State&rsquo;s tool still lists{" "}
            {new Set(cutoffs).size === 1
              ? `a month for ${postName}; don’t rely on it`
              : `months for ${postName}; don’t rely on them`}
            {overrideEnded && scheduleOverride.end !== null ? (
              <>
                : its {updated} update predates the end of &ldquo;
                {scheduleOverride.title}&rdquo; on{" "}
                {formatShortDate(scheduleOverride.end)}. Wait for State&rsquo;s
                next update.
              </>
            ) : (
              <>
                {" "}
                while the notice above, &ldquo;{scheduleOverride.title}&rdquo;,
                is in effect.
              </>
            )}
          </Text>
        ) : (
          <>
            {scope !== undefined && !overridden && <Text>{scope}</Text>}
            {lines.map(({ label, cutoff }) => (
              <QueueLine
                key={label}
                label={label}
                asOf={asOf}
                cutoff={cutoff}
                wholePost={wholePost}
              />
            ))}
          </>
        )}
        {postCurrent && (
          <Text size="sm">
            A post listed as current may not be scheduling immigrant visas at
            all; check the embassy&rsquo;s own website, listed at{" "}
            {embassiesLink}.
          </Text>
        )}
        {someCurrent && (
          <Text size="sm">
            Where a category is listed as current, the post may not be
            scheduling those cases at all; check the embassy&rsquo;s own
            website, listed at {embassiesLink}.
          </Text>
        )}
        {hasQueue && (
          <Text size="sm">
            Compare this with the month NVC told you your case was documentarily
            complete. Preference and employment cases also need a current
            priority date in the{" "}
            <Anchor
              href={VISA_BULLETIN_URL}
              target="_blank"
              rel="noopener noreferrer"
              inherit
            >
              Visa Bulletin
            </Anchor>
            .
          </Text>
        )}
        <Text size="sm" c="dimmed">
          {hasQueue &&
            "State says it cannot predict exactly when a case will be scheduled. "}
          Source: {toolLink("State Department IV Scheduling Status Tool")},
          updated {updated}.
        </Text>
      </Stack>
    </Paper>
  );
}
