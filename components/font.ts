import { Archivo } from "next/font/google";

/** One family for everything: Archivo's width axis gives the headings and
 * the estimate stamp their condensed, printed-form look while the body text
 * stays at its normal width. Self-hosted by next/font at build time. */
const archivo = Archivo({
  subsets: ["latin", "latin-ext"],
  axes: ["wdth"],
  display: "swap",
});

/** The site's font stack */
export const FONT_FAMILY = `${archivo.style.fontFamily}, system-ui, sans-serif`;
