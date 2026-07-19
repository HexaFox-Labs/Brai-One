#!/usr/bin/env node

import { collectDeveloperFacts } from "./host-facts.js";
import { evaluateDeveloperPreflight } from "./preflight.js";

const CHECKOUT = "/srv/projects/brai-new";

const result = evaluateDeveloperPreflight(
  await collectDeveloperFacts(CHECKOUT),
);
process.stdout.write(`${JSON.stringify(result)}\n`);
