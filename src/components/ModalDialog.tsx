import type { ReactNode } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

interface Props {
  children: ReactNode;
  className?: string;
  onClose: () => void;
  onOpenAutoFocus?: (event: Event) => void;
  title: ReactNode;
}

export function ModalDialog({
  children,
  className,
  onClose,
  onOpenAutoFocus,
  title,
}: Props) {
  return (
    <Dialog onOpenChange={(open) => !open && onClose()} open>
      <DialogContent
        aria-describedby={undefined}
        className={cn("sm:max-w-[600px]", className)}
        onOpenAutoFocus={onOpenAutoFocus}
        showCloseButton={false}
      >
        <DialogHeader className="border-border border-b pb-3 text-left">
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        {children}
      </DialogContent>
    </Dialog>
  );
}
