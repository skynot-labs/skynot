import { existsSync } from "node:fs";

// Imported first by every entry, before anything reads the environment. A variable already set wins over the file.
if (existsSync(".env")) process.loadEnvFile(".env");
