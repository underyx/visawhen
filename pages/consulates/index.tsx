import { SearchIcon } from "../../components/icons";
import {
  Badge,
  Box,
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
  /** The date of State's newest IV Scheduling Status Tool update we have,
   * for the meta description */
  ivScheduleAsOf: string;
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

interface RateBadgeProps {
  /** Visas the post issued in the last 12 months of the data */
  issuances: number;
  /** The newest month it issued any in, when that is before those 12
   * months (Props.lastIssued) */
  lastIssued: string | undefined;
}

/** The badge at a row's right: the post's visas per month, or "none" with
 * the month it last issued any as a small line under it. One badge saying
 * "none since Sep 2024" was wide enough to wrap a long post name onto three
 * lines on a phone; the /uscis rows put their category under the badge the
 * same way. */
function RateBadge({ issuances, lastIssued }: RateBadgeProps) {
  const badge = (text: string) => (
    <Badge
      size="lg"
      radius="sm"
      variant="outline"
      color="gray"
      tt="none"
      fw={500}
    >
      {text}
    </Badge>
  );
  if (issuances > 0) return badge(formatMonthlyRate(issuances / 12));
  if (lastIssued === undefined) return badge("none issued");
  return (
    <Stack gap={2} align="flex-end">
      {badge("none")}
      <Text size="xs" c="dimmed" ta="right">
        since {formatMonth(lastIssued)}
      </Text>
    </Stack>
  );
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
    <Stack gap="xl">
      <Head>
        <title>{title}</title>
        <meta name="description" content={description} />
        <link rel="canonical" href="https://visawhen.com/consulates" />
        <meta property="og:title" content={title} />
        <meta property="og:description" content={description} />
        <meta property="og:url" content="https://visawhen.com/consulates" />
      </Head>
      <Box>
        <Title order={1}>US embassies and consulates</Title>
        <Text size="lg">
          How many visas each one issues per month,{" "}
          {formatMonth(recentWindow.from)} – {formatMonth(recentWindow.to)}, in
          the State Department&rsquo;s own figures.
        </Text>
      </Box>
      {/* one block: a Stack would pay its gap around the empty live region */}
      <div>
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
      </div>
      {filteredPosts.length > 0 && (
        <ListRows>
          {filteredPosts.map(({ post, postSlug, country }) => (
            <ListRow
              key={postSlug}
              href={`/consulates/${postSlug}`}
              hardNavigation
              rightSection={
                <RateBadge
                  issuances={recentMap.get(postSlug) ?? 0}
                  lastIssued={lastIssued[postSlug]}
                />
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
