import type { NvcSeries } from "../api/nvc";
import type { PolicyEntry } from "./policy";
import { scheduleOverrideFor } from "./policy";
import type { CategoryRange } from "./estimate";
import {
  formatMedian,
  formatRangeMonths,
  PRIORITY_DATE_TEXT,
} from "./estimate";
import {
  addDays,
  addMonths,
  daysBetween,
  formatDate,
  formatMonthRange,
  formatShortDate,
} from "./dates";
import { formatIvMonth, monthsBehind } from "./consulates";
import { DOL_PROCESSING_TIMES_URL, GLOBAL_VISA_WAIT_TIMES_URL } from "./links";
import { front, getStall, reviewRange } from "./nvcReview";
import type { Movement } from "./visaBulletin";
import {
  formatBulletinMonth,
  formatCutoff,
  formatMonths as formatWholeMonths,
  isDate,
  monthsBetweenDates,
} from "./visaBulletin";

// The timeline pages: one page per common route through the process (a
// path), listing the steps left and when each will most likely land, chained
// into one window. Everything a page shows is worked out here from the same
// numbers the section pages show, so that a step's range on a timeline page
// is the range its own page gives:
//
// - a USCIS step takes the form's range for the visitor's category
//   (components/estimate.ts), counted from the day it starts;
// - NVC's case creation and document review take NVC's newest timeframes,
//   and for a submission date the visitor gives, the /nvc page's range
//   (components/nvcReview.ts);
// - the interview takes State's IV Scheduling Status Tool: the month of
//   documentarily complete cases a post is scheduling now, and how that
//   month moved over the last year (see interviewEstimate);
// - a priority date takes the Visa Bulletin's cutoffs and how far they
//   moved, and says nothing about when they will reach a date.
//
// The visitor says where their case is (a milestone and its date), which
// makes the steps before it done and starts the next one on that date; with
// nothing said, the timeline is for a case started today. The prerendered
// page does not know today's date, so until the client knows it the steps
// show durations ("11–22 months after you file") and then dates.

/** The path pages, by their path segment */
export type PathSlug =
  | "spouse-abroad"
  | "spouse-in-us"
  | "fiance"
  | "citizenship"
  | "employment"
  | "other-family"
  | "temporary";

/** Something the visitor can say has happened, with the date it did */
export interface Milestone {
  id: string;
  /** As the "Where is your case?" list shows it: "USCIS approved the I-130" */
  label: string;
  /** The date field's label: "The day it was approved" */
  dateLabel: string;
}

interface StageBase {
  id: string;
  /** "USCIS decides the I-130 petition" */
  name: string;
  /** What happens in this step, in plain English */
  what: string;
  /** The page with the numbers behind it, and its link text */
  href: string | null;
  hrefText?: string;
  /** The visitor can say the step started (`start`) or ended (`end`) on a
   * date */
  start?: Milestone;
  end?: Milestone;
  /** Runs alongside the stage with this id, from the same start, and does
   * not hold the next step up: the work permit filed with the I-485 */
  parallelTo?: string;
  /** Comes much later, from a date the timeline cannot know (the I-751, two
   * years after entry): shown with its current duration, never dated */
  detached?: boolean;
}

export type StageSpec =
  | (StageBase & { kind: "uscis"; form: string; category: string })
  | (StageBase & { kind: "nvc-creation" })
  | (StageBase & { kind: "your-step" })
  | (StageBase & { kind: "nvc-review" })
  | (StageBase & { kind: "interview" })
  | (StageBase & { kind: "priority-date"; categories: "family" | "employment" })
  | (StageBase & { kind: "note" });

/** What a path's page asks the visitor for, besides where their case is */
export type PathInput = "consulate" | "office" | "bulletin";

export interface PathSpec {
  slug: PathSlug;
  /** As the home page lists it */
  title: string;
  /** The page's <title> and meta description, written for search */
  pageTitle: string;
  description: string;
  /** Who the path is for, under the title */
  who: string;
  inputs: PathInput[];
  /** The USCIS form whose field offices the office input lists, with the
   * per-office category the comparison is of (null: all categories) */
  officeForm?: { form: string; category: string | null };
  stages: StageSpec[];
}

const I130_FILED: Milestone = {
  id: "i-130-filed",
  label: "I filed the I-130",
  dateLabel: "The day USCIS received it",
};
const I130_APPROVED: Milestone = {
  id: "i-130-approved",
  label: "USCIS approved the I-130",
  dateLabel: "The day it was approved",
};
const I485_FILED: Milestone = {
  id: "i-485-filed",
  label: "I filed the I-485",
  dateLabel: "The day USCIS received it",
};
const I485_APPROVED: Milestone = {
  id: "i-485-approved",
  label: "USCIS approved the I-485",
  dateLabel: "The day it was approved",
};

const I751_NOTE =
  "If you were married for less than 2 years when you got your green card, the card is valid for 2 years. File the I-751 in the 90 days before it expires, with your spouse, or alone with a waiver at any time before it expires.";

/** The I-751, as the paths that can end in a 2-year green card list it */
const I751_STAGE: StageSpec = {
  kind: "uscis",
  id: "i-751",
  form: "I-751",
  category: "all",
  name: "Later: removing the conditions (I-751)",
  what: I751_NOTE,
  href: "/uscis/i-751",
  hrefText: "I-751 processing times",
  detached: true,
};

const EAD_STAGE: StageSpec = {
  kind: "uscis",
  id: "i-765",
  form: "I-765",
  category: "adjustment-of-status",
  name: "Work permit (I-765)",
  what: "Usually filed together with the I-485, at no extra fee. You can work in the US once it is approved.",
  href: "/uscis/i-765",
  hrefText: "I-765 processing times",
  parallelTo: "i-485",
};

const AP_STAGE: StageSpec = {
  kind: "uscis",
  id: "i-131",
  form: "I-131",
  category: "advance-parole",
  name: "Travel document (I-131)",
  what: "Usually filed together with the I-485. Leaving the US before it is approved can cancel your I-485, unless you hold H or L status.",
  href: "/uscis/i-131",
  hrefText: "I-131 processing times",
  parallelTo: "i-485",
};

