import { ChevronLeftIcon } from "../../../components/icons";
import {
  Anchor,
  Box,
  Button,
  Chip,
  Group,
  Stack,
  Table,
  Text,
  Title,
} from "@mantine/core";
import { type GetStaticPaths, type GetStaticProps } from "next";
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
  categoryMovedQuarters,
  categoryRanges,
  type CategoryRange,
  casesMovedQuarters,
  CLEARING_COMPARISON_FACTOR,
  clearingSuppressed,
  compareClearing,
  formatRangeMonths,
  fourQuarterClearing,
  headlineRange,
  movedDirection,
  PRIORITY_DATE_CUTOFFS,
  routedQuarters,
  withoutMisleadingClearing,
} from "../../../components/estimate";
import {
  ALL_CATEGORIES,
  approximately,
  type ChartBreak,
  cleanData,
  formatCount,
  formatMonths,
  isServiceCenter,
  NATIONAL_OFFICE_CATEGORIES,
  officeCategoryCounts,
  officeCategoryName,
  officeCategoryPoints,
  officeCategoryWho,
  officePointOptions,
  openingOfficeCategory,
  type QuarterPoint,
  quarterLabel,
  rarelyApproves,
  SERVICE_CENTER_FORMS,
  sumCounts,
  toPoints,
} from "../../../components/uscis";
import { OutcomesChart, WaitChart } from "../../../components/UscisChart";
import UscisCases, { uscisCases } from "../../../components/UscisCases";
import UscisStats, { RangeText } from "../../../components/UscisStats";
import MoreDetails from "../../../components/MoreDetails";
import { PolicyNews } from "../../../components/PolicyBanner";
import { breadcrumbList } from "../../../components/structuredData";
import TemporaryNotice from "../../../components/TemporaryNotice";

/** How the field offices' piles compare with the national range, where they
 * are much longer than it suggests (fieldOfficeCaveat). */
interface FieldOfficeCaveat {
  /** The newest quarter, "Apr–Jun 2026" */
  label: string;
  /** The field offices' pending count and decisions of the category in the
   * newest quarter, and the months it would take them to clear the former
   * at the pace of the latter; the same months the quarter before */
  pending: number;
  decided: number;
  months: number;
  previousMonths: number | null;
  /** Whether their pile more than doubled that quarter: USCIS moved cases
   * to the field offices */
  moved: boolean;
  /** Field offices whose own pile would take longer than the top of the
   * most likely range to clear at their own pace, of `offices` */
  over: number;
  offices: number;
}

/** The office's numbers for one category of the per-office report, or for
 * all of them together (ALL_CATEGORIES). */
interface CategoryView {
  key: string;
  /** "Immediate Relative", or "All categories" */
  name: string;
  points: QuarterPoint[];
  /** The quarters in which USCIS moved cases in or out: those of all the
   * office's categories together, and for a category also those in which
   * its own pile more than doubled or halved (categoryMovedQuarters) */
  moved: string[];
  /** The quarters of `moved` whose receipts include new filings routed to
   * the office (routedQuarters) */
  routed: string[];
  /** Whether the office almost never approves these cases in its newest
   * quarter (rarelyApproves) */
  rarelyApproved: boolean;
  /** The time to clear the office's backlog at the pace of its last four
   * quarters, next to the same for the whole country, or for all field
   * offices together on the field office pages of SERVICE_CENTER_FORMS;
   * null when either is unknown */
  comparison: {
    office: number;
    national: number;
    /** What `national` is of */
    base: "field offices" | "country";
  } | null;
  /** What a filer in this category can expect nationally: the all-forms
   * report's same category, or for all categories together the form's main
   * one. Null when the all-forms report has no such category. */
  nationalRange: CategoryRange | null;
  /** Where the field offices' piles of this category would take much longer
   * to clear than the national range and the national pile suggest */
  caveat: FieldOfficeCaveat | null;
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
  /** The quarter of USCIS's national median, "Apr–Jun 2026" */
  nationalLabel: string;
  /** Whether some of the pending cases of all categories together wait on
   * the Visa Bulletin */
  waitsForVisas: boolean;
  source: string;
}

