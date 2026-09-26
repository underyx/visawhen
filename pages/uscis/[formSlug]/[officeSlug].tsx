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
  categoryMovedQuarters,
  categoryRanges,
  CategoryRange,
  casesMovedQuarters,
  clearingSuppressed,
  compareClearing,
  formatRangeMonths,
  fourQuarterClearing,
  headlineRange,
  movedDirection,
  routedQuarters,
  withoutMisleadingClearing,
} from "../../../components/estimate";
import { VISA_BULLETIN_URL } from "../../../components/links";
import {
  ALL_CATEGORIES,
  CHART_QUARTERS,
  approximately,
  ChartBreak,
  cleanData,
  formatCount,
  formatMonths,
  highlight,
  isServiceCenter,
  NATIONAL_OFFICE_CATEGORIES,
  officeCategoryCounts,
  officeCategoryName,
  officeCategoryPoints,
  officeCategoryWho,
  officePointOptions,
  openingOfficeCategory,
  QuarterPoint,
  quarterLabel,
  rarelyApproves,
  SERVICE_CENTER_FORMS,
  sumCounts,
  toPoints,
} from "../../../components/uscis";
import { OutcomesChart, WaitChart } from "../../../components/UscisChart";
import UscisStats, { RangeText } from "../../../components/UscisStats";
import PolicyBanner from "../../../components/PolicyBanner";

/** How the field offices' piles compare with the national range, where they
 * are much longer than it suggests (fieldOfficeCaveat). */
interface FieldOfficeCaveat {
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
        ? ranges.find((range) => range.key === key) ?? null
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
 * expect, as the sentence the page leads with, and how the field offices'
 * piles compare with it when they are much longer (CategoryView.caveat);
 * nothing when the numbers say nothing. */
function NationalRange({
  form,
  view,
  nationalLabel,
  newestLabel,
}: {
  form: string;
  view: CategoryView;
  nationalLabel: string;
  newestLabel: string;
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
  const { caveat } = view;
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
      {caveat !== null && (
        <strong>
          {`But the field offices' piles are now much longer than that suggests: ${
            caveat.moved
              ? `after USCIS moved ${form} cases to the field offices in ${newestLabel}, `
              : ""
          }they had ${formatCount(caveat.pending)} ${
            range.name
          } cases pending and decided ${formatCount(
            caveat.decided,
          )} that quarter, ${formatMonths(caveat.months)}' worth at that pace${
            caveat.previousMonths === null
              ? ""
              : ` (${formatMonths(caveat.previousMonths)} the quarter before)`
          }. At ${caveat.over} of ${
            caveat.offices
          } field offices, the pile would take longer than the top of the most likely range to clear at the office's own pace. `}
        </strong>
      )}
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
    : view.nationalRange?.priorityDate ?? false;
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

  // The quarters of routed filings the chart shows at first, the only ones
  // the text under it names, as for its dashed lines (the Vermont Service
  // Center's I-485s were routed in Jan-Mar 2017, before the chart's six
  // years); older ones keep their mark in the chart's tooltip.
  const routedShown = points
    .slice(-CHART_QUARTERS)
    .filter(({ quarter }) => view.routed.includes(quarter));

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
  // office slower than the rest. The verdict alone: the months at a
  // four-quarter pace read as a wait, and during a slowdown they are far
  // shorter than the pile at the current pace (the cards).
  const comparison =
    backlogSuppressed !== null ||
    moved !== null ||
    view.rarelyApproved ||
    view.comparison === null
      ? null
      : `Going by its average pace over the four quarters to ${
          current.label
        }, ${officePhrase}'s backlog${
          isTotal ? "" : " of these cases"
        } would take ${
          {
            longer: "clearly longer to clear than",
            shorter: "clearly less time to clear than",
            close:
              "about as long to clear as, not clearly longer or shorter than,",
          }[compareClearing(view.comparison.office, view.comparison.national)]
        } ${
          view.comparison.base === "field offices"
            ? "that of all field offices together"
            : "that of the country as a whole"
        }.`;
  const whoText = isTotal ? null : officeCategoryWho(view.key);
  // "The Vermont Service Center", "The Houston office"
  const OfficePhrase = `T${officePhrase.slice(1)}`;

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
        <PolicyBanner page={`/uscis/${formSlug}`} />
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
            newestLabel={newest.label}
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
        <UscisStats
          points={points}
          backlogSuppressed={backlogSuppressed}
          moved={moved}
          rarelyApproved={view.rarelyApproved}
        />
        {view.rarelyApproved && (
          <Text>
            {`${OfficePhrase} approved ${formatCount(
              current.approved,
            )} of the ${formatCount(current.completions)} ${who(
              form,
              view,
            )} cases it decided in ${
              current.label
            }. An office that almost never approves a kind of case is usually screening or holding it, and such cases are normally transferred to another office to be decided, so its approval rate and its pace say little about how long one takes.`}
          </Text>
        )}
        <Text>
          <strong>Quarter-over-quarter highlight:</strong>{" "}
          {highlight(
            points,
            officePhrase,
            `${who(form, view)} applications`,
            moved,
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
        <Text>
          The bars are the {who(form, view)} decisions {officePhrase} made each
          quarter, approved in blue and denied in red. The amber line is its
          backlog: how many applications were still waiting at the end of that
          quarter, most of them filed in earlier ones. The dashed line is how
          many came in
          {routedShown.length > 0
            ? `, which in ${new Intl.ListFormat("en-US").format(
                routedShown.map(({ label }) => label),
              )} includes new filings USCIS routed here from elsewhere rather than filed with the office`
            : ""}
          .
        </Text>
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
          , and USCIS sometimes moves pending cases between offices.
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
        </Text>
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
