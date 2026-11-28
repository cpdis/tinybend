"""The joint sampler: draws an area larger than the model's 1,024 px frame as one picture.

The model can only draw one 1,024 px window at a time. Drawn separately, neighbouring windows
disagree at their edges. So every denoising step runs the model on overlapping windows and
blends their answers before the picture moves on. No window ever finishes alone, and the
windows agree because they share every step.

This file has the window maths as plain Python, so it can be tested without a GPU, and
`install()`, which swaps this loop into ai-toolkit's FLUX.2 pipeline for images over 1,024 px.
All sizes here are in latent cells: the model works on a grid 16 times coarser than pixels.
"""

WINDOW = 64  # One 1,024 px frame, the size the LoRA was trained at.
STRIDE = 48  # Windows start 768 px apart, so neighbours share 256 px.
SHIFT = 24  # Odd steps move the grid by half a stride, so no window edge sits still.
CELL = 16  # Pixels per latent cell.
BORDER = 2  # The red border every training render had. Each window's render gets one too.
SOFT = 8  # Cells at a pin's edge (128 px) that are let go before the last step, so the join can settle.
RELEASE = 0.6  # The outermost pinned cell is let go when this share of the noise is still left.


def window_starts(length: int, shifted: bool) -> list[int]:
    """Where windows start along one axis, covering it from end to end."""
    last = length - WINDOW
    if last < 0:
        raise ValueError(f"an area must be at least {WINDOW * CELL} px on each side")
    starts = set(range(SHIFT if shifted else 0, last + 1, STRIDE))
    # The shifted grid leaves a gap at the start, and either grid can leave one at the end.
    starts.update((0, last))
    return sorted(starts)


def tent(i: int) -> int:
    """A window's weight at cell i: highest in its middle, lowest at its edges, never zero."""
    return min(i + 1, WINDOW - i)


def coverage(length: int, shifted: bool) -> list[int]:
    """Total window weight on each cell of one axis. Blending divides by this."""
    total = [0] * length
    for start in window_starts(length, shifted):
        for i in range(WINDOW):
            total[start + i] += tent(i)
    return total


def pinned_cells(known: list[list[bool]]) -> list[list[bool]]:
    """Which latent cells are pinned, from a per-pixel grid of "already drawn".

    A cell is pinned only when every pixel in it is already drawn, so a pin never reaches
    into ground that is still to be drawn.
    """
    rows, cols = len(known) // CELL, len(known[0]) // CELL
    return [[all(known[r * CELL + y][c * CELL + x] for y in range(CELL) for x in range(CELL)) for c in range(cols)] for r in range(rows)]


