import { sortBy } from "../../components/sortBy";
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
import { type GetStaticProps } from "next";
import Head from "next/head";
import React, { useMemo } from "react";
import {
  getAllPosts,
  getIvScheduleAsOf,
  getIvScheduleMonths,
  getLastIssuedByPost,
  getRecentIssuancesByPost,
  getRecentToolIssuancesByPost,
  getRecentWindow,
  type PostRow,
  type RecentPostIssuancesRow,
  type RecentWindow,
} from "../../api/consulates";
import {
  FEW_IMMIGRANT_VISAS,
  formatMonth,
  formatMonthlyRate,
  postListBadge,
} from "../../components/consulates";
import { formatMonthRange, formatShortDate } from "../../components/dates";
import { useToday } from "../../components/Freshness";
import { ListRow, ListRows } from "../../components/ListRow";
import { scheduleOverrideFor } from "../../components/policy";
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
   * which the badges read their months against */
  ivScheduleAsOf: string;
  /** Each post's month in that update for spouses, children and parents of
   * US citizens, by post slug: null where State gives N/A. Posts the tool
   * does not list are left out. */
  ivMonths: Record<string, string | null>;
  /** Family and employment immigrant visas, the classes the tool covers,
   * issued per post in the last 12 months of the data, by post slug */
  toolIssued: Record<string, number>;
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
      ivMonths: await getIvScheduleMonths(),
      toolIssued: await getRecentToolIssuancesByPost(),
      lastIssued: Object.fromEntries(
        Object.entries(await getLastIssuedByPost()).filter(
          ([, month]) => month < recentWindow.from,
        ),
      ),
    },
  };
};

/** The posts in State's interview update first, so that the first screen
 * shows months, not "Not listed"; then the most visas a month first. */
function sortItems(
  posts: Post[],
  recentMap: Map<string, number>,
  ivMonths: Props["ivMonths"],
): Post[] {
  return sortBy(
    posts,
    ({ postSlug }) => (ivMonths[postSlug] === undefined ? 1 : 0),
    ({ postSlug }) => -(recentMap.get(postSlug) ?? -1),
    ({ post }) => post,
  );
}

interface PostBadgeProps {
  /** The date of State's newest tool update (Props.ivScheduleAsOf) */
  asOf: string;
  /** The post's month in it for spouses, children and parents of US
   * citizens (Props.ivMonths), undefined when the tool does not list it */
  month: string | null | undefined;
  /** Whether a notice means the tool's month is no queue at the post */
  overridden: boolean;
  /** Props.toolIssued for the post */
  toolIssued: number;
  /** Visas the post issued in the last 12 months of the data */
  issuances: number;
  /** The newest month it issued any in, when that is before those 12
   * months (Props.lastIssued) */
  lastIssued: string | undefined;
}

/** The badge at a row's right is what the post's page leads with, most
 * often its interview month (postListBadge), with its visas per month as a
 * small line under it. The month is what most visitors come for, so it gets
 * the badge; the rate still tells a busy post from a quiet one, and a second
 * badge or a wider one would squeeze a long post name onto three lines on a
 * phone, so it goes in the line, as the /uscis rows put their category. */
function PostBadge({
  asOf,
  month,
  overridden,
  toolIssued,
  issuances,
  lastIssued,
}: PostBadgeProps) {
  const { badge, quiet, line } = postListBadge({
    asOf,
    month,
    overridden,
    toolIssued,
  });
  return (
    <Stack gap={2} align="flex-end">
      <Badge
        size="lg"
        radius="sm"
        variant={quiet ? "light" : "outline"}
        color="gray"
        tt="none"
        fw={500}
      >
        {badge}
      </Badge>
      <Text size="xs" c="dimmed" ta="right">
        {line === "few"
          ? "few immigrant visas"
          : issuances > 0
            ? formatMonthlyRate(issuances / 12)
            : lastIssued === undefined
              ? "none issued"
              : `none since ${formatMonth(lastIssued)}`}
      </Text>
    </Stack>
  );
}

export default function ConsulateSelect({
  posts,
  recentIssuances,
  recentWindow,
  ivScheduleAsOf,
  ivMonths,
  toolIssued,
  lastIssued,
}: Props) {
  const recentMap = useMemo<Map<string, number>>(
    () => new Map(recentIssuances.map((row) => [row.postSlug, row.issuances])),
    [recentIssuances],
  );
  // Decided as each post's page decides its title, by today's date on the
  // client and by the notices' own dates while prerendering, so a badge and
  // the page it links to never disagree.
  const today = useToday();
  const overridden = useMemo<Set<string>>(
    () =>
      new Set(
        posts
          .map(({ postSlug }) => postSlug)
          .filter(
            (postSlug) =>
              scheduleOverrideFor(postSlug, ivScheduleAsOf, today) !== null,
          ),
      ),
    [posts, ivScheduleAsOf, today],
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
      ivMonths,
    );
  }, [recentMap, ivMonths, posts, term]);

  const title = "US consulates: immigrant visa interview scheduling";
  const description = `Each U.S. embassy and consulate's interview month for spouses, children and parents of U.S. citizens, the month of documentarily complete cases NVC is scheduling immigrant visa interviews for, from the State Department's scheduling tool (updated ${formatShortDate(
    ivScheduleAsOf,
  )}), and how many visas it issues per month.`;

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
          Each one&rsquo;s interview month, and how many visas it issues per
          month.
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
                <PostBadge
                  asOf={ivScheduleAsOf}
                  month={ivMonths[postSlug]}
                  overridden={overridden.has(postSlug)}
                  toolIssued={toolIssued[postSlug] ?? 0}
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
      {/* In the order a row reads, badge then line, with the badge's other
          states last: "those 12 months" points back to the visas' line.
          "most" is State's own word, which the month can move back on. */}
      <Stack gap="xs">
        <Text size="xs" c="dimmed">
          Interview month: the National Visa Center (NVC) is now scheduling most
          interviews for cases where it accepted all the documents in that
          month, for spouses, children and parents of US citizens. From the
          State Department&rsquo;s update of {formatShortDate(ivScheduleAsOf)}.
        </Text>
        <Text size="xs" c="dimmed">
          Visas: the average issued per month,{" "}
          {formatMonthRange(recentWindow.from, recentWindow.to)}, in the State
          Department&rsquo;s own figures.
        </Text>
        <Text size="xs" c="dimmed">
          Not listed: the post is not in that update. Notice: visa services
          there are paused, limited or moved; its page says more. Few immigrant
          visas: the State Department lists it as current, but it issued fewer
          than {FEW_IMMIGRANT_VISAS} family or employment immigrant visas in
          those 12 months.
        </Text>
      </Stack>
    </Stack>
  );
}
