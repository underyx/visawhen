import {
  Alert,
  Anchor,
  Button,
  NativeSelect,
  Stack,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { GetStaticPaths, GetStaticProps } from "next";
import Head from "next/head";
import Link from "next/link";
import React, { useMemo, useState } from "react";
import { getTimelineData } from "../../api/timeline";
import { formatDate, useToday } from "../../components/Freshness";
import { ChevronLeftIcon } from "../../components/icons";
import MoreDetails from "../../components/MoreDetails";
import { breadcrumbList } from "../../components/structuredData";
import { formatBulletinMonth } from "../../components/visaBulletin";
import {
  EMPTY_INPUTS,
  estimateTimeline,
  formatDateRange,
  formatDuration,
  pathBySlug,
  pathMilestones,
  PATHS,
  PathSlug,
  PathSpec,
  StageResult,
  TimelineData,
  TimelineInputs,
  TimelineResult,
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
  return { props: { slug: path.slug, data: await getTimelineData(path) } };
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

/** What the stamp counts to: "the I-130 decision", "your interview" */
function stampFoot({ spec }: StageResult): string {
  switch (spec.kind) {
    case "uscis":
      return `to the ${spec.form} decision`;
    case "nvc-creation":
      return "to your NVC case number";
    case "nvc-review":
      return "to NVC’s review of your documents";
    case "interview":
      return "to your interview";
    default:
      return `to ${spec.name.toLowerCase()}`;
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
  // the first step after the stamp's that is not counted, and why
  const main = result.stages.filter(
    ({ spec }) => spec.parallelTo === undefined && spec.detached !== true,
  );
  const next = main[main.indexOf(total.stage) + 1];
  const after =
    next === undefined
      ? null
      : next.needs === "consulate"
      ? "Choose your consulate above to count the interview queue too."
      : next.needs === "bulletin"
      ? "Choose your category and country of birth above to see where the line is."
      : next.spec.kind === "priority-date"
      ? "The wait for your priority date after it cannot be predicted from the numbers, so it is not counted."
      : "The steps after it have no published numbers, so they are not counted.";
  return (
    <div className={stampClasses.estimate}>
      <div className={stampClasses.stamp}>
        <div className={stampClasses.stampLabel}>
          {reported
            ? "From where your case is, most likely"
            : "If you start today, most likely"}
        </div>
        <div className={stampClasses.stampRange}>
          {total.end !== null
            ? formatDateRange(total.end)
            : formatDuration(total.days)}
        </div>
        <div className={stampClasses.stampFoot}>{stampFoot(total.stage)}</div>
      </div>
      <Stack gap={6} className={stampClasses.aside}>
        <Text size="sm">
          The steps below add up to this. Each one rests on the newest
          government numbers for it: open a step to see which.
        </Text>
        {after !== null && (
          <Text size="sm" c="dimmed">
            {after}
          </Text>
        )}
      </Stack>
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
  const { spec, status, headline, warning, basis } = result;
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
      {status !== "done" && warning !== null && spec.detached !== true && (
        <Alert color="yellow" role="note" mt="xs">
          {warning}
        </Alert>
      )}
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

export default function TimelinePage({ slug, data }: Props) {
  const path = pathBySlug(slug) as PathSpec;
  const today = useToday();
  const [inputs, setInputs] = useState<TimelineInputs>(EMPTY_INPUTS);
  const set = (patch: Partial<TimelineInputs>) =>
    setInputs((current) => ({ ...current, ...patch }));
  const milestones = useMemo(() => pathMilestones(path), [path]);
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
          description="Nothing you enter here is saved or sent anywhere."
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
          <TextInput
            type="date"
            label={milestone.dateLabel}
            max={today ?? undefined}
            value={inputs.date}
            onChange={(event) => set({ date: event.currentTarget.value })}
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
            <TextInput
              type="date"
              label="Your priority date, if you have one"
              max={today ?? undefined}
              value={inputs.priorityDate}
              onChange={(event) =>
                set({ priorityDate: event.currentTarget.value })
              }
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
      <Stack gap="xs" className={classes.footnote}>
        <Text size="xs" c="dimmed">
          Newest data: {sources.join("; ")}. The ranges say what most cases like
          yours are taking now, not what yours will take: a request for
          evidence, a background check or a change in policy can add months.
        </Text>
        <Text size="xs" c="dimmed">
          These are the common routes, not legal advice: an immigration lawyer
          or accredited representative can tell you which one is yours and
          whether you qualify.
        </Text>
      </Stack>
    </Stack>
  );
}
