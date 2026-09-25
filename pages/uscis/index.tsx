import { SearchIcon } from "../../components/icons";
import {
  Anchor,
  Badge,
  Group,
  Highlight,
  Stack,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { useInputState } from "@mantine/hooks";
import { groupBy, sortBy } from "lodash";
import { GetStaticProps } from "next";
import Head from "next/head";
import React, { useMemo } from "react";
import { getActiveForms, getData, newestQuarter } from "../../api/uscis";
import {
  categoryRanges,
  formatRangeMonths,
  headlineRange,
} from "../../components/estimate";
import { formatCount, quarterLabel, toPoints } from "../../components/uscis";
import { ListRow, ListRows } from "../../components/ListRow";
import { normalize } from "../../components/search";

interface FormSummary {
  slug: string;
  form: string;
  title: string;
  category: string;
  pending: number | null;
  /** What to expect if filing today in the form's main category, "11-22
   * mo", "priority date" when that depends on the Visa Bulletin, or null */
  badge: string | null;
  /** The category the badge is for, when the form has more than one */
  badgeCategory: string | null;
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
    const ranges = categoryRanges(form);
    const headline = headlineRange(ranges);
    return {
      slug: form.slug,
      form: form.form,
      title: form.title,
      category: form.category ?? "Other",
      pending: latest.pending,
      badge:
        headline !== null
          ? formatRangeMonths(headline.q[1], headline.q[3], "mo")
          : ranges.some(
              ({ priorityDate, suppressed }) =>
                priorityDate && suppressed === null,
            )
          ? "priority date"
          : null,
      badgeCategory:
        headline !== null && headline.name !== form.form ? headline.name : null,
      officeCount: form.offices.length,
    };
  });
  const latestPeriod = data.periods.find(
    (period) => period.quarter === newestQuarter(data),
  );
  return {
    props: {
      forms,
      latestLabel: latestPeriod ? quarterLabel(latestPeriod) : "",
      totalPending: forms.reduce((sum, form) => sum + (form.pending ?? 0), 0),
    },
  };
};

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
          received, approved, denied, and still had waiting, and its median
          processing time for most of them. Pick your form to see the trend, and
          for the N-400, I-130 and I-485 also how your own field office is
          doing. The range next to a form is how long a decision will most
          likely take if you file today, going by USCIS&rsquo;s median for{" "}
          {latestLabel}; for a form with several categories, it is for the one
          named under it. For your own case, also check USCIS&rsquo;s{" "}
          <Anchor
            href="https://egov.uscis.gov/processing-times/"
            target="_blank"
            rel="noopener"
          >
            processing times tool
          </Anchor>
          .
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
          <ListRows>
            {items.map(
              ({ slug, form, title, badge, badgeCategory, officeCount }) => (
                <ListRow
                  key={slug}
                  href={`/uscis/${slug}`}
                  rightSection={
                    badge !== null && (
                      <Stack gap={2} align="flex-end">
                        <Badge
                          size="lg"
                          radius="sm"
                          variant="outline"
                          color="gray"
                          tt="none"
                          fw={500}
                        >
                          {badge}
                        </Badge>
                        {badgeCategory !== null && (
                          <Text size="xs" c="dimmed" ta="right">
                            {badgeCategory}
                          </Text>
                        )}
                      </Stack>
                    )
                  }
                  label={
                    <Group gap="xs">
                      <Badge size="lg" radius="sm" color="blue" variant="light">
                        <Highlight highlight={term}>{form}</Highlight>
                      </Badge>
                      <Highlight highlight={term}>{title}</Highlight>
                      {officeCount > 0 && (
                        <Badge
                          size="sm"
                          radius="sm"
                          color="gray"
                          variant="light"
                        >
                          by office
                        </Badge>
                      )}
                    </Group>
                  }
                />
              ),
            )}
          </ListRows>
        </Stack>
      ))}
    </Stack>
  );
}
