"""
Convierte las fotos de los bocetos a lapiz de images/ en PNG de linea limpia con
fondo transparente y los deja en public/images/robin/.

    python scripts/sketch2png.py

Necesita Pillow y numpy (pip install pillow numpy). Solo hace falta correrlo si
se agrega una pose nueva o se vuelve a dibujar alguna: los PNG ya generados
viven junto al resto del sitio.

Pasos por imagen:
  1. Escala de grises.
  2. Estima la iluminacion del papel con un desenfoque grande y divide: quita
     la sombra/vineta de la foto y deja el papel plano.
  3. Convierte la tinta en canal alfa con niveles (lo/hi) para rescatar el
     trazo suave sin arrastrar el grano del papel.
  4. Recorta al contenido, agrega margen y escala a un tamano razonable.
  5. Pinta el trazo del color de tinta de la marca.
"""
import os
import numpy as np
from PIL import Image, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "images")                     # las fotos originales
OUT = os.path.join(ROOT, "public", "images", "robin")  # lo que consume la web

INK = (43, 33, 27)  # tinta calida, hermana de --rr-ink

# lo/hi = niveles de tinta. lo mas alto ignora mas grano; hi mas bajo opaca antes.
JOBS = {
    "robinidle.jpg":     dict(out="idle.png",    lo=20, hi=72, max_side=760),
    "robintalking.jpg":  dict(out="talking.png", lo=20, hi=72, max_side=760),
    "robinghost.jpg":    dict(out="ghost.png",   lo=18, hi=62, max_side=700),
    "robinsad.jpg":      dict(out="sad.png",     lo=18, hi=64, max_side=760),
    "robinmailman.jpg":  dict(out="mailman.png", lo=20, hi=72, max_side=820),
    "robinerror404.jpg": dict(out="error.png",   lo=22, hi=78, max_side=920),
    "robinhappy.jpg":    dict(out="happy.png",   lo=12, hi=64, max_side=560),
}


def flatten(gray: np.ndarray, radius: int) -> np.ndarray:
    """Divide la imagen entre su propia iluminacion para aplanar el papel."""
    bg = Image.fromarray(gray).filter(ImageFilter.GaussianBlur(radius))
    bg = np.asarray(bg, dtype=np.float32)
    bg = np.maximum(bg, 1.0)
    flat = gray.astype(np.float32) / bg * 255.0
    return np.clip(flat, 0, 255)


def process(name: str, cfg: dict) -> None:
    im = Image.open(os.path.join(SRC, name)).convert("L")
    w, h = im.size
    gray = np.asarray(im, dtype=np.uint8)

    flat = flatten(gray, radius=max(12, min(w, h) // 22))
    ink = 255.0 - flat                     # 0 = papel, alto = trazo
    lo, hi = cfg["lo"], cfg["hi"]
    alpha = np.clip((ink - lo) / (hi - lo), 0, 1)
    alpha = alpha ** 0.7                   # gamma suave: rescata el trazo tenue

    # Limpia el grano aislado que sobrevive al umbral.
    a_img = Image.fromarray((alpha * 255).astype(np.uint8))
    a_img = a_img.filter(ImageFilter.MedianFilter(3))
    # Engorda el trazo: al reducir de 3000 px a ~800 la linea fina se evapora.
    # Solo aplica a las fotos grandes; en una imagen ya pequena embarra el dibujo.
    if max(w, h) > 1500:
        a_img = a_img.filter(ImageFilter.MaxFilter(5))
    alpha = np.asarray(a_img, dtype=np.float32) / 255.0

    # Recorte al contenido: solo cuenta lo que esta bien opaco.
    ys, xs = np.where(alpha > 0.35)
    if len(xs) == 0:
        raise SystemExit(f"{name}: no se encontro trazo")
    pad = int(max(w, h) * 0.02)
    x0, x1 = max(0, xs.min() - pad), min(w, xs.max() + pad + 1)
    y0, y1 = max(0, ys.min() - pad), min(h, ys.max() + pad + 1)
    alpha = alpha[y0:y1, x0:x1]

    ah, aw = alpha.shape
    rgba = np.zeros((ah, aw, 4), dtype=np.uint8)
    rgba[..., 0], rgba[..., 1], rgba[..., 2] = INK
    rgba[..., 3] = (alpha * 255).astype(np.uint8)

    out = Image.fromarray(rgba)
    scale = cfg["max_side"] / max(out.size)
    if scale < 1:
        out = out.resize((round(out.width * scale), round(out.height * scale)), Image.LANCZOS)

    os.makedirs(OUT, exist_ok=True)
    dest = os.path.join(OUT, cfg["out"])
    out.save(dest, optimize=True)
    print(f"{name:20s} -> {cfg['out']:12s} {out.size}  {os.path.getsize(dest)//1024} KB")


for name, cfg in JOBS.items():
    process(name, cfg)
