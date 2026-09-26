import { ChevronLeftIcon, SearchIcon } from "../../../components/icons";
import {
  Alert,
  Anchor,
  Badge,
  Button,
  Chip,
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
import React, { useId, useMemo, useState } from "react";
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
  PREMIUM_PROCESSING,
  PRIORITY_DATE_TEXT,
  withoutMisleadingClearing,
} from "../../../components/estimate";
import { VISA_BULLETIN_URL } from "../../../components/links";
import { RELATED_FORMS } from "../../../components/relatedForms";
import {
  ALL_CATEGORIES,
  approximately,
  cleanData,
  formatCount,
  formViews,
  FormView,
  highlight,
  LEADING_OFFICE_CATEGORY,
  officeCategoryName,
  officeCategoryPoints,
  officeCategoryWho,
  officePointOptions,
  openingOfficeCategory,
  quarterLabel,
  republishedMedianQuarters,
  toPoints,
} from "../../../components/uscis";
import { OutcomesChart, WaitChart } from "../../../components/UscisChart";
import UscisStats, { RangeText } from "../../../components/UscisStats";
import MoreDetails from "../../../components/MoreDetails";
import PolicyBanner from "../../../components/PolicyBanner";
import { ListRow, ListRows } from "../../../components/ListRow";
import { normalize } from "../../../components/search";
import SearchStatus from "../../../components/SearchStatus";

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
  /** One per category of the form, the one the page is about first, then
   * all categories together; just the latter for a form with one category */
  views: FormView[];
  variants: Variant[];
  /** What to expect if filing today, per category with a USCIS median */
  ranges: CategoryRange[];
  /** The range the page leads with (headlineRange) */
  headline: CategoryRange | null;
  source: string;
  offices: OfficeSummary[];
  /** The quarter of the offices' numbers, "Apr–Jun 2026" */
  officeLabel: string | null;
  /** The category the office numbers are for unless an office says
   * otherwise, "Immediate Relative"; null for all categories together */
  officeCategory: string | null;
  /** The quarters whose medians repeat the quarter before's, which the
   * charts leave out (republishedMedianQuarters) */
  republished: { quarter: string; label: string }[];
}

/** What to know about a form's approval rate, where USCIS's counts are not
 * what the words suggest. */
const APPROVAL_NOTES: Record<string, string> = {
  "I-589":
    "About the approval rate: it is the share of USCIS's own decisions that granted asylum, not the share of applicants who get asylum in the end. When an asylum office does not grant asylum to someone without legal status, it usually sends the case to an immigration court, and USCIS's report does not say if it counts these as denials.",
};

export const getStaticPaths: GetStaticPaths = async () => {
  const data = cleanData(await getData());
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
  const raw = await getData();
  const data = cleanData(raw);
  const form = data.forms.find(({ slug }) => slug === params.formSlug);
  if (form === undefined) return { notFound: true };
  const republished = republishedMedianQuarters(raw).flatMap((quarter) => {
    const period = data.periods.find((p) => p.quarter === quarter);
    return period === undefined
      ? []
      : [{ quarter, label: quarterLabel(period) }];
  });
  const views = formViews(data.periods, form).map((view) => ({
    ...view,
    points: withoutMisleadingClearing(view.points),
  }));
  const total = views[views.length - 1].points;
  const latest = total[total.length - 1];
  const variants = form.quarters[latest.quarter].variants;
  const ranges = categoryRanges(form);
  // the office list shows the category each office's page opens with
  const officeCategory = (form.officeCategories ?? []).find(
    ({ key }) => key === LEADING_OFFICE_CATEGORY[form.form],
  );
  const offices = getActiveOffices(form).map((office) => {
    const officeTotal = toPoints(
      data.periods,
      office.quarters,
      officePointOptions(form.form),
    );
    const categories = officeCategoryPoints(
      data.periods,
      form,
      office.quarters,
    );
    const key = openingOfficeCategory(
      form.form,
      officeTotal,
      categories.map(({ category, points }) => ({
        key: category.key,
        points,
      })),
    );
    const opening = categories.find(({ category }) => category.key === key);
    const officePoints = opening?.points ?? officeTotal;
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
      label: current?.label ?? null,
    };
  });
  return {
    props: {
      form: form.form,
      slug: form.slug,
      title: form.title,
      views,
      variants,
      ranges,
      headline: headlineRange(ranges, form.form),
      source: form.sources[latest.quarter],
      offices: offices.map(({ label: _label, ...office }) => office),
      officeLabel: offices.find(({ label }) => label !== null)?.label ?? null,
      officeCategory:
        officeCategory === undefined
          ? null
          : officeCategoryName(officeCategory),
      republished,
    },
  };
};

