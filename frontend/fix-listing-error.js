const fs = require("fs");
const p = "src/app/listings/[id]/page.tsx";
let s = fs.readFileSync(p, "utf8");
const old = `  if (error) {
    return (
      <div className="space-y-6">
        <Button variant="ghost" asChild>
          <Link href="/listings" className="flex items-center gap-2">
            <ArrowLeft className="h-4 w-4" />
            Back to Listings
          </Link>
        </Button>
        <ErrorMessage
          message={
            isNotFound
              ? "Listing not found or you don't have access. Listings are visible if they're public or you're the listing agent/broker (RBAC)."
              : error instanceof Error ? error.message : "Failed to load listing"
          }
          onRetry={refetch}
        />
      </div>
    );
  }`;
const neu = `  if (error) {
    return (
      <div className="space-y-6">
        <Button variant="ghost" asChild>
          <Link href="/listings" className="flex items-center gap-2">
            <ArrowLeft className="h-4 w-4" />
            Back to Listings
          </Link>
        </Button>
        <Button variant="outline" onClick={() => refetch()}>
          Retry
        </Button>
      </div>
    );
  }`;
if (s.includes("isNotFound")) {
  s = s.replace(
    /  if \(error\) \{\s*return \(\s*<div className="space-y-6">\s*<Button variant="ghost" asChild>[\s\S]*?<ErrorMessage[\s\S]*?\/>\s*<\/div>\s*\);\s*\}/,
    neu
  );
  fs.writeFileSync(p, s);
  console.log("Replaced");
} else {
  console.log("No isNotFound found");
}
