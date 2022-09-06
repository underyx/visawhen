import { faSearch } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { deburr, kebabCase, sortBy } from "lodash";
import { GetStaticProps } from "next";
import Head from "next/head";
import Link from "next/link";
import { useRouter } from "next/router";
import numeral from "numeral";
import React, { useEffect, useMemo, useState } from "react";
import {
  getAllVisaClasses,
  getAllPosts,
  getVisaClassBaselines,
  VisaClassBaselineRow,
  VisaClassRow,
  PostRow,
} from "../../api/consulates";

export const getStaticProps: GetStaticProps = async () => ({
  props: {
    visaClasses: await getAllVisaClasses(),
    posts: await getAllPosts(),
    baselines: await getVisaClassBaselines(),
  },
});

interface Props {
  visaClasses: VisaClassRow[];
  posts: PostRow[];
  baselines: VisaClassBaselineRow[];
}

function sortItems(
  visaClasses: VisaClassRow[],
  baselineMap: Map<string, number>
): VisaClassRow[] {
  return sortBy(visaClasses, [
    ({ visaClass }) => -(baselineMap.get(visaClass) ?? -1),
    "visaClass",
  ]);
}

export default function ConsulateSelect({
  visaClasses,
  posts,
  baselines,
}: Props) {
  const router = useRouter();

  const baselineMap = useMemo<Map<string, number>>(
    () => new Map(baselines.map((row) => [row.visaClassSlug, row.issuances])),
    [baselines]
  );

  const [term, setTerm] = useState<string>("");
  const [filteredVisaClasses, setFilteredVisaClasses] = useState<
    VisaClassRow[]
  >(sortItems(visaClasses, baselineMap));

  useEffect(() => {
    const normalizedTerm = kebabCase(deburr(term.toLowerCase()));
    setFilteredVisaClasses(
      sortItems(
        visaClasses.filter(
          ({ visaClassSlug, description }) =>
            visaClassSlug.includes(normalizedTerm) ||
            (description !== null &&
              kebabCase(deburr(description)).includes(normalizedTerm))
        ),
        baselineMap
      )
    );
  }, [baselineMap, visaClasses, term, setFilteredVisaClasses]);

  const title = `Consulate visa backlogs`;
  const description = `See which of ${posts.length} consulates process your visa type the fastest.`;

  return (
    <nav className="panel">
      <Head>
        <title>{title}</title>
        <meta name="description" content={description} />
        <link rel="canonical" href="https://visawhen.com/consulates" />
        <meta property="og:title" content="Consulate visa backlogs" />
        <meta property="og:description" content={description} />
        <meta property="og:url" content="https://visawhen.com/consulates" />
      </Head>
      <p className="panel-heading">Select your visa type</p>
      <div className="panel-block">
        <p className="control has-icons-left">
          <input
            className="input"
            type="text"
            placeholder="DL-6"
            onInput={(event: React.ChangeEvent<HTMLInputElement>) => {
              setTerm(event.target.value);
            }}
          />
          <span className="icon is-left">
            <FontAwesomeIcon icon={faSearch} />
          </span>
        </p>
      </div>
      {filteredVisaClasses.map(({ visaClass, description, visaClassSlug }) => (
        <Link key={visaClassSlug} href={`/visas/${visaClassSlug}/`}>
          <a className="option panel-block">
            <div className="post">
              <strong className="tag is-medium is-link is-light mr-3">
                {visaClass} ({description})
              </strong>{" "}
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
          </a>
        </Link>
      ))}
      <style jsx>{`
        .post {
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .option {
          display: flex;
          justify-content: space-between;
        }
      `}</style>
    </nav>
  );
}
