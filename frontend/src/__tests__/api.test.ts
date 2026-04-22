import {
  buildApiUrl,
  getRlsHeaders,
  generateCorrelationId,
  ApiException,
  apiFetch,
  getApiErrorMessage,
} from "@/lib/api";
import type { SeedUser } from "@/types/api";

const mockUser: SeedUser = {
  user_id: "b0000001-0000-0000-0000-000000000001",
  email: "test@example.com",
  full_name: "Test User",
  organization_id: "a0000001-0000-0000-0000-000000000001",
  organization_name: "Test Org",
  role: "BUYER",
};

describe("buildApiUrl", () => {
  it("builds URL with path", () => {
    const url = buildApiUrl("/transactions");
    expect(url).toContain("/realtrust-ai/v1/transactions");
  });

  it("handles path without leading slash", () => {
    const url = buildApiUrl("transactions");
    expect(url).toContain("/realtrust-ai/v1/transactions");
  });

  it("adds query parameters", () => {
    const url = buildApiUrl("/transactions", { limit: 10, cursor: "abc123" });
    expect(url).toContain("limit=10");
    expect(url).toContain("cursor=abc123");
  });

  it("ignores undefined parameters", () => {
    const url = buildApiUrl("/transactions", { limit: 10, cursor: undefined });
    expect(url).toContain("limit=10");
    expect(url).not.toContain("cursor");
  });

  it("ignores empty string parameters", () => {
    const url = buildApiUrl("/transactions", { limit: 10, cursor: "" });
    expect(url).toContain("limit=10");
    expect(url).not.toContain("cursor");
  });

  it("builds listing detail path so proxy/rewrite can route to backend", () => {
    const listingId = "0f81dd39-47e3-4029-9c1f-6637652086b8";
    const url = buildApiUrl(`/listings/${listingId}`);
    expect(url).toContain("/realtrust-ai/v1");
    expect(url).toContain("/listings/");
    expect(url).toContain(listingId);
  });

  it("builds property detail path so proxy/rewrite can route to backend", () => {
    const propertyId = "d0000001-0000-0000-0000-000000000001";
    const url = buildApiUrl(`/properties/${propertyId}`);
    expect(url).toContain("/realtrust-ai/v1");
    expect(url).toContain("/properties/");
    expect(url).toContain(propertyId);
  });

  it("builds appraisal waivers list and waive paths for backend", () => {
    const tid = "c0000001-0000-0000-0000-000000000005";
    expect(buildApiUrl(`transactions/${tid}/appraisals/waivers`)).toContain("appraisals/waivers");
    expect(buildApiUrl(`transactions/${tid}/appraisals/waive`)).toContain("appraisals/waive");
  });
});

describe("generateCorrelationId", () => {
  it("returns a string", () => {
    expect(typeof generateCorrelationId()).toBe("string");
  });

  it("returns uuid-like format (8-4-4-4-12 hex)", () => {
    const id = generateCorrelationId();
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
  });
});

describe("getRlsHeaders", () => {
  it("returns correct headers for user", () => {
    const headers = getRlsHeaders(mockUser);

    expect(headers["X-User-Id"]).toBe(mockUser.user_id);
    expect(headers["X-Organization-Id"]).toBe(mockUser.organization_id);
    expect(headers["X-Role"]).toBe(mockUser.role);
    expect(headers["Content-Type"]).toBe("application/json");
    expect(headers["Accept"]).toBe("application/json");
  });

  it("includes X-Correlation-Id when provided (02 §13.2)", () => {
    const headers = getRlsHeaders(mockUser, "my-corr-123");
    expect(headers["X-Correlation-Id"]).toBe("my-corr-123");
  });

  it("omits X-Correlation-Id when not provided", () => {
    const headers = getRlsHeaders(mockUser);
    expect(headers["X-Correlation-Id"]).toBeUndefined();
  });
});

describe("ApiException", () => {
  it("extends Error with status and optional code/details", () => {
    const err = new ApiException("Not found", 404, "NOT_FOUND", { id: "x" });
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(ApiException);
    expect(err.message).toBe("Not found");
    expect(err.status).toBe(404);
    expect(err.code).toBe("NOT_FOUND");
    expect(err.details).toEqual({ id: "x" });
    expect(err.name).toBe("ApiException");
  });

  it("can be constructed without code or details", () => {
    const err = new ApiException("Server error", 500);
    expect(err.status).toBe(500);
    expect(err.code).toBeUndefined();
    expect(err.details).toBeUndefined();
  });
});

