import { NavLink } from "@mantine/core";
import Link from "next/link";
import React from "react";
import classes from "./ListRow.module.css";

/** The box the rows sit in. */
export function ListRows({ children }: React.PropsWithChildren) {
  return <div className={classes.list}>{children}</div>;
}

interface Props {
  href: string;
  /** Wraps onto as many lines as it needs */
  label: React.ReactNode;
  /** Kept at the right, never shrunk */
  rightSection?: React.ReactNode;
  /** Navigate with a full page load instead of next/link. The consulate
   * pages need this: their per-page _next/data JSON is not deployed (it
   * would push the site over Cloudflare's 20,000-file limit), so a Link
   * would prefetch the missing JSON on hover and, on click, fetch it again
   * just to 404 and fall back to the same hard navigation. */
  hardNavigation?: boolean;
}

export function ListRow({
  href,
  label,
  rightSection,
  hardNavigation = false,
}: Props) {
  const shared = {
    href,
    label,
    rightSection,
    className: classes.row,
    classNames: { label: classes.label },
  };
  return hardNavigation ? (
    <NavLink component="a" {...shared} />
  ) : (
    <NavLink component={Link} {...shared} />
  );
}

/** A row like ListRow's for an entry with no page to go to: plain text, not a
 * disabled link, so that keyboards and crawlers do not stop at it. */
export function ListItem({
  label,
  rightSection,
}: Pick<Props, "label" | "rightSection">) {
  return (
    <div className={`${classes.row} ${classes.item}`}>
      <div className={classes.label}>{label}</div>
      {rightSection}
    </div>
  );
}
