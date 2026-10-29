/** The eight checks every provider must pass. Order matches the database enum. */
export const CHECK_TYPES = ["nin", "face_match", "bank_match", "guarantor", "address", "credential", "reference", "background"] as const;
export type CheckType = (typeof CHECK_TYPES)[number];

export const CHECK_LABELS: Record<CheckType, { title: string; badge: string; reviewerGuide: string }> = {
  nin: { title: "Identity number", badge: "ID verified",
    reviewerGuide: "The last four digits of the NIN must match the ID photo. The name on the ID must match the applicant's name." },
  face_match: { title: "Face match", badge: "Face matched to ID",
    reviewerGuide: "Compare the selfie with the photo on the ID. It must clearly be the same person." },
  bank_match: { title: "Bank account name", badge: "Bank name matches ID",
    reviewerGuide: "The bank account name must match the name on the ID, allowing for order and initials." },
  guarantor: { title: "Guarantor", badge: "Guarantor confirmed",
    reviewerGuide: "Call the guarantor. Confirm they know the applicant, for how long, and that they will vouch for them." },
  address: { title: "Home address", badge: "Address checked",
    reviewerGuide: "The document must be under three months old and show the applicant's name, or be a letter from a community or estate head." },
  credential: { title: "Work credentials", badge: "Credentials reviewed",
    reviewerGuide: "Review the certificates, kitchen photos or installation evidence against the services applied for." },
  reference: { title: "Past customers", badge: "References called",
    reviewerGuide: "Call both references. Ask about quality of work, punctuality and conduct in the home." },
  background: { title: "Background screening", badge: "Background clear",
    reviewerGuide: "Record the screening result. Fail the check for any safety concern, fraud history or false statements." },
};

export const ID_TYPES = [
  { value: "nin_slip", label: "NIN slip" },
  { value: "national_id", label: "National ID card" },
  { value: "drivers_licence", label: "Driver's licence" },
  { value: "voters_card", label: "Permanent voter's card" },
  { value: "passport", label: "International passport" },
] as const;

export const ADDRESS_DOC_TYPES = [
  "Utility bill (electricity, water or waste)", "Tenancy agreement", "Bank statement showing your address",
  "Letter from your estate or community head",
] as const;

/** What each service must show as proof of competence. Shown in the registration wizard and to reviewers. */
export const CREDENTIAL_REQUIREMENTS: Record<string, { items: string[]; note: string }> = {
  plumber: {
    items: ["Trade or apprenticeship certificate, if you have one", "A clear photo of your tools and, if you have one, your work van"],
    note: "Upload at least one document. Your three work photos in the next step are reviewed alongside it.",
  },
  caterer: {
    items: ["Food handler's medical fitness certificate", "Local government or state health permit, where required",
      "NAFDAC number if you sell packaged food", "Photos of your kitchen and equipment"],
    note: "Upload at least one document. A reviewer may ask for a kitchen visit before approval.",
  },
  "solar-installer": {
    items: ["CAC registration if you operate as a company", "Brand or manufacturer training certificates",
      "Electrical competence evidence: trade test, engineering registration or an employer's letter",
      "Photos and addresses of past installations", "The warranty terms you give customers"],
    note: "Solar systems carry fire and electrical risk. Reviewers look closely at competence and past installations.",
  },
};
