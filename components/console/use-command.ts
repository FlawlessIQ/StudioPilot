"use client";

import { useCallback, useState } from "react";
import { friendlyError } from "@/lib/ai/friendly-error";
import { runConsoleCommand } from "@/lib/console/command-client";
import { useConsole } from "./console-context";

/**
 * Run a Console command with a busy state and a toast that says what
 * happened. `done` writes the success toast from the result, so it can name
 * the thing that changed ("Trial extended to 18 Oct") rather than "Saved".
 */
export function useCommand() {
  const { toast } = useConsole();
  const [busy, setBusy] = useState<string | null>(null);
  const run = useCallback(
    async <Result = Record<string, unknown>>(
      type: string,
      input: Record<string, unknown>,
      options: { done?: string | ((result: Result) => string); failed?: string; quiet?: boolean } = {},
    ): Promise<Result | null> => {
      setBusy(type);
      try {
        const result = await runConsoleCommand<Result>(type, input);
        if (!options.quiet) {
          const message = typeof options.done === "function" ? options.done(result) : options.done;
          if (message) toast(message, "ok");
        }
        return result;
      } catch (caught) {
        toast(friendlyError(caught, options.failed ?? "That didn't go through. Nothing was changed."), "bad");
        return null;
      } finally {
        setBusy(null);
      }
    },
    [toast],
  );
  return { run, busy };
}
