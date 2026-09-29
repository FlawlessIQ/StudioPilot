"use client";

import { useState } from "react";
import {
  Bell,
  CalendarDays,
  Check,
  FileText,
  Home,
  ListChecks,
  Mail,
  MapPin,
  MessageCircle,
  Phone,
  ShieldCheck,
} from "lucide-react";
import {
  Actions,
  AppBar,
  Button,
  ButtonRow,
  Card,
  Choices,
  Field,
  KitRoot,
  List,
  Main,
  Note,
  Pill,
  PoweredBy,
  Row,
  Screen,
  Steps,
  TabBar,
  TextArea,
  Toggle,
  type Studio,
} from "@/components/kit/kit";
import { studioTheme } from "@/features/design/studio-theme";

const swatches = [
  { label: "Forest", color: "#2D5A45" },
  { label: "Claret", color: "#7C2F3B" },
  { label: "Navy", color: "#1F3A5F" },
  { label: "Blush (too pale)", color: "#F2B8C6" },
  { label: "Gold (too pale)", color: "#E3B23C" },
];

/**
 * Every kit component on one phone-width page, in a studio's colours.
 * `/kit?color=%23F2B8C6` shows how a pale brand colour is darkened until it
 * reads; the note under the swatches says when that happened.
 */
export function KitPreview({ initialColor }: { initialColor: string | null }) {
  const [color, setColor] = useState(initialColor ?? "#2D5A45");
  const [type, setType] = useState<"wedding" | "elopement" | "other">("wedding");
  const [coi, setCoi] = useState<"yes" | "no" | "unsure">("unsure");
  const [autopay, setAutopay] = useState(true);
  const theme = studioTheme(color);
  const studio: Studio = { name: "FlawlessIQ", color };

  return (
    <KitRoot studio={studio}>
      <Screen>
        <AppBar
          action={
            <button aria-label="Notifications" className="kit-icon-button" type="button">
              <Bell aria-hidden="true" size={22} />
            </button>
          }
          studio={studio}
        />
        <Main label="Kit preview">
          <div className="kit-stack-tight">
            <p className="kit-eyebrow">StudioCue mobile kit</p>
            <h1 className="kit-title">Every piece, in the studio&rsquo;s colour</h1>
            <p className="kit-body">
              Pick a studio colour. Pale colours are darkened until buttons and links read
              clearly.
            </p>
          </div>

          <div className="kit-chip-list" role="group" aria-label="Studio colour">
            {swatches.map((swatch) => (
              <button
                aria-pressed={swatch.color === color}
                className="kit-chip"
                key={swatch.color}
                onClick={() => setColor(swatch.color)}
                type="button"
              >
                {swatch.label}
              </button>
            ))}
          </div>
          <Note icon={theme.adjusted ? ShieldCheck : Check} tone="accent">
            {theme.adjusted
              ? `Studio colour ${color.toUpperCase()} is too pale to read, so buttons use ${theme.accent}.`
              : `Studio colour ${theme.accent} is used exactly as given.`}
          </Note>

          <Steps step={2} total={3} />

          <section className="kit-stack">
            <h2 className="kit-section">Fields</h2>
            <Field autoComplete="name" defaultValue="Harper Lane" label="Your name" name="name" />
            <Field
              autoComplete="email"
              defaultValue="harper.lane@example.com"
              icon={Mail}
              inputMode="email"
              label="Email"
              name="email"
              type="email"
            />
            <Field
              error="That number looks short."
              icon={Phone}
              inputMode="tel"
              label="Phone"
              name="phone"
              type="tel"
              defaultValue="518 555"
            />
            <Field icon={CalendarDays} label="Wedding date" name="date" type="date" />
            <TextArea
              hint="A few lines is plenty."
              label="What matters most?"
              name="story"
              rows={4}
            />
          </section>

          <section className="kit-stack">
            <h2 className="kit-section">Choices</h2>
            <Choices
              legend="Type of day"
              onChange={(next) => setType(next as typeof type)}
              options={[
                { value: "wedding", label: "Wedding" },
                { value: "elopement", label: "Elopement" },
                { value: "other", label: "Other" },
              ]}
              value={type}
            />
            <Choices
              legend="Does your venue ask for our insurance certificate?"
              onChange={(next) => setCoi(next as typeof coi)}
              options={[
                { value: "yes", label: "Yes" },
                { value: "no", label: "No" },
                { value: "unsure", label: "Not sure" },
              ]}
              value={coi}
            />
          </section>

          <section className="kit-stack">
            <h2 className="kit-section">Cards and rows</h2>
            <Card tone="accent">
              <p className="kit-eyebrow" style={{ color: "var(--kit-accent)" }}>
                Your next step
              </p>
              <h3 className="kit-subsection">Your proposal is ready</h3>
              <p className="kit-body">Review it, add anything you&rsquo;d like, then sign.</p>
              <Button href="#">Review proposal</Button>
            </Card>
            <List label="Example rows">
              <Row href="#" icon={CalendarDays} subtitle="Wedding · 2 photographers" title="Sat, May 15, 2027" />
              <Row icon={MapPin} subtitle="Hudson, NY" title="Oak Hill Barn" trailing={<Pill>1 h 40 min</Pill>} />
              <Row
                icon={Check}
                subtitle="We'll remind you 7 days before"
                title="Pay the balance automatically"
                trailing={<Toggle checked={autopay} label="Pay automatically" onChange={setAutopay} />}
              />
            </List>
            <div className="kit-chip-list">
              <Pill>Due Apr 30</Pill>
              <Pill tone="accent" icon={Check}>
                Works offline
              </Pill>
              <Pill tone="danger">Overdue</Pill>
            </div>
            <Note icon={ShieldCheck}>Only your photographers see this answer.</Note>
          </section>

          <section className="kit-stack">
            <h2 className="kit-section">Buttons</h2>
            <Button>Primary action</Button>
            <Button variant="secondary">Secondary</Button>
            <Button variant="dark">Pay with Apple Pay</Button>
            <Button variant="soft">Email me a sign-in link</Button>
            <Button variant="danger">Decline</Button>
            <Button disabled>Not yet</Button>
          </section>
          <PoweredBy />
        </Main>
        <Actions note="One primary action per screen, in the thumb zone.">
          <ButtonRow>
            <Button size="compact" variant="secondary">
              Back
            </Button>
            <Button>Continue</Button>
          </ButtonRow>
        </Actions>
        <TabBar
          active="Home"
          tabs={[
            { href: "/kit", label: "Home", icon: Home },
            { href: "/kit", label: "Plan", icon: ListChecks },
            { href: "/kit", label: "Messages", icon: MessageCircle },
            { href: "/kit", label: "Files", icon: FileText },
          ]}
        />
      </Screen>
    </KitRoot>
  );
}
