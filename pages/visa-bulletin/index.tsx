import {
  Anchor,
  List,
  SegmentedControl,
  Stack,
  Table,
  Text,
  Title,
} from "@mantine/core";
import { GetStaticProps } from "next";
import { jsonLdScriptProps } from "react-schemaorg";
import { Dataset } from "schema-dts";
import Head from "next/head";
import Link from "next/link";
import React, { useState } from "react";
import { BulletinChart, getData } from "../../api/visaBulletin";
import { VISA_BULLETIN_URL } from "../../components/links";
import MoreDetails from "../../components/MoreDetails";
import { CREATOR, LICENSE_URL } from "../../components/structuredData";
import {
  Area,
  CATEGORIES,
  Category,
  chartAreas,
  CHARTS,
  ChartKey,
  formatBulletinMonth,
  formatCutoff,
  newestMonth,
  pagePath,
} from "../../components/visaBulletin";

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
        <Title order={1}>{TITLE}</Title>
        <Text>
          In the family and employment preference categories, only a limited
          number of green cards is given each year. People wait in line by their
          priority date. Each month, the State Department&rsquo;s{" "}
          <Anchor href={VISA_BULLETIN_URL} target="_blank" rel="noopener">
            Visa Bulletin
          </Anchor>{" "}
          says how far the line has moved.
        </Text>
        <Text>
          Pick your category and the country where you were born (not your
          citizenship) to see how fast its line has moved.
        </Text>
        <MoreDetails label="What is my priority date?">
          <Text size="sm">
            Your priority date is usually the day USCIS received your I-130 or
            I-140 petition, or, when you needed a labor certification, the day
            it was filed. It is on your I-797 notice.
          </Text>
        </MoreDetails>
      </Stack>
      <Stack gap="sm">
        <Title order={2} size="h3">
          <Anchor href={bulletinUrl} target="_blank" rel="noopener">
            {formatBulletinMonth(month)} Visa Bulletin
          </Anchor>
        </Title>
        <SegmentedControl
          value={chartKey}
          onChange={(value) => setChartKey(value as ChartKey)}
          data={(Object.keys(CHARTS) as ChartKey[]).map((key) => ({
            value: key,
            label: CHARTS[key],
          }))}
          style={{ alignSelf: "flex-start" }}
        />
        <List size="sm" spacing={4}>
          {chartKey === "finalAction" ? (
            <List.Item>
              Final Action Dates: you can get your visa or green card if your
              priority date is earlier than the date shown.
            </List.Item>
          ) : (
            <List.Item>
              Dates for Filing: you can send your documents to the National Visa
              Center if your priority date is earlier than the date shown. In
              the US, USCIS says each month which chart decides when you can
              file Form I-485.
            </List.Item>
          )}
          <List.Item>
            Current: there is no line, whatever your priority date is.
          </List.Item>
          <List.Item>
            Unavailable: no visas are left in the category this month.
          </List.Item>
        </List>
      </Stack>
      <CutoffTable
        id="family"
        title="Family"
        categories={CATEGORIES.filter(({ kind }) => kind === "family")}
        chart={chart}
      />
      <CutoffTable
        id="employment"
        title="Employment"
        categories={CATEGORIES.filter(({ kind }) => kind === "employment")}
        chart={chart}
      />
    </Stack>
  );
}
