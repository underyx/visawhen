import { GetStaticProps } from "next";
import Head from "next/head";
import { getData, NvcData, NvcSeries } from "../api/nvc";
import { add, getISODay } from "date-fns";
import React from "react";
import NvcChart from "../components/NvcChart";
import last from "lodash/last";

export const getStaticProps: GetStaticProps = async () => ({
  props: {
    data: await getData(),
  },
});

interface Props {
  data: NvcData;
}

const NVC_TZ_OFFSET_MINS = 5 * 60;

function getDaysTillNewDataText(data: NvcData): string {
  const dates = Object.keys(data.creation);
  const latestDate = new Date(last(dates) as string);

  const today = add(new Date(), {
    minutes: new Date().getTimezoneOffset() - NVC_TZ_OFFSET_MINS,
  });
  const daysTillNewData =
    getISODay(today) === 1 && latestDate.toDateString() !== today.toDateString()
      ? 0
      : 8 - getISODay(today);

  return `New data expected ${
    daysTillNewData === 0
      ? "later today"
      : daysTillNewData === 1
      ? "tomorrow"
      : `in ${daysTillNewData} days`
  } (EST).`;
}

interface ChartHeadingProps {
  series: NvcSeries;
}

function ChartHeading({
  children,
  series,
}: React.PropsWithChildren<ChartHeadingProps>) {
  return (
    <h2 className="subtitle review is-size-3 mt-6 mb-2">
      {children} takes {last(Object.values(series))} days
    </h2>
  );
}

export default function NvcBacklog({ data }: Props) {
  return (
    <>
      <Head>
        <title>NVC wait times</title>
        <meta
          name="description"
          content={`The National Visa Center is currently taking ${last(
            Object.values(data.review)
          )} days to review documents, ${last(
            Object.values(data.creation)
          )} days to create cases, and ${last(
            Object.values(data.inquiry)
          )} days to respond to inquiries.`}
        />
        <link rel="canonical" href="https://visawhen.com/nvc" />
        <meta property="og:title" content="NVC wait times" />
        <meta
          property="og:description"
          content={`The National Visa Center is currently taking ${last(
            Object.values(data.review)
          )} days to review documents, ${last(
            Object.values(data.creation)
          )} days to create cases, and ${last(
            Object.values(data.inquiry)
          )} days to respond to inquiries.`}
        />
        <meta property="og:url" content="https://visawhen.com/nvc" />
      </Head>
      <h1 className="title">NVC wait times</h1>
      <p className="my-4">
        Here&rsquo;s how long you should expect to wait until the National Visa
        Center processes your case. <span>{getDaysTillNewDataText(data)}</span>
      </p>
      <ChartHeading series={data.review}>Document review</ChartHeading>
      <p>
        Time until documents submitted on{" "}
        <a href="https://ceac.state.gov/IV/Login.aspx">CEAC</a> are reviewed by
        NVC.
      </p>
      <p className="has-text-grey">
        These numbers are anecdotally accurate: my case was processed in April
        2021 exactly when this chart predicted.
      </p>
      <NvcChart id="review" series={data.review} />
      <ChartHeading series={data.creation}>Case creation</ChartHeading>
      <p>
        Time after USCIS sends a case to the NVC until the NVC creates a case
        for it in <a href="https://ceac.state.gov/IV/Login.aspx">CEAC</a>.
      </p>
      <p className="has-text-grey">
        Some time elapses after USCIS approval before they send the case to the
        NVC.
      </p>
      <NvcChart id="creation" series={data.creation} />
      <ChartHeading series={data.inquiry}>Inquiry response</ChartHeading>
      <p>
        Time until questions and requests sent via{" "}
        <a href="https://travel.state.gov/content/travel/en/us-visas/visa-information-resources/ask-nvc.html">
          NVC&rsquo;s public inquiry form
        </a>{" "}
        are answered.
      </p>
      <NvcChart id="inquiry" series={data.inquiry} />
    </>
  );
}
