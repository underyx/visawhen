import { Alert, Anchor, Box, Paper, Stack, Text, Title } from "@mantine/core";
import React from "react";
import {
  FEW_IMMIGRANT_VISAS,
  formatCount,
  formatIvMonth,
  formatLongMonth,
  IV_CATEGORIES,
  IvCategory,
  IvPostElsewhere,
  IvSchedule,
  monthsBehind,
} from "./consulates";
import { daysBetween, formatShortDate, useToday } from "./Freshness";
import {
  AFRICA_HUBS_URL,
  EMBASSIES_URL,
  IV_POSTS_URL,
  VISA_BULLETIN_URL,
} from "./links";
import { hasEnded, overridesUpdate, PolicyEntry } from "./policy";
/** State updates the tool monthly, so an update older than this means we
 * have missed at least one. */
const MAX_AGE_DAYS = 45;

// The family preference and employment columns each give one month for all
// of their categories, so the labels say so: the EB-2 page's line is the
// month for every employment case, not an EB-2 queue of its own.
const CATEGORY_LABELS: Record<IvCategory, string> = {
  relative: "Spouses, children and parents of U.S. citizens",
  preference: "Family preference (one month for F1, F2A, F2B, F3 and F4)",
  employment: "Employment (one month for EB-1, EB-2, EB-3 and EB-5)",
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

/** A category's month in State's update before the newest: the update's
 * date, "2026-04-02", and the month, "2025-12" */
interface PreviousMonth {
  asOf: string;
  cutoff: string;
}

/** What the update before said, for the end of the sentence: " (December
 * 2025 in State’s previous update, of Apr 2, 2026)", with "; it has moved
 * back" where the month went backwards, or "" when there was no previous
 * month, or it and the newest one both are current. */
function describePrevious(
  cutoff: string,
  current: boolean,
  previous: PreviousMonth | null,
): string {
  if (previous === null) return "";
  const update = `State’s previous update, of ${formatShortDate(
    previous.asOf,
  )}`;
  const previousCurrent = monthsBehind(previous.asOf, previous.cutoff) <= 0;
  if (previousCurrent)
    return current ? "" : `; ${update} listed these cases as current`;
  if (previous.cutoff === cutoff) return `; the same month as in ${update}`;
  return `; ${formatIvMonth(previous.cutoff)} in ${update}${
    cutoff < previous.cutoff ? ", so it has moved back" : ""
  }`;
}

/** "NVC is scheduling most interviews for cases that became documentarily
 * complete in December 2024; April 2025 in State’s previous update, of Apr
 * 2, 2026, so it has moved back." State's own words are the month "for which
 * NVC is scheduling most interviews", and the month can move backwards, so
 * the sentence neither drops "most" nor reads it as a wait. A current month
 * is said of the whole post only for the one line that stands for all three
 * categories, since a post can be current in one category and years behind
 * in another. With `dated`, the update's date goes in too, for text that is
 * read without the card around it. */
function describeQueue(
  asOf: string,
  cutoff: string,
  previous: PreviousMonth | null,
  wholePost: boolean,
  dated: boolean,
): QueueSentence {
  const current = monthsBehind(asOf, cutoff) <= 0;
  const month = formatIvMonth(cutoff);
  const update = dated
    ? `${current ? " in its" : ", in State’s"} update of ${formatShortDate(
        asOf,
      )}`
    : "";
  const before = current
    ? `State lists ${
        wholePost ? "this post" : "these cases"
      } as current (cases that became documentarily complete in `
    : "NVC is scheduling most interviews for cases that became documentarily complete in ";
  return {
    before,
    month,
    after: `${current ? ")" : ""}${update}${describePrevious(
      cutoff,
      current,
      previous,
    )}.`,
    current,
  };
}

/** A category's month in the update before the newest, if it gave one */
function previousMonth(
  schedule: IvSchedule,
  category: IvCategory,
): PreviousMonth | null {
  const { previous } = schedule;
  if (previous === null) return null;
  const cutoff = previous[category];
  return cutoff === null ? null : { asOf: previous.asOf, cutoff };
}

/** The months State gives for a post, leaving out N/A */
function listedCutoffs(schedule: IvSchedule): string[] {
  return IV_CATEGORIES.map((category) => schedule[category]).filter(
    (cutoff): cutoff is string => cutoff !== null,
  );
}

/** Whether a page's interview-scheduling card says that most of the post's
 * immigrant visa applicants are nationals whose visas are suspended, and
 * its title may: only where the post looks like it processes immigrant
 * visas, listed in State's tool with a month, not designated away from by
 * State's list of immigrant visa posts (`elsewhere`) and not `inactive`
 * (describeInactivity). Caracas has issued nothing since 2019 and is not in
 * the tool, Kabul nothing since 2021 and is N/A in it, and State sends
 * Venezuela's and Afghanistan's applicants to Bogota and Islamabad: most
 * applicants there are no one. */
export function showsSuspension({
  schedule,
  inactive,
  elsewhere,
}: {
  schedule: IvSchedule | null;
  inactive: boolean;
  elsewhere: IvPostElsewhere | undefined;
}): boolean {
  return (
    schedule !== null &&
    listedCutoffs(schedule).length > 0 &&
    !inactive &&
    elsewhere === undefined
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
    previousMonth(schedule, "relative"),
    false,
    true,
  );
  return `${postName} immigrant visas for spouses, children and parents of U.S. citizens: ${before}${month}${after}${
    current
      ? " Current can also mean the post is not scheduling these cases; check the embassy’s website."
      : " The month is not a wait time, and it can move backwards."
  }`;
}

interface LineProps {
  label: string;
  asOf: string;
  cutoff: string | null;
  previous: PreviousMonth | null;
  wholePost: boolean;
}

function QueueLine({ label, asOf, cutoff, previous, wholePost }: LineProps) {
  let text: React.ReactNode;
  if (cutoff === null) text = "State lists no month (N/A).";
  else {
    const { before, month, after } = describeQueue(
      asOf,
      cutoff,
      previous,
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
  /** The tool's address (iv_schedule.json's "source") */
  source: string;
  /** The category to show first; the other two follow it */
  first?: IvCategory;
  /** Shown instead of the categories, for visa classes the tool does not
   * cover */
  note?: string;
  /** The notice, shown above the card, under which the tool's months are no
   * queue at this post, such as a pause of visa services there
   * (scheduleOverrideFor() in policy.ts). Until it ends, the card says so in
   * one line instead of giving a queue. A page that passes this must also
   * keep its <title> and meta description from calling the post current or
   * naming the tool's month. */
  scheduleOverride?: PolicyEntry;
  /** The notice, shown above the card, that suspends visas for the nationals
   * of the country most of the page's applicants are nationals of
   * (issuanceSuspensionFor() in policy.ts), with that country, "Cuba", and
   * who the applicants are, "immigrant visa" or a class, "SQ". The card
   * says that most applicants are affected, since NVC keeps scheduling
   * their interviews. */
  suspension?: { entry: PolicyEntry; country: string; applicants: string };
  /** How many family and employment immigrant visas, the classes the tool
   * covers, the post issued in the last 12 months of State's monthly
   * figures, from `from` to `to` ("2025-03-01T00:00:00.000Z"). Where that is
   * fewer than FEW_IMMIGRANT_VISAS, the card says so wherever the tool lists
   * a category as current. */
  recentIssued?: { count: number; from: string; to: string };
  /** Where State's list of immigrant visa posts sends the post's country
   * instead (IV_POSTS_ELSEWHERE in consulates.ts), which the card says */
  elsewhere?: IvPostElsewhere;
  /** Whether the post has issued no immigrant visas for a year or more
   * (describeInactivity), so that `suspension` is not said of it */
  inactive?: boolean;
}

/** That State's list of immigrant visa posts names another post for the
 * post's country, with links to it and to the list */
function ElsewhereNote({
  postName,
  elsewhere: { country, posts, alsoHub },
}: {
  postName: string;
  elsewhere: IvPostElsewhere;
}) {
  return (
    <Alert role="note" color="orange">
      <Text size="sm">
        State&rsquo;s{" "}
        <Anchor
          href={IV_POSTS_URL}
          target="_blank"
          rel="noopener noreferrer"
          inherit
        >
          list of the embassies and consulates that process immigrant visas
        </Anchor>{" "}
        names{" "}
        {posts.map(({ slug, name, only }, index) => (
          <React.Fragment key={slug}>
            {index > 0 && (index === posts.length - 1 ? " and " : ", ")}
            {/* Plain anchor: the consulate page's _next/data JSON is not
                deployed (see the note in components/ListRow.tsx) */}
            <Anchor href={`/consulates/${slug}`} inherit>
              {name}
            </Anchor>
            {only !== undefined && ` (${only} only)`}
          </React.Fragment>
        ))}{" "}
        for {country}, not {postName}.
        {alsoHub === true && (
          <>
            {" "}
            State&rsquo;s{" "}
            <Anchor
              href={AFRICA_HUBS_URL}
              target="_blank"
              rel="noopener noreferrer"
              inherit
            >
              July 15, 2026 notice on realigning visa services in Africa
            </Anchor>{" "}
            names {postName} as a regional visa hub, though; check the
            embassy&rsquo;s own website, listed at{" "}
            <Anchor
              href={EMBASSIES_URL}
              target="_blank"
              rel="noopener noreferrer"
              inherit
            >
              usembassy.gov
            </Anchor>
            .
          </>
        )}
      </Text>
    </Alert>
  );
}

/** That most of a page's applicants are nationals whose visas are
 * suspended, though NVC can still schedule their interviews. Not all of
 * them: there are dual nationals and applicants of other nationalities. */
function SuspensionNote({
  postName,
  suspension: { entry, country, applicants },
}: {
  postName: string;
  suspension: NonNullable<Props["suspension"]>;
}) {
  return (
    <Alert role="note" color="orange">
      <Text size="sm">
        Most {applicants} applicants at {postName} are nationals of {country},
        whose immigrant visas are suspended (&ldquo;{entry.title}&rdquo;,
        above). NVC can still schedule their interviews, but State says
        applicants subject to the suspension may be ineligible for a visa.
        Exceptions include dual nationals applying with a passport of a
        nationality not subject to a suspension.
      </Text>
    </Alert>
  );
}

/** Which month of documentarily complete cases NVC is scheduling interviews
 * for at a post, from State's IV Scheduling Status Tool. */
export default function IvScheduleCard({
  postName,
  asOf,
  schedule,
  source,
  first,
  note,
  scheduleOverride,
  suspension,
  recentIssued,
  elsewhere,
  inactive = false,
}: Props) {
  // The prerendered page is served for weeks, so whether the update is stale
  // is decided on the client only.
  const today = useToday();
  const stale = today !== null && daysBetween(asOf, today) > MAX_AGE_DAYS;
  const updated = formatShortDate(asOf);
  const toolLink = (children: React.ReactNode) => (
    <Anchor href={source} target="_blank" rel="noopener noreferrer" inherit>
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

  const suspended =
    suspension !== undefined &&
    showsSuspension({ schedule, inactive, elsewhere });

  if (note !== undefined)
    return (
      <Paper withBorder p="md" radius="md">
        <Stack gap="sm">
          <Title order={2} size="h3">
            Interview scheduling at {postName}
          </Title>
          {elsewhere !== undefined && (
            <ElsewhereNote postName={postName} elsewhere={elsewhere} />
          )}
          {suspended && suspension !== undefined && (
            <SuspensionNote postName={postName} suspension={suspension} />
          )}
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
  // The one line's previous month too is given only when the previous
  // update had one month for all three categories.
  const previousWhole =
    schedule !== null &&
    schedule.previous !== null &&
    IV_CATEGORIES.every(
      (category) =>
        schedule.previous !== null &&
        schedule.previous[category] === schedule.previous.relative,
    );
  const lines: {
    label: string;
    cutoff: string | null;
    previous: PreviousMonth | null;
  }[] =
    schedule === null
      ? []
      : wholePost
      ? [
          {
            label: "All three categories",
            cutoff: schedule.relative,
            previous: previousWhole
              ? previousMonth(schedule, "relative")
              : null,
          },
        ]
      : categories.map((category) => ({
          label: CATEGORY_LABELS[category],
          cutoff: schedule[category],
          previous: previousMonth(schedule, category),
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
  const few =
    recentIssued !== undefined && recentIssued.count < FEW_IMMIGRANT_VISAS;

  return (
    <Paper withBorder p="md" radius="md">
      <Stack gap="sm">
        <Title order={2} size="h3">
          Interview scheduling at {postName}
        </Title>
        {elsewhere !== undefined && (
          <ElsewhereNote postName={postName} elsewhere={elsewhere} />
        )}
        {suspended && suspension !== undefined && !overridden && (
          <SuspensionNote postName={postName} suspension={suspension} />
        )}
        {stale && (
          <Alert color="yellow">
            This is State&rsquo;s {updated} update, the newest we have;{" "}
            {toolLink("check the tool")} for a newer one.
          </Alert>
        )}
        {schedule === null ? (
          <Text>
            {postName} is not listed in State&rsquo;s interview-scheduling tool;
            {overridden ? (
              " see the notice above."
            ) : (
              <>
                {" "}
                it may not process immigrant visas. Check the embassy&rsquo;s
                own website, listed at {embassiesLink}.
              </>
            )}
          </Text>
        ) : cutoffs.length === 0 ? (
          // State lists the post but gives N/A in every column, as for Kabul
          <Text>
            State&rsquo;s tool lists {postName} but gives no month for any
            category (N/A);
            {overridden ? (
              " see the notice above."
            ) : (
              <>
                {" "}
                it may not be processing immigrant visas. Check the
                embassy&rsquo;s own website, listed at {embassiesLink}.
              </>
            )}
          </Text>
        ) : overridden ? (
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
            {lines.map(({ label, cutoff, previous }) => (
              <QueueLine
                key={label}
                label={label}
                asOf={asOf}
                cutoff={cutoff}
                previous={previous}
                wholePost={wholePost}
              />
            ))}
          </>
        )}
        {(postCurrent || someCurrent) && few && recentIssued !== undefined ? (
          // Where the post issues almost none of these visas, "current" most
          // likely means it schedules few such interviews or none, so it is
          // said in the body text rather than as a small caveat.
          <Text>
            But {postName} issued{" "}
            {recentIssued.count === 0
              ? "no"
              : `only ${formatCount(recentIssued.count)}`}{" "}
            family or employment immigrant{" "}
            {recentIssued.count === 1 ? "visa" : "visas"}, the kinds this tool
            covers, from {formatLongMonth(recentIssued.from)} to{" "}
            {formatLongMonth(recentIssued.to)}, in State&rsquo;s monthly
            figures. At a post that issues so few, &ldquo;current&rdquo; may
            mean it schedules few of these interviews or none; check the
            embassy&rsquo;s own website, listed at {embassiesLink}, before
            relying on it.
          </Text>
        ) : postCurrent ? (
          <Text size="sm">
            A post listed as current may not be scheduling immigrant visas at
            all; check the embassy&rsquo;s own website, listed at{" "}
            {embassiesLink}.
          </Text>
        ) : null}
        {someCurrent && !few && (
          <Text size="sm">
            Where a category is listed as current, the post may not be
            scheduling those cases at all; check the embassy&rsquo;s own
            website, listed at {embassiesLink}.
          </Text>
        )}
        {hasQueue && (
          <Text size="sm">
            Compare this with the month NVC told you your case was documentarily
            complete. It is not a wait time: it is the month most interviews are
            being scheduled for, and it can move backwards from one of
            State&rsquo;s updates to the next. Preference and employment cases
            also need a current priority date in the{" "}
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
