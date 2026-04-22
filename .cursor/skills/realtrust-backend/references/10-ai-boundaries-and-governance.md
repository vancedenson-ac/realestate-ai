# realtrust ai — AI Boundaries, Governance, and Traceability (Backend-Only)

This document defines how AI is used in realtrust ai without violating:

- transactional legality (state machine “law”)
- access boundaries (RLS / explicit denies)
- audit survivability

AI is treated as a **bounded, advisory subsystem**.

---

## 1. Non-negotiable AI constraints

AI MUST be advisory and non-authoritative.

AI MUST NOT:

- change transaction state
- sign, lock, or mutate authoritative documents
- disburse or approve funds
- message users autonomously as an authority-bearing actor
- bypass authorization or RLS policies
- create “facts” that are stored as truth

AI MAY:

- summarize documents/events within authorized scope
- flag risk or anomalies
- recommend next legal actions
- draft communications or checklists as non-authoritative artifacts

---

## 2. AI “inputs” are constrained by data-layer visibility

### 2.1 Data minimization and least privilege

AI workers MUST only read from:

- RLS-protected base tables, and/or
- RLS-protected views designed specifically for AI input

AI MUST NOT be given privileged data access as a shortcut.

### 2.3 Multi-tenant isolation (MUST)

The platform is treated as **multi-tenant SaaS** by default. Therefore:

- AI tasks/insights/embeddings/snapshots MUST be scoped by `organization_id`.
- AI retrieval queries MUST enforce tenant isolation by including `organization_id` constraints and running under an RLS session context that includes `app.organization_id`.
- AI MUST NOT aggregate, embed, or train across organizations unless there is an explicit, documented, and approved cross-tenant data-sharing program (out of scope by default).

### 2.2 No side channels

AI inputs MUST NOT include:

- unfiltered domain_events payloads containing restricted data
- full-text of confidential documents outside scope
- raw database dumps

Instead, AI inputs should be:

- transaction-scoped, role-scoped, redacted views
- stable references + minimal payload snapshots that are policy-allowed

---

## 3. AI tasks and outputs (data model requirements)

AI MUST have an explicit task model.

### 3.1 AI_Task (orchestrated work item)

Required fields:

- task_id
- task_type
- transaction_id (or target entity reference)
- organization_id (tenant boundary)
- triggering_event_id
- status (queued/running/succeeded/failed/cancelled)
- created_at, started_at, completed_at
- error details (if failed)

### 3.2 AI_Insight (advisory output)

Required fields:

- insight_id
- insight_type (summary, anomaly, recommendation, checklist, deadline risk, etc.)
- transaction_id/target reference
- organization_id (tenant boundary)
- visibility_scope (who is allowed to read it)
- content (structured + text)
- confidence/quality metadata
- approval state (draft/approved/rejected) where required

AI outputs MUST be explicitly labeled as advisory in downstream views/APIs.

---

## 4. Provenance and traceability (audit requirement)

Each AI output MUST store enough information to answer:

- what triggered this output?
- what model was used?
- what prompt was used?
- what data was provided as input?
- who approved it (if required)?

### 4.1 Required provenance fields

- model_id and model_version
- prompt_template_id and prompt_template_version
- prompt_hash (stable hash of final prompt)
- input_snapshot_reference (see below)
- created_at
- triggering_event_id
- correlation_id (from request/event chain; for audit + tracing)
- trace_context (W3C `traceparent`/`tracestate`, stored as metadata where appropriate)

### 4.2 Input snapshots (replayability vs privacy)

The platform MUST balance replayability with privacy:

- store stable references to input facts (event ids, document ids, version ids)
- store minimal, policy-allowed snapshots where needed
- avoid storing large raw restricted text unless explicitly permitted and justified

If an input snapshot is stored:

- it MUST be RLS-protected
- it MUST carry classification and visibility_scope
- it MUST include `organization_id`
- it MUST be integrity-hashed

### 4.3 Observability (MUST)

AI workers and the LLM client MUST participate in the platform’s observability standard:

- OpenTelemetry for traces (and SHOULD for metrics)
- propagate `X-Correlation-Id` into:
  - AI tasks
  - AI insights
  - audit events (where applicable)
  - domain events (where applicable)

---

## 5. Human approval gates (policy-driven)

Some AI outputs may require human approval before being surfaced or acted upon.

