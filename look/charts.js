// Grafana-style charts for the write-up, as plain SVG with no libraries.
//
//   node look/charts.js network <network.tsv> <out.svg> "<title>" "<subtitle>"
//   node look/charts.js spend <out.svg>
//
// network reads the byte counters that render/run-all.sh logged every 2 seconds and draws the
// download rate in 1 minute averages. A gap of over 5 minutes in the log (the Mac asleep or a
// restart) breaks the line, so no rate is invented for it.
// spend draws what each step of the project cost, from runs/ledger.tsv as summed by hand below.
import { readFileSync, writeFileSync } from "node:fs";

const W = 1200;
const H = 420;
const PAD = { left: 64, right: 150, top: 70, bottom: 48 };
const C = { panel: "#1a1a19", grid: "#33332f", text: "#f0efec", muted: "#c3c2b7", line: "#73bf69", fill: "#73bf69" };
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");

/** The panel, its title and subtitle, and horizontal grid lines with labels. */
function frame(title, subtitle, yMax, yStep, unit) {
  const plotH = H - PAD.top - PAD.bottom;
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" font-family="Helvetica, Arial, sans-serif">`;
  svg += `<rect width="${W}" height="${H}" rx="8" fill="${C.panel}"/>`;
  svg += `<text x="${PAD.left}" y="30" fill="${C.text}" font-size="18" font-weight="bold">${esc(title)}</text>`;
  svg += `<text x="${PAD.left}" y="50" fill="${C.muted}" font-size="13">${esc(subtitle)}</text>`;
  for (let v = 0; v <= yMax + 1e-9; v += yStep) {
    const y = H - PAD.bottom - (v / yMax) * plotH;
    svg += `<line x1="${PAD.left}" x2="${W - PAD.right}" y1="${y}" y2="${y}" stroke="${C.grid}"/>`;
    svg += `<text x="${PAD.left - 8}" y="${y + 4}" fill="${C.muted}" font-size="12" text-anchor="end">${v}${unit}</text>`;
  }
  return svg;
}

function network(tsvPath, out, title, subtitle) {
  const rows = readFileSync(tsvPath, "utf8").trim().split("\n").slice(1).map((l) => l.split("\t").map(Number));
  // Rate per minute: bytes in over each run of samples in the same minute.
  const minutes = [];
  for (let i = 1; i < rows.length; i++) {
    const [t0, in0] = rows[i - 1];
    const [t1, in1] = rows[i];
    if (t1 - t0 > 300 || in1 < in0) {
      minutes.push(null); // A gap or a counter reset: break the line.
      continue;
    }
    const m = Math.floor(t1 / 60);
    const last = minutes[minutes.length - 1];
    if (last && last.m === m) {
      last.bytes += in1 - in0;
      last.secs += t1 - t0;
    } else minutes.push({ m, bytes: in1 - in0, secs: t1 - t0 });
  }
  const points = minutes.map((p) => (p && p.secs ? { t: p.m * 60, mbs: p.bytes / p.secs / 1e6 } : null));
  const real = points.filter(Boolean);
  const [tMin, tMax] = [real[0].t, real[real.length - 1].t];
  const peak = Math.max(...real.map((p) => p.mbs));
  const yMax = Math.ceil(peak / 5) * 5;
  const total = real.reduce((s, p) => s + p.mbs * 60, 0) / 1000;
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const x = (t) => PAD.left + ((t - tMin) / (tMax - tMin)) * plotW;
  const y = (v) => H - PAD.bottom - (Math.min(v, yMax) / yMax) * plotH;

  let svg = frame(title, `${subtitle} About ${Math.round(total)} GB in all.`, yMax, yMax / 5, "");
  svg += `<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${C.fill}" stop-opacity="0.45"/><stop offset="1" stop-color="${C.fill}" stop-opacity="0.02"/></linearGradient></defs>`;
  // One path per unbroken stretch, each with its own filled area.
  let run = [];
  const flush = () => {
    if (run.length > 1) {
      const line = run.map((p, i) => `${i ? "L" : "M"}${x(p.t).toFixed(1)},${y(p.mbs).toFixed(1)}`).join("");
      svg += `<path d="${line}L${x(run[run.length - 1].t).toFixed(1)},${H - PAD.bottom}L${x(run[0].t).toFixed(1)},${H - PAD.bottom}Z" fill="url(#g)"/>`;
      svg += `<path d="${line}" fill="none" stroke="${C.line}" stroke-width="1.5"/>`;
    }
    run = [];
  };
  for (const p of points) (p ? run.push(p) : flush());
  flush();
  // Time labels every 2 hours, in Perth time.
  const perth = (t) => new Date((t + 8 * 3600) * 1000);
  for (let t = Math.ceil(tMin / 7200) * 7200; t <= tMax; t += 7200) {
    const d = perth(t);
    svg += `<text x="${x(t)}" y="${H - PAD.bottom + 20}" fill="${C.muted}" font-size="12" text-anchor="middle">${String(d.getUTCHours()).padStart(2, "0")}:00</text>`;
  }
  svg += `<text x="${PAD.left - 8}" y="${PAD.top - 8}" fill="${C.muted}" font-size="12" text-anchor="end">MB/s</text>`;
  svg += `<circle cx="${W - PAD.right + 20}" cy="${PAD.top + 6}" r="5" fill="${C.line}"/><text x="${W - PAD.right + 32}" y="${PAD.top + 10}" fill="${C.text}" font-size="13">Download</text>`;
  svg += `<text x="${W - PAD.right + 20}" y="${PAD.top + 34}" fill="${C.muted}" font-size="12">peak ${peak.toFixed(1)} MB/s</text>`;
  svg += "</svg>";
  writeFileSync(out, svg);
  console.log(`${out}: ${real.length} minutes, peak ${peak.toFixed(1)} MB/s, ${total.toFixed(0)} GB`);
}

