"""
Deja los dibujos de Robin listos para la web.

    python scripts/robin-para-web.py

Necesita Pillow (pip install pillow). Solo hace falta correrlo si se agrega una
pose nueva o se vuelve a dibujar alguna: los PNG ya generados viven junto al
resto del sitio, en public/images/robin/.

Los originales de images/ son enormes (7680 px de lado, varios megas cada uno):
son el archivo, no lo que se manda al navegador. Aqui se recortan al dibujo, se
bajan a un tamano de pantalla y se guardan otra vez con transparencia.

Pasos por imagen:
  1. Recorte al contenido segun el canal alfa, con un margen chico.
  2. Escalado al max_side que le toque a esa pose.
  3. Guardado como PNG con alfa, optimizado.

Antes esto era scripts/sketch2png.py y hacia otra cosa: las poses eran fotos de
bocetos a lapiz sobre papel, y el trabajo era separar el trazo del papel para
dejarlo a linea sobre fondo transparente. Ya no: Robin esta dibujado a color y
con su propia transparencia, igual que el original de la marca, asi que todo
ese revelado sobra.
"""
import os
from PIL import Image

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ORIGEN = os.path.join(RAIZ, "images")                     # el archivo, a tamano completo
DESTINO = os.path.join(RAIZ, "public", "images", "robin")  # lo que consume la web

# max_side: cuanto mide el lado largo ya en la web. Los que salen grandes en
# pantalla (el estrellado de la 404, el mensajero) piden mas pixeles que los
# que casi siempre aparecen chiquitos.
TRABAJOS = {
    "robinidle.png":  dict(out="idle.png",    max_side=820),
    "robintalk.png":  dict(out="talking.png", max_side=820),
    "robinmail.png":  dict(out="mailman.png", max_side=860),
    "robinghost.png": dict(out="ghost.png",   max_side=760),
    "robinsad.png":   dict(out="sad.png",     max_side=820),
    "robin404.png":   dict(out="error.png",   max_side=960),
    "robinhappy.png": dict(out="happy.png",   max_side=820),
}


def procesar(nombre, cfg):
    ruta = os.path.join(ORIGEN, nombre)
    if not os.path.exists(ruta):
        # Una pose que todavia no esta dibujada no es un error: se avisa y se
        # sigue con las demas. Ver la nota de 'happy' en public/js/mascot.js.
        print(f"{nombre:18s} -- falta el original, se salta")
        return

    im = Image.open(ruta).convert("RGBA")
    w, h = im.size

    # Recorte al dibujo: el original trae mucho lienzo vacio alrededor, y ese
    # vacio se lleva la mitad del alto cuando la pose se mete en una caja.
    caja = im.getchannel("A").getbbox()
    if caja is None:
        raise SystemExit(f"{nombre}: la imagen esta entera transparente")
    margen = int(max(w, h) * 0.01)
    x0, y0, x1, y1 = caja
    im = im.crop((max(0, x0 - margen), max(0, y0 - margen),
                  min(w, x1 + margen), min(h, y1 + margen)))

    escala = cfg["max_side"] / max(im.size)
    if escala < 1:
        im = im.resize((round(im.width * escala), round(im.height * escala)), Image.LANCZOS)

    os.makedirs(DESTINO, exist_ok=True)
    destino = os.path.join(DESTINO, cfg["out"])
    im.save(destino, optimize=True)
    print(f"{nombre:18s} -> {cfg['out']:12s} {im.size}  {os.path.getsize(destino)//1024} KB")


for nombre, cfg in TRABAJOS.items():
    procesar(nombre, cfg)