The system SHOULD support:

- per insight_type approval requirements
- jurisdiction-specific approval rules
- approval audit trails

Approvals MUST:

- be captured as authoritative human actions (audited)
- emit an event such as `AI_InsightApproved` for downstream consumers

---

## 6. “Next legal actions” guidance (must be law-consistent)

AI may recommend next actions, but MUST only recommend actions that are legal given:

- current transaction state
- required documents and preconditions
- cross-domain invariants

Implementation requirement:

- the legal transition set MUST be computed from the canonical state machine spec and DB state.
- AI MUST be guided by a structured representation of “legal next moves,” not free-form assumptions.

---

## 7. Prompt and model governance (policy-as-code for AI)

### 7.1 Prompt template registry

The platform MUST version prompt templates:

- prompt_template_id
- version
- intended use / insight_type
- required input schema
- output schema contract
- allowed visibility scopes
- approval requirement flag

### 7.2 Model registry

The platform SHOULD maintain an allowlist of approved models:

- model_id
- version
- vendor/source
- capability notes and limitations
- risk review status

### 7.3 Change control

Changes to:

- prompt templates
- model allowlist
- AI task definitions

SHOULD be treated as policy changes with:

- versioning
- approvals (org-specific)
- audit logging

### 7.4 LLM provider abstraction

The platform MUST abstract LLM providers to allow:

- Provider switching without code changes
- Cost optimization across models
- Compliance with data residency requirements

**Supported Initial Providers**:

| Provider | Models | Use Case |
|----------|--------|----------|
| OpenAI | gpt-4-turbo, gpt-4o | Complex reasoning, document summaries |
| OpenAI | text-embedding-3-small | Document and query embeddings |
| Anthropic | claude-3-opus, claude-3-sonnet | Alternative reasoning, comparison |

**LLM Client Requirements**:

All LLM calls MUST:

- Use the centralized LLMClient abstraction
- Record provider, model, and version in provenance
- Respect rate limits and implement retry logic
- Compute and store prompt_hash for audit trails
- Propagate correlation and trace context (OTel) so AI work is attributable end-to-end

**Implementation Pattern**:

```python
class LLMClient:
    """Unified LLM client with provenance tracking."""
    
    async def generate(
        self,
        prompt_template_id: str,
        variables: dict,
        model: str = "gpt-4-turbo-preview"
    ) -> LLMResponse:
        # 1. Load prompt template from registry
        # 2. Render prompt with variables
        # 3. Compute prompt_hash (SHA-256)
        # 4. Call LLM via LiteLLM abstraction
        # 5. Return response with full provenance
```

### 7.5 RAG pipeline architecture

The platform MUST implement Retrieval-Augmented Generation (RAG) for document Q&A.

**Pipeline Overview**:

```
Document Upload → Text Extraction → Chunking → Embedding → pgvector Storage
                                                               │
User Query → Query Embedding → Similarity Search → Context Assembly → LLM
```

**RAG Requirements**:

1. **Chunking Strategy**:
   - Chunk size: 1000 tokens
   - Overlap: 200 tokens
   - Separator priority: Paragraph > Sentence > Token

2. **Embedding Storage**:
   - Vector dimension: 1536 (OpenAI text-embedding-3-small)
   - Index: HNSW via pgvector
   - Visibility: Inherited from source document via RLS

3. **Retrieval with RLS Enforcement**:
   - Similarity searches MUST run under RLS context
   - Embeddings from unauthorized documents MUST be invisible
   - Top-k retrieval: Default 5 chunks
   - Retrieval MUST also enforce `organization_id` (tenant boundary)

**RAG Implementation Pattern**:

```python
class RAGPipeline:
    """Retrieval-Augmented Generation with RLS enforcement."""
    
    async def retrieve_context(
        self,
        query: str,
        transaction_id: UUID,
        user_context: UserContext,
        top_k: int = 5
    ) -> list[RetrievedChunk]:
        """
        Retrieve relevant chunks with RLS enforcement.
        
        The similarity search runs under RLS context so that
        embeddings from unauthorized documents are invisible.
        """
        query_embedding = await self.embed(query)
        
        # RLS context already set on session
        results = await self.db.execute(
            text("""
                SELECT e.entity_id, e.entity_type,
                       1 - (e.embedding <=> :query_vec) as similarity
                FROM ai_embeddings e
                JOIN documents d ON d.document_id = e.entity_id 
                    AND e.entity_type = 'document'
                WHERE d.transaction_id = :tx_id
                ORDER BY e.embedding <=> :query_vec
                LIMIT :k
            """),
            {"query_vec": query_embedding, "tx_id": transaction_id, "k": top_k}
        )
        return [...]
```

