"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/context/auth-context";
import { useCreateProperty } from "@/hooks/use-properties";
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
import type { PropertyType, PropertyCreate as PropertyCreateType } from "@/types/api";
import { toastError } from "@/lib/toast";
import { canCreateProperty } from "@/lib/permissions";

const PROPERTY_TYPES: PropertyType[] = [
  "SINGLE_FAMILY",
  "TOWNHOUSE",
  "CONDO",
  "MULTI_FAMILY",
  "LAND",
  "COMMERCIAL",
];

const defaultForm: PropertyCreateType = {
  address_line_1: "",
  address_line_2: "",
  city: "",
  state_province: "",
  postal_code: "",
  country: "US",
  property_type: "SINGLE_FAMILY",
  year_built: undefined,
  living_area_sqft: undefined,
  bedrooms: undefined,
  bathrooms_full: undefined,
};

export default function NewPropertyPage() {
  const router = useRouter();
  const { user, isHydrated } = useAuth();
  const createMutation = useCreateProperty();

  const [form, setForm] = useState<PropertyCreateType>(defaultForm);

  const update = (updates: Partial<PropertyCreateType>) => {
    setForm((prev) => ({ ...prev, ...updates }));
  };

  const setNumber = (
    key: "year_built" | "living_area_sqft" | "bedrooms" | "bathrooms_full",
    value: string
  ) => {
    const n = value.trim() === "" ? undefined : parseInt(value, 10);
    if (n !== undefined && isNaN(n)) return;
    update({ [key]: n });
  };

  if (!isHydrated) {
    return (
      <div className="flex h-full items-center justify-center">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  if (!canCreateProperty(user.role)) {
    router.replace("/properties");
    return null;
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const payload: PropertyCreateType = {
      address_line_1: form.address_line_1.trim(),
      city: form.city.trim(),
      state_province: form.state_province.trim(),
      postal_code: form.postal_code.trim(),
      country: form.country || "US",
      property_type: form.property_type,
    };
    if (form.address_line_2?.trim()) payload.address_line_2 = form.address_line_2.trim();
    if (form.year_built != null) payload.year_built = form.year_built;
    if (form.living_area_sqft != null) payload.living_area_sqft = form.living_area_sqft;
    if (form.bedrooms != null) payload.bedrooms = form.bedrooms;
    if (form.bathrooms_full != null) payload.bathrooms_full = form.bathrooms_full;

    createMutation.mutate(payload, {
      onSuccess: (data) => {
        router.push(`/properties/${data.property_id}`);
      },
      onError: (err) => toastError(err, "Failed to create property"),
    });
  };

  const valid =
    form.address_line_1.trim().length > 0 &&
    form.city.trim().length > 0 &&
    form.state_province.trim().length > 0 &&
    form.postal_code.trim().length > 0;

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/properties"
          className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to Properties
        </Link>
        <h1 className="mt-2 text-3xl font-bold tracking-tight">Add Property</h1>
        <p className="text-muted-foreground">
          Create a new property record. Required fields are address, city, state, and postal code.
        </p>
      </div>

      <form onSubmit={handleSubmit}>
        <Card>
          <CardHeader>
            <CardTitle>Property details</CardTitle>
            <CardDescription>
              Enter the address and optional details. You can update the property later.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-2">
              <Label htmlFor="address_line_1">Street address *</Label>
              <Input
                id="address_line_1"
                value={form.address_line_1}
                onChange={(e) => update({ address_line_1: e.target.value })}
                placeholder="123 Main St"
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="address_line_2">Address line 2 (optional)</Label>
              <Input
                id="address_line_2"
                value={form.address_line_2 ?? ""}
                onChange={(e) => update({ address_line_2: e.target.value || undefined })}
                placeholder="Apt 4, Unit B"
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-2">
                <Label htmlFor="city">City *</Label>
                <Input
                  id="city"
                  value={form.city}
                  onChange={(e) => update({ city: e.target.value })}
                  placeholder="Seattle"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="state_province">State / Province *</Label>
                <Input
                  id="state_province"
                  value={form.state_province}
                  onChange={(e) => update({ state_province: e.target.value })}
                  placeholder="WA"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="postal_code">Postal code *</Label>
                <Input
                  id="postal_code"
                  value={form.postal_code}
                  onChange={(e) => update({ postal_code: e.target.value })}
                  placeholder="98101"
                  required
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="country">Country</Label>
              <Input
                id="country"
                value={form.country ?? "US"}
                onChange={(e) => update({ country: e.target.value })}
                placeholder="US"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="property_type">Property type</Label>
              <Select
                value={form.property_type}
                onValueChange={(v) => update({ property_type: v as PropertyType })}
              >
                <SelectTrigger id="property_type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PROPERTY_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>
                      {t.replace(/_/g, " ")}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-4">
              <div className="space-y-2">
                <Label htmlFor="year_built">Year built</Label>
                <Input
                  id="year_built"
                  type="number"
                  min={1800}
                  max={new Date().getFullYear() + 2}
                  value={form.year_built ?? ""}
                  onChange={(e) => setNumber("year_built", e.target.value)}
                  placeholder="2020"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="living_area_sqft">Living area (sq ft)</Label>
                <Input
                  id="living_area_sqft"
                  type="number"
                  min={0}
                  value={form.living_area_sqft ?? ""}
                  onChange={(e) => setNumber("living_area_sqft", e.target.value)}
                  placeholder="2200"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="bedrooms">Bedrooms</Label>
                <Input
                  id="bedrooms"
                  type="number"
                  min={0}
                  value={form.bedrooms ?? ""}
                  onChange={(e) => setNumber("bedrooms", e.target.value)}
                  placeholder="3"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="bathrooms_full">Bathrooms (full)</Label>
                <Input
                  id="bathrooms_full"
                  type="number"
                  min={0}
                  step={0.5}
                  value={form.bathrooms_full ?? ""}
                  onChange={(e) => {
                    const v = e.target.value.trim();
                    if (v === "") {
                      update({ bathrooms_full: undefined });
                      return;
                    }
                    const n = parseFloat(v);
                    if (!isNaN(n)) update({ bathrooms_full: n });
                  }}
                  placeholder="2"
                />
              </div>
            </div>

            <div className="flex gap-4">
              <Button type="submit" disabled={!valid || createMutation.isPending}>
                {createMutation.isPending ? (
                  <>
                    <LoadingSpinner size="sm" className="mr-2" />
                    Creating…
                  </>
                ) : (
                  "Create property"
                )}
              </Button>
              <Button type="button" variant="outline" asChild>
                <Link href="/properties">Cancel</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </form>
    </div>
  );
}
