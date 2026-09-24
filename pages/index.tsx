import { ChevronRightIcon } from "../components/icons";
import {
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
import React from "react";

interface StepCardProps {
  step: number;
  name: string;
  href: string;
  action: string;
}

function StepCard({
  step,
  name,
  href,
  action,
  children,
}: React.PropsWithChildren<StepCardProps>) {
  return (
    <Card shadow="sm" p="md" radius="md" withBorder>
      <Flex
        direction="column"
        justify="space-between"
        style={{ height: "100%" }}
      >
        <Stack>
          <UnstyledButton component={Link} href={href}>
            <Title order={2} size="h5">
              <Flex justify="space-between" align="center">
                <Group>
                  <Badge variant="filled">Step {step}</Badge>
                  <Text>{name}</Text>
                </Group>
                <ChevronRightIcon />
              </Flex>
            </Title>
          </UnstyledButton>
          <Text>{children}</Text>
        </Stack>
        <Button mt="md" component={Link} href={href}>
          {action}
        </Button>
      </Flex>
    </Card>
  );
}

const DESCRIPTION =
  "Data on US visa wait times at USCIS field offices, the National Visa Center, and US consulates.";

export default function Home() {
  return (
    <Stack>
      <Head>
        <title>US visa wait times</title>
        <meta name="description" content={DESCRIPTION} />
        <link rel="canonical" href="https://visawhen.com" />
        <meta property="og:title" content="US visa wait times" />
        <meta property="og:description" content={DESCRIPTION} />
        <meta property="og:url" content="https://visawhen.com" />
      </Head>
      <Title order={1} size="h2">
        Welcome to VisaWhen
      </Title>
      <Text size="xl">What is your case waiting for right now?</Text>
      <SimpleGrid cols={{ base: 1, sm: 3 }} spacing={{ base: "sm", sm: "md" }}>
        <StepCard
          step={1}
          name="USCIS"
          href="/uscis"
          action="Check USCIS processing"
        >
          This is your step from filing a form with USCIS until they approve it.
          See how fast USCIS is deciding your form, and for the N-400, I-130 and
          I-485, how your own field office is doing.
        </StepCard>
        <StepCard step={2} name="NVC" href="/nvc" action="Check NVC wait times">
          This is your step after the USCIS said they&rsquo;ve approved your
          application, until the NVC says your case is{" "}
          <em>documentarily complete</em>.
        </StepCard>
        <StepCard
          step={3}
          name="Consulate"
          href="/consulates"
          action="Check interview queues"
        >
          After NVC says your case is <em>documentarily complete</em>: see which
          month of cases your embassy or consulate is scheduling interviews for.
        </StepCard>
      </SimpleGrid>
    </Stack>
  );
}
