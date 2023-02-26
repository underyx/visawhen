import { faSearch } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  Flex,
  Stack,
  TextInput,
  Text,
  Title,
  Badge,
  Card,
  Paper,
  Highlight,
  Button,
} from "@mantine/core";
import { deburr, kebabCase, sortBy } from "lodash";
import { GetStaticProps } from "next";
import Head from "next/head";
import Link from "next/link";
import numeral from "numeral";
import React, { useEffect, useMemo, useState } from "react";
import {
  ConsulateBaselineRow,
  getAllPosts,
  getConsulateBaselines,
  PostRow,
} from "../../api/consulates";
import { useInputState } from "@mantine/hooks";
export const getStaticProps: GetStaticProps = async () => ({
  props: {
    posts: await getAllPosts(),
    baselines: await getConsulateBaselines(),
  },
});

interface Props {
  posts: PostRow[];
  baselines: ConsulateBaselineRow[];
}

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
  const [filteredPosts, setFilteredPosts] = useState<PostRow[]>(
    sortItems(posts, baselineMap),
  );

  useEffect(() => {
    const normalizedTerm = kebabCase(deburr(term.toLowerCase()));
    setFilteredPosts(
      sortItems(
        posts.filter(({ postSlug }) => postSlug.includes(normalizedTerm)),
        baselineMap,
      ),
    );
  }, [baselineMap, posts, term, setFilteredPosts]);

  return (
    <Stack>
      <Head>
        <title>Consulate visa backlogs</title>
        <meta
          name="description"
          content={`See how long the visa backlog is at any of ${posts.length} consulates.`}
        />
        <link rel="canonical" href="https://visawhen.com/consulates" />
        <meta property="og:title" content="Consulate visa backlogs" />
        <meta
          property="og:description"
          content={`See how long the visa backlog is at any of ${posts.length} consulates.`}
        />
        <meta property="og:url" content="https://visawhen.com/consulates" />
      </Head>
      <Title order={2}>Select your consulate</Title>
      <TextInput
        size="lg"
        icon={<FontAwesomeIcon icon={faSearch} />}
        type="text"
        placeholder="Atlantis"
        onChange={setTerm}
      />
      <Button.Group orientation="vertical">
        {filteredPosts.map(({ post, postSlug }) => (
          <Button
            size="lg"
            variant="default"
            key={postSlug}
            component={Link}
            href={`/consulates/${postSlug}/`}
            styles={{ inner: { justifyContent: "space-between" } }}
            rightIcon={
              <Badge
                size="lg"
                radius="sm"
                variant="outline"
                color="gray"
                style={{ textTransform: "none", fontWeight: "500" }}
              >
                normally{" "}
                {numeral(baselineMap.get(postSlug))
                  .format((baselineMap.get(postSlug) ?? 0) > 10 ? "0a" : "0.0a")
                  .toUpperCase()}
                /mo
              </Badge>
            }
          >
            <Highlight highlight={term}>{post}</Highlight>
          </Button>
        ))}
      </Button.Group>
    </Stack>
  );
}
