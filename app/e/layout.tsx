import "@/app/app-styles";
/**
 * A parent's event sign-up (/e/{token}) renders inside the design system, as
 * the couple's /i/ page does.
 */
export default function EventSignupLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="ds-root" data-ds-theme="emerald">
      {children}
    </div>
  );
}
