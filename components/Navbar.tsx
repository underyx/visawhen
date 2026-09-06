import Link from "next/link";
import { DiscordIcon } from "./icons";
import { Avatar, Button, Container, Flex, Group, Text } from "@mantine/core";

export default function Navbar() {
  return (
    <Container>
      {/* Nothing may wrap: the header has a fixed height, so a second row of
          links would be painted over the page content on narrow screens. */}
      <Flex justify="space-between" align="center" wrap="nowrap" gap="xs">
        <Group gap="sm" align="center" wrap="nowrap">
          <Link href="/">
            <Group gap={2} c="gray.1" wrap="nowrap">
              <Avatar src="/logo.svg" alt="Logo for VisaWhen" />
              &nbsp;
              <Text size="lg" fw={500} visibleFrom="xs">
                VisaWhen
              </Text>
            </Group>
          </Link>
          <Group gap={4} wrap="nowrap">
            <Link href="/uscis">
              <Button size="compact-sm" color="gray.2" variant="subtle">
                USCIS
              </Button>
            </Link>
            <Link href="/nvc">
              <Button size="compact-sm" color="gray.2" variant="subtle">
                NVC
              </Button>
            </Link>
            <Link href="/consulates">
              <Button size="compact-sm" color="gray.2" variant="subtle">
                Consulates
              </Button>
            </Link>
          </Group>
        </Group>
        <Button
          size="sm"
          color="#5865f2"
          component="a"
          target="_blank"
          rel="noopener"
          href="https://discord.gg/zkf8w2QtQY"
          aria-label="Join the Discord community"
          leftSection={<DiscordIcon />}
          style={{ flexShrink: 0 }}
        >
          <Text visibleFrom="sm">Join the Discord community</Text>
          <Text hiddenFrom="sm" visibleFrom="xs">
            Discord
          </Text>
        </Button>
      </Flex>
    </Container>
  );
}
