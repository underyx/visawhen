import { ChevronLeftIcon } from "../../../components/icons";
import {
  Anchor,
  Button,
  Chip,
  Group,
  Stack,
  Table,
  Text,
  Title,
} from "@mantine/core";
import { GetStaticPaths, GetStaticProps } from "next";
import Head from "next/head";
import Link from "next/link";
import React, { useId, useState } from "react";
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
  casesMovedQuarters,
  clearingSuppressed,
  compareClearing,
  formatRangeMonths,
  fourQuarterClearing,
  headlineRange,
  officeEstimateSuppressed,
  withoutMisleadingClearing,
} from "../../../components/estimate";
import { VISA_BULLETIN_URL } from "../../../components/links";
import {
  ALL_CATEGORIES,
  approximately,
  formatCount,
  formatMonths,
  highlight,
  isServiceCenter,
  NATIONAL_OFFICE_CATEGORIES,
  officeCategoryCounts,
  officeCategoryName,
  officeCategoryPoints,
  officeCategoryWho,
  openingOfficeCategory,
  QuarterPoint,
  quarterLabel,
  SERVICE_CENTER_FORMS,
  sumCounts,
  toPoints,
} from "../../../components/uscis";
import { OutcomesChart, WaitChart } from "../../../components/UscisChart";
import UscisStats, { RangeText } from "../../../components/UscisStats";

/** The office's numbers for one category of the per-office report, or for
 * all of them together (ALL_CATEGORIES). */
interface CategoryView {
  key: string;
  /** "Immediate Relative", or "All categories" */
  name: string;
  points: QuarterPoint[];
  /** The time to clear the office's backlog at the pace of its last four
   * quarters, next to the same for the whole country, or for all field
   * offices together on the field office pages of SERVICE_CENTER_FORMS;
   * null when either is unknown */
  comparison: {
    office: number;
    national: number;
    /** Whether either counts decisions USCIS withheld as too few */
    approximate: boolean;
    /** What `national` is of */
    base: "field offices" | "country";
  } | null;
  /** What a filer in this category can expect nationally: the all-forms
   * report's same category, or for all categories together the form's main
   * one. Null when the all-forms report has no such category. */
  nationalRange: CategoryRange | null;
}

