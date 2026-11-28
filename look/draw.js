// Asks the image model to draw every frame in every variant. Resumable: a drawing
// that exists is skipped. Prints each call's cost from its token counts.
//
//   node look/draw.js render/out/phase1 look/out/v1 [--variant k] [--only frame:variant,...] [--size 1K|2K] [--dry-run]
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { VARIANTS, buildPrompt } from "./prompts.js";

const here = dirname(fileURLToPath(import.meta.url));
const MODEL = "gemini-3-pro-image";
const CONCURRENCY = 4;
const RETRIES = 2;
const PRICE_PER_IMAGE = 0.134; // USD, standard price at 1K to 2K.
const PRICE_PER_INPUT_TOKEN = 2 / 1e6;

function envKey(name) {
  // On Modal the key comes from a Secret, as an environment variable. On the Mac it comes from .env.
  if (process.env[name]) return process.env[name];
  const match = readFileSync(join(here, "..", ".env"), "utf8").match(new RegExp(`^${name}=(.*)$`, "m"));
  if (!match) throw new Error(`${name} is missing from .env`);
  return match[1].trim().replace(/^["']|["']$/g, "");
}

const [renders, out] = process.argv.slice(2);
const onlyAt = process.argv.indexOf("--only");
const only = onlyAt > 0 ? process.argv[onlyAt + 1].split(",") : null;
const variantAt = process.argv.indexOf("--variant");
const onlyVariant = variantAt > 0 ? process.argv[variantAt + 1] : null;
const dryRun = process.argv.includes("--dry-run");
const sizeAt = process.argv.indexOf("--size");
const imageSize = sizeAt > 0 ? process.argv[sizeAt + 1] : "1K";
mkdirSync(out, { recursive: true });

const frames = readdirSync(renders)
  .filter((f) => f.endsWith(".water.json"))
  .map((f) => f.replace(".water.json", ""));
const jobs = frames
  .flatMap((frame) => VARIANTS.map((variant) => ({ frame, variant })))
  .filter(({ frame, variant }) => !only || only.includes(`${frame}:${variant.id}`))
  .filter(({ variant }) => !onlyVariant || variant.id === onlyVariant)
  .filter(({ frame, variant }) => !existsSync(join(out, `${frame}.${variant.id}.json`)));

/** The full prompt for one drawing, with its frame's measured sentences. */
function promptFor({ frame, variant }) {
  const sentence = (kind) => JSON.parse(readFileSync(join(renders, `${frame}.${kind}.json`), "utf8")).sentence;
  return buildPrompt(variant, sentence("water"), variant.ground ? sentence("ground") : null);
}

console.log(`${jobs.length} drawings to make, about $${(jobs.length * PRICE_PER_IMAGE).toFixed(2)} at $${PRICE_PER_IMAGE} each`);
if (dryRun) {
  const first = jobs[0];
  if (first) console.log(promptFor(first));
  process.exit(0);
}

const key = envKey("GEMINI_API_KEY");
let spent = 0;

async function draw({ frame, variant }) {
  const prompt = promptFor({ frame, variant });
  const image = readFileSync(join(renders, `${frame}.png`)).toString("base64");
  // The style reference goes first, so the image to redraw is the last thing the model sees.
  const reference = variant.reference
    ? [{ inlineData: { mimeType: "image/jpeg", data: readFileSync(join(here, variant.reference)).toString("base64") } }]
    : [];
  // A guide is this frame's own draft, kept next to its render as <frame>.guide.png.
  if (variant.guide) reference.push({ inlineData: { mimeType: "image/png", data: readFileSync(join(renders, `${frame}.guide.png`)).toString("base64") } });
  const body = {
    contents: [{ role: "user", parts: [{ text: prompt }, ...reference, { inlineData: { mimeType: "image/png", data: image } }] }],
    generationConfig: { responseModalities: ["IMAGE"], imageConfig: { aspectRatio: "1:1", imageSize } },
  };
  const started = Date.now();
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": key },
    body: JSON.stringify(body),
  });
  const json = await response.json();
  if (!response.ok) throw new Error(`${response.status}: ${json.error?.message ?? "request failed"}`);
  const part = json.candidates?.[0]?.content?.parts?.find((p) => p.inlineData);
  if (!part) throw new Error(`no image: ${json.candidates?.[0]?.finishReason ?? json.promptFeedback?.blockReason ?? "unknown"}`);
  const cost = PRICE_PER_IMAGE + (json.usageMetadata?.promptTokenCount ?? 0) * PRICE_PER_INPUT_TOKEN;
  spent += cost;
  const mime = part.inlineData.mimeType;
  writeFileSync(join(out, `${frame}.${variant.id}.${mime.split("/")[1]}`), Buffer.from(part.inlineData.data, "base64"));
  writeFileSync(
    join(out, `${frame}.${variant.id}.json`),
    JSON.stringify({ model: MODEL, frame, variant: variant.id, prompt, usage: json.usageMetadata, cost, mime, seconds: (Date.now() - started) / 1000 }, null, 2),
  );
  console.log(`${frame}.${variant.id}: ${((Date.now() - started) / 1000).toFixed(0)} s, $${cost.toFixed(3)}, ${mime}`);
}

const failures = [];
const queue = [...jobs];
await Promise.all(
  Array.from({ length: CONCURRENCY }, async () => {
    while (queue.length) {
      const job = queue.shift();
      for (let attempt = 0; ; attempt++) {
        try {
          await draw(job);
          break;
        } catch (error) {
          const message = String(error.message).split(key).join("<key>");
          console.log(`${job.frame}.${job.variant.id}: attempt ${attempt + 1} failed: ${message.slice(0, 240)}`);
          if (attempt >= RETRIES) {
            failures.push(`${job.frame}.${job.variant.id}`);
            break;
          }
          await new Promise((r) => setTimeout(r, 5000 * (attempt + 1)));
        }
      }
    }
  }),
);
console.log(`spent about $${spent.toFixed(2)}; failed: ${failures.join(", ") || "none"}`);
