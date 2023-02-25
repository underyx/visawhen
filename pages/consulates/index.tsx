import { faSearch } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { deburr, kebabCase, sortBy } from "lodash";
import { GetStaticProps } from "next";
import Head from "next/head";
import Link from "next/link";
import numeral from "numeral";
import React, { useEffect, useMemo, useState } from "react";
import {
  ConsulateBaselineRow,
  getAllPosts,
  getConsulateBaselines,
  PostRow,
} from "../../api/consulates";

export const getStaticProps: GetStaticProps = async () => ({
  props: {
    posts: await getAllPosts(),
    baselines: await getConsulateBaselines(),
  },
});

interface Props {
  posts: PostRow[];
  baselines: ConsulateBaselineRow[];
}

function sortItems(
  posts: PostRow[],
  baselineMap: Map<string, number>
): PostRow[] {
  return sortBy(posts, [
    ({ postSlug }) => -(baselineMap.get(postSlug) ?? -1),
    "post",
  ]);
}

export default function ConsulateSelect({ posts, baselines }: Props) {
  const baselineMap = useMemo<Map<string, number>>(
    () => new Map(baselines.map((row) => [row.postSlug, row.issuances])),
    [baselines]
  );
  const [term, setTerm] = useState<string>("");
  const [filteredPosts, setFilteredPosts] = useState<PostRow[]>(
    sortItems(posts, baselineMap)
  );

  useEffect(() => {
    const normalizedTerm = kebabCase(deburr(term.toLowerCase()));
    setFilteredPosts(
      sortItems(
        posts.filter(({ postSlug }) => postSlug.includes(normalizedTerm)),
        baselineMap
      )
    );
  }, [baselineMap, posts, term, setFilteredPosts]);

  return (
    <nav className="panel">
      <Head>
        <title>Consulate visa backlogs</title>
        <meta
          name="description"
          content={`See how long the visa backlog is at any of ${posts.length} consulates.`}
        />
        <link rel="canonical" href="https://visawhen.com/consulates" />
        <meta property="og:title" content="Consulate visa backlogs" />
        <meta
          property="og:description"
          content={`See how long the visa backlog is at any of ${posts.length} consulates.`}
        />
        <meta property="og:url" content="https://visawhen.com/consulates" />
      </Head>
      <p className="panel-heading">Select your consulate</p>
      <div className="panel-block">
        <p className="control has-icons-left">
          <input
            className="input"
            type="text"
            placeholder="Atlantis"
            onInput={(event: React.ChangeEvent<HTMLInputElement>) => {
              setTerm(event.target.value);
            }}
          />
          <span className="icon is-left">
            <FontAwesomeIcon icon={faSearch} />
          </span>
        </p>
      </div>
      {filteredPosts.map(({ post, postSlug }) => (
        <Link
          className="option panel-block"
          key={postSlug}
          href={`/consulates/${postSlug}/`}
        >
          <div className="post">
            <strong className="tag is-medium is-link is-light mr-3">
              {post}
            </strong>{" "}
          </div>
          <div>
            <span className="ml-3 tag">
              normally{" "}
              {numeral(baselineMap.get(postSlug))
                .format((baselineMap.get(postSlug) ?? 0) > 10 ? "0a" : "0.0a")
                .toUpperCase()}
              /mo
            </span>
          </div>
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
