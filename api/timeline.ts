import type { Form, Period, UscisData } from "./uscis";
import {
  getActiveOffices,
  getData as getUscisData,
  latestQuarter,
  newestQuarter,
} from "./uscis";
import type { NvcSeries } from "./nvc";
import { getData as getNvcData } from "./nvc";
import { getIvScheduleAsOf, getIvScheduleHistory } from "./consulates";
import { getData as getBulletinData } from "./visaBulletin";
import { POST_COUNTRIES } from "./searchTerms";
import {
  casesMovedQuarters,
  categoryMovedQuarters,
  categoryRanges,
  clearingSuppressed,
  compareClearing,
  fourQuarterClearing,
  movedDirection,
  withoutMisleadingClearing,
} from "../components/estimate";
import {
  ALL_CATEGORIES,
  cleanData,
  isServiceCenter,
  officeCategoryCounts,
  officePointOptions,
  quarterLabel,
  rarelyApproves,
  SERVICE_CENTER_FORMS,
  sumCounts,
  toPoints,
} from "../components/uscis";
import {
  AREAS,
  CATEGORIES,
  getMovement,
  getSeries,
  newestMonth,
} from "../components/visaBulletin";
import { daysBetween } from "../components/Freshness";
import type {
  BulletinOptions,
  OfficeOption,
  PathSpec,
  PostQueue,
  TimelineData,
} from "../components/timeline";

// The data a timeline page is built with, at build time: only what its
// path's steps need, from the same files and by the same rules as the
// section pages, so that the two agree.

/** NVC readings older than this before the newest are not needed: the /nvc
 * range reads at most six weeks back (components/nvcReview.ts) */
const NVC_HISTORY_DAYS = 120;

function recentReadings(series: NvcSeries): NvcSeries {
  const dates = Object.keys(series).sort();
  const newest = dates[dates.length - 1];
  return Object.fromEntries(
    dates
      .filter((date) => daysBetween(date, newest) <= NVC_HISTORY_DAYS)
      .map((date) => [date, series[date]]),
  );
}

/** The field offices of a form, each with the verdict its office page gives
 * on the category the page opens with (or on all categories together): by
 * the office page's rule, no verdict in a quarter cases moved in or out,
 * with too few decisions, or at an office that almost never approves these
 * cases. Service centers are left out: a visitor knows their field office. */