interface Props {
  form: string;
  formSlug: string;
  formTitle: string;
  slug: string;
  name: string;
  stateCode: string | null;
  /** One per category the office pages of this form break down, then all
   * categories together; just the latter for most forms */
  views: CategoryView[];
  /** The view the page opens with: the category most of the office's
   * visitors are in (openingOfficeCategory) */
  defaultView: string;
  /** The quarters in which USCIS moved cases between offices, going by the
   * office's pending count of all categories together; they apply to every
   * view */
  moved: string[];
  /** The quarter of USCIS's national median, "Apr–Jun 2026" */
  nationalLabel: string;
  /** Whether some of the pending cases of all categories together wait on
   * the Visa Bulletin */
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
  const ranges = categoryRanges(form);
  const sameNationally = NATIONAL_OFFICE_CATEGORIES[form.form] ?? [];
  const total = toPoints(data.periods, office.quarters);
  // decided once for the office, so that every view agrees
  const moved = casesMovedQuarters(total);
  // the categories this office has numbers for, on forms whose pages break
  // them down
  const categories = officeCategoryPoints(data.periods, form, office.quarters);
  // A field office of a form whose service centers hold much of the pile is
  // compared with the other field offices, not with the whole country.
  const fieldOffices =
    SERVICE_CENTER_FORMS.includes(form.form) && !isServiceCenter(office.name)
      ? form.offices.filter(({ name }) => !isServiceCenter(name))
      : null;
  const view = (
    key: string,
    name: string,
    counts: QuarterPoint[],
  ): CategoryView => {
    const points = withoutMisleadingClearing(counts, moved);
    const latest = points[points.length - 1].quarter;
    const nationalPoints = toPoints(
      data.periods,
      fieldOffices === null
        ? officeCategoryCounts(form.officeTotals, key)
        : sumCounts(
            fieldOffices.map(({ quarters }) =>
              officeCategoryCounts(quarters, key),
            ),
          ),
    );
    const officeClearing = fourQuarterClearing(points, latest);
    const nationalClearing = fourQuarterClearing(nationalPoints, latest);
    return {
      key,
      name,
      points,
      comparison:
        officeClearing === null || nationalClearing === null
          ? null
          : {
              office: officeClearing.months,
              national: nationalClearing.months,
              approximate:
                officeClearing.approximate || nationalClearing.approximate,
              base: fieldOffices === null ? "country" : "field offices",
            },
      nationalRange:
        key === ALL_CATEGORIES
          ? headlineRange(ranges)
          : sameNationally.includes(key)
          ? ranges.find((range) => range.key === key) ?? null
          : null,
    };
  };
  const views = [
    ...categories.map(({ category, points }) =>
      view(category.key, officeCategoryName(category), points),
    ),
    view(ALL_CATEGORIES, "All categories", total),
  ];
  const latest = total[total.length - 1].quarter;
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
      views,
      defaultView: openingOfficeCategory(
        form.form,
        total,
        categories.map(({ category, points }) => ({
          key: category.key,
          points,
        })),
      ),
      moved,
      waitsForVisas: ranges.some(({ priorityDate }) => priorityDate),
      nationalLabel:
        nationalPeriod === undefined ? "" : quarterLabel(nationalPeriod),
      source:
        form.officeSources[latest] ??
        form.officeSources[latestQuarter(form.officeSources) ?? ""],
    },
  };
};

/** "I-130 (Immediate Relative)", or just "I-130" for all categories together */
function who(form: string, view: CategoryView): string {
  return view.key === ALL_CATEGORIES ? form : `${form} (${view.name})`;
}

/** What USCIS's national numbers say a filer in the view's category can
 * expect, as the sentence the page leads with; nothing when they say
 * nothing. */
function NationalRange({
  form,
  view,
  nationalLabel,
}: {
  form: string;
  view: CategoryView;
  nationalLabel: string;
}) {
  const range = view.nationalRange;
  if (range === null) return null;
  const rangeWho = range.name === form ? form : `${form} (${range.name})`;
  if (range.priorityDate)
    return (
      <>
        For {rangeWho} cases, the wait depends on the priority date: see the{" "}
        <Anchor href={VISA_BULLETIN_URL} target="_blank" rel="noopener" inherit>
          Visa Bulletin
        </Anchor>
        .{" "}
      </>
    );
  if (range.suppressed !== null) return null;
  return (
    <>
      Nationally, {rangeWho} filers can expect a decision in{" "}
      <RangeText low={range.q[1]} high={range.q[3]} /> if they file today, going
      by USCIS&rsquo;s median for {nationalLabel}.{" "}
      {range.shock &&
        range.shockRatio !== null &&
        `USCIS decided ${Math.round(
          (1 - range.shockRatio) * 100,
        )}% fewer of these that quarter than its average over the four before, so plan for the later end. `}
    </>
  );
}

