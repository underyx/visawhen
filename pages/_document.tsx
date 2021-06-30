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

// The following import prevents a Font Awesome icon server-side rendering bug,
// where the icons flash from a very large icon down to a properly sized one:
// Prevent fontawesome from adding its CSS since we did it manually.
import { config } from "@fortawesome/fontawesome-svg-core";
config.autoAddCss = false; /* eslint-disable import/first */

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
          <script
            async
            src="https://www.googletagmanager.com/gtag/js?id=G-3QQ9KQ0WCE"
          />
          <script>{`
            window.dataLayer = window.dataLayer || [];
            function gtag(){dataLayer.push(arguments);}
            gtag('js', new Date());

            gtag('config', 'G-3QQ9KQ0WCE');
          `}</script>
        </Head>
        <body>
          <Navbar />
          <PageWrapper>
            <Main />
          </PageWrapper>
          <NextScript />
        </body>
      </Html>
    );
  }
}

export default MyDocument;
