/**
 * Matching a signed agreement Cue has read to the job it belongs to.
 *
 * Cue reads the PDF; this decides what the reading is worth. It is deliberately
 * not AI. The model is good at pulling names and dates off a scanned page and
 * bad at being accountable for which couple's booking they move — so the model
 * only reports what the document says, and this function, which is
 * deterministic and tested, turns that into a suggestion and a list of reasons
 * to doubt it.
 *
 * Nothing here records anything. The output prefills the same "Record the
 * signature" form a studio fills by hand, and a person presses the button. So a
 * wrong suggestion costs a correction, never a booking — which is why every
 * doubt is surfaced as a flag rather than silently resolved.
 *
 * Duplicated at functions/src/booking/signed-agreement-match.ts; the drift test
 * in tests/signed-agreement-match.test.ts keeps the two identical.
 */

export type SignedAgreementReading = {
  /** Whether the document is a client agreement at all. */
  isSignedAgreement: boolean;
  /** Whether a signature, typed or drawn, is actually visible on it. */
  signatureVisible: boolean;
  /** Every signer the document names, as written. */
  signerNames: string[];
  /** Client names the agreement is made with, as written. */
  clientNames: string[];
  /** YYYY-MM-DD, or null when the document does not state one. */
  signedDate: string | null;
  /** YYYY-MM-DD of the event the agreement covers, or null. */
  eventDate: string | null;
};

export type SignedAgreementCandidate = {
  projectId: string;
  projectName: string;
  eventDate: string | null;
  /** The accepted proposal, or null when the project has none. */
  proposalId: string | null;
  /** YYYY-MM-DD the proposal was accepted, or null. */
  proposalAcceptedOn: string | null;
  /** The project's client contacts, as "First Last". */
  clientNames: string[];
};

export type SignedAgreementFlagCode =
  | "NOT_A_SIGNED_AGREEMENT"
  | "NO_SIGNATURE_VISIBLE"
  | "NO_SIGNED_DATE"
  | "SIGNED_IN_FUTURE"
  | "NO_JOBS_AWAITING_SIGNATURE"
  | "NO_MATCHING_JOB"
  | "AMBIGUOUS_MATCH"
  | "SIGNER_NOT_ON_JOB"
  | "EVENT_DATE_MISMATCH"
  | "SIGNED_BEFORE_ACCEPTANCE";

export type SignedAgreementFlag = {
  code: SignedAgreementFlagCode;
  message: string;
};

export type SignedAgreementMatch = {
  projectId: string;
  projectName: string;
  proposalId: string;
  score: number;
  reasons: string[];
};

export type SignedAgreementSuggestion = {
  projectId: string;
  proposalId: string;
  signerName: string;
  /** YYYY-MM-DD, or "" when it must be entered by hand. */
  signedAt: string;
};

export type SignedAgreementAssessment = {
  matches: SignedAgreementMatch[];
  suggestion: SignedAgreementSuggestion | null;
  flags: SignedAgreementFlag[];
};

const isoDate = /^\d{4}-\d{2}-\d{2}$/;

/** A name reduced to what two spellings of the same person share. */
function person(name: string): { first: string; last: string } | null {
  const tokens = name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter((token) => token.length >= 2);
  if (tokens.length < 2) return null;
  return { first: tokens[0]!, last: tokens[tokens.length - 1]! };
}

/**
 * Same surname, same first initial. Loose on purpose: "Theo Johnson" signs as
 * "Theodore J. Johnson", and a stricter rule would call that a stranger. The
 * surname carries the weight, so a different family never matches.
 */
export function samePerson(left: string, right: string): boolean {
  const a = person(left);
  const b = person(right);
  return Boolean(a && b && a.last === b.last && a.first[0] === b.first[0]);
}

