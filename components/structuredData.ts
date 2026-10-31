import type {
  BreadcrumbList,
  Person,
  Thing,
  WebSite,
  WithContext,
} from "schema-dts";

// schema.org data for search engines, in <script type="application/ld+json">
// tags. Spread the result of one of these functions into a <script> that is
// a direct child of next/head's <Head>.

/** Props for a <script> tag that holds the item as JSON-LD. Characters that
 * could end the tag or start markup ("<", ">", "&" and quotes) are written as
 * HTML entities, as JSON-LD allows, and null values are left out. */
export function jsonLdScriptProps<T extends Thing>(item: WithContext<T>) {
  return {
    type: "application/ld+json",
    dangerouslySetInnerHTML: {
      __html: JSON.stringify(item, (_, value: unknown) =>
        value === null
          ? undefined
          : typeof value === "string"
            ? value.replace(/[&<>"']/g, (c) => HTML_ENTITIES[c])
            : value,
      ),
    },
  };
}

const HTML_ENTITIES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&apos;",
};

const SITE_URL = "https://visawhen.com";

/** Who makes the site, as its datasets name him */
export const CREATOR: Person = {
  "@type": "Person",
  familyName: "Nagy",
  givenName: "Bence",
  additionalName: "underyx",
  url: "https://underyx.me",
};

/** The license of the site's code and data */
export const LICENSE_URL =
  "https://github.com/underyx/visawhen/blob/main/LICENSE";

/** The site itself, for the home page: search engines show its name next to
 * its pages in results. */
export function webSite() {
  return jsonLdScriptProps<WebSite>({
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: "VisaWhen",
    url: SITE_URL,
    inLanguage: "en",
  });
}

/** Where a page sits in the site, from its section down to the page itself:
 * search results can show this path instead of the page's address. */
export function breadcrumbList(crumbs: { name: string; path: string }[]) {
  return jsonLdScriptProps<BreadcrumbList>({
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: crumbs.map(({ name, path }, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name,
      item: `${SITE_URL}${path}`,
    })),
  });
}
