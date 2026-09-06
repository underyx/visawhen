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
}

export function ListRow({ href, label, rightSection }: Props) {
  return (
    <NavLink
      component={Link}
      href={href}
      label={label}
      rightSection={rightSection}
      className={classes.row}
      classNames={{ label: classes.label }}
    />
  );
}
