import Link from "next/link";
import last from "lodash/last";
import { GetStaticPaths, GetStaticProps } from "next";
import React from "react";
import {
  getBaseline,
  getBacklog,
  getSlugPairs,
  getPost,
  getVisaClass,
  BacklogRow,
} from "../../../utils/consulates";
import Head from "next/head";
import ConsulateChart from "../../../components/ConsulateChart";
import { useRouter } from "next/dist/client/router";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faChevronLeft } from "@fortawesome/free-solid-svg-icons";

export const getStaticPaths: GetStaticPaths = async () => {
  const rows = await getSlugPairs();
  return {
    paths: rows.map((row) => {
      const { postSlug, visaClassSlug } = row;
      return { params: { postSlug, visaClassSlug } };
    }),
    fallback: false,
  };
};

export const getStaticProps: GetStaticProps = async ({ params }) => {
  if (params === undefined) return { notFound: true };
  const { postSlug, visaClassSlug } = params;
  if (typeof postSlug !== "string" || typeof visaClassSlug !== "string")
    return { notFound: true };

  const post = await getPost(postSlug);
  const visaClass = await getVisaClass(visaClassSlug);
  const backlog = await getBacklog(postSlug, visaClassSlug);
  const baseline = await getBaseline(postSlug, visaClassSlug);

  if (
    post === undefined ||
    visaClass === undefined ||
    backlog.length === 0 ||
    baseline === undefined
  )
    return { notFound: true };

  return {
    props: {
      baselineRate: baseline.issuances,
      backlog: backlog,
      postName: post.post,
      visaClassName: visaClass.visaClass,
      visaClassDescription: visaClass.description,
    },
  };
};

interface Props {
  baselineRate: number;
  backlog: BacklogRow[];
  postName: string;
  visaClassName: string;
  visaClassDescription: string | null;
}

export default function ConsulateStats({
  baselineRate,
  backlog,
  postName,
  visaClassName,
  visaClassDescription,
}: Props) {
  const router = useRouter();

  const lastMonth = last<BacklogRow>(backlog);
  if (lastMonth === undefined) return "no data";
  const lastMonthDate = new Date(lastMonth.month);
  const lastMonthName = lastMonthDate.toLocaleDateString("default", {
    month: "long",
  });

  const monthsAhead = lastMonth.monthsAhead;
  const { postSlug, visaClassSlug } = router.query;
  if (typeof postSlug !== "string" || typeof visaClassSlug !== "string") return;

  let title = `The ${postName} consulate's ${visaClassName} visa issuance rate`;
  if (visaClassDescription !== null) title += ` (${visaClassDescription})`;

  let description = `${postName} used to issue ${
    Math.round(baselineRate * 10) / 10
  } ${visaClassName}`;
  if (visaClassDescription !== null)
    description += ` (${visaClassDescription})`;
  description += ` visas in an average ${lastMonthName}.`;
  description += ` This ${lastMonthName}, they issued ${lastMonth.issuances}.`;

  let canonicalUrl = `https://visawhen.com/consulates/${postSlug}/${visaClassSlug}`;

  return (
    <main>
      <Head>
        <title>{title}</title>
        <meta name="description" content={description} />
        <link rel="canonical" href={canonicalUrl} />
        <meta property="og:title" content={title} />
        <meta property="og:description" content={description} />
        <meta property="og:url" content={canonicalUrl} />
      </Head>
      <div className="my-1">
        <Link className="button is-small is-link is-light" href="/consulates">
          <span className="icon">
            <FontAwesomeIcon icon={faChevronLeft} />
          </span>
          &nbsp;&nbsp;Change consulate
        </Link>{" "}
        <Link
          className="button is-small is-link is-light"
          href={`/consulates/${postSlug}`}
        >
          <span className="icon">
            <FontAwesomeIcon icon={faChevronLeft} />
          </span>
          &nbsp;&nbsp;Change visa class
        </Link>
      </div>
      <h1 className="title">
        {postName}&rsquo;s {visaClassName} visa issuance rate
      </h1>
      {visaClassDescription !== null && (
        <h2 className="subtitle">{visaClassDescription}</h2>
      )}
      <p className="my-4">
        Before COVID, {postName} issued{" "}
        <strong>{Math.round((lastMonth.expectedDelta ?? 0) * 10) / 10}</strong>{" "}
        {visaClassName} visas in an average {lastMonthName}. This{" "}
        {lastMonthName}, they issued <strong>{lastMonth.issuances}</strong>.{" "}
        {lastMonth.expectedDelta !== null &&
        lastMonth.issuances > lastMonth.expectedDelta * 1.2 &&
        lastMonth.issuances >= 10
          ? `It seems like ${postName} is hard at work catching up on their backlog from COVID.`
          : lastMonth.expectedDelta !== null &&
            lastMonth.issuances < lastMonth.expectedDelta * 0.8 &&
            lastMonth.expectedDelta >= 10
          ? `It seems like ${postName} is still not operating at full capacity.`
          : lastMonth.expectedDelta !== null &&
            (lastMonth.issuances < 10 || lastMonth.expectedDelta < 10)
          ? `With so few visas ever issued, it's difficult to tell how well ${postName} is doing just by looking at this ${lastMonthName}.`
          : `It seems like ${postName} is operating as normal.`}
      </p>
      <ConsulateChart backlog={backlog} />
    </main>
  );
}
