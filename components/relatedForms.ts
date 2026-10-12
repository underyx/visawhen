interface RelatedLink {
  href: string;
  text: string;
}

/** Where a form's page points next, in one short sentence (`next`: its
 * words and links in order), so that a visitor who knows only one form
 * number finds the forms filed with it and the steps that come after it
 * without the list; and the timeline page that puts the form's path as
 * dates (`timeline`, "spouse visa timeline": the page says "The … puts the
 * whole wait as dates"). */
export const RELATED_FORMS: Partial<
  Record<string, { next?: (string | RelatedLink)[]; timeline?: RelatedLink }>
> = {
  "I-130": {
    timeline: { href: "/timeline/spouse-abroad", text: "spouse visa timeline" },
    next: [
      "Next: ",
      { href: "/nvc", text: "the National Visa Center" },
      ", then ",
      { href: "/consulates", text: "an interview at a consulate" },
      ".",
    ],
  },
  "I-485": {
    timeline: {
      href: "/timeline/spouse-in-us",
      text: "marriage green card timeline",
    },
    next: [
      "Usually filed with ",
      { href: "/uscis/i-765", text: "the I-765 work permit" },
      " and ",
      { href: "/uscis/i-131", text: "the I-131 travel document" },
      ".",
    ],
  },
  "I-765": {
    timeline: {
      href: "/timeline/spouse-in-us",
      text: "marriage green card timeline",
    },
    next: [
      "Usually filed with ",
      { href: "/uscis/i-485", text: "the I-485" },
      " and ",
      { href: "/uscis/i-131", text: "the I-131 travel document" },
      ".",
    ],
  },
  "I-131": {
    timeline: {
      href: "/timeline/spouse-in-us",
      text: "marriage green card timeline",
    },
    next: [
      "Usually filed with ",
      { href: "/uscis/i-485", text: "the I-485" },
      " and ",
      { href: "/uscis/i-765", text: "the I-765 work permit" },
      ".",
    ],
  },
  "I-129F": {
    timeline: { href: "/timeline/fiance", text: "K-1 timeline" },
    next: [
      "Next: ",
      { href: "/consulates", text: "the K-1 interview at a consulate" },
      ", then ",
      { href: "/uscis/i-485", text: "the I-485 once you marry in the US" },
      ".",
    ],
  },
  "I-140": {
    timeline: {
      href: "/timeline/employment",
      text: "employment green card timeline",
    },
    next: [
      "Next: ",
      {
        href: "/visa-bulletin#employment",
        text: "your priority date in the Visa Bulletin",
      },
      ", then ",
      { href: "/uscis/i-485", text: "the I-485 in the US" },
      " or ",
      { href: "/consulates", text: "an interview at a consulate" },
      ".",
    ],
  },
  "N-400": {
    timeline: { href: "/timeline/citizenship", text: "citizenship timeline" },
  },
  "I-129": {
    timeline: { href: "/timeline/temporary", text: "work visa timeline" },
  },
};
