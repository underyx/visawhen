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
  CASES_MOVED,
  categoryRanges,
  CategoryRange,
  clearingSuppressed,
  formatRangeMonths,
  headlineRange,
  officeEstimateSuppressed,
  withoutMisleadingClearing,
} from "../../../components/estimate";
import {
  formatCount,
  formatMonths,
  highlight,
  QuarterPoint,
  quarterLabel,
  toPoints,
} from "../../../components/uscis";
import { OutcomesChart, WaitChart } from "../../../components/UscisChart";
import UscisStats, { RangeText } from "../../../components/UscisStats";

interface Props {
  form: string;
  formSlug: string;
  formTitle: string;
  slug: string;
  name: string;
  stateCode: string | null;
  points: QuarterPoint[];
  nationalWaitMonths: number | null;
  /** What a filer in the form's main category can expect nationally */
  nationalRange: CategoryRange | null;
  /** The quarter of USCIS's national median, "Apr–Jun 2026" */
  nationalLabel: string;
  /** Whether some of the pending cases wait on the Visa Bulletin */
  waitsForVisas: boolean;
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
  const points = withoutMisleadingClearing(
    toPoints(data.periods, office.quarters),
    true,
  );
  const latest = points[points.length - 1].quarter;
  const nationalPoints = toPoints(data.periods, form.officeTotals);
  const ranges = categoryRanges(form);
  const nationalQuarter = latestQuarter(form.quarters);
  const nationalPeriod = data.periods.find(
    (period) => period.quarter === nationalQuarter,
  );
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
      nationalRange: headlineRange(ranges),
      waitsForVisas: ranges.some(({ priorityDate }) => priorityDate),
      nationalLabel:
        nationalPeriod === undefined ? "" : quarterLabel(nationalPeriod),
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
  nationalRange,
  nationalLabel,
  waitsForVisas,
  source,
}: Props) {
  const current = points[points.length - 1];
  const backlogSuppressed = officeEstimateSuppressed(points);
  // quarters the chart leaves the time to clear the backlog out of
  const clearingGaps = points.some(
    (point, index) =>
      clearingSuppressed(point, points[index - 1], true) !== null,
  );
  const hasClearing = points.some(({ waitMonths }) => waitMonths !== null);
  // "I-130 (Immediate Relative)", or just "N-400"
  const nationalWho =
    nationalRange === null || nationalRange.name === form
      ? form
      : `${form} (${nationalRange.name})`;
  const fullName = stateCode === null ? name : `${name}, ${stateCode}`;
  // "the San Francisco office", but "the Nebraska Service Center"
  const isCenter = /\bCenter$/.test(name);
  const officePhrase = isCenter ? `the ${name}` : `the ${name} office`;
  const title = `${form} processing times at ${
    isCenter ? `the ${fullName}` : `the ${fullName} office`
  }`;
  // USCIS withholds small counts; with the denials withheld, say what is known
  const decided =
    current.completions !== null
      ? `decided ${formatCount(current.completions)}`
      : current.approved !== null
      ? `approved ${formatCount(current.approved)}`
      : null;
  const description = `${
    isCenter ? `USCIS's ${fullName}` : `The ${fullName} USCIS office`
  } ${
    decided === null
      ? `had ${formatCount(
          current.pending,
        )} ${form} (${formTitle}) applications pending at the end of ${
          current.label
        }.`
      : `${decided} ${form} (${formTitle}) applications in ${
          current.label
        } and had ${formatCount(current.pending)} pending at its end.`
  }${
    nationalRange === null
      ? ""
      : ` USCIS does not publish processing times per office; nationally, ${nationalWho} filers can expect a decision in ${formatRangeMonths(
          nationalRange.q[1],
          nationalRange.q[3],
        )} if they file today${
          nationalRange.shock ? ", likely toward the later end" : ""
        }.`
  }`;
  const canonicalUrl = `https://visawhen.com/uscis/${formSlug}/${slug}`;
  const sourceName = `${form} by Category, Case Status, and USCIS Field Office Location`;

  const comparison =
    backlogSuppressed !== null ||
    current.waitMonths === null ||
    nationalWaitMonths === null
      ? null
      : current.waitMonths > nationalWaitMonths * 1.2
      ? `That is longer than the ${formatMonths(
          nationalWaitMonths,
        )} it would take the country as a whole.`
      : current.waitMonths < nationalWaitMonths * 0.8
      ? `That is shorter than the ${formatMonths(
          nationalWaitMonths,
        )} it would take the country as a whole.`
      : `That is about the same as the ${formatMonths(
          nationalWaitMonths,
        )} it would take the country as a whole.`;

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
          USCIS does not publish processing times per office.{" "}
          {nationalRange !== null && (
            <>
              Nationally, {nationalWho} filers can expect a decision in{" "}
              <RangeText low={nationalRange.q[1]} high={nationalRange.q[3]} />{" "}
              if they file today, going by USCIS&rsquo;s median for{" "}
              {nationalLabel}.{" "}
              {nationalRange.shock &&
                nationalRange.shockRatio !== null &&
                `USCIS decided ${Math.round(
                  (1 - nationalRange.shockRatio) * 100,
                )}% fewer of these that quarter than its average over the four before, so plan for the later end. `}
            </>
          )}
          <Anchor component={Link} href={`/uscis/${formSlug}`} inherit>
            {nationalRange !== null
              ? `See the national ${form} range for each category`
              : `See the national ${form} numbers`}
          </Anchor>
          .
        </Text>
        <Text size="xl">
          Latest USCIS data: {current.label}, from the{" "}
          <Anchor href={source} target="_blank" rel="noopener">
            {sourceName}
          </Anchor>{" "}
          report.
        </Text>
        <UscisStats points={points} backlogSuppressed={backlogSuppressed} />
        <Text>
          <strong>Quarter-over-quarter highlight:</strong>{" "}
          {highlight(
            points,
            officePhrase,
            `${form} applications`,
            backlogSuppressed === CASES_MOVED,
          )}
          {comparison !== null && ` ${comparison}`}
        </Text>
      </Stack>
      <Stack gap="sm">
        <Title order={2}>What happened to the applications</Title>
        <Text>
          The bars are the {form} decisions {officePhrase} made each quarter,
          approved in blue and denied in red. The amber line is its backlog: how
          many applications were still waiting at the end of that quarter, most
          of them filed in earlier ones. The dashed line is how many came in.
        </Text>
        <OutcomesChart
          points={points}
          source={source}
          sourceName={sourceName}
        />
      </Stack>
      <Stack gap="sm">
        <Title order={2}>Backlog over time</Title>
        <Text>
          Time to clear backlog is how long the office would need to decide
          every pending case at last quarter&rsquo;s pace. It is not your wait:
          the pile includes cases on hold and{" "}
          {waitsForVisas
            ? "cases waiting for a visa number"
            : "cases USCIS cannot decide yet"}
          , and USCIS sometimes moves pending cases between offices.
          {clearingGaps &&
            ` ${
              hasClearing
                ? "The chart leaves it out for"
                : "It is not shown for"
            } quarters in which the office decided fewer than 100 cases, or in which its pending count more than doubled or halved, which means USCIS moved cases between offices.`}
        </Text>
        {hasClearing && <WaitChart points={points} processingTimeSeries={[]} />}
      </Stack>
    </Stack>
  );
}
