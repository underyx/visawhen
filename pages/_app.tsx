import "@mantine/core/styles.css";
import type { AppProps } from "next/app";
import Script from "next/script";
import {
  Anchor,
  createTheme,
  CSSVariablesResolver,
  MantineProvider,
  Table,
} from "@mantine/core";
import Head from "next/head";
import PageWrapper from "../components/PageWrapper";

// Colours chosen for WCAG AA contrast (4.5:1 for text), checked by
// computation rather than by eye. Mantine's defaults fall short: its blue.6
// links and buttons are 3.4:1 on the page's gray.0 background (blue.8: 4.8:1,
// white on blue.8: 5.0:1), and its gray.6 dimmed text 3.2:1 (gray.7: 7.8:1).
// Links are underlined, so that a link in a sentence does not stand out by its
// colour alone. A table that scrolls sideways on a phone can take the focus,
// so that it can be scrolled with the keyboard.
const theme = createTheme({
  primaryShade: { light: 8, dark: 8 },
  components: {
    Anchor: Anchor.extend({ defaultProps: { underline: "always" } }),
    TableScrollContainer: Table.ScrollContainer.extend({
      defaultProps: { scrollAreaProps: { viewportProps: { tabIndex: 0 } } },
    }),
  },
});

const cssVariablesResolver: CSSVariablesResolver = () => ({
  variables: {},
  light: { "--mantine-color-dimmed": "var(--mantine-color-gray-7)" },
  dark: { "--mantine-color-dimmed": "var(--mantine-color-dark-1)" },
});

function MyApp({ Component, pageProps }: AppProps) {
  return (
    <>
      <Head>
        <title>VisaWhen</title>
        <meta
          name="viewport"
          content="minimum-scale=1, initial-scale=1, width=device-width"
        />
      </Head>
      <MantineProvider
        theme={theme}
        cssVariablesResolver={cssVariablesResolver}
      >
        <PageWrapper>
          <Component {...pageProps} />
        </PageWrapper>
      </MantineProvider>
      <Script
        src="https://www.googletagmanager.com/gtag/js?id=G-3QQ9KQ0WCE"
        strategy="afterInteractive"
      />
      <Script id="gtag" strategy="afterInteractive">
        {`
          window.dataLayer = window.dataLayer || [];
          function gtag(){dataLayer.push(arguments);}
          gtag('js', new Date());

          gtag('config', 'G-3QQ9KQ0WCE');
        `}
      </Script>
    </>
  );
}
export default MyApp;
