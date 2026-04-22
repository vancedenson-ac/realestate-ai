/**
 * Upload file to presigned PUT URL (MinIO/S3).
 * Use for document and property image uploads after getting upload_url from API.
 */

export async function uploadFileToPresignedUrl(uploadUrl: string, file: File): Promise<void> {
  let res: Response;
  try {
    res = await fetch(uploadUrl, {
      method: "PUT",
      body: file,
      headers: {
        "Content-Type": file.type || "application/octet-stream",
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Network error";
    throw new Error(
      `Upload to storage failed: ${msg}. If using MinIO, ensure it is reachable at the upload URL and CORS allows PUT from this origin.`
    );
  }
  if (!res.ok) {
    throw new Error(`Upload to storage failed: ${res.status} ${res.statusText}`);
  }
}

/**
 * Compute SHA-256 hash of file for document/version checksum (hex string).
 */
export async function computeSha256Hex(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const hashBuffer = await crypto.subtle.digest("SHA-256", buffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
  return `sha256:${hashHex}`;
}
