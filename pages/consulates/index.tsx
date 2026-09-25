import { SearchIcon } from "../../components/icons";
import { Badge, Highlight, Stack, Text, TextInput, Title } from "@mantine/core";
import { sortBy } from "lodash";
import { GetStaticProps } from "next";
import Head from "next/head";
import React, { useMemo } from "react";
import {
  getAllPosts,
  getIvScheduleAsOf,
  getLastIssuedByPost,
  getRecentIssuancesByPost,
  getRecentWindow,
  PostRow,
  RecentPostIssuancesRow,
  RecentWindow,
} from "../../api/consulates";
import { formatMonth, formatMonthlyRate } from "../../components/consulates";
import { formatShortDate } from "../../components/Freshness";
import { ListRow, ListRows } from "../../components/ListRow";
import { normalize } from "../../components/search";
import { useInputState } from "@mantine/hooks";

interface Props {
  posts: PostRow[];
  /** Visas issued per post in the last 12 months of the data */
  recentIssuances: RecentPostIssuancesRow[];
  recentWindow: RecentWindow;
  /** The date of State's newest IV Scheduling Status Tool update we have */
  ivScheduleAsOf: string;
  /** For the posts that issued no visas in the last 12 months of the data:
   * the newest month they issued any in, by post slug */
  lastIssued: Record<string, string>;
}

export const getStaticProps: GetStaticProps<Props> = async () => {
  const recentWindow = await getRecentWindow();
  return {
    props: {
      posts: await getAllPosts(),
      recentIssuances: await getRecentIssuancesByPost(),
      recentWindow,
      ivScheduleAsOf: await getIvScheduleAsOf(),
      lastIssued: Object.fromEntries(
        Object.entries(await getLastIssuedByPost()).filter(
          ([, month]) => month < recentWindow.from,
        ),
      ),
    },
  };
};

function sortItems(
  posts: PostRow[],
  recentMap: Map<string, number>,
): PostRow[] {
  return sortBy(posts, [
    ({ postSlug }) => -(recentMap.get(postSlug) ?? -1),
    "post",
  ]);
}

export default function ConsulateSelect({
  posts,
  recentIssuances,
  recentWindow,
  ivScheduleAsOf,
  lastIssued,
}: Props) {
  const recentMap = useMemo<Map<string, number>>(
    () => new Map(recentIssuances.map((row) => [row.postSlug, row.issuances])),
    [recentIssuances],
  );
  const [term, setTerm] = useInputState("");
  const filteredPosts = useMemo<PostRow[]>(() => {
    const normalizedTerm = normalize(term);
    return sortItems(
      posts.filter(({ post }) => normalize(post).includes(normalizedTerm)),
      recentMap,
    );
  }, [recentMap, posts, term]);

  const title = "US consulates: immigrant visa interview queues";
  const description = `Which month of documentarily complete cases each U.S. embassy and consulate is scheduling for immigrant visa interviews, from the State Department (updated ${formatShortDate(
    ivScheduleAsOf,
  )}).`;

  return (
    <Stack>
      <Head>
        <title>{title}</title>
        <meta name="description" content={description} />
        <link rel="canonical" href="https://visawhen.com/consulates" />
        <meta property="og:title" content={title} />
        <meta property="og:description" content={description} />
        <meta property="og:url" content="https://visawhen.com/consulates" />
      </Head>
      <Title order={2}>Select your consulate</Title>
      <Text>
        Each consulate&rsquo;s page shows which month of documentarily complete
        cases NVC is scheduling there for immigrant visa interviews (State
        Department, updated {formatShortDate(ivScheduleAsOf)}).
      </Text>
      <TextInput
        size="lg"
        leftSection={<SearchIcon />}
        type="text"
        placeholder="Atlantis"
        onChange={setTerm}
      />
      <Text size="sm" c="dimmed">
        Badges: average visas issued per month, {formatMonth(recentWindow.from)}{" "}
        to {formatMonth(recentWindow.to)}.
      </Text>
      <ListRows>
        {filteredPosts.map(({ post, postSlug }) => (
          <ListRow
            key={postSlug}
            href={`/consulates/${postSlug}`}
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
                {(recentMap.get(postSlug) ?? 0) > 0
                  ? formatMonthlyRate((recentMap.get(postSlug) ?? 0) / 12)
                  : postSlug in lastIssued
                  ? `none since ${formatMonth(lastIssued[postSlug])}`
                  : "none issued"}
              </Badge>
            }
            label={<Highlight highlight={term}>{post}</Highlight>}
          />
        ))}
      </ListRows>
    </Stack>
  );
}
