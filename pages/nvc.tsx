import { GetStaticProps } from "next";
import Head from "next/head";
import { getData, NvcData, NvcSeries } from "../api/nvc";
import add from "date-fns/add";
import getISODay from "date-fns/getISODay";
import React from "react";
import NvcChart from "../components/NvcChart";
import last from "lodash/last";
import { jsonLdScriptProps } from "react-schemaorg";
import { Dataset } from "schema-dts";
import { Anchor, Stack, Text, Title } from "@mantine/core";

export const getStaticProps: GetStaticProps = async () => ({
  props: {
    data: await getData(),
  },
});

interface Props {
  data: NvcData;
}

const NVC_TZ_OFFSET_MINS = 5 * 60;

function getLatestDate(data: NvcData): Date {
  const dates = Object.keys(data.creation);
  return new Date(last(dates) as string);
}

function getDaysTillNewDataText(data: NvcData): string {
  const latestDate = getLatestDate(data);
  const today = add(new Date(), {
    minutes: new Date().getTimezoneOffset() - NVC_TZ_OFFSET_MINS,
  });
  const daysTillNewData =
    getISODay(today) === 1 && latestDate.toDateString() !== today.toDateString()
      ? 0
      : 8 - getISODay(today);

  return `next update expected ${
    daysTillNewData === 0
      ? "later today"
      : daysTillNewData === 1
      ? "tomorrow"
      : `in ${daysTillNewData} days`
  } (EST).`;
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
  return (
    <Stack spacing="3rem">
      <Head>
        <title>NVC wait times</title>
        <meta
          name="description"
          content={`The National Visa Center is currently taking ${last(
            Object.values(data.review),
          )} days to review documents, ${last(
            Object.values(data.creation),
          )} days to create cases, and ${last(
            Object.values(data.inquiry),
          )} days to respond to inquiries.`}
        />
        <link rel="canonical" href="https://visawhen.com/nvc" />
        <meta property="og:title" content="NVC wait times" />
        <meta
          property="og:description"
          content={`The National Visa Center is currently taking ${last(
            Object.values(data.review),
          )} days to review documents, ${last(
            Object.values(data.creation),
          )} days to create cases, and ${last(
            Object.values(data.inquiry),
          )} days to respond to inquiries.`}
        />
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
              uploadDate: getLatestDate(data).toISOString(),
              requiresSubscription: false,
            },
            dateModified: getLatestDate(data).toISOString(),
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
      <Stack spacing="sm">
        <Title order={1}>NVC wait times</Title>
        <Text size="xl">
          Last updated {getLatestDate(data).toLocaleDateString()},{" "}
          {getDaysTillNewDataText(data)}
        </Text>
        <Text>
          Here&rsquo;s how long you should expect to wait until the National
          Visa Center processes your case.
        </Text>
      </Stack>
      <Stack spacing="sm">
        <ChartHeading series={data.review}>Document review</ChartHeading>
        <Text>
          Time until documents submitted on{" "}
          <a href="https://ceac.state.gov/IV/Login.aspx">CEAC</a> are reviewed
          by NVC.
        </Text>
        <Text>
          These numbers are anecdotally accurate: my case was processed in April
          2021 exactly when this chart predicted.
        </Text>
        <NvcChart id="review" series={data.review} />
      </Stack>
      <Stack spacing="sm">
        <ChartHeading series={data.creation}>Case creation</ChartHeading>
        <Text>
          Time after USCIS sends a case to the NVC until the NVC creates a case
          for it in <a href="https://ceac.state.gov/IV/Login.aspx">CEAC</a>.
        </Text>
        <Text>
          Some time elapses after USCIS approval before they send the case to
          the NVC.
        </Text>
        <NvcChart id="creation" series={data.creation} />
      </Stack>
      <Stack spacing="sm">
        <ChartHeading series={data.inquiry}>Inquiry response</ChartHeading>
        <Text>
          Time until questions and requests sent via{" "}
          <Anchor
            target="_blank"
            rel="noopener noreferer"
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
