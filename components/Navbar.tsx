import Link from "next/link";
import { faHeart } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faDiscord } from "@fortawesome/free-brands-svg-icons";

export default function Navbar() {
  return (
    <nav
      className="navbar is-dark is-fixed-top"
      role="navigation"
      aria-label="main navigation"
    >
      <div className="container is-size-6 is-max-desktop px-2">
        <div className="navbar-brand">
          <Link href="/">
            <a className="navbar-item">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/logo.svg" alt="Logo for VisaWhen" />
              &nbsp;
              <b className="is-hidden-mobile">VisaWhen</b>
            </a>
          </Link>

          <a
            role="button"
            className="navbar-burger"
            aria-label="menu"
            aria-expanded="false"
            data-target="navbarBasicExample"
          >
            <span aria-hidden="true"></span>
            <span aria-hidden="true"></span>
            <span aria-hidden="true"></span>
          </a>
        </div>

        <div className="navbar-menu">
          <div className="navbar-start">
            <Link href="/nvc">
              <a className="navbar-item">NVC</a>
            </Link>

            <Link href="/consulates">
              <a className="navbar-item">Consulates</a>
            </Link>
          </div>

          <div className="navbar-end">
            <div className="navbar-item" style={{ height: "3.25rem" }}>
              <div className="field is-grouped">
                <div className="control">
                  <a
                    href="https://discord.gg/zkf8w2QtQY"
                    className="button is-link has-text-weight-semibold"
                  >
                    <span className="icon">
                      <FontAwesomeIcon icon={faDiscord} />
                    </span>
                    <span className="is-hidden-tablet">Discord</span>
                    <span className="is-hidden-mobile">
                      Join the Discord community
                    </span>
                  </a>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </nav>
  );
}
