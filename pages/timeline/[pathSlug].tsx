import {
  Alert,
  Anchor,
  Box,
  Button,
  NativeSelect,
  Stack,
  Text,
  Title,
} from "@mantine/core";
import { type GetStaticPaths, type GetStaticProps } from "next";
import Head from "next/head";
import Link from "next/link";
import React, { useEffect, useMemo, useState } from "react";
import { getTimelineData } from "../../api/timeline";
import { formatDate, useToday } from "../../components/Freshness";
import { ChevronLeftIcon, WarningIcon } from "../../components/icons";
import MonthInput from "../../components/MonthInput";
import MoreDetails from "../../components/MoreDetails";
import { ChipRow, NoteChip } from "../../components/NoteChip";
import { PolicyNews } from "../../components/PolicyBanner";
import { NotShown, Stat, Stats } from "../../components/Stats";
import { breadcrumbList } from "../../components/structuredData";
import {
  formatBulletinMonth,
  formatCutoff,
} from "../../components/visaBulletin";
import type {
  BulletinCell,
  PathCase,
  PathSlug,
  PathSpec,
  StageResult,
  TimelineData,
  TimelineInputs,
  TimelineResult,
} from "../../components/timeline";
import {
  caseNote,
  EMPTY_INPUTS,
  estimateTimeline,
  formatDateRange,
  formatDuration,
  inputsFromHash,
  inputsToHash,
  movementStat,
  pathBySlug,
  pathMilestones,
  PATHS,
} from "../../components/timeline";
import classes from "../../components/Timeline.module.css";
import stampClasses from "../../components/UscisStats.module.css";

// A path's timeline: its steps in order, each with when it will most likely
// land, from where the visitor says their case is. What the visitor enters
// lives only in the page's address, after the #, so that a filled-in
// timeline can be bookmarked: no cookie and no analytics (see
// TimelineInputs in components/timeline.ts).

interface Props {
  slug: PathSlug;
  data: TimelineData;
  /** The year of the build, which the month lists end at until the page
   * knows today */
  year: number;
}

export const getStaticPaths: GetStaticPaths = async () => ({
  paths: PATHS.map(({ slug }) => ({ params: { pathSlug: slug } })),
  fallback: false,
});

export const getStaticProps: GetStaticProps<Props> = async ({ params }) => {
  const path =
    params !== undefined && typeof params.pathSlug === "string"
      ? pathBySlug(params.pathSlug)
      : undefined;
  if (path === undefined) return { notFound: true };
  return {
    props: {
      slug: path.slug,
      data: await getTimelineData(path),
      year: new Date().getUTCFullYear(),
    },
  };
};

/** A link to a page of this site, or to an official one in a new tab */
function To({ href, children }: React.PropsWithChildren<{ href: string }>) {
  return href.startsWith("/") ? (
    <Anchor component={Link} href={href}>
      {children}
    </Anchor>
  ) : (
    <Anchor href={href} target="_blank" rel="noopener">
      {children}
    </Anchor>
  );
}

/** The stamp's first line, short enough for one line on a phone, which the
 *  range line finishes: "Interview most likely:" + "May – Nov 2027" */
function stampLabel({ spec }: StageResult): string {
  switch (spec.kind) {
    case "uscis":
      return `${spec.form} decision most likely:`;
    case "nvc-creation":
      return "NVC case number most likely:";
    case "nvc-review":
      return "NVC review done most likely:";
    case "interview":
      return "Interview most likely:";
    default:
      return "Most likely:";
  }
}

type Total = NonNullable<TimelineResult["total"]>;

/** The estimate the stamp shows, or null when there is nothing to foretell:
 * no step can be timed, or the last timed step should be over by now and
 * its own line says what to do */
function stampTotal(
  { total }: TimelineResult,
  today: string | null,
): Total | null {
  if (total === null) return null;
  if (total.end !== null && today !== null && total.end.high <= today)
    return null;
  return total;
}

function Stamp({
  total,
  reported,
}: {
  total: Total;
  /** Whether the visitor said where their case is */
  reported: boolean;
}) {
  return (
    <div className={stampClasses.estimate}>
      <div className={stampClasses.stamp}>
        <div className={stampClasses.stampLabel}>{stampLabel(total.stage)}</div>
        <div className={stampClasses.stampRange}>
          {total.end !== null
            ? formatDateRange(total.end)
            : `in ${formatDuration(total.days)}`}
        </div>
        {!reported && (
          <div className={stampClasses.stampFoot}>if you start today</div>
        )}
      </div>
    </div>
  );
}

