"use client";

import { useEffect } from "react";
import { useAuth } from "@/context/auth-context";
import { useRecommendations, useSubmitFeedback } from "@/hooks/use-recommendations";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { LoadingSpinner } from "@/components/loading-spinner";
import { EmptyState } from "@/components/empty-state";
import { toastError } from "@/lib/toast";
import { formatCurrency } from "@/lib/utils";
import Link from "next/link";
import {
  Heart,
  ThumbsDown,
  Bookmark,
  MessageCircle,
  MapPin,
  Bed,
  Bath,
  Square,
  Sparkles,
  Building2,
} from "lucide-react";

export default function RecommendationsPage() {
  const { user, isHydrated } = useAuth();
  const { data, isLoading, error, refetch } = useRecommendations({ limit: 20 });
  const feedbackMutation = useSubmitFeedback();

  useEffect(() => {
    if (error) toastError(error, "Failed to load recommendations");
  }, [error]);

  if (!isHydrated) {
    return (
      <div className="flex h-full items-center justify-center">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  // Only buyers can see recommendations
  if (user.role !== "BUYER" && user.role !== "BUYER_AGENT") {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Recommendations</h1>
          <p className="text-muted-foreground">
            AI-powered property recommendations based on your preferences
          </p>
        </div>
        <Card>
          <CardContent className="py-12">
            <EmptyState
              icon="search"
              title="Not available for your role"
              description="Property recommendations are only available for buyers and buyer agents."
            />
          </CardContent>
        </Card>
      </div>
    );
  }

  const recommendations = data?.recommendations || [];

  const handleFeedback = async (
    matchId: string,
    feedback: "LIKED" | "DISLIKED" | "SAVED" | "CONTACTED"
  ) => {
    try {
      await feedbackMutation.mutateAsync({ matchId, data: { feedback } });
    } catch (err) {
      toastError(err, "Failed to submit feedback");
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Recommendations</h1>
          <p className="text-muted-foreground">
            AI-powered property matches based on your preferences
          </p>
        </div>
        <Button variant="outline" asChild>
          <Link href="/preferences">
            <Sparkles className="mr-2 h-4 w-4" />
            Manage Preferences
          </Link>
        </Button>
      </div>

      {/* Recommendations */}
      {isLoading ? (
        <div className="flex h-64 items-center justify-center">
          <LoadingSpinner size="lg" />
        </div>
      ) : error ? (
        <div className="flex justify-center py-8">
          <Button variant="outline" onClick={() => refetch()}>
            Retry
          </Button>
        </div>
      ) : recommendations.length === 0 ? (
        <Card>
          <CardContent className="py-12">
            <EmptyState
              icon="search"
              title="No recommendations yet"
              description="Set up your preferences to get personalized property recommendations."
              action={
                <Button asChild>
                  <Link href="/preferences">Set Preferences</Link>
                </Button>
              }
            />
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          {recommendations.map((rec) => (
            <Card key={rec.match_id} className="overflow-hidden">
              <div className="relative h-48 bg-gradient-to-br from-primary/20 to-primary/5">
                <div className="absolute inset-0 flex items-center justify-center">
                  <Building2 className="h-16 w-16 text-primary/30" />
                </div>
                {/* Match Score Badge */}
                <div className="absolute left-3 top-3 flex items-center gap-1 rounded-full bg-primary px-3 py-1 text-sm font-medium text-primary-foreground">
                  <Sparkles className="h-4 w-4" />
                  {Math.round(rec.match_score * 100)}% match
                </div>
              </div>

              <CardContent className="p-4">
                <div className="flex items-start justify-between">
                  <div>
                    <h3 className="font-semibold">{rec.property.address_line_1}</h3>
                    <p className="flex items-center gap-1 text-sm text-muted-foreground">
                      <MapPin className="h-3.5 w-3.5" />
                      {rec.property.city}, {rec.property.state_province} {rec.property.postal_code}
                    </p>
                  </div>
                  <span className="text-xl font-bold text-primary">
                    {formatCurrency(rec.listing.list_price)}
                  </span>
                </div>

                <div className="mt-3 flex items-center gap-4 text-sm text-muted-foreground">
                  {rec.property.bedrooms && (
                    <span className="flex items-center gap-1">
                      <Bed className="h-4 w-4" />
                      {rec.property.bedrooms} bed
                    </span>
                  )}
                  {rec.property.bathrooms_full && (
                    <span className="flex items-center gap-1">
                      <Bath className="h-4 w-4" />
                      {rec.property.bathrooms_full} bath
                    </span>
                  )}
                  {rec.property.living_area_sqft && (
                    <span className="flex items-center gap-1">
                      <Square className="h-4 w-4" />
                      {rec.property.living_area_sqft.toLocaleString()} sqft
                    </span>
                  )}
                </div>

                {/* Score Breakdown */}
                <div className="mt-4 space-y-2">
                  <p className="text-xs font-medium text-muted-foreground">Match Breakdown</p>
                  <div className="grid grid-cols-2 gap-2">
                    {Object.entries(rec.score_breakdown).map(([key, value]) => (
                      <div key={key} className="space-y-1">
                        <div className="flex justify-between text-xs">
                          <span className="capitalize">{key}</span>
                          <span>{Math.round(value * 100)}%</span>
                        </div>
                        <Progress value={value * 100} className="h-1" />
                      </div>
                    ))}
                  </div>
                </div>

                {rec.match_explanation && (
                  <p className="mt-3 text-sm text-muted-foreground">
                    {rec.match_explanation}
                  </p>
                )}

                {/* Actions */}
                <div className="mt-4 flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleFeedback(rec.match_id, "LIKED")}
                    disabled={feedbackMutation.isPending}
                  >
                    <Heart className="mr-1 h-4 w-4" />
                    Like
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleFeedback(rec.match_id, "SAVED")}
                    disabled={feedbackMutation.isPending}
                  >
                    <Bookmark className="mr-1 h-4 w-4" />
                    Save
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleFeedback(rec.match_id, "DISLIKED")}
                    disabled={feedbackMutation.isPending}
                  >
                    <ThumbsDown className="mr-1 h-4 w-4" />
                    Not Interested
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => handleFeedback(rec.match_id, "CONTACTED")}
                    disabled={feedbackMutation.isPending}
                  >
                    <MessageCircle className="mr-1 h-4 w-4" />
                    Contact
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
