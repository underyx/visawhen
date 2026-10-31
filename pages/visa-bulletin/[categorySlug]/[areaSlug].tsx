import { Anchor, Box, Button, Stack, Text, Title } from "@mantine/core";
import { findLast, last } from "lodash";
import { type GetStaticPaths, type GetStaticProps } from "next";
import Head from "next/head";
import Link from "next/link";
import React from "react";
import { type Cutoff, getData } from "../../../api/visaBulletin";
import { ChevronLeftIcon } from "../../../components/icons";
import { ListRow, ListRows } from "../../../components/ListRow";
import MoreDetails from "../../../components/MoreDetails";
import { VISA_BULLETIN_URL } from "../../../components/links";
import { PolicyNews } from "../../../components/PolicyBanner";
import { Stat, Stats } from "../../../components/Stats";
import VisaBulletinCases from "../../../components/VisaBulletinCases";
import VisaBulletinChart from "../../../components/VisaBulletinChart";
import { breadcrumbList } from "../../../components/structuredData";
import {
  addMonthsToMonth,
  type Area,
  areaBySlug,
  bornInText,
  type Category,
  categoryBySlug,
  CATEGORIES,
  chartAreas,
  type ChartKey,
  cutoffChange,
  formatBulletinMonth,
  formatCutoff,
  formatMonths,
  getMovement,
  getSeries,
  isDate,
  monthsBetweenDates,
  monthStart,
  type Movement,
  newestMonth,
  pagePath,
  PRIORITY_DATE_DEFINITION,
  type Series,
} from "../../../components/visaBulletin";
import { daysBetween, useToday } from "../../../components/Freshness";
import TemporaryNotice from "../../../components/TemporaryNotice";

// The page leads with the newest bulletin's two cutoffs as figures, each
// with how it moved since the bulletin before, then one sentence on what
// they mean. The news and the special cases come after the numbers as
// chips, and how the line has moved after those.

interface OtherLink {
  name: string;
  href: string;
  cutoff: string;
}

interface Props {
  category: Category;
  area: Area;
  /** For people "born in India" (bornInText) */
  bornIn: string;
  /** The newest bulletin's month, "2026-10" */
  month: string;
  bulletinUrl: string;
  series: Record<ChartKey, Series>;
  /** The same category in the bulletin's other areas */
  otherAreas: OtherLink[];
  /** The area's other categories of the same kind (family or employment) */
  otherCategories: OtherLink[];
}

export const getStaticPaths: GetStaticPaths = async () => {
  const data = await getData();
  const chart = data.bulletins[newestMonth(data)].finalAction;
  return {
    paths: CATEGORIES.filter(({ key }) => key in chart).flatMap((category) =>
      chartAreas({ [category.key]: chart[category.key] }).map((area) => ({
        params: { categorySlug: category.slug, areaSlug: area.slug },
      })),
    ),
    fallback: false,
  };
};

export const getStaticProps: GetStaticProps<Props> = async ({ params }) => {
  const category = categoryBySlug(String(params?.categorySlug));
  const area = areaBySlug(String(params?.areaSlug));
  if (category === undefined || area === undefined) return { notFound: true };
  const data = await getData();
  const month = newestMonth(data);
  const bulletin = data.bulletins[month];
  const chart = bulletin.finalAction;
  const areas = chartAreas({ [category.key]: chart[category.key] });
  return {
    props: {
      category,
      area,
      bornIn: bornInText(area, areas),
      month,
      bulletinUrl: bulletin.url,
      series: {
        finalAction: getSeries(data, "finalAction", category.key, area.key),
        datesForFiling: getSeries(
          data,
          "datesForFiling",
          category.key,
          area.key,
        ),
      },
      otherAreas: areas
        .filter(({ key }) => key !== area.key)
        .map((other) => ({
          name: other.name,
          href: pagePath(category, other),
          cutoff: chart[category.key][other.key],
        })),
      otherCategories: CATEGORIES.filter(
        (other) =>
          other.kind === category.kind &&
          other.key !== category.key &&
          chart[other.key]?.[area.key] !== undefined,
      ).map((other) => ({
        name: other.name,
        href: pagePath(other, area),
        cutoff: chart[other.key][area.key],
      })),
    },
  };
};

/** State publishes a month's bulletin around the middle of the month before.
 * A week into a month with no bulletin for it, ours are behind. */
const GRACE_DAYS = 7;

function StaleNotice({ month }: { month: string }) {
  const today = useToday();
  if (today === null) return null;
  const due = monthStart(addMonthsToMonth(month, 1));
  if (daysBetween(due, today) <= GRACE_DAYS) return null;
  return (
    <TemporaryNotice>
      The State Department has probably published a bulletin newer than{" "}
      {formatBulletinMonth(month)}. See{" "}
      <Anchor
        href={VISA_BULLETIN_URL}
        target="_blank"
        rel="noopener noreferrer"
      >
        the newest bulletin on its website
      </Anchor>
      .
    </TemporaryNotice>
  );
}

