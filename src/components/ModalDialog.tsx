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
  title: ReactNode;
  titleId: string;
}

export function ModalDialog({
  children,
  className,
  onClose,
  title,
  titleId,
}: Props) {
  return (
    <Dialog onOpenChange={(open) => !open && onClose()} open>
      <DialogContent
        aria-labelledby={titleId}
        className={cn("sm:max-w-[600px]", className)}
        showCloseButton={false}
      >
        <DialogHeader className="mb-4 border-[color:var(--c-border)] border-b pb-4 text-left">
          <DialogTitle id={titleId}>{title}</DialogTitle>
        </DialogHeader>
        {children}
      </DialogContent>
    </Dialog>
  );
}
