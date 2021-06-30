export default function Footer() {
  return (
    <div className="container is-size-6 is-max-desktop my-5">
      <footer className="footer has-background-white-bis has-text-dark has-text-centered">
        <p className="my-2">
          Hey, I&rsquo;m <a href="https://underyx.me">Bence Nagy</a> and I made
          this website (
          <a href="https://github.com/underyx/visawhen">
            source code on GitHub
          </a>
          ) while waiting for my CR-1 visa.
        </p>
        <p className="my-2">
          If you found it useful, consider{" "}
          <a href="https://ko-fi.com/underyx">getting me a coffee</a>. Who
          knows, maybe your donation will end up on my I&#8209;864.
        </p>
        <p className="my-2">
          <strong>Good luck to you all!</strong>
        </p>
      </footer>
    </div>
  );
}
