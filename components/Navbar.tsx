import Link from "next/link";
import { DiscordIcon } from "./icons";
import { Avatar, Button, Container, Flex, Group, Text } from "@mantine/core";

export default function Navbar() {
  return (
    <Container>
      <Flex justify="space-between" align="center">
        <Group gap="sm" align="center">
          <Link href="/">
            <Group gap={2} c="gray.1">
              <Avatar src="/logo.svg" alt="Logo for VisaWhen" />
              &nbsp;
              <Text size="lg" fw={500} visibleFrom="xs">
                VisaWhen
              </Text>
            </Group>
          </Link>
          <Group gap="xs">
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
          leftSection={<DiscordIcon />}
        >
          <Text visibleFrom="sm">Join the Discord community</Text>
          <Text hiddenFrom="sm">Discord</Text>
        </Button>
      </Flex>
    </Container>
  );
}