def install(output_path: str, pinned_path: str | None = None, mask_path: str | None = None, content_path: str | None = None) -> None:
    """Make ai-toolkit's FLUX.2 pipeline use the joint loop for any image over 1,024 px.

    With a pinned picture and its mask, the pixels the mask marks are kept as they are, and the
    rest of the area is drawn to continue them. That is how one area joins the next.

    The content mask marks where the area has a render at all. Windows with no render, and
    windows whose every cell is pinned to the end, are skipped: there is nothing to draw there.
    """
    import os

    import numpy as np
    import torch
    from einops import rearrange
    from PIL import Image, ImageDraw

    from extensions_built_in.diffusion_models.flux2.src import pipeline as flux2
    from extensions_built_in.diffusion_models.flux2.src.sampling import encode_image_refs, get_schedule

    single_frame = flux2.Flux2Pipeline.__call__

    def bordered(render: Image.Image, top: int, left: int) -> Image.Image:
        """One window of the render, with the red border the model saw in training."""
        box = (left * CELL, top * CELL, (left + WINDOW) * CELL, (top + WINDOW) * CELL)
        crop = render.crop(box)
        edge = WINDOW * CELL - 1
        for inset in range(BORDER):
            ImageDraw.Draw(crop).rectangle((inset, inset, edge - inset, edge - inset), outline=(255, 0, 0))
        return crop

    @torch.no_grad()
    def joint(self, *args, **kwargs):
        height, width = kwargs.get("height"), kwargs.get("width")
        if max(height, width) <= WINDOW * CELL:
            return single_frame(self, *args, **kwargs)
        # ai-toolkit samples at the start and again at the end of a run. Draw the area once.
        if os.path.exists(output_path):
            return flux2.Flux2ImagePipelineOutput(images=[Image.open(output_path)])

        device = self._execution_device
        guidance = kwargs["guidance_scale"]
        steps = kwargs["num_inference_steps"]
        render = kwargs["control_img_list"][0]
        rows, cols = height // CELL, width // CELL

        text, text_ids = flux2.batched_prc_txt(kwargs["prompt_embeds"])
        blank, blank_ids = flux2.batched_prc_txt(kwargs["negative_prompt_embeds"])
        latents = flux2.randn_tensor((1, self.num_channels_latents, rows, cols), generator=kwargs["generator"], device=device, dtype=text.dtype)
        weight = torch.tensor([[tent(i) * tent(j) for j in range(WINDOW)] for i in range(WINDOW)], device=device, dtype=torch.float32)
        # The schedule depends on how many cells the model sees at once: one window's worth.
        times = get_schedule(steps, WINDOW * WINDOW)

        # Pinning: the finished neighbour's pixels, as latents, and which cells they fill.
        noise = latents.clone()
        pin = settled = content = None
        if content_path:
            # A cell has content when any of its pixels has a render.
            covered = Image.open(content_path).convert("L").resize((cols, rows), Image.BOX)
            content = torch.from_numpy(np.asarray(covered) > 0).to(device)
        if pinned_path:
            drawn = np.asarray(Image.open(pinned_path).convert("RGB"), dtype=np.float32) / 127.5 - 1
            known = np.asarray(Image.open(mask_path).convert("L")) > 127
            cells = known.reshape(rows, CELL, cols, CELL).all(axis=(1, 3))
            pin = torch.from_numpy(cells).to(device)
            # How many cells deep each pinned cell sits inside the pin, counted up to SOFT.
            inside = pin[None, None].float()
            depth = torch.zeros_like(inside)
            for _ in range(SOFT):
                depth += inside
                inside = -torch.nn.functional.max_pool2d(-inside, 3, stride=1, padding=1)
            # A hard pin left a faint line where held cells met free ones. So a cell near the
            # edge is held only while the picture is still noisier than its release level.
            # Cells SOFT deep or more are held to the end and come out exactly as pinned.
            release = (RELEASE * (1 - depth / SOFT)).clamp(min=0)[0, 0]
            # Encode in windows, as the picture is decoded in windows, to stay within memory.
            # Overlapping windows are blended, so no cell takes its value from a window's edge.
            finished = torch.zeros((self.num_channels_latents, rows, cols), device=device, dtype=torch.float32)
            share = torch.zeros((rows, cols), device=device, dtype=torch.float32)
            for top in window_starts(rows, False):
                for left in window_starts(cols, False):
                    if not cells[top : top + WINDOW, left : left + WINDOW].any():
                        continue
                    y, x = top * CELL, left * CELL
                    pixels = torch.from_numpy(drawn[y : y + WINDOW * CELL, x : x + WINDOW * CELL]).permute(2, 0, 1).unsqueeze(0)
                    encoded_window = self.vae.encode(pixels.to(self.vae.device, self.vae.dtype))[0]
                    finished[:, top : top + WINDOW, left : left + WINDOW] += encoded_window.float().to(device).reshape(-1, WINDOW, WINDOW) * weight
                    share[top : top + WINDOW, left : left + WINDOW] += weight
            finished = (finished / share.clamp(min=1)).to(latents.dtype).unsqueeze(0)
            settled = pin & (release == 0)

        def idle(top, left):
            """True for a window with nothing to draw: no render, or pinned to the end throughout."""
            if content is not None and not content[top : top + WINDOW, left : left + WINDOW].any():
                return True
            return settled is not None and bool(settled[top : top + WINDOW, left : left + WINDOW].all())

        def hold_pins(current, time):
            """Put the pinned cells where a picture this noisy would have them (RePaint)."""
            if pin is None:
                return current
            noisy = (1 - time) * finished + time * noise
            return torch.where(pin & (time >= release), noisy, current)

        # Each window's render is encoded once and reused at every step it appears in.
        encoded = {}

        def render_tokens(top, left):
            if (top, left) not in encoded:
                encoded[(top, left)] = encode_image_refs(self.vae, [bordered(render, top, left)])
            return encoded[(top, left)]

        for step, (now, after) in enumerate(zip(times[:-1], times[1:])):
            shifted = step % 2 == 1
            latents = hold_pins(latents, now)
            total = torch.zeros((self.num_channels_latents, rows, cols), device=device, dtype=torch.float32)
            cover = torch.zeros((rows, cols), device=device, dtype=torch.float32)
            time = torch.full((1,), now, device=device, dtype=latents.dtype)
            scale = torch.full((1,), guidance, device=device, dtype=latents.dtype)
            drawn_windows = 0
            for top in window_starts(rows, shifted):
                for left in window_starts(cols, shifted):
                    if idle(top, left):
                        continue
                    drawn_windows += 1
                    crop = latents[:, :, top : top + WINDOW, left : left + WINDOW]
                    cells, cell_ids = flux2.batched_prc_img(crop)
                    tokens, token_ids = render_tokens(top, left)
                    x = torch.cat((cells, tokens.to(cells.dtype)), dim=1)
                    x_ids = torch.cat((cell_ids, token_ids.to(cell_ids.device)), dim=1)
                    with_text = self.transformer(x=x, x_ids=x_ids, timesteps=time, ctx=text, ctx_ids=text_ids, guidance=scale)
                    without = self.transformer(x=x, x_ids=x_ids, timesteps=time, ctx=blank, ctx_ids=blank_ids, guidance=scale)
                    guided = (without + guidance * (with_text - without))[:, : cells.shape[1]]
                    answer = rearrange(guided[0].float(), "(h w) c -> c h w", h=WINDOW, w=WINDOW)
                    total[:, top : top + WINDOW, left : left + WINDOW] += answer * weight
                    cover[top : top + WINDOW, left : left + WINDOW] += weight
            # One step for the whole area, from the blend of every window's answer.
            # A cell no window drew keeps its value: it is pinned, or it has no render.
            latents = latents + (after - now) * (total / cover.clamp(min=1e-6)).to(latents.dtype).unsqueeze(0)
            print(f"joint step {step + 1} of {steps}, {'shifted' if shifted else 'plain'} grid, {drawn_windows} windows", flush=True)

        latents = hold_pins(latents, 0.0)

        # Decoding the whole area at once needs too much memory, so decode windows and blend
        # them in pixels the same way.
        picture = torch.zeros((3, height, width), dtype=torch.float32)
        seen = torch.zeros((height, width), dtype=torch.float32)
        ramp = torch.tensor([min(i + 1, WINDOW * CELL - i) for i in range(WINDOW * CELL)], dtype=torch.float32)
        pixel_weight = ramp[:, None] * ramp[None, :]
        for top in window_starts(rows, False):
            for left in window_starts(cols, False):
                if content is not None and not content[top : top + WINDOW, left : left + WINDOW].any():
                    continue
                decoded = self.vae.decode(latents[:, :, top : top + WINDOW, left : left + WINDOW].to(self.vae.dtype)).float()[0].cpu()
                y, x = top * CELL, left * CELL
                picture[:, y : y + WINDOW * CELL, x : x + WINDOW * CELL] += decoded * pixel_weight
                seen[y : y + WINDOW * CELL, x : x + WINDOW * CELL] += pixel_weight
        image = self.image_processor.postprocess((picture / seen.clamp(min=1)).unsqueeze(0), output_type="pil")[0]
        os.makedirs(os.path.dirname(output_path), exist_ok=True)
        image.save(output_path)
        return flux2.Flux2ImagePipelineOutput(images=[image])

    flux2.Flux2Pipeline.__call__ = joint
