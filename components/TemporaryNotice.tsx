import { Alert, type AlertProps, VisuallyHidden } from "@mantine/core";
import React from "react";
import { HourglassIcon } from "./icons";

/** What the hourglass stands for, for screen readers and as its tooltip */
const MEANING = "For now, from our reading of the numbers:";

/** A notice about a passing condition that we read from the numbers, not
 * one an agency announced: our data is late, a queue has stalled, USCIS is
 * deciding fewer cases than usual. The hourglass sets it apart from the
 * official notices (PolicyBanner) and from what is true of the visitor's
 * own case. */
export default function TemporaryNotice({ children, ...props }: AlertProps) {
  return (
    <Alert
      color="yellow"
      role="note"
      icon={
        <span title={MEANING} style={{ display: "flex" }}>
          <HourglassIcon width={20} height={20} />
        </span>
      }
      {...props}
    >
      <VisuallyHidden>{MEANING} </VisuallyHidden>
      {children}
    </Alert>
  );
}
