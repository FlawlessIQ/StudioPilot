import { Logo } from "@/components/brand/logo";
import { WorkspaceChooser } from "@/features/auth/workspace-chooser";

export default function WorkspacesPage() {
  return (
    <main className="auth-page">
      <section className="auth-brand-panel">
        <div className="auth-quote">
          <Logo />
          <blockquote>
            Choose the workspace you intend to operate. Tenant access always
            follows your active membership.
          </blockquote>
        </div>
      </section>
      <section className="auth-form-panel">
        <div className="auth-form-wrap">
          <span className="eyebrow">Workspace access</span>
          <h1>Where would you like to work?</h1>
          <p>
            Studio workspaces and platform administration remain separate and
            auditable.
          </p>
          <WorkspaceChooser />
        </div>
      </section>
    </main>
  );
}
