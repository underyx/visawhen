import Link from "next/link";
import { GetStaticPaths, GetStaticProps } from "next";
import React from "react";
import { findLast, sumBy } from "lodash";
import {
  getBaseline,
  getIvSchedule,
  getIvScheduleAsOf,
  getMonthlyIssuances,
  getSlugPairs,
  getPost,
  getVisaClass,
  IssuancesRow,
} from "../../../api/consulates";
import Head from "next/head";
import ConsulateChart from "../../../components/ConsulateChart";
import {
  CLASS_NOTES,
  CLASS_QUEUE_SCOPES,
  formatCount,
  formatLongMonth,
  formatMonth,
  IV_CATEGORY_BY_CLASS,
  IvSchedule,
} from "../../../components/consulates";
import IvScheduleCard from "../../../components/IvScheduleCard";
import PolicyBanner from "../../../components/PolicyBanner";
import { scheduleOverrideFor } from "../../../components/policy";
import { useToday } from "../../../components/Freshness";
import { ChevronLeftIcon } from "../../../components/icons";
import { Button, Group, Stack, Text, Title } from "@mantine/core";

/** Visas issued in the last 12 months of the data and the 12 before those */
interface Recent {
  last12: number;
  prev12: number;
  /** The first of the last 12 months, "2024-10-01T00:00:00.000Z" */
  from: string;
  /** The newest month in the data, "2025-09-01T00:00:00.000Z" */
  to: string;
}

interface Props {
  postSlug: string;
  visaClassSlug: string;
  issuances: IssuancesRow[];
  recent: Recent;
  /** The newest month with any visas issued, or null if there never was one */
  lastIssuedMonth: string | null;
  postName: string;
  visaClassName: string;
  visaClassDescription: string | null;
  /** The date of State's newest IV Scheduling Status Tool update we have */
  ivScheduleAsOf: string;
  /** The post's line in it, or null when it does not list the post */
  ivSchedule: IvSchedule | null;
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
  // The pages no longer show the baseline, but only pairs that have one get
  // a page, as before, so no page (or URL) comes or goes.
  const baseline = await getBaseline(postSlug, visaClassSlug);

  if (
    post === undefined ||
    visaClass === undefined ||
    issuances.length === 0 ||
    baseline === undefined
  )
    return { notFound: true };

  // Every pair has a row for every month in the data (zero when none were
  // issued), so the last 12 rows are the last 12 months.
  const last12Rows = issuances.slice(-12);

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
      },
      lastIssuedMonth:
        findLast(issuances, (row) => row.issuances > 0)?.month ?? null,
      postName: post.post,
      visaClassName: visaClass.visaClass,
      visaClassDescription: visaClass.description,
      ivScheduleAsOf: await getIvScheduleAsOf(),
      ivSchedule: await getIvSchedule(postSlug),
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

/** The paragraph on the page, and the start of its meta description */
function summarize(
  { last12, prev12, from, to }: Recent,
  firstMonth: string,
  lastIssuedMonth: string | null,
  postName: string,
  visaClassName: string,
  visaClassDescription: string | null,
): { summary: string; metaSummary: string } {
  const range = `from ${formatMonth(from)} to ${formatMonth(to)}`;
  const described =
    visaClassDescription === null ? "" : ` (${visaClassDescription})`;

  if (last12 > 0) {
    const issued = `${formatCount(last12)} ${visaClassName} ${visas(last12)}`;
    const monthly =
      last12 >= 12 ? `, about ${formatCount(last12 / 12)} a month` : "";
    return {
      summary: `From ${formatMonth(from)} to ${formatMonth(
        to,
      )}, ${postName} issued ${issued}${monthly}, ${comparison(
        last12,
        prev12,
        "the 12 months before",
      )}.`,
      metaSummary: `${postName} issued ${issued}${described} ${range}, ${comparison(
        last12,
        prev12,
        "the year before",
      )}.`,
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
  visaClassDescription,
  ivScheduleAsOf,
  ivSchedule,
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
  // a note for the other immigrant classes; nonimmigrant classes get neither.
  const ivCategory = IV_CATEGORY_BY_CLASS[visaClassSlug];
  const classNote = CLASS_NOTES[visaClassSlug];
  const today = useToday();

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
      {visaClassDescription !== null && (
        <Text size="xl">{visaClassDescription}</Text>
      )}
      <PolicyBanner postSlug={postSlug} />
      {(ivCategory !== undefined || classNote !== undefined) && (
        <IvScheduleCard
          postName={postName}
          asOf={ivScheduleAsOf}
          schedule={ivSchedule}
          first={ivCategory}
          note={classNote}
          scope={CLASS_QUEUE_SCOPES[visaClassSlug]}
          scheduleOverride={
            scheduleOverrideFor(postSlug, ivScheduleAsOf, today) ?? undefined
          }
        />
      )}
      <Text>{summary}</Text>
      <Text>
        This counts visas issued, which shows how busy the post is, not how long
        you will wait. The State Department data here ends in{" "}
        {formatLongMonth(recent.to)}, so it does not show any slowdowns or
        pauses since then.
      </Text>
      <ConsulateChart issuances={issuances} />
    </Stack>
  );
}
