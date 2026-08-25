import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";

/**
 * Reply-address minting and verification. This is the check that stands between a
 * guessed address and writing into another studio's conversation, so it is worth
 * testing rather than eyeballing.
 *
 * The secret is set here before importing the module, because it reads
 * process.env at call time through a helper — the import order still matters for
 * clarity about what is being exercised.
 */
process.env.INBOUND_REPLY_SIGNING_SECRET =
  "0123456789abcdef0123456789abcdef0123456789abcdef";
process.env.SENDGRID_INBOUND_DOMAIN = "inbound.studio-cue.com";

const {
  conversationIdFromReplyToken,
  inboundRepliesEnabled,
  replyAddressFor,
} = await import("../functions/src/communications/reply-address");

const CONVERSATION = "conv_0d8c299443de9f85";

function tokenOf(address: string): string {
  return address.slice("reply+".length, address.indexOf("@"));
}

test("inbound replies are enabled once the secret and domain are set", () => {
  assert.equal(inboundRepliesEnabled(), true);
});

test("an address round-trips to the conversation it was minted for", () => {
  const address = replyAddressFor(CONVERSATION);
  assert.ok(address);
  assert.match(String(address), /^reply\+[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+@inbound\.studio-cue\.com$/);
  assert.equal(conversationIdFromReplyToken(tokenOf(String(address))), CONVERSATION);
});

test("the token is short enough not to alarm a client", () => {
  const token = tokenOf(String(replyAddressFor(CONVERSATION)));
  // 11 characters of id, a dot, 11 of signature. The first format was 45.
  assert.equal(token.length, 23);
  assert.ok(token.length < 30, `token was ${token.length} characters`);
});

test("a forged signature does not resolve", () => {
  const token = tokenOf(String(replyAddressFor(CONVERSATION)));
  const [encoded] = token.split(".");
  assert.equal(conversationIdFromReplyToken(`${encoded}.AAAAAAAAAAA`), null);
});

test("one thread's token never resolves to another thread", () => {
  const mine = tokenOf(String(replyAddressFor(CONVERSATION)));
  const other = tokenOf(String(replyAddressFor("conv_ffffffffffffffff")));
  assert.notEqual(mine, other);
  assert.equal(conversationIdFromReplyToken(other), "conv_ffffffffffffffff");
  assert.notEqual(conversationIdFromReplyToken(other), CONVERSATION);
});

test("swapping the id while keeping a valid signature is rejected", () => {
  const token = tokenOf(String(replyAddressFor(CONVERSATION)));
  const signature = token.slice(token.lastIndexOf(".") + 1);
  const otherId = Buffer.from("ffffffffffffffff", "hex").toString("base64url");
  assert.equal(conversationIdFromReplyToken(`${otherId}.${signature}`), null);
});

test("malformed tokens are refused rather than throwing", () => {
  for (const bad of ["", ".", "nodot", "a.b", "....", "!!!.???"]) {
    assert.equal(conversationIdFromReplyToken(bad), null, bad);
  }
});

test("a conversation id that is not the expected shape mints nothing", () => {
  assert.equal(replyAddressFor("not-a-conversation"), null);
  assert.equal(replyAddressFor("conv_TOOSHORT"), null);
  assert.equal(replyAddressFor(""), null);
});

test("addresses already sent in the old format still verify", () => {
  // Reproduces the first shipped format: base64url of the whole id string, with
  // a 16-character hex signature. Mail sent before the change carries this, and
  // a client replying to it must still reach their thread.
  const legacyEncoded = Buffer.from(CONVERSATION, "utf8").toString("base64url");
  const legacySignature = createHmac(
    "sha256",
    String(process.env.INBOUND_REPLY_SIGNING_SECRET),
  )
    .update(CONVERSATION)
    .digest("hex")
    .slice(0, 16);
  assert.equal(
    conversationIdFromReplyToken(`${legacyEncoded}.${legacySignature}`),
    CONVERSATION,
  );
  // And a legacy token with a bad signature is still refused.
  assert.equal(
    conversationIdFromReplyToken(`${legacyEncoded}.0000000000000000`),
    null,
  );
});

test("nothing is minted without a signing secret", async () => {
  const saved = process.env.INBOUND_REPLY_SIGNING_SECRET;
  delete process.env.INBOUND_REPLY_SIGNING_SECRET;
  try {
    assert.equal(replyAddressFor(CONVERSATION), null);
    assert.equal(inboundRepliesEnabled(), false);
    // Fails closed on verification too, rather than trusting an unsigned token.
    assert.equal(conversationIdFromReplyToken("anything.anything"), null);
  } finally {
    process.env.INBOUND_REPLY_SIGNING_SECRET = saved;
  }
});

test("a short secret is treated as no secret", () => {
  const saved = process.env.INBOUND_REPLY_SIGNING_SECRET;
  process.env.INBOUND_REPLY_SIGNING_SECRET = "tooshort";
  try {
    assert.equal(replyAddressFor(CONVERSATION), null);
  } finally {
    process.env.INBOUND_REPLY_SIGNING_SECRET = saved;
  }
});
