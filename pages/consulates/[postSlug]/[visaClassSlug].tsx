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
} from "../../../api/consulates";
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
    },
  };
};

interface Props {
  baselineRate: number;
  backlog: BacklogRow[];
  postName: string;
  visaClassName: string;
}

export default function ConsulateStats({
  baselineRate,
  backlog,
  postName,
  visaClassName,
}: Props) {
  const monthsAhead = (last(backlog) as BacklogRow).monthsAhead;
  const router = useRouter();
  const { postSlug, visaClassSlug } = router.query;
  if (typeof postSlug !== "string" || typeof visaClassSlug !== "string") return;

  return (
    <main>
      <Head>
        <title>
          {postName} {visaClassName} visa backlog
        </title>
        <meta
          name="description"
          content={
            `${postName} used to issue ${
              Math.round(baselineRate * 10) / 10
            } ${visaClassName} visas per month on average.` +
            (monthsAhead !== null
              ? ` Now they are ${Math.abs(
                  Math.round(monthsAhead * 10) / 10
                )} months ${
                  monthsAhead >= 0 ? "ahead of" : "behind"
                } expectations.`
              : "")
          }
        />
        <link
          rel="canonical"
          href={`https://visawhen.com/consulates/${postSlug}/${visaClassSlug}`}
        />
        <meta
          property="og:title"
          content={`${postName} ${visaClassName} visa backlog`}
        />
        <meta
          property="og:description"
          content={
            `${postName} used to issue ${
              Math.round(baselineRate * 10) / 10
            } ${visaClassName} visas per month on average.` +
            (monthsAhead !== null
              ? ` Now they are ${Math.abs(
                  Math.round(monthsAhead * 10) / 10
                )} months ${
                  monthsAhead >= 0 ? "ahead of" : "behind"
                } expectations.`
              : "")
          }
        />
        <meta
          property="og:url"
          content={`https://visawhen.com/consulates/${postSlug}/${visaClassSlug}`}
        />
      </Head>
      <div className="my-1">
        <Link href="/consulates">
          <a className="button is-small is-link is-light">
            <span className="icon">
              <FontAwesomeIcon icon={faChevronLeft} />
            </span>
            &nbsp;&nbsp;Change consulate
          </a>
        </Link>{" "}
        <Link href={`/consulates/${postSlug}`}>
          <a className="button is-small is-link is-light">
            <span className="icon">
              <FontAwesomeIcon icon={faChevronLeft} />
            </span>
            &nbsp;&nbsp;Change visa class
          </a>
        </Link>
      </div>
      <h1 className="title">
        {postName}&rsquo;s {visaClassName} visa backlog
      </h1>
      <p className="my-4">
        Before 2020 March, {postName} issued{" "}
        <strong>{Math.round(baselineRate * 10) / 10}</strong> {visaClassName}{" "}
        visas per month on average.{" "}
        {monthsAhead !== null ? (
          <span>
            If we naively assume that the number of visa applications
            didn&rsquo;t change during COVID, they are now{" "}
            <strong>
              {Math.abs(Math.round(monthsAhead * 10) / 10)} months{" "}
              {monthsAhead >= 0 ? "ahead of" : "behind"} expectations
            </strong>
            .
          </span>
        ) : (
          ""
        )}
      </p>
      <ConsulateChart backlog={backlog} />
    </main>
  );
}
