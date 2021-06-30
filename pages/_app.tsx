import "../styles/globals.scss";
import type { AppProps } from "next/app";
import ReactGA from "react-ga4";

ReactGA.initialize("G-3QQ9KQ0WCE");
ReactGA.send("pageview");

function MyApp({ Component, pageProps }: AppProps) {
  return <Component {...pageProps} />;
}
export default MyApp;
