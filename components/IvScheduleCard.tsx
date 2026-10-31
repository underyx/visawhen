import { Alert, Anchor, Paper, Stack, Text, Title } from "@mantine/core";
import Link from "next/link";
import React from "react";
import {
  elsewhereNames,
  FEW_IMMIGRANT_VISAS,
  formatCount,
  formatIvMonth,
  formatMonth,
  formatShortIvMonth,
  IV_CATEGORIES,
  type IvCategory,
  type IvPostElsewhere,
  type IvSchedule,
  monthsBehind,
  type PreviousMonth,
  previousLine,
} from "./consulates";
import { daysBetween, formatShortDate, useToday } from "./Freshness";
import { AFRICA_HUBS_URL, EMBASSIES_URL, IV_POSTS_URL } from "./links";
import MoreDetails from "./MoreDetails";
import { hasEnded, overridesUpdate, type PolicyEntry } from "./policy";
import { NotShown, Stat, Stats } from "./Stats";
import TemporaryNotice from "./TemporaryNotice";
/** State updates the tool monthly, so an update older than this means we
 * have missed at least one. */
const MAX_AGE_DAYS = 45;

// The family preference and employment columns each give one month for all
// of their categories, so the labels say so: the EB-2 page's line is the
// month for every employment case, not an EB-2 queue of its own.
const CATEGORY_LABELS: Record<IvCategory, string> = {
  relative: "Spouses, children and parents of US citizens",
  preference: "Family preference: F1, F2A, F2B, F3 and F4",
  employment: "Employment: EB-1, EB-2, EB-3 and EB-5",
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

/** What the update before said, as a sentence of its own: " In the previous
 * update, from Apr 2, 2026, it was December 2025.", with ", so it has moved
 * back" where the month went backwards, or "" when there was no previous
 * month, or it and the newest one both are current. */
function describePrevious(
  cutoff: string,
  current: boolean,
  previous: PreviousMonth | null,
): string {
  if (previous === null) return "";
  const update = `the previous update, from ${formatShortDate(previous.asOf)}`;
  const previousCurrent = monthsBehind(previous.asOf, previous.cutoff) <= 0;
  if (previousCurrent)
    return current ? "" : ` In ${update}, these cases were current.`;
  if (previous.cutoff === cutoff)
    return ` It is the same month as in ${update}.`;
  return ` In ${update}, it was ${formatIvMonth(previous.cutoff)}${
    cutoff < previous.cutoff ? ", so it has moved back" : ""
  }.`;
}

/** "NVC is scheduling most interviews for cases that became documentarily
 * complete in December 2024. In the previous update, from Apr 2, 2026, it
 * was April 2025, so it has moved back." State's own words are the month
 * "for which NVC is scheduling most interviews", and the month can move
 * backwards, so the sentence neither drops "most" nor reads it as a wait. A
 * current month is said of the whole post only for the one line that stands
 * for all three categories, since a post can be current in one category and
 * years behind in another. With `dated`, the update's date goes in too, for
 * text that is read without the card around it. */
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
    ? `${
        current ? " in its" : ", in the State Department’s"
      } update of ${formatShortDate(asOf)}`
    : "";
  const before = current
    ? `The State Department lists ${
        wholePost ? "this post" : "these cases"
      } as current (cases that became documentarily complete in `
    : "NVC is scheduling most interviews for cases that became documentarily complete in ";
  return {
    before,
    month,
    after: `${current ? ")" : ""}${update}.${describePrevious(
      cutoff,
      current,
      previous,
    )}`,
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
      ? " Current can also mean the post is not scheduling these cases. Check the embassy’s website."
      : " The month is not a wait time, and it can move backwards."
  }`;
}

interface BoxProps {
  label: string;
  asOf: string;
  cutoff: string | null;
  previous: PreviousMonth | null;
}

/** One category's month, set big, with how it moved since the update
 * before under it. A current category says so instead of its month, which
 * is the month of the update. */
function QueueBox({ label, asOf, cutoff, previous }: BoxProps) {
  if (cutoff === null)
    return (
      <Stat
        label={label}
        value={<NotShown>No month given</NotShown>}
        line="N/A in the State Department’s tool"
      />
    );
  const current = monthsBehind(asOf, cutoff) <= 0;
  const changed = previousLine(cutoff, current, previous);
  return (
    <Stat
      label={label}
      value={current ? "Current" : formatIvMonth(cutoff)}
      line={
        changed?.text ??
        (current ? `the update’s month, ${formatShortIvMonth(cutoff)}` : null)
      }
      lineColor={changed?.color ?? "dimmed"}
    />
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
  /** On a visa class's page, the one category to show: the other two
   * months are for other visitors. The post's own page shows all three. */
  first?: IvCategory;
  /** On a visa class's page, the class's name for the lead sentence,
   * "CR1/IR1" */
  visaClassName?: string;
  /** The notice, shown above the card, under which the tool's months are no
   * queue at this post, such as a pause of visa services there
   * (scheduleOverrideFor() in policy.ts). Until it ends, the card says so in
   * one line instead of giving a queue. A page that passes this must also
   * keep its <title> and meta description from calling the post current or
   * naming the tool's month. */
  scheduleOverride?: PolicyEntry;
  /** Where a notice suspends visas for the nationals of the country most of
   * the page's applicants are nationals of (issuanceSuspensionFor() in
   * policy.ts): that country, "Cuba", and who the applicants are,
   * "immigrant visa" or a class, "SQ". The card says under its months that
   * most applicants are affected, since NVC keeps scheduling their
   * interviews. */
  suspension?: { country: string; applicants: string };
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
 * post's country, with links to it; the list itself and State's contrary
 * notice are behind "Details". A slip under the months, which the class
 * pages without a card show under their figures. */
export function ElsewhereNote({
  postName,
  elsewhere,
}: {
  postName: string;
  elsewhere: IvPostElsewhere;
}) {
  const { country, posts, alsoHub } = elsewhere;
  return (
    <Alert role="note" color="orange">
      <Stack gap="xs">
        <Text size="sm">
          The State Department sends immigrant visa applicants from {country} to{" "}
          {posts.map(({ slug, name, only }, index) => (
            <React.Fragment key={slug}>
              {index > 0 && (index === posts.length - 1 ? " and " : ", ")}
              {/* Plain anchor: the consulate page's _next/data JSON is not
                  deployed (see the note in components/ListRow.tsx) */}
              <Anchor href={`/consulates/${slug}`}>{name}</Anchor>
              {only !== undefined && ` (${only} only)`}
            </React.Fragment>
          ))}
          , not {postName}.
        </Text>
        <MoreDetails
          name={`Details: where applicants from ${country} are sent`}
        >
          <Text size="sm">
            Its{" "}
            <Anchor
              href={IV_POSTS_URL}
              target="_blank"
              rel="noopener noreferrer"
            >
              list of embassies and consulates for immigrant visas
            </Anchor>{" "}
            names {elsewhereNames(elsewhere, true)}.
            {alsoHub === true && (
              <>
                {" "}
                But its{" "}
                <Anchor
                  href={AFRICA_HUBS_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  notice of July 15, 2026
                </Anchor>{" "}
                names {postName} as a regional visa hub, so check the
                embassy&rsquo;s own website (
                <Anchor
                  href={EMBASSIES_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  usembassy.gov
                </Anchor>
                ).
              </>
            )}
          </Text>
        </MoreDetails>
      </Stack>
    </Alert>
  );
}

/** That most of a page's applicants are nationals whose visas are
 * suspended, though NVC can still schedule their interviews. A slip under
 * the months. On a class page it names the exception, dual nationals; the
 * post's own page has that as a chip in its "Special cases:" row. */
export function SuspensionNote({
  postName,
  suspension: { country, applicants },
  classPage = false,
}: {
  postName: string;
  suspension: NonNullable<Props["suspension"]>;
  classPage?: boolean;
}) {
  return (
    <Alert role="note" color="orange">
      <Text size="sm">
        Most {applicants} applicants at {postName} are citizens of {country},
        and their immigrant visas are suspended. They can still get an
        interview, but may not get a visa.
        {classPage &&
          " Dual nationals who apply with the passport of a country not covered are an exception."}
      </Text>
    </Alert>
  );
}

/** Which month of documentarily complete cases NVC is scheduling interviews
 * for at a post, from State's IV Scheduling Status Tool: the months as
 * boxes, then the slips that qualify them, then what the month means. Only
 * for the classes the tool covers: a class page it does not cover says so
 * in a line under its own figures (CLASS_NOTES), with the slips. */
export default function IvScheduleCard({
  postName,
  asOf,
  schedule,
  source,
  first,
  visaClassName,
  scheduleOverride,
  suspension,
  recentIssued,
  elsewhere,
  inactive = false,
}: Props) {
  // The prerendered page is served for weeks, so whether the update is stale
  // is decided on the client only.
  const today = useToday();
  const ageDays = today === null ? null : daysBetween(asOf, today);
  const updated = formatShortDate(asOf);
  const toolLink = (children: React.ReactNode) => (
    <Anchor href={source} target="_blank" rel="noopener noreferrer">
      {children}
    </Anchor>
  );
  const embassiesLink = (
    <Anchor href={EMBASSIES_URL} target="_blank" rel="noopener noreferrer">
      usembassy.gov
    </Anchor>
  );

  const suspended =
    suspension !== undefined &&
    showsSuspension({ schedule, inactive, elsewhere });

  const categories = first === undefined ? IV_CATEGORIES : [first];
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
              label:
                "All three categories: immediate relatives, family preference and employment",
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
  // The Visa Bulletin matters to the family preference and employment
  // cases: not on an immediate relative class's page.
  const visaBulletin = first === undefined || first !== "relative";

  return (
    <Paper withBorder p="md">
      <Stack gap="sm">
        <Title order={2} size="h3">
          Interview scheduling at {postName}
        </Title>
        {ageDays !== null && ageDays > MAX_AGE_DAYS && (
          <TemporaryNotice>
            Our newest update is from {updated}, {ageDays} days ago.{" "}
            {toolLink("Check the tool")} for a newer one.
          </TemporaryNotice>
        )}
        {schedule === null ? (
          <Text>
            {postName} is not in the State Department&rsquo;s interview
            scheduling tool.
            {overridden ? (
              <> See &ldquo;{scheduleOverride.title}&rdquo; above.</>
            ) : (
              <>
                {" "}
                It may not handle immigrant visas. Check the embassy&rsquo;s own
                website, listed at {embassiesLink}.
              </>
            )}
          </Text>
        ) : cutoffs.length === 0 ? (
          // State lists the post but gives N/A in every column, as for Kabul
          <Text>
            The State Department&rsquo;s tool lists {postName} but gives no
            month for any category (N/A).
            {overridden ? (
              <> See &ldquo;{scheduleOverride.title}&rdquo; above.</>
            ) : (
              <>
                {" "}
                It may not be handling immigrant visas. Check the
                embassy&rsquo;s own website, listed at {embassiesLink}.
              </>
            )}
          </Text>
        ) : overridden ? (
          <Text>
            The State Department&rsquo;s tool still shows{" "}
            {new Set(cutoffs).size === 1
              ? `a month for ${postName}. Do not rely on it`
              : `months for ${postName}. Do not rely on them`}
            {overrideEnded && scheduleOverride.end !== null ? (
              <>
                {" "}
                yet: the tool&rsquo;s update of {updated} is older than the end
                of &ldquo;{scheduleOverride.title}&rdquo; on{" "}
                {formatShortDate(scheduleOverride.end)}. Wait for the next
                update.
              </>
            ) : (
              <>. See &ldquo;{scheduleOverride.title}&rdquo; above.</>
            )}
          </Text>
        ) : (
          <>
            {/* "most": State's wording, which the month can move back on */}
            <Text>
              NVC is scheduling most{" "}
              {visaClassName !== undefined && `${visaClassName} `}interviews for
              cases that became <em>documentarily complete</em> in:
            </Text>
            <Stats columns={lines.length} phoneColumns={1}>
              {lines.map(({ label, cutoff, previous }) => (
                <QueueBox
                  key={label}
                  label={label}
                  asOf={asOf}
                  cutoff={cutoff}
                  previous={previous}
                />
              ))}
            </Stats>
          </>
        )}
        {suspended && suspension !== undefined && !overridden && (
          <SuspensionNote
            postName={postName}
            suspension={suspension}
            classPage={first !== undefined}
          />
        )}
        {elsewhere !== undefined && (
          <ElsewhereNote postName={postName} elsewhere={elsewhere} />
        )}
        {(postCurrent || someCurrent) && few && recentIssued !== undefined ? (
          // Where the post issues almost none of these visas, "current" most
          // likely means it schedules few such interviews or none: our
          // reading of the numbers, so an hourglass slip.
          <TemporaryNotice>
            {postName} issued{" "}
            {recentIssued.count === 0
              ? "no"
              : `only ${formatCount(recentIssued.count)}`}{" "}
            family or employment immigrant{" "}
            {recentIssued.count === 1 ? "visa" : "visas"} from{" "}
            {formatMonth(recentIssued.from)} to {formatMonth(recentIssued.to)},
            so &ldquo;current&rdquo; may mean it schedules few of these
            interviews, or none.
          </TemporaryNotice>
        ) : postCurrent ? (
          <Text>
            Current can also mean {postName} is not scheduling immigrant visa
            interviews at all.
          </Text>
        ) : null}
        {hasQueue && (
          <Stack gap="xs">
            <Text>
              Compare with the month NVC emailed you that your case was
              documentarily complete.
            </Text>
            <MoreDetails label="What this month means">
              <Text size="sm">
                It is not a wait time: it is the month NVC is scheduling most
                interviews for now, and it can move backwards.
                &ldquo;Current&rdquo; means NVC is already scheduling cases from
                the update&rsquo;s month; it can also mean the post schedules
                none, so check the embassy&rsquo;s own website ({embassiesLink}
                ). Documentarily complete: NVC has accepted all your documents.
              </Text>
              {visaBulletin && (
                <Text size="sm">
                  Family preference and employment cases also need a current
                  priority date in the{" "}
                  <Anchor component={Link} href="/visa-bulletin">
                    Visa Bulletin
                  </Anchor>
                  .
                </Text>
              )}
            </MoreDetails>
          </Stack>
        )}
        <Text size="xs" c="dimmed">
          Source: {toolLink("State Department IV Scheduling Status Tool")},
          updated {updated}.
        </Text>
      </Stack>
    </Paper>
  );
}
