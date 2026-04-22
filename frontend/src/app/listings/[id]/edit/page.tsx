"use client";

import { use, useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/context/auth-context";
import { useListing, useUpdateListing } from "@/hooks/use-listings";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LoadingSpinner } from "@/components/loading-spinner";
import { ArrowLeft } from "lucide-react";
import type { ListingUpdate as ListingUpdateType } from "@/types/api";
import { toastError } from "@/lib/toast";
import { canUpdateListing } from "@/lib/permissions";

export default function EditListingPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();
  const { user, isHydrated } = useAuth();
  const { data: listing, isLoading, error, refetch } = useListing(id);
  const updateMutation = useUpdateListing(id);
  const [description, setDescription] = useState("");
  const [listPrice, setListPrice] = useState<number>(0);
  const [isPublic, setIsPublic] = useState(false);
  const [nextOpenHouseAt, setNextOpenHouseAt] = useState<string>("");
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    if (listing && !initialized) {
      setDescription(listing.description ?? "");
      setListPrice(listing.list_price ?? 0);
      setIsPublic(listing.is_public ?? false);
      if (listing.next_open_house_at) {
        try {
          const d = new Date(listing.next_open_house_at);
          setNextOpenHouseAt(d.toISOString().slice(0, 16));
        } catch {
          setNextOpenHouseAt("");
        }
      } else {
        setNextOpenHouseAt("");
      }
      setInitialized(true);
    }
  }, [listing, initialized]);

  useEffect(() => {
    if (error) toastError(error, "Failed to load listing");
  }, [error]);

  if (!isHydrated) {
    return (
      <div className="flex h-full items-center justify-center">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  if (!canUpdateListing(user.role)) {
    router.replace("/listings");
    return null;
  }

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  if (error) {
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
  }

  if (!listing) {
    return null;
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const price = Number(listPrice);
    if (price <= 0) {
      toastError(new Error("Enter a valid list price."));
      return;
    }
    const payload: ListingUpdateType = {
      list_price: price,
      description: description.trim() || undefined,
      is_public: isPublic,
      next_open_house_at: nextOpenHouseAt.trim() ? new Date(nextOpenHouseAt).toISOString() : null,
    };
    updateMutation.mutate(payload, {
      onSuccess: () => {
        router.push(`/listings/${id}`);
      },
      onError: (err) => toastError(err, "Failed to update listing"),
    });
  };

  return (
    <div className="space-y-6">
      <div>
        <Link
          href={`/listings/${id}`}
          className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to Listing
        </Link>
        <h1 className="mt-2 text-3xl font-bold tracking-tight">Edit Listing</h1>
        <p className="text-muted-foreground">
          Update description, price, and visibility. Publish or unpublish from the listing detail page.
        </p>
      </div>

      <form onSubmit={handleSubmit}>
        <Card>
          <CardHeader>
            <CardTitle>Listing details</CardTitle>
            <CardDescription>
              Change the fields below and save. Property and listing type cannot be changed here.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-2">
              <Label htmlFor="list_price">List price *</Label>
              <Input
                id="list_price"
                type="number"
                min={1}
                step={1}
                value={listPrice || ""}
                onChange={(e) =>
                  setListPrice(e.target.value === "" ? 0 : Number(e.target.value))
                }
                placeholder="e.g. 200000 or 500000"
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="description">Description (optional)</Label>
              <textarea
                id="description"
                rows={4}
                className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Spacious family home..."
              />
            </div>

            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="is_public"
                checked={isPublic}
                onChange={(e) => setIsPublic(e.target.checked)}
                className="h-4 w-4 rounded border-input"
              />
              <Label htmlFor="is_public" className="font-normal cursor-pointer">
                Public (visible to buyers)
              </Label>
            </div>

            <div className="space-y-2">
              <Label htmlFor="next_open_house_at">Next open house (optional)</Label>
              <Input
                id="next_open_house_at"
                type="datetime-local"
                value={nextOpenHouseAt}
                onChange={(e) => setNextOpenHouseAt(e.target.value)}
                className="w-full max-w-xs"
              />
            </div>

            <div className="flex gap-4">
              <Button type="submit" disabled={updateMutation.isPending || listPrice <= 0}>
                {updateMutation.isPending ? (
                  <>
                    <LoadingSpinner size="sm" className="mr-2" />
                    Saving…
                  </>
                ) : (
                  "Save changes"
                )}
              </Button>
              <Button type="button" variant="outline" asChild>
                <Link href={`/listings/${id}`}>Cancel</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </form>
    </div>
  );
}
