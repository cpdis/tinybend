from PIL import Image
import os, sys
def region(z, x0, y0, w, h, root="tiles"):
    """Assemble map pixels [x0,x0+w)x[y0,y0+h) at zoom z (pyramid px)."""
    im = Image.new("RGBA", (w, h), (0,0,0,0))
    for c in range(x0//512, (x0+w-1)//512+1):
        for r in range(y0//512, (y0+h-1)//512+1):
            p = f"{root}/{z}/{c}/{r}.webp"
            if os.path.exists(p):
                im.paste(Image.open(p).convert("RGBA"), (c*512-x0, r*512-y0))
    return im