describe("getApiErrorMessage", () => {
  it("returns ApiException message when present", () => {
    const err = new ApiException("Only the listing agent or broker can add showing feedback.", 403, "FORBIDDEN_BY_POLICY");
    expect(getApiErrorMessage(err)).toBe("Only the listing agent or broker can add showing feedback.");
  });

  it("returns FORBIDDEN_BY_POLICY fallback when message empty", () => {
    const err = new ApiException("", 403, "FORBIDDEN_BY_POLICY");
    expect(getApiErrorMessage(err)).toBe("You don't have permission to perform this action.");
  });

  it("returns NOT_FOUND fallback when code NOT_FOUND and message empty", () => {
    const err = new ApiException("", 404, "NOT_FOUND");
    expect(getApiErrorMessage(err)).toBe("This item was not found or you don't have access.");
  });

  it("maps PRECONDITION_FAILED server messages to user-friendly text", () => {
    expect(
      getApiErrorMessage(
        new ApiException("Precondition failed: required documents missing or unsigned", 412, "PRECONDITION_FAILED")
      )
    ).toBe("Required documents are missing or not yet signed. Upload and sign the required documents for this step.");
    expect(
      getApiErrorMessage(
        new ApiException("Cannot enter FINANCING: appraisal not completed or waived", 412, "PRECONDITION_FAILED")
      )
    ).toBe("Complete the appraisal or waive it before moving to Financing.");
    expect(
      getApiErrorMessage(
        new ApiException("Cannot enter FINANCING: title not ordered", 412, "PRECONDITION_FAILED")
      )
    ).toBe("Place a title order before moving to Financing.");
    expect(
      getApiErrorMessage(
        new ApiException("Cannot close transaction: deed not recorded", 412, "PRECONDITION_FAILED")
      )
    ).toBe("Record the deed before closing the transaction.");
    const unknownPrecond = new ApiException("Some unknown precondition", 412, "PRECONDITION_FAILED");
    expect(getApiErrorMessage(unknownPrecond)).toBe("Some unknown precondition");
    const emptyPrecond = new ApiException("", 412, "PRECONDITION_FAILED");
    expect(getApiErrorMessage(emptyPrecond)).toBe("Requirements for this action are not met.");
  });

  it("returns custom fallback for unknown error", () => {
    expect(getApiErrorMessage(null, "Custom fallback")).toBe("Custom fallback");
    expect(getApiErrorMessage(undefined, "Try again")).toBe("Try again");
  });

  it("returns Error message for non-ApiException Error", () => {
    expect(getApiErrorMessage(new Error("Network error"))).toBe("Network error");
  });

  it("returns default fallback when no message", () => {
    expect(getApiErrorMessage(new ApiException("", 500))).toBe("Something went wrong. Please try again.");
  });
});