export const getStaticPaths: GetStaticPaths = async () => {
  const data = cleanData(await getData());
  return {
    paths: getActiveForms(data).flatMap((form) =>
      getActiveOffices(form).map((office) => ({
        params: { formSlug: form.slug, officeSlug: office.slug },
      })),
    ),
    fallback: false,
  };
};

/** The months it would take to clear a pile at a quarter's pace of
 * decisions, counting a pile nobody decided anything of as endless. */
function clearingMonths(pending: number | null, decided: number | null) {
  if (pending === null || decided === null) return null;
  if (decided === 0) return pending > 0 ? Infinity : null;
  return pending / (decided / 3);
}

export const getStaticProps: GetStaticProps<Props> = async ({ params }) => {
  if (
    params === undefined ||
    typeof params.formSlug !== "string" ||
    typeof params.officeSlug !== "string"
  )
    return { notFound: true };
  const data = cleanData(await getData());
  const form = data.forms.find(({ slug }) => slug === params.formSlug);
  const office = form?.offices.find(({ slug }) => slug === params.officeSlug);
  if (form === undefined || office === undefined) return { notFound: true };
  const ranges = categoryRanges(form);
  const sameNationally = NATIONAL_OFFICE_CATEGORIES[form.form] ?? [];
  const options = officePointOptions(form.form);
  const total = toPoints(data.periods, office.quarters, options);
  // the categories this office has numbers for, on forms whose pages break
  // them down
  const categories = officeCategoryPoints(data.periods, form, office.quarters);
  // A field office of a form whose service centers hold much of the pile is
  // compared with the other field offices, not with the whole country.
  const fieldOffices =
    SERVICE_CENTER_FORMS.includes(form.form) && !isServiceCenter(office.name)
      ? form.offices.filter(({ name }) => !isServiceCenter(name))
      : null;
  const nationalQuarter = latestQuarter(form.quarters);
  const view = (
    key: string,
    name: string,
    counts: QuarterPoint[],
  ): CategoryView => {
    const moved =
      key === ALL_CATEGORIES
        ? casesMovedQuarters(total)
        : categoryMovedQuarters(total, counts);
    const rarelyApproved = rarelyApproves(counts[counts.length - 1]);
    const points = withoutMisleadingClearing(counts).map((point, index) =>
      // no time to clear a pile the office almost never approves from
      rarelyApproved && index === counts.length - 1
        ? { ...point, waitMonths: null }
        : point,
    );
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
      options,
    );
    const officeClearing = fourQuarterClearing(points, latest);
    const nationalClearing = fourQuarterClearing(nationalPoints, latest);
    const nationalRange =
      key === ALL_CATEGORIES
        ? headlineRange(ranges, form.form)
        : sameNationally.includes(key)
          ? (ranges.find((range) => range.key === key) ?? null)
          : null;
    // The field offices' piles against the range: where they would take
    // longer to clear than both the top of the most likely range and the
    // national pile the range was calibrated on, the range understates
    // what a case at a field office is up against.
    let caveat: FieldOfficeCaveat | null = null;
    const fieldCurrent = nationalPoints[nationalPoints.length - 1];
    const fieldPrevious = nationalPoints[nationalPoints.length - 2];
    const nationalVariant = form.quarters[nationalQuarter ?? ""]?.variants.find(
      (variant) => variant.key === key,
    );
    const nationalMonths = clearingMonths(
      nationalVariant?.pending ?? null,
      nationalVariant === undefined ||
        nationalVariant.approved === null ||
        nationalVariant.denied === null
        ? null
        : nationalVariant.approved + nationalVariant.denied,
    );
    if (
      fieldOffices !== null &&
      key !== ALL_CATEGORIES &&
      nationalRange !== null &&
      !nationalRange.priorityDate &&
      nationalRange.suppressed === null &&
      fieldCurrent !== undefined &&
      fieldCurrent.quarter === latest &&
      fieldCurrent.waitMonths !== null &&
      fieldCurrent.pending !== null &&
      fieldCurrent.completions !== null &&
      nationalMonths !== null &&
      fieldCurrent.waitMonths > nationalRange.q[3] &&
      fieldCurrent.waitMonths > nationalMonths
    ) {
      const own = fieldOffices.flatMap(({ quarters }) => {
        const counts = officeCategoryCounts(quarters, key)[latest];
        if (counts === undefined) return [];
        const months = clearingMonths(
          counts.pending,
          counts.approved === null || counts.denied === null
            ? null
            : counts.approved + counts.denied,
        );
        return months === null ? [] : [months];
      });
      caveat = {
        label: fieldCurrent.label,
        pending: fieldCurrent.pending,
        decided: fieldCurrent.completions,
        months: fieldCurrent.waitMonths,
        previousMonths: fieldPrevious?.waitMonths ?? null,
        moved: casesMovedQuarters(nationalPoints).includes(latest),
        over: own.filter((months) => months > nationalRange.q[3]).length,
        offices: own.length,
      };
    }
    return {
      key,
      name,
      points,
      moved,
      routed: routedQuarters(points, moved),
      rarelyApproved,
      comparison:
        officeClearing === null || nationalClearing === null
          ? null
          : {
              office: officeClearing.months,
              national: nationalClearing.months,
              base: fieldOffices === null ? "country" : "field offices",
            },
      nationalRange,
      caveat,
    };
  };
  const views = [
    ...categories.map(({ category, points }) =>
      view(category.key, officeCategoryName(category), points),
    ),
    view(ALL_CATEGORIES, "All categories", total),
  ];
  const latest = total[total.length - 1].quarter;
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
 * expect, under the office's own figures; nothing when the numbers say
 * nothing. */
