import Link from "next/link";
import { GetStaticPaths, GetStaticProps } from "next";
import React from "react";
import { findLast, sumBy } from "lodash";
import {
  getIvSchedule,
  getIvScheduleAsOf,
  getIvScheduleSource,
  getMonthlyIssuances,
  getPostActivity,
  getSlugPairs,
  getPost,
  getRecentIssuancesByClass,
  getVisaClass,
  getVisaClassSlugsForPost,
  IssuancesRow,
  VisaType,
} from "../../../api/consulates";
import Head from "next/head";
import ConsulateChart from "../../../components/ConsulateChart";
import {
  applicantCountry,
  CLASS_APPLICANT_COUNTRIES,
  CLASS_NOTES,
  countToolClassIssuances,
  describeInactivity,
  formatCount,
  formatLongMonth,
  formatMonth,
  IMMIGRANT_COUNTERPARTS,
  IV_CATEGORY_BY_CLASS,
  IvSchedule,
  NVC_NONIMMIGRANT_CLASSES,
} from "../../../components/consulates";
import IvScheduleCard from "../../../components/IvScheduleCard";
import PolicyBanner from "../../../components/PolicyBanner";
import {
  issuanceSuspensionFor,
  scheduleOverrideFor,
} from "../../../components/policy";
import { POST_COUNTRIES } from "../../../api/searchTerms";
import { useToday } from "../../../components/Freshness";
import { ChevronLeftIcon } from "../../../components/icons";
import {
  Alert,
  Anchor,
  Button,
  Group,
  Stack,
  Text,
  Title,
} from "@mantine/core";

/** Visas issued in the last 12 months of the data and the 12 before those */
interface Recent {
  last12: number;
  prev12: number;
  /** The first of the last 12 months, "2024-10-01T00:00:00.000Z" */
  from: string;
  /** The newest month in the data, "2025-09-01T00:00:00.000Z" */
  to: string;
  /** Visas issued in the newest RECENT_MONTHS months of the data */
  newest: number;
  /** Visas issued in the rest of the last 12 months, the months before those */
  rest: number;
}

/** How many of the newest months are checked for a sudden drop, which a
 * 12-month total hides: a suspension or pause that started in them. */
const RECENT_MONTHS = 2;

interface Props {
  postSlug: string;
  visaClassSlug: string;
  issuances: IssuancesRow[];
  recent: Recent;
  /** The newest month with any visas issued, or null if there never was one */
  lastIssuedMonth: string | null;
  postName: string;
  visaClassName: string;
  visaType: VisaType;
  visaClassDescription: string | null;
  /** That the post has issued no visas, or no immigrant visas for an
   * immigrant class, for a year, if it has not (see describeInactivity) */
  inactivity: string | null;
  /** For a nonimmigrant class whose code State also uses for an immigrant
   * class, that class's page at the post, if it has one */
  immigrantCounterpart: { slug: string; name: string } | null;
  /** The date of State's newest IV Scheduling Status Tool update we have */
  ivScheduleAsOf: string;
  /** The post's line in it, or null when it does not list the post */
  ivSchedule: IvSchedule | null;
  /** The tool's address */
  ivScheduleSource: string;
  /** How many family and employment immigrant visas, the classes State's
   * tool covers, the post issued in the last 12 months of the data */
  recentToolIssued: number;
  /** The country whose nationals make up most of the page's immigrant visa
   * applicants, "Cuba", or null (see applicantCountry) */
  country: string | null;
}

export const getStaticPaths: GetStaticPaths = async () => {
  const rows = await getSlugPairs();
  return {
    paths: rows.map(({ postSlug, visaClassSlug }) => ({
      params: { postSlug, visaClassSlug },
    })),
    fallback: false,
  };
};