### 7.6 AI task orchestration

**Task Types and Triggers**:

| Task Type | Triggering Event | Output |
|-----------|------------------|--------|
| `DOCUMENT_SUMMARY` | `DocumentProcessed` | AI_Insight (summary) |
| `INSPECTION_ANALYSIS` | `InspectionReportSubmitted` | AI_Insight (risk flags) |
| `DEADLINE_RISK` | Daily cron + state changes | AI_Insight (deadline warnings) |
| `NEXT_ACTIONS` | State transition events | AI_Insight (recommendations) |
| `COMPLIANCE_CHECK` | `EscrowOpened` | AI_Insight (jurisdiction checklist) |
| `DOCUMENT_QA` | User query | AI_Insight (RAG response) |
| `IMAGE_CLASSIFY` | `PropertyImageUploaded` | PropertyImage metadata update |
| `IMAGE_EMBED` | `PropertyImageProcessed` | AI_Embedding (image vector) |
| `LISTING_EMBED` | `ListingCreated/Updated` | AI_Embedding (listing vector) |
| `PREFERENCE_EMBED` | `PreferenceCreated/Updated` | AI_Embedding (preference vector) |
| `COMPUTE_MATCHES` | `ListingCreated` + daily batch | PropertyMatch records |
| `EXPLAIN_MATCH` | User views match | AI_Insight (match explanation) |
| `IMAGE_OCR` | Floor plan detected | PropertyImage.ocr_text update |

**Orchestration Rules**:

- AI tasks MUST be triggered by events, not user intent directly
- Failed tasks MUST retry with exponential backoff
- Tasks exceeding max retries MUST be moved to dead-letter queue
- Task status updates MUST be atomic with result storage

---

## 8. Image processing pipeline

The platform MUST support AI-powered image processing for property images.

### 8.1 Image classification

When a property image is uploaded, the system MUST:

1. Validate image format and size
2. Extract EXIF metadata
3. Generate image variants (thumbnail, medium, large, webp)
4. Classify image type and room type using vision AI
5. Generate AI tags and description
6. Generate image embedding for similarity search

**Classification Model**:

| Classification | Values |
|----------------|--------|
| image_type | EXTERIOR, INTERIOR, FLOOR_PLAN, AERIAL, NEIGHBORHOOD, OTHER |
| room_type | LIVING_ROOM, KITCHEN, BEDROOM, BATHROOM, GARAGE, YARD, POOL, OTHER |
| ai_tags | ["modern", "hardwood", "granite", "stainless", "open_concept", ...] |

### 8.2 Floor plan OCR

When a floor plan is detected (image_type = FLOOR_PLAN):

1. Queue for OCR processing
2. Extract text and dimensions using Tesseract
3. Parse room layouts and square footage
4. Store extracted text in `ocr_text` field

### 8.3 Image similarity search

Property images are embedded for similarity search:

```python
async def find_similar_properties(
    query_image_embedding: list[float],
    limit: int = 10
) -> list[PropertyMatch]:
    """Find properties with visually similar images."""
    results = await db.execute(
        text("""
            SELECT DISTINCT ON (pi.property_id)
                pi.property_id,
                1 - (ae.embedding <=> :query_vec) as similarity
            FROM property_images pi
            JOIN ai_embeddings ae ON ae.entity_id = pi.image_id
                AND ae.entity_type = 'property_image'
            WHERE ae.embedding <=> :query_vec < 0.3
            ORDER BY pi.property_id, similarity DESC
            LIMIT :limit
        """),
        {"query_vec": query_image_embedding, "limit": limit}
    )
    return results
```

---

## 9. Property matching pipeline

The platform MUST implement AI-powered property matching for buyers.

### 9.1 Matching algorithm

The hybrid matching approach:

1. **Hard filters**: Eliminate properties outside must-have criteria
2. **Feature scoring** (25%): Weighted scoring for property attributes
3. **Semantic similarity** (30%): pgvector cosine similarity between preference and listing embeddings
4. **Price scoring** (25%): Distance from ideal price range
5. **Location scoring** (20%): Distance from preferred locations or commute destination

