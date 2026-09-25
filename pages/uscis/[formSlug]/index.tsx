import { ChevronLeftIcon, SearchIcon } from "../../../components/icons";
import {
  Alert,
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
import { sortBy } from "lodash";
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
  categoryRanges,
  CategoryRange,
  clearingSuppressed,
  formatMedian,
  formatRangeMonths,
  headlineRange,
  VISA_BULLETIN_URL,
  withoutMisleadingClearing,
} from "../../../components/estimate";
import {
  approximately,
  formatCount,
  highlight,
  lastMedianLabel,
  LEADING_OFFICE_CATEGORY,
  officeCategoryName,
  officeCategoryPoints,
  openingOfficeCategory,
  processingTimeSeries,
  ProcessingTimeSeries,
  QuarterPoint,
  toPoints,
} from "../../../components/uscis";
import { OutcomesChart, WaitChart } from "../../../components/UscisChart";
import UscisStats, { RangeText } from "../../../components/UscisStats";
import { ListRow, ListRows } from "../../../components/ListRow";
import { normalize } from "../../../components/search";

interface OfficeSummary {
  slug: string;
  name: string;
  stateCode: string | null;
  /** The category the rest are for, when it is not the form's leading one
   * (Props.officeCategory): the office's main category, at an office that
   * handles few of the leading one (openingOfficeCategory) */
  category: string | null;
  pending: number | null;
  /** Decisions in the office's newest quarter */
  completions: number | null;
  /** Whether `completions` counts a number USCIS withheld as too small */
  approximate: boolean;
  /** Approvals in it, for when USCIS did not publish the denials */
  approved: number | null;
}

interface Props {
  form: string;
  slug: string;
  title: string;
  points: QuarterPoint[];
  variants: Variant[];
  processingTimeSeries: ProcessingTimeSeries[];
  /** The quarter of USCIS's last median, when it has stopped publishing one */
  lastMedian: string | null;
  /** What to expect if filing today, per category with a USCIS median */
  ranges: CategoryRange[];
  source: string;
  offices: OfficeSummary[];
  /** The category the office numbers are for unless an office says
   * otherwise, "Immediate Relative"; null for all categories together */
  officeCategory: string | null;
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
  const points = withoutMisleadingClearing(
    toPoints(data.periods, form.quarters),
  );
  const latest = points[points.length - 1];
  const variants = form.quarters[latest.quarter].variants;
  // the office list shows the category each office's page opens with
  const officeCategory = (form.officeCategories ?? []).find(
    ({ key }) => key === LEADING_OFFICE_CATEGORY[form.form],
  );
  return {
    props: {
      form: form.form,
      slug: form.slug,
      title: form.title,
      points,
      variants,
      processingTimeSeries: processingTimeSeries(points, form),
      lastMedian: lastMedianLabel(points),
      ranges: categoryRanges(form),
      source: form.sources[latest.quarter],
      offices: getActiveOffices(form).map((office) => {
        const total = toPoints(data.periods, office.quarters);
        const categories = officeCategoryPoints(
          data.periods,
          form,
          office.quarters,
        );
        const key = openingOfficeCategory(
          form.form,
          total,
          categories.map(({ category, points }) => ({
            key: category.key,
            points,
          })),
        );
        const opening = categories.find(({ category }) => category.key === key);
        const officePoints = opening?.points ?? total;
        const current = officePoints[officePoints.length - 1];
        return {
          slug: office.slug,
          name: office.name,
          stateCode: office.stateCode,
          category:
            officeCategory === undefined || key === officeCategory.key
              ? null
              : opening === undefined
              ? "all categories"
              : officeCategoryName(opening.category),
          pending: current?.pending ?? null,
          completions: current?.completions ?? null,
          approximate: current?.approximate ?? false,
          approved: current?.approved ?? null,
        };
      }),
      officeCategory:
        officeCategory === undefined
          ? null
          : officeCategoryName(officeCategory),
    },
  };
};

