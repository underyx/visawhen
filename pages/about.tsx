import { Anchor, Box, Stack, Table, Text, Title } from "@mantine/core";
import { GetStaticProps } from "next";
import Head from "next/head";
import Link from "next/link";
import React from "react";
import {
  getIvScheduleAsOf,
  getIvScheduleSource,
  getRecentWindow,
} from "../api/consulates";
import { getData as getNvcData } from "../api/nvc";
import { getData as getUscisData, newestQuarter } from "../api/uscis";
import { getData as getVisaBulletinData } from "../api/visaBulletin";
import { formatLongMonth } from "../components/consulates";
import { formatShortDate } from "../components/Freshness";
import {
  DOL_PROCESSING_TIMES_URL,
  GLOBAL_VISA_WAIT_TIMES_URL,
  ISSUANCE_STATISTICS_URLS,
  NVC_TIMEFRAMES_URL,
  USCIS_DATA_URL,
  VISA_BULLETIN_URL,
} from "../components/links";
import { POLICY_ENTRIES } from "../components/policy";
import { quarterLabel } from "../components/uscis";
import { formatBulletinMonth, newestMonth } from "../components/visaBulletin";

interface Props {
  /** "Apr–Jun 2026" */
  uscisQuarter: string;
  /** The newest NVC reading, "2026-09-21" */
  nvcDate: string;
  /** State's newest IV Scheduling Status Tool update, "2026-09-23" */
  ivScheduleAsOf: string;
  ivScheduleSource: string;
  /** The newest month of visa issuances, "2026-02-01T00:00:00.000Z" */
  issuancesTo: string;
  /** When the policy notices were last checked, "2026-09-25" */
  policyChecked: string;
  /** The newest Visa Bulletin's month, "2026-10" */
  visaBulletinMonth: string;
}

export const getStaticProps: GetStaticProps<Props> = async () => {
  const uscis = await getUscisData();
  const quarter = newestQuarter(uscis);
  const period = uscis.periods.find((row) => row.quarter === quarter);
  const nvc = await getNvcData();
  const nvcDates = [nvc.creation, nvc.review, nvc.inquiry]
    .flatMap((series) => Object.keys(series))
    .sort();
  return {
    props: {
      uscisQuarter: period === undefined ? "" : quarterLabel(period),
      nvcDate: nvcDates[nvcDates.length - 1],
      ivScheduleAsOf: await getIvScheduleAsOf(),
      ivScheduleSource: await getIvScheduleSource(),
      issuancesTo: (await getRecentWindow()).to,
      policyChecked: POLICY_ENTRIES.map(({ lastChecked }) => lastChecked)
        .sort()
        .reverse()[0],
      visaBulletinMonth: newestMonth(await getVisaBulletinData()),
    },
  };
};

function Source({ href, children }: React.PropsWithChildren<{ href: string }>) {
  return (
    <Anchor href={href} target="_blank" rel="noopener">
      {children}
    </Anchor>
  );
}

const TITLE = "Where VisaWhen’s data comes from";
const DESCRIPTION =
  "The official sources behind VisaWhen’s numbers, how often each one updates, and how recent the data on the site is.";

