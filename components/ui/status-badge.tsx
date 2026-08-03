import { cn } from "@/lib/utils";

type StatusBadgeProps = {
  children: React.ReactNode;
  tone?: "neutral" | "success" | "warning" | "danger" | "info" | "brand";
  dot?: boolean;
  className?: string;
};

export function StatusBadge({
  children,
  tone = "neutral",
  dot = false,
  className,
}: StatusBadgeProps) {
  return (
    <span className={cn("status-badge", `status-${tone}`, className)}>
      {dot ? <span className="status-dot" aria-hidden="true" /> : null}
      {children}
    </span>
  );
}
