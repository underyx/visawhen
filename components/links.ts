// Official pages that several pages link to. The IV Scheduling Status Tool's
// address is not here: it comes with its data, in iv_schedule.json's "source".

/** The State Department's monthly Visa Bulletin, whose charts say whose
 * priority date is current in the family and employment preference
 * categories */
export const VISA_BULLETIN_URL =
  "https://travel.state.gov/content/travel/en/legal/visa-law0/visa-bulletin.html";

/** NVC's own page of its current timeframes */
export const NVC_TIMEFRAMES_URL =
  "https://travel.state.gov/content/travel/en/us-visas/immigrate/nvc-timeframes.html";

/** USCIS's page of the quarterly reports the USCIS pages are built from */
export const USCIS_DATA_URL =
  "https://www.uscis.gov/tools/reports-and-studies/immigration-and-citizenship-data";

/** USCIS's own processing times tool, per form and office */
export const USCIS_PROCESSING_TIMES_URL =
  "https://egov.uscis.gov/processing-times/";

/** The Department of Labor's processing times for prevailing wage
 * determinations and PERM labor certifications, which this site does not
 * cover */
export const DOL_PROCESSING_TIMES_URL = "https://flag.dol.gov/processingtimes";

/** State's appointment wait times for visitor, student and other
 * nonimmigrant visas, which this site does not cover */
export const GLOBAL_VISA_WAIT_TIMES_URL =
  "https://travel.state.gov/content/travel/en/us-visas/visa-information-resources/global-visa-wait-times.html";

/** The list of U.S. embassies' and consulates' own websites */
export const EMBASSIES_URL = "https://www.usembassy.gov/";

/** State's List of U.S. Embassies and Consulates that Process Immigrant
 * Visas */
export const IV_POSTS_URL =
  "https://travel.state.gov/content/travel/en/us-visas/visa-information-resources/list-of-posts.html";

/** State's notice of July 15, 2026, Realignment of U.S. Visa Services in
 * Africa to Regional Hubs */
export const AFRICA_HUBS_URL =
  "https://travel.state.gov/content/travel/en/News/visas-news/realignment-of-us-visa-services-in-africa-to-regional-hubs.html";

/** State's listings of the monthly issuance reports the consulate pages count
 * visas from, for immigrant and nonimmigrant visas */
export const ISSUANCE_STATISTICS_URLS = {
  IV: "https://travel.state.gov/content/travel/en/legal/visa-law0/visa-statistics/immigrant-visa-statistics/monthly-immigrant-visa-issuances.html",
  NIV: "https://travel.state.gov/content/travel/en/legal/visa-law0/visa-statistics/nonimmigrant-visa-statistics/monthly-nonimmigrant-visa-issuances.html",
} as const;