interface CutoffStatProps {
  label: string;
  series: Series;
  /** The newest bulletin's month: a series that stops before it has no
   * cutoff to show */
  month: string;
}

/** One chart's cutoff in the newest bulletin, as a box, with how it moved
 * since the bulletin before under it (cutoffChange) */
function CutoffStat({ label, series, month }: CutoffStatProps) {
  const newest = last(series);
  if (newest === undefined || newest[0] !== month)
    return <Stat label={label} value="Not given" line={null} />;
  const change = cutoffChange(series);
  return (
    <Stat
      label={label}
      value={formatCutoff(newest[1])}
      line={change?.text ?? null}
      lineColor={change?.color}
    />
  );
}

const GET = "get your visa or green card";
const SEND = "send your documents to the National Visa Center (NVC)";

/** What the two cutoffs mean for the reader, in one or two sentences, or
 * null when the bulletin gives neither */
function meaningSentence(
  finalAction: Cutoff | undefined,
  filing: Cutoff | undefined,
): string | null {
  if (finalAction === "C" && filing === "C")
    return `No line this month: you can ${GET}, and ${SEND}, whatever your priority date is.`;
  if (
    finalAction !== undefined &&
    isDate(finalAction) &&
    filing !== undefined &&
    isDate(filing)
  )
    return `Your priority date must be earlier than the Final Action Date to ${GET}, and earlier than the Date for Filing to ${SEND}.`;
  const sentences: string[] = [];
  if (finalAction === "C")
    sentences.push(`You can ${GET} whatever your priority date is.`);
  else if (finalAction === "U")
    sentences.push(
      "No visas are left in this category this month, whatever your priority date is.",
    );
  else if (finalAction !== undefined)
    sentences.push(
      `Your priority date must be earlier than the Final Action Date to ${GET}.`,
    );
  if (filing === "C")
    sentences.push(`You can ${SEND} whatever your priority date is.`);
  else if (filing === "U")
    sentences.push(
      "No one can send their documents to the National Visa Center (NVC) this month.",
    );
  else if (filing !== undefined)
    sentences.push(
      `Your priority date must be earlier than the Date for Filing to ${SEND}.`,
    );
  return sentences.length === 0 ? null : sentences.join(" ");
}

/** "moved forward 4 months", "did not move", "moved back 3 months" */
function movedText(months: number): string {
  if (months === 0) return "did not move";
  return `moved ${months > 0 ? "forward" : "back"} ${formatMonths(months)}`;
}

/** What the last year's movement was, as a sentence, or null when it cannot
 * be said in months (one end is "C" or "U") */
function yearSentence(movement: Movement): string | null {
  if (movement.months !== null)
    return `In the last year, the Final Action Date ${movedText(
      movement.months,
    )}.`;
  const [, from] = movement.from;
  const [, to] = movement.to;
  if (from === to)
    return `It was ${formatCutoff(from).toLowerCase()} a year ago too.`;
  return null;
}

/** How long the people at the front of the line have waited, and how far
 * the line moved in the last year and the last 5 years. A current category
 * gets no first sentence: the sentence under the figures says it. */
function Movements({ series, month }: { series: Series; month: string }) {
  const latest = series[series.length - 1]?.[1];
  const year = getMovement(series, 12);
  const fiveYears = getMovement(series, 60);
  const sentences: string[] = [];
  if (latest !== undefined && isDate(latest)) {
    const waited = monthsBetweenDates(latest, monthStart(month));
    // "about 0 months" is nonsense on a page whose line is nearly gone
    sentences.push(
      waited < 2
        ? "There is almost no line now."
        : `People at the front of the line have waited about ${formatMonths(
            waited >= 24 ? Math.round(waited / 12) * 12 : waited,
          )}.`,
    );
  } else if (latest === "U") {
    sentences.push(
      "No visas are left in this category this month, so the line is not moving.",
    );
    const lastDated = findLast(series, ([, cutoff]) => isDate(cutoff));
    if (lastDated !== undefined)
      sentences.push(
        `Its last cutoff date, in the ${formatBulletinMonth(
          lastDated[0],
        )} bulletin, was ${formatCutoff(lastDated[1])}.`,
      );
  }
  const lastYear = year && yearSentence(year);
  if (lastYear) sentences.push(lastYear);
  if (fiveYears !== null && fiveYears.months !== null) {
    const perYear = Math.round(fiveYears.months / 5);
    sentences.push(
      `In the last 5 years, it ${movedText(fiveYears.months)}${
        fiveYears.months > 0 && perYear > 0
          ? `, about ${
              perYear === 1 ? "1 month" : `${perYear} months`
            } each year`
          : ""
      }.`,
    );
  }
  const shown = [year, fiveYears].filter(
    (movement): movement is Movement => movement !== null,
  );
  return (
    <Stack gap="xs">
      {sentences.map((sentence) => (
        <Text key={sentence}>{sentence}</Text>
      ))}
      <MoreDetails>
        <Text size="sm">
          The line can stand still for months, jump forward, or move back. It
          often moves back in summer and forward again in October.
        </Text>
        {shown.map(({ from: [fromMonth, fromCutoff] }) => (
          <Text size="sm" key={fromMonth}>
            The {formatBulletinMonth(fromMonth)} bulletin&rsquo;s Final Action
            Date was {formatCutoff(fromCutoff)}.
          </Text>
        ))}
      </MoreDetails>
    </Stack>
  );
}

