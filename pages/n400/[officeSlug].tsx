import { ChevronLeftIcon } from "../../components/icons";
import { Anchor, Button, Stack, Text, Title } from "@mantine/core";
import { GetStaticPaths, GetStaticProps } from "next";
import Head from "next/head";
import Link from "next/link";
import React from "react";
import { getActiveOffices, getData, Period } from "../../api/n400";
import {
  formatCount,
  formatMonths,
  highlight,
  QuarterPoint,
  toPoints,
} from "../../components/n400";
import { N400OutcomesChart, N400WaitChart } from "../../components/N400Chart";
import N400Stats from "../../components/N400Stats";

interface Props {
  slug: string;
  name: string;
  stateCode: string | null;
  points: QuarterPoint[];
  nationalWaitMonths: number | null;
  latestPeriod: Period;
}

export const getStaticPaths: GetStaticPaths = async () => {
  const data = await getData();
  return {
    paths: getActiveOffices(data).map((office) => ({
      params: { officeSlug: office.slug },
    })),
    fallback: false,
  };
};

export const getStaticProps: GetStaticProps<Props> = async ({ params }) => {
  if (params === undefined || typeof params.officeSlug !== "string")
    return { notFound: true };
  const data = await getData();
  const office = data.offices.find(({ slug }) => slug === params.officeSlug);
  if (office === undefined) return { notFound: true };
  const nationalPoints = toPoints(data.periods, data.total);
  return {
    props: {
      slug: office.slug,
      name: office.name,
      stateCode: office.stateCode,
      points: toPoints(data.periods, office.quarters),
      nationalWaitMonths:
        nationalPoints[nationalPoints.length - 1]?.waitMonths ?? null,
      latestPeriod: data.periods[data.periods.length - 1],
    },
  };
};

export default function N400Office({
  slug,
  name,
  stateCode,
  points,
  nationalWaitMonths,
  latestPeriod,
}: Props) {
  const current = points[points.length - 1];
  const fullName = stateCode === null ? name : `${name}, ${stateCode}`;
  const title = `N-400 processing times at the ${fullName} field office`;
  const description = `The ${fullName} USCIS field office had ${formatCount(
    current.pending,
  )} N-400 applications pending at the end of ${current.label} and decided ${formatCount(
    current.completions,
  )} that quarter: an estimated ${formatMonths(current.waitMonths)} of waiting.`;
  const canonicalUrl = `https://visawhen.com/n400/${slug}`;

  const comparison =
    current.waitMonths === null || nationalWaitMonths === null
      ? null
      : current.waitMonths > nationalWaitMonths * 1.2
      ? `That is slower than the ${formatMonths(
          nationalWaitMonths,
        )} estimated for the country as a whole.`
      : current.waitMonths < nationalWaitMonths * 0.8
      ? `That is faster than the ${formatMonths(
          nationalWaitMonths,
        )} estimated for the country as a whole.`
      : `That is about the same as the ${formatMonths(
          nationalWaitMonths,
        )} estimated for the country as a whole.`;

  return (
    <Stack gap="xl">
      <Head>
        <title>{title}</title>
        <meta name="description" content={description} />
        <link rel="canonical" href={canonicalUrl} />
        <meta property="og:title" content={title} />
        <meta property="og:description" content={description} />
        <meta property="og:url" content={canonicalUrl} />
      </Head>
      <Button
        variant="outline"
        component={Link}
        href="/n400"
        size="xs"
        leftSection={<ChevronLeftIcon />}
        style={{ alignSelf: "flex-start" }}
      >
        Change field office
      </Button>
      <Stack gap="sm">
        <Title order={1}>N-400 processing at {fullName}</Title>
        <Text size="xl">
          Latest USCIS data: {current.label}, from the{" "}
          <Anchor href={latestPeriod.source} target="_blank" rel="noopener">
            fiscal year {latestPeriod.fiscalYear} quarter{" "}
            {latestPeriod.fiscalQuarter} report
          </Anchor>
          .
        </Text>
        <N400Stats points={points} />
        <Text>
          <strong>Quarter-over-quarter highlight:</strong>{" "}
          {highlight(points, `the ${name} field office`)} {comparison}
        </Text>
      </Stack>
      <Stack gap="sm">
        <Title order={2}>What happened to the applications</Title>
        <Text>
          Each bar is everything the {name} office had to decide on in a
          quarter: the applications waiting when it started plus the ones
          filed during it. Blue was approved that quarter, red denied, and
          amber was still waiting when it ended.
        </Text>
        <N400OutcomesChart points={points} source={latestPeriod.source} />
      </Stack>
      <Stack gap="sm">
        <Title order={2}>How long the wait is</Title>
        <Text>
          The estimated wait is how long it would take to decide every pending
          application if the office kept up that quarter&rsquo;s pace. It is
          not USCIS&rsquo;s official processing time (which counts only cases
          already decided), but it moves the same way and shows the trend a
          quarter or two earlier.
        </Text>
        <N400WaitChart points={points} />
      </Stack>
    </Stack>
  );
}
