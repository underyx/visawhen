import { Anchor, AppShell, Container, Stack, Text } from "@mantine/core";
import React from "react";
import Navbar from "./Navbar";
import classes from "./PageWrapper.module.css";

export default function PageWrapper({ children }: React.PropsWithChildren) {
  return (
    <AppShell padding="md" header={{ height: "4rem" }}>
      <AppShell.Header p="xs" className={classes.header}>
        <Navbar />
      </AppShell.Header>
      <AppShell.Main className={classes.main}>
        <Container>{children}</Container>
        <footer>
          <Stack my="xl" px="xs" gap="xs" ta="center">
            <Text>
              Hey, I&rsquo;m{" "}
              <Anchor href="https://underyx.me">Bence Nagy</Anchor> and I made
              this website (
              <Anchor href="https://github.com/underyx/visawhen">
                source code on GitHub
              </Anchor>
              ) while waiting for my CR-1 visa.
            </Text>
            <Text>
              If you found it useful, consider{" "}
              <Anchor href="https://ko-fi.com/underyx">
                getting me a coffee
              </Anchor>
              . Who knows, maybe your donation will end up on my I&#8209;864.
            </Text>
            <Text fw="bold">Good luck to you all!</Text>
          </Stack>
        </footer>
      </AppShell.Main>
    </AppShell>
  );
}
