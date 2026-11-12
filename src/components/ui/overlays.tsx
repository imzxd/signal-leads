"use client";

import * as React from "react";
import { Dialog as D, DropdownMenu as DM, Tooltip as T, Switch as S, Tabs as TB } from "radix-ui";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

/* Dialog ------------------------------------------------------------------------------ */
export const Dialog = D.Root;
export const DialogTrigger = D.Trigger;
export const DialogClose = D.Close;

export function DialogContent({ className, children, title, description, ...props }: React.ComponentProps<typeof D.Content> & { title: string; description?: string }) {
  return (
    <D.Portal>
      <D.Overlay className="fixed inset-0 z-50 bg-black/60 backdrop-blur-[2px] data-[state=open]:animate-fade-in" />
      <D.Content
        className={cn(
          "fixed left-1/2 top-1/2 z-50 w-[calc(100vw-32px)] max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-xl border border-border-strong bg-surface p-5 shadow-2xl shadow-black/40 data-[state=open]:animate-slide-up focus:outline-none",
          className,
        )}
        {...props}
      >
        <div className="mb-4 pr-8">
          <D.Title className="font-display text-xl text-foreground">{title}</D.Title>
          {description ? <D.Description className="mt-1 text-sm text-foreground-muted">{description}</D.Description> : <D.Description className="sr-only">{title}</D.Description>}
        </div>
        {children}
        <D.Close className="absolute right-4 top-4 rounded-md p-1 text-foreground-muted hover:bg-surface-hover hover:text-foreground" aria-label="Close">
          <X className="size-4" />
        </D.Close>
      </D.Content>
    </D.Portal>
  );
}

/* Dropdown ---------------------------------------------------------------------------- */
export const DropdownMenu = DM.Root;
export const DropdownMenuTrigger = DM.Trigger;
export function DropdownMenuContent({ className, ...props }: React.ComponentProps<typeof DM.Content>) {
  return (
    <DM.Portal>
      <DM.Content
        sideOffset={6}
        className={cn("z-50 min-w-[180px] rounded-lg border border-border-strong bg-surface-elevated p-1 shadow-xl shadow-black/40 data-[state=open]:animate-fade-in", className)}
        {...props}
      />
    </DM.Portal>
  );
}
export function DropdownMenuItem({ className, ...props }: React.ComponentProps<typeof DM.Item>) {
  return (
    <DM.Item
      className={cn(
        "flex cursor-pointer select-none items-center gap-2 rounded-md px-2.5 py-1.5 text-sm text-foreground outline-none data-[disabled]:opacity-50 data-[highlighted]:bg-surface-hover [&_svg]:size-4 [&_svg]:text-foreground-muted",
        className,
      )}
      {...props}
    />
  );
}
export function DropdownMenuLabel({ className, ...props }: React.ComponentProps<typeof DM.Label>) {
  return <DM.Label className={cn("px-2.5 py-1.5 text-[11px] uppercase tracking-wider text-foreground-subtle", className)} {...props} />;
}
export function DropdownMenuSeparator() {
  return <DM.Separator className="my-1 h-px bg-border" />;
}

/* Tooltip ----------------------------------------------------------------------------- */
export const TooltipProvider = T.Provider;
export function Tooltip({ content, children, side = "top" }: { content: React.ReactNode; children: React.ReactNode; side?: "top" | "bottom" | "left" | "right" }) {
  return (
    <T.Root delayDuration={250}>
      <T.Trigger asChild>{children}</T.Trigger>
      <T.Portal>
        <T.Content side={side} sideOffset={6} className="z-50 max-w-xs rounded-md border border-border-strong bg-surface-elevated px-2.5 py-1.5 text-xs text-foreground shadow-lg data-[state=delayed-open]:animate-fade-in">
          {content}
        </T.Content>
      </T.Portal>
    </T.Root>
  );
}

/* Switch ------------------------------------------------------------------------------ */
export function Switch({ className, ...props }: React.ComponentProps<typeof S.Root>) {
  return (
    <S.Root
      className={cn(
        "relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border border-border-strong bg-surface-hover transition-colors data-[state=checked]:border-primary data-[state=checked]:bg-primary disabled:opacity-50",
        className,
      )}
      {...props}
    >
      <S.Thumb className="block size-3.5 translate-x-0.5 rounded-full bg-foreground shadow transition-transform data-[state=checked]:translate-x-[18px] data-[state=checked]:bg-primary-foreground" />
    </S.Root>
  );
}

/* Tabs -------------------------------------------------------------------------------- */
export const Tabs = TB.Root;
export function TabsList({ className, ...props }: React.ComponentProps<typeof TB.List>) {
  return <TB.List className={cn("inline-flex items-center gap-1 rounded-lg border border-border bg-background-raised p-1", className)} {...props} />;
}
export function TabsTrigger({ className, ...props }: React.ComponentProps<typeof TB.Trigger>) {
  return (
    <TB.Trigger
      className={cn("rounded-md px-3 py-1.5 text-xs font-medium text-foreground-muted transition-colors hover:text-foreground data-[state=active]:bg-surface-elevated data-[state=active]:text-foreground", className)}
      {...props}
    />
  );
}
export const TabsContent = TB.Content;