function officeOptions(
  periods: Period[],
  form: Form,
  category: string | null,
): OfficeOption[] {
  const key = category ?? ALL_CATEGORIES;
  const options = officePointOptions(form.form);
  // the office page compares a field office of the I-130 and the I-485
  // with the other field offices, whose piles the service centers dwarf
  const fieldOffices = SERVICE_CENTER_FORMS.includes(form.form)
    ? form.offices.filter(({ name }) => !isServiceCenter(name))
    : null;
  const nationalPoints = toPoints(
    periods,
    fieldOffices === null
      ? officeCategoryCounts(form.officeTotals, key)
      : sumCounts(
          fieldOffices.map(({ quarters }) =>
            officeCategoryCounts(quarters, key),
          ),
        ),
    options,
  );
  return getActiveOffices(form)
    .filter(({ name }) => !isServiceCenter(name))
    .map((office) => {
      const total = toPoints(periods, office.quarters, options);
      const counts =
        key === ALL_CATEGORIES
          ? total
          : toPoints(
              periods,
              officeCategoryCounts(office.quarters, key),
              options,
            );
      let verdict: OfficeOption["verdict"] = null;
      if (counts.length > 0) {
        const moved =
          key === ALL_CATEGORIES
            ? casesMovedQuarters(total)
            : categoryMovedQuarters(total, counts);
        const points = withoutMisleadingClearing(counts);
        const current = points[points.length - 1];
        const officeClearing = fourQuarterClearing(points, current.quarter);
        const nationalClearing = fourQuarterClearing(
          nationalPoints,
          current.quarter,
        );
        if (
          clearingSuppressed(current) === null &&
          movedDirection(points, moved, current.quarter) === null &&
          !rarelyApproves(current) &&
          officeClearing !== null &&
          nationalClearing !== null
        )
          verdict = compareClearing(
            officeClearing.months,
            nationalClearing.months,
          );
      }
      return {
        slug: office.slug,
        name:
          office.stateCode === null
            ? office.name
            : `${office.name}, ${office.stateCode}`,
        verdict,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

async function postQueues(): Promise<PostQueue[]> {
  const posts = await getIvScheduleHistory("relative");
  return posts
    .map(({ slug, name, history }) => ({
      slug,
      name,
      country: POST_COUNTRIES[slug] ?? null,
      history,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

async function bulletinOptions(
  kind: "family" | "employment",
): Promise<BulletinOptions> {
  const data = await getBulletinData();
  const month = newestMonth(data);
  const newest = data.bulletins[month];
  const categories = CATEGORIES.filter((category) => category.kind === kind);
  const cells: BulletinOptions["cells"] = {};
  for (const category of categories) {
    cells[category.key] = {};
    for (const area of AREAS) {
      const series = getSeries(data, "finalAction", category.key, area.key);
      const final = newest.finalAction[category.key]?.[area.key];
      if (final === undefined || series.length === 0) continue;
      cells[category.key][area.key] = {
        final,
        filing: newest.datesForFiling[category.key]?.[area.key] ?? final,
        year: getMovement(series, 12),
        fiveYears: getMovement(series, 60),
      };
    }
  }
  const areas = AREAS.filter((area) =>
    categories.some((category) => cells[category.key][area.key] !== undefined),
  );
  return {
    month,
    categories: categories.map(({ key, slug, name, who }) => ({
      key,
      slug,
      name,
      who,
    })),
    areas: areas.map(({ key, slug, name }) => ({ key, slug, name })),
    cells,
  };
}

// The USCIS data is 13 MB of JSON: read and cleaned once per build, not
// once per path
let uscisPromise: Promise<UscisData> | undefined;

function getUscis(): Promise<UscisData> {
  if (uscisPromise === undefined)
    uscisPromise = getUscisData().then((data) => cleanData(data));
  return uscisPromise;
}

/** The ranges of the USCIS steps of a path, by "form/category" */
function pathRanges(uscis: UscisData, path: PathSpec): TimelineData["ranges"] {
  const ranges: TimelineData["ranges"] = {};
  for (const stage of path.stages) {
    if (stage.kind !== "uscis") continue;
    const form = uscis.forms.find((candidate) => candidate.form === stage.form);
    if (form === undefined) continue;
    const range = categoryRanges(form).find(
      ({ key }) => key === stage.category,
    );
    if (range !== undefined) ranges[`${stage.form}/${stage.category}`] = range;
  }
  return ranges;
}

async function pathNvc(path: PathSpec): Promise<TimelineData["nvc"]> {
  const kinds = new Set(path.stages.map(({ kind }) => kind));
  if (!kinds.has("nvc-creation") && !kinds.has("nvc-review")) return null;
  const data = await getNvcData();
  return {
    creation: recentReadings(data.creation),
    review: recentReadings(data.review),
  };
}

/** The data the home page's line on each path rests on: the USCIS ranges
 * and NVC's readings, nothing a visitor has to choose */
export async function getPathSummaryData(
  path: PathSpec,
): Promise<TimelineData> {
  const uscis = await getUscis();
  const newest = newestQuarter(uscis);
  const period = uscis.periods.find(({ quarter }) => quarter === newest);
  return {
    quarterLabel: period === undefined ? "" : quarterLabel(period),
    ranges: pathRanges(uscis, path),
    nvc: await pathNvc(path),
    posts: null,
    ivAsOf: null,
    offices: null,
    officeQuarter: null,
    bulletin: null,
  };
}

/** Everything a path's page needs, and nothing another path's would */
export async function getTimelineData(path: PathSpec): Promise<TimelineData> {
  const uscis = await getUscis();
  const newest = newestQuarter(uscis);
  const period = uscis.periods.find(({ quarter }) => quarter === newest);
  const ranges = pathRanges(uscis, path);
  const nvc = await pathNvc(path);
  const officeForm =
    path.officeForm === undefined
      ? undefined
      : uscis.forms.find(({ form }) => form === path.officeForm?.form);
  const officeQuarter =
    officeForm === undefined ? null : latestQuarter(officeForm.officeTotals);
  const officePeriod = uscis.periods.find(
    ({ quarter }) => quarter === officeQuarter,
  );
  const priorityDate = path.stages.find(
    (stage) => stage.kind === "priority-date",
  );
  return {
    quarterLabel: period === undefined ? "" : quarterLabel(period),
    ranges,
    nvc,
    posts: path.inputs.includes("consulate") ? await postQueues() : null,
    ivAsOf: path.inputs.includes("consulate")
      ? await getIvScheduleAsOf()
      : null,
    offices:
      officeForm === undefined || path.officeForm === undefined
        ? null
        : officeOptions(uscis.periods, officeForm, path.officeForm.category),
    officeQuarter:
      officePeriod === undefined ? null : quarterLabel(officePeriod),
    bulletin:
      priorityDate !== undefined && priorityDate.kind === "priority-date"
        ? await bulletinOptions(priorityDate.categories)
        : null,
  };
}
