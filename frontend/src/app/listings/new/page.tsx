"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/context/auth-context";
import { useCreateListing } from "@/hooks/use-listings";
import { useProperties } from "@/hooks/use-properties";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { LoadingSpinner } from "@/components/loading-spinner";
import { ArrowLeft } from "lucide-react";
import type { ListingType, ListingCreate as ListingCreateType } from "@/types/api";
import { toastError } from "@/lib/toast";
import { canCreateListing } from "@/lib/permissions";

const LISTING_TYPES: ListingType[] = ["FOR_SALE", "FOR_RENT", "AUCTION"];

const defaultForm: ListingCreateType = {
  property_id: "",
  list_price: 0,
  price_currency: "USD",
  listing_type: "FOR_SALE",
  description: "",
  is_public: false,
};

export default function NewListingPage() {
  const router = useRouter();
  const { user, isHydrated } = useAuth();
  const createMutation = useCreateListing();
  const { data: propertiesData } = useProperties({ limit: 100 });

  const [form, setForm] = useState<ListingCreateType>(defaultForm);
  const properties = Array.isArray(propertiesData) ? propertiesData : [];

  const update = (updates: Partial<ListingCreateType>) => {
    setForm((prev) => ({ ...prev, ...updates }));
  };

  if (!isHydrated) {
    return (
      <div className="flex h-full items-center justify-center">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  if (!canCreateListing(user.role)) {
    router.replace("/listings");
    return null;
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const listPrice = Number(form.list_price);
    if (!form.property_id || listPrice <= 0) {
      toastError(new Error("Select a property and enter a valid list price."));
      return;
    }
    const payload: ListingCreateType = {
      property_id: form.property_id,
      list_price: listPrice,
      price_currency: form.price_currency || "USD",
      listing_type: form.listing_type || "FOR_SALE",
      is_public: form.is_public ?? false,
    };
    if (form.description?.trim()) payload.description = form.description.trim();

    createMutation.mutate(payload, {
      onSuccess: (data) => {
        router.push(`/listings/${data.listing_id}`);
      },
      onError: (err) => toastError(err, "Failed to create listing"),
    });
  };

  const valid = form.property_id.length > 0 && Number(form.list_price) > 0;

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/listings"
          className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to Listings
        </Link>
        <h1 className="mt-2 text-3xl font-bold tracking-tight">Create Listing</h1>
        <p className="text-muted-foreground">
          Create a new listing for a property. It will start as a draft; you can publish it from the listing detail page.
        </p>
      </div>

      <form onSubmit={handleSubmit}>
        <Card>
          <CardHeader>
            <CardTitle>Listing details</CardTitle>
            <CardDescription>
              Choose a property and set price and type. Leave &quot;Public&quot; off to save as draft.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-2">
              <Label htmlFor="property_id">Property *</Label>
              <Select
                value={form.property_id || "none"}
                onValueChange={(v) => update({ property_id: v === "none" ? "" : v })}
              >
                <SelectTrigger id="property_id">
                  <SelectValue placeholder="Select a property" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Select a property</SelectItem>
                  {properties.map((p) => (
                    <SelectItem key={p.property_id} value={p.property_id}>
                      {p.address_line_1}, {p.city}, {p.state_province}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {properties.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  No properties found. <Link href="/properties/new" className="text-primary underline">Add a property</Link> first.
                </p>
              )}
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="list_price">List price *</Label>
                <Input
                  id="list_price"
                  type="number"
                  min={1}
                  step={1}
                  value={form.list_price || ""}
                  onChange={(e) => update({ list_price: e.target.value === "" ? 0 : Number(e.target.value) })}
                  placeholder="e.g. 200000 or 500000"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="listing_type">Listing type</Label>
                <Select
                  value={form.listing_type || "FOR_SALE"}
                  onValueChange={(v) => update({ listing_type: v as ListingType })}
                >
                  <SelectTrigger id="listing_type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {LISTING_TYPES.map((t) => (
                      <SelectItem key={t} value={t}>
                        {t.replace(/_/g, " ")}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="description">Description (optional)</Label>
              <Input
                id="description"
                value={form.description ?? ""}
                onChange={(e) => update({ description: e.target.value })}
                placeholder="Spacious family home..."
              />
            </div>

            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="is_public"
                checked={form.is_public ?? false}
                onChange={(e) => update({ is_public: e.target.checked })}
                className="h-4 w-4 rounded border-input"
              />
              <Label htmlFor="is_public" className="font-normal cursor-pointer">
                Public (visible to buyers; leave unchecked for draft)
              </Label>
            </div>

            <div className="flex gap-4">
              <Button type="submit" disabled={!valid || createMutation.isPending}>
                {createMutation.isPending ? (
                  <>
                    <LoadingSpinner size="sm" className="mr-2" />
                    Creating…
                  </>
                ) : (
                  "Create listing"
                )}
              </Button>
              <Button type="button" variant="outline" asChild>
                <Link href="/listings">Cancel</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </form>
    </div>
  );
}
