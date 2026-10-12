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
  IV_POSTS_ELSEWHERE,
  IvSchedule,
  NVC_NONIMMIGRANT_CLASSES,
} from "../../../components/consulates";
import IvScheduleCard, {
  ElsewhereNote,
  showsSuspension,
  SuspensionNote,
} from "../../../components/IvScheduleCard";
import { PolicyNews, PolicyNotices } from "../../../components/PolicyBanner";
import { Stat, Stats } from "../../../components/Stats";
import { breadcrumbList } from "../../../components/structuredData";
import TemporaryNotice from "../../../components/TemporaryNotice";
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
 * noise, so the page gives the count instead: from 10 to 38, Almaty's EB-5
 * visas were "up 280%", and 101 pages said more than 100% from a base of
 * 10 to 29. */
const MIN_COMPARABLE = 50;
/** Changes within this many percent count as about the same. */
const SAME_PERCENT = 10;

/** How the last 12 months compare with the 12 before, as the line under
 * the visas-issued box: "up 143% from the year before" in green, "down 44%
 * from the year before" in red, "about the same as the year before",
 * "compared with 3 the year before" where a percentage would be noise. */
function comparison(
  last12: number,
  prev12: number,
): { text: string; color: string } {
  if (prev12 === 0) return { text: "none the year before", color: "dimmed" };
  if (prev12 < MIN_COMPARABLE)
    return {
      text: `compared with ${formatCount(prev12)} the year before`,
      color: "dimmed",
    };
  const percent = Math.round((last12 / prev12 - 1) * 100);
  if (Math.abs(percent) <= SAME_PERCENT)
    return { text: "about the same as the year before", color: "dimmed" };
  if (percent > 0)
    return {
      text: `up ${formatCount(percent)}% from the year before`,
      color: "teal.9",
    };
  // Only reached when some were issued, so it never went down all the way.
  return {
    text:
      percent <= -100
        ? "down more than 99% from the year before"
        : `down ${formatCount(-percent)}% from the year before`,
    color: "red.9",
  };
}

/** The line under a visas-issued box that says 0: what was issued instead,
 * "2 the year before" (in red where that was a real number), "none since
 * Mar 2019", or "none in the data" */
function noneLine(
  prev12: number,
  lastIssuedMonth: string | null,
): { text: string; color: string } {
  if (prev12 > 0)
    return {
      text: `${formatCount(prev12)} the year before`,
      color: prev12 >= MIN_COMPARABLE ? "red.9" : "dimmed",
    };
  if (lastIssuedMonth === null)
    return { text: "none in the data", color: "dimmed" };
  return {
    text: `none since ${formatMonth(lastIssuedMonth)}`,
    color: "dimmed",
  };
}

/** The visas a month for the "Per month" box, to the list badges' precision:
 * "124", "0.4" */
