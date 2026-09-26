import Link from "next/link";
import { useRouter } from "next/router";
import { DiscordIcon } from "./icons";
import { Container, Flex, Image, Text } from "@mantine/core";
import classes from "./Navbar.module.css";

const NAV_LINKS = [
  { href: "/uscis", label: "USCIS" },
  { href: "/nvc", label: "NVC" },
  { href: "/consulates", label: "Consulates" },
];

export default function Navbar() {
  const { pathname } = useRouter();
  return (
    <Container className={classes.bar}>
      {/* Nothing may wrap: the header has a fixed height, so a second row of
          links would be painted over the page content on narrow screens. */}
      <Flex
        justify="space-between"
        align="center"
        wrap="nowrap"
        gap="md"
        h="100%"
      >
        <Flex align="center" gap="lg" wrap="nowrap">
          <Link href="/" className={classes.brand} aria-label="VisaWhen home">
            <Image src="/logo.svg" alt="" w={32} h={32} />
            <Text
              component="span"
              className={classes.wordmark}
              visibleFrom="xs"
              aria-hidden
            >
              VisaWhen
            </Text>
          </Link>
          <nav className={classes.links} aria-label="Sections">
            {NAV_LINKS.map(({ href, label }) => (
              <Link
                key={href}
                href={href}
                className={classes.link}
                aria-current={
                  pathname === href || pathname.startsWith(`${href}/`)
                    ? "page"
                    : undefined
                }
              >
                {label}
              </Link>
            ))}
          </nav>
        </Flex>
        <a
          className={classes.discord}
          target="_blank"
          rel="noopener"
          href="https://discord.gg/zkf8w2QtQY"
          aria-label="Join the Discord community"
        >
          <DiscordIcon />
          <Text component="span" inherit visibleFrom="sm">
            Join the Discord community
          </Text>
          <Text component="span" inherit hiddenFrom="sm" visibleFrom="xs">
            Discord
          </Text>
        </a>
      </Flex>
    </Container>
  );
}
