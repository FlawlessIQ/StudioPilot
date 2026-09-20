/**
 * Cue's answers when there is no model to ask.
 *
 * Not a model and not pretending to be one. This is a stage set: it produces
 * the *shapes* Cue's UI has to render, so the turn can be walked and tested
 * without GCP. What went wrong in production was never the prose — it was
 * which card came first, whether the person the operator named survived the
 * trip, and whether a finished flow remembered it had finished. All of that is
 * deterministic, and none of it needed a real model to find.
 *
 * ## What it does not do
 *
 * It does not exercise the retrieval tool loop. An earlier version emitted a
 * `find_across_projects` call on the first pass so the loop would run for
 * real — but the loop records every project a tool touched as "referenced",
 * and `resolveFlowProjectId` trusts a single referenced project above the
 * name the operator typed. A blunt scripted tool call therefore aimed the
 * flow at whichever unrelated job happened to match the dimension. That is an
 * artefact of scripting, not something production does, and contorting the
 * product around it would have been the wrong trade. The script answers in one
 * pass and the project is resolved from the operator's own words — the same
 * path production uses whenever the model launches a flow without a tool call.
 *
 * ## The rule that keeps this honest
 *
 * Every reply below is parsed through the **real** `responseSchema` before it
 * is handed back (`assertScriptedRepliesParse`, called by
 * tests/cue-offline.test.ts). A fixture that drifts from what the model must
 * actually produce fails the test rather than quietly teaching the UI a shape
 * production will never send.
 *
 * Reached only when PROVIDER_MOCK_MODE is "true".
 */

type ScriptedReply = {
  answer: string;
  facts: string[];
  suggestions: string[];
  citations: { label: string; href: string }[];
  proposals?: unknown[];
  actionProposals?: unknown[];
  flow?: {
    type: "crew_offer" | "select_package" | "select_questionnaire";
    projectId?: string | null;
    reason?: string | null;
    subject?: string | null;
  } | null;
};

type Script = {
  /** What the operator typed. */
  match: RegExp;
  /** Why this turn is in the script — every one is a real reported failure. */
  because: string;
  reply: (said: string) => ScriptedReply;
};

/** The words after "add " and before " as/to", trimmed — the named person. */
function namedPerson(said: string): string | null {
  const match = /\badd\s+(.+?)\s+(?:as|to)\b/i.exec(said);
  return match?.[1]?.trim() || null;
}

export const VERTEX_SCRIPTS: Script[] = [
  {
    // The turn that started all of this: asked four times in six minutes.
    match: /\b(videographer|video)\b[\s\S]*\bfor\b|\badd\b[\s\S]*\bvideographer\b/i,
    because:
      "Staffing a video role — the trade must reach the flow, not just the words",
    reply: (said) => ({
      answer: "I can offer the second videographer role on this job.",
      facts: [],
      suggestions: [],
      citations: [],
      flow: {
        type: "crew_offer",
        projectId: null,
        reason: "The operator asked to staff a videographer.",
        subject: namedPerson(said),
      },
    }),
  },
  {
    // `photog\w*` on purpose: the sentence this fixture exists to reproduce
    // reads "2nd photogrpaher". A model reads through a typo and so must the
    // script, or the one turn we know went wrong is the one it cannot replay.
    match: /\badd\b[\s\S]*\b(photog\w*|shooter|crew|second)\b/i,
    because:
      "\"add albert gershengoren to 2nd photogrpaher for erin and joe demattia\" — the exact sentence from 2026-09-19",
    reply: (said) => ({
      answer: "I can offer the second photographer role on this job.",
      facts: [],
      suggestions: [],
      citations: [],
      flow: {
        type: "crew_offer",
        projectId: null,
        reason: "The operator asked to staff a second photographer.",
        // The model never emits an identifier — it has no roster tool, so any
        // id would be invention. The operator's own words travel instead.
        subject: namedPerson(said),
      },
    }),
  },
  {
    match: /\bpackage\b/i,
    because: "A package flow, to prove subject matching is not crew-only",
    reply: (said) => ({
      answer: "I can set the package on this job.",
      facts: [],
      suggestions: [],
      citations: [],
      flow: {
        type: "select_package",
        projectId: null,
        reason: "The operator asked to choose a package.",
        subject: /\bgold\b/i.test(said) ? "Gold" : null,
      },
    }),
  },
  {
    match: /\b(questionnaire|details form|wedding details)\b/i,
    because:
      "The third flow type — a form send, so subject matching is covered on all three",
    reply: () => ({
      answer: "I can send the wedding details form.",
      facts: [],
      suggestions: [],
      citations: [],
      flow: {
        type: "select_questionnaire",
        projectId: null,
        reason: "The operator asked to send a form.",
        subject: null,
      },
    }),
  },
  {
    // The error path has to be walkable too, or the only way to see
    // "Cue could not answer" is to break production.
    match: /\bfail\b|\bbreak\b/i,
    because: "The failure path, so the error card can be seen without an outage",
    reply: () => {
      throw new Error("VERTEX_AI_COPILOT_FAILED:503:scripted failure");
    },
  },
];