export const getStaticProps: GetStaticProps<Props> = async ({ params }) => {
  if (
    params === undefined ||
    typeof params.postSlug !== "string" ||
    typeof params.visaClassSlug !== "string"
  )
    return { notFound: true };
  const { postSlug, visaClassSlug } = params;

  const post = await getPost(postSlug);
  const visaClass = await getVisaClass(visaClassSlug);
  const issuances = await getMonthlyIssuances(postSlug, visaClassSlug);

  if (post === undefined || visaClass === undefined || issuances.length === 0)
    return { notFound: true };

  // Every pair has a row for every month in the data (zero when none were
  // issued), so the last 12 rows are the last 12 months.
  const last12Rows = issuances.slice(-12);
  const ivSchedule = await getIvSchedule(postSlug);
  const counterpartSlug =
    visaClass.visaType === "NIV"
      ? IMMIGRANT_COUNTERPARTS[visaClassSlug]
      : undefined;
  const counterpart =
    counterpartSlug !== undefined &&
    (await getVisaClassSlugsForPost(postSlug)).includes(counterpartSlug)
      ? await getVisaClass(counterpartSlug)
      : undefined;

  return {
    props: {
      postSlug,
      visaClassSlug,
      issuances,
      recent: {
        last12: sumBy(last12Rows, "issuances"),
        prev12: sumBy(issuances.slice(-24, -12), "issuances"),
        from: last12Rows[0].month,
        to: last12Rows[last12Rows.length - 1].month,
        newest: sumBy(last12Rows.slice(-RECENT_MONTHS), "issuances"),
        rest: sumBy(last12Rows.slice(0, -RECENT_MONTHS), "issuances"),
      },
      lastIssuedMonth:
        findLast(issuances, (row) => row.issuances > 0)?.month ?? null,
      postName: post.post,
      visaClassName: visaClass.visaClass,
      visaType: visaClass.visaType,
      visaClassDescription: visaClass.description,
      inactivity: describeInactivity({
        postName: post.post,
        activity: await getPostActivity(postSlug),
        dataStart: issuances[0].month,
        dataEnd: last12Rows[last12Rows.length - 1].month,
        immigrant: visaClass.visaType === "IV",
        listedInTool: ivSchedule !== null,
      }),
      immigrantCounterpart:
        counterpart === undefined
          ? null
          : { slug: counterpart.visaClassSlug, name: counterpart.visaClass },
      ivScheduleAsOf: await getIvScheduleAsOf(),
      ivSchedule,
      ivScheduleSource: await getIvScheduleSource(),
      recentToolIssued: countToolClassIssuances(
        await getRecentIssuancesByClass(postSlug),
      ),
      country: applicantCountry(
        POST_COUNTRIES[postSlug] ?? null,
        postSlug,
        visaClassSlug,
      ),
    },
  };
};

/** Below this many visas in the year before, a percentage change is mostly
 * noise, so the page gives the count instead. */
const MIN_COMPARABLE = 10;
/** Changes within this many percent count as about the same. */
const SAME_PERCENT = 10;

/** How the last 12 months compare with the 12 before: "up 143% from the 12
 * months before", "about the same as the year before", "compared with 3 in
 * the 12 months before". */
function comparison(last12: number, prev12: number, period: string): string {
  if (prev12 === 0) return `compared with none in ${period}`;
  if (prev12 < MIN_COMPARABLE)
    return `compared with ${formatCount(prev12)} in ${period}`;
  const percent = Math.round((last12 / prev12 - 1) * 100);
  if (Math.abs(percent) <= SAME_PERCENT) return `about the same as ${period}`;
  if (percent > 0) return `up ${formatCount(percent)}% from ${period}`;
  // Only reached when some were issued, so it never went down all the way.
  return percent <= -100
    ? `down more than 99% from ${period}`
    : `down ${formatCount(-percent)}% from ${period}`;
}

function visas(count: number): string {
  return count === 1 ? "visa" : "visas";
}

/** Below this many visas a month, on average, in the months before the
 * newest RECENT_MONTHS, a drop in those is too small to call out. */
const MIN_DROP_RATE = 5;
/** The newest months are called out when they fall below this share of the
 * months before them. */
const DROP_SHARE = 0.25;

/** The month `months` months before a month in the data */
function monthsBefore(month: string, months: number): string {
  const date = new Date(month);
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth() - months),
  ).toISOString();
}

/** Two months of the data joined by `joiner`, with the year once when they
 * share it: "January and February 2026", "March to December 2025",
 * "December 2025 and January 2026" */
function monthPair(
  first: string,
  last: string,
  joiner: string,
  short: boolean,
): string {
  const format = short ? formatMonth : formatLongMonth;
  const [firstMonth, firstYear] = format(first).split(" ");
  const [, lastYear] = format(last).split(" ");
  return `${
    firstYear === lastYear ? firstMonth : format(first)
  } ${joiner} ${format(last)}`;
}

