import { GetStaticPaths, GetStaticProps } from "next";
import Link from "next/link";
import React, { useEffect, useState } from "react";
import { deburr, kebabCase } from "lodash";
import {
  faCaretLeft,
  faChevronLeft,
  faSearch,
} from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  getAllPosts,
  getAllVisaClasses,
  getPost,
  getSlugPairs,
  VisaClassRow,
} from "../../../api/consulates";
import { useRouter } from "next/dist/client/router";
import Head from "next/head";

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
    },
  };
};

interface Props {
  visaClasses: VisaClassRow[];
  availableVisaClasses: string[];
  postName: string;
}

export default function ConsulateSelect({
  visaClasses,
  availableVisaClasses,
  postName,
}: Props) {
  const router = useRouter();

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
      visaClasses.filter(({ visaClassSlug }) =>
        visaClassSlug.includes(normalizedTerm)
      )
    );
  }, [visaClasses, term, setFilteredVisas]);

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
        <Link href="/consulates">
          <a className="button is-small is-link is-light">
            <span className="icon">
              <FontAwesomeIcon icon={faChevronLeft} />
            </span>
            &nbsp;&nbsp;Change consulate
          </a>
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
        {filteredVisas.map(({ visaClass, visaClassSlug, description }) =>
          availableVisaClassesSet.has(visaClassSlug) ? (
            <Link href={`/consulates/${postSlug}/${visaClassSlug}`}>
              <a key={visaClassSlug} className="panel-block">
                <strong className="tag is-medium is-link is-light mr-3">
                  {visaClass}
                </strong>{" "}
                <span className="visa-description">{description}</span>
              </a>
            </Link>
          ) : (
            <a
              key={visaClassSlug}
              className="panel-block has-text-grey-light is-unclickable"
            >
              <span className="tag is-medium is-light mr-3">
                {visaClass} (never issued)
              </span>
              <span className="visa-description">{description}</span>
            </a>
          )
        )}
      </nav>
      <style jsx>{`
        .is-unclickable {
          cursor: not-allowed;
        }

        .visa-description {
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
      `}</style>
    </div>
  );
}
