import { computeSha256Hex, uploadFileToPresignedUrl } from "@/lib/upload";

describe("computeSha256Hex", () => {
  it.skip("returns sha256: prefixed hex string (uses crypto.subtle; run in browser)", async () => {
    const file = new File(["hello"], "test.txt", { type: "text/plain" });
    const hash = await computeSha256Hex(file);
    expect(hash).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it.skip("is deterministic for same content (uses crypto.subtle; run in browser)", async () => {
    const file1 = new File(["same content"], "a.txt");
    const file2 = new File(["same content"], "b.txt");
    const a = await computeSha256Hex(file1);
    const b = await computeSha256Hex(file2);
    expect(a).toBe(b);
  });
});

describe("uploadFileToPresignedUrl", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("PUTs file to URL with Content-Type from file", async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true });
    const file = new File(["content"], "doc.pdf", { type: "application/pdf" });
    await uploadFileToPresignedUrl("https://minio.example.com/upload?token=xyz", file);
    expect(global.fetch).toHaveBeenCalledWith(
      "https://minio.example.com/upload?token=xyz",
      expect.objectContaining({
        method: "PUT",
        body: file,
        headers: { "Content-Type": "application/pdf" },
      })
    );
  });

  it("throws on non-ok response", async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 403, statusText: "Forbidden" });
    const file = new File(["x"], "x.pdf");
    await expect(uploadFileToPresignedUrl("https://example.com/up", file)).rejects.toThrow(
      /Upload to storage failed: 403/
    );
  });
});
