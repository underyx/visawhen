import {
  Alert,
  Anchor,
  Button,
  NativeSelect,
  Stack,
  Text,
  Title,
} from "@mantine/core";
import { GetStaticPaths, GetStaticProps } from "next";
import Head from "next/head";
import Link from "next/link";
import React, { useEffect, useMemo, useState } from "react";
import { getTimelineData } from "../../api/timeline";
import { formatDate, useToday } from "../../components/Freshness";
import { ChevronLeftIcon } from "../../components/icons";
import MonthInput from "../../components/MonthInput";
import MoreDetails from "../../components/MoreDetails";
import TemporaryNotice from "../../components/TemporaryNotice";
import { breadcrumbList } from "../../components/structuredData";
import { formatBulletinMonth } from "../../components/visaBulletin";
import type {
  PathSlug,
  PathSpec,
  StageResult,
  TimelineData,
  TimelineInputs,
  TimelineResult,
} from "../../components/timeline";
import {
  EMPTY_INPUTS,
  estimateTimeline,
  formatDateRange,
  formatDuration,
  inputsFromHash,
  inputsToHash,
  pathBySlug,
  pathMilestones,
  PATHS,
} from "../../components/timeline";
import classes from "../../components/Timeline.module.css";
import stampClasses from "../../components/UscisStats.module.css";

// A path's timeline: its steps in order, each with when it will most likely
// land, from where the visitor says their case is. What the visitor enters
// stays in this page's memory: it goes in no address, no cookie and no
// analytics (see TimelineInputs in components/timeline.ts).

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

function Stamp({
  result,
  reported,
  today,
}: {
  result: TimelineResult;
  /** Whether the visitor said where their case is */
  reported: boolean;
  today: string | null;
}) {
  const { total } = result;
  // nothing to foretell when the last counted step should be over by now:
  // its own line says what to do
  if (
    total === null ||
    (total.end !== null && today !== null && total.end.high <= today)
  )
    return null;
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
  const { spec, status, headline, warning, news, basis } = result;
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
      {status !== "done" &&
        warning !== null &&
        spec.detached !== true &&
        (news ? (
          <TemporaryNotice mt="xs">{warning}</TemporaryNotice>
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
              {" "}
              <To href={spec.href}>
                {spec.hrefText.charAt(0).toUpperCase() + spec.hrefText.slice(1)}
              </To>
              .
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
    spec.detached === true ? classes.later : "",
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

/** The office page's verdict on the chosen office, in a sentence */
function officeVerdict(
  office: NonNullable<TimelineData["offices"]>[number],
  form: string,
  quarter: string | null,
): string {
  const base =
    form === "N-400" ? "the country as a whole" : "all field offices together";
  const pace = quarter === null ? "" : ` over the four quarters to ${quarter}`;
  switch (office.verdict) {
    case "longer":
      return `${office.name}’s backlog would take clearly longer to clear than that of ${base}, at its pace${pace}. Plan for the later end of each USCIS range.`;
    case "shorter":
      return `${office.name}’s backlog would take clearly less time to clear than that of ${base}, at its pace${pace}. Your wait may be at the earlier end of each USCIS range.`;
    case "close":
      return `${office.name}’s backlog would take about as long to clear as that of ${base}, at its pace${pace}: not clearly longer or shorter.`;
    default:
      return `No verdict on ${office.name} right now: in its newest quarter, cases moved in or out, it decided too few, or it approves almost none of them.`;
  }
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
      <form
        className={classes.inputs}
        onSubmit={(event) => event.preventDefault()}
      >
        <NativeSelect
          className={classes.wide}
          label="Where is your case?"
          description="Your answers are kept only in this page’s link, so you can bookmark it."
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
              label="Your priority date, if you have one"
              value={inputs.priorityDate}
              onChange={(priorityDate) => set({ priorityDate })}
              today={today}
              year={year}
            />
          </>
        )}
        {path.inputs.includes("office") && data.offices !== null && (
          <NativeSelect
            label="Your USCIS field office, if you know it"
            value={inputs.office}
            onChange={(event) => set({ office: event.currentTarget.value })}
            data={[
              { value: "", label: "Not sure" },
              ...data.offices.map(({ slug: officeSlug, name }) => ({
                value: officeSlug,
                label: name,
              })),
            ]}
          />
        )}
        {office !== undefined && path.officeForm !== undefined && (
          <Text size="sm" className={classes.wide}>
            {officeVerdict(office, path.officeForm.form, data.officeQuarter)}{" "}
            <To href={`/uscis/${officeFormSlug}/${office.slug}`}>
              See the office’s numbers
            </To>
            .
          </Text>
        )}
      </form>
      <Stamp result={result} reported={reported} today={today} />
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
