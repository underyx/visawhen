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

export default function ConsulateSelect({ posts, baselines }: Props) {
  const baselineMap = useMemo<Map<string, number>>(
    () => new Map(baselines.map((row) => [row.postSlug, row.issuances])),
    [baselines]
  );
  const [term, setTerm] = useState<string>("");
  const [filteredPosts, setFilteredPosts] = useState<PostRow[]>([]);

  useEffect(() => {
    const normalizedTerm = kebabCase(deburr(term.toLowerCase()));
    setFilteredPosts(
      sortBy(
        posts.filter(({ postSlug }) => postSlug.includes(normalizedTerm)),
        ({ postSlug }) => -(baselineMap.get(postSlug) ?? -1)
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
        // eslint-disable-next-line react/jsx-key
        <Link href={`/consulates/${postSlug}/`}>
          <a key={postSlug} className="option panel-block">
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
