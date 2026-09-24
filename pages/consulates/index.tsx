import { SearchIcon } from "../../components/icons";
import { Badge, Highlight, Stack, Text, TextInput, Title } from "@mantine/core";
import { sortBy } from "lodash";
import { GetStaticProps } from "next";
import Head from "next/head";
import React, { useMemo } from "react";
import {
  getAllPosts,
  getRecentIssuancesByPost,
  getRecentWindow,
  PostRow,
  RecentPostIssuancesRow,
  RecentWindow,
} from "../../api/consulates";
import { formatMonth, formatMonthlyRate } from "../../components/consulates";
import { ListRow, ListRows } from "../../components/ListRow";
import { normalize } from "../../components/search";
import { useInputState } from "@mantine/hooks";

interface Props {
  posts: PostRow[];
  /** Visas issued per post in the last 12 months of the data */
  recentIssuances: RecentPostIssuancesRow[];
  recentWindow: RecentWindow;
}

export const getStaticProps: GetStaticProps<Props> = async () => ({
  props: {
    posts: await getAllPosts(),
    recentIssuances: await getRecentIssuancesByPost(),
    recentWindow: await getRecentWindow(),
  },
});

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

  const title = "Visas issued by U.S. embassies and consulates";
  const description = `How many visas each of ${
    posts.length
  } U.S. embassies and consulates issued every month, from State Department statistics through ${formatMonth(
    recentWindow.to,
  )}.`;

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
                {formatMonthlyRate((recentMap.get(postSlug) ?? 0) / 12)}
              </Badge>
            }
            label={<Highlight highlight={term}>{post}</Highlight>}
          />
        ))}
      </ListRows>
    </Stack>
  );
}