export function assessSignedAgreement(input: {
  reading: SignedAgreementReading;
  candidates: readonly SignedAgreementCandidate[];
  /** Today, YYYY-MM-DD, in the studio's own calendar. */
  today: string;
}): SignedAgreementAssessment {
  const { reading, candidates, today } = input;
  const flags: SignedAgreementFlag[] = [];
  const people = [...reading.signerNames, ...reading.clientNames].filter(
    (name) => name.trim().length > 0,
  );

  if (!reading.isSignedAgreement) {
    flags.push({
      code: "NOT_A_SIGNED_AGREEMENT",
      message:
        "This doesn't read as a client agreement. Check you attached the right file.",
    });
  } else if (!reading.signatureVisible) {
    flags.push({
      code: "NO_SIGNATURE_VISIBLE",
      message:
        "No signature is visible on it. Make sure this is the signed copy, not the one you sent.",
    });
  }

  const signedDate =
    reading.signedDate && isoDate.test(reading.signedDate)
      ? reading.signedDate
      : null;
  if (!signedDate) {
    flags.push({
      code: "NO_SIGNED_DATE",
      message: "The signing date isn't stated. Enter it from the document.",
    });
  } else if (signedDate > today) {
    flags.push({
      code: "SIGNED_IN_FUTURE",
      message: `The document is dated ${signedDate}, which hasn't happened yet. Check the date.`,
    });
  }

  // Only a job with an accepted proposal can take a signature, because that is
  // the only state the recording command accepts.
  const eligible = candidates.filter((candidate) => candidate.proposalId);
  if (eligible.length === 0) {
    flags.push({
      code: "NO_JOBS_AWAITING_SIGNATURE",
      message:
        "No job is waiting on a signature. A contract can only be recorded once its proposal has been accepted.",
    });
    return { matches: [], suggestion: null, flags };
  }

  const matches = eligible
    .map((candidate) => {
      const reasons: string[] = [];
      let score = 0;
      const matchedClients = candidate.clientNames.filter((client) =>
        people.some((name) => samePerson(name, client)),
      );
      if (matchedClients.length > 0) {
        score += 2 * matchedClients.length;
        reasons.push(`Names ${matchedClients.join(" and ")}`);
      }
      if (
        reading.eventDate &&
        candidate.eventDate &&
        reading.eventDate === candidate.eventDate
      ) {
        score += 2;
        reasons.push(`Same event date, ${candidate.eventDate}`);
      }
      return {
        projectId: candidate.projectId,
        projectName: candidate.projectName,
        proposalId: candidate.proposalId!,
        score,
        reasons,
      };
    })
    .filter((match) => match.score > 0)
    .sort(
      (left, right) =>
        right.score - left.score ||
        left.projectName.localeCompare(right.projectName),
    );

  if (matches.length === 0) {
    flags.push({
      code: "NO_MATCHING_JOB",
      message:
        "None of the names or dates on it match a job waiting on a signature. Pick the job yourself if it's there.",
    });
    return { matches, suggestion: null, flags };
  }

  // A tie is not a guess to make on someone's behalf.
  if (matches.length > 1 && matches[0]!.score === matches[1]!.score) {
    flags.push({
      code: "AMBIGUOUS_MATCH",
      message: `It matches ${matches[0]!.projectName} and ${matches[1]!.projectName} equally. Choose the right job.`,
    });
    return { matches, suggestion: null, flags };
  }

  const best = matches[0]!;
  const job = eligible.find((candidate) => candidate.projectId === best.projectId)!;
  const signer =
    reading.signerNames.find((name) =>
      job.clientNames.some((client) => samePerson(name, client)),
    ) ?? null;

  if (!signer) {
    flags.push({
      code: "SIGNER_NOT_ON_JOB",
      message:
        reading.signerNames.length > 0
          ? `${reading.signerNames[0]} signed, but isn't a client on ${job.projectName}. Check who signed.`
          : `Nobody who signed is a client on ${job.projectName}. Check who signed.`,
    });
  }
  if (reading.eventDate && job.eventDate && reading.eventDate !== job.eventDate) {
    flags.push({
      code: "EVENT_DATE_MISMATCH",
      message: `The agreement is for ${reading.eventDate}, but ${job.projectName} is on ${job.eventDate}.`,
    });
  }
  if (
    signedDate &&
    job.proposalAcceptedOn &&
    signedDate < job.proposalAcceptedOn
  ) {
    flags.push({
      code: "SIGNED_BEFORE_ACCEPTANCE",
      message: `It's dated ${signedDate}, before the proposal was accepted on ${job.proposalAcceptedOn}. It may be an older agreement.`,
    });
  }

  return {
    matches,
    suggestion: {
      projectId: job.projectId,
      proposalId: job.proposalId!,
      signerName: signer ?? reading.signerNames[0] ?? "",
      // A future date is left for the person to enter rather than prefilled,
      // so an obvious misreading can't be accepted with one tap.
      signedAt: signedDate && signedDate <= today ? signedDate : "",
    },
    flags,
  };
}
