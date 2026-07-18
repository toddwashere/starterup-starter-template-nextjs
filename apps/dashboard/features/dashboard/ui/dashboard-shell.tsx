"use client";

import { useRouter } from "next/navigation";
import { authClient } from "@/features/auth/data/auth-client";
import { getPathForSignIn } from "@workspace/routes";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@workspace/ui/components/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu";
import { AppLogo } from "@workspace/ui/components/app-logo";
import { Button } from "@workspace/ui/components/button";
import { ThemeToggle } from "@workspace/ui/components/theme-toggle";
import { IconForSignOut } from "@workspace/ui/components/icon-for";

interface DashboardShellProps {
  user: { name: string; image?: string | null };
  children: React.ReactNode;
}

export function DashboardShell({ user, children }: DashboardShellProps) {
  const router = useRouter();

  const displayName = user.name || "User";
  const displayImage = user.image ?? "";

  const handleSignOut = async () => {
    await authClient.signOut();
    router.push(getPathForSignIn());
  };

  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex h-16 shrink-0 items-center justify-between gap-2 border-b px-6">
        <AppLogo size="sm" />
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="rounded-full">
                <Avatar className="size-8">
                  <AvatarImage src={displayImage} alt={displayName} />
                  <AvatarFallback>
                    {displayName.slice(0, 2).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={handleSignOut}>
                <IconForSignOut className="mr-2" />
                Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>
      <main className="mx-auto flex w-full max-w-2xl min-h-0 flex-1 flex-col px-6 py-10">
        {children}
      </main>
    </div>
  );
}
