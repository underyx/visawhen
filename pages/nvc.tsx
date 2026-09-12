import { GetStaticProps } from "next";
import Head from "next/head";
import { getData, NvcData, NvcSeries } from "../api/nvc";
import React, { useSyncExternalStore } from "react";
import NvcChart from "../components/NvcChart";
import last from "lodash/last";
import { jsonLdScriptProps } from "react-schemaorg";
import { Dataset } from "schema-dts";
import { Anchor, Stack, Text, Title } from "@mantine/core";

interface Props {
  data: NvcData;
}

export const getStaticProps: GetStaticProps<Props> = async () => ({
  props: {
    data: await getData(),
  },
});

const NVC_TIME_ZONE = "America/New_York";
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

// The dates are stored as UTC days; format them as such, or a visitor west of
// Greenwich sees the day before.
const dateFormatter = new Intl.DateTimeFormat("en-US", {
  dateStyle: "long",
  timeZone: "UTC",
});

/** The newest as-of date in the data, "2026-09-07" */
function getLatestDate(data: NvcData): string {
  return last(Object.keys(data.creation)) as string;
}

/** The calendar date and ISO weekday (Monday is 1) at the NVC right now. */
function nvcToday(now: Date): { date: string; isoDay: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: NVC_TIME_ZONE,
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((candidate) => candidate.type === type)?.value ?? "";
  return {
    date: `${part("year")}-${part("month")}-${part("day")}`,
    isoDay: WEEKDAYS.indexOf(part("weekday")) + 1,
  };
}

/** "next update expected in 3 days": the NVC updates its page on Mondays. */
function getNextUpdateText(data: NvcData, now: Date): string {
  const { date, isoDay } = nvcToday(now);
  const daysTillNewData =
    isoDay === 1 && getLatestDate(data) !== date ? 0 : 8 - isoDay;
  return `next update expected ${
    daysTillNewData === 0
      ? "later today"
      : daysTillNewData === 1
      ? "tomorrow"
      : `in ${daysTillNewData} days`
  } (Eastern Time)`;
}

/** The text depends on the current date, so it is rendered on the client
 * only: the prerendered HTML is served for days after it was built, and
 * would otherwise disagree with what React renders on hydration. */
function useNextUpdateText(data: NvcData): string | null {
  return useSyncExternalStore(
    () => () => {},
    () => getNextUpdateText(data, new Date()),
    () => null,
  );
}

interface ChartHeadingProps {
  series: NvcSeries;
}

function ChartHeading({
  children,
  series,
}: React.PropsWithChildren<ChartHeadingProps>) {
  return (
    <Title order={2}>
      {children} takes {last(Object.values(series))} days
    </Title>
  );
}

export default function NvcBacklog({ data }: Props) {
  const nextUpdateText = useNextUpdateText(data);
  const latestDate = getLatestDate(data);
  const description = `The National Visa Center is currently taking ${last(
    Object.values(data.review),
  )} days to review documents, ${last(
    Object.values(data.creation),
  )} days to create cases, and ${last(
    Object.values(data.inquiry),
  )} days to respond to inquiries.`;

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
              contentUrl:
                "https://github.com/underyx/visawhen/blob/main/data/nvc/data.json",
              encodingFormat: "application/json",
              uploadDate: latestDate,
              requiresSubscription: false,
            },
            dateModified: latestDate,
            description:
              "Here's how long you should expect to wait until the National Visa Center processes your case.",
            accessMode: "chartOnVisual",
            creator: {
              "@type": "Person",
              familyName: "Nagy",
              givenName: "Bence",
              additionalName: "underyx",
              url: "https://underyx.me",
            },
            inLanguage: "en",
            isBasedOn:
              "https://travel.state.gov/content/travel/en/us-visas/immigrate/nvc-timeframes.html",
            license: "https://github.com/underyx/visawhen/blob/main/LICENSE",
            temporalCoverage: "2020-11/..",
          })}
        />
      </Head>
      <Stack gap="sm">
        <Title order={1}>NVC wait times</Title>
        <Text size="xl">
          Last updated {dateFormatter.format(new Date(latestDate))}
          {nextUpdateText === null ? "." : `, ${nextUpdateText}.`}
        </Text>
        <Text>
          Here&rsquo;s how long you should expect to wait until the National
          Visa Center processes your case.
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
          These numbers are anecdotally accurate: my case was processed in April
          2021 exactly when this chart predicted.
        </Text>
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
        <NvcChart id="inquiry" series={data.inquiry} />
      </Stack>
    </Stack>
  );
}
