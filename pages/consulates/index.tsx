import { SearchIcon } from "../../components/icons";
import {
  Anchor,
  Badge,
  Highlight,
  Stack,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { sortBy } from "lodash";
import { GetStaticProps } from "next";
import Head from "next/head";
import React, { useMemo } from "react";
import {
  getAllPosts,
  getIvScheduleAsOf,
  getIvSchedulePostCount,
  getIvScheduleSource,
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
import SearchStatus from "../../components/SearchStatus";
import { checkPostCountries, POST_COUNTRIES } from "../../api/searchTerms";
import { useInputState } from "@mantine/hooks";

interface Post extends PostRow {
  /** "Mexico", "Turkey (Türkiye)" */
  country: string;
}

interface Props {
  posts: Post[];
  /** Visas issued per post in the last 12 months of the data */
  recentIssuances: RecentPostIssuancesRow[];
  recentWindow: RecentWindow;
  /** The date of State's newest IV Scheduling Status Tool update we have */
  ivScheduleAsOf: string;
  /** How many posts that update lists */
  ivSchedulePosts: number;
  /** The tool's address */
  ivScheduleSource: string;
  /** For the posts that issued no visas in the last 12 months of the data:
   * the newest month they issued any in, by post slug */
  lastIssued: Record<string, string>;
}

export const getStaticProps: GetStaticProps<Props> = async () => {
  const recentWindow = await getRecentWindow();
  const posts = await getAllPosts();
  checkPostCountries(posts.map(({ postSlug }) => postSlug));
  return {
    props: {
      posts: posts.map((post) => ({
        ...post,
        country: POST_COUNTRIES[post.postSlug],
      })),
      recentIssuances: await getRecentIssuancesByPost(),
      recentWindow,
      ivScheduleAsOf: await getIvScheduleAsOf(),
      ivSchedulePosts: await getIvSchedulePostCount(),
      ivScheduleSource: await getIvScheduleSource(),
      lastIssued: Object.fromEntries(
        Object.entries(await getLastIssuedByPost()).filter(
          ([, month]) => month < recentWindow.from,
        ),
      ),
    },
  };
};

function sortItems(posts: Post[], recentMap: Map<string, number>): Post[] {
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
  ivSchedulePosts,
  ivScheduleSource,
  lastIssued,
}: Props) {
  const recentMap = useMemo<Map<string, number>>(
    () => new Map(recentIssuances.map((row) => [row.postSlug, row.issuances])),
    [recentIssuances],
  );
  const [term, setTerm] = useInputState("");
  const filteredPosts = useMemo<Post[]>(() => {
    const normalizedTerm = normalize(term);
    return sortItems(
      posts.filter(({ post, country }) =>
        [post, country].some((text) =>
          normalize(text).includes(normalizedTerm),
        ),
      ),
      recentMap,
    );
  }, [recentMap, posts, term]);

  const title = "US consulates: immigrant visa interview scheduling";
  const description = `The month of documentarily complete cases for which NVC is scheduling most immigrant visa interviews at U.S. embassies and consulates, from the State Department's scheduling tool (updated ${formatShortDate(
    ivScheduleAsOf,
  )}), and how many visas each one issued, by visa class.`;

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
      <Title order={1}>US embassies and consulates</Title>
      <Text>
        For the {ivSchedulePosts} embassies and consulates in the State
        Department&rsquo;s{" "}
        <Anchor href={ivScheduleSource} target="_blank" rel="noopener">
          interview-scheduling tool
        </Anchor>
        , their page shows the month of documentarily complete cases for which
        NVC is scheduling most immigrant visa interviews there (updated{" "}
        {formatShortDate(ivScheduleAsOf)}). Every post&rsquo;s page shows how
        many visas of each class it issued, from State Department figures
        through {formatMonth(recentWindow.to)}.
      </Text>
      <TextInput
        size="lg"
        label="Find your embassy or consulate"
        leftSection={<SearchIcon />}
        type="search"
        placeholder="e.g. Manila or Philippines"
        onChange={setTerm}
      />
      <SearchStatus
        term={term}
        count={filteredPosts.length}
        noun={["embassy or consulate", "embassies or consulates"]}
        hint="Try the city or the country, such as Manila or Philippines."
      />
      <Text size="sm" c="dimmed">
        Badges: average visas issued per month, {formatMonth(recentWindow.from)}{" "}
        to {formatMonth(recentWindow.to)}.
      </Text>
      {filteredPosts.length > 0 && (
        <ListRows>
          {filteredPosts.map(({ post, postSlug, country }) => (
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
              label={
                <>
                  <Highlight highlight={term} component="span">
                    {post}
                  </Highlight>{" "}
                  <Highlight
                    highlight={term}
                    component="span"
                    size="sm"
                    c="dimmed"
                  >
                    {country}
                  </Highlight>
                </>
              }
            />
          ))}
        </ListRows>
      )}
    </Stack>
  );
}