/** "I-130 (Immediate Relative)", or "I-130 (all categories)" when the form
 * has several, or just "I-130" */
function who(form: string, view: FormView, views: FormView[]): string {
  if (views.length === 1) return form;
  return view.key === ALL_CATEGORIES
    ? `${form} (all categories)`
    : `${form} (${view.name})`;
}

/** The meta description of a form with no range: what USCIS's newest
 * quarter says of its pile and its decisions, leaving out a count USCIS did
 * not publish (the I-870's, I-899's, I-956G's and I-956H's pending) rather
 * than calling it "n/a". */
function describeCounts(
  what: string,
  {
    label,
    pending,
    completions,
    approximate,
  }: {
    label: string;
    pending: number | null;
    completions: number | null;
    approximate: boolean;
  },
): string {
  const decided =
    completions === null
      ? null
      : `${approximate ? "about " : ""}${formatCount(completions)}`;
  if (pending !== null)
    return `USCIS had ${formatCount(
      pending,
    )} ${what} applications pending at the end of ${label}${
      decided === null ? "." : ` and decided ${decided} that quarter.`
    }`;
  // USCIS's "-" in its decisions columns, which its report says represents
  // zero: the I-956G's and I-956H's in every quarter
  if (completions === 0)
    return `USCIS's report for ${label} gives no decisions on ${what} applications, and no count of those pending.`;
  if (decided !== null)
    return `USCIS decided ${decided} ${what} applications in ${label}; it did not publish how many were pending.`;
  return `USCIS published neither how many ${what} applications it decided in ${label} nor how many were pending.`;
}

