import type { CSSProperties, ReactNode } from "react";
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
  style?: CSSProperties;
  title: ReactNode;
  titleId: string;
}

export function ModalDialog({
  children,
  className,
  onClose,
  style,
  title,
  titleId,
}: Props) {
  return (
    <Dialog onOpenChange={(open) => !open && onClose()} open>
      <DialogContent
        aria-labelledby={titleId}
        className={cn("max-w-[min(90vw,42rem)] gap-5", className)}
        showCloseButton={false}
        style={style as CSSProperties}
      >
        <DialogHeader className="border-b pb-4">
          <DialogTitle id={titleId}>{title}</DialogTitle>
        </DialogHeader>
        {children}
      </DialogContent>
    </Dialog>
  );
}