/** The chosen line's cutoffs in the newest Visa Bulletin, in the stamp's
 * place. A path whose next step is the priority date has no stamp: the site
 * gives no arrival date for a priority date, because the line moves
 * unevenly (priorityDateStage), so without this a visitor who has chosen
 * their category and country would see no figure above the form. The boxes
 * say where the line stands and how it moved, not when the visitor's date
 * comes; the priority-date step below says what the two dates mean. */
function CutoffStrip({ cell }: { cell: BulletinCell }) {
  const movement = movementStat(cell);
  // one box per row on a phone: family lines often move two or three years
  // in a year, and "+2 years and 10 months" takes four lines in a third of
  // the width
  return (
    <Stats columns={3} phoneColumns={1}>
      <Stat
        label="Final Action Date"
        value={formatCutoff(cell.final)}
        line={cell.finalChange?.text ?? null}
        lineColor={cell.finalChange?.color}
      />
      <Stat
        label="Date for Filing"
        value={formatCutoff(cell.filing)}
        line={cell.filingChange?.text ?? null}
        lineColor={cell.filingChange?.color}
      />
      <Stat
        label="Final Action Date moved in 12 months"
        value={movement.value ?? <NotShown>{movement.notShown}</NotShown>}
        line={movement.line}
        lineColor={movement.lineColor}
      />
    </Stats>
  );
}

/** One step's text: its headline, warning, what happens and the numbers
 * behind it */
function StepBody({
  result,
  side = false,
}: {
  result: StageResult;
  /** A step filed alongside another: smaller */
  side?: boolean;
}) {
  const { spec, status, headline, warning, news, warningLabel, basis } = result;
  return (
    <>
      {status === "done" ? (
        <Text size="sm" fw={600} c="dimmed">
          Done
        </Text>
      ) : (
        headline !== "" && (
          <Text className={side ? classes.sideHeadline : classes.headline}>
            {headline}
          </Text>
        )
      )}
      {/* Our own reading of the numbers (a stall, old data) is a warning
          chip that opens the text, as /nvc's "stalled" chip is: the
          headline already carries the figure it qualifies. A warning
          about the visitor's own case stays open. */}
      {status !== "done" &&
        warning !== null &&
        (news && warningLabel !== null ? (
          <Box mt="xs">
            <NoteChip
              label={warningLabel}
              icon={<WarningIcon />}
              tone="warning"
              title={warningLabel}
            >
              <Text size="sm">{warning}</Text>
            </NoteChip>
          </Box>
        ) : (
          <Alert color="yellow" role="note" mt="xs">
            {warning}
          </Alert>
        ))}
      {status !== "done" && (
        <Text size="sm" className={classes.what} mt="xs">
          {spec.what}
          {spec.href !== null && spec.hrefText !== undefined && (
            <>
              {" See "}
              <To href={spec.href}>{spec.hrefText}</To>.
            </>
          )}
        </Text>
      )}
      {status !== "done" && basis.length > 0 && (
        <MoreDetails label="How we worked this out">
          {basis.map((sentence) => (
            <Text size="sm" key={sentence}>
              {sentence}
            </Text>
          ))}
        </MoreDetails>
      )}
    </>
  );
}

