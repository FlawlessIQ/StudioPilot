import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { RegisterServiceWorker } from "@/components/pwa/register-service-worker";
import { ErrorReporter } from "@/components/observability/error-reporter";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"),
  title: {
    default: "StudioCue · Photography Operations OS",
    template: "%s · StudioCue",
  },
  description:
    "StudioCue coordinates clients, payments, documents, schedules, crew, and event readiness for professional photography teams.",
  applicationName: "StudioCue",
  manifest: "/manifest.webmanifest",
  openGraph: {
    title: "StudioCue · From inquiry to gallery.",
    description:
      "One calm workflow for clients, booking, planning, crew, and delivery—with AI where the repetitive work happens.",
    type: "website",
    images: [
      {
        url: "/og.png",
        width: 1755,
        height: 896,
        alt: "StudioCue — From inquiry to gallery. One calm workflow.",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "StudioCue · From inquiry to gallery.",
    description:
      "One calm workflow for clients, booking, planning, crew, and delivery—with AI where the repetitive work happens.",
    images: ["/og.png"],
  },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html data-scroll-behavior="smooth" lang="en">
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
        <ErrorReporter />
        <RegisterServiceWorker />
        {children}
      </body>
    </html>
  );
}
