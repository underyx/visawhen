import Link from "next/link";
import { useRouter } from "next/router";
import { RefObject, useEffect, useRef, useState } from "react";
import { DiscordIcon } from "./icons";
import { Container, Flex, Image, Text } from "@mantine/core";
import classes from "./Navbar.module.css";

const NAV_LINKS = [
  { href: "/uscis", label: "USCIS" },
  { href: "/nvc", label: "NVC" },
  { href: "/consulates", label: "Consulates" },
  { href: "/visa-bulletin", label: "Visa Bulletin" },
];

/** Which edges of the links strip have links past them, when it scrolls
 * sideways on a phone too narrow for all of them: "left", "right", "both" or
 * undefined. The current page's link is scrolled into view first. */
function useHiddenLinks(ref: RefObject<HTMLElement | null>, pathname: string) {
  const [hidden, setHidden] = useState<string | undefined>(undefined);
  useEffect(() => {
    const strip = ref.current;
    if (strip === null) return;
    const current = strip.querySelector<HTMLElement>('[aria-current="page"]');
    if (current !== null) {
      const right = current.offsetLeft + current.offsetWidth;
      if (current.offsetLeft < strip.scrollLeft)
        strip.scrollLeft = current.offsetLeft;
      else if (right > strip.scrollLeft + strip.clientWidth)
        strip.scrollLeft = right - strip.clientWidth;
    }
    const update = () => {
      const left = strip.scrollLeft > 1;
      const right =
        strip.scrollLeft + strip.clientWidth < strip.scrollWidth - 1;
      setHidden(
        left && right ? "both" : left ? "left" : right ? "right" : undefined,
      );
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(strip);
    strip.addEventListener("scroll", update, { passive: true });
    return () => {
      observer.disconnect();
      strip.removeEventListener("scroll", update);
    };
  }, [ref, pathname]);
  return hidden;
}

export default function Navbar() {
  const { pathname } = useRouter();
  const links = useRef<HTMLElement>(null);
  const hiddenLinks = useHiddenLinks(links, pathname);
  return (
    <Container className={classes.bar}>
      {/* Nothing may wrap: the header has a fixed height, so a second row of
          links would be painted over the page content on narrow screens.
          Where the links do not fit, their strip scrolls sideways. */}
      <Flex
        justify="space-between"
        align="center"
        wrap="nowrap"
        gap="md"
        h="100%"
      >
        <Flex align="center" gap="lg" wrap="nowrap" miw={0}>
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
          <nav
            ref={links}
            className={classes.links}
            data-hidden={hiddenLinks}
            aria-label="Sections"
          >
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
