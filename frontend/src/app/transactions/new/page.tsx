"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/context/auth-context";
import { useCreateTransaction } from "@/hooks/use-transactions";
import { useProperties } from "@/hooks/use-properties";
import { useListings } from "@/hooks/use-listings";
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
import type { TransactionState, UserRole } from "@/types/api";
import { toastError } from "@/lib/toast";
import {
  canCreateTransaction,
  getAllowedInitialStatesForNewTransaction,
  getAllowedPartyRolesForNewTransaction,
} from "@/lib/permissions";

function getRoleDisplayName(role: string): string {
  return role.replace(/_/g, " ");
}

export default function NewTransactionPage() {
  const router = useRouter();
  const { user, isHydrated } = useAuth();
  const createMutation = useCreateTransaction();
  const { data: propertiesData } = useProperties({ limit: 100 });
  const { data: listingsData } = useListings({ limit: 100 });

  const allowedInitialStates = getAllowedInitialStatesForNewTransaction();
  const allowedPartyRoles = getAllowedPartyRolesForNewTransaction(user.role);
  const [initialState, setInitialState] = useState<TransactionState>(
    allowedInitialStates[0] ?? "PRE_LISTING"
  );
  const [initialPartyRole, setInitialPartyRole] = useState<UserRole>(
    allowedPartyRoles.includes(user.role) ? user.role : (allowedPartyRoles[0] ?? "SELLER_AGENT")
  );
  const [propertyId, setPropertyId] = useState<string>("");
  const [listingId, setListingId] = useState<string>("");
  const properties = Array.isArray(propertiesData) ? propertiesData : [];
  const listings = listingsData?.data ?? [];

  useEffect(() => {
    if (allowedPartyRoles.length && !allowedPartyRoles.includes(initialPartyRole)) {
      setInitialPartyRole(allowedPartyRoles[0] ?? "SELLER_AGENT");
    }
  }, [allowedPartyRoles, initialPartyRole]);

  if (!isHydrated) {
    return (
      <div className="flex h-full items-center justify-center">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  if (!canCreateTransaction(user.role)) {
    router.replace("/transactions");
    return null;
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    createMutation.mutate(
      {
        organization_id: user.organization_id,
        initial_state: initialState,
        initial_party_role: initialPartyRole,
        property_id: propertyId || undefined,
        listing_id: listingId || undefined,
      },
      {
        onSuccess: (data) => {
          router.push(`/transactions/${data.transaction_id}`);
        },
        onError: (err) => toastError(err, "Failed to create transaction"),
      }
    );
  };

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/transactions"
          className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to Transactions
        </Link>
        <h1 className="mt-2 text-3xl font-bold tracking-tight">New Transaction</h1>
        <p className="text-muted-foreground">
          Create a transaction in an initial state. You will be added as the first party.
        </p>
      </div>

      <form onSubmit={handleSubmit}>
        <Card>
          <CardHeader>
            <CardTitle>Transaction details</CardTitle>
            <CardDescription>
              Organization: {user.organization_name}. Your role for this transaction will be set from the form.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="initial_state">Initial state</Label>
                <Select
                  value={initialState}
                  onValueChange={(v) => setInitialState(v as TransactionState)}
                >
                  <SelectTrigger id="initial_state">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {allowedInitialStates.map((state) => (
                      <SelectItem key={state} value={state}>
                        {state.replace(/_/g, " ")}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="initial_party_role">Your role (as first party)</Label>
                <Select
                  value={initialPartyRole}
                  onValueChange={(v) => setInitialPartyRole(v as UserRole)}
                >
                  <SelectTrigger id="initial_party_role">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {allowedPartyRoles.map((role) => (
                      <SelectItem key={role} value={role}>
                        {getRoleDisplayName(role)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="property_id">Property (optional)</Label>
                <Select value={propertyId || "none"} onValueChange={(v) => setPropertyId(v === "none" ? "" : v)}>
                  <SelectTrigger id="property_id">
                    <SelectValue placeholder="Select a property" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None</SelectItem>
                    {properties.map((p) => (
                      <SelectItem key={p.property_id} value={p.property_id}>
                        {p.address_line_1}, {p.city}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="listing_id">Listing (optional)</Label>
                <Select value={listingId || "none"} onValueChange={(v) => setListingId(v === "none" ? "" : v)}>
                  <SelectTrigger id="listing_id">
                    <SelectValue placeholder="Select a listing" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None</SelectItem>
                    {listings.map((l) => (
                      <SelectItem key={l.listing_id} value={l.listing_id}>
                        {l.property_id ? `Listing for ${l.property_id.slice(0, 8)}…` : `Listing ${l.listing_id.slice(0, 8)}…`}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="flex gap-4">
              <Button type="submit" disabled={createMutation.isPending}>
                {createMutation.isPending ? (
                  <>
                    <LoadingSpinner size="sm" className="mr-2" />
                    Creating…
                  </>
                ) : (
                  "Create transaction"
                )}
              </Button>
              <Button type="button" variant="outline" asChild>
                <Link href="/transactions">Cancel</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </form>
    </div>
  );
}
