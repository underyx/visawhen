import { faChevronRight } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import Head from "next/head";
import Link from "next/link";

export default function Home() {
  return (
    <main>
      <Head>
        <title>US visa wait times</title>
        <meta
          name="description"
          content="Data on US visa wait times at the National Visa Center and at US consulates."
        />
        <link rel="canonical" href="https://visawhen.com" />
        <meta property="og:title" content="US visa wait times" />
        <meta
          property="og:description"
          content="Data on US visa wait times at the National Visa Center and at US consulates."
        />
        <meta property="og:url" content="https://visawhen.com" />
      </Head>

      <h1 className="title">Welcome to VisaWhen</h1>
      <h2 className="subtitle">What is your case waiting for right now?</h2>
      <ul className="columns">
        <li className="column">
          <div className="card">
            <header className="card-header">
              <p className="card-header-title has-text-grey-light">
                Step 1: USCIS
              </p>
            </header>
            <div className="card-content">
              <div className="content has-text-grey">
                VisaWhen does not have information on USCIS wait times yet.
                Until then, you can check the{" "}
                <a href="https://egov.uscis.gov/processing-times/">
                  USCIS Case Processing Times
                </a>{" "}
                page instead.
              </div>
            </div>
          </div>
        </li>
        <li className="column">
          <div className="card">
            <Link href="/nvc">
              <a>
                <header className="card-header">
                  <p className="card-header-title">Step 2: NVC</p>
                  <span className="card-header-icon">
                    <span className="icon">
                      <FontAwesomeIcon icon={faChevronRight} />
                    </span>
                  </span>
                </header>
              </a>
            </Link>
            <div className="card-content">
              <div className="content">
                This is your step after the USCIS said they&rsquo;ve approved
                your application, until the NVC says your case has been{" "}
                <em>documentarily qualified</em>.
              </div>
            </div>
            <footer className="card-footer">
              <Link href="/nvc">
                <a className="card-footer-item">Check NVC wait times</a>
              </Link>
            </footer>
          </div>
        </li>
        <li className="column">
          <div className="card">
            <Link href="/consulates">
              <a>
                <header className="card-header">
                  <p className="card-header-title">Step 3: Consulate</p>
                  <button className="card-header-icon" aria-label="open">
                    <span className="icon">
                      <FontAwesomeIcon icon={faChevronRight} />
                    </span>
                  </button>
                </header>
              </a>
            </Link>
            <div className="card-content">
              <div className="content">
                This is your step after the NVC said your case has been{" "}
                <em>documentarily qualified</em>.
              </div>
            </div>
            <footer className="card-footer">
              <Link href="/consulates">
                <a className="card-footer-item">Check consulate wait times</a>
              </Link>
            </footer>
          </div>
        </li>
      </ul>
    </main>
  );
}
