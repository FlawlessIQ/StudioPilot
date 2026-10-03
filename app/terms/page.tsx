import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Logo } from "@/components/brand/logo";
import { LEGAL_ENTITY, TERMS_EFFECTIVE, TERMS_VERSION, legalDate } from "@/features/legal/legal";

export const metadata: Metadata = {
  title: "Terms of Service",
  description: "The terms that govern a studio's use of StudioCue: trial, subscription, cancellation, data, AI, e-signatures and liability.",
  alternates: { canonical: "/terms" },
};

/**
 * Terms of Service, version 1.0 (features/legal/legal.ts).
 *
 * Signed off by the owner for the 2026-10-05 launch; counsel reviews after
 * launch and any change ships as a new version with notice (§20 below).
 * Plain English on purpose: a photographer should be able to read it.
 */
export default function TermsPage() {
  const { name, product, addressLines, email, state } = LEGAL_ENTITY;
  return (
    <main className="ds-root legal-page" data-ds-theme="emerald">
      <header><Link href="/"><Logo /></Link><Link href="/"><ArrowLeft size={15} /> Back home</Link></header>
      <article>
        <p className="eyebrow">Version {TERMS_VERSION} · Effective {legalDate(TERMS_EFFECTIVE)}</p>
        <h1>Terms of Service</h1>
                <p className="legal-lead">These terms are an agreement between your business and {name} (&ldquo;{product},&rdquo; &ldquo;we,&rdquo; &ldquo;us&rdquo;) for your use of {product}. Please read them: they cover your trial and subscription, how to cancel, who owns your data, how our AI and e-signature features work, and the limits of our responsibility.</p>

        <h2>1. Who can use StudioCue</h2>
                <p>{product} is software for photography and video businesses (&ldquo;studios&rdquo;). By creating an account you confirm that you are at least 18, that you are using {product} for a business, and that you have authority to accept these terms for that business. &ldquo;You&rdquo; means that business and the people it allows into its workspace. Your studio&rsquo;s clients, crew and vendors may use parts of {product} at your invitation; you are responsible for inviting them appropriately.</p>

        <h2>2. Your account</h2>
                <p>Keep your account details accurate and your sign-in secure, and tell us promptly at{" "} <a href={`mailto:${email}`}>{email}</a> if you think your account has been accessed without permission. The account owner is responsible for everyone they add to the workspace and for what is done under the workspace&rsquo;s accounts. Each plan includes a set number of team members; see <Link href="/pricing">Pricing</Link>.</p>

        <h2>3. Free trial, subscription and billing</h2>
        <ul className="legal-list">
                    <li><strong>Trial.</strong> New studios get a 14-day free trial. A payment card is required to start it. Nothing is charged during the trial. One trial per business.</li>
                    <li><strong>When the trial ends, your subscription starts automatically</strong> and your card is charged the price of the plan you chose (monthly or annual) at that time, unless you cancel before the trial ends.</li>
                    <li><strong>Automatic renewal.</strong> Your subscription renews at the end of each monthly or annual period and your card is charged for the next period until you cancel.</li>
                    <li><strong>Cancelling.</strong> You can cancel at any time in <em>Settings &rarr; Plan &amp; billing</em>. Cancelling stops the next renewal; you keep access until the end of the period you have paid for.</li>
                    <li><strong>Refunds.</strong> Payments are not refunded for partial periods or unused time. If you cancel an annual plan within 14 days of its first annual charge, email <a href={`mailto:${email}`}>{email}</a> and we will refund that charge in full.</li>
                    <li><strong>Price changes.</strong> We will email the account owner at least 30 days before a price change applies to you. The new price applies from your next renewal after that notice; you can cancel before then.</li>
                    <li><strong>Taxes.</strong> Prices do not include taxes. Where we are required to collect sales or similar taxes, they are added to your invoice.</li>
                    <li><strong>Failed payments.</strong> If a payment fails, we and our payment processor will retry it and let you know. If it is still unpaid after 7 days, your workspace may become read-only (you can view and export your data, but not send anything) until payment is made. If it remains unpaid, the subscription may be cancelled.</li>
                    <li><strong>Payment processing.</strong> Subscription payments are processed by Stripe. {product} never sees or stores your full card details.</li>
        </ul>

        <h2>4. Acceptable use</h2>
        <p>You agree not to, and not to let anyone else:</p>
        <ul className="legal-list">
          <li>break any law, or use {product} to send messages people have not agreed to receive, or that are deceptive;</li>
          <li>upload content you do not have the right to use, or that is unlawful, harmful or infringes someone else&rsquo;s rights;</li>
          <li>try to get into another studio&rsquo;s data, probe or test our security without our written permission, or interfere with the service;</li>
          <li>copy, resell, reverse-engineer or build a competing product from {product}, except where the law allows it; or</li>
          <li>overload the service by automated means, or get around plan limits or usage controls.</li>
        </ul>

        <h2>5. Your content and your clients&rsquo; information</h2>
                <p><strong>You own your content.</strong> Everything you and your team put into {product} — client details, jobs, packages, agreements, documents, messages and files — remains yours. You give us permission to host, copy, process and display it only as needed to provide, secure and support {product} for you.</p>
                <p><strong>Your clients&rsquo; information.</strong> When you put information about your clients, crew or vendors into{" "} {product}, you decide what is collected and why, and we process it on your behalf. You are responsible for having a lawful basis to use it and for giving them any notices or obtaining any consents the law requires. When we process it for you, we will:</p>
        <ul className="legal-list">
          <li>use it only to provide, secure and support {product} for you, and as you instruct through the product;</li>
          <li>keep it confidential and limit access to people who need it to do that;</li>
          <li>protect it with appropriate technical and organizational security measures;</li>
          <li>use only the service providers listed on our <Link href="/subprocessors">subprocessors page</Link>, under terms that protect the data, and update that page before adding a new one;</li>
          <li>help you respond to requests from people to access, correct or delete their information;</li>
          <li>tell you without undue delay if we become aware of a security breach affecting it; and</li>
          <li>delete it when your account closes, as described in section 14.</li>
        </ul>
                <p>We may use information about how {product} is used, in a form that does not identify you or your clients, to operate and improve the service. We do not sell your content or your clients&rsquo; information.</p>

        <h2>6. AI features</h2>
                <p>{product} includes AI-assisted features, such as drafted replies, proposals, schedules and summaries, which run on Google&rsquo;s Gemini models inside our own Google Cloud project. AI output can be wrong or incomplete. It is a draft for you to check: you decide what is sent and you are responsible for it. AI never signs, takes payment, grants permissions or marks anything complete on its own. We do not use your content to train AI models. AI actions count toward your plan&rsquo;s monthly allowance.</p>

        <h2>7. Electronic signatures and your agreements</h2>
                <p>{product} lets you prepare agreements and have them signed electronically by you and your clients. Electronic signatures made through {product} are intended to be valid under the U.S. Electronic Signatures in Global and National Commerce Act (ESIGN) and state laws based on the Uniform Electronic Transactions Act. For each signature we keep an evidence record (the typed name, the signer&rsquo;s email, the time, IP address and device, the consent agreed to, and a fingerprint of the exact agreement), as described in our <Link href="/privacy">Privacy Policy</Link>.</p>
                <p>Any agreement you send is between you and your client. {product} is not a party to it, does not provide legal advice, and does not review your wording. You are responsible for the content of your agreements and for their compliance with the laws that apply to you and your clients, including consumer-protection laws. Starter text we provide is a convenience, not legal advice; have your own agreement reviewed by a lawyer.</p>

        <h2>8. Payments between you and your clients</h2>
                <p>{product} can create and track invoices through accounting services you connect, such as QuickBooks Online.{" "} {product} is not a bank, payment processor or money transmitter, and never receives or holds your clients&rsquo; payments. Payments, refunds and disputes between you and your clients are between you and them, and are governed by your agreements with them and the terms of the payment service you use. You are responsible for your prices, taxes and invoice settings.</p>

        <h2>9. Services you connect</h2>
                <p>You can connect services such as Google Calendar, Zoom, QuickBooks Online and Dropbox. When you do, you authorize us to access them on your behalf to provide the connected features, and your use of them is governed by their own terms. We are not responsible for those services or for changes they make. You can disconnect a service at any time in{" "} <em>Settings &rarr; Integrations</em>.</p>

        <h2>10. Children and minors</h2>
                <p>{product} is for businesses and their adult clients. We do not create accounts for children, message children directly, use facial recognition or publish profiles of children. When your work involves minors — for example, family sessions or youth sports — the parent, guardian or organization is your client, and you are responsible for obtaining any consents and releases the law requires.</p>

        <h2>11. Availability and support</h2>
                <p>We work to keep {product} available and secure, but we do not guarantee that it will be uninterrupted or error-free, and we do not offer a service-level agreement. We may carry out maintenance, which we will try to schedule to limit disruption. Support is available at <a href={`mailto:${email}`}>{email}</a>. Keep your own copies of anything you cannot afford to lose; you can export your data at any time.</p>

        <h2>12. Changes to StudioCue</h2>
                <p>We improve {product} continually and may add, change or remove features. If we remove a core feature of your paid plan during a period you have paid for, we will tell you in advance and, if you cancel because of it, refund the unused part of that period.</p>

        <h2>13. Our intellectual property</h2>
                <p>{product}, including its software, design, text and the starter content we provide, belongs to {name} and its licensors. We give you a limited, non-exclusive, non-transferable right to use it for your business while your subscription is active. If you send us suggestions, we may use them without obligation to you.</p>

        <h2>14. Suspension, cancellation and closing an account</h2>
                <p>You can cancel at any time (section 3). We may suspend or close your account if you seriously or repeatedly break these terms, if your payment remains overdue, if you put the service or other studios at risk, or if the law requires it. We will give notice where it is practical and lawful to do so.</p>
                <p>When your account closes, you have 30 days to export your data. After that we delete your workspace data, and any remaining copies in our backups expire within 90 days. We may keep records we are required to keep by law, such as billing records, and the security and evidence records described in our Privacy Policy, for as long as the law requires.</p>

        <h2>15. Disclaimers</h2>
                <p>Except as expressly stated in these terms, {product} is provided &ldquo;as is&rdquo; and &ldquo;as available.&rdquo; To the fullest extent the law allows, we disclaim all implied warranties, including merchantability, fitness for a particular purpose and non-infringement. {product} does not provide legal, tax, accounting or insurance advice, and readiness checks, reminders and AI output do not replace your own judgment.</p>

        <h2>16. Limitation of liability</h2>
                <p>To the fullest extent the law allows: (a) neither party is liable to the other for indirect, incidental, special, consequential or punitive damages, or for lost profits, revenue, goodwill or data, however caused; and (b) each party&rsquo;s total liability arising out of or relating to these terms or {product} is limited to the amount you paid us for {product} in the 12 months before the event giving rise to the claim (or US $100 if you have paid nothing). These limits do not apply to your payment obligations, to your obligations under section 17, or where the law does not allow liability to be limited.</p>

        <h2>17. Indemnity</h2>
                <p>You will defend and indemnify {name} against third-party claims, and related losses and reasonable legal costs, arising from your content, your agreements and dealings with your clients, crew and vendors, messages you send through{" "} {product}, or your breach of these terms or the law.</p>

        <h2>18. Disputes and governing law</h2>
                <p>If a dispute arises, please contact us first at <a href={`mailto:${email}`}>{email}</a>; we will try in good faith to resolve it within 30 days. These terms are governed by the laws of the State of {state}, without regard to its conflict-of-laws rules. Any dispute that is not resolved informally will be decided exclusively by the state or federal courts located in {state}, and both parties consent to their jurisdiction. Either party may instead bring an individual claim in small-claims court where it qualifies.</p>

        <h2>19. General</h2>
                <p>These terms, together with the <Link href="/privacy">Privacy Policy</Link> and any plan details shown at checkout, are the whole agreement between you and us about {product}. If any part is found unenforceable, the rest remains in effect. Not enforcing a right is not a waiver of it. You may not transfer these terms without our consent; we may transfer them as part of a merger, acquisition or sale of assets, with notice to you. Neither party is responsible for delays caused by events beyond its reasonable control. We send notices to the account owner&rsquo;s email address; you can send notices to <a href={`mailto:${email}`}>{email}</a> or by post to the address below.</p>

        <h2>20. Changes to these terms</h2>
                <p>We may update these terms. For a material change we will email the account owner and show a notice in {product} at least 30 days before it takes effect. If you do not agree, you can cancel before the change takes effect; continuing to use {product} after that date means you accept the updated terms. The version and effective date are shown at the top of this page.</p>

        <h2>21. Contact</h2>
        <p>
          {name}<br />
          {addressLines.map((line) => (
            <span key={line}>
              {line}
              <br />
            </span>
          ))}
          <a href={`mailto:${email}`}>{email}</a>
        </p>
      </article>
    </main>
  );
}
