import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "radix-ui";
import type * as React from "react";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex w-fit shrink-0 items-center justify-center gap-1 whitespace-nowrap rounded-full border border-transparent px-2 py-0.5 font-medium text-[11px] transition-colors focus-visible:ring-2 focus-visible:ring-ring/50 [&>svg]:pointer-events-none [&>svg]:size-3",
  {
    variants: {
      variant: {
        default: "bg-muted text-muted-foreground",
        success:
          "bg-[color:var(--c-success-soft)] text-[color:var(--c-success)]",
        warning:
          "bg-[color:var(--c-warning-soft)] text-[color:var(--c-warning)]",
        error: "bg-[color:var(--c-error-soft)] text-[color:var(--c-error)]",
        info: "bg-[color:var(--c-info-soft)] text-[color:var(--c-info)]",
        modified:
          "bg-[color:var(--c-accent-soft)] text-[color:var(--c-accent)]",
        outline: "border-border bg-card text-foreground",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
);

function Badge({
  className,
  variant = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"span"> &
  VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : "span";

  return (
    <Comp
      className={cn(badgeVariants({ variant }), className)}
      data-slot="badge"
      data-variant={variant}
      {...props}
    />
  );
}

export { Badge, badgeVariants };