describe("apiFetch", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("returns JSON on 200", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      headers: new Headers({ "content-type": "application/json" }),
      json: () => Promise.resolve({ data: [] }),
    });
    const result = await apiFetch<{ data: unknown[] }>("/listings", { user: mockUser });
    expect(result).toEqual({ data: [] });
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining("/realtrust-ai/v1/listings"),
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({
          "X-User-Id": mockUser.user_id,
          "X-Organization-Id": mockUser.organization_id,
        }),
      })
    );
  });

  it("throws ApiException on non-ok response with JSON error", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 404,
      headers: new Headers({ "content-type": "application/json" }),
      json: () =>
        Promise.resolve({
          error: { code: "NOT_FOUND", message: "Listing not found" },
        }),
      text: () => Promise.resolve(""),
    });
    await expect(apiFetch("/listings/unknown", { user: mockUser })).rejects.toThrow(ApiException);
    await expect(apiFetch("/listings/unknown", { user: mockUser })).rejects.toMatchObject({
      status: 404,
      code: "NOT_FOUND",
      message: "Listing not found",
    });
  });

  it("throws ApiException on non-ok response with detail string", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 500,
      headers: new Headers({ "content-type": "text/plain" }),
      json: () => Promise.reject(new Error("not json")),
      text: () => Promise.resolve("Internal Server Error"),
    });
    await expect(apiFetch("/listings", { user: mockUser })).rejects.toThrow(ApiException);
    await expect(apiFetch("/listings", { user: mockUser })).rejects.toMatchObject({
      status: 500,
      message: "Internal Server Error",
    });
  });

  it("parses FastAPI-wrapped detail (detail.error.message) for toast-friendly message", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 404,
      headers: new Headers({ "content-type": "application/json" }),
      json: () =>
        Promise.resolve({
          detail: { error: { code: "NOT_FOUND", message: "Listing not found" } },
        }),
      text: () => Promise.resolve(""),
    });
    await expect(apiFetch("/listings/unknown", { user: mockUser })).rejects.toThrow(ApiException);
    await expect(apiFetch("/listings/unknown", { user: mockUser })).rejects.toMatchObject({
      status: 404,
      message: "Listing not found",
    });
  });

  it("parses FastAPI validation detail array (detail[0].msg) for toast-friendly message", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 422,
      headers: new Headers({ "content-type": "application/json" }),
      json: () =>
        Promise.resolve({
          detail: [{ loc: ["body", "list_price"], msg: "ensure this value is greater than 0", type: "value_error" }],
        }),
      text: () => Promise.resolve(""),
    });
    const caught = await apiFetch("/listings", { user: mockUser, method: "POST", body: {} }).catch((e) => e);
    expect(caught).toBeInstanceOf(ApiException);
    expect((caught as ApiException).message).toBe("ensure this value is greater than 0");
    expect(getApiErrorMessage(caught)).toBe("ensure this value is greater than 0");
  });

  it("sends POST body and method when provided", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      headers: new Headers({ "content-type": "application/json" }),
      json: () => Promise.resolve({ listing_id: "new-id" }),
    });
    await apiFetch("/listings", {
      user: mockUser,
      method: "POST",
      body: { property_id: "p1", list_price: 100000 },
    });
    expect(global.fetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ property_id: "p1", list_price: 100000 }),
      })
    );
  });

  it("includes query params when provided", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      headers: new Headers({ "content-type": "application/json" }),
      json: () => Promise.resolve({ data: [] }),
    });
    await apiFetch("/listings", {
      user: mockUser,
      params: { limit: 20, status_filter: "ACTIVE" },
    });
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringMatching(/\?.*limit=20.*status_filter=ACTIVE/),
      expect.any(Object)
    );
  });
});

describe("transactionsApi.create (new transaction UI)", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("POSTs to /transactions with organization_id, initial_state, optional property_id and listing_id", async () => {
    const { transactionsApi } = await import("@/lib/api");
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 201,
      headers: new Headers({ "content-type": "application/json" }),
      json: () =>
        Promise.resolve({
          transaction_id: "c0000001-0000-0000-0000-000000000099",
          organization_id: mockUser.organization_id,
          current_state: "PRE_LISTING",
          state_entered_at: "2025-01-01T00:00:00Z",
          property_id: "d0000001-0000-0000-0000-000000000001",
          listing_id: "e0000001-0000-0000-0000-000000000001",
          created_at: "2025-01-01T00:00:00Z",
          updated_at: "2025-01-01T00:00:00Z",
        }),
    });
    const result = await transactionsApi.create(mockUser, {
      organization_id: mockUser.organization_id,
      initial_state: "PRE_LISTING",
      initial_party_role: "SELLER_AGENT",
      property_id: "d0000001-0000-0000-0000-000000000001",
      listing_id: "e0000001-0000-0000-0000-000000000001",
    });
    expect(result.transaction_id).toBeDefined();
    expect(result.current_state).toBe("PRE_LISTING");
    expect(result.property_id).toBe("d0000001-0000-0000-0000-000000000001");
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining("/realtrust-ai/v1/transactions"),
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          organization_id: mockUser.organization_id,
          initial_state: "PRE_LISTING",
          initial_party_role: "SELLER_AGENT",
          property_id: "d0000001-0000-0000-0000-000000000001",
          listing_id: "e0000001-0000-0000-0000-000000000001",
        }),
        headers: expect.objectContaining({
          "X-User-Id": mockUser.user_id,
          "X-Organization-Id": mockUser.organization_id,
          "X-Role": mockUser.role,
        }),
      })
    );
  });
});

