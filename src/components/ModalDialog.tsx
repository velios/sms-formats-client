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
  /**
   * Куда встаёт фокус при открытии. По умолчанию radix берёт первый элемент,
   * до которого доходит Tab, — а это не всегда тот, с которого человек начнёт
   * читать. Обработчик может отменить событие и увести фокус сам.
   */
  onOpenAutoFocus?: (event: Event) => void;
  title: ReactNode;
  titleId: string;
}

export function ModalDialog({
  children,
  className,
  onClose,
  onOpenAutoFocus,
  title,
  titleId,
}: Props) {
  return (
    <Dialog onOpenChange={(open) => !open && onClose()} open>
      <DialogContent
        aria-labelledby={titleId}
        className={cn("sm:max-w-[600px]", className)}
        onOpenAutoFocus={onOpenAutoFocus}
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
