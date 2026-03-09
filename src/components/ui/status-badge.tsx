import type { ComponentProps } from "react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

type StatusBadgeVariant =
  | "default"
  | "success"
  | "warning"
  | "error"
  | "info"
  | "modified";

interface StatusBadgeProps extends ComponentProps<typeof Badge> {
  interactive?: boolean;
  variant?: StatusBadgeVariant;
}

export function StatusBadge({
  className,
  interactive = false,
  variant = "default",
  ...props
}: StatusBadgeProps) {
  return (
    <Badge
      className={cn(
        interactive &&
          "cursor-pointer border border-transparent transition-transform hover:-translate-y-0.5 hover:border-current",
        className
      )}
      variant={variant}
      {...props}
    />
  );
}
