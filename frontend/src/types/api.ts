/** API types aligned with backend realtrust_api domain Pydantic schemas */

// ============================================================================
// Common types
// ============================================================================

export interface PaginationMeta {
  limit: number;
  cursor: string | null;
}

// ============================================================================
// User & Auth types
// ============================================================================

export interface SeedUser {
  user_id: string;
  email: string;
  full_name: string | null;
  organization_id: string;
  organization_name: string;
  role: UserRole;
}

export type UserRole =
  | "BUYER"
  | "SELLER"
  | "BUYER_AGENT"
  | "SELLER_AGENT"
  | "ESCROW_OFFICER"
  | "LENDER"
  | "APPRAISER"
  | "INSPECTOR"
  | "ADMIN";

/** Eligible escrow officer for assignment picker (from GET /users/me/eligible-escrow-officers). */
export interface EligibleEscrowOfficer {
  user_id: string;
  full_name: string | null;
  email: string;
}

/** Champagne moment for in-app celebratory toast (from GET /users/me/champagne-moments). */
export interface ChampagneMomentOverview {
  event_id: string;
  event_type: string;
  emitted_at: string;
  transaction_id: string;
  property_address: string | null;
  amount: number | null;
  title: string;
  message: string;
}

// ============================================================================
// Transaction types
// ============================================================================

export type TransactionState =
  | "PRE_LISTING"
  | "LISTED"
  | "OFFER_MADE"
  | "UNDER_CONTRACT"
  | "DUE_DILIGENCE"
  | "FINANCING"
  | "CLEAR_TO_CLOSE"
  | "CLOSED"
  | "CANCELLED";

