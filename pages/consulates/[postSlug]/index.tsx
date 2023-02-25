import { faChevronLeft, faSearch } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { deburr, sortBy } from "lodash";
import { GetStaticPaths, GetStaticProps } from "next";
import { useRouter } from "next/dist/client/router";
import Head from "next/head";
import Link from "next/link";
import React, { useEffect, useMemo, useState } from "react";
import {
  getAllPosts,
  getAllVisaClasses,
  getPost,
  getSlugPairs,
  getVisaClassBaselines,
  VisaClassBaselineRow,
  VisaClassRow,
} from "../../../utils/consulates";
import numeral from "numeral";

export const getStaticPaths: GetStaticPaths = async () => {
  const posts = await getAllPosts();
  return {
    paths: posts.map((row) => ({ params: { postSlug: row.postSlug } })),
    fallback: false,
  };
};

export const getStaticProps: GetStaticProps = async ({ params }) => {
  if (params === undefined) return { notFound: true };
  const { postSlug } = params;
  if (postSlug === undefined || typeof postSlug !== "string")
    return { notFound: true };

  const postInfo = await getPost(postSlug);
  if (postInfo === undefined) return { notFound: true };

  const availableVisaClasses = new Set<string>(
    (await getSlugPairs())
      .filter((row) => row.postSlug === postSlug)
      .map((row) => row.visaClassSlug)
  );

  return {
    props: {
      visaClasses: await getAllVisaClasses(),
      availableVisaClasses: Array.from(availableVisaClasses),
      postName: postInfo.post,
      baselines: await getVisaClassBaselines(postSlug),
    },
  };
};

interface Props {
  visaClasses: VisaClassRow[];
  availableVisaClasses: string[];
  postName: string;
  baselines: VisaClassBaselineRow[];
}

function sortItems(
  visaClasses: VisaClassRow[],
  baselineMap: Map<string, number>
): VisaClassRow[] {
  return sortBy(visaClasses, [
    ({ visaClassSlug }) => -(baselineMap.get(visaClassSlug) ?? -1),
    "visaClass",
  ]);
}

export default function ConsulateSelect({
  visaClasses,
  availableVisaClasses,
  postName,
  baselines,
}: Props) {
  const router = useRouter();

  const baselineMap = useMemo<Map<string, number>>(
    () => new Map(baselines.map((row) => [row.visaClassSlug, row.issuances])),
    [baselines]
  );

  const [term, setTerm] = useState<string>("");
  const [filteredVisas, setFilteredVisas] = useState<VisaClassRow[]>([]);
  const [availableVisaClassesSet, setAvailableVisaClassesSet] = useState<
    Set<string>
  >(new Set());

  useEffect(() => {
    setAvailableVisaClassesSet(new Set<string>(availableVisaClasses));
  }, [availableVisaClasses, setAvailableVisaClassesSet]);

  useEffect(() => {
    const normalizedTerm = deburr(term).toLowerCase().replace(/\W/, "");
    setFilteredVisas(
      sortItems(
        visaClasses.filter(({ visaClassSlug }) =>
          visaClassSlug.includes(normalizedTerm)
        ),
        baselineMap
      )
    );
  }, [baselineMap, visaClasses, term, setFilteredVisas]);

  const { postSlug } = router.query;
  if (typeof postSlug !== "string") return;

  return (
    <div>
      <Head>
        <title>{postName} visa backlog</title>
        <meta
          name="description"
          content={`See how long the visa backlog is at ${postName} in any of ${availableVisaClasses.length} visa categories.`}
        />
        <link
          rel="canonical"
          href={`https://visawhen.com/consulates/${postSlug}`}
        />
        <meta property="og:title" content={`${postName} visa backlogs`} />
        <meta
          property="og:description"
          content={`See how long the visa backlog is at ${postName} in any of ${availableVisaClasses.length} visa categories.`}
        />
        <meta
          property="og:url"
          content={`https://visawhen.com/consulates/${postSlug}`}
        />
      </Head>
      <div className="my-1">
        <Link className="button is-small is-link is-light" href="/consulates">
          <span className="icon">
            <FontAwesomeIcon icon={faChevronLeft} />
          </span>
          &nbsp;&nbsp;Change consulate
        </Link>
      </div>
      <p className="panel-heading">{postName} › Select your visa type</p>
      <nav className="panel">
        <div className="panel-block">
          <p className="control has-icons-left">
            <input
              className="input"
              type="text"
              placeholder="DL6"
              onInput={(event: React.ChangeEvent<HTMLInputElement>) => {
                setTerm(event.target.value);
              }}
            />
            <span className="icon is-left">
              <FontAwesomeIcon icon={faSearch} />
            </span>
          </p>
        </div>
        {filteredVisas.map(({ visaClass, visaClassSlug, description }) => {
          const hasAnyIssued = availableVisaClassesSet.has(visaClassSlug);
          if (!hasAnyIssued) {
            return (
              <a
                key={visaClassSlug}
                className="option panel-block has-text-grey-light is-unclickable"
              >
                <div className="visa-type">
                  <span className="tag is-medium is-light mr-3">
                    {visaClass}
                  </span>
                  <span>{description}</span>
                </div>
                <div>
                  <span className="ml-3 tag">never issued</span>
                </div>
              </a>
            );
          }
          return (
            <Link
              key={visaClassSlug}
              className="option panel-block"
              href={`/consulates/${postSlug}/${visaClassSlug}`}
            >
              <div className="visa-type">
                <strong className="tag is-medium is-link is-light mr-3">
                  {visaClass}
                </strong>{" "}
                <span>{description}</span>
              </div>
              <div>
                <span className="ml-3 tag">
                  normally{" "}
                  {numeral(baselineMap.get(visaClassSlug))
                    .format(
                      (baselineMap.get(visaClassSlug) ?? 0) > 10 ? "0a" : "0.0a"
                    )
                    .toUpperCase()}
                  /mo
                </span>
              </div>
            </Link>
          );
        })}
      </nav>
      <style jsx>{`
        .is-unclickable {
          cursor: not-allowed;
        }

        .visa-type {
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .option {
          display: flex;
          justify-content: space-between;
        }
      `}</style>
    </div>
  );
}