export const PATHS: PathSpec[] = [
  {
    slug: "spouse-abroad",
    title: "Spouse, parent or child of a US citizen, living abroad",
    pageTitle:
      "Spouse visa timeline (CR-1, IR-1): I-130, NVC and interview waits",
    description:
      "How long each step takes right now for a spouse, parent or child of a US citizen immigrating through a US consulate: the I-130 at USCIS, the National Visa Center, and the interview queue at your consulate, as dates.",
    who: "Immediate relatives who immigrate through a US embassy or consulate (IR-1 and CR-1 for spouses, IR-2 for children, IR-5 for parents).",
    inputs: ["consulate", "office"],
    officeForm: { form: "I-130", category: "immediate-relative" },
    stages: [
      {
        kind: "uscis",
        id: "i-130",
        form: "I-130",
        category: "immediate-relative",
        name: "USCIS decides the I-130 petition",
        what: "Your US citizen relative files Form I-130 with USCIS. USCIS checks that the relationship is real and approves the petition.",
        href: "/uscis/i-130",
        hrefText: "I-130 processing times",
        start: I130_FILED,
        end: I130_APPROVED,
      },
      {
        kind: "nvc-creation",
        id: "nvc-creation",
        name: "NVC creates your case",
        what: "USCIS sends the approved petition to the National Visa Center (NVC). NVC creates a case for it and emails you a welcome letter with your case number.",
        href: "/nvc",
        hrefText: "NVC wait times",
        start: {
          id: "sent-to-nvc",
          label: "USCIS sent my case to the State Department",
          dateLabel: "The day the USCIS case status changed",
        },
        end: {
          id: "nvc-created",
          label: "NVC created my case",
          dateLabel: "The date of NVC’s welcome letter",
        },
      },
      {
        kind: "your-step",
        id: "documents",
        name: "You pay the fees and submit your documents",
        what: "You pay the fees, fill in the DS-260 form and upload your civil and financial documents on CEAC. This step takes as long as you need.",
        href: null,
        end: {
          id: "documents-submitted",
          label: "I submitted my documents to NVC",
          dateLabel: "The day you last submitted them",
        },
      },
      {
        kind: "nvc-review",
        id: "nvc-review",
        name: "NVC reviews your documents",
        what: "NVC checks documents in the order they came in. When it accepts all of yours, your case is documentarily complete, and it waits in line for an interview.",
        href: "/nvc",
        hrefText: "NVC wait times",
        end: {
          id: "documentarily-complete",
          label: "NVC said my case is documentarily complete",
          dateLabel: "The day NVC said so",
        },
      },
      {
        kind: "interview",
        id: "interview",
        name: "Interview at your consulate",
        what: "NVC schedules interviews by the month cases became documentarily complete. Each month, the State Department publishes which month each consulate is scheduling now.",
        href: "/consulates",
        hrefText: "consulate interview queues",
        end: {
          id: "interview-scheduled",
          label: "My interview is scheduled",
          dateLabel: "The interview date",
        },
      },
      {
        kind: "note",
        id: "visa",
        name: "Visa and travel",
        what: "If the visa is approved at the interview, you usually get your passport back with the visa within days to weeks. After you pay the USCIS immigrant fee and enter the US, your green card comes by mail.",
        href: null,
      },
      I751_STAGE,
    ],
  },
  {
    slug: "spouse-in-us",
    title: "Spouse of a US citizen, living in the US",
    pageTitle:
      "Marriage green card timeline in the US: I-130, I-485, work permit waits",
    description:
      "How long each step takes right now for the spouse of a US citizen getting a green card without leaving the US: the I-485 with the I-130, the work permit and the travel document, as dates.",
    who: "Getting a green card without leaving the US (adjustment of status), after entering with a visa or another inspection. If you entered another way, talk to an immigration lawyer before filing.",
    inputs: ["office"],
    officeForm: { form: "I-485", category: "family" },
    stages: [
      {
        kind: "uscis",
        id: "i-485",
        form: "I-485",
        category: "family",
        name: "USCIS decides the I-130 and the I-485",
        what: "You usually file the I-130 petition and the I-485 green card application together. USCIS decides them together, usually after an interview with both of you.",
        href: "/uscis/i-485",
        hrefText: "I-485 processing times",
        start: I485_FILED,
        end: I485_APPROVED,
      },
      EAD_STAGE,
      AP_STAGE,
      {
        kind: "note",
        id: "card",
        name: "Green card",
        what: "USCIS mails the card within weeks of the approval. If you were married for less than 2 years when it was approved, it is a 2-year conditional card.",
        href: null,
      },
      I751_STAGE,
    ],
  },
  {
    slug: "fiance",
    title: "Fiancé(e) of a US citizen",
    pageTitle:
      "K-1 fiancé(e) visa timeline: I-129F, interview and green card waits",
    description:
      "How long each step takes right now for the fiancé(e) of a US citizen: the I-129F at USCIS, the K-1 interview, and the I-485 green card application after the wedding, as dates.",
    who: "Coming to the US on a K-1 visa to marry within 90 days, then getting a green card there.",
    inputs: ["office"],
    officeForm: { form: "I-485", category: "family" },
    stages: [
      {
        kind: "uscis",
        id: "i-129f",
        form: "I-129F",
        category: "all",
        name: "USCIS decides the I-129F petition",
        what: "Your US citizen fiancé(e) files Form I-129F with USCIS.",
        href: "/uscis/i-129f",
        hrefText: "I-129F processing times",
        start: {
          id: "i-129f-filed",
          label: "I filed the I-129F",
          dateLabel: "The day USCIS received it",
        },
        end: {
          id: "i-129f-approved",
          label: "USCIS approved the I-129F",
          dateLabel: "The day it was approved",
        },
      },
      {
        kind: "note",
        id: "nvc",
        name: "NVC sends your case to the consulate",
        what: "The National Visa Center gives K-1 cases a case number and sends them on to the consulate, usually within a few weeks. Its published timeframes do not cover K visas, so there is no number for this step.",
        href: "/nvc",
        hrefText: "NVC wait times",
        end: {
          id: "k1-at-consulate",
          label: "The consulate received my case",
          dateLabel: "The day it told you so",
        },
      },
      {
        kind: "note",
        id: "k1-interview",
        name: "K-1 interview at your consulate",
        what: "The consulate sends you instructions, and you book the interview and the medical exam. The State Department publishes no scheduling data for K-1 interviews; your consulate’s page shows how many K-1 visas it issues each month.",
        href: "/consulates",
        hrefText: "consulate pages",
        end: {
          id: "k1-interview",
          label: "My K-1 interview is scheduled",
          dateLabel: "The interview date",
        },
      },
      {
        kind: "note",
        id: "wedding",
        name: "Entry and wedding",
        what: "Enter the US while the visa is valid (up to 6 months) and marry within 90 days of entering.",
        href: null,
        end: {
          id: "married",
          label: "We got married in the US",
          dateLabel: "The wedding day",
        },
      },
      {
        kind: "uscis",
        id: "i-485",
        form: "I-485",
        category: "family",
        name: "USCIS decides the I-485",
        what: "After the wedding, you file the I-485 green card application, usually with the I-765 and I-131. Until then, you cannot work or travel.",
        href: "/uscis/i-485",
        hrefText: "I-485 processing times",
        start: I485_FILED,
        end: I485_APPROVED,
      },
      EAD_STAGE,
      AP_STAGE,
      {
        ...I751_STAGE,
        what: "Most K-1 couples get a 2-year conditional green card, since they are married for less than 2 years when it is approved. File the I-751 in the 90 days before it expires.",
      },
    ],
  },
  {
    slug: "citizenship",
    title: "Becoming a US citizen",
    pageTitle: "N-400 citizenship timeline: how long naturalization takes now",
    description:
      "How long the N-400 takes right now, as dates, with a check of how your own field office compares with the rest of the country.",
    who: "Naturalization for green card holders.",
    inputs: ["office"],
    officeForm: { form: "N-400", category: null },
    stages: [
      {
        kind: "uscis",
        id: "n-400",
        form: "N-400",
        category: "civilian",
        name: "USCIS decides the N-400",
        what: "You file the N-400, give your fingerprints, and go to an interview with the English and civics test at your field office. USCIS usually decides at the interview.",
        href: "/uscis/n-400",
        hrefText: "N-400 processing times by office",
        start: {
          id: "n-400-filed",
          label: "I filed the N-400",
          dateLabel: "The day USCIS received it",
        },
        end: {
          id: "n-400-approved",
          label: "USCIS approved the N-400",
          dateLabel: "The day it was approved",
        },
      },
      {
        kind: "note",
        id: "oath",
        name: "Oath ceremony",
        what: "You become a citizen at the oath ceremony, often on the day of the interview or within a few weeks after it. USCIS publishes no data on this wait.",
        href: null,
      },
    ],
  },
  {
    slug: "employment",
    title: "Employment-based green card",
    pageTitle:
      "Employment green card timeline (EB-1, EB-2, EB-3): I-140, priority date and I-485",
    description:
      "How long each step takes right now for an employment-based green card: the I-140 at USCIS, your priority date in the Visa Bulletin, and the I-485 with the work permit and travel document, as dates.",
    who: "EB-1, EB-2 and EB-3, sponsored by an employer or self-petitioned.",
    inputs: ["bulletin", "office"],
    officeForm: { form: "I-485", category: "employment" },
    stages: [
      {
        kind: "note",
        id: "perm",
        name: "PERM labor certification",
        what: "For most EB-2 and EB-3 cases, your employer first gets a prevailing wage determination and a PERM labor certification from the Department of Labor. Those waits are not covered here: see the Department of Labor’s processing times.",
        href: DOL_PROCESSING_TIMES_URL,
        hrefText: "Department of Labor processing times",
        end: {
          id: "perm-certified",
          label: "The Department of Labor certified the PERM",
          dateLabel: "The day it was certified",
        },
      },
      {
        kind: "uscis",
        id: "i-140",
        form: "I-140",
        category: "all",
        name: "USCIS decides the I-140 petition",
        what: "Your employer, or you, files Form I-140 with USCIS. For an extra fee, premium processing gets a decision within 15 business days (45 for some cases).",
        href: "/uscis/i-140",
        hrefText: "I-140 processing times",
        start: {
          id: "i-140-filed",
          label: "I filed the I-140",
          dateLabel: "The day USCIS received it",
        },
        end: {
          id: "i-140-approved",
          label: "USCIS approved the I-140",
          dateLabel: "The day it was approved",
        },
      },
      {
        kind: "priority-date",
        id: "priority-date",
        categories: "employment",
        name: "Your priority date becomes current",
        what: "Only a limited number of green cards is given each year in each category and country of birth, so people wait in line by their priority date: the day the PERM was filed, or the I-140 if no PERM was needed. Each month, the Visa Bulletin says which dates have reached the front of the line.",
        href: "/visa-bulletin",
        hrefText: "Visa Bulletin dates",
      },
      {
        kind: "uscis",
        id: "i-485",
        form: "I-485",
        category: "employment",
        name: "In the US: USCIS decides the I-485",
        what: "Once the Visa Bulletin lets you, you file the I-485 green card application, usually with the I-765 and I-131. USCIS can approve it only when your priority date is current in the Final Action Dates chart.",
        href: "/uscis/i-485",
        hrefText: "I-485 processing times",
        start: I485_FILED,
        end: I485_APPROVED,
      },
      EAD_STAGE,
      AP_STAGE,
      {
        kind: "note",
        id: "abroad",
        name: "Abroad: NVC and the interview at your consulate",
        what: "If you are outside the US, your case goes to the National Visa Center once your priority date is current in the Dates for Filing chart, and then to an interview at your consulate.",
        href: "/nvc",
        hrefText: "NVC wait times",
      },
    ],
  },
  {
    slug: "other-family",
    title:
      "Other family: siblings, adult children, relatives of green card holders",
    pageTitle:
      "Family preference green card timeline (F1 to F4): I-130, priority date and interview",
    description:
      "How long each step takes right now in the family preference categories F1, F2A, F2B, F3 and F4: the I-130 at USCIS, your priority date in the Visa Bulletin, and the steps after it.",
    who: "The family preference categories: unmarried adult children of US citizens (F1), spouses and children of green card holders (F2A and F2B), married children of US citizens (F3) and siblings of US citizens (F4).",
    inputs: ["bulletin"],
    stages: [
      {
        kind: "uscis",
        id: "i-130",
        form: "I-130",
        category: "all-other-relative",
        name: "USCIS decides the I-130 petition",
        what: "Your relative files Form I-130 with USCIS. The day USCIS receives it is your priority date, your place in line, whenever USCIS decides the petition.",
        href: "/uscis/i-130",
        hrefText: "I-130 processing times",
        start: I130_FILED,
        end: I130_APPROVED,
      },
      {
        kind: "priority-date",
        id: "priority-date",
        categories: "family",
        name: "Your priority date becomes current",
        what: "Only a limited number of green cards is given each year in each category and country of birth, so people wait in line by their priority date, often for years. Each month, the Visa Bulletin says which dates have reached the front of the line.",
        href: "/visa-bulletin",
        hrefText: "Visa Bulletin dates",
      },
      {
        kind: "note",
        id: "abroad",
        name: "Abroad: NVC and the interview at your consulate",
        what: "Once your priority date is current in the Dates for Filing chart, NVC can have you pay the fees and submit your documents. The interview comes once your date is current in the Final Action Dates chart and your consulate reaches your case.",
        href: "/nvc",
        hrefText: "NVC wait times",
      },
      {
        kind: "uscis",
        id: "i-485",
        form: "I-485",
        category: "family",
        name: "In the US: USCIS decides the I-485",
        what: "If you can adjust status in the US, you file the I-485 once the Visa Bulletin lets you, usually with the I-765 and I-131.",
        href: "/uscis/i-485",
        hrefText: "I-485 processing times",
        start: I485_FILED,
        end: I485_APPROVED,
      },
    ],
  },
  {
    slug: "temporary",
    title: "Visitor, student or temporary work visa",
    pageTitle:
      "Work visa timeline (H-1B, L-1, O-1): the I-129 petition and the consulate",
    description:
      "How long the I-129 petition takes right now for H, L, O, P, Q and R work visas, as dates, and where to find the appointment wait at your consulate.",
    who: "B, F, J, H, L, O and other nonimmigrant visas.",
    inputs: [],
    stages: [
      {
        kind: "uscis",
        id: "i-129",
        form: "I-129",
        category: "all",
        name: "USCIS decides the I-129 petition",
        what: "Most employer-sponsored work visas (H, L, O, P, Q and R) start with an I-129 petition from the employer. For an H-1B under the annual cap, the employer first registers you in USCIS’s H-1B registration and can file only if you are selected. For an extra fee, premium processing gets a decision within 15 business days. E and TN visas use the I-129 only to change or extend status inside the US, and J exchange visitors and visitors and students do not use it at all.",
        href: "/uscis/i-129",
        hrefText: "I-129 processing times",
        start: {
          id: "i-129-filed",
          label: "My employer filed the I-129",
          dateLabel: "The day USCIS received it",
        },
        end: {
          id: "i-129-approved",
          label: "USCIS approved the I-129",
          dateLabel: "The day it was approved",
        },
      },
      {
        kind: "note",
        id: "appointment",
        name: "Visa appointment at your consulate",
        what: "You book the visa interview at a US consulate. The wait for an appointment is in the State Department’s Global Visa Wait Times, which this site does not cover. Your consulate’s page shows how many visas of each class it issues.",
        href: GLOBAL_VISA_WAIT_TIMES_URL,
        hrefText: "Global Visa Wait Times",
      },
    ],
  },
];

