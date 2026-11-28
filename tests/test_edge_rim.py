"""The rim grid in site/edge/edges.json must cover every pixel of the rim layers.

  uv run --with pytest --with pillow --with numpy pytest tests/test_edge_rim.py
"""
import base64, importlib.util, json, pathlib
import numpy as np

ROOT = pathlib.Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location("edge_rim", ROOT / "look" / "edge-rim.py")
edge_rim = importlib.util.module_from_spec(spec)
spec.loader.exec_module(edge_rim)


def test_grid_covers_the_rim_layers():
    meta, marked = edge_rim.grid(str(ROOT / "site" / "edge"))
    rim = meta["rim"]
    assert (rim["rows"], rim["cols"]) == marked.shape and rim["cell"] == edge_rim.CELL
    saved = np.unpackbits(np.frombuffer(base64.b64decode(rim["cells"]), np.uint8))[: marked.size].reshape(marked.shape).astype(bool)
    missing = marked & ~saved
    assert not missing.any(), f"{int(missing.sum())} blocks of the rim are not in edges.json: run look/edge-rim.py"


def test_grid_is_mostly_empty():
    # If the rim ever fills the layer, the grid stops being worth having.
    rim = json.load(open(ROOT / "site" / "edge" / "edges.json"))["rim"]
    bits = np.unpackbits(np.frombuffer(base64.b64decode(rim["cells"]), np.uint8))
    assert bits.mean() < 0.1
