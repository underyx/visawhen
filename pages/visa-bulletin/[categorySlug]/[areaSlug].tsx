import {
  Alert,
  Anchor,
  Paper,
  SimpleGrid,
  Stack,
  Text,
  Title,
} from "@mantine/core";
import { findLast, last } from "lodash";
import { GetStaticPaths, GetStaticProps } from "next";
import Head from "next/head";
import Link from "next/link";
import React from "react";
import { getData } from "../../../api/visaBulletin";
import { ListRow, ListRows } from "../../../components/ListRow";
import MoreDetails from "../../../components/MoreDetails";
import {
  ADJUSTMENT_FILING_CHARTS_URL,
  VISA_BULLETIN_URL,
} from "../../../components/links";
import VisaBulletinChart from "../../../components/VisaBulletinChart";
import {
  addMonthsToMonth,
  Area,
  areaBySlug,
  Category,
  categoryBySlug,
  CATEGORIES,
  chartAreas,
  ChartKey,
  formatBulletinMonth,
  formatCutoff,
  formatMonths,
  getMovement,
  getSeries,
  isDate,
  monthsBetweenDates,
  monthStart,
  Movement,
  newestMonth,
  pagePath,
  Series,
} from "../../../components/visaBulletin";
import { daysBetween, useToday } from "../../../components/Freshness";

const DATA_URL =
  "https://github.com/underyx/visawhen/blob/main/data/visa_bulletin/data.json";

interface OtherLink {
  name: string;
  href: string;
  cutoff: string;
}

interface Props {
  category: Category;
  area: Area;
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
  return {
    props: {
      category,
      area,
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
      otherAreas: chartAreas({ [category.key]: chart[category.key] })
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
    <Alert color="yellow" role="note">
      Our newest Visa Bulletin is for {formatBulletinMonth(month)}, but the
      State Department has probably published a newer one. See{" "}
      <Anchor
        href={VISA_BULLETIN_URL}
        target="_blank"
        rel="noopener noreferrer"
        inherit
      >
        the newest bulletin on its website
      </Anchor>
      .
    </Alert>
  );
}

interface CutoffBoxProps {
  label: string;
  cutoff: string | undefined;
  children: React.ReactNode;
}

/** One chart's cutoff, large, with what it means */
function CutoffBox({ label, cutoff, children }: CutoffBoxProps) {
  return (
    <Paper withBorder p="md" radius="md">
      <Text size="sm" c="dimmed" fw={500}>
        {label}
      </Text>
      <Text fz="h2" fw={700} lh={1.35}>
        {cutoff === undefined ? "Not given" : formatCutoff(cutoff)}
      </Text>
      <Text size="sm">{children}</Text>
    </Paper>
  );
}

function finalActionMeaning(cutoff: string | undefined): string {
  if (cutoff === "C")
    return "There is no line this month: you can get your visa or green card whatever your priority date is.";
  if (cutoff === "U")
    return "No visas are left in this category this month, whatever your priority date is.";
  return "You can get your visa or green card if your priority date is earlier than this date.";
}

function filingMeaning(cutoff: string | undefined): React.ReactNode {
  const who =
    cutoff === "C"
      ? "You can send in your documents whatever your priority date is."
      : cutoff === "U"
      ? "No one can send in their documents with this chart this month."
      : "You can send your documents to the National Visa Center if your priority date is earlier than this date.";
  return (
    <>
      {who} In the US,{" "}
      <Anchor
        href={ADJUSTMENT_FILING_CHARTS_URL}
        target="_blank"
        rel="noopener noreferrer"
        inherit
      >
        USCIS says each month
      </Anchor>{" "}
      which chart decides when you can file Form I-485.
    </>
  );
}

/** "moved forward 4 months", "did not move", "moved back 3 months" */
function movedText(months: number): string {
  if (months === 0) return "did not move";
  return `moved ${months > 0 ? "forward" : "back"} ${formatMonths(months)}`;
}

/** What a movement was, as a sentence, or null when it cannot be said in
 * months (one end is "C" or "U") */
function movementSentence(movement: Movement, span: string): string | null {
  if (movement.months !== null)
    return `In the last ${span}, the Final Action Date ${movedText(
      movement.months,
    )}.`;
  const [, from] = movement.from;
  const [, to] = movement.to;
  if (from === to)
    return `It was ${formatCutoff(from).toLowerCase()} ${span} ago too.`;
  return null;
}

function Movements({ series, month }: { series: Series; month: string }) {
  const latest = series[series.length - 1]?.[1];
  const year = getMovement(series, 12);
  const fiveYears = getMovement(series, 60);
  const sentences: string[] = [];
  if (latest !== undefined && isDate(latest)) {
    const waited = monthsBetweenDates(latest, monthStart(month));
    sentences.push(
      `The people at the front of the line now have a priority date from ${formatBulletinMonth(
        latest.slice(0, 7),
      )}: they have waited about ${formatMonths(
        waited >= 24 ? Math.round(waited / 12) * 12 : waited,
      )}.`,
    );
  } else if (latest === "C") {
    sentences.push("This category is current: there is no line.");
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
  const yearSentence = year && movementSentence(year, "12 months");
  if (yearSentence) sentences.push(yearSentence);
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
          The line does not move at a steady pace. It can stand still for
          months, jump forward, or move back. It often moves back in the summer,
          near the end of the US government&rsquo;s year, and forward again in
          October. So past movement cannot tell you exactly when your date will
          come.
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
  // a chart of fewer than two different dates would have nothing to show
  const hasDates =
    new Set(
      [...series.finalAction, ...series.datesForFiling]
        .map(([, cutoff]) => cutoff)
        .filter(isDate),
    ).size >= 2;
  const title = `${category.name} Visa Bulletin dates: ${area.name}`;
  const path = pagePath(category, area);
  const description = `${category.name} Final Action Date for people ${
    area.bornIn
  } in the ${formatBulletinMonth(month)} Visa Bulletin: ${
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
      </Head>
      <Stack gap="sm">
        <Text size="sm">
          <Anchor component={Link} href="/visa-bulletin">
            Visa Bulletin
          </Anchor>
        </Text>
        <Title order={1}>{title}</Title>
        <Text size="lg">
          {category.who}, {area.bornIn}.
        </Text>
        <StaleNotice month={month} />
      </Stack>
      <Stack gap="sm">
        <Title order={2}>{formatBulletinMonth(month)} Visa Bulletin</Title>
        <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm">
          <CutoffBox label="Final Action Date" cutoff={finalActionCutoff}>
            {finalActionMeaning(finalActionCutoff)}
          </CutoffBox>
          <CutoffBox label="Date for Filing" cutoff={filingCutoff}>
            {filingMeaning(filingCutoff)}
          </CutoffBox>
        </SimpleGrid>
        <Text size="sm" c="dimmed">
          Your priority date is usually the day USCIS received your I-130 or
          I-140 petition, or, when you needed a labor certification, the day it
          was filed. It is on your I-797 notice. Source:{" "}
          <Anchor href={bulletinUrl} target="_blank" rel="noopener" inherit>
            the {formatBulletinMonth(month)} Visa Bulletin
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
            dataUrl={DATA_URL}
            label={`${category.name}, ${area.name}`}
          />
        )}
      </Stack>
      <OtherLinks
        title={`${category.name} in other countries`}
        links={otherAreas}
      />
      <OtherLinks
        title={`Other ${category.kind} categories: ${area.name}`}
        links={otherCategories}
      />
    </Stack>
  );
}
