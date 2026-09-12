import { deburr } from "lodash";

/** Text as the list pages' search boxes compare it: accents stripped, lower
 * case, letters and digits only. "São Paulo", "sao paulo" and "saopaulo" all
 * come out the same, and so do "I-485" and "i485". */
export function normalize(text: string): string {
  return deburr(text)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}
