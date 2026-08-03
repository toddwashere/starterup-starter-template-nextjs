"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { authClient } from "@workspace/auth/client";
import { Button } from "@workspace/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card";
import { Skeleton } from "@workspace/ui/components/skeleton";
import {
  getPathForAcceptInvitation,
  getPathForOrg,
  getPathForSignIn,
  getPathForSignUp,
} from "@workspace/routes";
import { useQuery } from "@tanstack/react-query";

interface AcceptInvitationPageContentProps {
  invitationId: string;
}

export function AcceptInvitationPageContent({
  invitationId,
}: AcceptInvitationPageContentProps) {
  const router = useRouter();
  const { data: session, isPending: sessionLoading } =
    authClient.useSession();
  const hasUser = !!session?.user;
  const [isAccepting, setIsAccepting] = useState(false);
  const [isDeclining, setIsDeclining] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const redirectTo = getPathForAcceptInvitation(invitationId);
  const redirectQuery = `redirectTo=${encodeURIComponent(redirectTo)}`;

  const {
    data: invitation,
    isLoading: invitationLoading,
    isError: invitationError,
  } = useQuery({
    queryKey: ["invitation", invitationId],
    queryFn: async () =>
      authClient.organization.getInvitation({
        query: { id: invitationId },
      }),
    enabled: hasUser,
    retry: false,
  });

  if (sessionLoading || (hasUser && invitationLoading)) {
    return (
      <div className="mx-auto max-w-md pt-20">
        <Card>
          <CardHeader>
            <Skeleton className="h-6 w-48" />
            <Skeleton className="h-4 w-64" />
          </CardHeader>
          <CardContent>
            <Skeleton className="h-20 w-full" />
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!hasUser) {
    return (
      <div className="mx-auto max-w-md pt-20">
        <Card>
          <CardHeader>
            <CardTitle>Sign In Required</CardTitle>
            <CardDescription>
              You need to sign in to accept this invitation.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              You&apos;ve been invited to join an organization. Sign in or
              create an account to continue.
            </p>
          </CardContent>
          <CardFooter className="flex flex-col gap-3 sm:flex-row">
            <Button asChild className="flex-1">
              <Link href={`${getPathForSignIn()}?${redirectQuery}`}>
                Sign in
              </Link>
            </Button>
            <Button asChild variant="outline" className="flex-1">
              <Link href={`${getPathForSignUp()}?${redirectQuery}`}>
                Create account
              </Link>
            </Button>
          </CardFooter>
        </Card>
      </div>
    );
  }

  if (invitationError || !invitation) {
    return (
      <div className="mx-auto max-w-md pt-20">
        <Card>
          <CardHeader>
            <CardTitle>Invalid Invitation</CardTitle>
            <CardDescription>
              This invitation is invalid or has expired.
            </CardDescription>
          </CardHeader>
          <CardFooter>
            <Button variant="outline" onClick={() => router.push("/")}>
              Go to Dashboard
            </Button>
          </CardFooter>
        </Card>
      </div>
    );
  }

  const handleAccept = async () => {
    setIsAccepting(true);
    setError(null);
    try {
      await authClient.organization.acceptInvitation({
        invitationId,
      });
      if (invitation.organizationSlug) {
        router.push(getPathForOrg(invitation.organizationSlug));
      } else {
        router.push("/");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to accept invitation");
    } finally {
      setIsAccepting(false);
    }
  };

  const handleDecline = async () => {
    setIsDeclining(true);
    setError(null);
    try {
      await authClient.organization.rejectInvitation({
        invitationId,
      });
      router.push("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to decline invitation");
    } finally {
      setIsDeclining(false);
    }
  };

  return (
    <div className="mx-auto max-w-md pt-20">
      <Card>
        <CardHeader>
          <CardTitle>Organization Invitation</CardTitle>
          <CardDescription>
            You&apos;ve been invited to join an organization.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-lg border p-4 space-y-2">
            <div className="flex justify-between">
              <span className="text-sm text-muted-foreground">
                Organization
              </span>
              <span className="text-sm font-medium">
                {invitation.organizationName}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-sm text-muted-foreground">Role</span>
              <span className="text-sm font-medium capitalize">
                {invitation.role}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-sm text-muted-foreground">
                Invited by
              </span>
              <span className="text-sm font-medium">
                {invitation.inviterEmail ?? "Unknown"}
              </span>
            </div>
          </div>
          {error && (
            <p className="text-sm text-destructive">{error}</p>
          )}
        </CardContent>
        <CardFooter className="flex gap-3">
          <Button
            variant="outline"
            className="flex-1"
            onClick={handleDecline}
            disabled={isDeclining || isAccepting}
          >
            {isDeclining ? "Declining..." : "Decline"}
          </Button>
          <Button
            className="flex-1"
            onClick={handleAccept}
            disabled={isAccepting || isDeclining}
          >
            {isAccepting ? "Accepting..." : "Accept Invitation"}
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}
