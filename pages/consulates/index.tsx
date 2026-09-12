import { SearchIcon } from "../../components/icons";
import { Badge, Highlight, Stack, TextInput, Title } from "@mantine/core";
import { sortBy } from "lodash";
import { GetStaticProps } from "next";
import Head from "next/head";
import React, { useMemo } from "react";
import {
  ConsulateBaselineRow,
  getAllPosts,
  getConsulateBaselines,
  PostRow,
} from "../../api/consulates";
import { formatMonthlyRate } from "../../components/consulates";
import { ListRow, ListRows } from "../../components/ListRow";
import { normalize } from "../../components/search";
import { useInputState } from "@mantine/hooks";

interface Props {
  posts: PostRow[];
  baselines: ConsulateBaselineRow[];
}

export const getStaticProps: GetStaticProps<Props> = async () => ({
  props: {
    posts: await getAllPosts(),
    baselines: await getConsulateBaselines(),
  },
});

function sortItems(
  posts: PostRow[],
  baselineMap: Map<string, number>,
): PostRow[] {
  return sortBy(posts, [
    ({ postSlug }) => -(baselineMap.get(postSlug) ?? -1),
    "post",
  ]);
}

export default function ConsulateSelect({ posts, baselines }: Props) {
  const baselineMap = useMemo<Map<string, number>>(
    () => new Map(baselines.map((row) => [row.postSlug, row.issuances])),
    [baselines],
  );
  const [term, setTerm] = useInputState("");
  const filteredPosts = useMemo<PostRow[]>(() => {
    const normalizedTerm = normalize(term);
    return sortItems(
      posts.filter(({ post }) => normalize(post).includes(normalizedTerm)),
      baselineMap,
    );
  }, [baselineMap, posts, term]);

  const description = `See how long the visa backlog is at any of ${posts.length} consulates.`;

  return (
    <Stack>
      <Head>
        <title>Consulate visa backlogs</title>
        <meta name="description" content={description} />
        <link rel="canonical" href="https://visawhen.com/consulates" />
        <meta property="og:title" content="Consulate visa backlogs" />
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
                normally {formatMonthlyRate(baselineMap.get(postSlug))}
              </Badge>
            }
            label={<Highlight highlight={term}>{post}</Highlight>}
          />
        ))}
      </ListRows>
    </Stack>
  );
}