export interface TransactionOverview {
  transaction_id: string;
  organization_id: string;
  current_state: TransactionState;
  state_entered_at: string;
  jurisdiction: string | null;
  offer_price: number | null;
  property_id: string | null;
  listing_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface TransactionListResponse {
  data: TransactionOverview[];
  meta: PaginationMeta;
}

export interface TransactionCreate {
  /** Required by backend; use current user's organization_id. */
  organization_id: string;
  initial_state?: TransactionState;
  initial_party_role?: UserRole;
  property_id?: string;
  listing_id?: string;
}

export interface TransitionRequest {
  to_state: TransactionState;
  action?: string;
  metadata?: Record<string, unknown>;
}

export interface PartyCreate {
  user_id: string;
  organization_id: string;
  role: UserRole;
}

export interface TransactionPartySummary {
  user_id: string;
  organization_id: string;
  role: UserRole;
  created_at: string;
}

export interface DocumentChecklistItem {
  kind?: "document";
  document_type: string;
  required_for_to_state: TransactionState;
  present: boolean;
  signed: boolean;
}

export interface MilestoneChecklistItem {
  kind: "milestone";
  milestone_key: string;
  label: string;
  required_for_to_state: TransactionState;
  present: boolean;
}

/** Document and milestone checklist (05/17 alignment). */
export type ChecklistItem = DocumentChecklistItem | MilestoneChecklistItem;

export function isMilestoneChecklistItem(item: ChecklistItem): item is MilestoneChecklistItem {
  return item.kind === "milestone";
}

export interface TransactionTimelineStateChange {
  from_state: TransactionState;
  to_state: TransactionState;
  entered_at: string;
  actor_role: UserRole;
}

export interface TransactionTimeline {
  state_changes: TransactionTimelineStateChange[];
  events: DomainEventOverview[];
}

// ============================================================================
// Property types
// ============================================================================

export type PropertyStatus = "ACTIVE" | "PENDING" | "SOLD" | "OFF_MARKET";

export type PropertyType =
  | "SINGLE_FAMILY"
  | "TOWNHOUSE"
  | "CONDO"
  | "MULTI_FAMILY"
  | "LAND"
  | "COMMERCIAL";

export interface PropertyOverview {
  property_id: string;
  status: PropertyStatus;
  address_line_1: string;
  address_line_2: string | null;
  city: string;
  state_province: string;
  postal_code: string;
  country: string;
  latitude: number | null;
  longitude: number | null;
  property_type: PropertyType;
  year_built: number | null;
  living_area_sqft: number | null;
  bedrooms: number | null;
  bathrooms_full: number | null;
  created_at: string;
  updated_at: string;
  /** Presigned URL for primary/cover image (for cards). */
  cover_image_url: string | null;
}

export interface PropertyCreate {
  address_line_1: string;
  address_line_2?: string;
  city: string;
  state_province: string;
  postal_code: string;
  country?: string;
  latitude?: number;
  longitude?: number;
  property_type: PropertyType;
  year_built?: number;
  living_area_sqft?: number;
  bedrooms?: number;
  bathrooms_full?: number;
  data_source?: string;
}

export interface PropertyUpdate {
  status?: PropertyStatus;
  address_line_2?: string;
  year_built?: number;
  living_area_sqft?: number;
  bedrooms?: number;
  bathrooms_full?: number;
}

export interface PropertySearchRequest {
  location?: {
    latitude?: number;
    longitude?: number;
    radius_miles?: number;
    city?: string;
    state_province?: string;
    postal_code?: string;
  };
  filters?: {
    price_min?: number;
    price_max?: number;
    bedrooms_min?: number;
    bedrooms_max?: number;
    bathrooms_min?: number;
    property_types?: PropertyType[];
    min_sqft?: number;
    max_sqft?: number;
  };
  sort?: {
    field?: string;
    direction?: "asc" | "desc";
  };
  pagination?: {
    limit?: number;
    offset?: number;
  };
}

export interface PropertySearchResultItem {
  property: PropertyOverview;
  listing: ListingOverview | null;
  distance_miles: number | null;
  relevance_score: number | null;
}

export interface PropertySearchResponse {
  data: PropertySearchResultItem[];
  meta: { total: number; limit: number; offset: number };
}

export interface PropertyImageOverview {
  image_id: string;
  property_id: string;
  storage_path: string;
  thumbnail_path: string | null;
  is_primary: boolean;
  display_order: number;
  caption: string | null;
  moderation_status: string;
  /** Presigned GET URL for display; only set when upload is complete (file_size set, checksum not "pending"). */
  view_url: string | null;
}

export interface PropertyImageUploadUrlResponse {
  upload_url: string;
  image_id: string;
  storage_path: string;
  storage_bucket: string;
  expires_in_seconds: number;
}

export interface PropertyImageUpdate {
  caption?: string;
  display_order?: number;
  is_primary?: boolean;
  file_size_bytes?: number;
  checksum?: string;
}

// ============================================================================
// Listing types
// ============================================================================

export type ListingStatus = "DRAFT" | "ACTIVE" | "PENDING" | "SOLD" | "EXPIRED" | "WITHDRAWN";

export type ListingType = "FOR_SALE" | "FOR_RENT" | "AUCTION";

export interface ListingOverview {
  listing_id: string;
  property_id: string;
  status: ListingStatus;
  list_price: number;
  price_currency: string;
  listing_type: ListingType;
  days_on_market: number | null;
  description: string | null;
  is_public: boolean;
  created_at: string;
  updated_at: string;
  /** Next open house date/time (optional). */
  next_open_house_at?: string | null;
  /** Presigned URL for property primary/cover image (for cards). */
  cover_image_url: string | null;
  /** Property location (from listing view join). */
  address_line_1?: string;
  address_line_2?: string | null;
  city?: string;
  state_province?: string;
  postal_code?: string;
  country?: string;
  /** Property geo coordinates (from view join). */
  latitude?: number | null;
  longitude?: number | null;
}

export interface ListingCreate {
  property_id: string;
  list_price: number;
  price_currency?: string;
  listing_type?: ListingType;
  description?: string;
  listing_agent_id?: string;
  listing_broker_id?: string;
  is_public?: boolean;
}

export interface ListingUpdate {
  status?: ListingStatus;
  list_price?: number;
  description?: string;
  is_public?: boolean;
  next_open_house_at?: string | null;
}

export interface ListingListResponse {
  data: ListingOverview[];
  meta: PaginationMeta;
}

// ============================================================================
// Map types (POST /listings/map-search)
// ============================================================================

export interface MapBounds {
  sw_lat: number;
  sw_lng: number;
  ne_lat: number;
  ne_lng: number;
}

export interface MapSearchFilters {
  status_filter?: string;
  price_min?: number;
  price_max?: number;
  bedrooms_min?: number;
  property_types?: string[];
  search?: string;
}

export interface MapSearchRequest {
  bounds: MapBounds;
  zoom: number;
  filters?: MapSearchFilters;
  limit?: number;
}

/** GeoJSON Feature from map-search response. */
export interface MapListingFeature {
  type: "Feature";
  geometry: {
    type: "Point";
    coordinates: [number, number]; // [lng, lat]
  };
  properties: {
    listing_id?: string;
    property_id?: string;
    list_price?: number;
    price_short?: string;
    listing_type?: string;
    description?: string | null;
    status?: string;
    address_line_1?: string;
    city?: string;
    state_province?: string;
    postal_code?: string;
    bedrooms?: number | null;
    bathrooms_full?: number | null;
    living_area_sqft?: number | null;
    property_type?: string;
    days_on_market?: number;
    // Cluster properties (when clustered)
    cluster?: boolean;
    point_count?: number;
    point_count_abbreviated?: string;
    avg_price?: number;
    min_price?: number;
    max_price?: number;
  };
}

/** GeoJSON FeatureCollection from POST /listings/map-search. */
export interface MapSearchResponse {
  type: "FeatureCollection";
  features: MapListingFeature[];
  meta: {
    total_in_bounds: number;
    clustered: boolean;
    zoom: number;
  };
}

export interface InterestedBuyerItem {
  user_id: string;
  preference_id: string;
  match_score: number;
  match_id: string;
}

// ============================================================================
// Offer types
// ============================================================================

export type OfferStatus = "PENDING" | "SUBMITTED" | "ACCEPTED" | "REJECTED" | "COUNTERED" | "WITHDRAWN" | "EXPIRED";

export interface OfferOverview {
  offer_id: string;
  transaction_id: string;
  parent_offer_id: string | null;
  document_id: string | null;
  status: OfferStatus;
  terms: Record<string, unknown>;
  created_by_user_id: string;
  created_at: string;
  updated_at: string;
}

export interface OfferCreate {
  document_id?: string;
  terms?: Record<string, unknown>;
}

export interface OfferDecisionBody {
  reason?: string;
}

export interface OfferAcceptBody {
  purchase_agreement_document_id: string;
  reason?: string;
}

// ============================================================================
// Showing types
// ============================================================================

export type ShowingStatus = "SCHEDULED" | "COMPLETED" | "CANCELLED" | "NO_SHOW";

export type ShowingType = "PRIVATE" | "OPEN_HOUSE";

export interface ShowingOverview {
  showing_id: string;
  listing_id: string;
  scheduled_start_at: string;
  scheduled_end_at: string | null;
  status: ShowingStatus;
  showing_type: ShowingType;
  requested_by_user_id: string | null;
  created_by_user_id: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface ShowingCreate {
  scheduled_start_at: string;
  scheduled_end_at?: string;
  showing_type?: ShowingType;
  requested_by_user_id?: string;
  notes?: string;
}

export interface ShowingUpdate {
  scheduled_start_at?: string;
  scheduled_end_at?: string;
  status?: ShowingStatus;
  showing_type?: ShowingType;
  notes?: string;
}

export type ShowingFeedbackRating = "POSITIVE" | "NEUTRAL" | "NEGATIVE" | "NO_SHOW";

export interface ShowingFeedbackOverview {
  feedback_id: string;
  listing_id: string;
  showing_id: string;
  from_user_id: string;
  rating: ShowingFeedbackRating | null;
  notes: string | null;
  created_at: string;
}

export interface ShowingFeedbackCreate {
  rating?: ShowingFeedbackRating;
  notes?: string;
}

// ============================================================================
// Document types
// ============================================================================

export type DocumentType =
  | "listing_agreement"
  | "offer"
  | "purchase_agreement"
  | "escrow_instructions"
  | "inspection_report"
  | "appraisal_report"
  | "loan_commitment"
  | "funding_confirmation"
  | "deed"
  | "pre_qualification_letter"
  | "other";

export type ExecutionStatus =
  | "draft"
  | "pending_signature"
  | "partially_signed"
  | "fully_executed"
  | "signed"
  | "void";

export interface DocumentOverview {
  document_id: string;
  transaction_id: string;
  document_type: DocumentType;
  execution_status: ExecutionStatus;
  created_at: string;
  updated_at: string;
  /** Presigned GET URL for latest version; null when no version uploaded yet (pending). */
  view_url: string | null;
}

export interface DocumentCreate {
  document_type: DocumentType;
}

export interface DocumentVersionOverview {
  version_id: string;
  document_id: string;
  storage_path: string;
  storage_bucket: string;
  checksum: string;
  created_at: string;
}

export interface DocumentUploadUrlResponse {
  upload_url: string;
  storage_path: string;
  storage_bucket: string;
  expires_in_seconds: number;
}

export interface DocumentVersionCreate {
  storage_path: string;
  storage_bucket: string;
  checksum: string;
}

export interface DocumentSignatureOverview {
  signature_id: string;
  document_version_id: string;
  signer_id: string;
  signed_at: string;
}

export interface DocumentSignatureCreate {
  signer_id: string;
}

// ============================================================================
// Inspection types
// ============================================================================

export type InspectionStatus = "scheduled" | "in_progress" | "completed" | "cancelled";

export interface InspectionOverview {
  inspection_id: string;
  transaction_id: string;
  inspector_id: string;
  status: InspectionStatus;
  scheduled_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface InspectionCreate {
  inspector_id: string;
  scheduled_at: string;
}

export interface InspectionSubmit {
  findings: Array<Record<string, unknown>>;
  status?: string;
}

// ============================================================================
// Appraisal types
// ============================================================================

export type AppraisalStatus = "ordered" | "scheduled" | "in_progress" | "completed" | "cancelled";

export interface AppraisalOverview {
  appraisal_id: string;
  transaction_id: string;
  appraiser_id: string;
  status: AppraisalStatus;
  value_amount: number | null;
  created_at: string;
  updated_at: string;
}

export interface AppraisalCreate {
  /** Optional; backend accepts null/omit for "order only" flow. */
  appraiser_id?: string;
}

export interface AppraisalSubmit {
  value_amount: number;
  status?: string;
}

// ============================================================================
// Escrow types
// ============================================================================

export interface EscrowAssignmentOverview {
  assignment_id: string;
  transaction_id: string;
  escrow_officer_id: string;
  assigned_by_user_id: string;
  assigned_at: string;
  is_active: boolean;
}

export interface EscrowAssignmentCreate {
  escrow_officer_id: string;
}

export interface EarnestMoneyOverview {
  deposit_id: string;
  transaction_id: string;
  amount: number;
  confirmed_by_user_id: string;
  confirmed_at: string;
  notes: string | null;
}

export interface EarnestMoneyConfirm {
  amount?: number;
  notes?: string;
}

export interface FundingConfirmationOverview {
  confirmation_id: string;
  transaction_id: string;
  confirmed_by_user_id: string;
  confirmed_at: string;
  verified: boolean;
  notes: string | null;
}

export interface FundingConfirm {
  verified: boolean;
  notes?: string;
}

export interface DisbursementOverview {
  disbursement_id: string;
  transaction_id: string;
  amount: number;
  recipient: string;
  recorded_by_user_id: string;
  recorded_at: string;
  notes: string | null;
}

export interface DisbursementCreate {
  amount: number;
  recipient: string;
  notes?: string;
}

// ============================================================================
// Title types
// ============================================================================

export type TitleOrderStatus = "ORDERED" | "IN_PROGRESS" | "CLEARED" | "EXCEPTION";

export interface TitleOrderOverview {
  title_order_id: string;
  transaction_id: string;
  ordered_by_user_id: string;
  ordered_at: string;
  status: TitleOrderStatus;
  insurance_bound_at: string | null;
}

export interface TitleOrderCreate {
  status?: TitleOrderStatus;
}

export interface TitleOrderUpdate {
  status?: TitleOrderStatus;
  insurance_bound_at?: string;
}

export interface TitleCommitmentOverview {
  commitment_id: string;
  transaction_id: string;
  document_id: string | null;
  received_at: string;
  exceptions_summary: string | null;
}

export interface TitleCommitmentCreate {
  document_id?: string;
  exceptions_summary?: string;
}

export interface DeedRecordingOverview {
  recording_id: string;
  transaction_id: string;
  document_id: string | null;
  recorded_at: string;
  recording_reference: string | null;
}

export interface DeedRecordedCreate {
  document_id?: string;
  recording_reference?: string;
}

export interface OwnershipTransferOverview {
  transfer_id: string;
  transaction_id: string;
  transferred_at: string;
  notes: string | null;
}

export interface OwnershipTransferCreate {
  notes?: string;
}

export interface AppraisalWaiverOverview {
  waiver_id: string;
  transaction_id: string;
  waived_by_user_id: string;
  waived_at: string;
  reason: string | null;
}

export interface AppraisalWaiverCreate {
  reason?: string;
}

// ============================================================================
// Messaging types
// ============================================================================

export type ChatRoomType = "TRANSACTION" | "DIRECT" | "GROUP";

export interface ChatRoomOverview {
  room_id: string;
  room_type: ChatRoomType;
  transaction_id: string | null;
  name: string | null;
  created_at: string;
  is_archived: boolean;
}

export interface ChatRoomCreate {
  room_type: ChatRoomType;
  transaction_id?: string;
  name?: string;
  member_user_ids?: string[];
}

export interface ChatRoomUpdate {
  name?: string;
  is_archived?: boolean;
}

export type MessageType = "TEXT" | "SYSTEM" | "FILE";

export interface MessageOverview {
  message_id: string;
  room_id: string;
  sender_id: string;
  message_type: MessageType;
  content: string | null;
  created_at: string;
  is_deleted: boolean;
}

export interface MessageCreate {
  message_type?: MessageType;
  content: string;
  content_json?: Record<string, unknown>;
  reply_to_message_id?: string;
}

export interface MessageUpdate {
  content: string;
}

export interface ChatAttachmentOverview {
  attachment_id: string;
  message_id: string;
  file_name: string;
  file_size_bytes: number;
  mime_type: string;
}

export interface PresignedUploadResponse {
  upload_url: string;
  attachment_id: string;
  expires_in_seconds: number;
}

export interface AddMemberBody {
  user_id: string;
}

// ============================================================================
// Matching/Preferences types
// ============================================================================

export type NotificationFrequency = "INSTANT" | "DAILY" | "WEEKLY" | "NONE";

export interface PreferenceOverview {
  preference_id: string;
  user_id: string;
  is_active: boolean;
  price_min: number | null;
  price_max: number | null;
  bedrooms_min: number | null;
  preferred_states: string[] | null;
  preferred_cities: string[] | null;
  notification_frequency: NotificationFrequency;
  created_at: string;
  updated_at: string;
}

export interface PreferenceCreate {
  price_min?: number;
  price_max?: number;
  bedrooms_min?: number;
  bedrooms_max?: number;
  preferred_states?: string[];
  preferred_cities?: string[];
  preferred_zip_codes?: string[];
  property_types?: PropertyType[];
  min_sqft?: number;
  max_sqft?: number;
  lifestyle_description?: string;
  notification_frequency?: NotificationFrequency;
}

export interface PreferenceUpdate {
  is_active?: boolean;
  price_min?: number;
  price_max?: number;
  bedrooms_min?: number;
  preferred_states?: string[];
  preferred_cities?: string[];
  notification_frequency?: NotificationFrequency;
}

export interface RecommendationItem {
  match_id: string;
  listing: {
    listing_id: string;
    list_price: number;
    status: string;
    days_on_market: number | null;
  };
  property: {
    property_id: string;
    address_line_1: string;
    city: string;
    state_province: string;
    postal_code: string;
    bedrooms: number | null;
    bathrooms_full: number | null;
    living_area_sqft: number | null;
    property_type: string;
  };
  match_score: number;
  match_explanation: string | null;
  score_breakdown: Record<string, number>;
  recommended_at: string;
}

export interface RecommendationsResponse {
  recommendations: RecommendationItem[];
  meta: PaginationMeta;
}

export type FeedbackType = "LIKED" | "DISLIKED" | "SAVED" | "CONTACTED";

export interface FeedbackBody {
  feedback: FeedbackType;
}

export interface SavedListingOverview {
  listing_id: string;
  property_id: string;
  address_line_1: string;
  city: string;
  state_province: string;
  postal_code: string;
  list_price: number;
  listing_status: string;
  saved_at: string;
}

export interface SavedListingCreate {
  listing_id: string;
}

// ============================================================================
// Event types
// ============================================================================

export interface DomainEventOverview {
  event_id: string;
  aggregate_type: string;
  aggregate_id: string;
  transaction_id: string | null;
  event_type: string;
  emitted_at: string;
  emitted_by_role: string;
  correlation_id: string | null;
}

// ============================================================================
// API Error types
// ============================================================================

export interface ApiError {
  error?: {
    code?: string;
    message?: string;
    details?: unknown;
  };
  detail?: string | Array<{ msg?: string; loc?: unknown }>;
}
