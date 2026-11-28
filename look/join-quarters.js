// Joins the four drawn quarters of each frame back into one drawing per variant, at one pixel
// per map pixel, so the Phase 1 sheet shows whole frames.
//
//   node look/join-quarters.js look/out/quarters-in look/out/phase1-quarters look/out/phase1
//
// A quarter <frame>-q<n> was cut from <frame> by look/quarters.js (q0 upper left, q1 upper
// right, q2 lower left, q3 lower right) and enlarged 2x; its drawing comes back at the size the
// teacher chose. Each joined drawing gets a sidecar whose cost is the four quarters' sum. A
// frame and variant with any quarter missing is skipped and named.
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";

const sharp = createRequire(new URL("../render/", import.meta.url))("sharp");

const [quartersIn, drawn, out] = process.argv.slice(2);
mkdirSync(out, { recursive: true });

const quarters = readdirSync(quartersIn)
  .filter((f) => /-q[0-3]\.json$/.test(f))
  .map((f) => JSON.parse(readFileSync(join(quartersIn, f), "utf8")));
const parents = [...new Set(quarters.map((q) => q.parent))].sort();
const variants = [...new Set(readdirSync(drawn).filter((f) => f.endsWith(".json")).map((f) => f.split(".").at(-2)))].sort();

const missing = [];
for (const parent of parents) {
  const mine = quarters.filter((q) => q.parent === parent).sort((a, b) => a.id.localeCompare(b.id));
  const half = mine[0].window.size;
  for (const variant of variants) {
    const parts = mine.map((q) => {
      const meta = join(drawn, `${q.id}.${variant}.json`);
      if (!existsSync(meta)) return null;
      const m = JSON.parse(readFileSync(meta, "utf8"));
      return { q, m, image: join(drawn, `${q.id}.${variant}.${m.mime.split("/")[1]}`) };
    });
    if (parts.some((p) => !p)) {
      missing.push(`${parent}.${variant}`);
      continue;
    }
    const [x0, y0] = [Math.min(...mine.map((o) => o.window.x)), Math.min(...mine.map((o) => o.window.y))];
    const composites = await Promise.all(
      parts.map(async ({ q, image }) => ({
        input: await sharp(image).resize(half, half, { kernel: "lanczos3" }).toBuffer(),
        left: q.window.x - x0,
        top: q.window.y - y0,
      })),
    );
    await sharp({ create: { width: half * 2, height: half * 2, channels: 3, background: "#000" } })
      .composite(composites)
      .jpeg({ quality: 92 })
      .toFile(join(out, `${parent}.${variant}.jpeg`));
    const cost = parts.reduce((sum, p) => sum + p.m.cost, 0);
    writeFileSync(
      join(out, `${parent}.${variant}.json`),
      JSON.stringify({ frame: parent, variant, quarters: parts.map((p) => p.q.id), cost, model: parts[0].m.model, mime: "image/jpeg" }, null, 2),
    );
  }
  console.log(`${parent}: joined ${variants.length - missing.filter((m) => m.startsWith(`${parent}.`)).length} of ${variants.length} variants`);
}
if (missing.length) console.log(`missing a quarter: ${missing.join(", ")}`);