function formatRate(rate: number): string {
  return rate < 9.95 ? rate.toFixed(1) : formatCount(rate);
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
 * page's slip under its boxes ("Havana issued only 1 in January and
 * February 2026, against about 139 a month from March to December 2025.")
 * and one for the meta description; otherwise null. */
function describeDrop(
  postName: string,
  { from, to, newest, rest }: Recent,
): {
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
    sentence: `${postName} issued ${issued} in ${newestMonths(
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

/** The start of the page's meta description: "London issued 1,484 CR1/IR1
 * visas (Spouse of U.S. citizen) from Mar 2025 to Feb 2026, about the same
 * as the year before." */
function summarize(
  recent: Recent,
  firstMonth: string,
  lastIssuedMonth: string | null,
  postName: string,
  visaClassName: string,
  visaClassDescription: string | null,
): string {
  const { last12, prev12, from, to } = recent;
  const range = `from ${formatMonth(from)} to ${formatMonth(to)}`;
  const described =
    visaClassDescription === null ? "" : ` (${visaClassDescription})`;

  if (last12 > 0) {
    const drop = describeDrop(postName, recent);
    return `${postName} issued ${formatCount(last12)} ${visaClassName} ${visas(
      last12,
    )}${described} ${range}, ${comparison(last12, prev12).text}.${
      drop === null ? "" : ` ${drop.meta}`
    }`;
  }

  if (prev12 > 0)
    return `${postName} issued no ${visaClassName} visas${described} ${range}, compared with ${formatCount(
      prev12,
    )} in the year before.`;

  if (lastIssuedMonth === null)
    return `${postName} issued no ${visaClassName} visas${described} from ${formatMonth(
      firstMonth,
    )} to ${formatMonth(to)}.`;

  return `${postName} issued no ${visaClassName} visas${described} in the two years to ${formatLongMonth(
    to,
  )}.`;
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
  const metaSummary = summarize(
    recent,
    firstMonth,
    lastIssuedMonth,
    postName,
    visaClassName,
    visaClassDescription,
  );
  // The visas-issued box's line, and the drop in the newest months that
  // the 12-month figures hide, if there is one
  const issuedLine =
    recent.last12 > 0
      ? comparison(recent.last12, recent.prev12)
      : noneLine(recent.prev12, lastIssuedMonth);
  const drop = recent.last12 > 0 ? describeDrop(postName, recent) : null;
  const title = `${postName} ${visaClassName} visas issued, through ${formatMonth(
    recent.to,
  )}`;
  const description = `${metaSummary} Monthly counts since ${formatLongMonth(
    firstMonth,
  )} from U.S. State Department statistics.`;
  const canonicalUrl = `https://visawhen.com/consulates/${postSlug}/${visaClassSlug}`;
  // A class the post has not issued in two years leaves the page little to
  // show but that, and there are thousands of such pages. They ask search
  // engines not to list them, so that the site's results are its pages with
  // numbers, and the sitemap leaves them out (next-sitemap.config.js).
  // Visitors still reach them from the post's page.
  const noindex = recent.last12 === 0 && recent.prev12 === 0;
  // The interview card for the classes State's scheduling tool covers, and
  // a line under the figures for the other classes that go through NVC (the
  // other immigrant classes and the K visas); other nonimmigrant classes get
  // neither.
  const ivCategory = IV_CATEGORY_BY_CLASS[visaClassSlug];
  const classNote = CLASS_NOTES[visaClassSlug];
  const today = useToday();
  const consulate = {
    postSlug,
    visaClassSlug,
    country,
    nonimmigrant: visaType === "NIV",
  };
  const elsewhere = IV_POSTS_ELSEWHERE[postSlug];
  // Only on immigrant classes: the K visas, which also go through NVC, are
  // nonimmigrant visas, which some suspensions do not cover.
  const suspension =
    visaType === "IV" && country !== null
      ? issuanceSuspensionFor(country, today)
      : null;
  const suspensionProps =
    suspension === null || country === null
      ? undefined
      : {
          country,
          applicants:
            CLASS_APPLICANT_COUNTRIES[postSlug]?.[visaClassSlug] === undefined
              ? "immigrant visa"
              : visaClassName,
        };

  return (
    <Stack>
      <Head>
        <title>{title}</title>
        <meta name="description" content={description} />
        <link rel="canonical" href={canonicalUrl} />
        <meta property="og:title" content={title} />
        <meta property="og:description" content={description} />
        <meta property="og:url" content={canonicalUrl} />
        {noindex && <meta name="robots" content="noindex" />}
        <script
          {...breadcrumbList([
            { name: "Consulates", path: "/consulates" },
            { name: postName, path: `/consulates/${postSlug}` },
            {
              name: visaClassName,
              path: `/consulates/${postSlug}/${visaClassSlug}`,
            },
          ])}
        />
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
      <Text size="lg">
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
      <PolicyNotices
        consulate={consulate}
        immigrant={
          visaType === "IV" || NVC_NONIMMIGRANT_CLASSES.includes(visaClassSlug)
        }
      />
      {ivCategory !== undefined && (
        <IvScheduleCard
          postName={postName}
          asOf={ivScheduleAsOf}
          schedule={ivSchedule}
          source={ivScheduleSource}
          first={ivCategory}
          visaClassName={visaClassName}
          scheduleOverride={
            scheduleOverrideFor(postSlug, ivScheduleAsOf, today) ?? undefined
          }
          recentIssued={{
            count: recentToolIssued,
            from: recent.from,
            to: recent.to,
          }}
          elsewhere={elsewhere}
          inactive={inactivity !== null}
          suspension={suspensionProps}
        />
      )}
      {/* The class's own figures as boxes (Bence: numbers first; on a K
          page this is the first number), with a month's rate beside the
          year's count while there is one */}
      <Stats
        columns={recent.last12 > 0 ? 2 : 1}
        phoneColumns={recent.last12 > 0 ? 2 : 1}
      >
        <Stat
          label={`Visas issued, ${formatMonth(recent.from)} – ${formatMonth(
            recent.to,
          )}`}
          value={formatCount(recent.last12)}
          line={issuedLine.text}
          lineColor={issuedLine.color}
        />
        {recent.last12 > 0 && (
          <Stat
            label="Per month"
            value={formatRate(recent.last12 / 12)}
            line={null}
          />
        )}
      </Stats>
      {drop !== null && <TemporaryNotice>{drop.sentence}</TemporaryNotice>}
      {/* A class the tool does not cover says so in one line, with the
          slips the card would have shown (Bence: the figures first, no card
          for a note that the months do not apply) */}
      {classNote !== undefined && <Text size="sm">{classNote}</Text>}
      <Text size="xs" c="dimmed">
        Visas issued show how busy the post is, not how long you will wait.
      </Text>
      {classNote !== undefined && elsewhere !== undefined && (
        <ElsewhereNote postName={postName} elsewhere={elsewhere} />
      )}
      {classNote !== undefined &&
        suspensionProps !== undefined &&
        showsSuspension({
          schedule: ivSchedule,
          inactive: inactivity !== null,
          elsewhere,
        }) && (
          <SuspensionNote
            postName={postName}
            suspension={suspensionProps}
            classPage
          />
        )}
      {/* The news comes after the figures, as on /nvc (Bence) */}
      <PolicyNews
        consulate={consulate}
        immigrant={
          visaType === "IV" || NVC_NONIMMIGRANT_CLASSES.includes(visaClassSlug)
        }
      />
      <ConsulateChart
        issuances={issuances}
        visaType={visaType}
        subject={`${postName} ${visaClassName}`}
      />
    </Stack>
  );
}
