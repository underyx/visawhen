import { GetStaticProps } from "next";
import { getAllPosts, PostRow } from "../../api/consulates";
import Link from "next/link";
import React, { useEffect, useState } from "react";
import { deburr, kebabCase } from "lodash";
import { faSearch } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import Head from "next/head";

export const getStaticProps: GetStaticProps = async () => ({
  props: {
    posts: await getAllPosts(),
  },
});

interface Props {
  posts: PostRow[];
}

export default function ConsulateSelect({ posts }: Props) {
  const [term, setTerm] = useState<string>("");
  const [filteredPosts, setFilteredPosts] = useState<PostRow[]>(posts);

  useEffect(() => {
    const normalizedTerm = kebabCase(deburr(term.toLowerCase()));
    setFilteredPosts(
      posts.filter(({ postSlug }) => postSlug.includes(normalizedTerm))
    );
  }, [posts, term, setFilteredPosts]);

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
          <a key={postSlug} className="panel-block">
            {post}
          </a>
        </Link>
      ))}
    </nav>
  );
}
