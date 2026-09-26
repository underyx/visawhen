import { Anchor, Text, Title } from "@mantine/core";
import Head from "next/head";
import Link from "next/link";
import React from "react";
import {
  DOL_PROCESSING_TIMES_URL,
  GLOBAL_VISA_WAIT_TIMES_URL,
  I751_URL,
  VISA_BULLETIN_URL,
} from "../components/links";
import classes from "../components/Home.module.css";

/** USCIS's page saying, each month, which Visa Bulletin chart decides who
 * may file an I-485 in each preference category */
const ADJUSTMENT_FILING_CHARTS_URL =
  "https://www.uscis.gov/green-card/green-card-processes-and-procedures/visa-availability-priority-dates/adjustment-of-status-filing-charts-from-the-visa-bulletin";

/** USCIS's eligibility page for immediate relatives' green cards, which says
 * who can adjust status in the US */
const IMMEDIATE_RELATIVE_ELIGIBILITY_URL =
  "https://www.uscis.gov/green-card/green-card-eligibility/green-card-for-immediate-relatives-of-us-citizen";

/** USCIS's page on the registration an H-1B cap petition has to be selected
 * in first */
const H1B_REGISTRATION_URL =
  "https://www.uscis.gov/working-in-the-united-states/temporary-workers/h-1b-specialty-occupations-and-fashion-models/h-1b-electronic-registration-process";

/** How the Visa Bulletin's two charts apply, for the preference paths */
function PriorityDateCharts() {
  return (
    <>
      The <To href={VISA_BULLETIN_URL}>Visa Bulletin</To> has two charts. In the
      US, USCIS says each month which of them decides when you can file the
      I-485, on its{" "}
      <To href={ADJUSTMENT_FILING_CHARTS_URL}>filing charts page</To>. Abroad,
      NVC can have you send your documents once the Dates for Filing chart
      passes your date, before an interview is possible: that needs your date to
      be current in the Final Action Dates chart.
    </>
  );
}

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

/** When a conditional resident files the I-751, as uscis.gov/i-751 puts
 * it: jointly "during the 90-day period immediately before your
 * conditional residence expires", or individually, "with a request to
 * waive the joint filing requirement", "at any time before your
 * conditional permanent resident status expires". */
function I751Timing() {
  return (
    <>
      <To href="/uscis/i-751">I-751 to remove the conditions</To>, filed with
      your spouse in the 90 days before the card expires, not earlier; or, with
      a <To href={I751_URL}>waiver of the joint filing requirement</To> (after a
      divorce, for example), any time before it expires.
    </>
  );
}

interface PathProps {
  /** The anchor the index at the top of the page links to */
  id: string;
  title: string;
  /** Who the path is for, in a sentence */
  who: React.ReactNode;
  /** The steps, in order */
  steps: React.ReactNode[];
}

/** One common route through the process, as its steps in order, each
 * linking to the page with its numbers. */
function Path({ id, title, who, steps }: PathProps) {
  return (
    <section className={classes.path} id={id} aria-labelledby={`${id}-title`}>
      <Title order={2} className={classes.pathTitle} id={`${id}-title`}>
        {title}
      </Title>
      <Text className={classes.who}>{who}</Text>
      <ol className={classes.steps}>
        {steps.map((step, index) => (
          <li key={index} className={classes.step}>
            {step}
          </li>
        ))}
      </ol>
    </section>
  );
}

/** The paths, in the order the page lists them, for the index at its top */
const PATHS = [
  { id: "spouse-abroad", label: "Spouse, parent or child, abroad" },
  { id: "spouse-in-us", label: "Spouse, in the US" },
  { id: "fiance", label: "Fiancé(e)" },
  { id: "citizenship", label: "Citizenship" },
  { id: "employment", label: "Employment" },
  { id: "other-family", label: "Other family" },
  { id: "temporary", label: "Visitor, student or work visa" },
];

const TITLE = "US visa and green card wait times";
const DESCRIPTION =
  "How long each step of a US immigration case is taking: USCIS processing times, National Visa Center timeframes and consulate interview queues, for family, fiancé(e), employment and citizenship cases.";

export default function Home() {
  return (
    <>
      <Head>
        <title>{TITLE}</title>
        <meta name="description" content={DESCRIPTION} />
        <link rel="canonical" href="https://visawhen.com" />
        <meta property="og:title" content={TITLE} />
        <meta property="og:description" content={DESCRIPTION} />
        <meta property="og:url" content="https://visawhen.com" />
      </Head>
      <header className={classes.hero}>
        <Title order={1} className={classes.title}>
          How long each step of your US immigration case is taking
        </Title>
        <Text className={classes.lead}>
          Pick the path that matches your case. Each step links to the numbers
          for it, with their source and how recent they are.
        </Text>
        <nav aria-label="Paths">
          <ul className={classes.index}>
            {PATHS.map(({ id, label }) => (
              <li key={id}>
                <a href={`#${id}`}>{label}</a>
              </li>
            ))}
          </ul>
        </nav>
      </header>
      <div className={classes.paths}>
        <Path
          id="spouse-abroad"
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
              visa): <I751Timing />
            </>,
          ]}
        />
        <Path
          id="spouse-in-us"
          title="Spouse of a US citizen, living in the US"
          who={
            <>
              Getting a green card without leaving the US (adjustment of
              status). This is generally for people who were{" "}
              <To href={IMMEDIATE_RELATIVE_ELIGIBILITY_URL}>
                inspected and admitted or paroled
              </To>{" "}
              into the US, as with a visa; if you entered another way, talk to
              an immigration lawyer before filing.
            </>
          }
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
              card, it is a 2-year conditional one: <I751Timing />
            </>,
          ]}
        />
        <Path
          id="fiance"
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
              green card: <I751Timing />
            </>,
          ]}
        />
        <Path
          id="citizenship"
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
          id="employment"
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
              Your priority date: in most categories you wait for it to be
              reached. <PriorityDateCharts />
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
          id="other-family"
          title="Other family: siblings, adult children, relatives of green card holders"
          who="The family preference categories (F1, F2A, F2B, F3 and F4)."
          steps={[
            <>
              <To href="/uscis/i-130">I-130 petition</To>, filed by your
              relative with USCIS.
            </>,
            <>
              Your priority date: you wait, often for years, for it to be
              reached. <PriorityDateCharts />
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
          id="temporary"
          title="Visitor, student or temporary work visa"
          who="B, F, J, H, L, O and other nonimmigrant visas."
          steps={[
            <>
              Most employer-sponsored work visas (H, L, O, P, Q and R) start
              with an <To href="/uscis/i-129">I-129 petition</To> from the
              employer. For an H-1B under the annual cap, the employer first
              registers the worker in{" "}
              <To href={H1B_REGISTRATION_URL}>
                USCIS&rsquo;s H-1B registration
              </To>{" "}
              and can file only if the worker is selected. For E and TN visas,
              the I-129 is used only to change or extend status inside the US,
              and J exchange visitors do not use it.
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
      </div>
      <Text size="sm" c="dimmed" className={classes.footnote}>
        These are the common routes, not legal advice: an immigration lawyer or
        accredited representative can tell you which one is yours and whether
        you qualify.
      </Text>
    </>
  );
}