describe("propertiesApi.create (new property UI)", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("POSTs to /properties with required address fields and optional beds/baths/sqft/year", async () => {
    const { propertiesApi } = await import("@/lib/api");
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 201,
      headers: new Headers({ "content-type": "application/json" }),
      json: () =>
        Promise.resolve({
          property_id: "d0000001-0000-0000-0000-000000000099",
          status: "ACTIVE",
          address_line_1: "100 New St",
          address_line_2: null,
          city: "Seattle",
          state_province: "WA",
          postal_code: "98101",
          country: "US",
          property_type: "SINGLE_FAMILY",
          year_built: 2020,
          living_area_sqft: 2200,
          bedrooms: 3,
          bathrooms_full: 2,
          created_at: "2025-01-01T00:00:00Z",
          updated_at: "2025-01-01T00:00:00Z",
        }),
    });
    const result = await propertiesApi.create(mockUser, {
      address_line_1: "100 New St",
      city: "Seattle",
      state_province: "WA",
      postal_code: "98101",
      country: "US",
      property_type: "SINGLE_FAMILY",
      year_built: 2020,
      living_area_sqft: 2200,
      bedrooms: 3,
      bathrooms_full: 2,
    });
    expect(result.property_id).toBeDefined();
    expect(result.address_line_1).toBe("100 New St");
    expect(result.bedrooms).toBe(3);
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining("/realtrust-ai/v1/properties"),
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          address_line_1: "100 New St",
          city: "Seattle",
          state_province: "WA",
          postal_code: "98101",
          country: "US",
          property_type: "SINGLE_FAMILY",
          year_built: 2020,
          living_area_sqft: 2200,
          bedrooms: 3,
          bathrooms_full: 2,
        }),
        headers: expect.objectContaining({
          "X-User-Id": mockUser.user_id,
          "X-Organization-Id": mockUser.organization_id,
        }),
      })
    );
  });
});

describe("documentsApi (document upload / MinIO)", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("list uses path transactions/:id/documents", async () => {
    const { documentsApi } = await import("@/lib/api");
    const tid = "c0000001-0000-0000-0000-000000000001";
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      headers: new Headers({ "content-type": "application/json" }),
      json: () => Promise.resolve([]),
    });
    await documentsApi.list(mockUser, tid);
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining("/realtrust-ai/v1/transactions/" + tid + "/documents"),
      expect.any(Object)
    );
  });

  it("getUploadUrl POSTs to documents/:id/upload-url with optional filename/content_type", async () => {
    const { documentsApi } = await import("@/lib/api");
    const docId = "a1000001-0000-0000-0000-000000000001";
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      headers: new Headers({ "content-type": "application/json" }),
      json: () =>
        Promise.resolve({
          upload_url: "https://minio.example.com/presigned",
          storage_path: "documents/xxx/yyy/agreement.pdf",
          storage_bucket: "realtrust",
          expires_in_seconds: 3600,
        }),
    });
    const result = await documentsApi.getUploadUrl(mockUser, docId, {
      filename: "agreement.pdf",
      content_type: "application/pdf",
    });
    expect(result.upload_url).toContain("minio");
    expect(result.storage_path).toContain("documents/");
    expect(result.storage_bucket).toBe("realtrust");
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining("/realtrust-ai/v1/documents/" + docId + "/upload-url"),
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ filename: "agreement.pdf", content_type: "application/pdf" }),
      })
    );
  });
});

describe("propertiesApi.list and get include cover_image_url", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("list returns properties with cover_image_url", async () => {
    const { propertiesApi } = await import("@/lib/api");
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      headers: new Headers({ "content-type": "application/json" }),
      json: () =>
        Promise.resolve([
          {
            property_id: "d0000001-0000-0000-0000-000000000001",
            status: "ACTIVE",
            address_line_1: "100 Oak St",
            city: "Austin",
            state_province: "TX",
            postal_code: "78701",
            country: "US",
            property_type: "SINGLE_FAMILY",
            created_at: "2025-01-01T00:00:00Z",
            updated_at: "2025-01-01T00:00:00Z",
            cover_image_url: "https://minio.example.com/presigned/cover.jpg",
          },
        ]),
    });
    const list = await propertiesApi.list(mockUser, { limit: 10 });
    expect(list).toHaveLength(1);
    expect(list[0].cover_image_url).toBe("https://minio.example.com/presigned/cover.jpg");
  });

  it("listings list returns items with cover_image_url", async () => {
    const { listingsApi } = await import("@/lib/api");
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      headers: new Headers({ "content-type": "application/json" }),
      json: () =>
        Promise.resolve({
          data: [
            {
              listing_id: "e0000001-0000-0000-0000-000000000001",
              property_id: "d0000001-0000-0000-0000-000000000001",
              status: "ACTIVE",
              list_price: 500000,
              price_currency: "USD",
              listing_type: "FOR_SALE",
              days_on_market: 0,
              is_public: false,
              created_at: "2025-01-01T00:00:00Z",
              updated_at: "2025-01-01T00:00:00Z",
              cover_image_url: "https://minio.example.com/presigned/listing-cover.jpg",
              address_line_1: "123 Main St",
              city: "Austin",
              state_province: "TX",
              postal_code: "78701",
              country: "US",
            },
          ],
          meta: { limit: 20, cursor: null },
        }),
    });
    const res = await listingsApi.list(mockUser, { limit: 10 });
    expect(res.data).toHaveLength(1);
    expect(res.data[0].cover_image_url).toBe("https://minio.example.com/presigned/listing-cover.jpg");
    expect(res.data[0].address_line_1).toBe("123 Main St");
    expect(res.data[0].city).toBe("Austin");
    expect(res.data[0].state_province).toBe("TX");
    expect(res.data[0].postal_code).toBe("78701");
    expect(res.data[0].country).toBe("US");
  });
});

