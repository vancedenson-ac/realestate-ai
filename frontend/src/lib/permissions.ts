/**
 * Frontend RBAC/ABAC: which roles can see or perform which actions.
 * UX only — backend (RLS + API) is the authority. These gates avoid showing
 * actions that would be rejected (403/404) and reduce confusion.
 * Aligned with 06-authorization-and-data-access.md and 18-authorization-audit.
 */

import type { UserRole } from "@/types/api";
import type { TransactionState } from "@/types/api";

/** Roles that list and manage properties (create, edit, upload images). */
const LISTING_SIDE_ROLES: UserRole[] = ["SELLER_AGENT", "SELLER", "ADMIN"];

/** Roles that can create/update listings and schedule showings / add showing feedback. */
const LISTING_AGENT_OR_BROKER_ROLES: UserRole[] = ["SELLER_AGENT", "SELLER", "ADMIN"];

/** Roles that can create transactions (PRE_LISTING). */
const CAN_CREATE_TRANSACTION_ROLES: UserRole[] = ["SELLER_AGENT", "SELLER", "ADMIN"];

/** Roles that can create an offer transaction (LISTED + listing_id) and submit offers. */
const BUYER_SIDE_OFFER_ROLES: UserRole[] = ["BUYER", "BUYER_AGENT"];

/** Roles that can accept, reject, or counter offers (seller side). */
const SELLER_SIDE_OFFER_ROLES: UserRole[] = ["SELLER", "SELLER_AGENT"];

/** Listings status filter: RLS allows BUYER/BUYER_AGENT only is_public and status != DRAFT. */
export function canSeeDraftListings(role: UserRole): boolean {
  return !BUYER_SIDE_OFFER_ROLES.includes(role);
}

export function canCreateProperty(role: UserRole): boolean {
  return LISTING_SIDE_ROLES.includes(role);
}

export function canUpdateProperty(role: UserRole): boolean {
  return LISTING_SIDE_ROLES.includes(role);
}

/** Upload property images / set cover — listing-side only (not BUYER). */
export function canUploadPropertyImage(role: UserRole): boolean {
  return LISTING_SIDE_ROLES.includes(role);
}

export function canCreateListing(role: UserRole): boolean {
  return LISTING_AGENT_OR_BROKER_ROLES.includes(role);
}

export function canUpdateListing(role: UserRole): boolean {
  return LISTING_AGENT_OR_BROKER_ROLES.includes(role);
}

/** Schedule a showing (backend: listing_agent or listing_broker). */
export function canScheduleShowing(role: UserRole): boolean {
  return LISTING_AGENT_OR_BROKER_ROLES.includes(role);
}

/** Add showing feedback (backend: only listing agent or broker; 403 for others). */
export function canAddShowingFeedback(role: UserRole): boolean {
  return LISTING_AGENT_OR_BROKER_ROLES.includes(role);
}

export function canCreateTransaction(role: UserRole): boolean {
  return CAN_CREATE_TRANSACTION_ROLES.includes(role);
}

/** Make offer from listing: create transaction LISTED + listing_id (BUYER/BUYER_AGENT only). */
export function canMakeOffer(role: UserRole): boolean {
  return BUYER_SIDE_OFFER_ROLES.includes(role);
}

/** Submit offer on a LISTED transaction (BUYER/BUYER_AGENT). */
export function canSubmitOffer(role: UserRole): boolean {
  return BUYER_SIDE_OFFER_ROLES.includes(role);
}

/** Counter or withdraw own offer (BUYER/BUYER_AGENT). */
export function canCounterOrWithdrawOffer(role: UserRole): boolean {
  return BUYER_SIDE_OFFER_ROLES.includes(role);
}

/** Reject or accept offers (SELLER/SELLER_AGENT). */
export function canRejectOrAcceptOffer(role: UserRole): boolean {
  return SELLER_SIDE_OFFER_ROLES.includes(role);
}

/** Order appraisal (backend: LENDER or ESCROW_OFFICER only). */
export function canOrderAppraisal(role: UserRole): boolean {
  return role === "LENDER" || role === "ESCROW_OFFICER";
}

/** Waive appraisal for DUE_DILIGENCE → FINANCING (backend: any party in org; transition allowed_roles: BUYER_AGENT). */
export function canWaiveAppraisal(role: UserRole): boolean {
  return role === "BUYER_AGENT";
}

/**
 * In-app document signing (backend: transaction party only via RLS; signer_id must be current user).
 * Roles that can be transaction parties and thus may sign when they are a party.
 * UX only — backend RLS enforces: only party can insert signature with signer_id = self.
 */
