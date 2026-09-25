import { GetStaticProps } from "next";
import Head from "next/head";
import { getData, NvcData, NvcSeries } from "../api/nvc";
import React from "react";
import NvcChart from "../components/NvcChart";
import last from "lodash/last";
import { jsonLdScriptProps } from "react-schemaorg";
import { Dataset } from "schema-dts";
import { Alert, Anchor, Stack, Text, Title } from "@mantine/core";
import Link from "next/link";
import {
  addDays,
  daysBetween,
  formatDate,
  useToday,
} from "../components/Freshness";
import PolicyBanner from "../components/PolicyBanner";

interface Props {
  data: NvcData;
}

export const getStaticProps: GetStaticProps<Props> = async () => ({
  props: {
    data: await getData(),
  },
});

const NVC_TIMEFRAMES_URL =
  "https://travel.state.gov/content/travel/en/us-visas/immigrate/nvc-timeframes.html";
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
        <Text size="xl">Last updated {formatDate(latestDate)}.</Text>
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
        {today !== null && !stale && (
          <Text>
            Submit your documents today and NVC will most likely review them
            around <strong>{formatDate(addDays(today, reviewDays))}</strong>.
          </Text>
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