describe("propertiesApi.getImageUploadUrl and updateImage (property image upload / MinIO)", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("getImageUploadUrl POSTs to /properties/:id/images/upload", async () => {
    const { propertiesApi } = await import("@/lib/api");
    const propertyId = "d0000001-0000-0000-0000-000000000001";
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      headers: new Headers({ "content-type": "application/json" }),
      json: () =>
        Promise.resolve({
          upload_url: "https://minio.example.com/upload",
          image_id: "91000001-0000-0000-0000-000000000002",
          storage_path: "properties/xxx/images/yyy/photo.jpg",
          storage_bucket: "realtrust",
          expires_in_seconds: 3600,
        }),
    });
    const result = await propertiesApi.getImageUploadUrl(mockUser, propertyId, {
      filename: "photo.jpg",
      content_type: "image/jpeg",
    });
    expect(result.image_id).toBeDefined();
    expect(result.storage_path).toContain("properties/");
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining("/realtrust-ai/v1/properties/" + propertyId + "/images/upload"),
      expect.objectContaining({ method: "POST" })
    );
  });

  it("updateImage PATCHes /properties/:id/images/:imageId with file_size_bytes and checksum", async () => {
    const { propertiesApi } = await import("@/lib/api");
    const propertyId = "d0000001-0000-0000-0000-000000000001";
    const imageId = "91000001-0000-0000-0000-000000000002";
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      headers: new Headers({ "content-type": "application/json" }),
      json: () =>
        Promise.resolve({
          image_id: imageId,
          property_id: propertyId,
          storage_path: "properties/xxx/images/yyy/photo.jpg",
          thumbnail_path: null,
          is_primary: false,
          display_order: 0,
          caption: null,
          moderation_status: "PENDING",
        }),
    });
    await propertiesApi.updateImage(mockUser, propertyId, imageId, {
      file_size_bytes: 12345,
      checksum: "sha256:abc",
    });
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining("/realtrust-ai/v1/properties/" + propertyId + "/images/" + imageId),
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ file_size_bytes: 12345, checksum: "sha256:abc" }),
      })
    );
  });

  it("addFeedback throws ApiException with 403 FORBIDDEN_BY_POLICY; getApiErrorMessage shows server message", async () => {
    const { showingsApi } = await import("@/lib/api");
    const showingId = "f0000001-0000-0000-0000-000000000001";
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 403,
      headers: new Headers({ "content-type": "application/json" }),
      json: () =>
        Promise.resolve({
          error: {
            code: "FORBIDDEN_BY_POLICY",
            message: "Only the listing agent or broker can add showing feedback.",
            details: { showing_id: showingId },
          },
        }),
    });
    let caught: unknown;
    try {
      await showingsApi.addFeedback(mockUser, showingId, { rating: "NEUTRAL", notes: "looked good" });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(ApiException);
    expect((caught as ApiException).code).toBe("FORBIDDEN_BY_POLICY");
    expect(getApiErrorMessage(caught)).toBe("Only the listing agent or broker can add showing feedback.");
  });

  it("updateImage PATCHes with is_primary true (set as cover)", async () => {
    const { propertiesApi } = await import("@/lib/api");
    const propertyId = "d0000001-0000-0000-0000-000000000001";
    const imageId = "91000001-0000-0000-0000-000000000002";
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      headers: new Headers({ "content-type": "application/json" }),
      json: () =>
        Promise.resolve({
          image_id: imageId,
          property_id: propertyId,
          storage_path: "properties/xxx/images/yyy/photo.jpg",
          thumbnail_path: null,
          is_primary: true,
          display_order: 0,
          caption: null,
          moderation_status: "PENDING",
          view_url: "https://minio.example.com/presigned/photo.jpg",
        }),
    });
    const result = await propertiesApi.updateImage(mockUser, propertyId, imageId, {
      is_primary: true,
    });
    expect(result.is_primary).toBe(true);
    expect(result.view_url).toBeDefined();
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining("/realtrust-ai/v1/properties/" + propertyId + "/images/" + imageId),
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ is_primary: true }),
      })
    );
  });
});

