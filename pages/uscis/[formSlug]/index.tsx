import { ChevronLeftIcon, SearchIcon } from "../../../components/icons";
import {
  Anchor,
  Badge,
  Button,
  Group,
  Highlight,
  Stack,
  Table,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { useInputState } from "@mantine/hooks";
import { deburr, sortBy } from "lodash";
import { GetStaticPaths, GetStaticProps } from "next";
import Head from "next/head";
import Link from "next/link";
import React, { useMemo } from "react";
import {
  getActiveForms,
  getActiveOffices,
  getData,
  Variant,
} from "../../../api/uscis";
import {
  formatCount,
  formatMonths,
  highlight,
  processingTimeSeries,
  ProcessingTimeSeries,
  QuarterPoint,
  toPoints,
} from "../../../components/uscis";
import { OutcomesChart, WaitChart } from "../../../components/UscisChart";
import UscisStats from "../../../components/UscisStats";
import classes from "../../../components/ListButton.module.css";

interface OfficeSummary {
  slug: string;
  name: string;
  stateCode: string | null;
  pending: number | null;
  waitMonths: number | null;
}

interface Props {
  form: string;
  slug: string;
  title: string;
  points: QuarterPoint[];
  variants: Variant[];
  processingTimeSeries: ProcessingTimeSeries[];
  source: string;
  offices: OfficeSummary[];
}

export const getStaticPaths: GetStaticPaths = async () => {
  const data = await getData();
  return {
    paths: getActiveForms(data).map((form) => ({
      params: { formSlug: form.slug },
    })),
    fallback: false,
  };
};

export const getStaticProps: GetStaticProps<Props> = async ({ params }) => {
  if (params === undefined || typeof params.formSlug !== "string")
    return { notFound: true };
  const data = await getData();
  const form = data.forms.find(({ slug }) => slug === params.formSlug);
  if (form === undefined) return { notFound: true };
  const points = toPoints(data.periods, form.quarters);
  const latest = points[points.length - 1];
  const variants = form.quarters[latest.quarter].variants;
  return {
    props: {
      form: form.form,
      slug: form.slug,
      title: form.title,
      points,
      variants,
      processingTimeSeries: processingTimeSeries(points, variants, form.title),
      source: form.sources[latest.quarter],
      offices: getActiveOffices(form).map((office) => {
        const officePoints = toPoints(data.periods, office.quarters);
        const current = officePoints[officePoints.length - 1];
        return {
          slug: office.slug,
          name: office.name,
          stateCode: office.stateCode,
          pending: current.pending,
          waitMonths: current.waitMonths,
        };
      }),
    },
  };
};

function normalize(text: string): string {
  return deburr(text)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

export default function UscisForm({
  form,
  slug,
  title,
  points,
  variants,
  processingTimeSeries,
  source,
  offices,
}: Props) {
  const [term, setTerm] = useInputState("");
  const current = points[points.length - 1];
  const filteredOffices = useMemo<OfficeSummary[]>(() => {
    const normalizedTerm = normalize(term);
    return sortBy(
      offices.filter(({ name, stateCode }) =>
        normalize(`${name} ${stateCode ?? ""}`).includes(normalizedTerm),
      ),
      [({ pending }) => -(pending ?? 0), "name"],
    );
  }, [offices, term]);

  const pageTitle = `${form} processing times`;
  const description = `USCIS had ${formatCount(
    current.pending,
  )} ${form} (${title}) applications pending at the end of ${
    current.label
  } and decided ${formatCount(
    current.completions,
  )} that quarter: an estimated ${formatMonths(
    current.waitMonths,
  )} of waiting.`;
  const canonicalUrl = `https://visawhen.com/uscis/${slug}`;
  const sourceName = "All USCIS Application and Petition Form Types";

  return (
    <Stack gap="xl">
      <Head>
        <title>{pageTitle}</title>
        <meta name="description" content={description} />
        <link rel="canonical" href={canonicalUrl} />
        <meta property="og:title" content={pageTitle} />
        <meta property="og:description" content={description} />
        <meta property="og:url" content={canonicalUrl} />
      </Head>
      <Button
        variant="outline"
        component={Link}
        href="/uscis"
        size="xs"
        leftSection={<ChevronLeftIcon />}
        style={{ alignSelf: "flex-start" }}
      >
        Change form
      </Button>
      <Stack gap="sm">
        <Title order={1}>
          {form} processing times
          <Text component="span" inherit c="dimmed">
            {" "}
            · {title}
          </Text>
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
          {highlight(points, "USCIS", `${form} applications`)}
        </Text>
      </Stack>
      <Stack gap="sm">
        <Title order={2}>What happened to the applications</Title>
        <Text>
          Each bar is everything USCIS had to decide on in a quarter: the {form}{" "}
          applications waiting when it started plus the ones filed during it.
          Blue was approved that quarter, red denied, and amber was still
          waiting when it ended.
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
          application if USCIS kept up that quarter&rsquo;s pace.
          {processingTimeSeries.length > 0
            ? " USCIS's own median processing time only counts cases already decided, so it reacts to a slowdown a quarter or two later."
            : " USCIS does not publish a processing time for this form in these reports."}
        </Text>
        <WaitChart
          points={points}
          processingTimeSeries={processingTimeSeries}
        />
      </Stack>
      {variants.length > 1 && (
        <Stack gap="sm">
          <Title order={2}>By category, {current.label}</Title>
          <Table.ScrollContainer minWidth={640}>
            <Table striped withTableBorder>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Category</Table.Th>
                  <Table.Th ta="right">Received</Table.Th>
                  <Table.Th ta="right">Approved</Table.Th>
                  <Table.Th ta="right">Denied</Table.Th>
                  <Table.Th ta="right">Pending</Table.Th>
                  <Table.Th ta="right">USCIS median</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {variants.map((variant) => (
                  <Table.Tr key={variant.title}>
                    <Table.Td>{variant.title}</Table.Td>
                    <Table.Td ta="right">
                      {formatCount(variant.received)}
                    </Table.Td>
                    <Table.Td ta="right">
                      {formatCount(variant.approved)}
                    </Table.Td>
                    <Table.Td ta="right">
                      {formatCount(variant.denied)}
                    </Table.Td>
                    <Table.Td ta="right">
                      {formatCount(variant.pending)}
                    </Table.Td>
                    <Table.Td ta="right">
                      {formatMonths(variant.processingTime)}
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        </Stack>
      )}
      {offices.length > 0 && (
        <Stack gap="sm">
          <Title order={2}>Select your field office</Title>
          <Text>
            USCIS also publishes these numbers per office for the {form}. Your
            case is handled by the field office whose jurisdiction covers your
            home address (or by a service center). Not sure which one?{" "}
            <Anchor
              href="https://www.uscis.gov/about-us/find-a-uscis-office/field-offices"
              target="_blank"
              rel="noopener"
            >
              Look it up on USCIS&rsquo;s office locator
            </Anchor>
            .
          </Text>
          <TextInput
            size="lg"
            leftSection={<SearchIcon />}
            type="text"
            placeholder="San Francisco"
            onChange={setTerm}
          />
          <Button.Group orientation="vertical">
            {filteredOffices.map(
              ({ slug: officeSlug, name, stateCode, waitMonths }) => (
                <Button
                  size="lg"
                  variant="default"
                  key={officeSlug}
                  component={Link}
                  href={`/uscis/${slug}/${officeSlug}`}
                  classNames={{ root: classes.root, inner: classes.inner }}
                  justify="space-between"
                  rightSection={
                    <Badge
                      size="lg"
                      radius="sm"
                      variant="outline"
                      color="gray"
                      tt="none"
                      fw={500}
                    >
                      ~{formatMonths(waitMonths)}
                    </Badge>
                  }
                >
                  <Group gap="xs" wrap="nowrap">
                    <Highlight highlight={term}>{name}</Highlight>
                    {stateCode !== null && (
                      <Badge size="lg" radius="sm" color="blue" variant="light">
                        <Highlight highlight={term}>{stateCode}</Highlight>
                      </Badge>
                    )}
                  </Group>
                </Button>
              ),
            )}
          </Button.Group>
        </Stack>
      )}
    </Stack>
  );
}
