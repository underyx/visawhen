import Link from "next/link";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faDiscord } from "@fortawesome/free-brands-svg-icons";
import { Button, Group, Navbar, NavLink, Text } from "@mantine/core";

export default function VisawhenNavbar() {
  return (
    <Navbar>
      <Navbar.Section>
        <Link href="/">
          <a className="navbar-item">
            <Group spacing="xs">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/logo.svg"
                alt="Logo of VisaWhen maded up of the letters VW"
              />
              <Text weight="bold">VisaWhen</Text>
            </Group>
          </a>
        </Link>
      </Navbar.Section>
      <Navbar.Section grow>
        <Link href="/nvc">
          <NavLink>NVC</NavLink>
        </Link>
        <Link href="/visas">
          <NavLink>by Visa type</NavLink>
        </Link>
        <Link href="/consulates">
          <NavLink>by Consulate</NavLink>
        </Link>
      </Navbar.Section>
      <Navbar.Section>
        <a href="https://discord.gg/zkf8w2QtQY">
          <Button>
            <span className="icon">
              <FontAwesomeIcon icon={faDiscord} />
            </span>
            <span>Discord</span>
            <span>Join the Discord community</span>
          </Button>
        </a>
      </Navbar.Section>
    </Navbar>
  );
}
