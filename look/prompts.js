// Teacher prompts for Phase 1. These say how to draw, never what to draw, and name no place.
// Colours in BASE were sampled from tiny.london's tiles. The wording is our own.

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

// Variant I's styling, shared with J so the reference image is the only change between them.
const VARIANT_I_STYLING = `Styling notes: this is hard, dry, high-summer light. Raise the contrast: a lit face goes one tone lighter within its own hue, and only a surface that is already pale goes toward #e8e0cc. Every cast shadow is one flat cool blue-violet, #2c3048, with a razor edge. Every surface, raised or flat, keeps the hue and darkness it has in the image: a dark surface stays dark, green stays green, and only ground that is plainly bare in the image goes to ochre, #b88a58 and #d0a870. Warm red-orange surfaces run #9c3c24 to #e07a44. Ignore the base palette's water colours and use only the water colours in the last sentence of this prompt.

Fine detail, which overrides any wish to simplify: work at the smallest scale the grain allows, with square pixels 1 to 2 image pixels wide. Any shape 3 pixels or wider in the image keeps its own outline or its own tone. Do not merge neighbouring shapes into one mass. Every plane and ridge on a raised form keeps its edge. Break foliage into many clumps 8 to 20 pixels wide that follow the crowns and gaps in the image.`;

// I's colour rule with every named ground colour and light effect removed.
const NEUTRAL_STYLING = `Styling notes: every surface, raised or flat, keeps the hue and darkness it has in the image, rounded to the nearest flat tone. A lit face is one tone lighter within its own hue, and a cast shadow is one flat darker tone of the surface it falls on, with a hard edge. Ignore the base palette's water colours and use only the water colours in the open-water sentence at the end of this prompt.

${DETAIL}`;

// Sent before the base prompt when a variant carries the style reference.
export const REFERENCE_NOTE = `Two images are attached. The first is a finished example of the drawing manner only: copy its grain, line, shading and level of detail, and copy none of its content, layout or colours. The second is the image to redraw.`;