describe("savedListingsApi (saved properties)", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("list GETs /users/me/saved-listings", async () => {
    const { savedListingsApi } = await import("@/lib/api");
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      headers: new Headers({ "content-type": "application/json" }),
      json: () =>
        Promise.resolve([
          {
            listing_id: "e0000001-0000-0000-0000-000000000001",
            property_id: "d0000001-0000-0000-0000-000000000001",
            address_line_1: "100 Oak St",
            city: "Austin",
            state_province: "TX",
            postal_code: "78701",
            list_price: 500000,
            listing_status: "ACTIVE",
            saved_at: "2025-01-01T00:00:00Z",
          },
        ]),
    });
    const result = await savedListingsApi.list(mockUser);
    expect(result).toHaveLength(1);
    expect(result[0].listing_id).toBe("e0000001-0000-0000-0000-000000000001");
    expect(result[0].address_line_1).toBe("100 Oak St");
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining("/realtrust-ai/v1/users/me/saved-listings"),
      expect.objectContaining({ method: "GET" })
    );
  });

  it("save POSTs /users/me/saved-listings with listing_id", async () => {
    const { savedListingsApi } = await import("@/lib/api");
    const listingId = "e0000001-0000-0000-0000-000000000002";
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 201,
      headers: new Headers({ "content-type": "application/json" }),
      json: () =>
        Promise.resolve({
          listing_id: listingId,
          property_id: "d0000001-0000-0000-0000-000000000002",
          address_line_1: "200 Elm St",
          city: "Austin",
          state_province: "TX",
          postal_code: "78702",
          list_price: 450000,
          listing_status: "ACTIVE",
          saved_at: "2025-01-01T12:00:00Z",
        }),
    });
    const result = await savedListingsApi.save(mockUser, { listing_id: listingId });
    expect(result.listing_id).toBe(listingId);
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining("/realtrust-ai/v1/users/me/saved-listings"),
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ listing_id: listingId }),
      })
    );
  });

  it("unsave DELETEs /users/me/saved-listings/:listingId", async () => {
    const { savedListingsApi } = await import("@/lib/api");
    const listingId = "e0000001-0000-0000-0000-000000000001";
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 204,
      headers: new Headers({}),
    });
    await savedListingsApi.unsave(mockUser, listingId);
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining("/realtrust-ai/v1/users/me/saved-listings/" + listingId),
      expect.objectContaining({ method: "DELETE" })
    );
  });
});

describe("eligibleEscrowOfficersApi (Phase B.5)", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("list GETs /users/me/eligible-escrow-officers and returns array", async () => {
    const { eligibleEscrowOfficersApi } = await import("@/lib/api");
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      headers: new Headers({ "content-type": "application/json" }),
      json: () =>
        Promise.resolve([
          { user_id: "b0000001-0000-0000-0000-000000000004", full_name: "Dave Escrow", email: "dave@escrow.com" },
          { user_id: "b0000001-0000-0000-0000-000000000011", full_name: null, email: "escrow2@seed.local" },
        ]),
    });
    const result = await eligibleEscrowOfficersApi.list(mockUser);
    expect(result).toHaveLength(2);
    expect(result[0].user_id).toBe("b0000001-0000-0000-0000-000000000004");
    expect(result[0].full_name).toBe("Dave Escrow");
    expect(result[0].email).toBe("dave@escrow.com");
    expect(result[1].full_name).toBeNull();
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining("/realtrust-ai/v1/users/me/eligible-escrow-officers"),
      expect.objectContaining({ method: "GET" })
    );
  });
});

