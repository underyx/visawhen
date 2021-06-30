import React from "react";
import Footer from "./Footer";

export default function PageWrapper({ children }: React.PropsWithChildren<{}>) {
  return (
    <section className="section has-background-white-bis has-text-dark">
      <main className="container is-size-6 is-max-desktop">{children}</main>
      <Footer />
    </section>
  );
}
