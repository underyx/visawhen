import {
  Anchor,
  Card,
  List,
  SimpleGrid,
  Stack,
  Text,
  Title,
} from "@mantine/core";
import Head from "next/head";
import Link from "next/link";
import React from "react";
import {
  DOL_PROCESSING_TIMES_URL,
  GLOBAL_VISA_WAIT_TIMES_URL,
  VISA_BULLETIN_URL,
} from "../components/links";

/** A link to a page of this site, or to an official one in a new tab */
function To({ href, children }: React.PropsWithChildren<{ href: string }>) {
  return href.startsWith("/") ? (
    <Anchor component={Link} href={href}>
      {children}
    </Anchor>
  ) : (
    <Anchor href={href} target="_blank" rel="noopener">
      {children}
    </Anchor>
  );
}

interface PathProps {
  title: string;
  /** Who the path is for, in a sentence */
  who: React.ReactNode;
  /** The steps, in order */
  steps: React.ReactNode[];
}

/** One common route through the process, as its steps in order, each
 * linking to the page with its numbers. */
function Path({ title, who, steps }: PathProps) {
  return (
    <Card withBorder radius="md" p="md">
      <Stack gap="xs">
        <Title order={2} size="h4">
          {title}
        </Title>
        <Text size="sm" c="dimmed">
          {who}
        </Text>
        <List type="ordered" spacing={6}>
          {steps.map((step, index) => (
            <List.Item key={index}>{step}</List.Item>
          ))}
        </List>
      </Stack>
    </Card>
  );
}

const TITLE = "US visa and green card wait times";
const DESCRIPTION =
  "How long each step of a US immigration case is taking: USCIS processing times, National Visa Center timeframes and consulate interview queues, for family, fiancé(e), employment and citizenship cases.";

