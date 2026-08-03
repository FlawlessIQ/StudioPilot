// Wraps every /auth/* route in the editorial design-system scope so the token
// bridge + auth overrides re-skin them (login, register, onboarding, workspace
// picker, password reset, verify-email, and the three invite flows).
export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="ds-root" data-ds-theme="emerald">
      {children}
    </div>
  );
}
