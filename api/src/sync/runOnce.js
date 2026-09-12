import "dotenv/config";
import { initDb } from "../db/index.js";
import { runSync } from "./index.js";

await initDb();
const summary = await runSync();

console.log(JSON.stringify(summary, null, 2));
process.exit(summary.errors.length ? 1 : 0);
