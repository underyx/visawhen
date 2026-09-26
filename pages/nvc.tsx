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
import MoreDetails from "../components/MoreDetails";
import PolicyBanner from "../components/PolicyBanner";
import {
  front,
  getStall,
  reviewRange,
  ReviewRange,
} from "../components/nvcReview";
import { NVC_TIMEFRAMES_URL, VISA_BULLETIN_URL } from "../components/links";

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

/** The newest reading of a series: its as-of date and its number of days */
function getLatestReading(series: NvcSeries): [string, number] {
  return last(Object.entries(series)) as [string, number];
}

/** The newest as-of date of any series, "2026-09-07". Each series has its
 * own: the scraper matches each of NVC's sentences separately, so one that
 * NVC rewords stops updating while the others go on. */
function getLatestDate(data: NvcData): string {
  return [data.creation, data.review, data.inquiry]
    .map((series) => getLatestReading(series)[0])
    .sort()
    .reverse()[0];
}

/** Whether a series' own newest reading is too old to go by */
function isStale(series: NvcSeries, today: string): boolean {
  return daysBetween(getLatestReading(series)[0], today) > MAX_AGE_DAYS;
}

interface SeriesAgeNoticeProps {
  series: NvcSeries;
  /** "document review" */
  what: string;
  today: string | null;
  /** Whether the whole page's data is stale, which its own notice says */
  pageStale: boolean;
}

/** Says that a series has not updated while the others have. */
function SeriesAgeNotice({
  series,
  what,
  today,
  pageStale,
}: SeriesAgeNoticeProps) {
  if (today === null || pageStale || !isStale(series, today)) return null;
  const [date] = getLatestReading(series);
  return (
    <Alert color="yellow" role="note">
      Our newest {what} time is from {formatDate(date)},{" "}
      {daysBetween(date, today)} days ago, so it may be out of date. See{" "}
      <Anchor
        href={NVC_TIMEFRAMES_URL}
        target="_blank"
        rel="noopener noreferrer"
        inherit
      >
        today&rsquo;s time on NVC&rsquo;s website
      </Anchor>
      .
    </Alert>
  );
}

/** Says that a queue has stalled, when it has (getStall). */
function StallNotice({ series, what }: { series: NvcSeries; what: string }) {
  const stall = getStall(series);
  if (stall === null) return null;
  const [, lastDays] = getLatestReading(series);
  return (
    <Alert color="yellow" role="note">
      <Stack gap="xs">
        <Text inherit>
          NVC&rsquo;s {what} has almost stopped moving. Anything you submit now
          may take longer than {lastDays} days.
        </Text>
        <MoreDetails>
          <Text size="sm">
            On {formatDate(stall.from[0])}, NVC had reached those submitted on{" "}
            {formatDate(front(stall.from))}. On {formatDate(stall.to[0])}, it
            had reached those submitted on {formatDate(front(stall.to))}. While
            it stays stuck, the wait grows every week.
          </Text>
        </MoreDetails>
      </Stack>
    </Alert>
  );
}

interface ReviewEstimateProps {
  today: string;
  /** NVC's document review times */
  series: NvcSeries;
}

/** What a range rests on, and how far it has held up (reviewRange). */
function RangeBasis({ range }: { range: ReviewRange }) {
  const [latestDate, latestDays] = range.latest;
  const { pace } = range;
  // within a week of each other, the two say the same
  const paceApart =
    pace !== null && Math.abs(daysBetween(range.queueDate, pace.date)) > 7;
  return (
    <>
      NVC&rsquo;s newest review time was {latestDays} days, on{" "}
      {formatDate(latestDate)}. If it stays the same, NVC would reach them
      around {formatDate(range.queueDate)}.
      {pace !== null && paceApart && (
        <>
          {" "}
          But its queue has been{" "}
          {pace.date > range.queueDate ? "growing" : "shrinking"}. From{" "}
          {formatDate(pace.from[0])} to {formatDate(latestDate)}, it moved from
          documents submitted on {formatDate(front(pace.from))} to documents
          submitted on {formatDate(front(range.latest))}:{" "}
          {daysBetween(front(pace.from), front(range.latest))} days of documents
          in {daysBetween(pace.from[0], latestDate)} days. At that speed, it
          would reach them around {formatDate(pace.date)}.
        </>
      )}
      {range.burstDays !== null && (
        <>
          {" "}
          Lately NVC has moved in bursts and pauses, so the range also goes up
          to its longest review time of the last six weeks: {
            range.burstDays
          }{" "}
          days.
        </>
      )}{" "}
      {range.gap !== null ? (
        <>
          We have no data from NVC&rsquo;s page between{" "}
          {formatDate(range.gap[0])} and {formatDate(range.gap[1])}, so we
          cannot tell if NVC moved steadily or in bursts and pauses, as it did
          in June 2026.
        </>
      ) : range.growing ? (
        <>
          We tested this method on NVC&rsquo;s timeframes since November 2020:
          more than 9 reviews in 10 fell inside the range. But when the queue
          was growing, as it is now, only about 4 in 5 did, and the rest came
          sooner.
        </>
      ) : (
        <>
          We tested this method on NVC&rsquo;s timeframes since November 2020:
          more than 9 reviews in 10 fell inside the range.
        </>
      )}
    </>
  );
}

/** When NVC will most likely review documents submitted today, or on a date
 * the visitor enters, as a range (reviewRange). For a past date this uses
 * what NVC has said since, rather than the review time it showed that day,
 * which after weeks without readings can be far off. */
