interface RelatedLink {
  href: string;
  text: string;
}

/** Where a form's page points next: the forms filed with it, and the steps
 * that come after it, which a visitor who knows only one form number would
 * otherwise have to find on the list; and the timeline page that puts the
 * form's path as dates (`timeline`). */
export const RELATED_FORMS: Partial<
  Record<
    string,
    { lead?: string; links?: RelatedLink[]; timeline?: RelatedLink }
  >
> = {
  "I-130": {
    timeline: {
      href: "/timeline/spouse-abroad",
      text: "the spouse visa timeline",
    },
    lead: "After the I-130, a relative abroad goes through",
    links: [
      { href: "/nvc", text: "the National Visa Center" },
      { href: "/consulates", text: "an interview at a consulate" },
    ],
  },
  "I-485": {
    timeline: {
      href: "/timeline/spouse-in-us",
      text: "the marriage green card timeline",
    },
    lead: "Usually filed with the I-485",
    links: [
      { href: "/uscis/i-765", text: "the I-765 work permit" },
      { href: "/uscis/i-131", text: "the I-131 travel document" },
    ],
  },
  "I-765": {
    timeline: {
      href: "/timeline/spouse-in-us",
      text: "the marriage green card timeline",
    },
    lead: "For a green card from inside the US, the I-765 is usually filed with",
    links: [
      { href: "/uscis/i-485", text: "the I-485" },
      { href: "/uscis/i-131", text: "the I-131 travel document" },
    ],
  },
  "I-131": {
    timeline: {
      href: "/timeline/spouse-in-us",
      text: "the marriage green card timeline",
    },
    lead: "For a green card from inside the US, the I-131 is usually filed with",
    links: [
      { href: "/uscis/i-485", text: "the I-485" },
      { href: "/uscis/i-765", text: "the I-765 work permit" },
    ],
  },
  "I-129F": {
    timeline: { href: "/timeline/fiance", text: "the K-1 timeline" },
    lead: "After the I-129F come",
    links: [
      { href: "/consulates", text: "the K-1 interview at a consulate" },
      { href: "/uscis/i-485", text: "the I-485 once you marry in the US" },
    ],
  },
  "I-140": {
    timeline: {
      href: "/timeline/employment",
      text: "the employment green card timeline",
    },
    lead: "After the I-140 come",
    links: [
      {
        href: "/visa-bulletin#employment",
        text: "your priority date in the Visa Bulletin",
      },
      { href: "/uscis/i-485", text: "the I-485 in the US" },
      { href: "/consulates", text: "an interview at a consulate" },
    ],
  },
  "N-400": {
    timeline: {
      href: "/timeline/citizenship",
      text: "the citizenship timeline",
    },
  },
  "I-129": {
    timeline: { href: "/timeline/temporary", text: "the work visa timeline" },
  },
};