export default function UscisForm({
  form,
  slug,
  title,
  points,
  variants,
  processingTimeSeries,
  lastMedian,
  ranges,
  source,
  offices,
  officeCategory,
}: Props) {
  const [term, setTerm] = useInputState("");
  const current = points[points.length - 1];
  const headline = headlineRange(ranges);
  // whether any category gets a range, not just a reason why not
  const hasRange = ranges.some(
    ({ priorityDate, suppressed }) => !priorityDate && suppressed === null,
  );
  const backlogSuppressed = clearingSuppressed(current);
  // quarters the chart leaves the time to clear the backlog out of
  const clearingGaps = points.some(
    (point) => clearingSuppressed(point) !== null,
  );
  const hasClearing = points.some(({ waitMonths }) => waitMonths !== null);
  const filteredOffices = useMemo<OfficeSummary[]>(() => {
    const normalizedTerm = normalize(term);
    return sortBy(
      offices.filter(({ name, stateCode }) =>
        normalize(`${name} ${stateCode ?? ""}`).includes(normalizedTerm),
      ),
      [({ pending }) => -(pending ?? 0), "name"],
    );
  }, [offices, term]);

  // "an I-130", "an N-400", "a G-325A"
  const article = /^[AEFHILMNORSX]/.test(form) ? "an" : "a";
  const headlineWhat =
    headline === null || headline.name === form
      ? form
      : `${form} (${headline.name})`;
  const pageTitle =
    headline === null
      ? `${form} processing times (${current.label} data)`
      : `${form} processing time: ${formatRangeMonths(
          headline.q[1],
          headline.q[3],
        )}${headline.name === form ? "" : ` for ${headline.name}`} (${
          current.label
        } data)`;
  const description =
    headline === null
      ? `USCIS had ${formatCount(
          current.pending,
        )} ${form} (${title}) applications pending at the end of ${
          current.label
        }${
          current.completions === null
            ? "."
            : ` and decided ${current.approximate ? "about " : ""}${formatCount(
                current.completions,
              )} that quarter.`
        }`
      : `If you file ${article} ${headlineWhat} today, USCIS will most likely decide it in ${formatRangeMonths(
          headline.q[1],
          headline.q[3],
        )}; it could take ${formatRangeMonths(
          headline.q[0],
          headline.q[4],
        )}. Based on USCIS's ${headline.median.toFixed(1)}-month median for ${
          current.label
        }.`;
  const shocked = ranges.filter(
    ({ shock, shockRatio, priorityDate, suppressed }) =>
      shock && shockRatio !== null && !priorityDate && suppressed === null,
  );
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
        <UscisStats
          points={points}
          headline={headline}
          backlogSuppressed={backlogSuppressed}
        />
        <Text>
          <strong>Quarter-over-quarter highlight:</strong>{" "}
          {highlight(points, "USCIS", `${form} applications`)}
        </Text>
      </Stack>
      {ranges.length > 0 && (
        <Stack gap="sm">
          <Title order={2}>If you file today</Title>
          <Text>
            {hasRange
              ? `How long ${article} ${form} filed today is likely to take, by category. In past quarters, the typical wait landed in the most likely range about half the time, and in the could-be range 8 times in 10.`
              : `USCIS's median processing time for each category of the ${form}, and why there is no range for it.`}
          </Text>
          <Table.ScrollContainer minWidth={300}>
            <Table striped withTableBorder horizontalSpacing={6}>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Category</Table.Th>
                  <Table.Th>Most likely (50%)</Table.Th>
                  <Table.Th>Could be (80%)</Table.Th>
                  <Table.Th ta="right">USCIS median</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {ranges.map((range) => (
                  <Table.Tr key={range.key}>
                    <Table.Td>{range.name}</Table.Td>
                    {range.priorityDate ? (
                      <Table.Td colSpan={3}>
                        Depends on your priority date: see the{" "}
                        <Anchor
                          href={VISA_BULLETIN_URL}
                          target="_blank"
                          rel="noopener"
                          inherit
                        >
                          Visa Bulletin
                        </Anchor>
                        .
                        <Text size="sm" c="dimmed">
                          USCIS median for decided cases:{" "}
                          {formatMedian(range.median)}
                        </Text>
                      </Table.Td>
                    ) : (
                      <>
                        {range.suppressed === "too few decisions" ? (
                          <Table.Td colSpan={2}>
                            Too few decisions last quarter to estimate
                          </Table.Td>
                        ) : range.suppressed === "nearly stopped" ? (
                          <Table.Td colSpan={2}>
                            USCIS has nearly stopped deciding these:{" "}
                            {Math.round((1 - (range.shockRatio ?? 0)) * 100)}%
                            fewer decisions last quarter than its average over
                            the four before
                          </Table.Td>
                        ) : (
                          <>
                            <Table.Td>
                              <RangeText low={range.q[1]} high={range.q[3]} />
                            </Table.Td>
                            <Table.Td>
                              <RangeText low={range.q[0]} high={range.q[4]} />
                            </Table.Td>
                          </>
                        )}
                        <Table.Td ta="right">
                          {formatMedian(range.median)}
                        </Table.Td>
                      </>
                    )}
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
          {shocked.length > 0 && (
            <Alert color="yellow">
              USCIS decided{" "}
              {new Intl.ListFormat("en-US").format(
                shocked.map(
                  ({ name, shockRatio }) =>
                    `${Math.round(
                      (1 - (shockRatio ?? 1)) * 100,
                    )}% fewer ${name} cases`,
                ),
              )}{" "}
              in {current.label} than{" "}
              {shocked.length === 1 ? "its average" : "their averages"} over the
              previous four quarters. We widen the range when this happens, but
              in past slowdowns like this the typical wait landed in the
              could-be range only about 2 times in 3 (8 in 10 normally), so plan
              for the later end.
            </Alert>
          )}
        </Stack>
      )}
      <Stack gap="sm">
        <Title order={2}>What happened to the applications</Title>
        <Text>
          The bars are the {form} decisions USCIS made each quarter, approved in
          blue and denied in red. The amber line is the backlog: how many
          applications were still waiting at the end of that quarter, most of
          them filed in earlier ones. The dashed line is how many came in.
        </Text>
        <OutcomesChart
          points={points}
          source={source}
          sourceName={sourceName}
        />
      </Stack>
      {(hasClearing || processingTimeSeries.length > 0) && (
        <Stack gap="sm">
          <Title order={2}>
            {processingTimeSeries.length > 0
              ? "USCIS median and backlog over time"
              : "Backlog over time"}
          </Title>
          <Text>
            {hasRange &&
              "The range starts from USCIS's own median processing time for your category and widens it by how far real waits have landed from that median in past quarters. "}
            Time to clear backlog is how long USCIS would need to decide every
            pending case at last quarter&rsquo;s pace. It is not your wait: the
            pile includes cases on hold and{" "}
            {ranges.some(({ priorityDate }) => priorityDate)
              ? "cases waiting for a visa number"
              : "cases USCIS cannot decide yet"}
            .
            {clearingGaps &&
              " The chart leaves it out for quarters in which USCIS decided fewer than 100, too few to divide by."}
            {processingTimeSeries.length === 0
              ? " USCIS does not publish a processing time for this form in these reports."
              : lastMedian !== null &&
                ` USCIS has not published a median for this form since ${lastMedian}.`}
          </Text>
          <WaitChart
            points={points}
            processingTimeSeries={processingTimeSeries}
          />
        </Stack>
      )}
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
                  <Table.Tr key={variant.key}>
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
                      {variant.processingTime === null
                        ? "n/a"
                        : formatMedian(variant.processingTime)}
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
            {officeCategory !== null &&
              ` Next to each office is how many ${form} (${officeCategory}) cases it decided in the newest quarter${
                offices.some(({ category }) => category !== null)
                  ? "; for an office that handles few of those, the count is of its main category, named next to it"
                  : ""
              }. The office pages show every category.`}
          </Text>
          <TextInput
            size="lg"
            leftSection={<SearchIcon />}
            type="text"
            placeholder="San Francisco"
            onChange={setTerm}
          />
          <ListRows>
            {filteredOffices.map(
              ({
                slug: officeSlug,
                name,
                stateCode,
                category,
                completions,
                approximate,
                approved,
              }) => (
                <ListRow
                  key={officeSlug}
                  href={`/uscis/${slug}/${officeSlug}`}
                  rightSection={
                    // with the denials unpublished, the approvals are all
                    // there is to show
                    (completions !== null || approved !== null) && (
                      <Badge
                        size="lg"
                        radius="sm"
                        variant="outline"
                        color="gray"
                        tt="none"
                        fw={500}
                      >
                        {`${
                          completions !== null
                            ? `${approximately(
                                formatCount(completions),
                                approximate,
                              )} decided`
                            : `${formatCount(approved)} approved`
                        }${category === null ? "" : ` · ${category}`}`}
                      </Badge>
                    )
                  }
                  label={
                    <Group gap="xs">
                      <Highlight highlight={term}>{name}</Highlight>
                      {stateCode !== null && (
                        <Badge
                          size="lg"
                          radius="sm"
                          color="blue"
                          variant="light"
                        >
                          <Highlight highlight={term}>{stateCode}</Highlight>
                        </Badge>
                      )}
                    </Group>
                  }
                />
              ),
            )}
          </ListRows>
        </Stack>
      )}
    </Stack>
  );
}
