import React from "react";
import VisawhenNavbar from "./VisawhenNavbar";
import Footer from "./Footer";

export default function Layout({ children }: React.PropsWithChildren<{}>) {
  return (
    <>
      <VisawhenNavbar />
      <main>{children}</main>
      <Footer />
    </>
  );
}
