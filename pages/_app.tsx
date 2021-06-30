import "../styles/globals.scss";
import type { AppProps } from "next/app";
import * as FullStory from "@fullstory/browser";

FullStory.init({ orgId: "112R81" });

function MyApp({ Component, pageProps }: AppProps) {
  return <Component {...pageProps} />;
}
export default MyApp;
