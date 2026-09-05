import { ChevronLeftIcon } from "../../../components/icons";
import { Anchor, Button, Group, Stack, Text, Title } from "@mantine/core";
import { GetStaticPaths, GetStaticProps } from "next";
import Head from "next/head";
import Link from "next/link";
import React from "react";
import {
  getActiveForms,
  getActiveOffices,
  getData,
  latestQuarter,
} from "../../../api/uscis";
import {
  formatCount,
  formatMonths,
  highlight,
  QuarterPoint,
  toPoints,
} from "../../../components/uscis";
import { OutcomesChart, WaitChart } from "../../../components/UscisChart";
import UscisStats from "../../../components/UscisStats";

interface Props {
  form: string;
  formSlug: string;
  formTitle: string;
  slug: string;
  name: string;
  stateCode: string | null;
  points: QuarterPoint[];
  nationalWaitMonths: number | null;
  source: string;
}

export const getStaticPaths: GetStaticPaths = async () => {
  const data = await getData();
  return {
    paths: getActiveForms(data).flatMap((form) =>
      getActiveOffices(form).map((office) => ({
        params: { formSlug: form.slug, officeSlug: office.slug },
      })),
    ),
    fallback: false,
  };
};

export const getStaticProps: GetStaticProps<Props> = async ({ params }) => {
  if (
    params === undefined ||
    typeof params.formSlug !== "string" ||
    typeof params.officeSlug !== "string"
  )
    return { notFound: true };
  const data = await getData();
  const form = data.forms.find(({ slug }) => slug === params.formSlug);
  const office = form?.offices.find(({ slug }) => slug === params.officeSlug);
  if (form === undefined || office === undefined) return { notFound: true };
  const points = toPoints(data.periods, office.quarters);
  const latest = points[points.length - 1].quarter;
  const nationalPoints = toPoints(data.periods, form.officeTotals);
  return {
    props: {
      form: form.form,
      formSlug: form.slug,
      formTitle: form.title,
      slug: office.slug,
      name: office.name,
      stateCode: office.stateCode,
      points,
      nationalWaitMonths:
        nationalPoints.find((point) => point.quarter === latest)?.waitMonths ??
        null,
      source:
        form.officeSources[latest] ??
        form.officeSources[latestQuarter(form.officeSources) ?? ""],
    },
  };
};

export default function UscisOffice({
  form,
  formSlug,
  formTitle,
  slug,
  name,
  stateCode,
  points,
  nationalWaitMonths,
  source,
}: Props) {
  const current = points[points.length - 1];
  const fullName = stateCode === null ? name : `${name}, ${stateCode}`;
  const title = `${form} processing times at the ${fullName} office`;
  const description = `The ${fullName} USCIS office had ${formatCount(
    current.pending,
  )} ${form} (${formTitle}) applications pending at the end of ${
    current.label
  } and decided ${formatCount(
    current.completions,
  )} that quarter: an estimated ${formatMonths(
    current.waitMonths,
  )} of waiting.`;
  const canonicalUrl = `https://visawhen.com/uscis/${formSlug}/${slug}`;
  const sourceName = `${form} by Category, Case Status, and USCIS Field Office Location`;

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
      <Group gap="xs" style={{ alignSelf: "flex-start" }}>
        <Button
          variant="outline"
          component={Link}
          href="/uscis"
          size="xs"
          leftSection={<ChevronLeftIcon />}
        >
          Change form
        </Button>
        <Button
          variant="outline"
          component={Link}
          href={`/uscis/${formSlug}`}
          size="xs"
          leftSection={<ChevronLeftIcon />}
        >
          Change office
        </Button>
      </Group>
      <Stack gap="sm">
        <Title order={1}>
          {form} processing at {fullName}
        </Title>
        <Text size="xl">
          Latest USCIS data: {current.label}, from the{" "}
          <Anchor href={source} target="_blank" rel="noopener">
            {sourceName}
          </Anchor>{" "}
          report.
        </Text>
        <UscisStats points={points} />
        <Text>
          <strong>Quarter-over-quarter highlight:</strong>{" "}
          {highlight(points, `the ${name} office`, `${form} applications`)}{" "}
          {comparison}
        </Text>
      </Stack>
      <Stack gap="sm">
        <Title order={2}>What happened to the applications</Title>
        <Text>
          Each bar is everything the {name} office had to decide on in a
          quarter: the {form} applications waiting when it started plus the ones
          filed during it. Blue was approved that quarter, red denied, and amber
          was still waiting when it ended.
        </Text>
        <OutcomesChart
          points={points}
          source={source}
          sourceName={sourceName}
        />
      </Stack>
      <Stack gap="sm">
        <Title order={2}>How long the wait is</Title>
        <Text>
          The estimated wait is how long it would take to decide every pending
          application if the office kept up that quarter&rsquo;s pace. It is not
          USCIS&rsquo;s official processing time (which counts only cases
          already decided), but it moves the same way and shows the trend a
          quarter or two earlier.
        </Text>
        <WaitChart points={points} processingTimeSeries={[]} />
      </Stack>
    </Stack>
  );
}
