# Dependency security

Last reviewed: 2026-07-29

## Remediation performed

- Ran compatible `npm audit fix` in the web and Functions packages.
- Updated the Cloudflare development toolchain within its existing major
  versions:
  - `@cloudflare/vite-plugin` 1.48.0
  - `wrangler` 4.115.0
  - `vite` 8.1.5
- Removed the direct `@google-cloud/pubsub` runtime dependency. Domain-event
  publishing now uses the authenticated Google Pub/Sub REST API, reducing the
  Functions production audit from 15 findings, including six high findings, to
  nine moderate transitive findings.
- Kept Firebase and Google runtime packages on their supported current major
  lines; no `npm audit fix --force` or dependency downgrade was accepted.

## Residual advisories

The remaining production findings are transitive paths owned by current
Firebase Admin / Functions Google Cloud dependencies. npm proposes resolving
them by downgrading `firebase-admin` to 10.x and `firebase-functions` to 4.x,
which is not a safe or compatible remediation for this codebase.

The findings concern utility paths in UUID, retry, glob, and Google client
libraries. StudioCue does not expose those APIs directly to tenant input, but
the advisories remain tracked until supported upstream releases replace the
affected transitive versions.

The web package also reports development-only advisories through Firebase CLI,
ESLint, Drizzle Kit, and the optional Cloudflare compatibility toolchain. Those
tools are not shipped in the Firebase App Hosting runtime.

## Release policy

- Critical production findings block deployment.
- High production findings require a documented mitigation and security owner
  approval.
- Moderate transitive findings may ship only when no compatible upgrade exists,
  the affected path is not directly exposed, and the record above is current.
- Never run `npm audit fix --force` without a dedicated upgrade branch and the
  complete build, rules, integration, and browser suites.
