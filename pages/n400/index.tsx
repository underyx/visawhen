import { SearchIcon } from "../../components/icons";
import {
  Anchor,
  Badge,
  Button,
  Group,
  Highlight,
  Stack,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { useInputState } from "@mantine/hooks";
import { deburr, sortBy } from "lodash";
import { GetStaticProps } from "next";
import Head from "next/head";
import Link from "next/link";
import React, { useMemo } from "react";
import { getActiveOffices, getData, Period } from "../../api/n400";
import {
  formatMonths,
  highlight,
  QuarterPoint,
  toPoints,
} from "../../components/n400";
import { N400OutcomesChart, N400WaitChart } from "../../components/N400Chart";
import N400Stats from "../../components/N400Stats";
import classes from "../../components/ListButton.module.css";

interface OfficeSummary {
  slug: string;
  name: string;
  stateCode: string | null;
  pending: number | null;
  waitMonths: number | null;
}

interface Props {
  points: QuarterPoint[];
  latestPeriod: Period;
  offices: OfficeSummary[];
}

export const getStaticProps: GetStaticProps<Props> = async () => {
  const data = await getData();
  const points = toPoints(data.periods, data.total);
  return {
    props: {
      points,
      latestPeriod: data.periods[data.periods.length - 1],
      offices: getActiveOffices(data).map((office) => {
        const officePoints = toPoints(data.periods, office.quarters);
        const latest = officePoints[officePoints.length - 1];
        return {
          slug: office.slug,
          name: office.name,
          stateCode: office.stateCode,
          pending: latest.pending,
          waitMonths: latest.waitMonths,
        };
      }),
    },
  };
};

function normalize(text: string): string {
  return deburr(text).toLowerCase().replace(/[^a-z0-9]/g, "");
}

export default function N400Index({ points, latestPeriod, offices }: Props) {
  const [term, setTerm] = useInputState("");
  const current = points[points.length - 1];
  const filteredOffices = useMemo<OfficeSummary[]>(() => {
    const normalizedTerm = normalize(term);
    return sortBy(
      offices.filter(({ name, stateCode }) =>
        normalize(`${name} ${stateCode ?? ""}`).includes(normalizedTerm),
      ),
      [({ pending }) => -(pending ?? 0), "name"],
    );
  }, [offices, term]);

  const description = `USCIS had ${current.pending?.toLocaleString(
    "en-US",
  )} N-400 naturalization applications pending at the end of ${
    current.label
  }. See how fast your field office is deciding them.`;

  return (
    <Stack gap="xl">
      <Head>
        <title>N-400 processing times by field office</title>
        <meta name="description" content={description} />
        <link rel="canonical" href="https://visawhen.com/n400" />
        <meta
          property="og:title"
          content="N-400 processing times by field office"
        />
        <meta property="og:description" content={description} />
        <meta property="og:url" content="https://visawhen.com/n400" />
      </Head>
      <Stack gap="sm">
        <Title order={1}>N-400 processing times by field office</Title>
        <Text size="xl">
          Latest USCIS data: {current.label}, from the{" "}
          <Anchor href={latestPeriod.source} target="_blank" rel="noopener">
            fiscal year {latestPeriod.fiscalYear} quarter{" "}
            {latestPeriod.fiscalQuarter} report
          </Anchor>
          .
        </Text>
        <Text>
          Every quarter, USCIS publishes how many naturalization applications
          each field office received, approved, denied, and still had waiting.
          Here&rsquo;s what that looks like nationwide; pick your field office
          below for its own numbers.
        </Text>
      </Stack>
      <Stack gap="sm">
        <Title order={2}>All field offices</Title>
        <N400Stats points={points} />
        <Text>
          <strong>Quarter-over-quarter highlight:</strong>{" "}
          {highlight(points, "USCIS field offices")}
        </Text>
        <Text>
          Each bar is everything an office had to decide on in a quarter: the
          applications waiting when it started plus the ones filed during it.
          Blue was approved that quarter, red denied, and amber was still
          waiting when it ended.
        </Text>
        <N400OutcomesChart points={points} source={latestPeriod.source} />
        <Text>
          The estimated wait is how long it would take to decide every pending
          application if the office kept up that quarter&rsquo;s pace. It is
          not USCIS&rsquo;s official processing time, but it moves the same
          way, and it is the number that explains why your case is waiting.
        </Text>
        <N400WaitChart points={points} />
      </Stack>
      <Stack gap="sm">
        <Title order={2}>Select your field office</Title>
        <Text>
          Your N-400 is handled by the field office whose jurisdiction covers
          your home address. Not sure which one?{" "}
          <Anchor
            href="https://www.uscis.gov/about-us/find-a-uscis-office/field-offices"
            target="_blank"
            rel="noopener"
          >
            Look it up on USCIS&rsquo;s office locator
          </Anchor>
          .
        </Text>
        <TextInput
          size="lg"
          leftSection={<SearchIcon />}
          type="text"
          placeholder="San Francisco"
          onChange={setTerm}
        />
        <Button.Group orientation="vertical">
          {filteredOffices.map(({ slug, name, stateCode, waitMonths }) => (
            <Button
              size="lg"
              variant="default"
              key={slug}
              component={Link}
              href={`/n400/${slug}`}
              classNames={{ root: classes.root, inner: classes.inner }}
              justify="space-between"
              rightSection={
                <Badge
                  size="lg"
                  radius="sm"
                  variant="outline"
                  color="gray"
                  tt="none"
                  fw={500}
                >
                  ~{formatMonths(waitMonths)}
                </Badge>
              }
            >
              <Group gap="xs" wrap="nowrap">
                <Highlight highlight={term}>{name}</Highlight>
                {stateCode !== null && (
                  <Badge size="lg" radius="sm" color="blue" variant="light">
                    <Highlight highlight={term}>{stateCode}</Highlight>
                  </Badge>
                )}
              </Group>
            </Button>
          ))}
        </Button.Group>
      </Stack>
    </Stack>
  );
}
