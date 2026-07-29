# PDF Generation

Branded PDFs are generated in the isolated `cloud-run/pdf` service from validated immutable snapshots.

Proposal PDFs include branding, proposal/project IDs, version, timestamp, page
number, client-facing introduction, immutable pricing, explicit payment dates,
terms summary, expiration, and the Docusign terms boundary. The caller records
the output hash and keeps the file studio-only in Cloud Storage until the
approved proposal is sent. The sent PDF may then be archived through the
tenant's document-provider workflow when the project Dropbox root exists.

The service never modifies signed Docusign PDFs. Signed files and completion certificates are stored byte-for-byte with hashes.

The checked-in fixture input can be rendered with `python render_fixture.py`;
render the output with Poppler for visual review. The current fixture is
verified as a single US Letter page with no clipping, split headings, or
overflow.
