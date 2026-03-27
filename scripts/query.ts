import dotenv from "dotenv";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, "../.env") });

import { hybridSearch } from "../src/core/retrieval.js";
import { listResources, getResource } from "../src/models/resource.js";
import { formatTagsWithTickets } from "../src/utils/tickets.js";

function parseArgs() {
  const args = process.argv.slice(2);

  const getFlag = (prefix: string) =>
    args.find((a) => a.startsWith(prefix))?.split("=")[1];

  const hasFlag = (flag: string) => args.includes(flag);

  const brain = getFlag("--brain=");
  const tags = getFlag("--tags=")?.split(",").filter(Boolean);
  const collection = getFlag("--collection=");
  const limitRaw = getFlag("--limit=");
  const limit = limitRaw ? parseInt(limitRaw, 10) : 10;
  const getId = getFlag("--get=");
  const isList = hasFlag("--list");
  const isFull = hasFlag("--full");
  const query = args.find((a) => !a.startsWith("--"));

  return { brain, tags, collection, limit, getId, isList, isFull, query };
}

async function runSearch(opts: ReturnType<typeof parseArgs>) {
  if (!opts.query) {
    console.error("Usage: npm run query -- \"<search term>\" [--tags=a,b] [--collection=x] [--limit=10] [--brain=name]");
    process.exit(1);
  }

  const results = await hybridSearch({
    query: opts.query,
    tags: opts.tags,
    collection: opts.collection,
    limit: opts.limit,
    brain: opts.brain,
  });

  if (results.length === 0) {
    console.log("No results found.");
    return;
  }

  if (opts.isFull) {
    console.log(`Found ${results.length} result(s) — fetching full documents:\n`);
    for (const r of results) {
      const resource = await getResource(r.resourceId, opts.brain);
      if (!resource) continue;
      const separator = "=".repeat(resource.title.length);
      console.log(resource.title);
      console.log(separator);
      console.log(`ID:     ${resource.id}`);
      console.log(`Score:  ${r.score.toFixed(4)} (${r.matchType})`);
      console.log(`Tags:   ${formatTagsWithTickets(resource.tags)}`);
      if (resource.sourcePath) console.log(`Source: ${resource.sourcePath}`);
      console.log();
      console.log(resource.content);
      console.log("\n" + "-".repeat(40) + "\n");
    }
    return;
  }

  console.log(`Found ${results.length} result(s):\n`);
  results.forEach((r, i) => {
    const truncated = r.content.length > 500 ? r.content.slice(0, 500) + "..." : r.content;
    console.log(`${i + 1}. ${r.title}`);
    console.log(`   ID: ${r.resourceId}`);
    console.log(`   Score: ${r.score.toFixed(4)}`);
    console.log(`   Match: ${r.matchType}`);
    console.log(`   Tags: ${formatTagsWithTickets(r.tags)}`);
    console.log(`   ${truncated}`);
    console.log();
  });
}

async function runList(opts: ReturnType<typeof parseArgs>) {
  const resources = await listResources({
    tags: opts.tags,
    collection: opts.collection,
    limit: opts.limit,
    brain: opts.brain,
  });

  if (resources.length === 0) {
    console.log("No resources found.");
    return;
  }

  console.log(`${resources.length} resource(s):\n`);
  resources.forEach((r) => {
    const date = r.updatedAt || r.createdAt;
    console.log(`- ${r.title}`);
    console.log(`  ID: ${r.id}`);
    console.log(`  Type: ${r.type}`);
    console.log(`  Tags: ${formatTagsWithTickets(r.tags)}`);
    console.log(`  Date: ${date}`);
    console.log();
  });
}

async function runGet(opts: ReturnType<typeof parseArgs>) {
  if (!opts.getId) {
    console.error("Usage: npm run query -- --get=<id> [--brain=name]");
    process.exit(1);
  }

  const resource = await getResource(opts.getId, opts.brain);

  if (!resource) {
    console.error(`Not found: ${opts.getId}`);
    process.exit(1);
  }

  console.log(`${resource.title}`);
  console.log(`${"=".repeat(resource.title.length)}`);
  console.log(`ID:     ${resource.id}`);
  console.log(`Type:   ${resource.type}`);
  console.log(`Tags:   ${formatTagsWithTickets(resource.tags)}`);
  if (resource.sourcePath) console.log(`Source: ${resource.sourcePath}`);
  console.log(`Date:   ${resource.updatedAt || resource.createdAt}`);
  console.log();
  console.log(resource.content);
}

async function main() {
  const opts = parseArgs();

  if (opts.getId) {
    await runGet(opts);
  } else if (opts.isList) {
    await runList(opts);
  } else {
    await runSearch(opts);
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Error:", err);
    process.exit(1);
  });
