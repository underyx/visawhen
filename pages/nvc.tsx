import { GetStaticProps } from "next";
import Head from "next/head";
import { getData, NvcData, NvcSeries } from "../api/nvc";
import React, { useState } from "react";
import NvcChart from "../components/NvcChart";
import last from "lodash/last";
import { jsonLdScriptProps } from "react-schemaorg";
import { Dataset } from "schema-dts";
import { Alert, Anchor, Stack, Text, TextInput, Title } from "@mantine/core";
import Link from "next/link";
import {
  addDays,
  daysBetween,
  formatDate,
  useToday,
} from "../components/Freshness";
import PolicyBanner from "../components/PolicyBanner";
import { NVC_TIMEFRAMES_URL } from "../components/links";

interface Props {
  data: NvcData;
}

export const getStaticProps: GetStaticProps<Props> = async () => ({
  props: {
    data: await getData(),
  },
});

/** NVC updates its timeframes weekly, so data older than two weeks means our
 * updates have stopped, and the numbers may be far off by now. */
const MAX_AGE_DAYS = 14;

/** The newest as-of date in the data, "2026-09-07" */
function getLatestDate(data: NvcData): string {
  return last(Object.keys(data.creation)) as string;
}

/** The newest reading of a series: its as-of date and its number of days */
function getLatestReading(series: NvcSeries): [string, number] {
  return last(Object.entries(series)) as [string, number];
}

/** How far from the estimate NVC's document reviews have landed. In a
 * backtest over NVC's own timeframes since November 2020, taking for each
 * day the review time NVC showed that day, 9 in 10 of the documents
 * submitted were reviewed within a week of it, or within 40% of it when that
 * is longer. The misses were mostly in 2021-2022, when the backlog grew and
 * shrank by weeks. */
const REVIEW_MARGIN_DAYS = 7;
const REVIEW_MARGIN_SHARE = 0.4;

/** Readings further apart than this are not consecutive weekly updates. */
const MAX_UPDATE_GAP_DAYS = 21;
/** A queue whose front, the submission date NVC has reached, moved less than
 * this over its last two updates has stalled. */
const STALL_DAYS = 3;

/** Where a queue's front stood over its last two updates, when it has barely
 * moved: its N days then only measure how old a queue that is not moving
 * is, and grow week by week (in June and July 2026, document review sat at
 * June 8-10 for five weeks while its days went from 7 to 33). Null while it
 * moves, or when the last readings are not consecutive weekly updates. */
function getStall(
  series: NvcSeries,
): { from: [string, string]; to: [string, string] } | null {
  const readings = Object.entries(series).slice(-3);
  if (readings.length < 3) return null;
  for (let index = 1; index < readings.length; index++)
    if (
      daysBetween(readings[index - 1][0], readings[index][0]) >
      MAX_UPDATE_GAP_DAYS
    )
      return null;
  const [firstDate, firstDays] = readings[0];
  const [lastDate, lastDays] = readings[readings.length - 1];
  const firstFront = addDays(firstDate, -firstDays);
  const lastFront = addDays(lastDate, -lastDays);
  return daysBetween(firstFront, lastFront) > STALL_DAYS
    ? null
    : { from: [firstDate, firstFront], to: [lastDate, lastFront] };
}

/** Says that a queue has stalled, when it has (getStall). */
function StallNotice({ series, what }: { series: NvcSeries; what: string }) {
  const stall = getStall(series);
  if (stall === null) return null;
  const [, lastDays] = getLatestReading(series);
  return (
    <Alert color="yellow" role="note">
      NVC&rsquo;s {what} has barely moved: on {formatDate(stall.from[0])} it had
      reached those submitted on {formatDate(stall.from[1])}, and on{" "}
      {formatDate(stall.to[0])} those submitted on {formatDate(stall.to[1])}.
      While it stays stuck, the {lastDays} days grow every week, and anything
      submitted now may take longer than that.
    </Alert>
  );
}

interface ReviewEstimateProps {
  today: string;
  /** NVC's document review times */
  series: NvcSeries;
}

