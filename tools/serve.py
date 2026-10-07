#!/usr/bin/env python3
"""
tools/serve.py - Servidor local de prueba de "Palmera Brava" (diapositiva 20 / PLAN F3).

Sirve SOLO esta carpeta del repo, SOLO en 127.0.0.1 (nunca en la red), bajo la misma subruta que
GitHub Pages, para detectar rutas absolutas rotas antes de publicar:

    python tools\\serve.py                  ->  http://127.0.0.1:8080/tienda-tarapoto/
    python tools\\serve.py --port 8090      (otro puerto; ojo: el CORS de WF8 solo admite el 8080)

- "/" redirige a /tienda-tarapoto/ ; rutas desconocidas devuelven 404.html con estado 404 (como Pages).
- No lista carpetas, no sirve archivos ocultos (.git, .env...), y rechaza Host extraños (DNS rebinding).
- Cache-Control: no-cache (revalida siempre; responde 304 si no cambió).
- Ctrl+C para detenerlo. Si Windows pregunta "¿Permitir acceso?" para python.exe, responde Cancelar.
Sin dependencias (Python 3.8+ estándar).
"""
import argparse
import http.server
import os
import posixpath
import sys
import urllib.parse

BASE = "/tienda-tarapoto"
RAIZ = os.path.realpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
HOST = "127.0.0.1"

TIPOS = {
    ".html": "text/html; charset=utf-8",
    ".htm": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".xml": "application/xml; charset=utf-8",
    ".txt": "text/plain; charset=utf-8",
    ".md": "text/plain; charset=utf-8",
    ".svg": "image/svg+xml",
    ".webp": "image/webp",
    ".avif": "image/avif",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".ico": "image/x-icon",
    ".woff2": "font/woff2",
    ".woff": "font/woff",
    ".webmanifest": "application/manifest+json",
}


class Manejador(http.server.SimpleHTTPRequestHandler):
    server_version = "PalmeraBravaLocal/1.0"
    sys_version = ""

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=RAIZ, **kwargs)

    # --- utilidades -------------------------------------------------------
    def guess_type(self, path):
        ext = os.path.splitext(path)[1].lower()
        return TIPOS.get(ext) or super().guess_type(path)

    def end_headers(self):
        self.send_header("Cache-Control", "no-cache")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "strict-origin-when-cross-origin")
        # Demo privada (contrato v2): que ningún buscador indexe ni siga enlaces, igual que el meta robots.
        self.send_header("X-Robots-Tag", "noindex, nofollow")
        super().end_headers()

    def log_message(self, formato, *args):
        sys.stderr.write("%s  %s\n" % (self.log_date_time_string(), formato % args))

    def _host_valido(self):
        host = (self.headers.get("Host") or "").strip().lower()
        puerto = str(self.server.server_address[1])
        return host in ("127.0.0.1:" + puerto, "localhost:" + puerto) or (
            puerto == "80" and host in ("127.0.0.1", "localhost"))

    def _redirigir(self, destino, codigo=302):
        self.send_response(codigo)
        self.send_header("Location", destino)
        self.send_header("Content-Length", "0")
        self.end_headers()

    def _no_encontrado(self):
        pagina = os.path.join(RAIZ, "404.html")
        cuerpo = b"404 - No encontrado"
        tipo = "text/plain; charset=utf-8"
        if os.path.isfile(pagina):
            with open(pagina, "rb") as f:
                cuerpo = f.read()
            tipo = "text/html; charset=utf-8"
        self.send_response(404)
        self.send_header("Content-Type", tipo)
        self.send_header("Content-Length", str(len(cuerpo)))
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(cuerpo)

    def _resolver(self):
        """Devuelve la ruta real del archivo pedido dentro del repo, o None."""
        partes = urllib.parse.urlsplit(self.path)
        ruta = urllib.parse.unquote(partes.path, errors="strict")
        if "\x00" in ruta or "\\" in ruta:
            return None
        normal = posixpath.normpath("/" + ruta.lstrip("/"))  # resuelve "..", como el navegador
        # normpath quita la "/" final: "/tienda-tarapoto/" queda igual a BASE (la portada).
        if normal != BASE and not normal.startswith(BASE + "/"):
            return None
        segmentos = [s for s in normal[len(BASE):].split("/") if s]
        if any(s.startswith(".") for s in segmentos):  # .git, .env, .nojekyll...
            return None
        destino = os.path.realpath(os.path.join(RAIZ, *segmentos)) if segmentos else RAIZ
        if os.path.commonpath([destino, RAIZ]) != RAIZ:
            return None
        if os.path.isdir(destino):
            if not ruta.endswith("/"):
                return ("redirigir", ruta + "/" + (("?" + partes.query) if partes.query else ""))
            destino = os.path.join(destino, "index.html")
        return destino if os.path.isfile(destino) else None

    # --- métodos HTTP -----------------------------------------------------
    def _atender(self, cabeza_solo):
        if not self._host_valido():
            self.send_error(403, "Host no permitido (usa 127.0.0.1 o localhost)")
            return
        ruta = urllib.parse.urlsplit(self.path).path
        if ruta in ("/", ""):
            self._redirigir(BASE + "/")
            return
        if ruta == BASE:
            self._redirigir(BASE + "/", 301)
            return
        try:
            destino = self._resolver()
        except (UnicodeDecodeError, ValueError):
            destino = None
        if isinstance(destino, tuple):
            self._redirigir(destino[1], 301)
            return
        if destino is None:
            self._no_encontrado()
            return
        # Delega en SimpleHTTPRequestHandler (ETag/Last-Modified, 304, Content-Type) con la ruta ya validada.
        self.path = "/" + os.path.relpath(destino, RAIZ).replace(os.sep, "/")
        if cabeza_solo:
            super().do_HEAD()
        else:
            super().do_GET()

    def do_GET(self):
        self._atender(False)

    def do_HEAD(self):
        self._atender(True)

    def list_directory(self, path):  # nunca listar carpetas
        self._no_encontrado()
        return None

    def _no_permitido(self):
        self.send_error(405, "Solo GET y HEAD")

    do_POST = do_PUT = do_DELETE = do_PATCH = do_OPTIONS = _no_permitido


class Servidor(http.server.ThreadingHTTPServer):
    allow_reuse_address = False  # en Windows, SO_REUSEADDR dejaría abrir dos servidores en el mismo puerto
    daemon_threads = True


def main():
    p = argparse.ArgumentParser(description="Servidor local de Palmera Brava (solo 127.0.0.1).")
    p.add_argument("--port", type=int, default=8080, help="puerto (por defecto 8080)")
    a = p.parse_args()

    try:
        servidor = Servidor((HOST, a.port), Manejador)
    except OSError as e:
        print("No se pudo abrir %s:%d (%s)." % (HOST, a.port, e.strerror or e), file=sys.stderr)
        print("Siguiente paso: si ya hay otro serve.py abierto, usa ese; o prueba con --port 8090.", file=sys.stderr)
        return 1
    url = "http://%s:%d%s/" % (HOST, a.port, BASE)
    print("Palmera Brava en local: %s" % url)
    print("Panel local:            %sadmin.html" % url)
    print("Sirviendo solo: %s (Ctrl+C para detener)" % RAIZ)
    try:
        servidor.serve_forever()
    except KeyboardInterrupt:
        print("\nServidor detenido.")
    finally:
        servidor.server_close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
