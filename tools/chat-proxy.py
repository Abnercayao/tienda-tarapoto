#!/usr/bin/env python3
r"""
tools/chat-proxy.py - Proxy minimo del chat de Palmera Brava (Python 3, solo biblioteca estandar).

Escucha SOLO en 127.0.0.1:8787 y es lo unico que el tunel de Cloudflare publica. Hace exactamente esto:
  OPTIONS /chat  -> CORS (preflight y "sondeo" de la web). Responde 204 si WF11 esta publicado en n8n
                    (lo comprueba con un OPTIONS al webhook, cache 10 s) y 503 si no.
  POST    /chat  -> JSON de hasta 4 KB, reenviado a http://127.0.0.1:5678/webhook/chat-tienda (WF11).
                    Devuelve el codigo y el JSON de n8n (200/400/429); cualquier otra cosa -> 502 con respaldo.
  GET     /salud -> {"ok": true} sin tocar n8n (tools/iniciar-chat.ps1 lo usa para probar el tunel).
Todo lo demas -> 404/405. Nunca reenvia otras rutas de n8n (ni /webhook/chat-url, ni la UI, ni la API).

Seguridad:
  - CORS solo para https://abnercayao.github.io, http://127.0.0.1:8080 y http://localhost:8080.
    Un POST con Origin de otro sitio -> 403 (sin Origin, p. ej. curl, se acepta y cuenta para el limite).
  - Limites: 12 POST por minuto por IP, 120 POST por minuto en total y 4 a la vez (protege la GPU).
  - IP del visitante = CF-Connecting-IP (la pone Cloudflare) o la del socket. Se REEMPLAZAN X-Forwarded-For y
    X-Real-IP hacia n8n (WF11 limita por IP con un hash); no se reenvia ninguna otra cabecera del visitante.
  - El registro (stdout) no guarda mensajes ni IP en claro (solo un hash corto).

Uso:   python tools\chat-proxy.py           (lo arranca tools\iniciar-chat.bat)
Opciones (o variables de entorno CHAT_PROXY_PUERTO / CHAT_PROXY_DESTINO), p. ej. para pruebas:
        python tools\chat-proxy.py --puerto 8788 --destino http://127.0.0.1:5698/webhook/chat-tienda
        (el destino solo puede ser http://127.0.0.1|localhost:<puerto>/webhook/chat-tienda)
"""
import hashlib
import ipaddress
import json
import os
import re
import sys
import threading
import time
import urllib.error
import urllib.request
from collections import deque
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit


def _arg(nombre):
    if nombre in sys.argv:
        i = sys.argv.index(nombre)
        return sys.argv[i + 1] if i + 1 < len(sys.argv) else ''
    return ''


HOST = '127.0.0.1'
PUERTO = int(_arg('--puerto') or os.environ.get('CHAT_PROXY_PUERTO') or '8787')
DESTINO = _arg('--destino') or os.environ.get('CHAT_PROXY_DESTINO') or 'http://127.0.0.1:5678/webhook/chat-tienda'
if not re.fullmatch(r'http://(127\.0\.0\.1|localhost):\d{2,5}/webhook/chat-tienda', DESTINO):
    sys.exit('CHAT_PROXY_DESTINO invalido: solo http://127.0.0.1:<puerto>/webhook/chat-tienda')
ORIGENES = {'https://abnercayao.github.io', 'http://127.0.0.1:8080', 'http://localhost:8080'}
MAX_CUERPO = 4096            # bytes del JSON del visitante
MAX_RESPUESTA = 65536        # bytes que se aceptan de n8n
TIMEOUT_N8N = 70             # s (WF11 corta Ollama a los 45 s; la web espera 60 s)
LIMITE_IP = 12               # POST por IP por ventana
LIMITE_TOTAL = 120           # POST en total por ventana
VENTANA = 60.0               # s
LIMITE_OPTIONS_IP = 60       # OPTIONS por IP por ventana
EN_VUELO = 4                 # POST reenviados a la vez
WHATSAPP = 'https://wa.me/51995542938'
RESPALDO = 'Ahora mismo no puedo responder por aquí. Escríbenos por WhatsApp y te atendemos al toque: ' + WHATSAPP

_cupos = threading.BoundedSemaphore(EN_VUELO)
_candado = threading.Lock()
_por_ip = {}                 # ip -> deque de tiempos (POST)
_opt_ip = {}                 # ip -> deque de tiempos (OPTIONS)
_total = deque()
_vivo = {'hasta': 0.0, 'ok': False}


def _ventana(cola, ahora):
    while cola and ahora - cola[0] > VENTANA:
        cola.popleft()


def permitir(ip, tabla, limite, global_tambien):
    """Ventana deslizante en memoria. Devuelve True si la peticion entra."""
    ahora = time.monotonic()
    with _candado:
        cola = tabla.setdefault(ip, deque())
        _ventana(cola, ahora)
        if global_tambien:
            _ventana(_total, ahora)
            if len(_total) >= LIMITE_TOTAL:
                return False
        if len(cola) >= limite:
            return False
        cola.append(ahora)
        if global_tambien:
            _total.append(ahora)
        if len(tabla) > 5000:  # limpieza de IP viejas
            for k in [k for k, c in tabla.items() if not c or ahora - c[-1] > VENTANA]:
                del tabla[k]
        return True


