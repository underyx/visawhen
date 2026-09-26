import { Stack, Text } from "@mantine/core";
import React from "react";

// Notices and warnings open with a one- or two-sentence summary in plain
// English, since most visitors read English as a second language; the dates,
// the exact wording of the sources and the caveats go in here, closed until
// the visitor asks for them. A native <details>: it opens before the page's
// scripts have loaded, and its text stays in the prerendered HTML.

export default function MoreDetails({
  label = "Details",
  children,
}: React.PropsWithChildren<{ label?: string }>) {
  return (
    <details>
      <Text
        component="summary"
        size="sm"
        fw={600}
        style={{ cursor: "pointer" }}
      >
        {label}
      </Text>
      <Stack gap="xs" mt="xs">
        {children}
      </Stack>
    </details>
  );
}