/** When NVC will most likely review documents submitted today, or on a date
 * the visitor enters, with the range 9 in 10 past reviews landed in. The
 * estimate is the date plus NVC's newest review time: NVC reviews documents
 * in the order they came in, so documents submitted on a date are reached
 * about that many days after it, as long as the queue neither grows nor
 * shrinks. For a past date this uses what NVC has said since, rather than
 * the review time it showed that day, which after weeks without readings
 * can be far off. */
function ReviewEstimate({ today, series }: ReviewEstimateProps) {
  const [submitted, setSubmitted] = useState("");
  const [reviewDate, reviewDays] = getLatestReading(series);
  const valid = /^\d{4}-\d{2}-\d{2}$/.test(submitted) && submitted <= today;
  const from = valid ? submitted : today;
  const margin = Math.max(
    REVIEW_MARGIN_DAYS,
    Math.round(REVIEW_MARGIN_SHARE * reviewDays),
  );
  // the newest submission date NVC had reached on the newest reading
  const reached = addDays(reviewDate, -reviewDays);
  return (
    <Stack gap="xs">
      {valid && from <= reached ? (
        <Text>
          On {formatDate(reviewDate)}, NVC was already reviewing documents
          submitted on {formatDate(reached)}, so it has most likely reviewed
          documents submitted on {formatDate(from)}.
        </Text>
      ) : (
        <Text>
          {valid
            ? `Documents submitted on ${formatDate(from)}: NVC will`
            : "Submit your documents today and NVC will"}{" "}
          most likely review them around{" "}
          <strong>{formatDate(addDays(from, reviewDays))}</strong>. Checked
          against NVC&rsquo;s own timeframes since November 2020, 9 reviews in
          10 came within {margin} days of an estimate like this: here, between{" "}
          {formatDate(addDays(from, Math.max(0, reviewDays - margin)))} and{" "}
          {formatDate(addDays(from, reviewDays + margin))}.
        </Text>
      )}
      <TextInput
        type="date"
        label="Already submitted? Enter the date"
        max={today}
        value={submitted}
        onChange={(event) => setSubmitted(event.currentTarget.value)}
        maw={260}
      />
    </Stack>
  );
}

interface ChartHeadingProps {
  series: NvcSeries;
}

/** "Document review: 33-day queue on July 13, 2026" */
function ChartHeading({
  children,
  series,
}: React.PropsWithChildren<ChartHeadingProps>) {
  const [date, days] = getLatestReading(series);
  return (
    <Title order={2}>
      {children}: {days}-day queue on {formatDate(date)}
    </Title>
  );
}

