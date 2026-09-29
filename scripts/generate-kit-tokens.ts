import { writeFileSync } from "node:fs";
import { kitTokensCss } from "@/features/design/kit-tokens-css";

// Regenerates app/kit-tokens.css from design/tokens.json.
writeFileSync(`${process.cwd()}/app/kit-tokens.css`, kitTokensCss());
console.log("Wrote app/kit-tokens.css");