const SIGNER_CAPABLE_ROLES: UserRole[] = [
  "BUYER",
  "SELLER",
  "BUYER_AGENT",
  "SELLER_AGENT",
  "ESCROW_OFFICER",
  "LENDER",
  "ADMIN",
];

export function canSignDocument(role: UserRole): boolean {
  return SIGNER_CAPABLE_ROLES.includes(role);
}

// ---------------------------------------------------------------------------
// Document upload by type (mirrors backend document_insert_policy)
// ---------------------------------------------------------------------------

/** Document types that are only allowed in specific (state, role) combos. Mirrors backend document_insert_policy. */
const UPLOAD_RULES: {
  documentType: string;
  state: TransactionState;
  roles: UserRole[];
}[] = [
  { documentType: "offer", state: "LISTED", roles: ["BUYER", "BUYER_AGENT"] },
  { documentType: "purchase_agreement", state: "OFFER_MADE", roles: ["SELLER", "SELLER_AGENT"] },
  { documentType: "escrow_instructions", state: "UNDER_CONTRACT", roles: ["ESCROW_OFFICER"] },
  { documentType: "loan_commitment", state: "FINANCING", roles: ["LENDER"] },
  { documentType: "funding_confirmation", state: "CLEAR_TO_CLOSE", roles: ["ESCROW_OFFICER"] },
  /** Appraisal report: only LENDER, ESCROW_OFFICER, APPRAISER (who order/receive appraisal). */
  { documentType: "appraisal_report", state: "DUE_DILIGENCE", roles: ["LENDER", "ESCROW_OFFICER", "APPRAISER"] },
  { documentType: "appraisal_report", state: "FINANCING", roles: ["LENDER", "ESCROW_OFFICER", "APPRAISER"] },
  { documentType: "appraisal_report", state: "CLEAR_TO_CLOSE", roles: ["LENDER", "ESCROW_OFFICER", "APPRAISER"] },
];

/** Document types any transaction party can upload (no state/role gate). Excludes appraisal_report (gated above). */
const PARTY_UPLOADABLE_TYPES = [
  "listing_agreement",
  "deed",
  "pre_qualification_letter",
  "other",
];

/**
 * Whether the current role can upload a document of this type in this transaction state.
 * Mirrors backend document_insert_policy (RLS); UX only.
 */
export function canUploadDocumentType(
  role: UserRole,
  documentType: string,
  transactionState: TransactionState
): boolean {
  const type = (documentType || "").toLowerCase();
  if (type === "inspection_report" && role === "LENDER") return false;
  if (PARTY_UPLOADABLE_TYPES.includes(type)) return true;
  const rules = UPLOAD_RULES.filter((r) => r.documentType === type);
  if (rules.length === 0) return true;
  return rules.some((r) => r.state === transactionState && r.roles.includes(role));
}

/**
 * List of document type values the current role can upload in this transaction state.
 * Use to filter upload dropdowns; backend RLS remains authority.
 */
export function getAllowedDocumentTypesForUpload(
  role: UserRole,
  transactionState: TransactionState
): string[] {
  const all = [
    ...PARTY_UPLOADABLE_TYPES,
    "offer",
    "purchase_agreement",
    "escrow_instructions",
    "inspection_report",
    "appraisal_report",
    "loan_commitment",
    "funding_confirmation",
  ];
  return all.filter((t) => canUploadDocumentType(role, t, transactionState));
}

// ---------------------------------------------------------------------------
// New transaction form (listing-side only: SELLER_AGENT, SELLER, ADMIN)
// ---------------------------------------------------------------------------

/** Initial states allowed when creating a transaction (listing-side flow). */
const NEW_TX_INITIAL_STATES: TransactionState[] = ["PRE_LISTING", "LISTED"];

/** Party roles the current user may choose as first party on New Transaction. UX only; backend validates. */
export function getAllowedPartyRolesForNewTransaction(role: UserRole): UserRole[] {
  switch (role) {
    case "SELLER_AGENT":
      return ["SELLER_AGENT", "SELLER"];
    case "SELLER":
      return ["SELLER"];
    case "ADMIN":
      return ["SELLER_AGENT", "SELLER"];
    default:
      return [];
  }
}

/** Initial states shown in New Transaction dropdown (listing-side). */
export function getAllowedInitialStatesForNewTransaction(): TransactionState[] {
  return NEW_TX_INITIAL_STATES;
}
