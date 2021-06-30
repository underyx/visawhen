import "../styles/globals.scss";
import type { AppProps } from "next/app";
import * as FullStory from "@fullstory/browser";
import ReactGA from "react-ga4";

FullStory.init({ orgId: "112R81" });

ReactGA.initialize("G-3QQ9KQ0WCE");
ReactGA.send("pageview");

function MyApp({ Component, pageProps }: AppProps) {
  return <Component {...pageProps} />;
}
export default MyApp;