export default function UscisForm({
  form,
  slug,
  title,
  views,
  variants,
  ranges,
  headline,
  source,
  offices,
  officeLabel,
  officeCategory,
  republished,
}: Props) {
  const [term, setTerm] = useInputState("");
  const [selected, setSelected] = useState(views[0].key);
  // one name for the category radios, so they are one group to keyboards and
  // screen readers
  const categoryInputName = useId();
  const view = views.find(({ key }) => key === selected) ?? views[0];
  const { points } = view;
  const current = points[points.length - 1];
  const isTotal = view.key === ALL_CATEGORIES;
  // the newest quarter of the form, which a category may have no numbers for
  const totalPoints = views[views.length - 1].points;
  const newest = totalPoints[totalPoints.length - 1];
  const opening = views[0].points[views[0].points.length - 1];
  const related = RELATED_FORMS[form];
  // the view's own range, when it has one: the headline for a form with one
  // category, none for all categories together
  const viewRange =
    views.length === 1
      ? headline
      : ranges.find(
          (range) =>
            range.key === view.key &&
            !range.priorityDate &&
            range.suppressed === null,
        ) ?? null;
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
    // by the number each row shows: its decisions (or approvals)
    return sortBy(
      offices.filter(({ name, stateCode }) =>
        normalize(`${name} ${stateCode ?? ""}`).includes(normalizedTerm),
      ),
      [({ completions, approved }) => -(completions ?? approved ?? 0), "name"],
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
      ? `${form} processing times (${newest.label} data)`
      : `${form} processing time: ${formatRangeMonths(
          headline.q[1],
          headline.q[3],
        )}${headline.name === form ? "" : ` for ${headline.name}`} (${
          newest.label
        } data)`;
  // "I-130 (Immediate Relative)", or "I-589 (Application for Asylum ...)"
  const openingWhat =
    views.length > 1 ? who(form, views[0], views) : `${form} (${title})`;
  const description =
    headline === null
      ? describeCounts(openingWhat, opening)
      : `If you file ${article} ${headlineWhat} today, USCIS will most likely decide it in ${formatRangeMonths(
          headline.q[1],
          headline.q[3],
        )}; it could take ${formatRangeMonths(
          headline.q[0],
          headline.q[4],
        )}. Based on USCIS's ${headline.median.toFixed(1)}-month median for ${
          newest.label
        }${
          headline.premium ? ", premium and regular processing together" : ""
        }.`;
  const shocked = ranges.filter(
    ({ shock, shockRatio, priorityDate, suppressed }) =>
      shock && shockRatio !== null && !priorityDate && suppressed === null,
  );
  const premium = PREMIUM_PROCESSING[form];
  const canonicalUrl = `https://visawhen.com/uscis/${slug}`;
  const sourceName = "All USCIS Application and Petition Form Types";
  const viewWho = who(form, view, views);
  const otherNames = views.slice(0, -1).map(({ name }) => name);
  const whoText = isTotal
    ? `${
        otherNames.length === 2 ? "Both" : `All ${otherNames.length}`
      } categories together: ${new Intl.ListFormat("en-US").format(
        otherNames,
      )}. Their queues move at different speeds, so this is nobody's own queue: pick your category to see yours.`
    : officeCategoryWho(view.key) ??
      variants.find(({ key }) => key === view.key)?.title ??
      null;

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
        {/* overflowWrap: a title such as the I-899's "Determination/Reasonable"
            is one word wider than a phone */}
        <Title order={1} style={{ overflowWrap: "anywhere" }}>
          {form} processing times
          <Text component="span" inherit c="dimmed">
            {" "}
            · {title}
          </Text>
        </Title>
        <PolicyBanner page={`/uscis/${slug}`} />
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
            {whoText !== null && (
              <Text size="sm" c="dimmed">
                {whoText}
              </Text>
            )}
          </Stack>
        )}
        <Text size="xl">
          Latest USCIS data: {newest.label}, from the{" "}
          <Anchor href={source} target="_blank" rel="noopener">
            {sourceName}
          </Anchor>{" "}
          report.
        </Text>
        <UscisStats
          points={points}
          headline={viewRange}
          backlogSuppressed={backlogSuppressed}
        />
        <Text>
          <strong>Quarter-over-quarter highlight:</strong>{" "}
          {highlight(points, "USCIS", `${viewWho} applications`)}
        </Text>
        {APPROVAL_NOTES[form] !== undefined && (
          <Text size="sm" c="dimmed">
            {APPROVAL_NOTES[form]}
          </Text>
        )}
        {related !== undefined && (
          <Text>
            {related.lead}{" "}
            {related.links.map((link, index) => (
              <React.Fragment key={link.href}>
                {index > 0 &&
                  (index === related.links.length - 1 ? " and " : ", ")}
                {link.href.startsWith("/") ? (
                  <Anchor component={Link} href={link.href}>
                    {link.text}
                  </Anchor>
                ) : (
                  <Anchor href={link.href} target="_blank" rel="noopener">
                    {link.text}
                  </Anchor>
                )}
              </React.Fragment>
            ))}
            .
          </Text>
        )}
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
                      <Table.Td colSpan={2}>
                        {PRIORITY_DATE_TEXT[form]?.[range.key]?.(
                          formatMedian(range.median),
                        ) ?? "Depends on your priority date:"}{" "}
                        see the{" "}
                        <Anchor
                          href={VISA_BULLETIN_URL}
                          target="_blank"
                          rel="noopener"
                          inherit
                        >
                          Visa Bulletin
                        </Anchor>
                        .
                      </Table.Td>
                    ) : range.suppressed === "too few decisions" ? (
                      <Table.Td colSpan={2}>
                        Too few decisions last quarter to estimate
                      </Table.Td>
                    ) : range.suppressed === "nearly stopped" ? (
                      <Table.Td colSpan={2}>
                        USCIS has nearly stopped deciding these:{" "}
                        {Math.round((1 - (range.shockRatio ?? 0)) * 100)}% fewer
                        decisions last quarter than its average over the four
                        before
                      </Table.Td>
                    ) : (
                      <>
                        <Table.Td>
                          <RangeText low={range.q[1]} high={range.q[3]} />
                          {range.premium && (
                            <Text size="sm" c="dimmed">
                              premium and regular together
                            </Text>
                          )}
                        </Table.Td>
                        <Table.Td>
                          <RangeText low={range.q[0]} high={range.q[4]} />
                        </Table.Td>
                      </>
                    )}
                    <Table.Td ta="right">
                      {formatMedian(range.median)}
                      {range.priorityDate && (
                        <Text size="sm" c="dimmed">
                          for those decided in {newest.label}
                        </Text>
                      )}
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
          {premium !== undefined && <Alert color="blue">{premium.note}</Alert>}
          {shocked.length > 0 && (
            <Alert color="yellow">
              <Stack gap="xs">
                <Text inherit>
                  USCIS is deciding fewer of these cases than usual:{" "}
                  {new Intl.ListFormat("en-US").format(
                    shocked.map(
                      ({ name, shockRatio }) =>
                        `${Math.round(
                          (1 - (shockRatio ?? 1)) * 100,
                        )}% fewer ${name} cases`,
                    ),
                  )}{" "}
                  in {newest.label} than{" "}
                  {shocked.length === 1 ? "its average" : "their averages"} over
                  the four quarters before. Plan for the later end of the range.
                </Text>
                <MoreDetails>
                  <Text size="sm">
                    We make the range wider when this happens. But in past
                    slowdowns like this, the typical wait fell inside the
                    could-be range only about 2 times in 3, not 8 times in 10 as
                    usual.
                  </Text>
                </MoreDetails>
              </Stack>
            </Alert>
          )}
        </Stack>
      )}
      <Stack gap="sm">
        <Title order={2}>What happened to the applications</Title>
        <Text>
          The bars are the {viewWho} decisions USCIS made each quarter, approved
          in blue and denied in red. The amber line is the backlog: how many
          applications were still waiting at the end of that quarter, most of
          them filed in earlier ones. The dashed line is how many came in.
          {view.splitLabel !== null &&
            ` Before ${view.splitLabel}, USCIS's all-forms report had one row for every ${form}; the ${view.name} numbers for those quarters come from the national totals of its per-office ${form} report.`}
        </Text>
        <OutcomesChart
          points={points}
          subject={viewWho}
          source={source}
          sourceName={sourceName}
          breaks={view.breaks}
        />
      </Stack>
      {(hasClearing || view.processingTimeSeries.length > 0) && (
        <Stack gap="sm">
          <Title order={2}>
            {view.processingTimeSeries.length > 0
              ? "USCIS median and backlog over time"
              : "Backlog over time"}
          </Title>
          <Text>
            {hasRange &&
              "The range starts from USCIS's own median processing time for your category and widens it by how far real waits have landed from that median in past quarters. "}
            Time to clear backlog is how long USCIS would need to decide every
            pending case at last quarter&rsquo;s pace. It is not your wait: the
            pile includes cases on hold and{" "}
            {ranges.some(
              ({ key, priorityDate }) =>
                priorityDate && (isTotal || key === view.key),
            )
              ? "cases waiting for a visa number"
              : "cases USCIS cannot decide yet"}
            .
            {clearingGaps &&
              " The chart leaves it out for quarters in which USCIS decided fewer than 100, too few to divide by."}
            {view.processingTimeSeries.length === 0
              ? ` USCIS does not publish a processing time for ${
                  isTotal ? "this form" : "this category"
                } in these reports.`
              : view.lastMedian !== null &&
                ` USCIS has not published a median for ${
                  isTotal ? "this form" : "this category"
                } since ${view.lastMedian}.`}
            {view.processingTimeSeries.length > 0 &&
              republished
                .filter(({ quarter }) =>
                  points.some((point) => point.quarter === quarter),
                )
                .map(
                  ({ label }) =>
                    ` USCIS's ${label} report repeated the quarter before's medians, so the chart has none for ${label}.`,
                )
                .join("")}
          </Text>
          <WaitChart
            points={points}
            subject={viewWho}
            suppressed={backlogSuppressed}
            processingTimeSeries={view.processingTimeSeries}
            breaks={view.breaks}
          />
        </Stack>
      )}
      {variants.length > 1 && (
        <Stack gap="sm">
          <Title order={2}>By category, {newest.label}</Title>
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
                  <Table.Tr
                    key={variant.key}
                    fw={variant.key === view.key ? 700 : undefined}
                  >
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
            .{" "}
            {`Next to each office is how many ${
              officeCategory === null ? form : `${form} (${officeCategory})`
            } cases it decided, approved or denied, in ${
              officeLabel ?? "the newest quarter"
            }, and the offices are listed from the most to the fewest${
              offices.some(({ category }) => category !== null)
                ? "; for an office that handles few of those, or almost never approves them, the count is of its main category, named next to it"
                : ""
            }.${
              officeCategory === null
                ? ""
                : " The office pages show every category."
            }`}
          </Text>
          <TextInput
            size="lg"
            label="Find your field office"
            leftSection={<SearchIcon />}
            type="search"
            placeholder="e.g. San Francisco or CA"
            onChange={setTerm}
          />
          <SearchStatus
            term={term}
            count={filteredOffices.length}
            noun={["office", "offices"]}
            hint="Try the city or the two-letter state code, such as Houston or TX."
          />
          {filteredOffices.length > 0 && (
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
                            color="ink"
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
          )}
        </Stack>
      )}
    </Stack>
  );
}
