"""fill_outside must keep every rendered pixel and leave no black past the map's edge.

    uv run --with numpy --with pillow python tests/test_fill.py

It reads the function out of modal_app/sample.py, so Modal need not be installed.
"""

from pathlib import Path

import numpy as np
from PIL import Image

source = (Path(__file__).resolve().parent.parent / "modal_app/sample.py").read_text()
space: dict = {}
exec(source[source.index("def fill_outside") : source.index("def join_check")], space)
fill_outside = space["fill_outside"]

# An odd-sized area whose render covers an L shape, as at a corner of the map.
size = (1501, 1203)
render = np.zeros((size[1], size[0], 3), dtype=np.uint8)
content = np.zeros((size[1], size[0]), dtype=np.uint8)
content[:700, :] = 255
content[:, :400] = 255
rng = np.random.default_rng(0)
render[content > 0] = (120, 140, 60) + rng.integers(-20, 20, size=((content > 0).sum(), 3))

filled = np.asarray(fill_outside(Image.fromarray(render), Image.fromarray(content)))
known = content > 0
assert (filled[known] == render[known]).all(), "rendered pixels are unchanged"
assert np.abs(filled[~known].astype(int) - (120, 140, 60)).max() <= 25, "the fill takes the render's own colours"

# A whole render is returned as it is.
whole = Image.fromarray(render)
assert fill_outside(whole, Image.new("L", size, 255)) is whole
print("fill_outside: all checks passed")
