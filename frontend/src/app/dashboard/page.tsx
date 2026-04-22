import { redirect } from "next/navigation";

/**
 * Dashboard is the root page (/). Redirect /dashboard -> / so links and
 * bookmarks to /dashboard work and don't 404.
 */
export default function DashboardRedirectPage() {
  redirect("/");
}