export const VARIANTS = [
  {
    id: "a",
    name: "Close to the London look",
    note: "The base look, adapted as little as possible. Problems: it paints the quay's paving orange, makes Kings Park too red, and turns the sea at Cottesloe grey-green.",
    styling: `Styling notes: keep the base palette and line exactly. Warm red-orange surfaces in the image get three flat tones from #a84428 to #d06a3c, and small saturated blue surfaces get #3f9fc0 with a #b8d8d8 rim. Otherwise, make no colour changes.`,
  },
  {
    id: "b",
    name: "Hard Perth sun",
    note: "Strong sun: bleached paving, crisp blue-violet shadows, higher contrast. The most faithful of A to E. Problem: the turquoise shallows at Cottesloe go dark navy.",
    styling: `Styling notes: this is hard, dry, high-summer light. Raise the contrast: lit faces and pale ground bleach toward #e8e0cc, and every cast shadow is one flat cool blue-violet, #2c3048, with a razor edge. Warm red-orange surfaces run #9c3c24 to #e07a44. Dry ground goes to ochre, #b88a58 and #d0a870. Lawn greens stay saturated against it. Water deepens toward #2e5a64.`,
  },
  {
    id: "c",
    name: "Terracotta and turquoise",
    note: "The most saturated: orange roofs, bright pools, a bright teal river. Good at Cottesloe. Problems: it invents pale halos around the shore on Perth Water, and everything leans yellow.",
    styling: `Styling notes: push saturation and warmth. Warm red-orange surfaces are the loudest thing in the frame, in three tones from #b04020 to #f08848. Small saturated blue surfaces are vivid, #28b4d0 with a pale #d8f0f0 rim and one lighter highlight row. Open water is a bright teal, #2a7a84 and #3a9098, with one to three flat lighter stepped bands wherever the image shows it getting shallow. Pale sandy surfaces are warm cream, #f0dcb0. Foliage leans a little warmer and more yellow.`,
  },
  {
    id: "d",
    name: "Bush first",
    note: "Olive-grey canopy and red-brown earth, with muted colours that make lawns stand out. Problems: the bush reads as camouflage, and the sea at Cottesloe goes dark navy.",
    styling: `Styling notes: mute the foliage away from European green. Tree canopy where the image shows it dull or grey goes to olive and grey-green, #3c4c2c #5c6c40 #7c8858 #a0a478, in loose, irregular, open clumps with ground showing between them, not tight balls. Bare ground in the image shows as red-brown, #8c5c38 and #b07c50. Only surfaces that are clearly bright, watered green in the image stay saturated, #4c8c30 and #6cac44. Open water is a deep cold blue-grey, #2c4c5c and #38586a.`,
  },
  {
    id: "e",
    name: "Soft coastal",
    note: "Lighter and airier: thin coloured lines, pale sand, water in stepped bands. Lovely at Cottesloe. Problems: it turns the Kings Park lawn into sand and invents halos on Perth Water.",
    styling: `Styling notes: a lighter, airier version. The line is thinner, 1 pixel, and takes a dark tone of the colour it borders rather than near-black. Shadows are mid tones, never close to black. Open water is built from three to five flat stepped bands, following the tones in the image, from pale #9cd0c8 through #4c9ca4 to #2c6c7c, with crisp band edges. Pale sandy surfaces are #f4e8cc and #e4d0a8. Warm red-orange surfaces are soft, #c0603c to #e09468. Hard surfaces are lighter, #808488 to #b4b4b0.`,
  },
  {
    id: "f",
    name: "Hard sun, true water",
    note: "Added after A to E: B's light with colours that follow the render. The best grain and the best Cottesloe. Problems: it adds pale bands and dark blobs on calm river water, because its prompt mentions shallows and weed, and it thins the bush too much.",
    styling: `Styling notes: this is hard, dry, high-summer light. Raise the contrast: lit faces bleach toward #e8e0cc, and every cast shadow is one flat cool blue-violet, #2c3048, with a razor edge. Warm red-orange surfaces run #9c3c24 to #e07a44. Each ground surface keeps the hue it has in the image: green stays green, paving stays paving, and only ground that is already bare goes to ochre, #b88a58 and #d0a870. Open water follows the image exactly, sampled into flat stepped tones with no halos around the shore: where the image shows even dark water, use one or two close tones near #2e5a64 and no bands; where it shows pale turquoise shallows and dark weed, keep them as turquoise and dark flat shapes, in the places they appear.`,
  },
  {
    id: "g",
    name: "F, with clean water and more detail",
    note: "F's light and colour with finer shapes. Grain and trees improved a lot. Problems: it still draws pale halos and blobs on calm water, bleaches glass towers to cream, and turns a lawn to sand.",
    styling: `Styling notes: this is hard, dry, high-summer light. Raise the contrast: lit faces bleach toward #e8e0cc, and every cast shadow is one flat cool blue-violet, #2c3048, with a razor edge. Warm red-orange surfaces run #9c3c24 to #e07a44. Each ground surface keeps the hue it has in the image: green stays green, paving stays paving, and only ground that is already bare goes to ochre, #b88a58 and #d0a870. Open water follows the image exactly: where its colour is even, use one or two close tones near #2e5a64 and put nothing on it; where its colour changes, keep each change as a flat shape, in the same place and at the colour the image shows. Add no halo around any shore.

Fine detail, which overrides any wish to simplify: work at the smallest scale the grain allows, with square pixels 1 to 2 image pixels wide. Any shape 3 pixels or wider in the image keeps its own outline or its own tone. Do not merge neighbouring shapes into one mass. Every plane and ridge on a raised form keeps its edge. Break foliage into many clumps 8 to 20 pixels wide that follow the crowns and gaps in the image.`,
  },
  {
    id: "h",
    name: "G, with colours held to the image",
    note: "G's detail. Its colour wording never mentions a water edge, because naming one has drawn one every time. Lit faces keep their own hue, and ground keeps the hue it has.",
    styling: `Styling notes: this is hard, dry, high-summer light. Raise the contrast: a lit face goes one tone lighter within its own hue, and only a surface that is already pale goes toward #e8e0cc. Every cast shadow is one flat cool blue-violet, #2c3048, with a razor edge. Every surface, raised or flat, keeps the hue and darkness it has in the image: a dark surface stays dark, green stays green, and only ground that is plainly bare in the image goes to ochre, #b88a58 and #d0a870. Warm red-orange surfaces run #9c3c24 to #e07a44.

Open water: read its colour from the image at each point and round it to the nearest flat tone. Where those readings are close, use one single tone across the whole surface, right up to where land begins.

Fine detail, which overrides any wish to simplify: work at the smallest scale the grain allows, with square pixels 1 to 2 image pixels wide. Any shape 3 pixels or wider in the image keeps its own outline or its own tone. Do not merge neighbouring shapes into one mass. Every plane and ridge on a raised form keeps its edge. Break foliage into many clumps 8 to 20 pixels wide that follow the crowns and gaps in the image.`,
  },
  {
    id: "i",
    name: "G's detail, H's colour, measured water",
    note: "G's detail with H's colour rule. The prompt gives no general water rule. Each frame's water sentence states the colours measured from its render.",
    styling: `Styling notes: this is hard, dry, high-summer light. Raise the contrast: a lit face goes one tone lighter within its own hue, and only a surface that is already pale goes toward #e8e0cc. Every cast shadow is one flat cool blue-violet, #2c3048, with a razor edge. Every surface, raised or flat, keeps the hue and darkness it has in the image: a dark surface stays dark, green stays green, and only ground that is plainly bare in the image goes to ochre, #b88a58 and #d0a870. Warm red-orange surfaces run #9c3c24 to #e07a44. Ignore the base palette's water colours and use only the water colours in the last sentence of this prompt.

Fine detail, which overrides any wish to simplify: work at the smallest scale the grain allows, with square pixels 1 to 2 image pixels wide. Any shape 3 pixels or wider in the image keeps its own outline or its own tone. Do not merge neighbouring shapes into one mass. Every plane and ridge on a raised form keeps its edge. Break foliage into many clumps 8 to 20 pixels wide that follow the crowns and gaps in the image.`,
  },
  {
    id: "j",
    name: "I, with the style reference in the call",
    note: "I's prompt unchanged. The call also carries look/style-reference.jpeg as an example of the drawing manner.",
    reference: "style-reference.jpeg",
    styling: VARIANT_I_STYLING,
  },
  {
    id: "k",
    name: "I, without named ground colours",
    note: "I's prompt with the ochre, bleaching and summer-light wording removed. Those words named a colour for bare ground, and lawns took it.",
    styling: NEUTRAL_STYLING,
  },
  {
    id: "l",
    name: "K, with measured green",
    note: "K, plus one sentence per frame that states how much of the render is green and in which tones, measured by look/check.js.",
    ground: true,
    styling: NEUTRAL_STYLING,
  },
  {
    id: "m",
    name: "L, with the style reference in the call",
    note: "L's prompt and measured sentences, plus look/style-reference.jpeg as an example of the drawing manner.",
    ground: true,
    reference: "style-reference.jpeg",
    styling: NEUTRAL_STYLING,
  },
  {
    id: "n",
    name: "K on 2x quarters, with a 2x style reference",
    note: "K's prompt, for frames cut into quarters and enlarged 2x before drawing. The call carries look/style-reference-2x.jpeg, a quarter drawn the same way. Problem: the model copied the reference's houses into 7 of 15 drawings. Kept as a record of that failure.",
    reference: "style-reference-2x.jpeg",
    styling: NEUTRAL_STYLING,
  },
  {
    id: "p",
    name: "K on a quarter, guided by the whole-frame drawing",
    note: "K's prompt. The call also carries this quarter cut from the K drawing of the whole frame, enlarged 2x, as a colour draft. It is the same scene, so copying it is the aim.",
    guide: true,
    styling: NEUTRAL_STYLING,
  },
];

// Sent before the base prompt when a variant carries a draft of the same frame.
export const GUIDE_NOTE = `Two images are attached. The first is a rough, blurry draft of this exact scene, already in the right colours: use its colour for every surface, and keep each shape where the draft has it. The second is the image to redraw, which shows the detail the draft lacks.`;

// The variant Colin chose for teacher calls on 2026-11-11. No reference image goes with it.
export const TEACHER_VARIANT = "k";

export function buildPrompt(variant, waterSentence, groundSentence) {
  const two = variant.reference || variant.guide;
  const base = two ? BASE.replaceAll("the attached image", "the second attached image") : BASE;
  const parts = [variant.reference && REFERENCE_NOTE, variant.guide && GUIDE_NOTE, base, variant.styling, variant.ground && groundSentence, waterSentence];
  return parts.filter(Boolean).join("\n\n");
}
