import React from "react";
import Footer from "./Footer";

export default function PageWrapper({ children }: React.PropsWithChildren<{}>) {
  return (
    <section className="section has-background-white-bis has-text-dark">
      <main className="container is-size-6 is-max-desktop">
        <article className="message is-info">
          <div className="message-body">
            Hey there! You&rsquo;re one of the first people to find this brand
            new site. Please share it in Facebook groups, forums, and wherever
            you think it can help others out!
          </div>
        </article>
        {children}
      </main>
      <Footer />
    </section>
  );
}