describe("champagneMomentsApi (champagne moments)", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("list GETs /users/me/champagne-moments and returns array", async () => {
    const { champagneMomentsApi } = await import("@/lib/api");
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      headers: new Headers({ "content-type": "application/json" }),
      json: () =>
        Promise.resolve([
          {
            event_id: "e0000001-0000-0000-0000-000000000001",
            event_type: "TransactionClosed",
            emitted_at: "2025-02-05T12:00:00Z",
            transaction_id: "c0000001-0000-0000-0000-000000000008",
            property_address: "123 Palm Ave, Beverly Hills",
            amount: 1500000,
            title: "Champagne Moment!",
            message: "Escrow Closed: 123 Palm Ave, Beverly Hills - $1.5M - Congratulations!",
          },
        ]),
    });
    const result = await champagneMomentsApi.list(mockUser);
    expect(result).toHaveLength(1);
    expect(result[0].event_id).toBe("e0000001-0000-0000-0000-000000000001");
    expect(result[0].event_type).toBe("TransactionClosed");
    expect(result[0].transaction_id).toBe("c0000001-0000-0000-0000-000000000008");
    expect(result[0].title).toBe("Champagne Moment!");
    expect(result[0].message).toContain("Escrow Closed");
    expect(result[0].property_address).toBe("123 Palm Ave, Beverly Hills");
    expect(result[0].amount).toBe(1500000);
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining("/realtrust-ai/v1/users/me/champagne-moments"),
      expect.objectContaining({ method: "GET" })
    );
  });

  it("list accepts optional limit param", async () => {
    const { champagneMomentsApi } = await import("@/lib/api");
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      headers: new Headers({ "content-type": "application/json" }),
      json: () => Promise.resolve([]),
    });
    await champagneMomentsApi.list(mockUser, { limit: 10 });
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining("/users/me/champagne-moments"),
      expect.any(Object)
    );
    const url = (global.fetch as jest.Mock).mock.calls[0][0];
    expect(url).toContain("limit=10");
  });
});

describe("showingsApi (showings and showing feedback)", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("schedule can send showing_type OPEN_HOUSE", async () => {
    const { showingsApi } = await import("@/lib/api");
    const listingId = "e0000001-0000-0000-0000-000000000001";
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 201,
      headers: new Headers({ "content-type": "application/json" }),
      json: () =>
        Promise.resolve({
          showing_id: "f0000001-0000-0000-0000-000000000001",
          listing_id: listingId,
          scheduled_start_at: "2030-02-01T14:00:00Z",
          scheduled_end_at: "2030-02-01T16:00:00Z",
          status: "SCHEDULED",
          showing_type: "OPEN_HOUSE",
          requested_by_user_id: null,
          created_by_user_id: mockUser.user_id,
          notes: "Open house",
          created_at: "2025-01-01T00:00:00Z",
          updated_at: "2025-01-01T00:00:00Z",
        }),
    });
    const result = await showingsApi.schedule(mockUser, listingId, {
      scheduled_start_at: "2030-02-01T14:00:00Z",
      scheduled_end_at: "2030-02-01T16:00:00Z",
      showing_type: "OPEN_HOUSE",
      notes: "Open house",
    });
    expect(result.showing_type).toBe("OPEN_HOUSE");
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining("/realtrust-ai/v1/listings/" + listingId + "/showings"),
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          scheduled_start_at: "2030-02-01T14:00:00Z",
          scheduled_end_at: "2030-02-01T16:00:00Z",
          showing_type: "OPEN_HOUSE",
          notes: "Open house",
        }),
      })
    );
  });

  it("listFeedback GETs showings/:showingId/feedback", async () => {
    const { showingsApi } = await import("@/lib/api");
    const showingId = "f0000001-0000-0000-0000-000000000001";
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      headers: new Headers({ "content-type": "application/json" }),
      json: () => Promise.resolve([]),
    });
    await showingsApi.listFeedback(mockUser, showingId);
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining("/realtrust-ai/v1/showings/" + showingId + "/feedback"),
      expect.objectContaining({ method: "GET" })
    );
  });

  it("addFeedback POSTs showings/:showingId/feedback with rating and notes", async () => {
    const { showingsApi } = await import("@/lib/api");
    const showingId = "f0000001-0000-0000-0000-000000000001";
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 201,
      headers: new Headers({ "content-type": "application/json" }),
      json: () =>
        Promise.resolve({
          feedback_id: "fb000001-0000-0000-0000-000000000001",
          listing_id: "e0000001-0000-0000-0000-000000000001",
          showing_id: showingId,
          from_user_id: mockUser.user_id,
          rating: "POSITIVE",
          notes: "Buyer interested.",
          created_at: "2025-01-01T00:00:00Z",
        }),
    });
    const result = await showingsApi.addFeedback(mockUser, showingId, {
      rating: "POSITIVE",
      notes: "Buyer interested.",
    });
    expect(result.rating).toBe("POSITIVE");
    expect(result.notes).toBe("Buyer interested.");
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining("/realtrust-ai/v1/showings/" + showingId + "/feedback"),
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ rating: "POSITIVE", notes: "Buyer interested." }),
      })
    );
  });
});

