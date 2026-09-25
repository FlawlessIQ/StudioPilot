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

## Signed StudioCue contracts

`/v1/contracts/pdf` renders a contract StudioCue wrote and both parties signed
(`cloud-run/pdf/contract.py`): the agreement's blocks, both typed signatures,
and a certificate page — agreement id, document fingerprint (SHA-256 of the
canonical document), agreement version, and for each signer their typed name,
email, time, sign-in method, IP address, device and consent version, then the
history. The fixture is `sample-contract.json`, rendered with
`python render_contract_fixture.py`.

The job (`pdfJobs/contract_seal_{contractId}`, type `contract_pdf`) is queued by
the signing transaction. Before rendering it re-hashes the stored document and
every signature's hash; a mismatch fails the job rather than print a
certificate for text nobody signed. The copy is stored at
`tenants/{t}/projects/{p}/contracts/signed/{contractId}.pdf` with visibility
`client` (the couple and the studio, never crew), recorded as
`documents/signed_contract_{contractId}`, and emailed to the couple as an
attachment (`contract_signed`).
