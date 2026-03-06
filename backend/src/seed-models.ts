/**
 * Seed script: insert AI model data into the database.
 *
 * Usage:
 *   bun run src/seed-models.ts [path/to/models.json]
 *
 * If no path is provided, uses models.example.json in the same directory.
 *
 * The JSON file should follow the same structure as models.example.json:
 * {
 *   "providers": [
 *     {
 *       "name": "dashscope",
 *       "label": "...",
 *       "models": [
 *         {
 *           "model_name": "qwen-plus",
 *           "capabilities": { ... },
 *           "enabled": "Y"
 *         }
 *       ]
 *     }
 *   ]
 * }
 */

import { readFileSync } from "fs";
import path from "path";
import { createAiModel, getAiModels } from "./db";

const configPath = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(path.dirname(new URL(import.meta.url).pathname), "..", "models.example.json");

console.log(`Loading models from: ${configPath}`);

interface ModelEntry {
  model_name: string;
  display_name?: string;
  capabilities?: Record<string, boolean>;
  enabled?: "Y" | "N";
}

interface ProviderEntry {
  name: string;
  label?: string;
  models: ModelEntry[];
}

interface ModelsConfig {
  providers: ProviderEntry[];
}

let config: ModelsConfig;
try {
  const raw = readFileSync(configPath, "utf-8");
  config = JSON.parse(raw);
} catch (e) {
  console.error("Failed to read or parse config file:", e);
  process.exit(1);
}

// Build set of existing model names to avoid duplicates
const existing = getAiModels();
const existingNames = new Set(existing.map((m) => m.model_name));

let inserted = 0;
let skipped = 0;

for (const provider of config.providers) {
  for (const model of provider.models) {
    if (existingNames.has(model.model_name)) {
      console.log(`  SKIP  ${model.model_name} (${provider.name}) — already exists`);
      skipped++;
      continue;
    }
    createAiModel({
      model_name: model.model_name,
      display_name: model.display_name,
      provider: provider.name,
      capabilities: model.capabilities ?? {},
      enabled: model.enabled ?? "Y",
    });
    console.log(`  INSERT ${model.model_name} (${provider.name}) display=${model.display_name ?? model.model_name} — enabled=${model.enabled ?? "Y"}`);
    inserted++;
  }
}

console.log(`\nDone. Inserted: ${inserted}, Skipped: ${skipped}`);
