import { ChevronLeftIcon, SearchIcon } from "../../../components/icons";
import { sortBy } from "lodash";
import { GetStaticPaths, GetStaticProps } from "next";
import Head from "next/head";
import Link from "next/link";
import React, { useMemo } from "react";
import {
  getAllPosts,
  getAllVisaClasses,
  getPost,
  getVisaClassBaselines,
  getVisaClassSlugsForPost,
  VisaClassBaselineRow,
  VisaClassRow,
} from "../../../api/consulates";
import { formatMonthlyRate } from "../../../components/consulates";
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
  baselines: VisaClassBaselineRow[];
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
      baselines: await getVisaClassBaselines(postSlug),
    },
  };
};

function sortItems(
  visaClasses: VisaClassRow[],
  baselineMap: Map<string, number>,
): VisaClassRow[] {
  return sortBy(visaClasses, [
    ({ visaClassSlug }) => -(baselineMap.get(visaClassSlug) ?? -1),
    "visaClass",
  ]);
}

export default function ConsulateSelect({
  postSlug,
  postName,
  visaClasses,
  availableVisaClasses,
  baselines,
}: Props) {
  const baselineMap = useMemo<Map<string, number>>(
    () => new Map(baselines.map((row) => [row.visaClassSlug, row.issuances])),
    [baselines],
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
      baselineMap,
    );
  }, [baselineMap, visaClasses, term]);

  const canonicalUrl = `https://visawhen.com/consulates/${postSlug}`;
  const description = `See how long the visa backlog is at ${postName} in any of ${availableVisaClasses.length} visa categories.`;

  return (
    <Stack>
      <Head>
        <title>{`${postName} visa backlog`}</title>
        <meta name="description" content={description} />
        <link rel="canonical" href={canonicalUrl} />
        <meta property="og:title" content={`${postName} visa backlogs`} />
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
                    ? `normally ${formatMonthlyRate(
                        baselineMap.get(visaClassSlug),
                      )}`
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
