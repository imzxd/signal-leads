import Link from "next/link";
import { BrandLogo } from "@/components/brand/brand-logo";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 px-4 text-center">
      <BrandLogo />
      <div>
        <h1 className="font-display text-4xl">Not found</h1>
        <p className="mt-2 text-sm text-foreground-muted">That page doesn&apos;t exist, or you don&apos;t have access to it.</p>
      </div>
      <Button asChild variant="primary">
        <Link href="/overview">Back to Signal Leads</Link>
      </Button>
    </main>
  );
}