/** The newest RECENT_MONTHS (two) months up to `to`: "January and February
 * 2026" */
function newestMonths(to: string, short: boolean): string {
  return monthPair(monthsBefore(to, RECENT_MONTHS - 1), to, "and", short);
}

/** When the newest RECENT_MONTHS months fall far below the months before
 * them, which the 12-month figures hide, a sentence that says so for the
 * page ("But it issued only 1 in January and February 2026, against about
 * 139 a month from March to December 2025.") and one for the meta
 * description; otherwise null. */
function describeDrop({ from, to, newest, rest }: Recent): {
  sentence: string;
  meta: string;
} | null {
  const restMonths = 12 - RECENT_MONTHS;
  const restRate = rest / restMonths;
  if (
    restRate < MIN_DROP_RATE ||
    newest > DROP_SHARE * restRate * RECENT_MONTHS
  )
    return null;
  const issued = newest === 0 ? "none" : `only ${formatCount(newest)}`;
  return {
    sentence: `But it issued ${issued} in ${newestMonths(
      to,
      false,
    )}, against about ${formatCount(restRate)} a month from ${monthPair(
      from,
      monthsBefore(to, RECENT_MONTHS),
      "to",
      false,
    )}.`,
    meta: `${
      newest === 0 ? "None" : `Only ${formatCount(newest)}`
    } in ${newestMonths(to, true)}.`,
  };
}

/** The paragraph on the page, and the start of its meta description */
function summarize(
  recent: Recent,
  firstMonth: string,
  lastIssuedMonth: string | null,
  postName: string,
  visaClassName: string,
  visaClassDescription: string | null,
): { summary: string; metaSummary: string } {
  const { last12, prev12, from, to } = recent;
  const range = `from ${formatMonth(from)} to ${formatMonth(to)}`;
  const described =
    visaClassDescription === null ? "" : ` (${visaClassDescription})`;

  if (last12 > 0) {
    const issued = `${formatCount(last12)} ${visaClassName} ${visas(last12)}`;
    const monthly =
      last12 >= 12 ? `, about ${formatCount(last12 / 12)} a month` : "";
    const drop = describeDrop(recent);
    return {
      summary: `From ${formatMonth(from)} to ${formatMonth(
        to,
      )}, ${postName} issued ${issued}${monthly}, ${comparison(
        last12,
        prev12,
        "the 12 months before",
      )}.${drop === null ? "" : ` ${drop.sentence}`}`,
      metaSummary: `${postName} issued ${issued}${described} ${range}, ${comparison(
        last12,
        prev12,
        "the year before",
      )}.${drop === null ? "" : ` ${drop.meta}`}`,
    };
  }

  if (prev12 > 0)
    return {
      summary: `${postName} issued no ${visaClassName} visas ${range} (${formatCount(
        prev12,
      )} in the 12 months before).`,
      metaSummary: `${postName} issued no ${visaClassName} visas${described} ${range}, compared with ${formatCount(
        prev12,
      )} in the year before.`,
    };

  if (lastIssuedMonth === null)
    return {
      summary: `${postName} issued no ${visaClassName} visas from ${formatLongMonth(
        firstMonth,
      )}, when this data starts, to ${formatLongMonth(to)}.`,
      metaSummary: `${postName} issued no ${visaClassName} visas${described} from ${formatMonth(
        firstMonth,
      )} to ${formatMonth(to)}.`,
    };

  const twoYears = `in the two years to ${formatLongMonth(to)}`;
  return {
    summary: `${postName} issued no ${visaClassName} visas ${twoYears}. The last month it issued any was ${formatLongMonth(
      lastIssuedMonth,
    )}.`,
    metaSummary: `${postName} issued no ${visaClassName} visas${described} ${twoYears}.`,
  };
}

