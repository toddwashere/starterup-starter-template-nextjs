import { AppLogo } from "@workspace/ui/components/app-logo";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-6 p-4">
      <AppLogo size="lg" />
      {children}
    </div>
  );
}