export default function Home() {
  return (
    <Stack>
      <Head>
        <title>{TITLE}</title>
        <meta name="description" content={DESCRIPTION} />
        <link rel="canonical" href="https://visawhen.com" />
        <meta property="og:title" content={TITLE} />
        <meta property="og:description" content={DESCRIPTION} />
        <meta property="og:url" content="https://visawhen.com" />
      </Head>
      <Title order={1} size="h2">
        How long each step of your US immigration case is taking
      </Title>
      <Text size="lg">
        Pick the path that matches your case. Each step links to the numbers for
        it, with their source and how recent they are.
      </Text>
      <SimpleGrid cols={{ base: 1, md: 2 }} spacing={{ base: "sm", sm: "md" }}>
        <Path
          title="Spouse, parent or child of a US citizen, living abroad"
          who="Immediate relatives who immigrate through a US embassy or consulate (IR and CR visas)."
          steps={[
            <>
              <To href="/uscis/i-130">I-130 petition</To>: your US citizen
              relative files it with USCIS.
            </>,
            <>
              <To href="/nvc">National Visa Center</To>: it creates your case
              and reviews your documents until your case is{" "}
              <em>documentarily complete</em> (older sources say{" "}
              <em>documentarily qualified</em>). NVC emails you that date.
            </>,
            <>
              <To href="/consulates">Interview at your consulate</To>: which
              month of documentarily complete cases it is scheduling.
            </>,
            <>
              A spouse married less than 2 years when they enter the US on the
              visa gets a 2-year conditional green card (usually on a CR-1
              visa): <To href="/uscis/i-751">I-751 to remove the conditions</To>
              , filed in the 90 days before the card expires.
            </>,
          ]}
        />
        <Path
          title="Spouse of a US citizen, living in the US"
          who="Getting a green card without leaving the US (adjustment of status)."
          steps={[
            <>
              <To href="/uscis/i-130">I-130 petition</To> and{" "}
              <To href="/uscis/i-485">I-485 green card application</To>, usually
              filed together.
            </>,
            <>
              While the I-485 is pending:{" "}
              <To href="/uscis/i-765">I-765 work permit</To> and{" "}
              <To href="/uscis/i-131">I-131 travel document</To>, usually filed
              with it.
            </>,
            <>
              If you were married less than 2 years when you got your green
              card, it is a 2-year conditional one:{" "}
              <To href="/uscis/i-751">I-751 to remove the conditions</To>, filed
              in the 90 days before it expires, not earlier.
            </>,
          ]}
        />
        <Path
          title="Fiancé(e) of a US citizen"
          who="Coming to the US on a K-1 visa to marry within 90 days."
          steps={[
            <>
              <To href="/uscis/i-129f">I-129F petition</To>: your US citizen
              fiancé(e) files it with USCIS.
            </>,
            <>
              K-1 interview at your consulate: State publishes no
              interview-scheduling data for K visas, and NVC&rsquo;s timeframes
              do not cover them; your{" "}
              <To href="/consulates">consulate&rsquo;s page</To> shows how many
              K-1 visas it issues.
            </>,
            <>
              After you marry in the US:{" "}
              <To href="/uscis/i-485">I-485 green card application</To>, with
              the <To href="/uscis/i-765">I-765 work permit</To> and{" "}
              <To href="/uscis/i-131">I-131 travel document</To>.
            </>,
            <>
              If you have been married less than 2 years when the I-485 is
              approved, as most K-1 couples are, you get a 2-year conditional
              green card:{" "}
              <To href="/uscis/i-751">I-751 to remove the conditions</To>, filed
              in the 90 days before it expires.
            </>,
          ]}
        />
        <Path
          title="Becoming a US citizen"
          who="Naturalization for green card holders."
          steps={[
            <>
              <To href="/uscis/n-400">N-400 application</To>: the national
              range, and how your own field office is doing.
            </>,
          ]}
        />
        <Path
          title="Employment-based green card"
          who="EB-1, EB-2 and EB-3, sponsored by an employer or self-petitioned."
          steps={[
            <>
              Prevailing wage and PERM labor certification, for most EB-2 and
              EB-3 cases: decided by the Department of Labor and not covered
              here; see{" "}
              <To href={DOL_PROCESSING_TIMES_URL}>its processing times</To>.
            </>,
            <>
              <To href="/uscis/i-140">I-140 petition</To>, filed with USCIS.
            </>,
            <>
              Your priority date: in most categories you wait until the{" "}
              <To href={VISA_BULLETIN_URL}>Visa Bulletin</To> shows it as
              current.
            </>,
            <>
              In the US:{" "}
              <To href="/uscis/i-485">I-485 green card application</To>, with
              the <To href="/uscis/i-765">I-765</To> and{" "}
              <To href="/uscis/i-131">I-131</To>. Abroad:{" "}
              <To href="/nvc">the National Visa Center</To> and an{" "}
              <To href="/consulates">interview at your consulate</To>.
            </>,
          ]}
        />
        <Path
          title="Other family: siblings, adult children, relatives of green card holders"
          who="The family preference categories (F1, F2A, F2B, F3 and F4)."
          steps={[
            <>
              <To href="/uscis/i-130">I-130 petition</To>, filed by your
              relative with USCIS.
            </>,
            <>
              Your priority date: you wait, often for years, until the{" "}
              <To href={VISA_BULLETIN_URL}>Visa Bulletin</To> shows it as
              current.
            </>,
            <>
              Abroad: <To href="/nvc">the National Visa Center</To> and an{" "}
              <To href="/consulates">interview at your consulate</To>. In the
              US, if you can adjust status there:{" "}
              <To href="/uscis/i-485">I-485</To>.
            </>,
          ]}
        />
        <Path
          title="Visitor, student or temporary work visa"
          who="B, F, J, H, L, O and other nonimmigrant visas."
          steps={[
            <>
              Work visas start with an{" "}
              <To href="/uscis/i-129">I-129 petition</To> from the employer.
            </>,
            <>
              Visa appointment waits at each consulate: the State
              Department&rsquo;s{" "}
              <To href={GLOBAL_VISA_WAIT_TIMES_URL}>Global Visa Wait Times</To>,
              which are not covered here. The{" "}
              <To href="/consulates">consulate pages</To> show how many visas of
              each class a post issues.
            </>,
          ]}
        />
      </SimpleGrid>
      <Text size="sm" c="dimmed">
        These are the common routes, not legal advice: an immigration lawyer or
        accredited representative can tell you which one is yours and whether
        you qualify.
      </Text>
    </Stack>
  );
}
