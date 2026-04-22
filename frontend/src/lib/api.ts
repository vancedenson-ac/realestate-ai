/**
 * API client for realtrust-ai backend.
 * Injects RLS headers (X-User-Id, X-Organization-Id, X-Role) for authorization.
 */

import type { SeedUser, ApiError, EligibleEscrowOfficer, ChampagneMomentOverview } from "@/types/api";

/** Build a user-facing message from API error response. Handles FastAPI detail wrapper, detail string, or validation array. */
function getApiErrorMessageFromResponse(err: ApiError, status: number): string {
  if (err.error?.message?.trim()) return err.error.message.trim();
  // FastAPI wraps HTTPException detail in response body as { detail: { error: { message } } }
  const detailObj = err.detail && typeof err.detail === "object" && !Array.isArray(err.detail) ? err.detail as { error?: { message?: string } } : null;
  if (detailObj?.error?.message?.trim()) return detailObj.error.message.trim();
  if (typeof err.detail === "string" && err.detail.trim()) return err.detail.trim();
  if (Array.isArray(err.detail) && err.detail.length > 0) {
    const first = err.detail[0];
    const msg = first?.msg ?? (typeof first === "string" ? first : null);
    if (msg?.trim()) return msg.trim();
  }
  return `Request failed (${status}). Please try again.`;
}

const API_V1_PREFIX = "/realtrust-ai/v1";

function getBaseUrl(): string {
  if (typeof window !== "undefined") {
    return (process.env.NEXT_PUBLIC_API_BASE || "").replace(/\/$/, "") || "";
  }
  return process.env.NEXT_PUBLIC_API_BASE || "http://localhost:8000";
}

export function buildApiUrl(
  path: string,
  params?: Record<string, string | number | boolean | undefined>
): string {
  const base = getBaseUrl() + API_V1_PREFIX + (path.startsWith("/") ? path : `/${path}`);
  if (!params) return base;
  const search = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== "") search.set(k, String(v));
  }
  const q = search.toString();
  return q ? `${base}?${q}` : base;
}

