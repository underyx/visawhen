import {
  Anchor,
  Box,
  SegmentedControl,
  Stack,
  Table,
  Text,
  Title,
} from "@mantine/core";
import { type GetStaticProps } from "next";
import { jsonLdScriptProps } from "react-schemaorg";
import { type Dataset } from "schema-dts";
import Head from "next/head";
import Link from "next/link";
import React, { useState } from "react";
import { type BulletinChart, getData } from "../../api/visaBulletin";
import { VISA_BULLETIN_URL } from "../../components/links";
import MoreDetails from "../../components/MoreDetails";
import { CREATOR, LICENSE_URL } from "../../components/structuredData";
import {
  type Area,
  CATEGORIES,
  type Category,
  chartAreas,
  CHARTS,
  type ChartKey,
  formatBulletinMonth,
  formatCutoff,
  newestMonth,
  pagePath,
  PRIORITY_DATE_DEFINITION,
} from "../../components/visaBulletin";

// The page is a chooser: the newest bulletin's two charts as tables, with
// the switch between them right above, and what the dates mean behind one
// toggle. The rows and columns say what a lesson on the categories and
// the countries would.

interface Props {
  /** The newest bulletin's month, "2026-10" */
  month: string;
  /** The oldest bulletin's month in the data, "2015-10" */
  firstMonth: string;
  bulletinUrl: string;
  charts: Record<ChartKey, BulletinChart>;
}

export const getStaticProps: GetStaticProps<Props> = async () => {
  const data = await getData();
  const month = newestMonth(data);
  const { url, finalAction, datesForFiling } = data.bulletins[month];
  return {
    props: {
      month,
      firstMonth: Object.keys(data.bulletins).sort()[0],
      bulletinUrl: url,
      charts: { finalAction, datesForFiling },
    },
  };
};

interface CutoffTableProps {
  /** The section's anchor, which other pages link to */
  id: string;
  title: string;
  categories: Category[];
  chart: BulletinChart;
}

/** One kind's categories (family or employment), a row each, with a column
 * per chargeability area; each cell links to its page */
function CutoffTable({ id, title, categories, chart }: CutoffTableProps) {
  const shown = categories.filter(({ key }) => key in chart);
  const areas: Area[] = chartAreas(
    Object.fromEntries(shown.map(({ key }) => [key, chart[key]])),
  );
  return (
    // below the fixed header when a link jumps here
    <Stack gap="xs" id={id} style={{ scrollMarginTop: "5rem" }}>
      <Title order={2}>{title}</Title>
      {/* The category column stays in view while the table scrolls sideways
          on a phone, so a reader can tell which row they are on. */}
      <Table.ScrollContainer minWidth={720} className="vw-sticky-column">
        <Table striped withTableBorder>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Category</Table.Th>
              {areas.map((area) => (
                <Table.Th key={area.key}>{area.name}</Table.Th>
              ))}
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {shown.map((category) => (
              <Table.Tr key={category.key}>
                <Table.Th scope="row" fw={400}>
                  <Text span fw={700} inherit>
                    {category.name}
                  </Text>
                  <Text size="xs" c="dimmed">
                    {category.who}
                  </Text>
                </Table.Th>
                {areas.map((area) => {
                  const cutoff = chart[category.key][area.key];
                  return (
                    <Table.Td key={area.key} style={{ whiteSpace: "nowrap" }}>
                      {cutoff === undefined ? (
                        "–"
                      ) : (
                        <Anchor
                          component={Link}
                          href={pagePath(category, area)}
                        >
                          {formatCutoff(cutoff)}
                        </Anchor>
                      )}
                    </Table.Td>
                  );
                })}
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>
    </Stack>
  );
}

const TITLE = "Visa Bulletin dates";

export default function VisaBulletinIndex({
  month,
  firstMonth,
  bulletinUrl,
  charts,
}: Props) {
  const [chartKey, setChartKey] = useState<ChartKey>("finalAction");
  const chart = charts[chartKey];
  // with the month, which people search for: "Visa Bulletin October 2026"
  const pageTitle = `${TITLE} for ${formatBulletinMonth(month)}`;
  const description = `The priority date cutoffs in the ${formatBulletinMonth(
    month,
  )} Visa Bulletin for every family and employment category, and how fast each one has moved.`;
  return (
    <Stack gap="xl">
      <Head>
        <title>{pageTitle}</title>
        <meta name="description" content={description} />
        <link rel="canonical" href="https://visawhen.com/visa-bulletin" />
        <meta property="og:title" content={pageTitle} />
        <meta property="og:description" content={description} />
        <meta property="og:url" content="https://visawhen.com/visa-bulletin" />
        <script
          {...jsonLdScriptProps<Dataset>({
            "@context": "https://schema.org",
            "@type": "Dataset",
            name: "Visa Bulletin dates",
            url: "https://visawhen.com/visa-bulletin",
            distribution: {
              "@type": "DataDownload",
              // the file itself: the github.com/.../blob/ page is HTML
              contentUrl:
                "https://raw.githubusercontent.com/underyx/visawhen/main/data/visa_bulletin/data.json",
              encodingFormat: "application/json",
            },
            description: `The Final Action Dates and Dates for Filing of every family and employment preference category and chargeability area in each monthly Visa Bulletin of the U.S. State Department, since ${formatBulletinMonth(
              firstMonth,
            )}.`,
            creator: CREATOR,
            inLanguage: "en",
            isBasedOn: VISA_BULLETIN_URL,
            license: LICENSE_URL,
            temporalCoverage: `${firstMonth}/..`,
          })}
        />
      </Head>
      <Stack gap="sm">
        <Box>
          <Title order={1}>{TITLE}</Title>
          <Text size="lg">
            The State Department&rsquo;s own monthly cutoff dates, by category
            and country of birth (not citizenship). Newest:{" "}
            {formatBulletinMonth(month)}.
          </Text>
        </Box>
        <Stack gap="xs">
          <SegmentedControl
            value={chartKey}
            onChange={(value) => setChartKey(value as ChartKey)}
            data={(Object.keys(CHARTS) as ChartKey[]).map((key) => ({
              value: key,
              label: CHARTS[key],
            }))}
            style={{ alignSelf: "flex-start" }}
          />
          <MoreDetails label="What the dates mean">
            <Text size="sm">
              Final Action Dates: you can get your visa or green card if your
              priority date is earlier than the date shown.
            </Text>
            <Text size="sm">
              Dates for Filing: you can send your documents to the National Visa
              Center if your priority date is earlier than the date shown. In
              the US, USCIS says each month which chart decides when you can
              file Form I-485.
            </Text>
            <Text size="sm">
              Current: there is no line, whatever your priority date is.
            </Text>
            <Text size="sm">
              Unavailable: no visas are left in the category this month.
            </Text>
            <Text size="sm">{PRIORITY_DATE_DEFINITION}</Text>
          </MoreDetails>
        </Stack>
      </Stack>
      <CutoffTable
        id="family"
        title="Family"
        categories={CATEGORIES.filter(({ kind }) => kind === "family")}
        chart={chart}
      />
      <Stack gap="sm">
        <CutoffTable
          id="employment"
          title="Employment"
          categories={CATEGORIES.filter(({ kind }) => kind === "employment")}
          chart={chart}
        />
        <Text size="xs" c="dimmed">
          Source: the{" "}
          <Anchor href={bulletinUrl} target="_blank" rel="noopener">
            {formatBulletinMonth(month)} Visa Bulletin
          </Anchor>
          .
        </Text>
      </Stack>
    </Stack>
  );
}
