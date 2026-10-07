import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";
import { EXPLAINERS } from "@/features/help/explainers";

const publicRoutes: Array<{
  path: string;
  changeFrequency: NonNullable<MetadataRoute.Sitemap[number]["changeFrequency"]>;
  priority: number;
}> = [
  { path: "/", changeFrequency: "weekly", priority: 1 },
  { path: "/office-manager", changeFrequency: "monthly", priority: 0.9 },
  { path: "/virtual-assistant-for-photographers", changeFrequency: "monthly", priority: 0.8 },
  { path: "/features", changeFrequency: "monthly", priority: 0.9 },
  { path: "/pricing", changeFrequency: "monthly", priority: 0.9 },
  { path: "/integrations", changeFrequency: "monthly", priority: 0.8 },
  { path: "/wedding-photographers", changeFrequency: "monthly", priority: 0.8 },
  { path: "/corporate-photographers", changeFrequency: "monthly", priority: 0.8 },
  { path: "/sports-photographers", changeFrequency: "monthly", priority: 0.8 },
  { path: "/for-crew", changeFrequency: "monthly", priority: 0.7 },
  { path: "/for-clients", changeFrequency: "monthly", priority: 0.7 },
  { path: "/how-to", changeFrequency: "weekly", priority: 0.7 },
  { path: "/how-to/wedding-journey", changeFrequency: "monthly", priority: 0.7 },
  { path: "/how-to/glossary", changeFrequency: "monthly", priority: 0.5 },
  ...EXPLAINERS.map((guide) => ({
    path: `/how-to/${guide.id}`,
    changeFrequency: "monthly" as const,
    priority: 0.6,
  })),
  { path: "/about", changeFrequency: "monthly", priority: 0.6 },
  { path: "/demo", changeFrequency: "monthly", priority: 0.7 },
  { path: "/support", changeFrequency: "monthly", priority: 0.5 },
  { path: "/privacy", changeFrequency: "yearly", priority: 0.3 },
  { path: "/terms", changeFrequency: "yearly", priority: 0.3 },
  { path: "/subprocessors", changeFrequency: "yearly", priority: 0.2 },
  { path: "/legal", changeFrequency: "yearly", priority: 0.3 },
  { path: "/legal/dpa", changeFrequency: "yearly", priority: 0.2 },
  { path: "/legal/acceptable-use", changeFrequency: "yearly", priority: 0.2 },
  { path: "/legal/cookies", changeFrequency: "yearly", priority: 0.2 },
  { path: "/legal/client-terms", changeFrequency: "yearly", priority: 0.2 },
  { path: "/legal/esign", changeFrequency: "yearly", priority: 0.2 },
  { path: "/legal/copyright", changeFrequency: "yearly", priority: 0.2 },
];

export default function sitemap(): MetadataRoute.Sitemap {
  return publicRoutes.map(({ path, changeFrequency, priority }) => ({
    url: `${SITE_URL}${path}`,
    lastModified: new Date(),
    changeFrequency,
    priority,
  }));
}
