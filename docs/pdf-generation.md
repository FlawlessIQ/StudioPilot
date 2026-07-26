# PDF Generation

Branded PDFs are generated in the isolated `cloud-run/pdf` service from validated immutable snapshots.

Proposal PDFs include branding, proposal/project IDs, version, timestamp, page number, pricing, payment schedule, expiration, and the Docusign terms boundary. The caller records the output hash and uploads it to the tenant's Dropbox path.

The service never modifies signed Docusign PDFs. Signed files and completion certificates are stored byte-for-byte with hashes.

The checked-in fixture input can be rendered with `python render_fixture.py`; render the output with Poppler for visual review.