/** A plain answer: facts and citations, no action, no flow. */
const DEFAULT_REPLY: ScriptedReply = {
  answer:
    "Here is where this job stands. (Scripted answer — PROVIDER_MOCK_MODE is on, so no model was called.)",
  facts: [
    "Development preview: these facts are scripted, not read from your records.",
  ],
  suggestions: ["What is still blocking it?", "Who can shoot this?"],
  citations: [],
  flow: null,
};

/**
 * Every {projectId, projectName} the real read tools have already returned.
 *
 * The script does its retrieval through the product's own tools against the
 * product's own data — the tool loop runs for real, `executeReadTool` hits
 * Firestore, and what comes back is what a model would have seen. Only the
 * choosing is scripted.
 */
function seenProjects(body: unknown): { id: string; name: string }[] {
  const found = new Map<string, string>();
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    if (typeof value !== "object" || value === null) return;
    const record = value as Record<string, unknown>;
    const id = record.projectId;
    const name = record.projectName;
    if (typeof id === "string" && typeof name === "string") found.set(id, name);
    for (const nested of Object.values(record)) visit(nested);
  };
  visit((body as Record<string, unknown>)?.contents);
  return [...found].map(([id, name]) => ({ id, name }));
}

/**
 * The project the operator named, out of what retrieval actually found.
 *
 * Normalised the way `features/ai/flow-subject.ts` normalises a person: an
 * operator types "maya and theo johnson" for a job filed as "Maya & Theo
 * Johnson", and an ampersand is not a reason to fail.
 */
function namedProject(
  said: string,
  projects: { id: string; name: string }[],
): string | null {
  const flatten = (value: string) =>
    value
      .toLocaleLowerCase()
      .replace(/&/g, " and ")
      .replace(/[^a-z0-9\s]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  const words = flatten(said);
  const hit = projects.find((project) => {
    const name = flatten(project.name);
    return name.length >= 3 && words.includes(name);
  });
  return hit?.id ?? null;
}

/** The operator's latest words, dug out of a Vertex request body. */
export function lastUserText(body: unknown): string {
  const record = (body ?? {}) as Record<string, unknown>;
  const contents = Array.isArray(record.contents) ? record.contents : [];
  for (let index = contents.length - 1; index >= 0; index -= 1) {
    const turn = (contents[index] ?? {}) as Record<string, unknown>;
    if (turn.role !== "user") continue;
    const parts = Array.isArray(turn.parts) ? turn.parts : [];
    const text = parts
      .map((part) => (part as Record<string, unknown>).text)
      .filter((value): value is string => typeof value === "string")
      .join(" ");
    if (text.trim()) return text;
  }
  return "";
}

export function scriptedReplyFor(said: string): ScriptedReply {
  for (const script of VERTEX_SCRIPTS)
    if (script.match.test(said)) return script.reply(said);
  return DEFAULT_REPLY;
}

/**
 * A Vertex-shaped response, so no caller knows the difference.
 *
 * The tool loop reads the same `generateContent` shape and stops as soon as a
 * turn carries no `functionCall` part — which a scripted answer never does, so
 * retrieval ends on the first pass and the answer is the answer.
 */
export function scriptedVertexResponse(
  body: unknown,
  method: "generateContent" | "streamGenerateContent",
): Response {
  const said = lastUserText(body);
  const reply = scriptedReplyFor(said);
  if (reply.flow && !reply.flow.projectId) {
    const resolved = namedProject(said, seenProjects(body));
    if (resolved) reply.flow = { ...reply.flow, projectId: resolved };
  }
  const text = JSON.stringify(reply);
  if (method === "generateContent") {
    return new Response(
      JSON.stringify({
        candidates: [{ content: { parts: [{ text }] }, finishReason: "STOP" }],
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }
  /**
   * Streamed in pieces on purpose.
   *
   * The reader reveals `answer` as it arrives, so a single frame would never
   * exercise the partial-JSON path that has broken before. Small chunks make
   * the offline walk look like the real one.
   */
  const frames: string[] = [];
  for (let index = 0; index < text.length; index += 24) {
    frames.push(
      `data: ${JSON.stringify({
        candidates: [
          { content: { parts: [{ text: text.slice(index, index + 24) }] } },
        ],
      })}\n\n`,
    );
  }
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const frame of frames) controller.enqueue(encoder.encode(frame));
      controller.close();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}
