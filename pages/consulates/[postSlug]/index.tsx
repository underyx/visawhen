import { ChevronLeftIcon, SearchIcon } from "../../../components/icons";
import { sortBy } from "lodash";
import { GetStaticPaths, GetStaticProps } from "next";
import Head from "next/head";
import Link from "next/link";
import React, { useMemo } from "react";
import {
  getAllPosts,
  getAllVisaClasses,
  getIvSchedule,
  getIvScheduleAsOf,
  getIvScheduleSource,
  getPost,
  getPostActivity,
  getRecentIssuancesByClass,
  getRecentWindow,
  getVisaClassSlugsForPost,
  RecentVisaClassIssuancesRow,
  RecentWindow,
  VisaClassRow,
} from "../../../api/consulates";
import { checkPolicies } from "../../../api/policy";
import {
  applicantCountry,
  CLASS_APPLICANT_COUNTRIES,
  countToolClassIssuances,
  describeInactivity,
  FEW_IMMIGRANT_VISAS,
  formatCount,
  formatMonth,
  formatMonthlyRate,
  formatShortIvMonth,
  IvSchedule,
  monthsBehind,
  summarizeInactivity,
} from "../../../components/consulates";
import IvScheduleCard, {
  describeRelativeQueue,
  listsPostAsCurrent,
} from "../../../components/IvScheduleCard";
import { ListItem, ListRow, ListRows } from "../../../components/ListRow";
import PolicyBanner from "../../../components/PolicyBanner";
import {
  hasEnded,
  issuanceSuspensionFor,
  scheduleOverrideFor,
} from "../../../components/policy";
import { formatShortDate, useToday } from "../../../components/Freshness";
import { normalize } from "../../../components/search";
import SearchStatus from "../../../components/SearchStatus";
import { POST_COUNTRIES } from "../../../api/searchTerms";
import {
  Alert,
  Badge,
  Box,
  Button,
  Group,
  Highlight,
  Stack,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { useInputState } from "@mantine/hooks";

interface Props {
  postSlug: string;
  postName: string;
  /** "Canada" */
  country: string | null;
  visaClasses: VisaClassRow[];
  availableVisaClasses: string[];
  /** Visas issued per class in the last 12 months of the data */
  recentIssuances: RecentVisaClassIssuancesRow[];
  recentWindow: RecentWindow;
  /** The date of State's newest IV Scheduling Status Tool update we have */
  ivScheduleAsOf: string;
  /** The post's line in it, or null when it does not list the post */
  ivSchedule: IvSchedule | null;
  /** The tool's address */
  ivScheduleSource: string;
  /** That the post has issued no immigrant visas, or no visas, for a year,
   * if it has not (see describeInactivity) */
  inactivity: string | null;
  /** The same as a phrase for the title (see summarizeInactivity) */
  inactivitySummary: string | null;
}

export const getStaticPaths: GetStaticPaths = async () => {
  const posts = await getAllPosts();
  checkPolicies({
    postSlugs: posts.map((row) => row.postSlug),
    countries: [
      ...posts.map(({ postSlug }) =>
        applicantCountry(POST_COUNTRIES[postSlug] ?? null, postSlug),
      ),
      ...Object.values(CLASS_APPLICANT_COUNTRIES).flatMap((classes) =>
        Object.values(classes ?? {}),
      ),
    ].filter((country): country is string => country !== null),
    visaClassSlugs: (await getAllVisaClasses()).map(
      ({ visaClassSlug }) => visaClassSlug,
    ),
  });
  return {
    paths: posts.map((row) => ({ params: { postSlug: row.postSlug } })),
    fallback: false,
  };
};

export const getStaticProps: GetStaticProps<Props> = async ({ params }) => {
  if (params === undefined || typeof params.postSlug !== "string")
    return { notFound: true };
  const { postSlug } = params;

  const postInfo = await getPost(postSlug);
  if (postInfo === undefined) return { notFound: true };
  const recentWindow = await getRecentWindow();
  const ivSchedule = await getIvSchedule(postSlug);
  const inactivityInput = {
    postName: postInfo.post,
    activity: await getPostActivity(postSlug),
    dataStart: recentWindow.first,
    dataEnd: recentWindow.to,
    immigrant: true,
    listedInTool: ivSchedule !== null,
  };

  return {
    props: {
      postSlug,
      postName: postInfo.post,
      country: POST_COUNTRIES[postSlug] ?? null,
      visaClasses: await getAllVisaClasses(),
      availableVisaClasses: await getVisaClassSlugsForPost(postSlug),
      recentIssuances: await getRecentIssuancesByClass(postSlug),
      recentWindow,
      ivScheduleAsOf: await getIvScheduleAsOf(),
      ivSchedule,
      ivScheduleSource: await getIvScheduleSource(),
      inactivity: describeInactivity(inactivityInput),
      inactivitySummary: summarizeInactivity(inactivityInput),
    },
  };
};

function sortItems(
  visaClasses: VisaClassRow[],
  recentMap: Map<string, number>,
): VisaClassRow[] {
  return sortBy(visaClasses, [
    ({ visaClassSlug }) => -(recentMap.get(visaClassSlug) ?? -1),
    "visaClass",
  ]);
}

export default function ConsulateSelect({
  postSlug,
  postName,
  country,
  visaClasses,
  availableVisaClasses,
  recentIssuances,
  recentWindow,
  ivScheduleAsOf,
  ivSchedule,
  ivScheduleSource,
  inactivity,
  inactivitySummary,
}: Props) {
  const recentMap = useMemo<Map<string, number>>(
    () =>
      new Map(recentIssuances.map((row) => [row.visaClassSlug, row.issuances])),
    [recentIssuances],
  );
  const [term, setTerm] = useInputState("");

  const availableVisaClassesSet = useMemo<Set<string>>(
    () => new Set<string>(availableVisaClasses),
    [availableVisaClasses],
  );

  const filteredVisas = useMemo<VisaClassRow[]>(() => {
    const normalizedTerm = normalize(term);
    return sortItems(
      visaClasses.filter(({ visaClass, description }) =>
        normalize(`${visaClass} ${description ?? ""}`).includes(normalizedTerm),
      ),
      recentMap,
    );
  }, [recentMap, visaClasses, term]);
  // The classes the post has a page for, and those it never issued, which
  // have none: they are listed, collapsed, as text rather than as links
  const issuedVisas = filteredVisas.filter(({ visaClassSlug }) =>
    availableVisaClassesSet.has(visaClassSlug),
  );
  const neverIssuedVisas = filteredVisas.filter(
    ({ visaClassSlug }) => !availableVisaClassesSet.has(visaClassSlug),
  );

  const canonicalUrl = `https://visawhen.com/consulates/${postSlug}`;
  // Posts State lists with a month for immediate relatives are titled by
  // their interview queue; the rest keep the issuance title. The post itself
  // is called current only when every category State lists is. Where a
  // policy means the month is no queue, such as a pause of visa services,
  // the policy takes the title and description instead, with its end date if
  // it has one, since the page may still be served after it. Next, where
  // most applicants are nationals whose visas are suspended, that takes the
  // title, since NVC scheduling their interviews does not mean a visa can be
  // issued. A post that looks closed (see describeInactivity) is titled by
  // that instead, since State's tool can list a post that issues nothing as
  // current, and so is one listed as current that issued fewer than
  // FEW_IMMIGRANT_VISAS of the visas the tool covers.
  const relativeCutoff = ivSchedule?.relative ?? null;
  const today = useToday();
  const scheduleOverride = scheduleOverrideFor(postSlug, ivScheduleAsOf, today);
  const consulate = {
    postSlug,
    country: applicantCountry(country, postSlug),
  };
  const suspension = issuanceSuspensionFor(consulate.country);
  const recentToolIssued = countToolClassIssuances(recentIssuances);
  const issuedDescription = `How many visas ${postName} issued every month ${
    availableVisaClasses.length === 1
      ? "in one visa class"
      : `in each of ${availableVisaClasses.length} visa classes`
  }, from State Department statistics through ${formatMonth(recentWindow.to)}.`;
  let title: string;
  let description: string;
  if (scheduleOverride !== null) {
    const ends =
      scheduleOverride.end === null
        ? null
        : `${
            hasEnded(scheduleOverride, null) ? "ended" : "ends"
          } ${formatShortDate(scheduleOverride.end)}`;
    title = `${postName}: ${scheduleOverride.title}${
      ends === null ? "" : ` (${ends})`
    }`;
    description = `${postName}: ${scheduleOverride.title} (${
      scheduleOverride.status === "official"
        ? "State Department notice"
        : "reported; no State Department notice"
    }${ends === null ? "" : `, ${ends}`}, last checked ${formatShortDate(
      scheduleOverride.lastChecked,
    )}). ${issuedDescription}`;
  } else if (suspension !== null && consulate.country !== null) {
    title = `${postName}: immigrant visas suspended for nationals of ${consulate.country}`;
    description = `Most immigrant visa applicants at ${postName} are nationals of ${
      consulate.country
    }, whose immigrant visas are suspended: ${suspension.title} (${
      suspension.status === "official"
        ? "State Department notice"
        : "reported; no State Department notice"
    }, last checked ${formatShortDate(
      suspension.lastChecked,
    )}). ${issuedDescription}`;
  } else if (inactivity !== null && inactivitySummary !== null) {
    title = `${postName}: ${inactivitySummary}`;
    description = `${inactivity} ${issuedDescription}`;
  } else if (
    ivSchedule !== null &&
    relativeCutoff !== null &&
    monthsBehind(ivSchedule.asOf, relativeCutoff) <= 0 &&
    recentToolIssued < FEW_IMMIGRANT_VISAS
  ) {
    // State lists immediate relatives as current at a post that issues
    // almost none of the visas its tool covers: the data, not "current",
    // takes the title.
    const issued = `${
      recentToolIssued === 0 ? "no" : formatCount(recentToolIssued)
    } family or employment immigrant ${
      recentToolIssued === 1 ? "visa" : "visas"
    } issued`;
    title = `${postName}: ${issued}, ${formatMonth(
      recentWindow.from,
    )} to ${formatMonth(recentWindow.to)}`;
    description = `${postName} issued ${
      recentToolIssued === 0 ? "no" : `only ${formatCount(recentToolIssued)}`
    } family or employment immigrant ${
      recentToolIssued === 1 ? "visa" : "visas"
    } from ${formatMonth(recentWindow.from)} to ${formatMonth(
      recentWindow.to,
    )}, though State’s interview-scheduling tool lists it as current. ${issuedDescription}`;
  } else {
    title =
      ivSchedule === null || relativeCutoff === null
        ? `${postName} visas issued by class`
        : // Not a wait: the month is the one "for which NVC is scheduling
          // most interviews", in State's words, and it can move backwards.
          `${postName} immigrant visa interview scheduling: ${
            monthsBehind(ivSchedule.asOf, relativeCutoff) > 0
              ? `mostly ${formatShortIvMonth(relativeCutoff)} cases`
              : listsPostAsCurrent(ivSchedule)
              ? "listed as current"
              : "immediate relatives listed as current"
          }`;
    description =
      describeRelativeQueue(postName, ivSchedule) ?? issuedDescription;
  }

  return (
    <Stack>
      <Head>
        <title>{title}</title>
        <meta name="description" content={description} />
        <link rel="canonical" href={canonicalUrl} />
        <meta property="og:title" content={title} />
        <meta property="og:description" content={description} />
        <meta property="og:url" content={canonicalUrl} />
      </Head>
      <Button
        variant="outline"
        component={Link}
        href="/consulates"
        size="xs"
        leftSection={<ChevronLeftIcon />}
        style={{ alignSelf: "flex-start" }}
      >
        Change consulate
      </Button>
      <Box>
        <Title order={1}>{postName}</Title>
        {country !== null && <Text size="xl">{country}</Text>}
      </Box>
      {inactivity !== null && (
        // role="note": a standing statement, which screen readers should not
        // announce on load as they do Mantine's default role="alert"
        <Alert role="note" color="gray">
          {inactivity}
        </Alert>
      )}
      <PolicyBanner consulate={consulate} />
      <IvScheduleCard
        postName={postName}
        asOf={ivScheduleAsOf}
        schedule={ivSchedule}
        source={ivScheduleSource}
        scheduleOverride={scheduleOverride ?? undefined}
        recentIssued={{
          count: recentToolIssued,
          from: recentWindow.from,
          to: recentWindow.to,
        }}
        suspension={
          suspension === null || consulate.country === null
            ? undefined
            : {
                entry: suspension,
                country: consulate.country,
                applicants: "immigrant visa",
              }
        }
      />
      <Title order={2}>Visa classes at {postName}</Title>
      <TextInput
        size="lg"
        label="Find your visa class"
        leftSection={<SearchIcon />}
        type="search"
        placeholder="e.g. CR1 or spouse"
        onChange={setTerm}
      />
      <SearchStatus
        term={term}
        count={filteredVisas.length}
        noun={["visa class", "visa classes"]}
        hint="Try a class code such as CR1, or a word such as spouse."
      />
      <Text size="sm" c="dimmed">
        Badges: average visas issued per month, {formatMonth(recentWindow.from)}{" "}
        to {formatMonth(recentWindow.to)}.
      </Text>
      {issuedVisas.length > 0 && (
        <ListRows>
          {issuedVisas.map(({ visaClass, visaClassSlug, description }) => (
            <ListRow
              key={visaClassSlug}
              href={`/consulates/${postSlug}/${visaClassSlug}`}
              hardNavigation
              rightSection={
                <Badge
                  size="lg"
                  radius="sm"
                  variant="outline"
                  color="gray"
                  tt="none"
                  fw={500}
                >
                  {formatMonthlyRate((recentMap.get(visaClassSlug) ?? 0) / 12)}
                </Badge>
              }
              label={
                <Group gap="xs">
                  <Badge size="lg" radius="sm" color="blue" variant="light">
                    <Highlight highlight={term}>{visaClass}</Highlight>
                  </Badge>
                  <Highlight highlight={term}>{description ?? ""}</Highlight>
                </Group>
              }
            />
          ))}
        </ListRows>
      )}
      {neverIssuedVisas.length > 0 && (
        // Collapsed unless the search finds some of them. They have no page,
        // so they are text, not links.
        <details open={term.trim() !== "" || undefined}>
          <Text component="summary" style={{ cursor: "pointer" }}>
            {term.trim() === ""
              ? `${neverIssuedVisas.length} visa classes`
              : `${neverIssuedVisas.length} matching visa ${
                  neverIssuedVisas.length === 1 ? "class" : "classes"
                }`}{" "}
            with none issued at {postName}, {formatMonth(recentWindow.first)} to{" "}
            {formatMonth(recentWindow.to)}
          </Text>
          <Box mt="sm">
            <ListRows>
              {neverIssuedVisas.map(
                ({ visaClass, visaClassSlug, description }) => (
                  <ListItem
                    key={visaClassSlug}
                    label={
                      <Group gap="xs">
                        <Badge
                          size="lg"
                          radius="sm"
                          color="gray"
                          variant="outline"
                        >
                          <Highlight highlight={term}>{visaClass}</Highlight>
                        </Badge>
                        <Highlight highlight={term}>
                          {description ?? ""}
                        </Highlight>
                      </Group>
                    }
                  />
                ),
              )}
            </ListRows>
          </Box>
        </details>
      )}
    </Stack>
  );
}
