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
  getPathForVerifyEmail,
} from "@workspace/routes";
import { useQuery } from "@tanstack/react-query";
import { classifyInvitationError } from "./classify-invitation-error";
import { withRedirectToQuery } from "@/features/auth/lib/get-safe-post-auth-redirect-path";

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
  const [isSwitchingAccount, setIsSwitchingAccount] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const redirectTo = getPathForAcceptInvitation(invitationId);
  const redirectQuery = `redirectTo=${encodeURIComponent(redirectTo)}`;

  const {
    data: invitation,
    isLoading: invitationLoading,
    isError: invitationError,
    error: invitationQueryError,
  } = useQuery({
    queryKey: ["invitation", invitationId],
    queryFn: async () =>
      authClient.organization.getInvitation({
        query: { id: invitationId },
      }),
    enabled: hasUser && !sessionLoading,
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
    const kind = classifyInvitationError(invitationQueryError);
    const signedInEmail = session?.user?.email;

    if (kind === "wrong_recipient") {
      return (
        <div className="mx-auto max-w-md pt-20">
          <Card>
            <CardHeader>
              <CardTitle>Wrong account</CardTitle>
              <CardDescription>
                This invitation was sent to a different email than the account
                you&apos;re signed in with
                {signedInEmail ? (
                  <>
                    {" "}
                    (<span className="font-medium">{signedInEmail}</span>)
                  </>
                ) : null}
                .
              </CardDescription>
            </CardHeader>
            <CardFooter className="flex flex-col gap-3 sm:flex-row">
              <Button
                className="flex-1"
                disabled={isSwitchingAccount}
                onClick={async () => {
                  setIsSwitchingAccount(true);
                  try {
                    await authClient.signOut();
                    router.push(
                      withRedirectToQuery(getPathForSignIn(), redirectTo),
                    );
                  } finally {
                    setIsSwitchingAccount(false);
                  }
                }}
              >
                {isSwitchingAccount ? "Switching..." : "Switch account"}
              </Button>
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => router.push("/")}
              >
                Go to Dashboard
              </Button>
            </CardFooter>
          </Card>
        </div>
      );
    }

    if (kind === "email_verification") {
      return (
        <div className="mx-auto max-w-md pt-20">
          <Card>
            <CardHeader>
              <CardTitle>Verify your email</CardTitle>
              <CardDescription>
                Verify your email address, then return to this invitation to
                continue.
              </CardDescription>
            </CardHeader>
            <CardFooter className="flex flex-col gap-3 sm:flex-row">
              <Button asChild className="flex-1">
                <Link
                  href={withRedirectToQuery(
                    getPathForVerifyEmail(),
                    redirectTo,
                  )}
                >
                  Check verification instructions
                </Link>
              </Button>
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => router.push("/")}
              >
                Go to Dashboard
              </Button>
            </CardFooter>
          </Card>
        </div>
      );
    }

    const description =
      kind === "inviter_left"
        ? "The person who invited you is no longer a member of this organization. Ask an admin to send a new invitation."
        : "This invitation is invalid or has expired. Ask an admin to send a new invitation if you still need access.";

    return (
      <div className="mx-auto max-w-md pt-20">
        <Card>
          <CardHeader>
            <CardTitle>Invalid Invitation</CardTitle>
            <CardDescription>{description}</CardDescription>
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
      const kind = classifyInvitationError(err);
      if (kind === "email_verification") {
        setError(
          "Verify your email address before accepting this invitation.",
        );
      } else if (kind === "wrong_recipient") {
        setError(
          "This invitation was sent to a different email than your signed-in account.",
        );
      } else {
        setError(
          err instanceof Error ? err.message : "Failed to accept invitation",
        );
      }
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
