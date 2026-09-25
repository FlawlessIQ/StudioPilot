# Electronic-signature consent — for legal review

Prepared 2026-09-25 for counsel. StudioCue is software photography studios use to
run their bookings. Studios now send their own client agreement through
StudioCue, and the client (usually a couple booking a wedding) signs it in a
web portal by ticking a consent box and typing their name. This document sets
out the consent wording we show, what we record, and the questions we need
answered. Nothing here is legal advice to us; it is what we are asking for.

**What we need from you:** a yes, or edits, on the version-2 wording below,
and answers to the questions at the end.

## How signing works

1. The studio owner reads the agreement, types their name, confirms they are
   signing for the studio, and sends it. Studio statement: *"I'm signing this agreement for the studio, electronically, and my typed name is my signature."*
2. The client receives an email, signs in to their portal (their own account,
   email address verified), and reads the agreement on screen.
3. Under the agreement: the consent checkbox, a "Read the full terms of signing
   electronically" link that expands the disclosure, a field to type their full
   name, and a **Sign agreement** button. Nothing is signed until they tick the
   box, type a name and press the button.
4. The agreement is identified by a SHA-256 fingerprint of its exact text. The
   page sends the fingerprint of what it displayed; if the stored text differs,
   the signature is refused.
5. On signing, a PDF is generated with both signatures and a certificate page
   (below), emailed to the client as an attachment, and kept in their portal.

A studio may instead choose to have StudioCue apply the owner's typed name
automatically when a proposal is accepted (off by default). Turning that on
requires the owner to type their name and agree that *"StudioCue may apply it
for me to each contract sent when a proposal is accepted."*

## What we record with each signature

