import React from "react";
import Footer from "./Footer";

export default function PageWrapper({ children }: React.PropsWithChildren<{}>) {
  return (
    <section className="section has-background-white-bis has-text-dark">
      <section className="container is-size-6 is-max-desktop">
        <aside className="message is-info">
          <div className="message-body">
            <strong>News from Nov 8th:</strong> Hey, why does the immigration
            community not have a place to chat? I wondered this and next thing I
            know, I created a Discord community for ourselves!{" "}
            <strong>
              <a href="https://discord.gg/zkf8w2QtQY">Come say hi to 44 members and counting!</a>
            </strong>
          </div>
        </aside>
        <article>{children}</article>
      </section>
      <Footer />
    </section>
  );
}