/** Optional: generate a per-request correlation ID for traceability (02 §13.2). Backend echoes or uses it. */
export function generateCorrelationId(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export function getRlsHeaders(user: SeedUser, correlationId?: string): Record<string, string> {
  const headers: Record<string, string> = {
    "X-User-Id": user.user_id,
    "X-Organization-Id": user.organization_id,
    "X-Role": user.role,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
  if (correlationId) headers["X-Correlation-Id"] = correlationId;
  return headers;
}

export class ApiException extends Error {
  status: number;
  code?: string;
  details?: unknown;

  constructor(message: string, status: number, code?: string, details?: unknown) {
    super(message);
    this.name = "ApiException";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

/** Map backend PRECONDITION_FAILED messages to user-friendly copy (05/17 alignment). */
function getPreconditionFailedMessage(serverMessage: string): string | null {
  const m = serverMessage.toLowerCase();
  if (m.includes("required documents missing or unsigned"))
    return "Required documents are missing or not yet signed. Upload and sign the required documents for this step.";
  if (m.includes("cannot enter financing") && m.includes("appraisal"))
    return "Complete the appraisal or waive it before moving to Financing.";
  if (m.includes("cannot enter financing") && m.includes("title not ordered"))
    return "Place a title order before moving to Financing.";
  if (m.includes("cannot enter clear_to_close") || (m.includes("cannot enter") && m.includes("title not cleared")))
    return "Title must be cleared or insurance bound before moving to Clear to Close.";
  if (m.includes("cannot close") && m.includes("funds not confirmed"))
    return "Confirm funding before closing the transaction.";
  if (m.includes("cannot close") && m.includes("disbursement"))
    return "Record the disbursement before closing the transaction.";
  if (m.includes("cannot close") && m.includes("deed not recorded"))
    return "Record the deed before closing the transaction.";
  if (m.includes("cannot close") && m.includes("ownership transfer"))
    return "Confirm ownership transfer before closing the transaction.";
  return null;
}

/** User-friendly message for API errors. Prefers server message when present; uses code fallbacks when message empty. */
export function getApiErrorMessage(error: unknown, fallback = "Something went wrong. Please try again."): string {
  if (error instanceof ApiException) {
    const msg = error.message?.trim();
    switch (error.code) {
      case "PRECONDITION_FAILED": {
        const friendly = msg ? getPreconditionFailedMessage(msg) : null;
        return friendly ?? (msg || "Requirements for this action are not met.");
      }
      case "FORBIDDEN_BY_POLICY":
        return msg || "You don't have permission to perform this action.";
      case "NOT_FOUND":
        return msg || "This item was not found or you don't have access.";
      case "ILLEGAL_TRANSITION":
        return msg || "This state change is not allowed.";
      case "UNAUTHORIZED":
      case "UNAUTHENTICATED":
        return msg || "Please sign in again.";
      case "VALIDATION_ERROR":
        return msg || "Please check your input and try again.";
      default:
        break;
    }
    if (msg) return msg;
    if (error.status === 403) return "You don't have permission to perform this action.";
    if (error.status === 404) return "This item was not found or you don't have access.";
  }
  if (error instanceof Error && error.message?.trim()) {
    return error.message;
  }
  return fallback;
}

export async function apiFetch<T>(
  path: string,
  options: {
    user: SeedUser;
    method?: string;
    body?: unknown;
    params?: Record<string, string | number | boolean | undefined>;
    /** Optional: override per-request correlation ID (02 §13.2). Default: generated. */
    correlationId?: string;
  }
): Promise<T> {
  const url = buildApiUrl(path, options.params);
  const correlationId = options.correlationId ?? generateCorrelationId();
  const headers = getRlsHeaders(options.user, correlationId);

  const res = await fetch(url, {
    method: options.method || "GET",
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });

  if (!res.ok) {
    let err: ApiError = {};
    try {
      err = (await res.json()) as ApiError;
    } catch {
      err = { detail: await res.text() };
    }
    const message = getApiErrorMessageFromResponse(err, res.status);
    const detailError = (err.detail && typeof err.detail === "object" && !Array.isArray(err.detail) && (err.detail as { error?: { code?: string; details?: unknown } }).error) ?? err.error;
    const errorWithCode = typeof detailError === "object" && detailError !== null && "code" in detailError ? detailError : err.error;
    throw new ApiException(
      message,
      res.status,
      errorWithCode?.code ?? undefined,
      errorWithCode?.details ?? undefined
    );
  }

  const contentType = res.headers.get("content-type");
  if (contentType && contentType.includes("application/json")) {
    return res.json() as Promise<T>;
  }
  return undefined as T;
}

// ============================================================================
// API functions by domain
// ============================================================================

import type {
  TransactionOverview,
  TransactionListResponse,
  TransactionCreate,
  TransitionRequest,
  PartyCreate,
  TransactionPartySummary,
  ChecklistItem,
  DocumentChecklistItem,
  TransactionTimeline,
  PropertyOverview,
  PropertyCreate,
  PropertyUpdate,
  PropertySearchRequest,
  PropertySearchResponse,
  PropertyImageOverview,
  PropertyImageUpdate,
  PropertyImageUploadUrlResponse,
  ListingOverview,
  ListingListResponse,
  ListingCreate,
  ListingUpdate,
  InterestedBuyerItem,
  OfferOverview,
  OfferCreate,
  OfferDecisionBody,
  OfferAcceptBody,
  ShowingOverview,
  ShowingCreate,
  ShowingUpdate,
  ShowingFeedbackOverview,
  ShowingFeedbackCreate,
  DocumentOverview,
  DocumentCreate,
  DocumentUploadUrlResponse,
  DocumentVersionOverview,
  DocumentVersionCreate,
  DocumentSignatureOverview,
  DocumentSignatureCreate,
  InspectionOverview,
  InspectionCreate,
  InspectionSubmit,
  AppraisalOverview,
  AppraisalCreate,
  AppraisalSubmit,
  EscrowAssignmentOverview,
  EscrowAssignmentCreate,
  EarnestMoneyOverview,
  EarnestMoneyConfirm,
  FundingConfirmationOverview,
  FundingConfirm,
  DisbursementOverview,
  DisbursementCreate,
  TitleOrderOverview,
  TitleOrderCreate,
  TitleOrderUpdate,
  TitleCommitmentOverview,
  TitleCommitmentCreate,
  DeedRecordingOverview,
  DeedRecordedCreate,
  OwnershipTransferOverview,
  OwnershipTransferCreate,
  AppraisalWaiverOverview,
  AppraisalWaiverCreate,
  ChatRoomOverview,
  ChatRoomCreate,
  ChatRoomUpdate,
  MessageOverview,
  MessageCreate,
  MessageUpdate,
  AddMemberBody,
  PreferenceOverview,
  PreferenceCreate,
  PreferenceUpdate,
  RecommendationsResponse,
  FeedbackBody,
  SavedListingOverview,
  SavedListingCreate,
  DomainEventOverview,
  MapSearchRequest,
  MapSearchResponse,
} from "@/types/api";

// Transactions
export const transactionsApi = {
  list: (user: SeedUser, params?: { cursor?: string; limit?: number }) =>
    apiFetch<TransactionListResponse>("/transactions", { user, params }),

  get: (user: SeedUser, id: string) =>
    apiFetch<TransactionOverview>(`/transactions/${id}`, { user }),

  create: (user: SeedUser, data: TransactionCreate) =>
    apiFetch<TransactionOverview>("/transactions", { user, method: "POST", body: data }),

  transition: (user: SeedUser, id: string, data: TransitionRequest) =>
    apiFetch<TransactionOverview>(`/transactions/${id}/transitions`, {
      user,
      method: "POST",
      body: data,
    }),

  addParty: (user: SeedUser, id: string, data: PartyCreate) =>
    apiFetch<TransactionPartySummary>(`/transactions/${id}/parties`, {
      user,
      method: "POST",
      body: data,
    }),

  getDocumentChecklist: (user: SeedUser, id: string) =>
    apiFetch<ChecklistItem[]>(`/transactions/${id}/document-checklist`, { user }),

  getTimeline: (user: SeedUser, id: string) =>
    apiFetch<TransactionTimeline>(`/transactions/${id}/timeline`, { user }),

  getAiInsights: (user: SeedUser, id: string) =>
    apiFetch<Record<string, unknown>[]>(`/transactions/${id}/ai/insights`, { user }),

  getChatRoom: (user: SeedUser, id: string) =>
    apiFetch<ChatRoomOverview>(`/transactions/${id}/chat`, { user }),
};

// Properties
export const propertiesApi = {
  list: (user: SeedUser, params?: { limit?: number; offset?: number; status_filter?: string }) =>
    apiFetch<PropertyOverview[]>("/properties", { user, params }),

  get: (user: SeedUser, id: string) =>
    apiFetch<PropertyOverview>(`/properties/${id}`, { user }),

  create: (user: SeedUser, data: PropertyCreate) =>
    apiFetch<PropertyOverview>("/properties", { user, method: "POST", body: data }),

  update: (user: SeedUser, id: string, data: PropertyUpdate) =>
    apiFetch<PropertyOverview>(`/properties/${id}`, { user, method: "PATCH", body: data }),

  search: (user: SeedUser, data: PropertySearchRequest) =>
    apiFetch<PropertySearchResponse>("/properties/search", { user, method: "POST", body: data }),

  getImages: (user: SeedUser, id: string) =>
    apiFetch<PropertyImageOverview[]>(`/properties/${id}/images`, { user }),

  getImageUploadUrl: (
    user: SeedUser,
    propertyId: string,
    data?: { filename?: string; content_type?: string }
  ) =>
    apiFetch<PropertyImageUploadUrlResponse>(`/properties/${propertyId}/images/upload`, {
      user,
      method: "POST",
      body: data ?? {},
    }),

  updateImage: (
    user: SeedUser,
    propertyId: string,
    imageId: string,
    data: PropertyImageUpdate
  ) =>
    apiFetch<PropertyImageOverview>(`/properties/${propertyId}/images/${imageId}`, {
      user,
      method: "PATCH",
      body: data,
    }),
};

// Listings
export const listingsApi = {
  list: (user: SeedUser, params?: { limit?: number; cursor?: string; status_filter?: string; search?: string }) =>
    apiFetch<ListingListResponse>("/listings", { user, params }),

  get: (user: SeedUser, id: string) =>
    apiFetch<ListingOverview>(`/listings/${id}`, { user }),

  create: (user: SeedUser, data: ListingCreate) =>
    apiFetch<ListingOverview>("/listings", { user, method: "POST", body: data }),

  update: (user: SeedUser, id: string, data: ListingUpdate) =>
    apiFetch<ListingOverview>(`/listings/${id}`, { user, method: "PATCH", body: data }),

  getInterestedBuyers: (user: SeedUser, id: string) =>
    apiFetch<InterestedBuyerItem[]>(`/listings/${id}/interested-buyers`, { user }),

  /** Bounding-box search for map display. Returns GeoJSON FeatureCollection. */
  mapSearch: (user: SeedUser, data: MapSearchRequest) =>
    apiFetch<MapSearchResponse>("/listings/map-search", {
      user,
      method: "POST",
      body: data,
    }),
};

// Offers (paths: transactions/{id}/offers, offers/{id}/counter|withdraw|reject|accept — no /offers prefix)
export const offersApi = {
  list: (user: SeedUser, transactionId: string) =>
    apiFetch<OfferOverview[]>(`transactions/${transactionId}/offers`, { user }),

  submit: (user: SeedUser, transactionId: string, data: OfferCreate) =>
    apiFetch<OfferOverview>(`transactions/${transactionId}/offers`, {
      user,
      method: "POST",
      body: data,
    }),

  counter: (user: SeedUser, offerId: string, data: OfferCreate) =>
    apiFetch<OfferOverview>(`offers/${offerId}/counter`, {
      user,
      method: "POST",
      body: data,
    }),

  withdraw: (user: SeedUser, offerId: string, data: OfferDecisionBody) =>
    apiFetch<OfferOverview>(`offers/${offerId}/withdraw`, {
      user,
      method: "POST",
      body: data,
    }),

  reject: (user: SeedUser, offerId: string, data: OfferDecisionBody) =>
    apiFetch<OfferOverview>(`offers/${offerId}/reject`, {
      user,
      method: "POST",
      body: data,
    }),

  accept: (user: SeedUser, offerId: string, data: OfferAcceptBody) =>
    apiFetch<OfferOverview>(`offers/${offerId}/accept`, {
      user,
      method: "POST",
      body: data,
    }),
};

// Showings (paths: listings/{id}/showings, showings/{id} PATCH — no /showings prefix)
export const showingsApi = {
  list: (user: SeedUser, listingId: string) =>
    apiFetch<ShowingOverview[]>(`listings/${listingId}/showings`, { user }),

  schedule: (user: SeedUser, listingId: string, data: ShowingCreate) =>
    apiFetch<ShowingOverview>(`listings/${listingId}/showings`, {
      user,
      method: "POST",
      body: data,
    }),

  update: (user: SeedUser, showingId: string, data: ShowingUpdate) =>
    apiFetch<ShowingOverview>(`showings/${showingId}`, {
      user,
      method: "PATCH",
      body: data,
    }),

  listFeedback: (user: SeedUser, showingId: string) =>
    apiFetch<ShowingFeedbackOverview[]>(`showings/${showingId}/feedback`, { user }),

  addFeedback: (user: SeedUser, showingId: string, data: ShowingFeedbackCreate) =>
    apiFetch<ShowingFeedbackOverview>(`showings/${showingId}/feedback`, {
      user,
      method: "POST",
      body: data,
    }),
};

// Documents
export const documentsApi = {
  list: (user: SeedUser, transactionId: string) =>
    apiFetch<DocumentOverview[]>(`transactions/${transactionId}/documents`, { user }),

  get: (user: SeedUser, id: string) =>
    apiFetch<DocumentOverview>(`documents/${id}`, { user }),

  listVersions: (user: SeedUser, documentId: string) =>
    apiFetch<DocumentVersionOverview[]>(`documents/${documentId}/versions`, { user }),

  create: (user: SeedUser, transactionId: string, data: DocumentCreate) =>
    apiFetch<DocumentOverview>(`transactions/${transactionId}/documents`, {
      user,
      method: "POST",
      body: data,
    }),

  getUploadUrl: (
    user: SeedUser,
    documentId: string,
    data?: { filename?: string; content_type?: string }
  ) =>
    apiFetch<DocumentUploadUrlResponse>(`documents/${documentId}/upload-url`, {
      user,
      method: "POST",
      body: data ?? {},
    }),

  addVersion: (user: SeedUser, documentId: string, data: DocumentVersionCreate) =>
    apiFetch<DocumentVersionOverview>(`documents/${documentId}/versions`, {
      user,
      method: "POST",
      body: data,
    }),

  lock: (user: SeedUser, documentId: string) =>
    apiFetch<DocumentOverview>(`documents/${documentId}/lock`, {
      user,
      method: "POST",
    }),

  sign: (user: SeedUser, documentId: string, data: DocumentSignatureCreate) =>
    apiFetch<DocumentSignatureOverview>(`documents/${documentId}/signatures`, {
      user,
      method: "POST",
      body: data,
    }),
};

// Inspections (paths: transactions/{id}/inspections, inspections/{id}, inspections/{id}/submit)
export const inspectionsApi = {
  list: (user: SeedUser, transactionId: string) =>
    apiFetch<InspectionOverview[]>(`transactions/${transactionId}/inspections`, { user }),

  create: (user: SeedUser, transactionId: string, data: InspectionCreate) =>
    apiFetch<InspectionOverview>(`transactions/${transactionId}/inspections`, {
      user,
      method: "POST",
      body: data,
    }),

  get: (user: SeedUser, id: string) =>
    apiFetch<InspectionOverview>(`inspections/${id}`, { user }),

  submit: (user: SeedUser, id: string, data: InspectionSubmit) =>
    apiFetch<InspectionOverview>(`inspections/${id}/submit`, {
      user,
      method: "POST",
      body: data,
    }),
};

// Appraisals (paths: transactions/{id}/appraisals, appraisals/{id}, appraisals/{id}/submit)
export const appraisalsApi = {
  create: (user: SeedUser, transactionId: string, data: AppraisalCreate) =>
    apiFetch<AppraisalOverview>(`transactions/${transactionId}/appraisals`, {
      user,
      method: "POST",
      body: data,
    }),

  get: (user: SeedUser, id: string) =>
    apiFetch<AppraisalOverview>(`appraisals/${id}`, { user }),

  submit: (user: SeedUser, id: string, data: AppraisalSubmit) =>
    apiFetch<AppraisalOverview>(`appraisals/${id}/submit`, {
      user,
      method: "POST",
      body: data,
    }),
};

// Escrow (paths: transactions/{id}/escrow/assignments|earnest-money|funding|disbursements + confirm endpoints)
export const escrowApi = {
  listAssignments: (user: SeedUser, transactionId: string) =>
    apiFetch<EscrowAssignmentOverview[]>(`transactions/${transactionId}/escrow/assignments`, { user }),

  listEarnestMoney: (user: SeedUser, transactionId: string) =>
    apiFetch<EarnestMoneyOverview[]>(`transactions/${transactionId}/escrow/earnest-money`, { user }),

  listFunding: (user: SeedUser, transactionId: string) =>
    apiFetch<FundingConfirmationOverview[]>(`transactions/${transactionId}/escrow/funding`, { user }),

  listDisbursements: (user: SeedUser, transactionId: string) =>
    apiFetch<DisbursementOverview[]>(`transactions/${transactionId}/escrow/disbursements`, { user }),

  assignOfficer: (user: SeedUser, transactionId: string, data: EscrowAssignmentCreate) =>
    apiFetch<EscrowAssignmentOverview>(`transactions/${transactionId}/escrow/assignments`, {
      user,
      method: "POST",
      body: data,
    }),

  confirmEarnestMoney: (user: SeedUser, transactionId: string, data: EarnestMoneyConfirm) =>
    apiFetch<EarnestMoneyOverview>(
      `transactions/${transactionId}/escrow/earnest-money/confirm`,
      { user, method: "POST", body: data }
    ),

  confirmFunding: (user: SeedUser, transactionId: string, data: FundingConfirm) =>
    apiFetch<FundingConfirmationOverview>(
      `transactions/${transactionId}/escrow/funding/confirm`,
      { user, method: "POST", body: data }
    ),

  recordDisbursement: (user: SeedUser, transactionId: string, data: DisbursementCreate) =>
    apiFetch<DisbursementOverview>(`transactions/${transactionId}/escrow/disbursements`, {
      user,
      method: "POST",
      body: data,
    }),
};

// Title (paths: transactions/{id}/title/orders|commitments, GET lists, title/orders/{id} PATCH, transactions/{id}/closing/*)
export const titleApi = {
  listOrders: (user: SeedUser, transactionId: string) =>
    apiFetch<TitleOrderOverview[]>(`transactions/${transactionId}/title/orders`, { user }),

  listCommitments: (user: SeedUser, transactionId: string) =>
    apiFetch<TitleCommitmentOverview[]>(`transactions/${transactionId}/title/commitments`, { user }),

  listDeedRecordings: (user: SeedUser, transactionId: string) =>
    apiFetch<DeedRecordingOverview[]>(`transactions/${transactionId}/closing/deed-recordings`, { user }),

  listOwnershipTransfers: (user: SeedUser, transactionId: string) =>
    apiFetch<OwnershipTransferOverview[]>(`transactions/${transactionId}/closing/ownership-transfers`, { user }),

  listAppraisalWaivers: (user: SeedUser, transactionId: string) =>
    apiFetch<AppraisalWaiverOverview[]>(`transactions/${transactionId}/appraisals/waivers`, { user }),

  createOrder: (user: SeedUser, transactionId: string, data: TitleOrderCreate) =>
    apiFetch<TitleOrderOverview>(`transactions/${transactionId}/title/orders`, {
      user,
      method: "POST",
      body: data,
    }),

  updateOrder: (user: SeedUser, orderId: string, data: TitleOrderUpdate) =>
    apiFetch<TitleOrderOverview>(`title/orders/${orderId}`, {
      user,
      method: "PATCH",
      body: data,
    }),

  createCommitment: (user: SeedUser, transactionId: string, data: TitleCommitmentCreate) =>
    apiFetch<TitleCommitmentOverview>(`transactions/${transactionId}/title/commitments`, {
      user,
      method: "POST",
      body: data,
    }),

  recordDeed: (user: SeedUser, transactionId: string, data: DeedRecordedCreate) =>
    apiFetch<DeedRecordingOverview>(`transactions/${transactionId}/closing/deed-recorded`, {
      user,
      method: "POST",
      body: data,
    }),

  recordOwnershipTransfer: (user: SeedUser, transactionId: string, data: OwnershipTransferCreate) =>
    apiFetch<OwnershipTransferOverview>(
      `transactions/${transactionId}/closing/ownership-transfer`,
      { user, method: "POST", body: data }
    ),

  waiveAppraisal: (user: SeedUser, transactionId: string, data: AppraisalWaiverCreate) =>
    apiFetch<AppraisalWaiverOverview>(`transactions/${transactionId}/appraisals/waive`, {
      user,
      method: "POST",
      body: data,
    }),
};

// Chat
export const chatApi = {
  listRooms: (user: SeedUser) =>
    apiFetch<ChatRoomOverview[]>("/chat/rooms", { user }),

  getRoom: (user: SeedUser, roomId: string) =>
    apiFetch<ChatRoomOverview>(`/chat/rooms/${roomId}`, { user }),

  createRoom: (user: SeedUser, data: ChatRoomCreate) =>
    apiFetch<ChatRoomOverview>("/chat/rooms", { user, method: "POST", body: data }),

  updateRoom: (user: SeedUser, roomId: string, data: ChatRoomUpdate) =>
    apiFetch<ChatRoomOverview>(`/chat/rooms/${roomId}`, { user, method: "PATCH", body: data }),

  addMember: (user: SeedUser, roomId: string, data: AddMemberBody) =>
    apiFetch<void>(`/chat/rooms/${roomId}/members`, { user, method: "POST", body: data }),

  removeMember: (user: SeedUser, roomId: string, memberId: string) =>
    apiFetch<void>(`/chat/rooms/${roomId}/members/${memberId}`, { user, method: "DELETE" }),

  listMessages: (user: SeedUser, roomId: string, params?: { cursor?: string; limit?: number }) =>
    apiFetch<MessageOverview[]>(`/chat/rooms/${roomId}/messages`, { user, params }),

  sendMessage: (user: SeedUser, roomId: string, data: MessageCreate) =>
    apiFetch<MessageOverview>(`/chat/rooms/${roomId}/messages`, {
      user,
      method: "POST",
      body: data,
    }),

  editMessage: (user: SeedUser, messageId: string, data: MessageUpdate) =>
    apiFetch<MessageOverview>(`/chat/messages/${messageId}`, {
      user,
      method: "PATCH",
      body: data,
    }),

  deleteMessage: (user: SeedUser, messageId: string) =>
    apiFetch<void>(`/chat/messages/${messageId}`, { user, method: "DELETE" }),

  markRead: (user: SeedUser, roomId: string, messageId: string) =>
    apiFetch<void>(`/chat/rooms/${roomId}/mark-read`, {
      user,
      method: "POST",
      params: { message_id: messageId },
    }),
};

// User Preferences & Recommendations
export const preferencesApi = {
  list: (user: SeedUser) =>
    apiFetch<PreferenceOverview[]>("/users/me/preferences", { user }),

  get: (user: SeedUser, id: string) =>
    apiFetch<PreferenceOverview>(`/users/me/preferences/${id}`, { user }),

  create: (user: SeedUser, data: PreferenceCreate) =>
    apiFetch<PreferenceOverview>("/users/me/preferences", { user, method: "POST", body: data }),

  update: (user: SeedUser, id: string, data: PreferenceUpdate) =>
    apiFetch<PreferenceOverview>(`/users/me/preferences/${id}`, {
      user,
      method: "PATCH",
      body: data,
    }),

  delete: (user: SeedUser, id: string) =>
    apiFetch<void>(`/users/me/preferences/${id}`, { user, method: "DELETE" }),
};

export const recommendationsApi = {
  list: (
    user: SeedUser,
    params?: { preference_id?: string; min_score?: number; limit?: number }
  ) => apiFetch<RecommendationsResponse>("/users/me/recommendations", { user, params }),

  submitFeedback: (user: SeedUser, matchId: string, data: FeedbackBody) =>
    apiFetch<Record<string, unknown>>(`/users/me/recommendations/${matchId}/feedback`, {
      user,
      method: "POST",
      body: data,
    }),
};

export const savedListingsApi = {
  list: (user: SeedUser) =>
    apiFetch<SavedListingOverview[]>("/users/me/saved-listings", { user }),

  save: (user: SeedUser, data: SavedListingCreate) =>
    apiFetch<SavedListingOverview>("/users/me/saved-listings", {
      user,
      method: "POST",
      body: data,
    }),

  unsave: (user: SeedUser, listingId: string) =>
    apiFetch<void>(`/users/me/saved-listings/${listingId}`, {
      user,
      method: "DELETE",
    }),
};

/** Eligible escrow officers for assignment picker (org members with role ESCROW_OFFICER). */
export const eligibleEscrowOfficersApi = {
  list: (user: SeedUser) =>
    apiFetch<EligibleEscrowOfficer[]>("/users/me/eligible-escrow-officers", { user }),
};

// Champagne moments (in-app celebratory toasts; event emission + consumption)
export const champagneMomentsApi = {
  list: (user: SeedUser, params?: { limit?: number }) =>
    apiFetch<ChampagneMomentOverview[]>("/users/me/champagne-moments", { user, params }),
};

// Events (path: transactions/{id}/events)
export const eventsApi = {
  list: (user: SeedUser, transactionId: string, params?: { since?: string; limit?: number }) =>
    apiFetch<DomainEventOverview[]>(`transactions/${transactionId}/events`, {
      user,
      params,
    }),
};

// AI Insights
export const aiApi = {
  approveInsight: (user: SeedUser, insightId: string) =>
    apiFetch<Record<string, unknown>>(`/ai/insights/${insightId}/approve`, {
      user,
      method: "POST",
    }),
};
