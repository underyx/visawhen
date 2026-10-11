import { GetStaticProps } from "next";
import Head from "next/head";
import { getData, NvcData, NvcSeries } from "../api/nvc";
import React from "react";
import NvcChart from "../components/NvcChart";
import { jsonLdScriptProps } from "react-schemaorg";
import { Dataset } from "schema-dts";
import { Anchor, Box, Stack, Text, Title } from "@mantine/core";
import {
  addDays,
  daysBetween,
  formatDate,
  formatDateRange,
  formatMonthDay,
  formatShortDate,
  useToday,
} from "../components/Freshness";
import MoreDetails from "../components/MoreDetails";
import { NoteChip } from "../components/NoteChip";
import NvcAudience from "../components/NvcAudience";
import PolicyBanner from "../components/PolicyBanner";
import { WarningIcon } from "../components/icons";
import { Stat, Stats } from "../components/Stats";
import TemporaryNotice from "../components/TemporaryNotice";
import {
  front,
  getStall,
  latest,
  latestChange,
  reviewRange,
  ReviewRange,
} from "../components/nvcReview";
import { NVC_TIMEFRAMES_URL } from "../components/links";
import { CREATOR, LICENSE_URL } from "../components/structuredData";
import stampClasses from "../components/UscisStats.module.css";

// The page leads with NVC's three times as figures, then the stamp: when
// NVC will most likely review documents submitted today. The notices and
// who the times are for come after the numbers, and each queue's chart
// after those.

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

/** Where documents are submitted to NVC, and where its messages arrive */
const CEAC_URL = "https://ceac.state.gov/IV/Login.aspx";

/** The newest as-of date of any series, "2026-09-07". Each series has its
 * own: the scraper matches each of NVC's sentences separately, so one that
 * NVC rewords stops updating while the others go on. */
function getLatestDate(data: NvcData): string {
  return [data.creation, data.review, data.inquiry]
    .map((series) => latest(series)[0])
    .sort()
    .reverse()[0];
}

/** Whether a series' own newest reading is too old to go by */
function isStale(series: NvcSeries, today: string): boolean {
  return daysBetween(latest(series)[0], today) > MAX_AGE_DAYS;
}

/** "62 days" */
function formatDays(days: number): string {
  return `${days} ${days === 1 ? "day" : "days"}`;
}

function CeacLink() {
  return (
    <Anchor href={CEAC_URL} target="_blank" rel="noopener noreferrer">
      CEAC
    </Anchor>
  );
}

interface QueueStatProps {
  label: string;
  series: NvcSeries;
  /** The newest date of any series: a box whose own is older says so */
  latestDate: string;
  /** The queue's submissions, for the note on a stall, as what NVC stays
   * at, "documents submitted", and as the subject of what the ones made
   * now will take, "Documents submitted now" */
  at: string;
  now: string;
}

/** One queue's newest time, as a box, with how it changed since the reading
 * before under it: a longer time is bad news for those waiting, so it is in
 * red, and a shorter one in green. While the queue has stalled (getStall),
 * a chip in warning colours after the change opens a note on what the
 * stall means (Bence's design: the notice it replaced restated the change,
 * which itself stays plain text). */
