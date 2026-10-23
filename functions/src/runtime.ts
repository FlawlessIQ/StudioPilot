import { setGlobalOptions } from "firebase-functions/v2/options";

// 512MiB, not the 256MiB default: every function loads the whole bundle, and
// that alone took ~190MB on 2026-10-22. Each feature ate into what was left,
// and running out would crash every function at start — an outage like that
// day's. Functions that ask for more keep their own setting.
setGlobalOptions({ region: "us-east4", memory: "512MiB" });
