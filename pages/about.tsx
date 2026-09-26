import { Anchor, Stack, Table, Text, Title } from "@mantine/core";
import { GetStaticProps } from "next";
import Head from "next/head";
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
import { formatDate } from "../components/Freshness";
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
    <Anchor href={href} target="_blank" rel="noopener" inherit>
      {children}
    </Anchor>
  );
}

const TITLE = "Where VisaWhen's data comes from";
const DESCRIPTION =
  "The official sources behind VisaWhen's numbers, how often each one updates, and how recent the data on the site is.";

export default function About({
  uscisQuarter,
  nvcDate,
  ivScheduleAsOf,
  ivScheduleSource,
  issuancesTo,
  policyChecked,
  visaBulletinMonth,
}: Props) {
  const rows: {
    what: string;
    source: React.ReactNode;
    schedule: string;
    newest: string;
  }[] = [
    {
      what: "USCIS applications received, decided and pending, and USCIS's median processing times",
      source: (
        <Source href={USCIS_DATA_URL}>
          USCIS&rsquo;s quarterly reports, per form and per office
        </Source>
      ),
      schedule: "Quarterly, a few months after each quarter ends",
      newest: uscisQuarter,
    },
    {
      what: "National Visa Center timeframes",
      source: <Source href={NVC_TIMEFRAMES_URL}>NVC Timeframes page</Source>,
      schedule: "Weekly",
      newest: formatDate(nvcDate),
    },
    {
      what: "Which month of cases each consulate is scheduling for immigrant visa interviews",
      source: (
        <Source href={ivScheduleSource}>
          State Department IV Scheduling Status Tool
        </Source>
      ),
      schedule: "About monthly",
      newest: formatDate(ivScheduleAsOf),
    },
    {
      what: "Priority date cutoffs for the family and employment preference categories",
      source: (
        <Source href={VISA_BULLETIN_URL}>State Department Visa Bulletin</Source>
      ),
      schedule: "Monthly, around the middle of the month before",
      newest: `${formatBulletinMonth(visaBulletinMonth)} bulletin`,
    },
    {
      what: "Visas issued per consulate and visa class",
      source: (
        <>
          State Department monthly{" "}
          <Source href={ISSUANCE_STATISTICS_URLS.IV}>immigrant</Source> and{" "}
          <Source href={ISSUANCE_STATISTICS_URLS.NIV}>nonimmigrant</Source> visa
          issuance statistics
        </>
      ),
      schedule: "Monthly, several months late and often in batches",
      newest: formatLongMonth(issuancesTo),
    },
    {
      what: "Notices of pauses and suspensions of visa processing",
      source: "State Department notices and news reports, each linked",
      schedule: "Checked by hand, about weekly",
      newest: `Last checked ${formatDate(policyChecked)}`,
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
      <Title order={1}>{TITLE}</Title>
      <Text>
        VisaWhen is an independent project, not affiliated with USCIS, the State
        Department or any other government agency. Nothing on it is legal
        advice: its numbers describe how the agencies have been processing cases
        in general, not what will happen to yours. What the agencies tell you
        about your own case always takes precedence.
      </Text>
      <Title order={2}>Sources and how recent they are</Title>
      <Text>
        Scheduled scripts check each source every day and publish new data when
        there is some. When a source cannot be reached, the newest data we have
        stays up, with its date. Every page says how recent its numbers are, and
        the NVC, interview-scheduling, Visa Bulletin and policy sections warn
        when theirs are older than the source&rsquo;s usual schedule.
      </Text>
      <Table.ScrollContainer minWidth={640}>
        <Table striped withTableBorder>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>What</Table.Th>
              <Table.Th>Source</Table.Th>
              <Table.Th>The source updates</Table.Th>
              <Table.Th>Newest data here</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {rows.map(({ what, source, schedule, newest }) => (
              <Table.Tr key={what}>
                <Table.Td>{what}</Table.Td>
                <Table.Td>{source}</Table.Td>
                <Table.Td>{schedule}</Table.Td>
                <Table.Td>{newest}</Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>
      <Text>
        The data is stored in the{" "}
        <Source href="https://github.com/underyx/visawhen">
          site&rsquo;s GitHub repository
        </Source>
        , along with the code that collects it.
      </Text>
      <Title order={2}>Not covered</Title>
      <Text>
        Prevailing wage determinations and PERM labor certifications are decided
        by the Department of Labor; see{" "}
        <Source href={DOL_PROCESSING_TIMES_URL}>its processing times</Source>.
        Appointment waits for visitor, student and other nonimmigrant visas are
        in the State Department&rsquo;s{" "}
        <Source href={GLOBAL_VISA_WAIT_TIMES_URL}>
          Global Visa Wait Times
        </Source>
        .
      </Text>
    </Stack>
  );
}
