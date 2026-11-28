// Teacher prompts. These say how to draw, never what to draw, and name no place.
// BASE and A's styling are Tiny Perth's (cpdis/tinyperth), whose Phase 1 sheet chose them; the
// colours in BASE were sampled from tiny.london's tiles, and the wording is our own. Bend's
// summer variants (Phase 1) add one paragraph each to A.

export const BASE = `Redraw the attached image as isometric pixel art. It is a 3D render from an orthographic camera, tilted 45 degrees.

Accuracy rules, which override everything below:
- Every shape stays where it is, at the size and angle it has in the attached image. Trace it, then restyle it.
- Add nothing the image does not contain. Remove nothing it does contain.
- A plain area stays plain. Do not invent detail, objects, markings or text to fill it.
- Keep the same framing, right to the edges. No border, caption, signature or logo.

How to draw:
- Grain: built from visible square pixels about 2 image pixels wide. Hard edges only, with no gradients, blur, glow or photo texture anywhere.
- Fills: each surface is 2 to 4 flat tones laid in clean clusters, like cel shading. Use almost no dithering: at most a short run of checker where two tones meet on a large curved surface.
- Line: a dark, near-black line 1 to 2 pixels wide around the outline of every raised form, with thinner dark lines for its main internal edges. Lines are slightly hand-wobbled, not ruler-straight.
- Light: one sun, from the direction the shadows in the image imply. Lit faces are one tone up, shaded faces one to two tones down, cast shadows a single flat dark shape with a hard edge.
- Foliage: rounded clumps with a lit tone, a mid tone and a dark tone, each clump outlined. Never leaf-level noise.
- Linear markings, where the image has them: a clean light line of even width.
- Base palette, shifted only as the styling notes below say: water #486858 #485858 #486868; dark line #182818 #282828; hard surfaces #383838 #585858 #686868 #787878 #888888 #989888; foliage #284818 #386828 #487828 #487838 #5a8c3c; warm paving #c8a884 #b89878.`;

// The fine-detail paragraph that G, H and I share.
const DETAIL = `Fine detail, which overrides any wish to simplify: work at the smallest scale the grain allows, with square pixels 1 to 2 image pixels wide. Any shape 3 pixels or wider in the image keeps its own outline or its own tone. Do not merge neighbouring shapes into one mass. Every plane and ridge on a raised form keeps its edge. Break foliage into many clumps 8 to 20 pixels wide that follow the crowns and gaps in the image.`;

// Perth's chosen look (its variant K, 2026-11-11): every colour from the image, no named
// ground colours. Bend's variants all start from it, so the sheet shows what each added
// paragraph does.
const NEUTRAL_STYLING = `Styling notes: every surface, raised or flat, keeps the hue and darkness it has in the image, rounded to the nearest flat tone. A lit face is one tone lighter within its own hue, and a cast shadow is one flat darker tone of the surface it falls on, with a hard edge. Ignore the base palette's water colours and use only the water colours in the open-water sentence at the end of this prompt.

${DETAIL}`;

// Bend's added paragraphs. Each says how to draw a kind of form when the image shows it,
// never that the form is there, and names no ground colour.
const HARD_LIGHT = `Light: hard, dry, high-altitude sun. Raise the contrast by one step: a lit face is one tone lighter within its own hue, and every cast shadow is one flat cool blue-violet, #2c3048, with a razor edge, whatever it falls on. This overrides the shadow rule above.`;

const OPEN_CANOPY = `Trees and shrubs: where the image shows separate tree crowns standing over open ground, draw each crown as its own outlined clump, give it its own flat cast shadow on the ground beside it, and keep the ground between crowns showing in its own tone. Never join separate crowns into one continuous canopy. Where the image shows low shrubs scattered over open ground, draw each as one small clump 3 to 6 pixels wide, with no outline, spaced as the image spaces them.`;

const TERRAIN = `Rock, slopes and snow: draw relief as flat facets. Where the image shows a rock ledge, cliff or steep bank, give each face its own flat tone, with a dark line along its upper edge, stepping down like terraces. Where the image shows snow, keep it exactly where the image has it, as two flat tones split by the way each slope faces, with no outline. Add no snow the image does not show, and never draw snow as water or cloud.`;

const COLOURED_LINE = `Line, which overrides the base line: 1 pixel wide, in a dark tone of the colour it borders rather than near-black. Shadows are mid tones, never close to black.`;

export const VARIANTS = [
  {
    id: "a",
    name: "Perth's look, unchanged",
    note: "Tiny Perth's teacher prompt (its K) as it was: every colour from the image, no named ground colours. The control for the others.",
    styling: NEUTRAL_STYLING,
  },
  {
    id: "b",
    name: "A, with hard high-desert light",
    note: "A plus one paragraph: stronger contrast and every cast shadow one flat blue-violet.",
    styling: `${NEUTRAL_STYLING}\n\n${HARD_LIGHT}`,
  },
  {
    id: "c",
    name: "A, with open canopy",
    note: "A plus one paragraph on separate tree crowns over open ground, each with its own shadow, and scattered low shrubs.",
    styling: `${NEUTRAL_STYLING}\n\n${OPEN_CANOPY}`,
  },
  {
    id: "d",
    name: "A, with rock and snow facets",
    note: "A plus one paragraph on ledges and cliffs as stepped flat faces, and snow kept exactly where the render has it.",
    styling: `${NEUTRAL_STYLING}\n\n${TERRAIN}`,
  },
  {
    id: "e",
    name: "A, with a thin coloured line",
    note: "A with a 1-pixel line in a dark tone of the colour it borders, and mid-tone shadows: softer and lighter.",
    styling: `${NEUTRAL_STYLING}\n\n${COLOURED_LINE}`,
  },
  {
    id: "f",
    name: "B, C and D together",
    note: "A with all three Bend paragraphs: hard light, open canopy, rock and snow facets.",
    styling: `${NEUTRAL_STYLING}\n\n${HARD_LIGHT}\n\n${OPEN_CANOPY}\n\n${TERRAIN}`,
  },
];

// Sent before the base prompt when a variant carries a draft of the same frame.
export const GUIDE_NOTE = `Two images are attached. The first is a rough, blurry draft of this exact scene, already in the right colours: use its colour for every surface, and keep each shape where the draft has it. The second is the image to redraw, which shows the detail the draft lacks.`;

// The variant Colin picks from the Phase 1 sheet for teacher calls. Unset until he does, so no
// teacher run can start on a look nobody chose. Keep modal_app/common.py in step.
export const TEACHER_VARIANT = null;

export function buildPrompt(variant, waterSentence, groundSentence) {
  // No style reference image goes into any call (CLAUDE.md, "Look and originality"). A guide is
  // a draft of the same frame, for the winter tint trial.
  const base = variant.guide ? BASE.replaceAll("the attached image", "the second attached image") : BASE;
  const parts = [variant.guide && GUIDE_NOTE, base, variant.styling, variant.ground && groundSentence, waterSentence];
  return parts.filter(Boolean).join("\n\n");
}