export default function NvcBacklog({ data }: Props) {
  const today = useToday();
  const latestDate = getLatestDate(data);
  const ageDays = today === null ? null : daysBetween(latestDate, today);
  const stale = ageDays !== null && ageDays > MAX_AGE_DAYS;
  const [reviewDate, reviewDays] = getLatestReading(data.review);
  const [, creationDays] = getLatestReading(data.creation);
  const [, inquiryDays] = getLatestReading(data.inquiry);
  const description = `On ${formatDate(
    latestDate,
  )}, the National Visa Center was taking ${reviewDays} days to review documents, ${creationDays} days to create cases and ${inquiryDays} days to answer inquiries.`;

  return (
    <Stack gap="3rem">
      <Head>
        <title>NVC wait times</title>
        <meta name="description" content={description} />
        <link rel="canonical" href="https://visawhen.com/nvc" />
        <meta property="og:title" content="NVC wait times" />
        <meta property="og:description" content={description} />
        <meta property="og:url" content="https://visawhen.com/nvc" />
        <script
          {...jsonLdScriptProps<Dataset>({
            "@context": "https://schema.org",
            "@type": "Dataset",
            name: "NVC wait times",
            distribution: {
              "@type": "DataDownload",
              // the file itself: the github.com/.../blob/ page is HTML
              contentUrl:
                "https://raw.githubusercontent.com/underyx/visawhen/main/data/nvc/data.json",
              encodingFormat: "application/json",
              uploadDate: latestDate,
              requiresSubscription: false,
            },
            dateModified: latestDate,
            description:
              "Weekly National Visa Center timeframes for case creation, document review and inquiry responses, since November 2020.",
            accessMode: "chartOnVisual",
            creator: {
              "@type": "Person",
              familyName: "Nagy",
              givenName: "Bence",
              additionalName: "underyx",
              url: "https://underyx.me",
            },
            inLanguage: "en",
            isBasedOn: NVC_TIMEFRAMES_URL,
            license: "https://github.com/underyx/visawhen/blob/main/LICENSE",
            temporalCoverage: "2020-11/..",
          })}
        />
      </Head>
      <Stack gap="sm">
        <Title order={1}>NVC wait times</Title>
        <PolicyBanner page="/nvc" />
        {stale && (
          <Alert color="yellow">
            Our newest reading is from {formatDate(latestDate)}, {ageDays} days
            ago, although NVC usually updates its timeframes every week. NVC may
            be faster or slower today. See{" "}
            <Anchor
              href={NVC_TIMEFRAMES_URL}
              target="_blank"
              rel="noopener noreferrer"
              inherit
            >
              today&rsquo;s timeframes on NVC&rsquo;s own page
            </Anchor>
            .
          </Alert>
        )}
        {/* the alert above gives the date when the data is stale */}
        {!stale && (
          <Text size="xl">Last updated {formatDate(latestDate)}.</Text>
        )}
        <Text>
          Here&rsquo;s how long you should expect to wait until the National
          Visa Center processes your case. NVC usually updates these timeframes
          every week, and we check its page for new ones every day.
        </Text>
        <Text>
          These timeframes do not apply to K (fiancé(e)) visas, diversity visas,
          special immigrant visas or adoptions, per NVC. NVC usually takes
          weeks;{" "}
          <Anchor component={Link} href="/consulates">
            the longest wait is usually the interview queue at your consulate
          </Anchor>
          .
        </Text>
      </Stack>
      <Stack gap="sm">
        <ChartHeading series={data.review}>Document review</ChartHeading>
        <Text>
          Time until documents submitted on{" "}
          <Anchor
            href="https://ceac.state.gov/IV/Login.aspx"
            target="_blank"
            rel="noopener noreferrer"
          >
            CEAC
          </Anchor>{" "}
          are reviewed by NVC.
        </Text>
        <Text>
          On {formatDate(reviewDate)}, NVC was reviewing documents submitted on{" "}
          {formatDate(addDays(reviewDate, -reviewDays))}.
        </Text>
        <StallNotice series={data.review} what="document review" />
        {today !== null && !stale && getStall(data.review) === null && (
          <ReviewEstimate today={today} series={data.review} />
        )}
        <NvcChart id="review" series={data.review} />
      </Stack>
      <Stack gap="sm">
        <ChartHeading series={data.creation}>Case creation</ChartHeading>
        <Text>
          Time after USCIS sends a case to the NVC until the NVC creates a case
          for it in{" "}
          <Anchor
            href="https://ceac.state.gov/IV/Login.aspx"
            target="_blank"
            rel="noopener noreferrer"
          >
            CEAC
          </Anchor>
          .
        </Text>
        <Text>
          Count starting from the day the{" "}
          <Anchor
            href="https://egov.uscis.gov/casestatus/landing.do"
            target="_blank"
            rel="noopener noreferrer"
          >
            USCIS Case Status
          </Anchor>{" "}
          page updates your status to{" "}
          <Text span fs="italic">
            &lsquo;Case Was Sent To The Department of State&rsquo;
          </Text>
          . If the USCIS page only says{" "}
          <Text span fs="italic">
            &lsquo;Case Was Approved&rsquo;
          </Text>
          , you still need to wait a bit until they send the case to the NVC.
        </Text>
        <StallNotice series={data.creation} what="case creation" />
        <NvcChart id="creation" series={data.creation} />
      </Stack>
      <Stack gap="sm">
        <ChartHeading series={data.inquiry}>Inquiry response</ChartHeading>
        <Text>
          Time until questions and requests sent via{" "}
          <Anchor
            target="_blank"
            rel="noopener noreferrer"
            href="https://travel.state.gov/content/travel/en/us-visas/visa-information-resources/ask-nvc.html"
          >
            NVC&rsquo;s public inquiry form
          </Anchor>{" "}
          are answered.
        </Text>
        <StallNotice series={data.inquiry} what="inquiry response" />
        <NvcChart id="inquiry" series={data.inquiry} />
      </Stack>
    </Stack>
  );
}