**Match Score Calculation**:

```python
def calculate_match_score(
    property: Property,
    listing: Listing,
    preference: BuyerPreference
) -> Optional[float]:
    """Calculate match score (0.0 to 1.0)."""
    
    # Hard filter check
    if not passes_hard_filters(property, listing, preference):
        return None
    
    # Component scores (each 0.0 to 1.0)
    price_score = calculate_price_score(listing.list_price, preference)
    feature_score = calculate_feature_score(property, preference)
    location_score = calculate_location_score(property, preference)
    
    # Semantic similarity (if embeddings exist)
    semantic_score = 0.0
    if preference.preference_embedding_id and listing.embedding_id:
        semantic_score = cosine_similarity(
            preference.embedding,
            listing.embedding
        )
    
    # Weighted combination
    total = (
        price_score * 0.25 +
        feature_score * 0.25 +
        semantic_score * 0.30 +
        location_score * 0.20
    )
    
    return total
```

### 9.2 Match explanation generation

When a user views a match, generate a natural language explanation:

```python
async def generate_match_explanation(
    match: PropertyMatch,
    preference: BuyerPreference,
    listing: Listing
) -> str:
    """Generate AI explanation for why this property matches."""
    
    prompt = f"""
    Explain why this property matches the buyer's preferences.
    
    Buyer preferences:
    - Location: {preference.preferred_cities}
    - Price range: ${preference.price_min} - ${preference.price_max}
    - Bedrooms: {preference.bedrooms_min}+
    - Must-haves: {preference.must_haves}
    - Lifestyle: {preference.lifestyle_description}
    
    Property:
    - Address: {listing.property.address}
    - Price: ${listing.list_price}
    - Bedrooms: {listing.property.bedrooms}
    - Features: {listing.highlights}
    
    Score breakdown:
    - Price match: {match.score_breakdown['price']:.0%}
    - Feature match: {match.score_breakdown['features']:.0%}
    - Semantic match: {match.score_breakdown['semantic']:.0%}
    - Location match: {match.score_breakdown['location']:.0%}
    
    Write a 2-3 sentence explanation focusing on the strongest matches.
    """
    
    response = await llm_client.generate(
        prompt_template_id="match_explanation",
        variables={"prompt": prompt}
    )
    
    return response.content
```

### 9.3 Match notification triggers

Matches above threshold trigger notifications:

| Threshold | Notification |
|-----------|--------------|
| score >= 0.9 | Instant notification (if preference.notification_frequency = INSTANT) |
| score >= 0.7 | Include in daily/weekly digest |
| score < 0.7 | Store but don't notify |

---

## 10. Security boundaries
### 10.1 AI as a service identity

SYSTEM_AI MUST use a service identity with least privilege:

- read-only access to allowed AI input views
- write access only to AI task/output tables

SYSTEM_AI MUST NOT have write permissions to authoritative domain tables.

### 10.2 Data leakage prevention by construction

Primary strategy:

- AI never receives forbidden data because RLS filters it out.

Secondary strategies:

- redaction policies for sensitive fields
- classification-aware view shaping
- avoidance of embedding raw restricted documents unless necessary

### 10.3 Safe AI retrieval pattern (MUST)

To avoid “SYSTEM_AI becomes a superuser” while still enabling AI workflows, AI retrieval MUST use one of these safe patterns:

1. **AI input views**: create RLS-protected “AI input” views that expose only policy-safe fields, and permit SYSTEM_AI to read only the rows needed for an existing `ai_task_id` (task-scoped access).
2. **Audience-scoped computation**: generate AI insights separately per audience scope (e.g., buyer-side vs seller-side), and only use inputs that would be visible to that audience.

The system MUST NOT implement broad “impersonation” of end users by reusing their identities for AI tasks.

---

## 11. Acceptance criteria

AI governance is correctly implemented if:

- AI cannot mutate authoritative state even with compromised credentials
- AI cannot access forbidden data due to RLS + explicit denies
- AI cannot cross tenant boundaries (organization isolation holds)
- every AI output has traceable provenance (model, prompt, inputs, trigger)
- AI recommendations cannot contradict the legal transition set computed from authoritative state

