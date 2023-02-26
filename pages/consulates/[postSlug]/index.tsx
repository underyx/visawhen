import { faChevronLeft, faSearch } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { deburr, sortBy } from "lodash";
import { GetStaticPaths, GetStaticProps } from "next";
import { useRouter } from "next/dist/client/router";
import Head from "next/head";
import Link from "next/link";
import React, { useEffect, useMemo, useState } from "react";
import {
  getAllPosts,
  getAllVisaClasses,
  getPost,
  getSlugPairs,
  getVisaClassBaselines,
  VisaClassBaselineRow,
  VisaClassRow,
} from "../../../api/consulates";
import numeral from "numeral";
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

export const getStaticPaths: GetStaticPaths = async () => {
  const posts = await getAllPosts();
  return {
    paths: posts.map((row) => ({ params: { postSlug: row.postSlug } })),
    fallback: false,
  };
};

export const getStaticProps: GetStaticProps = async ({ params }) => {
  if (params === undefined) return { notFound: true };
  const { postSlug } = params;
  if (postSlug === undefined || typeof postSlug !== "string")
    return { notFound: true };

  const postInfo = await getPost(postSlug);
  if (postInfo === undefined) return { notFound: true };

  const availableVisaClasses = new Set<string>(
    (await getSlugPairs())
      .filter((row) => row.postSlug === postSlug)
      .map((row) => row.visaClassSlug),
  );

  return {
    props: {
      visaClasses: await getAllVisaClasses(),
      availableVisaClasses: Array.from(availableVisaClasses),
      postName: postInfo.post,
      baselines: await getVisaClassBaselines(postSlug),
    },
  };
};

interface Props {
  visaClasses: VisaClassRow[];
  availableVisaClasses: string[];
  postName: string;
  baselines: VisaClassBaselineRow[];
}

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
  visaClasses,
  availableVisaClasses,
  postName,
  baselines,
}: Props) {
  const router = useRouter();

  const baselineMap = useMemo<Map<string, number>>(
    () => new Map(baselines.map((row) => [row.visaClassSlug, row.issuances])),
    [baselines],
  );
  const [term, setTerm] = useInputState("");

  const [filteredVisas, setFilteredVisas] = useState<VisaClassRow[]>([]);
  const [availableVisaClassesSet, setAvailableVisaClassesSet] = useState<
    Set<string>
  >(new Set());

  useEffect(() => {
    setAvailableVisaClassesSet(new Set<string>(availableVisaClasses));
  }, [availableVisaClasses, setAvailableVisaClassesSet]);

  useEffect(() => {
    const normalizedTerm = deburr(term).toLowerCase().replace(/\W/, "");
    setFilteredVisas(
      sortItems(
        visaClasses.filter(
          ({ visaClassSlug, description }) =>
            visaClassSlug.includes(normalizedTerm) ||
            deburr(description ?? "")
              .toLowerCase()
              .replace(/\W/, "")
              .includes(normalizedTerm),
        ),
        baselineMap,
      ),
    );
  }, [baselineMap, visaClasses, term, setFilteredVisas]);

  const { postSlug } = router.query;
  if (typeof postSlug !== "string") return;

  return (
    <Stack>
      <Head>
        <title>{postName} visa backlog</title>
        <meta
          name="description"
          content={`See how long the visa backlog is at ${postName} in any of ${availableVisaClasses.length} visa categories.`}
        />
        <link
          rel="canonical"
          href={`https://visawhen.com/consulates/${postSlug}`}
        />
        <meta property="og:title" content={`${postName} visa backlogs`} />
        <meta
          property="og:description"
          content={`See how long the visa backlog is at ${postName} in any of ${availableVisaClasses.length} visa categories.`}
        />
        <meta
          property="og:url"
          content={`https://visawhen.com/consulates/${postSlug}`}
        />
      </Head>
      <Button
        variant="outline"
        component={Link}
        href="/consulates"
        size="xs"
        leftIcon={<FontAwesomeIcon icon={faChevronLeft} />}
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
        icon={<FontAwesomeIcon icon={faSearch} />}
        type="text"
        placeholder="DL6"
        onChange={setTerm}
      />
      <Button.Group orientation="vertical">
        {filteredVisas.map(({ visaClass, visaClassSlug, description }) => {
          const hasAnyIssued = availableVisaClassesSet.has(visaClassSlug);
          return (
            <Button
              size="lg"
              variant="default"
              disabled={!hasAnyIssued}
              key={visaClassSlug}
              component={Link}
              href={`/consulates/${postSlug}/${visaClassSlug}/`}
              styles={(theme) => ({
                root: {
                  paddingLeft: "1rem",
                  paddingRight: "1rem",
                  "&[data-disabled]": {
                    color: theme.colors.gray[7],
                  },
                },
                inner: {
                  justifyContent: "space-between",
                  fontSize: "1rem",
                  fontWeight: 400,
                },
              })}
              rightIcon={
                <Badge
                  size="lg"
                  radius="sm"
                  variant="outline"
                  color="gray"
                  style={{ textTransform: "none", fontWeight: "500" }}
                >
                  {!hasAnyIssued
                    ? "never issued here"
                    : `normally ${numeral(baselineMap.get(visaClassSlug))
                        .format(
                          (baselineMap.get(visaClassSlug) ?? 0) > 10
                            ? "0a"
                            : "0.0a",
                        )
                        .toUpperCase()}/mo`}
                </Badge>
              }
            >
              <Group spacing="xs" noWrap>
                <Badge
                  size="lg"
                  radius="sm"
                  color={!hasAnyIssued ? "gray" : "blue"}
                  variant={!hasAnyIssued ? "outline" : "light"}
                >
                  <Highlight highlight={term}>{visaClass}</Highlight>
                </Badge>{" "}
                <Highlight highlight={term}>{description ?? ""}</Highlight>
              </Group>
            </Button>
          );
        })}
      </Button.Group>
    </Stack>
  );
}
