import Link from "next/link";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faDiscord } from "@fortawesome/free-brands-svg-icons";
import {
  Anchor,
  Avatar,
  Button,
  Container,
  Flex,
  Group,
  MediaQuery,
  Text,
} from "@mantine/core";

export default function Navbar() {
  return (
    <Container>
      <Flex justify="space-between" align="center">
        <Group spacing="xl" align="center">
          <Link href="/">
            <Group
              spacing={2}
              sx={(theme) => ({
                color: theme.colors.gray[1],
              })}
            >
              <Avatar src="/logo.svg" alt="Logo for VisaWhen" />
              &nbsp;
              <MediaQuery smallerThan="xs" styles={{ display: "none" }}>
                <Text size="lg" weight="500">
                  VisaWhen
                </Text>
              </MediaQuery>
            </Group>
          </Link>
          <Group spacing="xs">
            <Link href="/nvc">
              <Button compact size="md" color="gray" variant="subtle">
                NVC
              </Button>
            </Link>
            <Link href="/consulates">
              <Button compact size="md" color="gray" variant="subtle">
                Consulates
              </Button>
            </Link>
          </Group>
        </Group>
        <Button
          size="md"
          styles={(theme) => ({
            root: {
              backgroundColor: "#5865f2",
              "&:hover": {
                backgroundColor: theme.fn.darken("#5865f2", 0.05),
              },
            },
          })}
          component="a"
          target="_blank"
          rel="noopener"
          href="https://discord.gg/zkf8w2QtQY"
          leftIcon={<FontAwesomeIcon icon={faDiscord} />}
        >
          <MediaQuery smallerThan="sm" styles={{ display: "none" }}>
            <Text>Join the Discord community</Text>
          </MediaQuery>
          <MediaQuery largerThan="sm" styles={{ display: "none" }}>
            <Text>Discord</Text>
          </MediaQuery>
        </Button>
      </Flex>
    </Container>
  );
}