function QueueStat({ label, series, latestDate, at, now }: QueueStatProps) {
  const [date, days] = latest(series);
  const change = latestChange(series);
  const stall = getStall(series);
  let line: React.ReactNode = null;
  let lineColor = "dimmed";
  if (date !== latestDate) line = `as of ${formatShortDate(date)}`;
  else if (change !== null) {
    const since = formatMonthDay(change.previous[0]);
    if (change.days === 0) line = `same as on ${since}`;
    else {
      const changed = `${change.days > 0 ? "+" : "−"}${formatDays(
        Math.abs(change.days),
      )} since ${since}`;
      lineColor = change.days > 0 ? "red.9" : "teal.9";
      // While the queue has stalled, the change is only how much older the
      // queue got: a chip after it opens a note on what that means.
      line =
        stall === null ? (
          changed
        ) : (
          <>
            {changed}{" "}
            <NoteChip
              label="stalled"
              icon={<WarningIcon />}
              title={`${label} has stalled`}
              tone="warning"
            >
              <Text size="sm">
                Since {formatMonthDay(stall.from[0])}, NVC has not moved past{" "}
                {at} around {formatMonthDay(front(stall.to))}. {now} will take
                longer than {formatDays(days)}, and the wait grows every week
                this goes on.
              </Text>
            </NoteChip>
          </>
        );
    }
  }
  return (
    <Stat
      label={label}
      value={formatDays(days)}
      line={line}
      lineColor={lineColor}
    />
  );
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
  const [date] = latest(series);
  return (
    <TemporaryNotice>
      Our newest {what} time is from {formatDate(date)},{" "}
      {daysBetween(date, today)} days ago, so it may be out of date. See{" "}
      <Anchor
        href={NVC_TIMEFRAMES_URL}
        target="_blank"
        rel="noopener noreferrer"
      >
        today&rsquo;s time on NVC&rsquo;s website
      </Anchor>
      .
    </TemporaryNotice>
  );
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

interface ReviewEstimateProps {
  /** Today, or null while prerendering and hydrating */
  today: string | null;
  /** NVC's document review times */
  series: NvcSeries;
}

/** The stamp: when NVC will most likely review documents submitted today,
 * as a range (reviewRange), with what the range rests on beside it. While
 * the queue has stalled there is no pace to go by, so the stamp gives only
 * the day the current wait would end, "or later"; the chip in the box
 * above says what the stall means. Until the page knows today's date, the
 * stamp gives the range as days, so that the prerendered page has one. */
function ReviewEstimate({ today, series }: ReviewEstimateProps) {
  const newest = latest(series);
  const [reviewDate, reviewDays] = newest;
  const stall = getStall(series);
  // The reading's own date stands in for today until the page knows it.
  const from = today ?? reviewDate;

  // the stamp's big line, or null for no stamp
  let value: string | null = null;
  // what the stamp rests on, under "How we worked this out"
  let basis: React.ReactNode = null;
  // the range, once the page knows today; a gap in its data is said beside
  // the stamp
  let range: ReviewRange | null = null;
  if (stall !== null) {
    // The current wait is the least the documents can take while NVC stays
    // put, and it grows every week NVC does.
    value =
      today === null
        ? `in more than ${reviewDays} days`
        : `${formatShortDate(addDays(from, reviewDays))} or later`;
    basis = (
      <>
        NVC&rsquo;s newest review time was {reviewDays} days, on{" "}
        {formatDate(reviewDate)}. But since {formatDate(stall.from[0])} it has
        not moved past documents submitted around {formatDate(front(stall.to))},
        so there is no pace to go by. Documents submitted today will take at
        least those {reviewDays} days.
      </>
    );
  } else {
    // never null while the front moves
    const estimate = reviewRange(series, from);
    if (estimate !== null) {
      if (today === null) {
        const low = daysBetween(from, estimate.lower);
        const high = daysBetween(from, estimate.upper);
        value =
          low === high ? `in about ${low} days` : `in ${low}–${high} days`;
      } else {
        range = estimate;
        basis = <RangeBasis range={estimate} />;
        // The range can start before today, by when NVC may or may not have
        // reached documents submitted a while ago: no bound shown is before
        // today.
        value =
          estimate.lower < today
            ? `by ${formatShortDate(estimate.upper)}`
            : formatDateRange({ low: estimate.lower, high: estimate.upper });
      }
    }
  }

  return (
    <div className={stampClasses.estimate}>
      {value !== null && (
        <div className={stampClasses.stamp}>
          <div className={stampClasses.stampLabel}>
            NVC review done most likely:
          </div>
          <div className={stampClasses.stampRange}>{value}</div>
          <div className={stampClasses.stampFoot}>
            for documents submitted today
          </div>
        </div>
      )}
      {basis !== null && (
        <Stack gap="xs" className={stampClasses.aside}>
          {range !== null && range.gap !== null && (
            <Text size="sm">
              This range is less exact than usual, because some data is missing.
            </Text>
          )}
          <MoreDetails label="How we worked this out">
            <Text size="sm">{basis}</Text>
          </MoreDetails>
        </Stack>
      )}
    </div>
  );
}

/** With NVC's full name too, which some people search for instead */
const TITLE = "National Visa Center (NVC) wait times";

export default function NvcBacklog({ data }: Props) {
  const today = useToday();
  const latestDate = getLatestDate(data);
  const ageDays = today === null ? null : daysBetween(latestDate, today);
  const stale = ageDays !== null && ageDays > MAX_AGE_DAYS;
  // the review series' own notice says when it alone is stale
  const reviewStale = stale || (today !== null && isStale(data.review, today));
  const review = latest(data.review);
  const creation = latest(data.creation);
  const inquiry = latest(data.inquiry);
  const [reviewDate, reviewDays] = review;
  const [creationDate, creationDays] = creation;
  const [inquiryDate, inquiryDays] = inquiry;
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
    <Stack gap="xl">
      <Head>
        <title>{TITLE}</title>
        <meta name="description" content={description} />
        <link rel="canonical" href="https://visawhen.com/nvc" />
        <meta property="og:title" content={TITLE} />
        <meta property="og:description" content={description} />
        <meta property="og:url" content="https://visawhen.com/nvc" />
        <script
          {...jsonLdScriptProps<Dataset>({
            "@context": "https://schema.org",
            "@type": "Dataset",
            name: "NVC wait times",
            url: "https://visawhen.com/nvc",
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
            creator: CREATOR,
            inLanguage: "en",
            isBasedOn: NVC_TIMEFRAMES_URL,
            license: LICENSE_URL,
            temporalCoverage: "2020-11/..",
          })}
        />
      </Head>
      <Stack gap="sm">
        <Box>
          <Title order={1}>NVC wait times</Title>
          <Text size="lg">
            The National Visa Center&rsquo;s own weekly numbers. Newest:{" "}
            {formatDate(latestDate)}.
          </Text>
        </Box>
        {stale && (
          <TemporaryNotice>
            Our newest data is from {formatDate(latestDate)}, {ageDays} days
            ago, but NVC usually updates every week, so it may be faster or
            slower now. See{" "}
            <Anchor
              href={NVC_TIMEFRAMES_URL}
              target="_blank"
              rel="noopener noreferrer"
            >
              today&rsquo;s times on NVC&rsquo;s website
            </Anchor>
            .
          </TemporaryNotice>
        )}
        <Stats columns={3} phoneColumns={3}>
          <QueueStat
            label="Document review"
            series={data.review}
            latestDate={latestDate}
            at="documents submitted"
            now="Documents submitted now"
          />
          <QueueStat
            label="Case creation"
            series={data.creation}
            latestDate={latestDate}
            at="cases that USCIS sent"
            now="Cases that USCIS sends now"
          />
          <QueueStat
            label="Inquiry response"
            series={data.inquiry}
            latestDate={latestDate}
            at="inquiries sent"
            now="Inquiries sent now"
          />
        </Stats>
        {!reviewStale && <ReviewEstimate today={today} series={data.review} />}
      </Stack>
      <Stack gap="xs">
        <PolicyBanner page="/nvc" chips />
        <NvcAudience />
      </Stack>
      <Stack gap="sm">
        <Title order={2}>Document review</Title>
        <Text>
          Time until documents submitted on <CeacLink /> are reviewed by NVC. On{" "}
          {formatDate(reviewDate)}, NVC was reviewing documents submitted on{" "}
          {formatDate(front(review))}.
        </Text>
        <SeriesAgeNotice
          series={data.review}
          what="document review"
          today={today}
          pageStale={stale}
        />
        <NvcChart id="review" series={data.review} />
      </Stack>
      <Stack gap="sm">
        <Title order={2}>Case creation</Title>
        <Text>
          Time after USCIS sends a case to NVC until NVC creates a case for it
          in <CeacLink />. On {formatDate(creationDate)}, NVC was creating cases
          that USCIS sent on {formatDate(front(creation))}.
        </Text>
        <Text>
          Count from the day{" "}
          <Anchor
            href="https://egov.uscis.gov/casestatus/landing.do"
            target="_blank"
            rel="noopener noreferrer"
          >
            USCIS Case Status
          </Anchor>{" "}
          says{" "}
          <Text span fs="italic">
            &lsquo;Case Was Sent To The Department of State&rsquo;
          </Text>
          . If it still says{" "}
          <Text span fs="italic">
            &lsquo;Case Was Approved&rsquo;
          </Text>
          , USCIS has not sent the case yet. That can take a few weeks.
        </Text>
        <SeriesAgeNotice
          series={data.creation}
          what="case creation"
          today={today}
          pageStale={stale}
        />
        <NvcChart id="creation" series={data.creation} />
      </Stack>
      <Stack gap="sm">
        <Title order={2}>Inquiry response</Title>
        <Text>
          Time until questions sent through{" "}
          <Anchor
            target="_blank"
            rel="noopener noreferrer"
            href="https://travel.state.gov/content/travel/en/us-visas/visa-information-resources/ask-nvc.html"
          >
            NVC&rsquo;s public inquiry form
          </Anchor>{" "}
          are answered. On {formatDate(inquiryDate)}, NVC was answering
          inquiries sent on {formatDate(front(inquiry))}.
        </Text>
        <SeriesAgeNotice
          series={data.inquiry}
          what="inquiry response"
          today={today}
          pageStale={stale}
        />
        <NvcChart id="inquiry" series={data.inquiry} />
      </Stack>
    </Stack>
  );
}