function ReviewEstimate({ today, series }: ReviewEstimateProps) {
  const [submitted, setSubmitted] = useState("");
  const latest = getLatestReading(series);
  const valid = /^\d{4}-\d{2}-\d{2}$/.test(submitted) && submitted <= today;
  const from = valid ? submitted : today;
  const [reviewDate] = latest;
  // the newest submission date NVC had reached on the newest reading
  const reached = front(latest);
  const range = valid && from <= reached ? null : reviewRange(series, from);
  const what = valid
    ? `Documents submitted on ${formatDate(from)}`
    : "Documents submitted today";
  let text: React.ReactNode;
  // the range whose basis goes under "How we worked this out", if the text
  // gives one
  let shownRange: ReviewRange | null = null;
  if (valid && from <= reached)
    text = (
      <>
        On {formatDate(reviewDate)}, NVC was already reviewing documents
        submitted on {formatDate(reached)}, so it has most likely reviewed
        documents submitted on {formatDate(from)}.
      </>
    );
  // a stall: the notice above says so, and there is no pace to go by
  else if (range === null) return null;
  else if (range.upper < today)
    text = (
      <>
        At the pace NVC showed up to {formatDate(reviewDate)}, it has most
        likely reviewed documents submitted on {formatDate(from)} by now.
      </>
    );
  // The range can start before today, by when NVC may or may not have
  // reached documents submitted a while ago: no bound shown is before today,
  // which is after the submission date too.
  else if (range.lower < today) {
    shownRange = range;
    text = (
      <>
        {what}: NVC{" "}
        {valid && from < today
          ? "may already have reviewed them, and will most likely have"
          : "will most likely review them"}{" "}
        by <strong>{formatDate(range.upper)}</strong>.
      </>
    );
  } else {
    shownRange = range;
    text = (
      <>
        {what}: NVC will most likely review them between{" "}
        <strong>{formatDate(range.lower)}</strong> and{" "}
        <strong>{formatDate(range.upper)}</strong>.
      </>
    );
  }
  return (
    <Stack gap="xs">
      <Text>
        {text}
        {shownRange !== null && shownRange.gap !== null && (
          <>
            {" "}
            This range is less exact than usual, because some data is missing.
          </>
        )}
      </Text>
      {shownRange !== null && (
        <MoreDetails label="How we worked this out">
          <Text size="sm">
            <RangeBasis range={shownRange} />
          </Text>
        </MoreDetails>
      )}
      <Text size="sm">
        If NVC asks you to correct your documents, your case goes back{" "}
        <Anchor
          href="https://travel.state.gov/content/travel/en/us-visas/immigrate/the-immigrant-visa-process/step-8-scan-collected-documents/step-9-upload-and-submit-scanned-documents.html"
          target="_blank"
          rel="noopener noreferrer"
          inherit
        >
          in line for review
        </Anchor>{" "}
        when you submit them again. So enter the date you last submitted them.
      </Text>
      <TextInput
        type="date"
        label="Already submitted? Enter the date you last submitted"
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
  const [creationDate, creationDays] = getLatestReading(data.creation);
  const [inquiryDate, inquiryDays] = getLatestReading(data.inquiry);
  const description =
    reviewDate === creationDate && reviewDate === inquiryDate
      ? `On ${formatDate(
          reviewDate,
        )}, the National Visa Center was taking ${reviewDays} days to review documents, ${creationDays} days to create cases and ${inquiryDays} days to answer inquiries.`
      : `The National Visa Center was taking ${reviewDays} days to review documents on ${formatDate(
          reviewDate,
        )}, ${creationDays} days to create cases on ${formatDate(
          creationDate,
        )} and ${inquiryDays} days to answer inquiries on ${formatDate(
          inquiryDate,
        )}.`;

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
            Our newest data is from {formatDate(latestDate)}, {ageDays} days
            ago, but NVC usually updates every week, so it may be faster or
            slower now. See{" "}
            <Anchor
              href={NVC_TIMEFRAMES_URL}
              target="_blank"
              rel="noopener noreferrer"
              inherit
            >
              today&rsquo;s times on NVC&rsquo;s website
            </Anchor>
            .
          </Alert>
        )}
        {/* the alert above gives the date when the data is stale */}
        {!stale && (
          <Text size="xl">Last updated {formatDate(latestDate)}.</Text>
        )}
        <Text>
          How long the National Visa Center is taking to create cases, review
          documents and answer inquiries. NVC usually updates these timeframes
          every week, and we check its page for new ones every day.
        </Text>
        <Text>
          These timeframes do not apply to K (fiancé(e)) visas, diversity visas,
          special immigrant visas or adoptions, per NVC. For spouses, parents
          and children of US citizens, NVC usually takes weeks, and{" "}
          <Anchor component={Link} href="/consulates">
            the longest wait is usually the interview queue at your consulate
          </Anchor>
          . In the family and employment preference categories, the longest wait
          is usually for your priority date, often years: once the{" "}
          <Anchor
            href={VISA_BULLETIN_URL}
            target="_blank"
            rel="noopener noreferrer"
          >
            Visa Bulletin
          </Anchor>
          &rsquo;s Dates for Filing chart passes it, NVC can tell you to send
          your documents, but you can only get an interview once your priority
          date is current in its Final Action Dates chart.
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
        <SeriesAgeNotice
          series={data.review}
          what="document review"
          today={today}
          pageStale={stale}
        />
        <StallNotice series={data.review} what="document review" />
        {today !== null && !isStale(data.review, today) && (
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
        <SeriesAgeNotice
          series={data.creation}
          what="case creation"
          today={today}
          pageStale={stale}
        />
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
        <SeriesAgeNotice
          series={data.inquiry}
          what="inquiry response"
          today={today}
          pageStale={stale}
        />
        <StallNotice series={data.inquiry} what="inquiry response" />
        <NvcChart id="inquiry" series={data.inquiry} />
      </Stack>
    </Stack>
  );
}
