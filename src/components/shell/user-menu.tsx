"use client";

import { Building2, Check, ChevronsUpDown, ExternalLink, LogOut } from "lucide-react";
import { Avatar } from "@/components/ui/primitives";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/overlays";
import { signOut, switchOrganization } from "@/app/(auth)/actions";

export function UserMenu({
  name,
  email,
  organizationId,
  organizationName,
  formSlug,
  memberships,
}: {
  name: string;
  email: string | null;
  organizationId: string;
  organizationName: string;
  formSlug: string;
  memberships: { id: string; name: string }[];
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="flex w-full items-center gap-2.5 rounded-lg border border-border bg-surface/60 p-2 text-left hover:border-border-strong hover:bg-surface-hover/60">
        <Avatar name={name} tone="lime" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-xs font-medium text-foreground">{organizationName}</span>
          <span className="block truncate text-[11px] text-foreground-subtle">{name}</span>
        </span>
        <ChevronsUpDown className="size-3.5 text-foreground-subtle" aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="top" className="w-60">
        <DropdownMenuLabel>{email ?? name}</DropdownMenuLabel>
        {memberships.length > 1 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>Organizations</DropdownMenuLabel>
            {memberships.map((m) => (
              <DropdownMenuItem key={m.id} onSelect={() => void switchOrganization(m.id)}>
                <Building2 /> <span className="flex-1 truncate">{m.name}</span> {m.id === organizationId && <Check className="!text-accent" />}
              </DropdownMenuItem>
            ))}
          </>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => window.open(`/forms/${formSlug}`, "_blank", "noopener")}>
          <ExternalLink /> Open public lead form
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => void signOut()}>
          <LogOut /> Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