function OtherLinks({ title, links }: { title: string; links: OtherLink[] }) {
  if (links.length === 0) return null;
  return (
    <Stack gap="xs">
      <Title order={2} size="h3">
        {title}
      </Title>
      <ListRows>
        {links.map(({ name, href, cutoff }) => (
          <ListRow
            key={href}
            href={href}
            label={name}
            rightSection={<Text size="sm">{formatCutoff(cutoff)}</Text>}
          />
        ))}
      </ListRows>
    </Stack>
  );
}

export default function VisaBulletinPage({
  category,
  area,
  bornIn,
  month,
  bulletinUrl,
  series,
  otherAreas,
  otherCategories,
}: Props) {
  const finalAction = last(series.finalAction);
  const filing = last(series.datesForFiling);
  const finalActionCutoff =
    finalAction?.[0] === month ? finalAction[1] : undefined;
  const filingCutoff = filing?.[0] === month ? filing[1] : undefined;
  const meaning = meaningSentence(finalActionCutoff, filingCutoff);
  // a chart of fewer than two different dates would have nothing to show
  const hasDates =
    new Set(
      [...series.finalAction, ...series.datesForFiling]
        .map(([, cutoff]) => cutoff)
        .filter(isDate),
    ).size >= 2;
  const title = `${category.name} Visa Bulletin dates: ${area.name}`;
  const path = pagePath(category, area);
  const description = `${
    category.name
  } Final Action Date for people ${bornIn} in the ${formatBulletinMonth(
    month,
  )} Visa Bulletin: ${
    finalActionCutoff === undefined
      ? "not given"
      : formatCutoff(finalActionCutoff)
  }. How fast it moved in the last year and the last 5 years.`;

  return (
    <Stack gap="xl">
      <Head>
        <title>{title}</title>
        <meta name="description" content={description} />
        <link rel="canonical" href={`https://visawhen.com${path}`} />
        <meta property="og:title" content={title} />
        <meta property="og:description" content={description} />
        <meta property="og:url" content={`https://visawhen.com${path}`} />
        <script
          {...breadcrumbList([
            { name: "Visa Bulletin", path: "/visa-bulletin" },
            { name: `${category.name}, ${area.name}`, path },
          ])}
        />
      </Head>
      <Button
        variant="outline"
        component={Link}
        href="/visa-bulletin"
        size="xs"
        leftSection={<ChevronLeftIcon />}
        style={{ alignSelf: "flex-start" }}
      >
        Change category
      </Button>
      <Stack gap="sm">
        <Box>
          <Title order={1}>{title}</Title>
          <Text size="lg">
            {category.who}, {bornIn}. Newest bulletin:{" "}
            {formatBulletinMonth(month)}.
          </Text>
        </Box>
        <StaleNotice month={month} />
        <Stats columns={2} phoneColumns={2}>
          <CutoffStat
            label="Final Action Date"
            series={series.finalAction}
            month={month}
          />
          <CutoffStat
            label="Date for Filing"
            series={series.datesForFiling}
            month={month}
          />
        </Stats>
        {meaning !== null && <Text>{meaning}</Text>}
      </Stack>
      <Stack gap="sm">
        <Stack gap="xs">
          <PolicyNews page={path} />
          <VisaBulletinCases area={area} />
        </Stack>
        <MoreDetails label="What is my priority date?">
          <Text size="sm">{PRIORITY_DATE_DEFINITION}</Text>
        </MoreDetails>
        <Text size="xs" c="dimmed">
          Source: the{" "}
          <Anchor href={bulletinUrl} target="_blank" rel="noopener">
            {formatBulletinMonth(month)} Visa Bulletin
          </Anchor>
          .
        </Text>
      </Stack>
      <Stack gap="sm">
        <Title order={2}>How fast the line moves</Title>
        <Movements series={series.finalAction} month={month} />
        {hasDates && (
          <VisaBulletinChart
            series={series}
            label={`${category.name}, ${area.name}`}
          />
        )}
      </Stack>
      <OtherLinks
        title={`${category.name} in other countries`}
        links={otherAreas}
      />
      <OtherLinks
        title={`Other ${category.kind} categories`}
        links={otherCategories}
      />
    </Stack>
  );
}
