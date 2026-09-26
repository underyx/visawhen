import "@mantine/core/styles.css";
import "../components/global.css";
import type { AppProps } from "next/app";
import Script from "next/script";
import {
  Alert,
  Anchor,
  Badge,
  Chip,
  createTheme,
  CSSVariablesResolver,
  MantineColorsTuple,
  MantineProvider,
  Paper,
  Table,
} from "@mantine/core";
import Head from "next/head";
import { FONT_FAMILY } from "../components/font";
import PageWrapper from "../components/PageWrapper";

/** The violet of a passport entry stamp (and of the logo): links, the
 * selected chip and the estimate stamp. Shade 7 is 8.5:1 on white. */
const stamp: MantineColorsTuple = [
  "#f4f0fa",
  "#e6ddf3",
  "#cdbbe7",
  "#b197da",
  "#9776cc",
  "#7f5abd",
  "#6c47aa",
  "#5b3a94",
  "#4a2f7a",
  "#3a2560",
];

/** The navy of a US passport cover: the header, headings and body text. */
const ink: MantineColorsTuple = [
  "#eef1f6",
  "#d9dfea",
  "#b3bfd4",
  "#8c9dbd",
  "#677da6",
  "#4a6190",
  "#354c7a",
  "#263a63",
  "#1c2c4f",
  "#16233f",
];

// Colours chosen for WCAG AA contrast (4.5:1 for text), checked by
// computation rather than by eye: stamp.7 links are 8.5:1 on white and 7.7:1
// on the page's paper background, ink.6 dimmed text 8.5:1 on white. Links are
// underlined, so that a link in a sentence does not stand out by its colour
// alone. A table that scrolls sideways on a phone can take the focus, so that
// it can be scrolled with the keyboard.
const theme = createTheme({
  colors: { stamp, ink },
  primaryColor: "stamp",
  primaryShade: { light: 7, dark: 3 },
  black: "#16233f",
  fontFamily: FONT_FAMILY,
  fontSizes: {
    xs: "0.8125rem",
    sm: "0.9375rem",
    md: "1.0625rem",
    // the two large sizes shrink on phones, where most visitors are
    lg: "clamp(1.1875rem, 1.05rem + 0.6vw, 1.3125rem)",
    xl: "clamp(1.3125rem, 1.1rem + 1vw, 1.625rem)",
  },
  // larger text needs less leading
  lineHeights: { xs: "1.45", sm: "1.5", md: "1.55", lg: "1.4", xl: "1.3" },
  defaultRadius: "sm",
  radius: { xs: "2px", sm: "3px", md: "4px", lg: "8px", xl: "12px" },
  headings: {
    fontFamily: FONT_FAMILY,
    fontWeight: "800",
    sizes: {
      h1: {
        fontSize: "clamp(2.125rem, 1.4rem + 3vw, 3.25rem)",
        lineHeight: "1.02",
      },
      h2: {
        fontSize: "clamp(1.625rem, 1.3rem + 1.2vw, 2.0625rem)",
        lineHeight: "1.1",
      },
      h3: { fontSize: "1.3125rem", lineHeight: "1.2" },
      h4: { fontSize: "1.125rem", lineHeight: "1.25" },
    },
  },
  components: {
    Anchor: Anchor.extend({ defaultProps: { underline: "always" } }),
    // Yellow and orange notes read as a highlighter over the page rather
    // than a warning box; gray ones are plain white slips, blue ones pale ink.
    Alert: Alert.extend({
      defaultProps: { radius: "sm" },
      vars: (_theme, props) =>
        props.color === "yellow" || props.color === "orange"
          ? {
              root: {
                "--alert-bg": "var(--vw-highlight)",
                "--alert-color": "var(--vw-ink)",
                "--alert-bd": "0",
              },
            }
          : props.color === "gray"
          ? { root: { "--alert-bg": "var(--mantine-color-body)" } }
          : props.color === "blue"
          ? {
              root: {
                "--alert-bg": "var(--mantine-color-ink-0)",
                "--alert-color": "var(--vw-ink)",
              },
            }
          : { root: {} },
    }),
    // sentence case: capitals are for the form numbers the badges carry
    Badge: Badge.extend({
      defaultProps: { radius: "sm" },
      styles: { root: { textTransform: "none" } },
    }),
    Chip: Chip.extend({ defaultProps: { color: "stamp" } }),
    Paper: Paper.extend({ defaultProps: { radius: "sm" } }),
    TableScrollContainer: Table.ScrollContainer.extend({
      defaultProps: { scrollAreaProps: { viewportProps: { tabIndex: 0 } } },
    }),
  },
});

const cssVariablesResolver: CSSVariablesResolver = () => ({
  variables: {},
  light: {
    "--mantine-color-dimmed": "var(--mantine-color-ink-6)",
    "--mantine-color-body": "#ffffff",
    "--mantine-color-default-border": "#c9d2cd",
    "--mantine-color-anchor": "var(--mantine-color-stamp-7)",
  },
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
