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
import { deburr, groupBy, sortBy } from "lodash";
import { GetStaticProps } from "next";
import Head from "next/head";
import Link from "next/link";
import React, { useMemo } from "react";
import { getActiveForms, getData } from "../../api/uscis";
import {
  formatCount,
  formatMonths,
  quarterLabel,
  toPoints,
} from "../../components/uscis";
import classes from "../../components/ListButton.module.css";

interface FormSummary {
  slug: string;
  form: string;
  title: string;
  category: string;
  pending: number | null;
  waitMonths: number | null;
  /** USCIS's median processing time in months for the form's main category */
  processingTime: number | null;
  officeCount: number;
}

interface Props {
  forms: FormSummary[];
  latestLabel: string;
  totalPending: number;
}

const CATEGORY_ORDER = [
  "Family Based",
  "Lawful Permanent Residence",
  "Citizenship and Nationality",
  "Employment Based",
  "Humanitarian",
  "Other",
  "Supplemental Processing",
];

export const getStaticProps: GetStaticProps<Props> = async () => {
  const data = await getData();
  const forms = getActiveForms(data).map((form) => {
    const points = toPoints(data.periods, form.quarters);
    const latest = points[points.length - 1];
    const main = [...form.quarters[latest.quarter].variants].sort(
      (a, b) => (b.received ?? 0) - (a.received ?? 0),
    )[0];
    return {
      slug: form.slug,
      form: form.form,
      title: form.title,
      category: form.category ?? "Other",
      pending: latest.pending,
      waitMonths: latest.waitMonths,
      processingTime: main?.processingTime ?? null,
      officeCount: form.offices.length,
    };
  });
  const activeForms = getActiveForms(data);
  const coveredPeriods = data.periods.filter((period) =>
    activeForms.some((form) => form.quarters[period.quarter] !== undefined),
  );
  const latestPeriod = coveredPeriods[coveredPeriods.length - 1];
  return {
    props: {
      forms,
      latestLabel: latestPeriod ? quarterLabel(latestPeriod) : "",
      totalPending: forms.reduce((sum, form) => sum + (form.pending ?? 0), 0),
    },
  };
};

function normalize(text: string): string {
  return deburr(text)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

export default function UscisIndex({
  forms,
  latestLabel,
  totalPending,
}: Props) {
  const [term, setTerm] = useInputState("");
  const groups = useMemo(() => {
    const normalizedTerm = normalize(term);
    const filtered = forms.filter(({ form, title }) =>
      normalize(`${form} ${title}`).includes(normalizedTerm),
    );
    const byCategory = groupBy(filtered, "category");
    return sortBy(Object.entries(byCategory), ([category]) => {
      const index = CATEGORY_ORDER.indexOf(category);
      return index === -1 ? CATEGORY_ORDER.length : index;
    }).map(([category, items]) => ({
      category,
      items: sortBy(items, [({ pending }) => -(pending ?? 0), "form"]),
    }));
  }, [forms, term]);

  const description = `USCIS had ${formatCount(
    totalPending,
  )} applications and petitions pending at the end of ${latestLabel}. See how fast it is deciding yours, form by form.`;

  return (
    <Stack gap="xl">
      <Head>
        <title>USCIS processing times by form</title>
        <meta name="description" content={description} />
        <link rel="canonical" href="https://visawhen.com/uscis" />
        <meta property="og:title" content="USCIS processing times by form" />
        <meta property="og:description" content={description} />
        <meta property="og:url" content="https://visawhen.com/uscis" />
      </Head>
      <Stack gap="sm">
        <Title order={1}>USCIS processing times by form</Title>
        <Text size="xl">Latest USCIS data: {latestLabel}.</Text>
        <Text>
          Every quarter, USCIS publishes how many applications of each form it
          received, approved, denied, and still had waiting. Pick your form to
          see the trend, and for the N-400, I-130 and I-485 also how your own
          field office is doing. The wait shown next to each form is how long it
          would take to decide every pending application at that quarter&rsquo;s
          pace; it is not USCIS&rsquo;s{" "}
          <Anchor
            href="https://egov.uscis.gov/processing-times/"
            target="_blank"
            rel="noopener"
          >
            official processing time
          </Anchor>
          , but it moves the same way.
        </Text>
      </Stack>
      <TextInput
        size="lg"
        leftSection={<SearchIcon />}
        type="text"
        placeholder="I-485"
        onChange={setTerm}
      />
      {groups.map(({ category, items }) => (
        <Stack gap="sm" key={category}>
          <Title order={2}>{category}</Title>
          <Button.Group orientation="vertical">
            {items.map(({ slug, form, title, waitMonths, officeCount }) => (
              <Button
                size="lg"
                variant="default"
                key={slug}
                component={Link}
                href={`/uscis/${slug}`}
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
                  <Badge size="lg" radius="sm" color="blue" variant="light">
                    <Highlight highlight={term}>{form}</Highlight>
                  </Badge>
                  <Highlight highlight={term} lineClamp={1}>
                    {title}
                  </Highlight>
                  {officeCount > 0 && (
                    <Badge size="sm" radius="sm" color="gray" variant="light">
                      by office
                    </Badge>
                  )}
                </Group>
              </Button>
            ))}
          </Button.Group>
        </Stack>
      ))}
    </Stack>
  );
}