describe("DocumentType includes pre_qualification_letter", () => {
  it("api types allow pre_qualification_letter as document type", async () => {
    const { documentsApi } = await import("@/lib/api");
    const docType: import("@/types/api").DocumentType = "pre_qualification_letter";
    expect(docType).toBe("pre_qualification_letter");
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 201,
      headers: new Headers({ "content-type": "application/json" }),
      json: () =>
        Promise.resolve({
          document_id: "a1000001-0000-0000-0000-000000000099",
          transaction_id: "c0000001-0000-0000-0000-000000000002",
          document_type: "pre_qualification_letter",
          execution_status: "draft",
          created_at: "2025-01-01T00:00:00Z",
          updated_at: "2025-01-01T00:00:00Z",
        }),
    });
    const result = await documentsApi.create(mockUser, "c0000001-0000-0000-0000-000000000002", {
      document_type: "pre_qualification_letter",
    });
    expect(result.document_type).toBe("pre_qualification_letter");
  });
});

describe("listingsApi.mapSearch (map view)", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("POSTs to /listings/map-search with bounds, zoom, and filters", async () => {
    const { listingsApi } = await import("@/lib/api");
    const mockResponse = {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          geometry: { type: "Point", coordinates: [-97.7431, 30.2672] },
          properties: {
            listing_id: "e0000001-0000-0000-0000-000000000001",
            property_id: "d0000001-0000-0000-0000-000000000001",
            list_price: 550000,
            price_short: "$550K",
            listing_type: "FOR_SALE",
            status: "ACTIVE",
            address_line_1: "123 Oak St",
            city: "Austin",
            state_province: "TX",
            postal_code: "78701",
            bedrooms: 4,
            bathrooms_full: 3,
            living_area_sqft: 2200,
            property_type: "SINGLE_FAMILY",
            days_on_market: 5,
          },
        },
      ],
      meta: { total_in_bounds: 1, clustered: false, zoom: 14 },
    };
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      headers: new Headers({ "content-type": "application/json" }),
      json: () => Promise.resolve(mockResponse),
    });
    const result = await listingsApi.mapSearch(mockUser, {
      bounds: { sw_lat: 30.20, sw_lng: -97.80, ne_lat: 30.45, ne_lng: -97.70 },
      zoom: 14,
      filters: { status_filter: "ACTIVE", price_min: 400000 },
    });
    expect(result.type).toBe("FeatureCollection");
    expect(result.features).toHaveLength(1);
    expect(result.features[0].properties.listing_id).toBe("e0000001-0000-0000-0000-000000000001");
    expect(result.features[0].properties.price_short).toBe("$550K");
    expect(result.meta.total_in_bounds).toBe(1);
    expect(result.meta.clustered).toBe(false);
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining("/realtrust-ai/v1/listings/map-search"),
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          bounds: { sw_lat: 30.20, sw_lng: -97.80, ne_lat: 30.45, ne_lng: -97.70 },
          zoom: 14,
          filters: { status_filter: "ACTIVE", price_min: 400000 },
        }),
        headers: expect.objectContaining({
          "X-User-Id": mockUser.user_id,
          "X-Organization-Id": mockUser.organization_id,
          "X-Role": mockUser.role,
        }),
      })
    );
  });

  it("returns clustered response at low zoom", async () => {
    const { listingsApi } = await import("@/lib/api");
    const mockResponse = {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          geometry: { type: "Point", coordinates: [-97.74, 30.30] },
          properties: { cluster: true, point_count: 8, avg_price: 550000, min_price: 285000, max_price: 1200000, price_short: "$550K" },
        },
      ],
      meta: { total_in_bounds: 8, clustered: true, zoom: 5 },
    };
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      headers: new Headers({ "content-type": "application/json" }),
      json: () => Promise.resolve(mockResponse),
    });
    const result = await listingsApi.mapSearch(mockUser, {
      bounds: { sw_lat: 25, sw_lng: -100, ne_lat: 35, ne_lng: -90 },
      zoom: 5,
    });
    expect(result.meta.clustered).toBe(true);
    expect(result.meta.total_in_bounds).toBe(8);
    expect(result.features[0].properties.cluster).toBe(true);
    expect(result.features[0].properties.point_count).toBe(8);
  });

  it("returns empty features for out-of-bounds area", async () => {
    const { listingsApi } = await import("@/lib/api");
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      headers: new Headers({ "content-type": "application/json" }),
      json: () =>
        Promise.resolve({
          type: "FeatureCollection",
          features: [],
          meta: { total_in_bounds: 0, clustered: false, zoom: 12 },
        }),
    });
    const result = await listingsApi.mapSearch(mockUser, {
      bounds: { sw_lat: 10, sw_lng: -160, ne_lat: 11, ne_lng: -159 },
      zoom: 12,
    });
    expect(result.features).toHaveLength(0);
    expect(result.meta.total_in_bounds).toBe(0);
  });
});
