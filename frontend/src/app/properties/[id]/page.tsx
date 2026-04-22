"use client";

import { use, useState, useEffect } from "react";
import Link from "next/link";
import { useAuth } from "@/context/auth-context";
import { useProperty, usePropertyImages, useUploadPropertyImage, useSetCoverImage } from "@/hooks/use-properties";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { LoadingSpinner } from "@/components/loading-spinner";
import { formatDate } from "@/lib/utils";
import { toastError } from "@/lib/toast";
import {
  ArrowLeft,
  Building2,
  MapPin,
  Bed,
  Bath,
  Square,
  Calendar,
  ImagePlus,
  Upload,
  MapIcon,
} from "lucide-react";
import { canUploadPropertyImage } from "@/lib/permissions";

export default function PropertyDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const { user, isHydrated } = useAuth();
  const canUpload = canUploadPropertyImage(user.role);
  const { data: property, isLoading, error, refetch } = useProperty(id);
  const { data: images, isLoading: imagesLoading } = usePropertyImages(id);
  const uploadImageMutation = useUploadPropertyImage(id);
  const setCoverMutation = useSetCoverImage(id);
  const [imageFile, setImageFile] = useState<File | null>(null);

  useEffect(() => {
    if (error) toastError(error, "Failed to load property");
  }, [error]);

  if (!isHydrated) {
    return (
      <div className="flex h-full items-center justify-center">
        <LoadingSpinner size="lg" />
      </div>
    );
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
          <Link href="/properties" className="flex items-center gap-2">
            <ArrowLeft className="h-4 w-4" />
            Back to Properties
          </Link>
        </Button>
        <Button variant="outline" onClick={() => refetch()}>
          Retry
        </Button></div>
    );
  }

  if (!property) {
    return null;
  }

  const addressLine2 = property.address_line_2
    ? `, ${property.address_line_2}`
    : "";
  const cityStateZip = `${property.city}, ${property.state_province} ${property.postal_code}`;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" asChild>
            <Link href="/properties">
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </Button>
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Property Details</h1>
            <p className="text-muted-foreground">
              {property.address_line_1}
              {addressLine2} · {cityStateZip}
            </p>
          </div>
        </div>
        {property.latitude != null && property.longitude != null && (
          <Button variant="outline" size="sm" asChild>
            <Link
              href={`/listings?map=1&lat=${property.latitude}&lng=${property.longitude}&zoom=15`}
            >
              <MapIcon className="mr-2 h-4 w-4" />
              View on map
            </Link>
          </Button>
        )}
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <MapPin className="h-5 w-5" />
              Address
            </CardTitle>
            <CardDescription>Location and type</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="font-medium">
              {property.address_line_1}
              {property.address_line_2 ? `, ${property.address_line_2}` : ""}
            </p>
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <MapPin className="h-4 w-4" />
              {property.city}, {property.state_province} {property.postal_code}
            </p>
            <p className="text-sm text-muted-foreground">{property.country}</p>
            <div className="flex flex-wrap gap-2">
              <Badge
                variant={property.status === "ACTIVE" ? "success" : "secondary"}
              >
                {property.status}
              </Badge>
              <Badge variant="outline">
                {property.property_type.replace(/_/g, " ")}
              </Badge>
            </div>
            {(property.latitude != null || property.longitude != null) && (
              <p className="text-xs text-muted-foreground">
                Coordinates: {property.latitude}, {property.longitude}
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Building2 className="h-5 w-5" />
              Details
            </CardTitle>
            <CardDescription>Beds, baths, sqft, year</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap gap-6">
              {property.bedrooms != null && (
                <span className="flex items-center gap-2">
                  <Bed className="h-5 w-5 text-muted-foreground" />
                  {property.bedrooms} bed
                </span>
              )}
              {property.bathrooms_full != null && (
                <span className="flex items-center gap-2">
                  <Bath className="h-5 w-5 text-muted-foreground" />
                  {property.bathrooms_full} bath
                </span>
              )}
              {property.living_area_sqft != null && (
                <span className="flex items-center gap-2">
                  <Square className="h-5 w-5 text-muted-foreground" />
                  {property.living_area_sqft.toLocaleString()} sqft
                </span>
              )}
            </div>
            {property.year_built != null && (
              <p className="text-sm text-muted-foreground">
                Built {property.year_built}
              </p>
            )}
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Calendar className="h-4 w-4" />
              Created {formatDate(property.created_at)} · Updated{" "}
              {formatDate(property.updated_at)}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ImagePlus className="h-5 w-5" />
            Images
          </CardTitle>
          <CardDescription>
            {canUpload ? "Property photos (uploaded to MinIO/storage)" : "Property photos"}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {canUpload && (
            <div className="flex flex-wrap items-end gap-3">
              <input
                type="file"
                accept="image/*"
                className="block w-full max-w-xs text-sm text-muted-foreground file:mr-2 file:rounded-md file:border-0 file:bg-primary file:px-4 file:py-2 file:text-sm file:font-medium file:text-primary-foreground"
                onChange={(e) => {
                  setImageFile(e.target.files?.[0] ?? null);
                }}
              />
              <Button
                disabled={!imageFile || uploadImageMutation.isPending}
                onClick={() => {
                  if (!imageFile) return;
                  uploadImageMutation.mutate(imageFile, {
                    onSuccess: () => setImageFile(null),
                    onError: (err) => toastError(err, "Upload failed. Please try again."),
                  });
                }}
              >
                {uploadImageMutation.isPending && (
                  <LoadingSpinner size="sm" className="mr-2" />
                )}
                <Upload className="mr-2 h-4 w-4" />
                Upload image
              </Button>
            </div>
          )}
          {imagesLoading ? (
            <LoadingSpinner size="sm" />
          ) : images && images.length > 0 ? (
            <ul className="grid gap-2 sm:grid-cols-2 md:grid-cols-3">
              {images.map((img) => (
                <li
                  key={img.image_id}
                  className="rounded-lg border overflow-hidden bg-muted/30"
                >
                  {img.view_url ? (
                    <img
                      src={img.view_url}
                      alt={img.caption || "Property photo"}
                      className="h-40 w-full object-cover"
                    />
                  ) : (
                    <div className="flex h-40 w-full items-center justify-center text-sm text-muted-foreground">
                      Upload pending
                    </div>
                  )}
                  <div className="flex items-center justify-between gap-2 p-2 text-sm">
                    <span className="font-medium">{img.caption || "Image"}</span>
                    <div className="flex items-center gap-2">
                      {img.view_url && canUpload && (
                        <Button
                          size="sm"
                          variant={img.is_primary ? "secondary" : "outline"}
                          disabled={img.is_primary || setCoverMutation.isPending}
                          onClick={() =>
                            setCoverMutation.mutate(img.image_id, {
                              onError: (err) => toastError(err, "Failed to set cover image"),
                            })
                          }
                        >
                          {img.is_primary ? "Cover" : "Set as cover"}
                        </Button>
                      )}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">
              {canUpload ? "No images yet. Upload one above." : "No images yet."}
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-6">
          <span className="text-sm text-muted-foreground">
            Property ID:{" "}
            <code className="rounded bg-muted px-1.5 py-0.5">
              {property.property_id}
            </code>
          </span>
        </CardContent>
      </Card>
    </div>
  );
}