// What each step cost in US dollars, summed from runs/ledger.tsv (Modal's own figures where
// the ledger has them, Gemini's billing page for the teacher).
const SPEND = [
  ["Look tests (Gemini)", 13.75],
  ["Teacher drawings (Gemini)", 63.24],
  ["Training and first areas", 11.8],
  ["First map, 62 areas", 95],
  ["Larger map: probe and tests", 6.51],
  ["Larger map, phase 1", 48.79],
  ["Larger map, phase 2", 256.33],
  ["Larger map, phase 3", 230.22],
];

function spend(out) {
  const total = SPEND.reduce((s, [, v]) => s + v, 0);
  const yMax = 300;
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const slot = plotW / SPEND.length;
  let svg = frame("What each step cost", `US dollars, from runs/ledger.tsv. About $${Math.round(total)} in all. Rendering with Google's tiles cost under $2.`, yMax, 50, "");
  SPEND.forEach(([label, v], i) => {
    const h = (v / yMax) * plotH;
    const bx = PAD.left + i * slot + slot * 0.18;
    svg += `<rect x="${bx}" y="${H - PAD.bottom - h}" width="${slot * 0.64}" height="${h}" rx="2" fill="${i < 2 ? "#5794f2" : C.line}"/>`;
    svg += `<text x="${bx + slot * 0.32}" y="${H - PAD.bottom - h - 6}" fill="${C.text}" font-size="12" text-anchor="middle">$${v < 20 ? v.toFixed(2) : Math.round(v)}</text>`;
    const words = label.split(" ");
    const half = Math.ceil(words.length / 2);
    [words.slice(0, half).join(" "), words.slice(half).join(" ")].forEach((part, k) => {
      svg += `<text x="${bx + slot * 0.32}" y="${H - PAD.bottom + 18 + k * 14}" fill="${C.muted}" font-size="11" text-anchor="middle">${esc(part)}</text>`;
    });
  });
  svg += `<text x="${PAD.left - 8}" y="${PAD.top - 8}" fill="${C.muted}" font-size="12" text-anchor="end">$</text>`;
  svg += `<rect x="${W - PAD.right + 20}" y="${PAD.top}" width="10" height="10" fill="#5794f2"/><text x="${W - PAD.right + 36}" y="${PAD.top + 10}" fill="${C.text}" font-size="13">Gemini</text>`;
  svg += `<rect x="${W - PAD.right + 20}" y="${PAD.top + 22}" width="10" height="10" fill="${C.line}"/><text x="${W - PAD.right + 36}" y="${PAD.top + 32}" fill="${C.text}" font-size="13">Modal GPUs</text>`;
  svg += "</svg>";
  writeFileSync(out, svg);
  console.log(`${out}: $${total.toFixed(2)}`);
}

const [kind, ...rest] = process.argv.slice(2);
if (kind === "network") network(...rest);
else if (kind === "spend") spend(...rest);
else throw new Error("usage: network <tsv> <svg> <title> <subtitle> | spend <svg>");