def webhook_vivo():
    """OPTIONS al webhook de WF11 (cache 10 s si responde, 3 s si no). 2xx = WF11 publicado."""
    ahora = time.monotonic()
    if ahora < _vivo['hasta']:
        return _vivo['ok']
    ok = False
    try:
        req = urllib.request.Request(DESTINO, method='OPTIONS', headers={
            'Origin': 'https://abnercayao.github.io', 'Access-Control-Request-Method': 'POST', 'User-Agent': 'pb-chat-proxy/1'})
        with urllib.request.urlopen(req, timeout=3) as r:
            ok = 200 <= r.status < 300
    except urllib.error.HTTPError as e:
        ok = 200 <= e.code < 300
    except Exception:
        ok = False
    _vivo['ok'] = ok
    _vivo['hasta'] = ahora + (10 if ok else 3)
    return ok


def hash_corto(ip):
    return hashlib.sha256(('pb-proxy|' + ip).encode('utf-8')).hexdigest()[:10]


class Manejador(BaseHTTPRequestHandler):
    server_version = 'pb-chat-proxy'
    sys_version = ''
    protocol_version = 'HTTP/1.1'
    timeout = 20  # s para leer la peticion del visitante (evita conexiones colgadas)

    # ---------- utilidades ----------
    def ip_visitante(self):
        par = self.client_address[0] if self.client_address else ''
        cf = (self.headers.get('CF-Connecting-IP') or '').strip()
        if cf:
            try:
                return str(ipaddress.ip_address(cf))
            except ValueError:
                pass
        return par or 'desconocida'

    def origen(self):
        o = (self.headers.get('Origin') or '').strip()
        return o, (o in ORIGENES)

    def ruta(self):
        return urlsplit(self.path).path

    def cabeceras_cors(self, origen_ok, o):
        if origen_ok:
            self.send_header('Access-Control-Allow-Origin', o)
        self.send_header('Vary', 'Origin')

    def responder(self, status, cuerpo=None, cors=None, extra=None):
        datos = b'' if cuerpo is None else json.dumps(cuerpo, ensure_ascii=False).encode('utf-8')
        self.send_response(status)
        if cuerpo is not None:
            self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(datos)))
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Referrer-Policy', 'no-referrer')
        if cors is not None:
            self.cabeceras_cors(*cors)
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        if datos and self.command != 'HEAD':
            self.wfile.write(datos)
        self._status = status

    def log_message(self, formato, *args):  # silencia el registro por defecto (traeria la IP)
        pass

    def registrar(self, t0):
        ms = int((time.monotonic() - t0) * 1000)
        print('%s %s %s %s %dms ip#%s' % (time.strftime('%Y-%m-%dT%H:%M:%S'), self.command, self.ruta()[:40],
                                           getattr(self, '_status', '-'), ms, hash_corto(self.ip_visitante())), flush=True)

    def no_permitido(self):
        t0 = time.monotonic()
        o, ok = self.origen()
        if self.ruta() in ('/chat', '/salud'):
            self.responder(405, {'respuesta': 'Método no permitido.', 'escribiendo_ms': 0}, (ok, o), {'Allow': 'POST, OPTIONS' if self.ruta() == '/chat' else 'GET'})
        else:
            self.responder(404, {'respuesta': 'No existe.', 'escribiendo_ms': 0}, (ok, o))
        self.close_connection = True
        self.registrar(t0)

    do_PUT = do_DELETE = do_PATCH = do_HEAD = do_TRACE = do_CONNECT = no_permitido

    # ---------- GET /salud ----------
    def do_GET(self):
        if self.ruta() != '/salud':
            return self.no_permitido()
        t0 = time.monotonic()
        o, ok = self.origen()
        self.responder(200, {'ok': True}, (ok, o))
        self.registrar(t0)

    # ---------- OPTIONS /chat ----------
    def do_OPTIONS(self):
        t0 = time.monotonic()
        if self.ruta() != '/chat':
            return self.no_permitido()
        o, ok = self.origen()
        if o and not ok:
            self.responder(403, None)
            return self.registrar(t0)
        if not permitir(self.ip_visitante(), _opt_ip, LIMITE_OPTIONS_IP, False):
            self.responder(429, None, (ok, o))
            return self.registrar(t0)
        estado = 204 if webhook_vivo() else 503
        self.responder(estado, None, (ok, o), {
            'Access-Control-Allow-Methods': 'POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type',
            'Access-Control-Max-Age': '600'})
        self.registrar(t0)

    # ---------- POST /chat ----------
    def do_POST(self):
        t0 = time.monotonic()
        if self.ruta() != '/chat':
            return self.no_permitido()
        o, ok = self.origen()
        cors = (ok, o)
        if o and not ok:
            self.responder(403, {'respuesta': 'Origen no permitido.', 'escribiendo_ms': 0})
            self.close_connection = True
            return self.registrar(t0)
        if (self.headers.get('Transfer-Encoding') or '').lower() not in ('', 'identity'):
            self.responder(411, {'respuesta': 'Falta Content-Length.', 'escribiendo_ms': 0}, cors)
            self.close_connection = True
            return self.registrar(t0)
        try:
            largo = int(self.headers.get('Content-Length') or '-1')
        except ValueError:
            largo = -1
        if largo < 0:
            self.responder(411, {'respuesta': 'Falta Content-Length.', 'escribiendo_ms': 0}, cors)
            self.close_connection = True
            return self.registrar(t0)
        if largo > MAX_CUERPO:
            self.responder(413, {'respuesta': 'Tu mensaje es muy largo. ¿Me lo resumes?', 'escribiendo_ms': 0}, cors)
            self.close_connection = True  # no se lee el cuerpo
            return self.registrar(t0)
        try:
            cuerpo = self.rfile.read(largo) if largo else b''
        except OSError:  # el visitante no mando el cuerpo completo (timeout)
            self.close_connection = True
            return
        if len(cuerpo) != largo:
            self.close_connection = True
            return
        if not (self.headers.get('Content-Type') or '').lower().startswith('application/json'):
            self.responder(415, {'respuesta': 'Formato no válido.', 'escribiendo_ms': 0}, cors)
            return self.registrar(t0)
        try:
            datos = json.loads(cuerpo.decode('utf-8'))
        except (UnicodeDecodeError, ValueError):
            datos = None
        if not isinstance(datos, dict):
            self.responder(400, {'respuesta': 'No pude leer tu mensaje. Recarga la página y vuelve a intentarlo.', 'escribiendo_ms': 0}, cors)
            return self.registrar(t0)
        ip = self.ip_visitante()
        if not permitir(ip, _por_ip, LIMITE_IP, True):
            self.responder(429, {'respuesta': 'Vas muy rápido: espera unos segundos y vuelve a escribirme.', 'escribiendo_ms': 0}, cors, {'Retry-After': '30'})
            return self.registrar(t0)
        if not _cupos.acquire(blocking=False):
            self.responder(503, {'respuesta': RESPALDO, 'escribiendo_ms': 0}, cors, {'Retry-After': '20'})
            return self.registrar(t0)
        try:
            status, resp = self.reenviar(datos, ip)
        finally:
            _cupos.release()
        self.responder(status, resp, cors)
        self.registrar(t0)

    def reenviar(self, datos, ip):
        """POST a WF11 solo con cabeceras propias. Devuelve (status, json)."""
        carga = json.dumps(datos, ensure_ascii=False, separators=(',', ':')).encode('utf-8')
        req = urllib.request.Request(DESTINO, data=carga, method='POST', headers={
            'Content-Type': 'application/json', 'User-Agent': 'pb-chat-proxy/1', 'X-Forwarded-For': ip, 'X-Real-IP': ip})
        try:
            with urllib.request.urlopen(req, timeout=TIMEOUT_N8N) as r:
                status, crudo = r.status, r.read(MAX_RESPUESTA + 1)
        except urllib.error.HTTPError as e:
            status, crudo = e.code, e.read(MAX_RESPUESTA + 1)
        except Exception as e:  # n8n apagado, timeout, etc.
            lento = isinstance(e, TimeoutError) or 'timed out' in str(e).lower()
            print('  n8n no respondio: %s' % type(e).__name__, file=sys.stderr, flush=True)
            return (504 if lento else 502), {'respuesta': RESPALDO, 'escribiendo_ms': 0}
        if status in (200, 400, 429) and len(crudo) <= MAX_RESPUESTA:
            try:
                j = json.loads(crudo.decode('utf-8'))
                if isinstance(j, dict) and isinstance(j.get('respuesta'), str):
                    return status, j
            except (UnicodeDecodeError, ValueError):
                pass
        print('  n8n devolvio HTTP %s inesperado' % status, file=sys.stderr, flush=True)
        return 502, {'respuesta': RESPALDO, 'escribiendo_ms': 0}


class Servidor(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = False  # en Windows permitiria compartir el puerto con otro proceso


def main():
    try:
        srv = Servidor((HOST, PUERTO), Manejador)
    except OSError as e:
        print('No pude abrir %s:%d (%s). Siguiente paso: cierra el otro chat-proxy o usa tools\\detener-chat.bat.' % (HOST, PUERTO, e), file=sys.stderr, flush=True)
        return 1
    print('chat-proxy escuchando en http://%s:%d -> %s (solo POST/OPTIONS /chat y GET /salud)' % (HOST, PUERTO, DESTINO), flush=True)
    try:
        srv.serve_forever(poll_interval=0.5)
    except KeyboardInterrupt:
        pass
    finally:
        srv.server_close()
    return 0


if __name__ == '__main__':
    sys.exit(main())
