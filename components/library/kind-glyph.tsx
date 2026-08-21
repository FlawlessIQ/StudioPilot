import {
  CalendarDays,
  ClipboardList,
  FileCheck2,
  FileStack,
  FileText,
  ImageDown,
  ListChecks,
  MapPin,
  MessageCircle,
  Package,
  Receipt,
  Send,
  ShieldCheck,
  Star,
  Users,
  WandSparkles,
  Workflow,
  type LucideIcon,
} from "lucide-react";
import { kindTone, type LibraryKind } from "@/features/library/kinds";

/**
 * One icon per noun, one tint per family.
 *
 * The icon does the fine distinction — a contract and an invoice are both
 * violet, and only their glyphs tell them apart — while the tint does the
 * coarse one, which is the part that works at a glance across a list. That
 * division is deliberate: colour carries five things reliably, shape
 * carries twenty.
 */
const kindIcons: Record<LibraryKind, LucideIcon> = {
  contract: FileCheck2,
  proposal: FileText,
  package: Package,
  invoice: Receipt,
  document: FileStack,
  insurance: ShieldCheck,

  questionnaire: ClipboardList,
  form: ListChecks,

  schedule: Workflow,
  crew: Users,
  calendar: CalendarDays,
  event: CalendarDays,
  venue: MapPin,

  message: MessageCircle,
  email: Send,
  review: Star,
  delivery: ImageDown,

  workflow: Workflow,
  automation: WandSparkles,
  task: ListChecks,
};

export function kindIcon(kind: LibraryKind): LucideIcon {
  return kindIcons[kind];
}

/**
 * The tinted tile the whole app shares.
 *
 * `size` is the tile; the glyph is sized from it so a 26px tile in a dense
 * list and a 42px tile on a hub card stay in proportion without callers
 * doing arithmetic.
 *
 * A `null` kind is a first-class answer, not a failure. Mixed lists carry
 * rows that are not records at all — a project, a person, a saved search —
 * and those get the tile's shape without its colour, so the column stays
 * even while colour still only appears where it means something. Pass
 * `icon` for those; a kind brings its own.
 */
export function KindGlyph({
  className,
  icon,
  kind,
  size = 38,
}: {
  className?: string;
  /** Required when `kind` is null, ignored otherwise. */
  icon?: LucideIcon;
  kind: LibraryKind | null;
  size?: number;
}) {
  const Icon = kind ? kindIcons[kind] : icon;
  if (!Icon) return null;
  const tone = kind ? `tone-${kindTone(kind)}` : "is-neutral";
  return (
    <span
      aria-hidden="true"
      className={`kind-glyph ${tone}${className ? ` ${className}` : ""}`}
      style={{ height: size, width: size }}
    >
      <Icon size={Math.round(size * 0.5)} />
    </span>
  );
}
