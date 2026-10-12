import "../../src/app/env-file";

process.stdout.write(process.env.SKYNOT_SETUP_PROBE ?? "none");