function Step({
  result,
  side,
}: {
  result: StageResult;
  /** The steps filed alongside this one */
  side: StageResult[];
}) {
  const { spec, status } = result;
  const className = [
    classes.step,
    status === "done" ? classes.done : "",
    status === "current" ? classes.current : "",
  ]
    .filter((name) => name !== "")
    .join(" ");
  return (
    <li className={className}>
      <Title order={2} className={classes.name}>
        {spec.name}
      </Title>
      <StepBody result={result} />
      {side.length > 0 && (
        <ul className={classes.side}>
          {side.map((sideResult) => (
            <li key={sideResult.spec.id}>
              <Title order={3} size="h5">
                {sideResult.spec.name}
              </Title>
              <StepBody result={sideResult} side />
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

/** The office page's verdict on the chosen office, as one claim under the
 * office list: the method and the reasons for no verdict are on the
 * office's page, one tap away */
function officeVerdict(
  office: NonNullable<TimelineData["offices"]>[number],
  form: string,
): string {
  const base =
    form === "N-400" ? "the country as a whole" : "all field offices together";
  switch (office.verdict) {
    case "longer":
      return `${office.name}’s backlog would take clearly longer to clear than ${base}’s: plan for the later end of each range.`;
    case "shorter":
      return `${office.name}’s backlog would take clearly less time to clear than ${base}’s: your wait may be at the earlier end of each range.`;
    case "close":
      return `${office.name}’s backlog would take about as long to clear as ${base}’s.`;
    default:
      return `No verdict on ${office.name} this quarter.`;
  }
}

/** The path's branches and exceptions as a "Special cases:" row of chips,
 * each opening its note (PathCase), or nothing for a path without one */
function TimelineCases({
  cases,
  data,
}: {
  cases: PathCase[];
  data: TimelineData;
}) {
  if (cases.length === 0) return null;
  return (
    <ChipRow lead="Special cases:">
      {cases.map((pathCase) => (
        <NoteChip key={pathCase.label} label={pathCase.label}>
          <Text size="sm">
            {caseNote(pathCase, data)}
            {pathCase.links !== undefined && pathCase.links.length > 0 && (
              <>
                {" See "}
                {pathCase.links.map(({ href, text }, index) => (
                  <React.Fragment key={href}>
                    {index > 0 && " and "}
                    <To href={href}>{text}</To>
                  </React.Fragment>
                ))}
                .
              </>
            )}
          </Text>
        </NoteChip>
      ))}
    </ChipRow>
  );
}

export default function TimelinePage({ slug, data, year }: Props) {
  const path = pathBySlug(slug) as PathSpec;
  const today = useToday();
  const [inputs, setInputs] = useState<TimelineInputs>(EMPTY_INPUTS);
  const milestones = useMemo(() => pathMilestones(path), [path]);
  // The answers live in the page's address, after the #, so a filled-in
  // timeline can be bookmarked or shared: they are read on arrival (and
  // when the address is edited) and written on every change, without
  // adding to the browser's history
  useEffect(() => {
    const read = () =>
      setInputs(
        inputsFromHash(window.location.hash, {
          milestone: milestones.map(({ id }) => id),
          post: (data.posts ?? []).map(({ slug: postSlug }) => postSlug),
          office: (data.offices ?? []).map(
            ({ slug: officeSlug }) => officeSlug,
          ),
          category: (data.bulletin?.categories ?? []).map(({ key }) => key),
          area: (data.bulletin?.areas ?? []).map(({ key }) => key),
        }),
      );
    read();
    window.addEventListener("hashchange", read);
    return () => window.removeEventListener("hashchange", read);
  }, [milestones, data]);
  const set = (patch: Partial<TimelineInputs>) => {
    const next = { ...inputs, ...patch };
    setInputs(next);
    window.history.replaceState(
      window.history.state,
      "",
      `${window.location.pathname}${window.location.search}${inputsToHash(
        next,
      )}`,
    );
  };
  const milestone = milestones.find(({ id }) => id === inputs.milestone);
  const result = useMemo(
    () => estimateTimeline(path, data, inputs, today),
    [path, data, inputs, today],
  );
  const reported = result.stages.some(({ status }) => status !== "ahead");
  const stamped = stampTotal(result, today);
  // the Visa Bulletin line the visitor chose, on a path that asks for one
  const cell = path.inputs.includes("bulletin")
    ? data.bulletin?.cells[inputs.category]?.[inputs.area]
    : undefined;
  const office = data.offices?.find((option) => option.slug === inputs.office);
  const officeFormSlug = path.officeForm?.form.toLowerCase();
  const canonicalUrl = `https://visawhen.com/timeline/${slug}`;
  const mainSteps = result.stages.filter(
    ({ spec }) => spec.parallelTo === undefined,
  );
  const sideSteps = (id: string) =>
    result.stages.filter(({ spec }) => spec.parallelTo === id);
  const sources = [
    data.quarterLabel !== "" ? `USCIS: ${data.quarterLabel}` : null,
    data.nvc !== null
      ? `NVC: ${formatDate(Object.keys(data.nvc.review).sort().reverse()[0])}`
      : null,
    data.ivAsOf !== null
      ? `consulate queues: ${formatDate(data.ivAsOf)}`
      : null,
    data.bulletin !== null
      ? `Visa Bulletin: ${formatBulletinMonth(data.bulletin.month)}`
      : null,
  ].filter((source): source is string => source !== null);

  return (
    <Stack gap="xl">
      <Head>
        <title>{path.pageTitle}</title>
        <meta name="description" content={path.description} />
        <link rel="canonical" href={canonicalUrl} />
        <meta property="og:title" content={path.pageTitle} />
        <meta property="og:description" content={path.description} />
        <meta property="og:url" content={canonicalUrl} />
        <script
          {...breadcrumbList([
            { name: "Timelines", path: "/" },
            { name: path.title, path: `/timeline/${slug}` },
          ])}
        />
      </Head>
      <Button
        variant="outline"
        component={Link}
        href="/"
        size="xs"
        leftSection={<ChevronLeftIcon />}
        style={{ alignSelf: "flex-start" }}
      >
        Change path
      </Button>
      <Stack gap="sm">
        <Title order={1}>{path.title}</Title>
        <Text size="lg">{path.who}</Text>
      </Stack>
      {/* The stamp comes before the form (numbers first, as on /nvc): on
          a phone it was under 3-6 inputs, and off the first screen once a
          date was picked. "If you start today" says the inputs under it
          refine it. */}
      {stamped !== null ? (
        <Stamp total={stamped} reported={reported} />
      ) : (
        cell !== undefined && <CutoffStrip cell={cell} />
      )}
      <form
        className={classes.inputs}
        onSubmit={(event) => event.preventDefault()}
      >
        <NativeSelect
          className={classes.wide}
          label="Where is your case?"
          value={inputs.milestone}
          onChange={(event) =>
            set({ milestone: event.currentTarget.value, date: "" })
          }
          data={[
            { value: "", label: "Not started yet, or not sure" },
            ...milestones.map(({ id, label }) => ({ value: id, label })),
          ]}
        />
        {milestone !== undefined && (
          <MonthInput
            key={milestone.id}
            label={milestone.dateLabel}
            value={inputs.date}
            onChange={(date) => set({ date })}
            today={today}
            year={year}
          />
        )}
        {path.inputs.includes("consulate") && data.posts !== null && (
          <NativeSelect
            label="Your consulate"
            value={inputs.post}
            onChange={(event) => set({ post: event.currentTarget.value })}
            data={[
              { value: "", label: "Choose your consulate" },
              ...data.posts.map(({ slug: postSlug, name, country }) => ({
                value: postSlug,
                label: country === null ? name : `${name}, ${country}`,
              })),
            ]}
          />
        )}
        {path.inputs.includes("bulletin") && data.bulletin !== null && (
          <>
            <NativeSelect
              label="Your category"
              value={inputs.category}
              onChange={(event) => set({ category: event.currentTarget.value })}
              data={[
                { value: "", label: "Choose your category" },
                ...data.bulletin.categories.map(({ key, name, who }) => ({
                  value: key,
                  label: `${name}: ${who}`,
                })),
              ]}
            />
            <NativeSelect
              label="Your country of birth"
              value={inputs.area}
              onChange={(event) => set({ area: event.currentTarget.value })}
              data={[
                { value: "", label: "Choose your country of birth" },
                ...data.bulletin.areas.map(({ key, name }) => ({
                  value: key,
                  label: name,
                })),
              ]}
            />
            <MonthInput
              label="Your priority date"
              value={inputs.priorityDate}
              onChange={(priorityDate) => set({ priorityDate })}
              today={today}
              year={year}
            />
          </>
        )}
        {path.inputs.includes("office") && data.offices !== null && (
          // the office page's verdict on the chosen office sits under the
          // list, as its description
          <NativeSelect
            label="Your USCIS field office"
            value={inputs.office}
            onChange={(event) => set({ office: event.currentTarget.value })}
            data={[
              { value: "", label: "Not sure" },
              ...data.offices.map(({ slug: officeSlug, name }) => ({
                value: officeSlug,
                label: name,
              })),
            ]}
            inputWrapperOrder={["label", "input", "description"]}
            description={
              office !== undefined &&
              path.officeForm !== undefined && (
                <>
                  {officeVerdict(office, path.officeForm.form)}{" "}
                  <To href={`/uscis/${officeFormSlug}/${office.slug}`}>
                    See the office’s numbers
                  </To>
                  .
                </>
              )
            }
          />
        )}
        {/* The answers live in the page's address (Bence's ask in PR
            #444): one line keeps that findable. */}
        <Text size="xs" c="dimmed" className={classes.wide}>
          Bookmark this page to keep your answers.
        </Text>
      </form>
      <Stack gap="xs" className="vw-rows">
        <PolicyNews page={`/timeline/${slug}`} />
        <TimelineCases cases={path.cases} data={data} />
      </Stack>
      <ol className={classes.steps}>
        {mainSteps.map((stage) => (
          <Step
            key={stage.spec.id}
            result={stage}
            side={sideSteps(stage.spec.id)}
          />
        ))}
      </ol>
      <Text size="xs" c="dimmed" className={classes.footnote}>
        Newest numbers: {sources.join("; ")}. Your case can take longer: a
        request for evidence or a background check can add months.
      </Text>
    </Stack>
  );
}