export default function UscisOffice({
  form,
  formSlug,
  formTitle,
  slug,
  name,
  stateCode,
  views,
  defaultView,
  nationalLabel,
  moved,
  waitsForVisas,
  source,
}: Props) {
  const [selected, setSelected] = useState(defaultView);
  // one name for the category radios, so they are one group to keyboards and
  // screen readers
  const categoryInputName = useId();
  const view =
    views.find(({ key }) => key === selected) ?? views[views.length - 1];
  const { points } = view;
  const current = points[points.length - 1];
  const isTotal = view.key === ALL_CATEGORIES;
  // the office's newest quarter, which a category may have no numbers for
  const total = views[views.length - 1].points;
  const newest = total[total.length - 1];
  const backlogSuppressed = officeEstimateSuppressed(points, moved);
  // quarters the chart leaves the time to clear the backlog out of
  const clearingGaps = points.some(
    (point) => clearingSuppressed(point, moved) !== null,
  );
  const hasClearing = points.some(({ waitMonths }) => waitMonths !== null);
  const fullName = stateCode === null ? name : `${name}, ${stateCode}`;
  // "the San Francisco office", but "the Nebraska Service Center"
  const isCenter = /\bCenter$/.test(name);
  const officePhrase = isCenter ? `the ${name}` : `the ${name} office`;
  const title = `${form} processing times at ${
    isCenter ? `the ${fullName}` : `the ${fullName} office`
  }`;
  const viewWaitsForVisas = isTotal
    ? waitsForVisas
    : view.nationalRange?.priorityDate ?? false;

  // The description is of the view the page opens with, which is what
  // search engines and visitors without JavaScript see.
  const opening =
    views.find(({ key }) => key === defaultView) ?? views[views.length - 1];
  const openingCurrent = opening.points[opening.points.length - 1];
  const openingWhat =
    opening.key === ALL_CATEGORIES
      ? `${form} (${formTitle})`
      : `${form} (${opening.name})`;
  // USCIS withholds small counts; with the denials withheld, say what is known
  const decided =
    openingCurrent.completions !== null
      ? `decided ${openingCurrent.approximate ? "about " : ""}${formatCount(
          openingCurrent.completions,
        )}`
      : openingCurrent.approved !== null
      ? `approved ${formatCount(openingCurrent.approved)}`
      : null;
  const openingRange = opening.nationalRange;
  const description = `${
    isCenter ? `USCIS's ${fullName}` : `The ${fullName} USCIS office`
  } ${
    decided === null
      ? `had ${formatCount(
          openingCurrent.pending,
        )} ${openingWhat} applications pending at the end of ${
          openingCurrent.label
        }.`
      : `${decided} ${openingWhat} applications in ${
          openingCurrent.label
        } and had ${formatCount(openingCurrent.pending)} pending at its end.`
  }${
    openingRange === null ||
    openingRange.priorityDate ||
    openingRange.suppressed !== null
      ? ""
      : ` USCIS does not publish processing times per office; nationally, ${
          openingRange.name === form ? form : `${form} (${openingRange.name})`
        } filers can expect a decision in ${formatRangeMonths(
          openingRange.q[1],
          openingRange.q[3],
        )} if they file today${
          openingRange.shock ? ", likely toward the later end" : ""
        }.`
  }`;
  const canonicalUrl = `https://visawhen.com/uscis/${formSlug}/${slug}`;
  const sourceName = `${form} by Category, Case Status, and USCIS Field Office Location`;

  // Four quarters' pace on both sides, and a verdict only beyond 1.5 times
  // (compareClearing): a single quarter's pace swings too much to call one
  // office slower than the rest.
  const comparison =
    backlogSuppressed !== null || view.comparison === null
      ? null
      : `At its average pace over the four quarters to ${
          current.label
        }, ${officePhrase} would take ${approximately(
          formatMonths(view.comparison.office),
          view.comparison.approximate,
        )} to clear its backlog${isTotal ? "" : ` of these cases`}, ${
          {
            longer: "longer than",
            shorter: "shorter than",
            close: "not clearly longer or shorter than",
          }[compareClearing(view.comparison.office, view.comparison.national)]
        } the ${approximately(
          formatMonths(view.comparison.national),
          view.comparison.approximate,
        )} for ${
          view.comparison.base === "field offices"
            ? "all field offices together"
            : "the country as a whole"
        }.`;
  const whoText = isTotal ? null : officeCategoryWho(view.key);

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
        {views.length > 1 && (
          <Stack gap={6}>
            <Chip.Group
              multiple={false}
              value={view.key}
              onChange={(key) => setSelected(key)}
            >
              <Group gap="xs" role="radiogroup" aria-label="Category">
                {views.map(({ key, name: viewName }) => (
                  <Chip
                    key={key}
                    value={key}
                    variant="outline"
                    name={categoryInputName}
                  >
                    {viewName}
                  </Chip>
                ))}
              </Group>
            </Chip.Group>
            <Text size="sm" c="dimmed">
              {whoText ??
                `All categories together: ${new Intl.ListFormat("en-US").format(
                  views.slice(0, -1).map(({ name: viewName }) => viewName),
                )}.`}
            </Text>
          </Stack>
        )}
        <Text size="xl">
          USCIS does not publish processing times per office.{" "}
          <NationalRange
            form={form}
            view={view}
            nationalLabel={nationalLabel}
          />
          <Anchor component={Link} href={`/uscis/${formSlug}`} inherit>
            {view.nationalRange !== null && !view.nationalRange.priorityDate
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
            `${who(form, view)} applications`,
            backlogSuppressed === CASES_MOVED,
          )}
          {comparison !== null && ` ${comparison}`}
        </Text>
      </Stack>
      {views.length > 1 && (
        <Stack gap="sm">
          <Title order={2}>By category, {newest.label}</Title>
          <Table.ScrollContainer minWidth={560}>
            <Table striped withTableBorder>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Category</Table.Th>
                  <Table.Th ta="right">Received</Table.Th>
                  <Table.Th ta="right">Decided</Table.Th>
                  <Table.Th ta="right">Pending</Table.Th>
                  <Table.Th ta="right">Time to clear backlog</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {views.map((row) => {
                  const point = row.points.find(
                    ({ quarter }) => quarter === newest.quarter,
                  );
                  if (point === undefined) return null;
                  return (
                    <Table.Tr
                      key={row.key}
                      fw={row.key === view.key ? 700 : undefined}
                    >
                      <Table.Td>{row.name}</Table.Td>
                      <Table.Td ta="right">
                        {formatCount(point.received)}
                      </Table.Td>
                      <Table.Td ta="right">
                        {approximately(
                          formatCount(point.completions),
                          point.approximate,
                        )}
                      </Table.Td>
                      <Table.Td ta="right">
                        {formatCount(point.pending)}
                      </Table.Td>
                      <Table.Td ta="right">
                        {clearingSuppressed(point, moved) !== null
                          ? "not shown"
                          : approximately(
                              formatMonths(point.waitMonths),
                              point.approximate,
                            )}
                      </Table.Td>
                    </Table.Tr>
                  );
                })}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        </Stack>
      )}
      <Stack gap="sm">
        <Title order={2}>What happened to the applications</Title>
        <Text>
          The bars are the {who(form, view)} decisions {officePhrase} made each
          quarter, approved in blue and denied in red. The amber line is its
          backlog: how many applications were still waiting at the end of that
          quarter, most of them filed in earlier ones. The dashed line is how
          many came in.
        </Text>
        <OutcomesChart
          points={points}
          subject={who(form, view)}
          place={`at ${officePhrase}`}
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
          {viewWaitsForVisas
            ? "cases waiting for a visa number"
            : "cases USCIS cannot decide yet"}
          , and USCIS sometimes moves pending cases between offices.
          {clearingGaps &&
            ` ${
              hasClearing
                ? "The chart leaves it out for"
                : "It is not shown for"
            } quarters in which the office decided fewer than 100 ${
              isTotal ? "cases" : "of these cases"
            }, or in which its pending count${
              views.length > 1 ? ", all categories together," : ""
            } more than doubled or halved, which means USCIS moved cases between offices.`}
        </Text>
        {hasClearing && (
          <WaitChart
            points={points}
            subject={who(form, view)}
            place={`at ${officePhrase}`}
            suppressed={backlogSuppressed}
            processingTimeSeries={[]}
          />
        )}
      </Stack>
    </Stack>
  );
}