export function pathBySlug(slug: string): PathSpec | undefined {
  return PATHS.find((path) => path.slug === slug);
}

/** The milestones a path's page lists, in the order of its steps */
export function pathMilestones(path: PathSpec): Milestone[] {
  return path.stages.flatMap((stage) =>
    stage.parallelTo !== undefined || stage.detached === true
      ? []
      : [
          ...(stage.start === undefined ? [] : [stage.start]),
          ...(stage.end === undefined ? [] : [stage.end]),
        ],
  );
}

// The data a path page needs, assembled by api/timeline.ts

export interface PostQueue {
  slug: string;
  name: string;
  /** "Philippines", or null */
  country: string | null;
  /** The month of documentarily complete cases NVC was scheduling most
   * interviews for at the post, for spouses, children and parents of US
   * citizens, in each of State's updates we have, oldest first: the update's
   * date and the month, "2026-02", or null where State gave N/A */
  history: [asOf: string, month: string | null][];
}

export interface OfficeOption {
  slug: string;
  /** "San Francisco, CA" */
  name: string;
  /** How the office's backlog compares with the field offices' together (or
   * the country's), by the office page's rule (compareClearing); null when
   * the office page gives no verdict */
  verdict: "longer" | "shorter" | "close" | null;
}

export interface BulletinCell {
  /** The newest bulletin's Final Action Date and Date for Filing */
  final: string;
  filing: string;
  /** How far the Final Action Date moved in the last 12 and 60 months */
  year: Movement | null;
  fiveYears: Movement | null;
}