Typed name · email address signed in with · whether that email is verified ·
sign-in method · date and time (server clock) · IP address · device and browser
(as reported by the browser) · consent version id and a SHA-256 hash of its
exact words · the agreement's fingerprint. All of it prints on the certificate
page of the signed PDF. Records are append-only: no one, including the studio,
can edit or delete a signature record through the product. The privacy policy
now has a section describing this (studio-cue.com/privacy, "Electronic
signatures").

## Version 1 (live for a few hours on 2026-09-25; one signature was given under it — our own internal test, in our test studio, with no real client)

**Checkbox:** I agree to sign this agreement electronically, and that my typed name is my signature.

**"Read the full terms" (shown under the checkbox):**

> You are agreeing to use electronic records and an electronic signature for this agreement instead of paper. Your typed name, together with this record of when and how you signed, has the same effect as a handwritten signature.
>
> You can ask your studio for a paper copy at any time, free of charge, by replying to any email from them or sending a message from this portal.
>
> You can decline to sign electronically before you sign. To do that, don't tick this box — message your studio instead and they will arrange another way to sign.
>
> Once signed, a copy of the complete agreement is emailed to you and stays available in this portal. To open it you need a current web browser and an email address; a PDF reader lets you save or print it.
>
> If your email address changes, update it with your studio so your copy and any notices reach you.

## Version 2 (live now)

**Checkbox:** I can open and read this agreement on this device. I agree to receive it and sign it electronically, and that my typed name is my signature.

**"Read the full terms" (shown under the checkbox):**

> What you're agreeing to. You're choosing to receive this agreement, and the signed copy and signing record that go with it, electronically, and to sign it electronically instead of on paper. Your typed name, together with the record of when and how you signed, has the same effect as a handwritten signature. This consent covers this agreement only. Anything else your studio sends you is between you and them.
>
> Paper instead. You don't have to sign electronically. Before you sign, you can simply not tick the box and message your studio; they'll arrange a paper copy to sign instead. After you sign, you can ask your studio for a paper copy of the signed agreement at any time, free of charge, by replying to any of their emails or messaging them from this portal.
>
> Changing your mind later. You can withdraw this consent at any time by messaging your studio. Withdrawing doesn't undo a signature you've already given or change the agreement; it means any further copies or documents for this agreement will be given to you on paper.
>
> What you'll need. A phone, tablet or computer with a current version of Safari, Chrome, Edge or Firefox; an email account; and a way to open PDF files, which is built into most devices. You'll know your device works because you're reading this agreement on it now. If these requirements change in a way that could stop you opening your signed agreement, you'll be told by email before the change takes effect.
>
> Your copy. Once you sign, a copy of the complete agreement, with both signatures and its signing record, is emailed to you and stays available in this portal. Keep your email address up to date with your studio so your copy and any notices reach you.
>
> What we record when you sign. As evidence of your signature, StudioCue records the name you type, the email address you're signed in with, the date and time, your IP address, and the device and browser you're using. It's kept with the agreement and printed on its signing record, and it's available only to you, your studio, and StudioCue to run the service. See studio-cue.com/privacy.

## What changed, against ESIGN §7001(c)

We understand §7001(c) applies only where another law requires information to
be provided to a consumer in writing, which a photography services agreement
usually does not. We wrote v2 to meet it anyway.

| Element | v1 | v2 |
|---|---|---|
| Right to a paper copy, and any fee (§7001(c)(1)(B)(iv)) | Paper copy on request, free | Same, before and after signing |
| Right to withdraw consent, procedure, and consequences (§7001(c)(1)(B)(i), (iii)) | Only "decline before you sign" | How to withdraw at any time, and that withdrawal doesn't undo a signature already given |
| Scope of the consent (§7001(c)(1)(B)(ii)) | Not stated | "This consent covers this agreement only" |
| How to update contact information (§7001(c)(1)(B)(iii)) | Present | Present |
| Hardware and software requirements (§7001(c)(1)(C)(i)) | "a current web browser" | Named browsers, email, PDF viewer |
| Consent in a manner that reasonably demonstrates access (§7001(c)(1)(C)(ii)) | Implicit (they are reading it) | Checkbox affirms "I can open and read this agreement on this device" |
| Notice if requirements change (§7001(c)(1)(D)) | None | Email before the change takes effect |
| What is recorded (privacy) | None | Listed, with a link to the privacy policy |

## Questions for you

1. **Is v2 acceptable as written?** Edits welcome; any change becomes version 3
   and v2 signatures keep v2.
2. **Is the statement "has the same effect as a handwritten signature"** safe to
   make to consumers in the US, UK and EU, or should it be softened?
3. **Scope.** We limit the consent to this agreement and its signed copy.
   Studios also email clients invoices, schedules and notices. Should those be
   in scope, or is it right to leave them out?
4. **Signatures given under v1.** The only one is our own internal test. Is
   there anything we should do differently if a real client ever signs under a
   version later found wanting?
5. **Clients outside the US.** Anything required beyond this for UK/EU couples
   (simple electronic signature under eIDAS / UK ECA 2000)? And for specific US
   states?
6. **Notice of changed requirements.** v2 promises an email before any change
   that could stop someone opening their signed copy. Is that the right
   commitment, and for how long after signing does it run?
7. **Automatic sending.** Is an owner's name applied automatically (with their
   prior consent, recorded as "adopted signature") a valid signature for the
   studio?
8. **Retention.** We keep the signing record as long as the agreement. A studio
   can permanently delete a job, which deletes its signed agreement too (the
   client keeps their emailed copy). Any minimum retention we should enforce?
9. **The studio's own agreement.** Should studios' agreements include their own
   clause about electronic signing, or is the consent screen sufficient?

## The certificate page (example)

Each signed PDF ends with a "Certificate of completion — Signing record":
agreement id; studio; document fingerprint (SHA-256); agreement version; for
each signer — name as typed, role, email, date and time, sign-in method, IP
address, device, consent version; and a history (prepared, studio signed and
sent, opened by the client, signed). A real example from our own test can be
provided on request.
