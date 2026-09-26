import { Anchor, AppShell, Container, Text } from "@mantine/core";
import Link from "next/link";
import React from "react";
import Navbar from "./Navbar";
import classes from "./PageWrapper.module.css";

export default function PageWrapper({ children }: React.PropsWithChildren) {
  return (
    <AppShell padding="md" header={{ height: "4rem" }}>
      <AppShell.Header className={classes.header}>
        <Navbar />
      </AppShell.Header>
      <AppShell.Main className={classes.main}>
        <Container pt="md">{children}</Container>
        <Container component="footer">
          <div className={classes.footer}>
            <div className={classes.footerGrid}>
              <Text size="sm" maw="62ch">
                VisaWhen is an independent project, not affiliated with USCIS,
                the State Department or any other government agency, and nothing
                on it is legal advice. Its numbers come from the agencies&rsquo;
                own published data; each page names its source and how recent it
                is.{" "}
                <Anchor component={Link} href="/about">
                  Where the data comes from
                </Anchor>
                .
              </Text>
              <div>
                <Text size="sm">
                  Hey, I&rsquo;m{" "}
                  <Anchor href="https://underyx.me">Bence Nagy</Anchor> and I
                  made this website (
                  <Anchor href="https://github.com/underyx/visawhen">
                    source code on GitHub
                  </Anchor>
                  ) while waiting for my CR-1 visa. If you found it useful,
                  consider{" "}
                  <Anchor href="https://ko-fi.com/underyx">
                    getting me a coffee
                  </Anchor>
                  . Who knows, maybe your donation will end up on my
                  I&#8209;864.
                </Text>
                <Text className={classes.signoff} mt="sm">
                  Good luck to you all!
                </Text>
              </div>
            </div>
          </div>
        </Container>
      </AppShell.Main>
    </AppShell>
  );
}