export interface BulletinOptions {
  /** The newest bulletin's month, "2026-10" */
  month: string;
  categories: { key: string; slug: string; name: string; who: string }[];
  areas: { key: string; slug: string; name: string }[];
  /** By category key, then area key */
  cells: Record<string, Record<string, BulletinCell>>;
}

export interface TimelineData {
  /** The quarter of USCIS's medians, "Apr–Jun 2026" */
  quarterLabel: string;
  /** By "form/category" */
  ranges: Record<string, CategoryRange>;
  /** NVC's newest readings, enough of them for the /nvc page's range */
  nvc: { creation: NvcSeries; review: NvcSeries } | null;
  /** The posts in State's tool, with the date of its newest update */
  posts: PostQueue[] | null;
  ivAsOf: string | null;
  /** The field offices of the path's office form, if any */
  offices: OfficeOption[] | null;
  /** The quarter the office comparison is of */
  officeQuarter: string | null;
  bulletin: BulletinOptions | null;
}

/** What the visitor told the page */
export interface TimelineInputs {
  /** A Milestone.id, or "" for none */
  milestone: string;
  /** Its date, "2026-03-14", or "" */
  date: string;
  /** A post slug, or "" */
  post: string;
  /** An office slug, or "" */
  office: string;
  /** A Visa Bulletin category key and area key, or "" */
  category: string;
  area: string;
  /** The priority date, "2019-03-14", or "" */
  priorityDate: string;
}

export const EMPTY_INPUTS: TimelineInputs = {
  milestone: "",
  date: "",
  post: "",
  office: "",
  category: "",
  area: "",
  priorityDate: "",
};

// The answers in the page's address

/** The name each answer goes by in the page's address, after the #
 * ("#milestone=nvc-created&date=2026-03-14&consulate=manila"), so a
 * filled-in timeline can be bookmarked or shared */
const HASH_KEYS: [keyof TimelineInputs, string][] = [
  ["milestone", "milestone"],
  ["date", "date"],
  ["post", "consulate"],
  ["office", "office"],
  ["category", "category"],
  ["area", "country"],
  ["priorityDate", "priority"],
];

/** The answers as the page's fragment, or "" when nothing is filled in */
export function inputsToHash(inputs: TimelineInputs): string {
  const params = new URLSearchParams();
  for (const [field, key] of HASH_KEYS)
    if (inputs[field] !== "") params.set(key, inputs[field]);
  const query = params.toString();
  return query === "" ? "" : `#${query}`;
}

/** The answers a page's fragment holds. `allowed` lists the values each
 * select offers; a value it does not list, a name the page does not know, a
 * date that is not one, or a date without its milestone count as not
 * answered, so an old or edited link never shows a choice the page lacks */
