import Document, {
  Html,
  Head,
  Main,
  NextScript,
  DocumentContext,
} from "next/document";
import React from "react";
import Navbar from "../components/Navbar";
import PageWrapper from "../components/PageWrapper";
import FullStory from "react-fullstory";

// The following import prevents a Font Awesome icon server-side rendering bug,
// where the icons flash from a very large icon down to a properly sized one:
// Prevent fontawesome from adding its CSS since we did it manually.
import { config } from "@fortawesome/fontawesome-svg-core";
config.autoAddCss = false; /* eslint-disable import/first */

const FULLSTORY_ORG_ID = "112R81";

class MyDocument extends Document {
  static async getInitialProps(ctx: DocumentContext) {
    const initialProps = await Document.getInitialProps(ctx);

    return initialProps;
  }

  render() {
    return (
      <Html lang="en" className="has-navbar-fixed-top">
        <Head>
          <link
            rel="apple-touch-icon"
            sizes="180x180"
            href="/apple-touch-icon.png"
          />
          <link
            rel="icon"
            type="image/png"
            sizes="32x32"
            href="/favicon-32x32.png"
          />
          <link
            rel="icon"
            type="image/png"
            sizes="16x16"
            href="/favicon-16x16.png"
          />
          <link rel="manifest" href="/site.webmanifest" />
        </Head>
        <body>
          <Navbar />
          <PageWrapper>
            <Main />
          </PageWrapper>
          <NextScript />
          <FullStory org={FULLSTORY_ORG_ID} />
        </body>
      </Html>
    );
  }
}

export default MyDocument;