function NationalRange({ form, view }: { form: string; view: CategoryView }) {
  const range = view.nationalRange;
  if (range === null) return null;
  const rangeWho = range.name === form ? form : `${form} (${range.name})`;
  if (range.priorityDate)
    return (
      <>
        For {rangeWho} cases the wait depends on the priority date: see{" "}
        <Anchor
          component={Link}
          href={PRIORITY_DATE_CUTOFFS[range.key] ?? "/visa-bulletin"}
        >
          today&rsquo;s cutoff dates
        </Anchor>
        .{" "}
      </>
    );
  if (range.suppressed !== null) return null;
  return (
    <>
      {/* "decided in": RangeText gives months until the page knows today,
          then the months the decision most likely falls in */}
      Nationally, {rangeWho} cases filed today are most likely decided in{" "}
      <RangeText low={range.q[1]} high={range.q[3]} />.{" "}
    </>
  );
}

/** Why the national range may understate the wait: USCIS deciding far fewer
 * of these cases than usual (CategoryRange.shock), and the field offices'
 * piles being much longer than the range suggests (CategoryView.caveat). A
 * short summary, with the field offices' numbers behind "Details"; nothing
 * when neither applies. */
function RangeWarning({
  form,
  view,
  nationalLabel,
}: {
  form: string;
  view: CategoryView;
  nationalLabel: string;
}) {
  const range = view.nationalRange;
  if (range === null || range.priorityDate || range.suppressed !== null)
    return null;
  const { caveat } = view;
  const fewer =
    range.shock && range.shockRatio !== null
      ? Math.round((1 - range.shockRatio) * 100)
      : null;
  const shock =
    fewer === null
      ? null
      : `USCIS decided ${fewer}% fewer of these cases in ${nationalLabel} than its average over the four quarters before.`;
  if (shock === null && caveat === null) return null;
  // The summary stays within two sentences; with both warnings, the numbers
  // of each go behind "Details".
  const summary =
    caveat === null
      ? `USCIS decided ${fewer}% fewer of these cases in ${nationalLabel} than usual. Plan for the later end of the range.`
      : shock === null
        ? "The field offices have so many of these cases waiting that your case may take longer than this range."
        : "USCIS is deciding far fewer of these cases than usual, and the field offices have so many waiting that your case may take longer than this range.";
  return (
    <TemporaryNotice>
      <Stack gap="xs">
        <Text inherit>{summary}</Text>
        {caveat !== null && (
          <MoreDetails>
            {shock !== null && <Text size="sm">{shock}</Text>}
            <Text size="sm">
              {`${
                caveat.moved
                  ? `USCIS moved ${form} cases to the field offices in ${caveat.label}. At the end of that quarter, they`
                  : `At the end of ${caveat.label}, the field offices`
              } had ${formatCount(caveat.pending)} ${
                range.name
              } cases waiting, and they decided ${formatCount(
                caveat.decided,
              )} in the quarter. At that speed, deciding all of them would take ${formatMonths(
                caveat.months,
              )}${
                caveat.previousMonths === null
                  ? ""
                  : ` (${formatMonths(
                      caveat.previousMonths,
                    )} the quarter before)`
              }. At ${caveat.over} of the ${
                caveat.offices
              } field offices, the cases already waiting would take longer than the most likely range to decide, at that office's own speed.`}
            </Text>
          </MoreDetails>
        )}
      </Stack>
    </TemporaryNotice>
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
  const backlogSuppressed = clearingSuppressed(current);
  const moved = movedDirection(points, view.moved, current.quarter);
  // quarters the chart leaves the time to clear the backlog out of
  const clearingGaps = points.some(
    (point) => clearingSuppressed(point) !== null,
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
    : (view.nationalRange?.priorityDate ?? false);
  // the lines on the charts at the quarters in which USCIS moved cases
  const breaks: ChartBreak[] = view.moved.flatMap((quarter) => {
    const point = points.find((candidate) => candidate.quarter === quarter);
    const direction = movedDirection(points, view.moved, quarter);
    if (point === undefined || direction === null) return [];
    return [
      {
        quarter,
        label:
          direction === "out"
            ? "cases moved out"
            : view.routed.includes(quarter)
              ? "cases moved or routed in"
              : "cases moved in",
        text: `In ${point.label}, USCIS moved ${isTotal ? "" : "these "}cases ${
          direction === "in" ? "to" : "away from"
        } ${officePhrase}${
          view.routed.includes(quarter)
            ? " and routed new filings here, which the filings line counts"
            : ""
        }: its pile, and the time to clear it, changed for that reason, not because the office sped up or fell behind.`,
      },
    ];
  });

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
        }${
          opening.caveat === null
            ? ""
            : `, though the field offices' piles would now take ${formatMonths(
                opening.caveat.months,
              )} to clear at their pace`
        }.`
  }`;
  const canonicalUrl = `https://visawhen.com/uscis/${formSlug}/${slug}`;
  const sourceName = `${form} by Category, Case Status, and USCIS Field Office Location`;

  // Four quarters' pace on both sides, and a verdict only beyond 1.5 times
  // (compareClearing): a single quarter's pace swings too much to call one
  // office slower than the rest. The verdict alone, in plain words: the
  // months at a four-quarter pace read as a wait, and during a slowdown
  // they are far shorter than the pile at the current pace (the cards).
  const comparisonBase =
    view.comparison?.base === "field offices"
      ? "all field offices together"
      : "the country as a whole";
  const comparison =
    backlogSuppressed !== null ||
    moved !== null ||
    view.rarelyApproved ||
    view.comparison === null
      ? null
      : `Over the last four quarters, ${
          isCenter ? "this center" : "this office"
        } has cleared its pile${isTotal ? "" : " of these cases"} ${
          {
            longer: "clearly slower than",
            shorter: "clearly faster than",
            close: "about as fast as",
          }[compareClearing(view.comparison.office, view.comparison.national)]
        } ${comparisonBase}.`;
  const cases = uscisCases({
    views: views.map(({ key, name: viewName }) => ({
      name: viewName,
      who: officeCategoryWho(key),
    })),
    form,
    // the categories' own national ranges: all categories together
    // borrows the form's main one, which is never a priority-date category
    ranges: views.flatMap(({ key, nationalRange }) =>
      key === ALL_CATEGORIES || nationalRange === null ? [] : [nationalRange],
    ),
    rarelyApproved: view.rarelyApproved,
  });

  return (
    <Stack gap="xl">
      <Head>
        <title>{title}</title>
        <meta name="description" content={description} />
        <link rel="canonical" href={canonicalUrl} />
        <meta property="og:title" content={title} />
        <meta property="og:description" content={description} />
        <meta property="og:url" content={canonicalUrl} />
        <script
          {...breadcrumbList([
            { name: "USCIS", path: "/uscis" },
            { name: form, path: `/uscis/${formSlug}` },
            { name: fullName, path: `/uscis/${formSlug}/${slug}` },
          ])}
        />
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
        <Box>
          <Title order={1}>
            {form} processing at {fullName}
          </Title>
          <Text size="lg">
            USCIS&rsquo;s own quarterly numbers for this office. Newest:{" "}
            {current.label}.
          </Text>
        </Box>
        {views.length > 1 && (
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
        )}
        <UscisStats
          points={points}
          backlogSuppressed={backlogSuppressed}
          moved={moved}
          rarelyApproved={view.rarelyApproved}
        />
        {comparison !== null && <Text>{comparison}</Text>}
        <Stack gap="xs" className="vw-rows">
          <PolicyNews page={`/uscis/${formSlug}`} />
          <UscisCases cases={cases} />
        </Stack>
        {/* The national range comes after the office's own figures, which
            the page is for; the warning that it may understate the wait
            stays an open slip under it */}
        <Text>
          USCIS publishes no times per office.{" "}
          <NationalRange form={form} view={view} />
          <Anchor component={Link} href={`/uscis/${formSlug}`}>
            {view.nationalRange !== null && !view.nationalRange.priorityDate
              ? "See the national ranges"
              : `See the national ${form} numbers`}
          </Anchor>
          .
        </Text>
        <RangeWarning form={form} view={view} nationalLabel={nationalLabel} />
      </Stack>
      {views.length > 1 && (
        <Stack gap="sm">
          <Title order={2}>By category, {newest.label}</Title>
          <Table.ScrollContainer minWidth={560} className="vw-sticky-column">
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
                  const rowMoved = movedDirection(
                    row.points,
                    row.moved,
                    point.quarter,
                  );
                  return (
                    <Table.Tr
                      key={row.key}
                      fw={row.key === view.key ? 700 : undefined}
                    >
                      <Table.Td>{row.name}</Table.Td>
                      <Table.Td ta="right">
                        {formatCount(point.received)}
                        {row.routed.includes(point.quarter) && (
                          <Text size="xs" c="dimmed">
                            incl. filings routed here
                          </Text>
                        )}
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
                        {row.rarelyApproved
                          ? "not shown: almost none approved"
                          : clearingSuppressed(point) !== null
                            ? "not shown: too few decisions"
                            : approximately(
                                formatMonths(point.waitMonths),
                                point.approximate,
                              )}
                        {rowMoved !== null &&
                          !row.rarelyApproved &&
                          clearingSuppressed(point) === null && (
                            <Text size="xs" c="dimmed">
                              {rowMoved === "in"
                                ? "incl. cases moved or routed here"
                                : "after cases moved away"}
                            </Text>
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
        <OutcomesChart
          points={points}
          subject={who(form, view)}
          place={`at ${officePhrase}`}
          source={source}
          sourceName={sourceName}
          breaks={breaks}
          routed={view.routed}
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
          .
        </Text>
        {(breaks.length > 0 || clearingGaps || comparison !== null) && (
          <MoreDetails label="How to read the chart">
            <Text size="sm">
              USCIS sometimes moves pending cases between offices.
              {breaks.length > 0 &&
                " A dashed line marks a quarter in which it did: the pile, and the time to clear it, then include the cases moved in (or leave out those moved away), so they don't show the office falling behind or catching up."}
              {clearingGaps &&
                ` ${
                  hasClearing
                    ? "The chart leaves it out for"
                    : "It is not shown for"
                } quarters in which the office decided fewer than 100 ${
                  isTotal ? "cases" : "of these cases"
                }.`}
              {comparison !== null &&
                ` The line under the boxes on the office’s pace compares the time to clear its pile at the pace of its last four quarters with the same for ${comparisonBase}; it says slower or faster only where one is more than ${CLEARING_COMPARISON_FACTOR} times the other.`}
            </Text>
          </MoreDetails>
        )}
        {hasClearing && (
          <WaitChart
            points={points}
            subject={who(form, view)}
            place={`at ${officePhrase}`}
            suppressed={backlogSuppressed}
            processingTimeSeries={[]}
            breaks={breaks}
          />
        )}
      </Stack>
    </Stack>
  );
}