export function inputsFromHash(
  hash: string,
  allowed: Partial<Record<keyof TimelineInputs, readonly string[]>>,
): TimelineInputs {
  const params = new URLSearchParams(hash.replace(/^#/, ""));
  const inputs = { ...EMPTY_INPUTS };
  for (const [field, key] of HASH_KEYS) {
    const value = params.get(key) ?? "";
    const options = allowed[field];
    inputs[field] =
      options !== undefined
        ? options.includes(value)
          ? value
          : ""
        : validDate(value, null) ?? "";
  }
  if (inputs.milestone === "") inputs.date = "";
  return inputs;
}

// Dates and durations

export interface DateRange {
  low: string;
  high: string;
}

/** A duration in days, as a range */
export interface Days {
  low: number;
  high: number;
}

const MONTH_DAYS = 30.44;

function monthsToDays(months: number): number {
  return Math.round(months * MONTH_DAYS);
}

/** A duration: "24–54 days" up to about four months, else "5–9 months" */
export function formatDuration({ low, high }: Days): string {
  if (high <= 120)
    return low === high ? `about ${low} days` : `${low}–${high} days`;
  return formatRangeMonths(low / MONTH_DAYS, high / MONTH_DAYS);
}

/** Two dates as the months they fall in when they are far apart ("Aug
 * 2027 – Jul 2028"), else as days ("Nov 3 – Nov 24, 2026") */
export function formatDateRange({ low, high }: DateRange): string {
  if (daysBetween(low, high) > 90) return formatMonthRange(low, high);
  if (low === high) return formatShortDate(low);
  if (low.slice(0, 4) === high.slice(0, 4)) {
    const start = formatShortDate(low).replace(/, \d{4}$/, "");
    return `${start} – ${formatShortDate(high)}`;
  }
  return `${formatShortDate(low)} – ${formatShortDate(high)}`;
}

function shift(range: DateRange, days: Days): DateRange {
  return {
    low: addDays(range.low, days.low),
    high: addDays(range.high, days.high),
  };
}

function shiftMonths(range: DateRange, low: number, high: number): DateRange {
  return { low: addMonths(range.low, low), high: addMonths(range.high, high) };
}

/** A range no earlier than today: a step that is not done cannot have ended
 * before today */
function fromToday(range: DateRange, today: string): DateRange {
  return {
    low: range.low > today ? range.low : today,
    high: range.high > today ? range.high : today,
  };
}

/** A real calendar date in ISO form: "2026-02-30" is not one, though
 * Date.parse reads it as March 2 */
function isIsoDate(date: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const parsed = Date.parse(date);
  return (
    !Number.isNaN(parsed) &&
    new Date(parsed).toISOString().slice(0, 10) === date
  );
}

/** The visitor's milestone date, when it is a date and not in the future */
export function validDate(date: string, today: string | null): string | null {
  if (!isIsoDate(date)) return null;
  if (today !== null && date > today) return null;
  return date;
}

// The estimates

export type StageStatus = "done" | "current" | "ahead";

export interface StageResult {
  spec: StageSpec;
  status: StageStatus;
  /** When the step starts, when that can be dated */
  start: DateRange | null;
  /** When it will most likely end */
  end: DateRange | null;
  /** The wider range it could end in (USCIS's 80% band) */
  outer: DateRange | null;
  /** The most likely duration, for the undated text and the total */
  days: Days | null;
  outerDays: Days | null;
  /** The bold line: "Most likely Aug 2027 – Jul 2028", or what stands in
   * for it */
  headline: string;
  /** What the headline rests on, behind "How we worked this out" */
  basis: string[];
  /** A warning shown before the headline */
  warning: string | null;
  /** The input the step needs before it can say anything */
  needs: PathInput | null;
}

export interface TimelineResult {
  stages: StageResult[];
  /** The last step on the main line that could be dated (or timed): what
   * the stamp shows */
  total: { stage: StageResult; days: Days; end: DateRange | null } | null;
}

interface Context {
  data: TimelineData;
  inputs: TimelineInputs;
  today: string | null;
}

/** "most likely 11–22 months after you file" */
function afterText(spec: StageSpec): string {
  return spec.start !== undefined ? "after you file" : "after the step before";
}

/** "Most likely Nov 2027 – Dec 2028", or for a step under way whose range
 * today is already in, "Most likely by Dec 6, 2026" */
function dateHeadline(
  end: DateRange,
  status: StageStatus,
  today: string | null,
): string {
  return status === "current" && today !== null && today >= end.low
    ? `Most likely by ${formatShortDate(end.high)}`
    : `Most likely ${formatDateRange(end)}`;
}

function uscisStage(
  spec: Extract<StageSpec, { kind: "uscis" }>,
  start: DateRange | null,
  status: StageStatus,
  { data, today }: Context,
): StageResult {
  const base = {
    spec,
    status,
    start,
    end: null,
    outer: null,
    days: null,
    outerDays: null,
    basis: [] as string[],
    warning: null,
    needs: null,
  };
  const range = data.ranges[`${spec.form}/${spec.category}`];
  if (range === undefined)
    return {
      ...base,
      headline:
        "No estimate: USCIS publishes no median processing time for these cases.",
    };
  if (range.priorityDate)
    return {
      ...base,
      headline: `USCIS’s median for the ones it decided was ${formatMedian(
        range.median,
      )}.`,
      basis: [
        PRIORITY_DATE_TEXT[spec.form]?.[spec.category]?.(
          formatMedian(range.median),
        ) ?? "The wait depends on your priority date.",
        "The next step counts from your priority date, not from this decision.",
      ],
    };
  if (range.suppressed === "too few decisions")
    return {
      ...base,
      headline:
        "No estimate: USCIS decided too few of these cases last quarter.",
    };
  if (range.suppressed === "nearly stopped")
    return {
      ...base,
      headline: "No estimate: USCIS has nearly stopped deciding these cases.",
      basis: [
        `USCIS decided ${Math.round(
          (1 - (range.shockRatio ?? 0)) * 100,
        )}% fewer of them in ${
          data.quarterLabel
        } than its average over the four quarters before.`,
      ],
    };
  const days = {
    low: monthsToDays(range.q[1]),
    high: monthsToDays(range.q[3]),
  };
  const outerDays = {
    low: monthsToDays(range.q[0]),
    high: monthsToDays(range.q[4]),
  };
  const basis = [
    `Based on USCIS’s median time of ${formatMedian(range.median)} for ${
      range.name === spec.form
        ? `the ${spec.form}`
        : `${spec.form} (${range.name})`
    } cases (${
      data.quarterLabel
    } data), and on how far real waits landed from the median in past quarters: about half landed in the most likely range and 8 in 10 in the wider one.`,
  ];
  if (range.premium)
    basis.push(
      "The median counts premium and regular cases together. With premium processing, USCIS acts within weeks; without it, expect the later end of the range, or longer.",
    );
  let warning: string | null = null;
  if (range.shock && range.shockRatio !== null)
    warning = `USCIS decided ${Math.round(
      (1 - range.shockRatio) * 100,
    )}% fewer of these cases in ${
      data.quarterLabel
    } than its average over the four quarters before. Plan for the later end of the range.`;
  if (start === null)
    return {
      ...base,
      days,
      outerDays,
      basis,
      warning,
      headline: `Most likely ${formatDuration(days)} ${afterText(spec)}`,
    };
  let end = shiftMonths(start, range.q[1], range.q[3]);
  let outer = shiftMonths(start, range.q[0], range.q[4]);
  let headline = dateHeadline(end, status, today);
  // a case under way: what is left of its range, from today; past the
  // range, the next step counts from today, the soonest it can start
  if (status === "current" && today !== null) {
    if (today > outer.high) {
      headline = `This is taking longer than 9 in 10 cases did`;
      warning = `Your case has waited longer than 9 in 10 cases did (${formatDateRange(
        outer,
      )}). You can ask USCIS about a case that is outside its normal processing time: its processing times tool says from which date.`;
      end = { low: today, high: today };
      outer = end;
    } else if (today > end.high) {
      headline = `Most likely by ${formatShortDate(outer.high)}`;
      warning = `Your case has already taken longer than most (the most likely range ended ${formatShortDate(
        end.high,
      )}). It could still take until ${formatShortDate(outer.high)}.`;
      end = { low: today, high: outer.high };
      outer = end;
    } else {
      headline =
        today >= end.low
          ? `Most likely by ${formatShortDate(end.high)}`
          : `Most likely ${formatDateRange(end)}`;
      end = fromToday(end, today);
      outer = fromToday(outer, today);
    }
  }
  return { ...base, end, outer, days, outerDays, basis, warning, headline };
}

/** NVC's newest reading of a series: its date and its days */
function latestReading(series: NvcSeries): [string, number] {
  const entries = Object.entries(series);
  return entries[entries.length - 1];
}

/** The margin the /nvc page puts on each side of an NVC wait: a week, or
 * 40% of the wait, whichever is longer */
function nvcMargin(days: number): number {
  return Math.max(7, Math.round(0.4 * days));
}

/** NVC's reading is weekly; older than this and it may be far off */
const NVC_MAX_AGE_DAYS = 14;

/** How long USCIS can take to send an approved petition on to NVC, which
 * no published timeframe covers: counted as up to a month */
const TRANSFER_DAYS = 30;

function nvcCreationStage(
  spec: StageSpec,
  start: DateRange | null,
  status: StageStatus,
  { data, today, inputs }: Context,
): StageResult {
  const base = {
    spec,
    status,
    start,
    end: null,
    outer: null,
    days: null,
    outerDays: null,
    basis: [] as string[],
    warning: null,
    needs: null,
  };
  if (data.nvc === null) return { ...base, headline: "No NVC data." };
  const [date, days] = latestReading(data.nvc.creation);
  const margin = nvcMargin(days);
  // from the approval: USCIS still has to send the case; from the day it
  // did (the start milestone), NVC's own days
  const fromSent = inputs.milestone === spec.start?.id && start !== null;
  const duration = {
    low: Math.max(0, days - margin),
    high: days + margin + (fromSent ? 0 : TRANSFER_DAYS),
  };
  const basis = [
    `On ${formatDate(
      date,
    )}, NVC was taking ${days} days to create cases after USCIS sent them, by its own timeframes, which it updates weekly.`,
  ];
  if (!fromSent)
    basis.push(
      "USCIS usually takes a few weeks after the approval to send the case on, which no published timeframe covers, so this counts up to a month for it.",
    );
  let warning: string | null = null;
  if (today !== null && daysBetween(date, today) > NVC_MAX_AGE_DAYS)
    warning = `Our newest NVC reading is from ${formatDate(
      date,
    )}, so it may be out of date.`;
  const stall = getStall(data.nvc.creation);
  if (stall !== null)
    warning = `NVC’s case creation has almost stopped moving, so this may take longer than ${days} days.`;
  if (start === null)
    return {
      ...base,
      days: duration,
      basis,
      warning,
      headline: `Most likely ${formatDuration(duration)} ${afterText(spec)}`,
    };
  let end = shift(start, duration);
  let headline = dateHeadline(end, status, today);
  if (status === "current" && today !== null) {
    if (today > end.high) {
      headline = "This is taking longer than usual";
      warning = `On ${formatDate(
        date,
      )}, NVC was taking ${days} days to create cases, and yours has waited ${daysBetween(
        start.low,
        today,
      )} days. Check your USCIS case status, and ask NVC if it says the case was sent.`;
      end = { low: today, high: today };
    } else end = fromToday(end, today);
  }
  return { ...base, end, days: duration, basis, warning, headline };
}

function yourStepStage(
  spec: StageSpec,
  start: DateRange | null,
  status: StageStatus,
): StageResult {
  return {
    spec,
    status,
    start,
    end: start,
    outer: null,
    days: { low: 0, high: 0 },
    outerDays: null,
    headline: "As soon as you submit them",
    basis: [],
    warning: null,
    needs: null,
  };
}

/** A submission date far enough in the future that NVC's pace, measured
 * over four weeks, says nothing about it: the queue's length as it is now
 * is the estimate then. */
const NVC_PACE_HORIZON_DAYS = 60;

function nvcReviewStage(
  spec: StageSpec,
  start: DateRange | null,
  status: StageStatus,
  { data, today }: Context,
): StageResult {
  const base = {
    spec,
    status,
    start,
    end: null,
    outer: null,
    days: null,
    outerDays: null,
    basis: [] as string[],
    warning: null,
    needs: null,
  };
  if (data.nvc === null) return { ...base, headline: "No NVC data." };
  const series = data.nvc.review;
  const latest = latestReading(series);
  const [date, days] = latest;
  const reached = front(latest);
  const margin = nvcMargin(days);
  const duration = { low: Math.max(0, days - margin), high: days + margin };
  const basis = [
    `On ${formatDate(
      date,
    )}, NVC was reviewing documents submitted on ${formatDate(
      reached,
    )}: a ${days}-day queue, by its own timeframes.`,
    "If NVC asks you to correct a document, your case goes back in line when you submit it again.",
  ];
  let warning: string | null = null;
  const stale = today !== null && daysBetween(date, today) > NVC_MAX_AGE_DAYS;
  if (stale)
    warning = `Our newest NVC reading is from ${formatDate(
      date,
    )}, so it may be out of date.`;
  const stall = getStall(series);
  if (stall !== null)
    warning = `NVC’s document review has almost stopped moving: anything submitted now may take longer than ${days} days.`;
  if (start === null)
    return {
      ...base,
      days: duration,
      basis,
      warning,
      headline: `Most likely ${formatDuration(duration)} ${afterText(spec)}`,
    };
  // the visitor's own submission date: the /nvc page's range, which reads
  // NVC's pace too, unless the readings are stale or NVC has stalled
  if (
    status === "current" &&
    today !== null &&
    !stale &&
    stall === null &&
    start.low === start.high
  ) {
    const submitted = start.low;
    if (submitted <= reached)
      return {
        ...base,
        end: { low: date, high: date },
        days: { low: 0, high: 0 },
        basis,
        headline: "Most likely reviewed already",
        warning: `On ${formatDate(
          date,
        )}, NVC was already reviewing documents submitted on ${formatDate(
          reached,
        )}, so it has most likely reviewed yours. Check CEAC for its message.`,
      };
    const range = reviewRange(series, submitted);
    if (range !== null) {
      const end = { low: range.lower, high: range.upper };
      const paceBasis: string[] = [
        `If NVC’s queue stays as long as it is now, it would reach documents submitted on ${formatDate(
          submitted,
        )} around ${formatDate(range.queueDate)}.`,
      ];
      if (range.pace !== null)
        paceBasis.push(
          `From ${formatDate(range.pace.from[0])} to ${formatDate(
            date,
          )}, NVC’s queue ${
            range.pace.date > range.queueDate ? "grew" : "shrank"
          }: at that pace it would reach them around ${formatDate(
            range.pace.date,
          )}.`,
        );
      if (range.burstDays !== null)
        paceBasis.push(
          `Lately NVC has moved in bursts and pauses, so the range also goes up to its longest review time of the last six weeks: ${range.burstDays} days.`,
        );
      paceBasis.push(
        "We tested this method on NVC’s timeframes since November 2020: more than 9 reviews in 10 fell inside the range.",
      );
      return {
        ...base,
        end,
        days: {
          low: daysBetween(submitted, range.lower),
          high: daysBetween(submitted, range.upper),
        },
        basis: [...basis, ...paceBasis],
        warning,
        headline:
          today > range.upper
            ? "Most likely reviewed already"
            : today >= range.lower
            ? `Most likely by ${formatShortDate(range.upper)}`
            : `Most likely ${formatDateRange(end)}`,
      };
    }
  }
  let end = shift(start, duration);
  if (today !== null && daysBetween(today, start.low) <= NVC_PACE_HORIZON_DAYS)
    basis.push(
      "This takes the queue as long as it is now; the queue grows and shrinks from week to week.",
    );
  let headline = dateHeadline(end, status, today);
  if (status === "current" && today !== null) {
    if (today > end.high) {
      headline = "Past NVC’s usual review time";
      warning ??= `By NVC’s review time of ${days} days, documents submitted ${formatDateRange(
        start,
      )} have most likely been reviewed. Check CEAC for its message.`;
      end = { low: today, high: today };
    } else end = fromToday(end, today);
  }
  return { ...base, end, days: duration, basis, warning, headline };
}

/** How far back the interview estimate measures the pace of a post's
 * month: State's oldest update within this many days of the newest, at
 * least MIN_PACE_DAYS before it */
const PACE_MAX_DAYS = 400;
const MIN_PACE_DAYS = 90;
/** The pace projection stops this many months past the queue-as-now
 * estimate: beyond that it is a guess about a different year. */
const PACE_CAP_MONTHS = 36;

export interface QueuePace {
  /** The update the pace is measured from: its date and month */
  from: [asOf: string, month: string];
  /** Months the post's month moved forward (negative: back) */
  moved: number;
  /** Months between the two updates */
  over: number;
}

/** How a post's month moved over about the last year of State's updates, or
 * null when there is no update that far back with a month */
export function queuePace(post: PostQueue): QueuePace | null {
  const [asOf, month] = post.history[post.history.length - 1];
  if (month === null) return null;
  const base = post.history.find(
    ([date, baseMonth]) =>
      baseMonth !== null &&
      daysBetween(date, asOf) <= PACE_MAX_DAYS &&
      daysBetween(date, asOf) >= MIN_PACE_DAYS,
  );
  if (base === undefined || base[1] === null) return null;
  return {
    from: [base[0], base[1]],
    moved: monthsBehind(month, base[1]),
    over: monthsBehind(asOf, base[0]),
  };
}

/** The month the interview estimate reads a date's case as documentarily
 * complete in: its month */
function monthOf(date: string): string {
  return date.slice(0, 7);
}

/** When NVC would reach cases documentarily complete on `dq` at a post, by
 * two readings of State's tool (see interviewEstimate): the queue as it is
 * now, and the pace of the last year */
function interviewDates(
  dq: string,
  asOf: string,
  month: string,
  pace: QueuePace | null,
): { queue: string; pace: string | null; capped: boolean } {
  const lag = monthsBehind(asOf, month);
  const queue = addMonths(dq, lag);
  if (pace === null || pace.moved <= 0 || pace.over <= 0)
    return { queue, pace: null, capped: false };
  const perMonth = pace.moved / pace.over;
  // the month reaches the case's when month + perMonth * t = monthOf(dq):
  // t months, a fraction of a month included, counted in days
  const behind = monthsBehind(monthOf(dq), month);
  const projected = addDays(asOf, Math.round((behind / perMonth) * MONTH_DAYS));
  const cap = addMonths(queue, PACE_CAP_MONTHS);
  return {
    queue,
    pace: projected > cap ? cap : projected,
    capped: projected > cap,
  };
}

function interviewStage(
  spec: StageSpec,
  start: DateRange | null,
  status: StageStatus,
  { data, inputs, today }: Context,
): StageResult {
  const base = {
    spec,
    status,
    start,
    end: null,
    outer: null,
    days: null,
    outerDays: null,
    basis: [] as string[],
    warning: null,
    needs: null,
  };
  const post = data.posts?.find(({ slug }) => slug === inputs.post);
  if (post === undefined || data.ivAsOf === null)
    return {
      ...base,
      needs: "consulate",
      headline: "Choose your consulate above to see its queue",
    };
  const [asOf, month] = post.history[post.history.length - 1];
  const override: PolicyEntry | null = scheduleOverrideFor(
    post.slug,
    asOf,
    today,
  );
  if (override !== null)
    return {
      ...base,
      headline: "No estimate while visa services are disrupted",
      warning: `${override.title}: ${override.summary} See ${post.name}’s page.`,
    };
  if (month === null)
    return {
      ...base,
      headline: "No month given",
      basis: [
        `The State Department’s tool lists ${post.name} but gives no month for these cases (N/A). It may not be handling immigrant visas; check the embassy’s own website.`,
      ],
    };
  const lag = monthsBehind(asOf, month);
  const pace = queuePace(post);
  const basis: string[] = [];
  const update = formatShortDate(asOf);
  if (lag <= 0) {
    basis.push(
      `In the State Department’s update of ${update}, ${post.name} was listed as current for spouses, children and parents of US citizens: NVC can schedule an interview as soon as a case is documentarily complete. “Current” can also mean the post is not scheduling these cases at all; check the embassy’s own website.`,
    );
    return {
      ...base,
      end: start,
      days: { low: 0, high: 0 },
      basis,
      headline:
        start === null
          ? "As soon as your case is complete: this consulate is listed as current"
          : `Scheduled soon after ${formatDateRange(start)}: listed as current`,
    };
  }
  basis.push(
    `In the State Department’s update of ${update}, NVC was scheduling most interviews at ${
      post.name
    } for cases that became documentarily complete in ${formatIvMonth(
      month,
    )}: ${lag} months before the update.`,
  );
  if (pace !== null) {
    const from = formatIvMonth(pace.from[1]);
    basis.push(
      pace.moved > 0
        ? `In the update of ${formatShortDate(
            pace.from[0],
          )}, it was ${from}: the month moved forward ${pace.moved} months in ${
            pace.over
          } months, so the queue is ${
            pace.moved < pace.over ? "growing" : "shrinking"
          }.`
        : pace.moved === 0
        ? `It was the same month in the update of ${formatShortDate(
            pace.from[0],
          )}, so the queue has not moved forward in ${pace.over} months.`
        : `In the update of ${formatShortDate(
            pace.from[0],
          )}, it was ${from}, so the month has moved back.`,
    );
  }
  basis.push(
    "The State Department says it cannot predict exactly when a case will be scheduled; its month is the one most interviews are being scheduled for, and it can move backwards.",
  );
  if (start === null) {
    const days = { low: monthsToDays(lag), high: monthsToDays(lag) };
    return {
      ...base,
      days,
      basis,
      headline: `About ${lag} months after your case is complete, if the queue stays as it is`,
    };
  }
  const low = interviewDates(start.low, asOf, month, pace);
  const high = interviewDates(start.high, asOf, month, pace);
  const dates = [low.queue, high.queue, low.pace, high.pace].filter(
    (date): date is string => date !== null,
  );
  dates.sort();
  let end = { low: dates[0], high: dates[dates.length - 1] };
  if (status === "current" && start.low === start.high) {
    const behind = monthsBehind(monthOf(start.low), month);
    if (behind <= 0)
      return {
        ...base,
        end: { low: asOf, high: asOf },
        days: { low: 0, high: 0 },
        basis,
        headline: "NVC may be scheduling your case now",
        warning: `Your case became documentarily complete in ${formatIvMonth(
          monthOf(start.low),
        )}, which NVC was already scheduling in the update of ${update}. Watch for NVC’s email.`,
      };
    basis.unshift(
      `Your case became documentarily complete in ${formatIvMonth(
        monthOf(start.low),
      )}, ${behind} months after the month NVC was scheduling.`,
    );
  }
  basis.push(
    `If the queue stays as long as it is now, NVC would reach a case completed ${formatDateRange(
      start,
    )} around ${
      low.queue === high.queue
        ? formatShortDate(low.queue)
        : formatDateRange({ low: low.queue, high: high.queue })
    }.${
      low.pace !== null && high.pace !== null
        ? ` At the pace of the last year, around ${
            low.pace === high.pace
              ? formatShortDate(low.pace)
              : formatDateRange({ low: low.pace, high: high.pace })
          }${high.capped ? ", or later" : ""}.`
        : pace !== null && pace.moved <= 0
        ? " The month has not moved forward in the last year, so it could take much longer."
        : ""
    }`,
  );
  const days = {
    low: Math.max(0, daysBetween(start.low, end.low)),
    high: Math.max(0, daysBetween(start.high, end.high)),
  };
  let headline = `${dateHeadline(end, status, today)}${
    low.capped || high.capped ? " or later" : ""
  }`;
  let warning =
    pace !== null && pace.moved <= 0
      ? "The month this consulate is scheduling has not moved forward in the last year. The estimate takes the queue as it is now; it could take much longer."
      : null;
  if (status === "current" && today !== null) {
    if (today > end.high) {
      headline = "NVC should be reaching your case about now";
      warning = `By this consulate’s queue, NVC would have reached a case completed ${formatDateRange(
        start,
      )} by ${formatShortDate(end.high)}. Watch for NVC’s email, and check ${
        post.name
      }’s page for disruptions.`;
      end = { low: today, high: today };
    } else end = fromToday(end, today);
  }
  return { ...base, end, days, basis, headline, warning };
}

/** "moved forward 4 months", "did not move", "moved back 3 months" */
function movedText(months: number): string {
  if (months === 0) return "did not move";
  return `moved ${months > 0 ? "forward" : "back"} ${formatWholeMonths(
    months,
  )}`;
}

function priorityDateStage(
  spec: Extract<StageSpec, { kind: "priority-date" }>,
  start: DateRange | null,
  status: StageStatus,
  { data, inputs }: Context,
  priorityDate: string | null,
): StageResult {
  const base = {
    spec,
    status,
    start,
    end: null,
    outer: null,
    days: null,
    outerDays: null,
    basis: [] as string[],
    warning: null,
    needs: null,
  };
  const bulletin = data.bulletin;
  const cell = bulletin?.cells[inputs.category]?.[inputs.area];
  if (bulletin === null || cell === undefined)
    return {
      ...base,
      needs: "bulletin",
      headline: "Choose your category and country of birth above",
    };
  const month = formatBulletinMonth(bulletin.month);
  const basis: string[] = [];
  let headline: string;
  if (cell.final === "C") {
    headline = `Current in the ${month} Visa Bulletin: there is no line`;
    basis.push(
      "You can get your visa or green card whatever your priority date is, as long as the category stays current.",
    );
  } else if (cell.final === "U") {
    headline = `Unavailable in the ${month} Visa Bulletin`;
    basis.push(
      "No visas are left in this category this month, whatever your priority date is. The line usually opens again in October, when the US government’s year starts.",
    );
  } else {
    headline = `Final Action Date ${formatCutoff(
      cell.final,
    )} in the ${month} Visa Bulletin`;
    basis.push(
      `You can get your visa or green card once your priority date is earlier than this date. Dates for Filing: ${formatCutoff(
        cell.filing,
      )}; with that chart, you can send your documents to NVC, and in the US, USCIS says each month which chart decides when you can file the I-485.`,
    );
  }
  if (priorityDate !== null && isDate(cell.final)) {
    const behind = monthsBetweenDates(cell.final, priorityDate);
    if (priorityDate < cell.final)
      headline = `Your priority date is current: ${formatShortDate(
        priorityDate,
      )} is before the cutoff, ${formatCutoff(cell.final)}`;
    else
      basis.unshift(
        `Your priority date, ${formatShortDate(
          priorityDate,
        )}, is ${formatWholeMonths(
          Math.max(behind, 1),
        )} after the cutoff: the cutoff has to move that far to reach it.`,
      );
  } else if (priorityDate !== null && cell.final === "C")
    headline = `Your priority date is current: the category has no line`;
  if (cell.year !== null && cell.year.months !== null)
    basis.push(
      `In the last 12 months, the Final Action Date ${movedText(
        cell.year.months,
      )}.`,
    );
  if (cell.fiveYears !== null && cell.fiveYears.months !== null) {
    const perYear = Math.round(cell.fiveYears.months / 5);
    basis.push(
      `In the last 5 years, it ${movedText(cell.fiveYears.months)}${
        cell.fiveYears.months > 0 && perYear > 0
          ? `, about ${formatWholeMonths(perYear)} each year`
          : ""
      }.`,
    );
  }
  basis.push(
    "The line does not move at a steady pace: it can stand still for months, jump forward, or move back, often in the summer. So past movement cannot say when your date will come, and this page does not guess.",
  );
  return { ...base, basis, headline };
}

function noteStage(
  spec: StageSpec,
  start: DateRange | null,
  status: StageStatus,
): StageResult {
  return {
    spec,
    status,
    start,
    end: null,
    outer: null,
    days: null,
    outerDays: null,
    headline: "",
    basis: [],
    warning: null,
    needs: null,
  };
}

/** The steps of a path with their estimates, from where the visitor says
 * their case is (or from today, or undated while today is unknown) */
export function estimateTimeline(
  path: PathSpec,
  data: TimelineData,
  inputs: TimelineInputs,
  today: string | null,
): TimelineResult {
  const context = { data, inputs, today };
  const date = validDate(inputs.date, today);
  // which stage the milestone belongs to, and whether it starts or ends it
  const main = path.stages.filter(
    (stage) => stage.parallelTo === undefined && stage.detached !== true,
  );
  let reported: { index: number; at: "start" | "end" } | null = null;
  if (date !== null && inputs.milestone !== "")
    main.forEach((stage, index) => {
      if (stage.start?.id === inputs.milestone)
        reported = { index, at: "start" };
      if (stage.end?.id === inputs.milestone) reported = { index, at: "end" };
    });
  // the priority date: the one given, else the day the I-130 was filed
  const priorityDate =
    validDate(inputs.priorityDate, today) ??
    (date !== null && inputs.milestone === I130_FILED.id ? date : null);

  const results = new Map<string, StageResult>();
  let previousEnd: DateRange | null =
    today === null ? null : { low: today, high: today };
  main.forEach((stage, index) => {
    let status: StageStatus = "ahead";
    let start: DateRange | null = previousEnd;
    if (reported !== null && date !== null) {
      const { index: reportedIndex, at } = reported as {
        index: number;
        at: "start" | "end";
      };
      const onDate = { low: date, high: date };
      if (index < reportedIndex || (index === reportedIndex && at === "end"))
        status = "done";
      else if (index === reportedIndex) {
        status = "current";
        start = onDate;
      } else if (index === reportedIndex + 1 && at === "end") {
        // the step after one that ended on the date has been under way
        // since then, unless the visitor files it (a USCIS form), which
        // they would have said: that one starts today at the earliest
        if (stage.kind === "uscis") {
          const from = today !== null && today > date ? today : date;
          start = { low: from, high: from };
        } else {
          status = "current";
          start = onDate;
        }
      }
    }
    const estimate = estimateStage(stage, start, status, context, priorityDate);
    // a step under way cannot have ended before today
    const result =
      status === "current" && today !== null && estimate.end !== null
        ? { ...estimate, end: fromToday(estimate.end, today) }
        : estimate;
    results.set(stage.id, result);
    previousEnd = status === "done" ? null : result.end;
  });
  for (const stage of path.stages) {
    if (stage.parallelTo !== undefined) {
      const sibling = results.get(stage.parallelTo);
      const result = estimateStage(
        stage,
        sibling?.start ?? null,
        sibling?.status ?? "ahead",
        context,
        priorityDate,
      );
      results.set(stage.id, result);
    } else if (stage.detached === true)
      results.set(
        stage.id,
        estimateStage(stage, null, "ahead", context, priorityDate),
      );
  }
  const stages = path.stages.map(
    (stage) => results.get(stage.id) as StageResult,
  );

  // the total: the main-line steps up to the last one that can be timed
  let total: TimelineResult["total"] = null;
  let days: Days = { low: 0, high: 0 };
  for (const stage of main) {
    const result = results.get(stage.id) as StageResult;
    if (result.status === "done") continue;
    if (result.days === null) break;
    days = {
      low: days.low + result.days.low,
      high: days.high + result.days.high,
    };
    if (result.spec.kind !== "your-step")
      total = { stage: result, days, end: result.end };
  }
  return { stages, total };
}

function estimateStage(
  stage: StageSpec,
  start: DateRange | null,
  status: StageStatus,
  context: Context,
  priorityDate: string | null,
): StageResult {
  switch (stage.kind) {
    case "uscis":
      return uscisStage(stage, start, status, context);
    case "nvc-creation":
      return nvcCreationStage(stage, start, status, context);
    case "your-step":
      return yourStepStage(stage, start, status);
    case "nvc-review":
      return nvcReviewStage(stage, start, status, context);
    case "interview":
      return interviewStage(stage, start, status, context);
    case "priority-date":
      return priorityDateStage(stage, start, status, context, priorityDate);
    case "note":
      return noteStage(stage, start, status);
  }
}

/** The one line the home page shows for a path: what its first dated step
 * takes right now, from the same data */
export function pathSummary(path: PathSpec, data: TimelineData): string {
  const { stages } = estimateTimeline(path, data, EMPTY_INPUTS, null);
  const parts: string[] = [];
  for (const { spec, days } of stages) {
    if (spec.parallelTo !== undefined || spec.detached === true) continue;
    let part: string | null = null;
    if (spec.kind === "uscis" && days !== null)
      part = `${spec.form}: most likely ${formatDuration(days)}`;
    else if (spec.kind === "nvc-review" && days !== null)
      part = `NVC: ${formatDuration(days)}`;
    else if (spec.kind === "interview")
      part = "the interview queue at your consulate";
    else if (spec.kind === "priority-date")
      part =
        spec.categories === "family"
          ? "your priority date, often years"
          : "your priority date";
    if (part !== null) parts.push(part);
    if (parts.length === 3) break;
  }
  const line =
    parts.length > 1
      ? `${parts.slice(0, -1).join(", ")}, then ${parts[parts.length - 1]}`
      : parts.join("");
  return `${line.charAt(0).toUpperCase()}${line.slice(1)}.`;
}
