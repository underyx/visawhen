import {
  Anchor,
  AppShell,
  Container,
  Footer,
  Header,
  MantineProvider,
  Stack,
  Text,
  useMantineTheme,
} from "@mantine/core";
import React from "react";
import Navbar from "./Navbar";

export default function PageWrapper({ children }: React.PropsWithChildren<{}>) {
  const { colorScheme } = useMantineTheme();
  return (
    <AppShell
      padding="md"
      header={
        <MantineProvider
          theme={{ colorScheme: colorScheme === "dark" ? "light" : "dark" }}
        >
          <Header height="4rem" p="xs">
            <Navbar />
          </Header>
        </MantineProvider>
      }
      styles={(theme) => ({
        main: {
          backgroundColor:
            theme.colorScheme === "dark"
              ? theme.colors.dark[8]
              : theme.colors.gray[0],
        },
      })}
    >
      <Container>{children}</Container>
      <footer>
        <Stack my="xl" px="xs" spacing="xs" sx={{ textAlign: "center" }}>
          <Text>
            Hey, I&rsquo;m <Anchor href="https://underyx.me">Bence Nagy</Anchor>{" "}
            and I made this website (
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
          <Text weight="bold">Good luck to you all!</Text>
        </Stack>
      </footer>
    </AppShell>
  );
}
