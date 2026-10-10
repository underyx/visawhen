import { Anchor, Stack, Text, Title } from "@mantine/core";
import { GetStaticProps } from "next";
import Head from "next/head";
import Link from "next/link";
import React from "react";
import { getPathSummaryData } from "../api/timeline";
import classes from "../components/Home.module.css";
import { ListRow, ListRows } from "../components/ListRow";
import { webSite } from "../components/structuredData";
import { PATHS, pathSummary } from "../components/timeline";

// The front door: the visitor picks the path that matches their case and
// gets its timeline. Each path's line here is what its first steps take
// right now, from the same numbers its timeline page shows.

interface PathCard {
  slug: string;
  title: string;
  who: string;
  /** "I-130: most likely 11–22 months, NVC: 24–54 days, then the interview
   * queue at your consulate." */
  summary: string;
}

interface Props {
  paths: PathCard[];
}

export const getStaticProps: GetStaticProps<Props> = async () => ({
  props: {
    paths: await Promise.all(
      PATHS.map(async (path) => ({
        slug: path.slug,
        title: path.title,
        who: path.who,
        summary: pathSummary(path, await getPathSummaryData(path)),
      })),
    ),
  },
});

/** The sections, for people who want the numbers without a path */
const SECTIONS = [
  {
    href: "/uscis",
    title: "USCIS processing times",
    text: "Every form, with the trend and your field office.",
  },
  {
    href: "/nvc",
    title: "National Visa Center wait times",
    text: "Case creation and document review, week by week.",
  },
  {
    href: "/consulates",
    title: "Consulate interview queues",
    text: "Which month each consulate is scheduling, and the visas it issues.",
  },
  {
    href: "/visa-bulletin",
    title: "Visa Bulletin dates",
    text: "Priority date cutoffs and how far they moved.",
  },
];

// The site's name leads, for people who search for the site by name
const TITLE = "VisaWhen: when will your US visa or green card come?";
const DESCRIPTION =
  "Say where your US immigration case is, and see when each step will most likely come, as dates: USCIS processing times, National Visa Center waits, consulate interview queues and the Visa Bulletin, for family, fiancé(e), employment and citizenship cases.";

export default function Home({ paths }: Props) {
  return (
    <>
      <Head>
        <title>{TITLE}</title>
        <meta name="description" content={DESCRIPTION} />
        <link rel="canonical" href="https://visawhen.com" />
        <meta property="og:title" content={TITLE} />
        <meta property="og:description" content={DESCRIPTION} />
        <meta property="og:url" content="https://visawhen.com" />
        <script {...webSite()} />
      </Head>
      <header className={classes.hero}>
        <Title order={1} className={classes.title}>
          When will your case move?
        </Title>
        <Text className={classes.lead}>
          Pick the path that matches your case, say where it is, and see when
          each step will most likely come, from the newest government numbers.
        </Text>
      </header>
      <ListRows>
        {paths.map(({ slug, title, who, summary }) => (
          <ListRow
            key={slug}
            href={`/timeline/${slug}`}
            label={
              <Stack gap={4}>
                <Text fw={600}>{title}</Text>
                <Text size="sm" c="dimmed">
                  {who}
                </Text>
                <Text size="sm">{summary}</Text>
              </Stack>
            }
          />
        ))}
      </ListRows>
      <Stack gap="sm" className={classes.sections}>
        <Title order={2}>Or look up the numbers</Title>
        <Text>
          Every timeline is built from these pages, which show the trend, the
          source and how recent each number is.
        </Text>
        <ul className={classes.sectionList}>
          {SECTIONS.map(({ href, title, text }) => (
            <li key={href}>
              <Anchor component={Link} href={href} fw={600}>
                {title}
              </Anchor>
              <Text size="sm" c="dimmed">
                {text}
              </Text>
            </li>
          ))}
        </ul>
      </Stack>
      <Text size="xs" c="dimmed" className={classes.footnote}>
        These are the common routes, not legal advice: an immigration lawyer or
        accredited representative can tell you which one is yours and whether
        you qualify.
      </Text>
    </>
  );
}
