import { deburr } from "lodash";

/** Text as the list pages' search boxes compare it: accents stripped, lower
 * case, letters and digits only. "São Paulo", "sao paulo" and "saopaulo" all
 * come out the same, and so do "I-485" and "i485". */
export function normalize(text: string): string {
  return deburr(text)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

/** The words of a text, each as normalize leaves it: "St. Louis" is "st",
 * "louis". */
function words(text: string): string[] {
  return deburr(text)
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word !== "");
}

/** How a normalized term starts where one of the words does, running on
 * into the words after it when it is longer: 0 when it ends where a word ends
 * ("san", "sanfrancisco" and "franciscoca" in "San Francisco CA"), 1 when it
 * ends partway through one ("fran"), and null when it does not start at a
 * word ("ciscoca", or "sf" in "Fort Myers FL"). */
function rankAtWord(textWords: string[], term: string): number | null {
  let rank: number | null = null;
  for (let start = 0; start < textWords.length; start++) {
    let text = "";
    for (const word of textWords.slice(start)) {
      text += word;
      if (text === term) {
        return 0;
      }
      if (text.startsWith(term)) {
        rank = 1;
      }
      if (!term.startsWith(text)) {
        break;
      }
    }
  }
  return rank;
}

/** How well what was typed in a search box finds a place with these names
 * (its own and any other it goes by) in one of these regions (a state's code
 * and name, a country), for sorting the places it finds: 0 when what was
 * typed is whole words ("ca" for California), 1 when it ends partway through
 * a word ("ca" for Carolina), and null when it does not find the place.
 *
 * The search has to start at the start of a word, of the name or of the
 * region, and can run on from the name into the region: "fran", "san fran",
 * "tx", "texas" and "houston tx" all find what they should, but "sf" does not
 * find Fort Myers, FL through "myer(s f)l". A name of two or more words is
 * also found by their first letters: "sf" finds San Francisco, "slc" Salt
 * Lake City. */
export function rankPlace(
  typed: string,
  names: string[],
  regions: (string | null)[],
): number | null {
  const term = normalize(typed);
  if (term === "") {
    return 0;
  }
  const regionWords = regions.flatMap((region) =>
    region === null ? [] : [words(region)],
  );
  const ranks = names.flatMap((name) => {
    const nameWords = words(name);
    const initials = nameWords.map((word) => word[0]).join("");
    return [
      nameWords.length < 2 || !initials.startsWith(term)
        ? null
        : initials === term
        ? 0
        : 1,
      rankAtWord(nameWords, term),
      ...regionWords.map((region) =>
        rankAtWord([...nameWords, ...region], term),
      ),
    ].filter((rank) => rank !== null);
  });
  return ranks.length === 0 ? null : Math.min(...ranks);
}
