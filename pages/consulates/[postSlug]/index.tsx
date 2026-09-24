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
  getPost,
  getRecentIssuancesByClass,
  getRecentWindow,
  getVisaClassSlugsForPost,
  RecentVisaClassIssuancesRow,
  RecentWindow,
  VisaClassRow,
} from "../../../api/consulates";
import {
  formatMonth,
  formatMonthlyRate,
  formatShortIvMonth,
  IvSchedule,
  monthsBehind,
} from "../../../components/consulates";
import IvScheduleCard, {
  describeRelativeQueue,
  listsPostAsCurrent,
} from "../../../components/IvScheduleCard";
import { ListRow, ListRows } from "../../../components/ListRow";
import { normalize } from "../../../components/search";
import {
  Badge,
  Breadcrumbs,
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
  visaClasses: VisaClassRow[];
  availableVisaClasses: string[];
  /** Visas issued per class in the last 12 months of the data */
  recentIssuances: RecentVisaClassIssuancesRow[];
  recentWindow: RecentWindow;
  /** The date of State's newest IV Scheduling Status Tool update we have */
  ivScheduleAsOf: string;
  /** The post's line in it, or null when it does not list the post */
  ivSchedule: IvSchedule | null;
}

export const getStaticPaths: GetStaticPaths = async () => {
  const posts = await getAllPosts();
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

  return {
    props: {
      postSlug,
      postName: postInfo.post,
      visaClasses: await getAllVisaClasses(),
      availableVisaClasses: await getVisaClassSlugsForPost(postSlug),
      recentIssuances: await getRecentIssuancesByClass(postSlug),
      recentWindow: await getRecentWindow(),
      ivScheduleAsOf: await getIvScheduleAsOf(),
      ivSchedule: await getIvSchedule(postSlug),
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
  visaClasses,
  availableVisaClasses,
  recentIssuances,
  recentWindow,
  ivScheduleAsOf,
  ivSchedule,
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

  const canonicalUrl = `https://visawhen.com/consulates/${postSlug}`;
  // Posts State lists with a month for immediate relatives are titled by
  // their interview queue; the rest keep the issuance title. The post itself
  // is called current only when every category State lists is.
  const relativeCutoff = ivSchedule?.relative ?? null;
  const title =
    ivSchedule === null || relativeCutoff === null
      ? `${postName} visas issued by class`
      : `${postName} immigrant visa interview wait: ${
          monthsBehind(ivSchedule.asOf, relativeCutoff) > 0
            ? `scheduling ${formatShortIvMonth(relativeCutoff)} cases`
            : listsPostAsCurrent(ivSchedule)
            ? "listed as current"
            : "immediate relatives listed as current"
        }`;
  const description =
    describeRelativeQueue(postName, ivSchedule) ??
    `How many visas ${postName} issued every month in each of ${
      availableVisaClasses.length
    } visa classes, from State Department statistics through ${formatMonth(
      recentWindow.to,
    )}.`;

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
      <IvScheduleCard
        postName={postName}
        asOf={ivScheduleAsOf}
        schedule={ivSchedule}
      />
      <Title order={2}>
        <Breadcrumbs
          separator="›"
          styles={{ separator: { fontSize: "1.5rem" } }}
        >
          <Text>{postName}</Text>
          <Text>Select your visa type</Text>
        </Breadcrumbs>
      </Title>
      <TextInput
        size="lg"
        leftSection={<SearchIcon />}
        type="text"
        placeholder="DL6"
        onChange={setTerm}
      />
      <Text size="sm" c="dimmed">
        Badges: average visas issued per month, {formatMonth(recentWindow.from)}{" "}
        to {formatMonth(recentWindow.to)}.
      </Text>
      <ListRows>
        {filteredVisas.map(({ visaClass, visaClassSlug, description }) => {
          const hasAnyIssued = availableVisaClassesSet.has(visaClassSlug);
          return (
            <ListRow
              key={visaClassSlug}
              href={`/consulates/${postSlug}/${visaClassSlug}`}
              hardNavigation
              disabled={!hasAnyIssued}
              rightSection={
                <Badge
                  size="lg"
                  radius="sm"
                  variant="outline"
                  color="gray"
                  tt="none"
                  fw={500}
                >
                  {hasAnyIssued
                    ? formatMonthlyRate(
                        (recentMap.get(visaClassSlug) ?? 0) / 12,
                      )
                    : "never issued here"}
                </Badge>
              }
              label={
                <Group gap="xs">
                  <Badge
                    size="lg"
                    radius="sm"
                    color={hasAnyIssued ? "blue" : "gray"}
                    variant={hasAnyIssued ? "light" : "outline"}
                  >
                    <Highlight highlight={term}>{visaClass}</Highlight>
                  </Badge>
                  <Highlight highlight={term}>{description ?? ""}</Highlight>
                </Group>
              }
            />
          );
        })}
      </ListRows>
    </Stack>
  );
}
