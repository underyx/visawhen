import Link from "next/link";
import { faHeart } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";

export default function Navbar() {
  return (
    <nav
      className="navbar is-dark is-fixed-top"
      role="navigation"
      aria-label="main navigation"
    >
      <div className="navbar-brand">
        <Link href="/">
          <a className="navbar-item">
            <b>VisaWhen</b>
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
                  href="https://ko-fi.com/underyx"
                  className="button is-success"
                >
                  <span className="icon">
                    <FontAwesomeIcon icon={faHeart} />
                  </span>
                  <span>Buy Bence a coffee</span>
                </a>
              </div>
            </div>
          </div>
        </div>
      </div>
    </nav>
  );
}