export default function ConsulateStats({
  postSlug,
  visaClassSlug,
  issuances,
  recent,
  lastIssuedMonth,
  postName,
  visaClassName,
  visaType,
  visaClassDescription,
  inactivity,
  immigrantCounterpart,
  ivScheduleAsOf,
  ivSchedule,
  ivScheduleSource,
  recentToolIssued,
  country,
}: Props) {
  const firstMonth = issuances[0].month;
  const { summary, metaSummary } = summarize(
    recent,
    firstMonth,
    lastIssuedMonth,
    postName,
    visaClassName,
    visaClassDescription,
  );
  const title = `${postName} ${visaClassName} visas issued, through ${formatMonth(
    recent.to,
  )}`;
  const description = `${metaSummary} Monthly counts since ${formatLongMonth(
    firstMonth,
  )} from U.S. State Department statistics.`;
  const canonicalUrl = `https://visawhen.com/consulates/${postSlug}/${visaClassSlug}`;
  // The interview queue for the classes State's scheduling tool covers, and
  // a note for the other classes that go through NVC (the other immigrant
  // classes and the K visas); other nonimmigrant classes get neither.
  const ivCategory = IV_CATEGORY_BY_CLASS[visaClassSlug];
  const classNote = CLASS_NOTES[visaClassSlug];
  const today = useToday();
  const consulate = { postSlug, visaClassSlug, country };
  // Only on immigrant classes: the K visas, which also show the card, are
  // nonimmigrant visas, which some suspensions do not cover.
  const suspension = visaType === "IV" ? issuanceSuspensionFor(country) : null;

  return (
    <Stack>
      <Head>
        <title>{title}</title>
        <meta name="description" content={description} />
        <link rel="canonical" href={canonicalUrl} />
        <meta property="og:title" content={title} />
        <meta property="og:description" content={description} />
        <meta property="og:url" content={canonicalUrl} />
      </Head>
      <Group gap="xs" style={{ alignSelf: "flex-start" }}>
        <Button
          variant="outline"
          component={Link}
          href="/consulates"
          size="xs"
          leftSection={<ChevronLeftIcon />}
        >
          Change consulate
        </Button>
        {/* Plain anchor: the consulate page's _next/data JSON is not
            deployed (see the note in components/ListRow.tsx), so a Link
            would only 404 on it before hard-navigating anyway. */}
        <Button
          variant="outline"
          component="a"
          href={`/consulates/${postSlug}`}
          size="xs"
          leftSection={<ChevronLeftIcon />}
        >
          Change visa class
        </Button>
      </Group>

      <Title order={1}>
        {postName}: {visaClassName} visas issued
      </Title>
      <Text size="xl">
        {visaType === "IV" ? "Immigrant" : "Nonimmigrant"} visa
        {visaClassDescription !== null && `: ${visaClassDescription}`}
      </Text>
      {immigrantCounterpart !== null && (
        // Plain anchor, as for "Change visa class" above
        <Text>
          Looking for {immigrantCounterpart.name} immigrant visas? See{" "}
          <Anchor href={`/consulates/${postSlug}/${immigrantCounterpart.slug}`}>
            {postName}&rsquo;s {immigrantCounterpart.name} page
          </Anchor>
          .
        </Text>
      )}
      {inactivity !== null && (
        // role="note": a standing statement, which screen readers should not
        // announce on load as they do Mantine's default role="alert"
        <Alert role="note" color="gray">
          {inactivity}
        </Alert>
      )}
      <PolicyBanner
        consulate={consulate}
        immigrant={
          visaType === "IV" || NVC_NONIMMIGRANT_CLASSES.includes(visaClassSlug)
        }
      />
      {(ivCategory !== undefined || classNote !== undefined) && (
        <IvScheduleCard
          postName={postName}
          asOf={ivScheduleAsOf}
          schedule={ivSchedule}
          source={ivScheduleSource}
          first={ivCategory}
          note={classNote}
          scheduleOverride={
            scheduleOverrideFor(postSlug, ivScheduleAsOf, today) ?? undefined
          }
          recentIssued={{
            count: recentToolIssued,
            from: recent.from,
            to: recent.to,
          }}
          suspension={
            suspension === null || country === null
              ? undefined
              : {
                  entry: suspension,
                  country,
                  applicants:
                    CLASS_APPLICANT_COUNTRIES[postSlug]?.[visaClassSlug] ===
                    undefined
                      ? "immigrant visa"
                      : visaClassName,
                }
          }
        />
      )}
      <Text>{summary}</Text>
      <Text size="sm" c="dimmed">
        This counts visas issued, which shows how busy the post is, not how long
        you will wait. The State Department data here ends in{" "}
        {formatLongMonth(recent.to)}, so it cannot show what has changed since
        then, such as pauses that started or ended later.
      </Text>
      <ConsulateChart
        issuances={issuances}
        visaType={visaType}
        subject={`${postName} ${visaClassName}`}
      />
    </Stack>
  );
}
