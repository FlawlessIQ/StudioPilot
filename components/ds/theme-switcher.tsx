"use client";

import { useEffect, useState } from "react";

/**
 * Preview-only palette switcher. Swaps `data-ds-theme` on the `.ds-root`
 * element so the whole design system re-themes from CSS variables alone.
 */
const THEMES = [
  { id: "ivory", label: "Warm ivory", swatch: "#7c2f3b" },
  { id: "rose", label: "White · Rose", swatch: "#e23a60" },
  { id: "coral", label: "White · Coral", swatch: "#ff6a4d" },
  { id: "emerald", label: "White · Emerald", swatch: "#12c084" },
] as const;

export function ThemeSwitcher({ initial = "rose" }: { initial?: string }) {
  const [theme, setTheme] = useState(initial);

  useEffect(() => {
    const root = document.querySelector<HTMLElement>(".ds-root");
    if (root) root.setAttribute("data-ds-theme", theme);
  }, [theme]);

  return (
    <div className="ds-theme-switch" role="group" aria-label="Preview color scheme">
      {THEMES.map((t) => (
        <button
          key={t.id}
          type="button"
          data-on={theme === t.id ? "true" : "false"}
          onClick={() => setTheme(t.id)}
          aria-pressed={theme === t.id}
        >
          <span className="ds-theme-swatch" style={{ background: t.swatch }} />
          <span>{t.label}</span>
        </button>
      ))}
    </div>
  );
}
