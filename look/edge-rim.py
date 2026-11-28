"""Mark where the chart's rim layer has anything in it, so the site can skip it elsewhere.

The rim (site/edge/over-relief-*.webp) is a full-screen layer drawn over the map, but only
0.7% of it holds any pixel: the thin band where the drawing dissolves into the chart. This
writes a grid into site/edge/edges.json under "rim": one bit per 32 x 32 block of the
full-size layer, set if any of the four copies (light, dark and their half-size twins) has a
pixel there that isn't fully see-through. site/edge/edge.js takes the layer off the page
whenever no set block is on screen.

Run it again whenever the over-relief images change. tests/test_edge_rim.py fails if the grid
no longer covers them.

  uv run --with pillow --with numpy python look/edge-rim.py [site/edge]
"""
import base64, json, sys
import numpy as np
from PIL import Image

Image.MAX_IMAGE_PIXELS = None
CELL = 32  # Full-size layer pixels per block.


def grid(folder):
    meta = json.load(open(f"{folder}/edges.json"))
    marked = np.zeros((meta["height"] // CELL, meta["width"] // CELL), bool)
    for theme in ("light", "dark"):
        for half in ("", "-half"):
            alpha = np.array(Image.open(f"{folder}/over-relief-{theme}{half}.webp").convert("RGBA"))[:, :, 3]
            cell = CELL // (meta["width"] // alpha.shape[1])
            marked |= (alpha.reshape(alpha.shape[0] // cell, cell, alpha.shape[1] // cell, cell) > 0).any(axis=(1, 3))
    return meta, marked


if __name__ == "__main__":
    folder = sys.argv[1] if len(sys.argv) > 1 else "site/edge"
    meta, marked = grid(folder)
    rows, cols = marked.shape
    # Row by row, eight blocks to a byte, first block in the top bit.
    meta["rim"] = {"cell": CELL, "cols": cols, "rows": rows, "cells": base64.b64encode(np.packbits(marked.ravel()).tobytes()).decode()}
    json.dump(meta, open(f"{folder}/edges.json", "w"))
    print(f"{int(marked.sum())} of {marked.size} blocks hold part of the rim")
