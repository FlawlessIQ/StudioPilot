import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, Fraunces, Instrument_Sans } from "next/font/google";
import { RegisterServiceWorker } from "@/components/pwa/register-service-worker";
import { ErrorReporter } from "@/components/observability/error-reporter";
import { AttributionCapture } from "@/components/growth/attribution-capture";
import { IconButtonTitles } from "@/components/ui/icon-button-titles";
import { SITE_URL } from "@/lib/site";
// No stylesheets here: each section's layout imports ./app-styles, so the
// public inquiry form can load a small sheet of its own (H5).

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// Editorial redesign type system: Fraunces (display serif) + Instrument Sans (UI).
const fraunces = Fraunces({
  variable: "--font-fraunces",
  subsets: ["latin"],
  display: "swap",
  style: ["normal", "italic"],
});

const instrumentSans = Instrument_Sans({
  variable: "--font-instrument",
  subsets: ["latin"],
  display: "swap",
});

const faviconVersion = "cue-mark-20260818";

// viewport-fit=cover is what actually lets env(safe-area-inset-*) resolve to the
// notch/home-bar insets the mobile shell pads against — without it the bottom tab
// bar and topbar would sit under the device chrome when installed.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#1E2521",
};

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: "StudioCue · The office manager for photography studios",
    template: "%s · StudioCue",
  },
  description:
    "StudioCue (Studio Cue) gives a photography studio Cue, an office manager that works every hour: inquiries, agreements, invoices, planning, crew and insurance certificates, from inquiry to gallery, with anything that matters waiting for your yes.",
  applicationName: "StudioCue",
  manifest: "/manifest.webmanifest",
  // Installed to the home screen, StudioCue runs standalone (no browser chrome).
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "StudioCue",
  },
  openGraph: {
    title: "StudioCue · Meet Cue, your studio's office manager.",
    description:
      "Cue answers inquiries, sends the paperwork, chases the certificate and lines up your crew, at any hour. Anything that matters waits for your yes.",
    type: "website",
    images: [
      {
        url: "/og.png",
        width: 1755,
        height: 896,
        alt: "StudioCue — Meet Cue, your studio's office manager.",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "StudioCue · Meet Cue, your studio's office manager.",
    description:
      "Cue answers inquiries, sends the paperwork, chases the certificate and lines up your crew, at any hour. Anything that matters waits for your yes.",
    images: ["/og.png"],
  },
  icons: {
    icon: [
      { url: `/favicon.svg?v=${faviconVersion}`, type: "image/svg+xml" },
      {
        url: `/brand/favicon-32.png?v=${faviconVersion}`,
        sizes: "32x32",
        type: "image/png",
      },
    ],
    shortcut: `/favicon.ico?v=${faviconVersion}`,
    apple: `/apple-touch-icon.png?v=${faviconVersion}`,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html data-scroll-behavior="smooth" lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} ${fraunces.variable} ${instrumentSans.variable} antialiased`}
      >
        <ErrorReporter />
        <AttributionCapture />
        <RegisterServiceWorker />
        <IconButtonTitles />
        {children}
      </body>
    </html>
  );
}
