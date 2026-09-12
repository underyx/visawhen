import Link from "next/link";
import { GetStaticPaths, GetStaticProps } from "next";
import React from "react";
import {
  getBaseline,
  getBacklog,
  getSlugPairs,
  getPost,
  getVisaClass,
  BacklogRow,
} from "../../../api/consulates";
import Head from "next/head";
import ConsulateChart from "../../../components/ConsulateChart";
import { ChevronLeftIcon } from "../../../components/icons";
import { Button, Group, Stack, Text, Title } from "@mantine/core";

interface Props {
  postSlug: string;
  visaClassSlug: string;
  baselineRate: number;
  backlog: BacklogRow[];
  postName: string;
  visaClassName: string;
  visaClassDescription: string | null;
}

export const getStaticPaths: GetStaticPaths = async () => {
  const rows = await getSlugPairs();
  return {
    paths: rows.map(({ postSlug, visaClassSlug }) => ({
      params: { postSlug, visaClassSlug },
    })),
    fallback: false,
  };
};

export const getStaticProps: GetStaticProps<Props> = async ({ params }) => {
  if (
    params === undefined ||
    typeof params.postSlug !== "string" ||
    typeof params.visaClassSlug !== "string"
  )
    return { notFound: true };
  const { postSlug, visaClassSlug } = params;

  const post = await getPost(postSlug);
  const visaClass = await getVisaClass(visaClassSlug);
  const backlog = await getBacklog(postSlug, visaClassSlug);
  const baseline = await getBaseline(postSlug, visaClassSlug);

  if (
    post === undefined ||
    visaClass === undefined ||
    backlog.length === 0 ||
    baseline === undefined
  )
    return { notFound: true };

  return {
    props: {
      postSlug,
      visaClassSlug,
      baselineRate: baseline.issuances,
      backlog,
      postName: post.post,
      visaClassName: visaClass.visaClass,
      visaClassDescription: visaClass.description,
    },
  };
};

// The months are stored as UTC midnight; format them as such, or the
// (client-side) render in an American time zone lands on the previous
// month's last day and disagrees with the prerendered HTML.
const monthFormatter = new Intl.DateTimeFormat("en-US", {
  month: "long",
  timeZone: "UTC",
});

function assessment(
  { issuances, expectedDelta }: BacklogRow,
  postName: string,
  monthName: string,
): string {
  if (expectedDelta === null)
    return `It seems like ${postName} is operating as normal.`;
  if (issuances > expectedDelta * 1.2 && issuances >= 10)
    return `It seems like ${postName} is hard at work catching up on their backlog from COVID.`;
  if (issuances < expectedDelta * 0.8 && expectedDelta >= 10)
    return `It seems like ${postName} is still not operating at full capacity.`;
  if (issuances < 10 || expectedDelta < 10)
    return `With so few visas ever issued, it's difficult to tell how well ${postName} is doing just by looking at this ${monthName}.`;
  return `It seems like ${postName} is operating as normal.`;
}

export default function ConsulateStats({
  postSlug,
  visaClassSlug,
  baselineRate,
  backlog,
  postName,
  visaClassName,
  visaClassDescription,
}: Props) {
  const lastMonth = backlog[backlog.length - 1];
  const lastMonthName = monthFormatter.format(new Date(lastMonth.month));
  const visaClassWithDescription =
    visaClassDescription === null
      ? visaClassName
      : `${visaClassName} (${visaClassDescription})`;

  const title = `The ${postName} consulate's ${visaClassWithDescription} visa issuance rate`;
  const description = `${postName} used to issue ${
    Math.round(baselineRate * 10) / 10
  } ${visaClassWithDescription} visas in an average ${lastMonthName}. This ${lastMonthName}, they issued ${
    lastMonth.issuances
  }.`;
  const canonicalUrl = `https://visawhen.com/consulates/${postSlug}/${visaClassSlug}`;

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
      <Group gap="xs" style={{ alignSelf: "flex-start" }}>
        <Button
          variant="outline"
          component={Link}
          href="/consulates"
          size="xs"
          leftSection={<ChevronLeftIcon />}
        >
          Change consulate
        </Button>
        {/* Plain anchor: the consulate page's _next/data JSON is not
            deployed (see the note in components/ListRow.tsx), so a Link
            would only 404 on it before hard-navigating anyway. */}
        <Button
          variant="outline"
          component="a"
          href={`/consulates/${postSlug}`}
          size="xs"
          leftSection={<ChevronLeftIcon />}
        >
          Change visa class
        </Button>
      </Group>

      <Title order={1}>
        {postName}&rsquo;s {visaClassName} visa issuance rate
      </Title>
      {visaClassDescription !== null && (
        <Text size="xl">{visaClassDescription}</Text>
      )}
      <Text>
        Before COVID, {postName} issued{" "}
        <strong>{Math.round((lastMonth.expectedDelta ?? 0) * 10) / 10}</strong>{" "}
        {visaClassName} visas in an average {lastMonthName}. This{" "}
        {lastMonthName}, they issued <strong>{lastMonth.issuances}</strong>.{" "}
        {assessment(lastMonth, postName, lastMonthName)}
      </Text>
      <ConsulateChart backlog={backlog} />
    </Stack>
  );
}
