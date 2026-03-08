import type { CSSProperties, ReactNode } from "react";

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
    <div className="modal-overlay">
      <div
        aria-labelledby={titleId}
        aria-modal="true"
        className={className ? `modal ${className}` : "modal"}
        role="dialog"
        style={style}
      >
        <div className="modal__header">
          <div className="modal__title" id={titleId}>
            {title}
          </div>
        </div>
        {children}
      </div>
    </div>
  );
}
