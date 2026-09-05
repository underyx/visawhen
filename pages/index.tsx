import { ChevronRightIcon } from "../components/icons";
import {
  Anchor,
  Badge,
  Button,
  Card,
  Flex,
  Group,
  SimpleGrid,
  Stack,
  Text,
  Title,
  UnstyledButton,
} from "@mantine/core";
import Head from "next/head";
import Link from "next/link";

export default function Home() {
  return (
    <Stack>
      <Head>
        <title>US visa wait times</title>
        <meta
          name="description"
          content="Data on US visa wait times at USCIS field offices, the National Visa Center, and US consulates."
        />
        <link rel="canonical" href="https://visawhen.com" />
        <meta property="og:title" content="US visa wait times" />
        <meta
          property="og:description"
          content="Data on US visa wait times at USCIS field offices, the National Visa Center, and US consulates."
        />
        <meta property="og:url" content="https://visawhen.com" />
      </Head>
      <Title order={1} size="h2">
        Welcome to VisaWhen
      </Title>
      <Text size="xl">What is your case waiting for right now?</Text>
      <SimpleGrid cols={{ base: 1, sm: 3 }} spacing={{ base: "sm", sm: "md" }}>
        <Card shadow="sm" p="md" radius="md" withBorder>
          <Flex
            direction="column"
            justify="space-between"
            style={{ height: "100%" }}
          >
            <Stack>
              <UnstyledButton component={Link} href="/n400">
                <Title order={2} size="h5">
                  <Flex justify="space-between" align="center">
                    <Group>
                      <Badge variant="filled">Step 1</Badge>
                      <Text>USCIS</Text>
                    </Group>
                    <ChevronRightIcon />
                  </Flex>
                </Title>
              </UnstyledButton>
              <Text>
                Applying for citizenship? See how fast your field office is
                deciding <em>N-400</em> applications. For other forms, check
                the{" "}
                <Anchor
                  href="https://egov.uscis.gov/processing-times/"
                  target="_blank"
                  rel="noopener noreferer"
                >
                  USCIS Case Processing Times
                </Anchor>{" "}
                page.
              </Text>
            </Stack>
            <Button mt="md" component={Link} href="/n400">
              Check N-400 processing
            </Button>
          </Flex>
        </Card>
        <Card shadow="sm" p="md" radius="md" withBorder>
          <Flex
            direction="column"
            justify="space-between"
            style={{ height: "100%" }}
          >
            <Stack>
              <UnstyledButton component={Link} href="/nvc">
                <Title order={2} size="h5">
                  <Flex justify="space-between" align="center">
                    <Group>
                      <Badge variant="filled">Step 2</Badge>
                      <Text>NVC</Text>
                    </Group>
                    <ChevronRightIcon />
                  </Flex>
                </Title>
              </UnstyledButton>
              <Text>
                This is your step after the USCIS said they&rsquo;ve approved
                your application, until the NVC says your case has been{" "}
                <em>documentarily qualified</em>.
              </Text>
            </Stack>
            <Button mt="md" component={Link} href="/nvc">
              Check NVC wait times
            </Button>
          </Flex>
        </Card>
        <Card shadow="sm" p="md" radius="md" withBorder>
          <Flex
            direction="column"
            justify="space-between"
            style={{ height: "100%" }}
          >
            <Stack>
              <UnstyledButton component={Link} href="/consulates">
                <Title order={2} size="h5">
                  <Flex justify="space-between" align="center">
                    <Group>
                      <Badge variant="filled">Step 3</Badge>
                      <Text>Consulate</Text>
                    </Group>
                    <ChevronRightIcon />
                  </Flex>
                </Title>
              </UnstyledButton>
              <Text>
                This is your step after the NVC said your case has been{" "}
                <em>documentarily qualified</em>, until you get your visa from
                an embassy or consulate.
              </Text>
            </Stack>
            <Button mt="md" component={Link} href="/consulates">
              Check consulate rates
            </Button>
          </Flex>
        </Card>
      </SimpleGrid>
    </Stack>
  );
}