export default function About({
  uscisQuarter,
  nvcDate,
  ivScheduleAsOf,
  ivScheduleSource,
  issuancesTo,
  policyChecked,
  visaBulletinMonth,
}: Props) {
  // The first column stays in view while the rest scrolls on a phone, at
  // 11rem, so each row goes by its section's name, linked to it; the
  // Source column's link text carries the detail. Short cells and short
  // dates keep the narrow columns to a line or two.
  const rows: {
    data: string;
    /** The section the row's numbers are in, or null for the notices */
    href: string | null;
    source: React.ReactNode;
    schedule: string;
    newest: string;
  }[] = [
    {
      data: "USCIS processing times",
      href: "/uscis",
      source: (
        <Source href={USCIS_DATA_URL}>
          USCIS&rsquo;s quarterly reports, per form and per office
        </Source>
      ),
      schedule: "Quarterly, a few months late",
      newest: uscisQuarter,
    },
    {
      data: "NVC wait times",
      href: "/nvc",
      source: <Source href={NVC_TIMEFRAMES_URL}>NVC Timeframes page</Source>,
      schedule: "Weekly",
      newest: formatShortDate(nvcDate),
    },
    {
      data: "Consulate interview months",
      href: "/consulates",
      source: (
        <Source href={ivScheduleSource}>
          State Department IV Scheduling Status Tool
        </Source>
      ),
      schedule: "About monthly",
      newest: formatShortDate(ivScheduleAsOf),
    },
    {
      data: "Visa Bulletin cutoffs",
      href: "/visa-bulletin",
      source: (
        <Source href={VISA_BULLETIN_URL}>State Department Visa Bulletin</Source>
      ),
      schedule: "Monthly, before the month starts",
      newest: `${formatBulletinMonth(visaBulletinMonth)} bulletin`,
    },
    {
      data: "Visas issued per consulate",
      href: "/consulates",
      source: (
        <>
          State Department monthly{" "}
          <Source href={ISSUANCE_STATISTICS_URLS.IV}>immigrant</Source> and{" "}
          <Source href={ISSUANCE_STATISTICS_URLS.NIV}>nonimmigrant</Source> visa
          issuance statistics
        </>
      ),
      schedule: "Monthly, months late",
      newest: formatLongMonth(issuancesTo),
    },
    {
      data: "Policy notices",
      href: null,
      source: "State Department notices and news reports, each linked",
      schedule: "Checked about weekly",
      newest: `Checked ${formatShortDate(policyChecked)}`,
    },
  ];

  return (
    <Stack>
      <Head>
        <title>{TITLE}</title>
        <meta name="description" content={DESCRIPTION} />
        <link rel="canonical" href="https://visawhen.com/about" />
        <meta property="og:title" content={TITLE} />
        <meta property="og:description" content={DESCRIPTION} />
        <meta property="og:url" content="https://visawhen.com/about" />
      </Head>
      {/* The table comes first: its Newest column is the page's figures.
          The footer already says the site is independent and not legal
          advice, so the text under the table says only what that means
          for a visitor's own case. */}
      <Box>
        <Title order={1}>{TITLE}</Title>
        <Text size="lg">
          Each source, how often it updates, and the newest data here.
        </Text>
      </Box>
      <Table.ScrollContainer minWidth={640} className="vw-sticky-column">
        <Table striped withTableBorder>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Data</Table.Th>
              <Table.Th>Source</Table.Th>
              <Table.Th>Updates</Table.Th>
              <Table.Th>Newest</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {rows.map(({ data, href, source, schedule, newest }) => (
              <Table.Tr key={data}>
                <Table.Td>
                  {href === null ? (
                    data
                  ) : (
                    <Anchor component={Link} href={href}>
                      {data}
                    </Anchor>
                  )}
                </Table.Td>
                <Table.Td>{source}</Table.Td>
                <Table.Td>{schedule}</Table.Td>
                <Table.Td>{newest}</Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>
      <Text>
        The numbers say how the agencies handle cases in general, not what will
        happen to yours. What the agencies tell you about your own case comes
        first.
      </Text>
      <Text size="sm">
        Not covered: PERM and prevailing wage decisions. The Department of Labor
        makes them; see{" "}
        <Source href={DOL_PROCESSING_TIMES_URL}>its processing times</Source>.
        Appointment waits for visitor, student and other temporary visas are in
        the State Department&rsquo;s{" "}
        <Source href={GLOBAL_VISA_WAIT_TIMES_URL}>
          Global Visa Wait Times
        </Source>
        .
      </Text>
      <Text size="xs" c="dimmed">
        We check each source every day. When one cannot be reached, its newest
        data stays up, with its date. The data and the code that collects it are
        on <Source href="https://github.com/underyx/visawhen">GitHub</Source>.
      </Text>
    </Stack>
  );
}
