#!/usr/bin/env python3
r"""
tools/chat-proxy.py - Proxy minimo del chat y de los pedidos de Palmera Brava (Python 3, solo biblioteca estandar).

Escucha SOLO en 127.0.0.1:8787 y es lo unico que el tunel de Cloudflare publica. Allowlist EXACTA (todo lo demas -> 404/405):
  OPTIONS /chat               -> CORS. 204 si WF11 esta publicado en n8n (OPTIONS al webhook, cache 10 s); 503 si no.
  POST    /chat               -> JSON <= 4 KB  -> /webhook/chat-tienda        (WF11, chat Vale)
  POST    /pedido             -> JSON <= 8 KB  -> /webhook/pedido-crear       (WF13, checkout: crea el pedido y el pago de Mercado Pago)
  POST    /seguimiento        -> JSON <= 2 KB  -> /webhook/pedido-seguimiento (WF15, numero + correo)
  POST    /pedido/consultar   -> lo mismo que /seguimiento (nombre del CONTRATO 00.7)
  POST    /pedido/pago        -> JSON <= 2 KB  -> /webhook/pedido-pago        (WF14, vuelta de Mercado Pago a la web)
  OPTIONS de esas 4 rutas     -> CORS (204), sin tocar n8n.
  POST    /mp-notificacion    -> JSON <= 8 KB  -> /webhook/mp-notificacion    (WF14, aviso de Mercado Pago; servidor a servidor)
  POST    /mp/notificacion    -> lo mismo (nombre del CONTRATO 00.7). Sin CORS: un POST con Origin de navegador -> 403.
                                 Solo pasan la query data.id/type/topic/id/source_news y las cabeceras x-signature/x-request-id.
  GET     /salud              -> {"ok": true} sin tocar n8n (tools/iniciar-chat.ps1 lo usa para probar el tunel).
Nunca reenvia otras rutas de n8n (ni /webhook/chat-url, ni la UI, ni la API).

Seguridad:
  - CORS solo para https://abnercayao.github.io, http://127.0.0.1:8080 y http://localhost:8080.
    Un POST con Origin de otro sitio -> 403 (sin Origin, p. ej. curl, se acepta y cuenta para el limite).
  - Limites por IP y minuto: chat 12, pedido 5, seguimiento 15, pago 15; totales: chat 120, pedidos 60, Mercado Pago 300.
    A la vez: chat 4 (protege la GPU), pedidos 4, Mercado Pago 4.
  - IP del visitante = CF-Connecting-IP (la pone Cloudflare) o la del socket. Se REEMPLAZAN X-Forwarded-For y
    X-Real-IP hacia n8n (WF11/WF13/WF15 limitan por IP con un hash); no se reenvia ninguna otra cabecera del visitante.
  - El registro (stdout) no guarda mensajes, pedidos ni IP en claro (solo un hash corto).

Uso:   python tools\chat-proxy.py           (lo arranca tools\iniciar-chat.bat)
Opciones (o variables de entorno CHAT_PROXY_PUERTO / CHAT_PROXY_DESTINO), p. ej. para pruebas:
        python tools\chat-proxy.py --puerto 8788 --destino http://127.0.0.1:5698/webhook/chat-tienda
        (el destino solo puede ser http://127.0.0.1|localhost:<puerto>/webhook/chat-tienda; las demas rutas usan el mismo n8n)
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
from urllib.parse import parse_qsl, urlencode, urlsplit


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
BASE_WEBHOOK = DESTINO[:-len('chat-tienda')]   # http://127.0.0.1:5678/webhook/
ORIGENES = {'https://abnercayao.github.io', 'http://127.0.0.1:8080', 'http://localhost:8080'}
MAX_RESPUESTA = 65536        # bytes que se aceptan de n8n
VENTANA = 60.0               # s
LIMITE_OPTIONS_IP = 60       # OPTIONS por IP por ventana
WHATSAPP = 'https://wa.me/51995542938'
RESPALDO = 'Ahora mismo no puedo responder por aquí. Escríbenos por WhatsApp y te atendemos al toque: ' + WHATSAPP
RESPALDO_PEDIDO = 'No pudimos procesar tu solicitud ahora. Vuelve a intentarlo en unos minutos o escríbenos por WhatsApp: ' + WHATSAPP

# grupo -> limites y cupos compartidos (POST /seguimiento y /pedido/consultar comparten el grupo "seguimiento")
GRUPOS = {
    'chat':        {'ip': 12, 'total': 120, 'cupos': threading.BoundedSemaphore(4)},
    'pedido':      {'ip': 5,  'total': 60,  'cupos': threading.BoundedSemaphore(4)},
    'seguimiento': {'ip': 15, 'total': 60,  'cupos': None},
    'pago':        {'ip': 15, 'total': 60,  'cupos': None},
    'mp':          {'ip': 300, 'total': 300, 'cupos': threading.BoundedSemaphore(4)},
}
GRUPOS['seguimiento']['cupos'] = GRUPOS['pedido']['cupos']
GRUPOS['pago']['cupos'] = GRUPOS['pedido']['cupos']
# ruta publica -> (webhook de n8n, grupo, max bytes, timeout s, cors)
RUTAS = {
    '/chat':             ('chat-tienda',        'chat',        4096, 70, True),
    '/pedido':           ('pedido-crear',       'pedido',      8192, 45, True),
    '/seguimiento':      ('pedido-seguimiento', 'seguimiento', 2048, 25, True),
    '/pedido/consultar': ('pedido-seguimiento', 'seguimiento', 2048, 25, True),
    '/pedido/pago':      ('pedido-pago',        'pago',        2048, 35, True),
    '/mp-notificacion':  ('mp-notificacion',    'mp',          8192, 20, False),
    '/mp/notificacion':  ('mp-notificacion',    'mp',          8192, 20, False),
}
QUERY_MP = {'data.id', 'type', 'topic', 'id', 'source_news'}

_candado = threading.Lock()
_por_ip = {}                 # (grupo, ip) -> deque de tiempos (POST)
_totales = {g: deque() for g in GRUPOS}
_opt_ip = {}                 # ip -> deque de tiempos (OPTIONS)
_vivo = {'hasta': 0.0, 'ok': False}


def _ventana(cola, ahora):
    while cola and ahora - cola[0] > VENTANA:
        cola.popleft()


def permitir(clave, tabla, limite, total=None, limite_total=0):
    """Ventana deslizante en memoria. Devuelve True si la peticion entra."""
    ahora = time.monotonic()
    with _candado:
        cola = tabla.setdefault(clave, deque())
        _ventana(cola, ahora)
        if total is not None:
            _ventana(total, ahora)
            if len(total) >= limite_total:
                return False
        if len(cola) >= limite:
            return False
        cola.append(ahora)
        if total is not None:
            total.append(ahora)
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


def cuerpo_error(grupo, texto):
    """Forma del error segun la ruta: el chat espera {respuesta}, los pedidos {ok:false, errores}."""
    if grupo == 'chat':
        return {'respuesta': texto, 'escribiendo_ms': 0}
    return {'ok': False, 'errores': [texto]}


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
        r = self.ruta()
        if r in RUTAS or r == '/salud':
            permitidos = 'GET' if r == '/salud' else ('POST, OPTIONS' if RUTAS[r][4] else 'POST')
            self.responder(405, cuerpo_error('chat' if r in ('/chat', '/salud') else 'pedido', 'Método no permitido.'), (ok, o), {'Allow': permitidos})
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

    # ---------- OPTIONS (CORS) ----------
    def do_OPTIONS(self):
        t0 = time.monotonic()
        r = self.ruta()
        if r not in RUTAS or not RUTAS[r][4]:
            return self.no_permitido()
        o, ok = self.origen()
        if o and not ok:
            self.responder(403, None)
            return self.registrar(t0)
        if not permitir(self.ip_visitante(), _opt_ip, LIMITE_OPTIONS_IP):
            self.responder(429, None, (ok, o))
            return self.registrar(t0)
        estado = (204 if webhook_vivo() else 503) if r == '/chat' else 204
        self.responder(estado, None, (ok, o), {
            'Access-Control-Allow-Methods': 'POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type',
            'Access-Control-Max-Age': '600'})
        self.registrar(t0)

    # ---------- POST ----------
    def do_POST(self):
        t0 = time.monotonic()
        r = self.ruta()
        if r not in RUTAS:
            return self.no_permitido()
        webhook, grupo, max_cuerpo, timeout, con_cors = RUTAS[r]
        o, ok = self.origen()
        cors = (ok, o) if con_cors else None
        if o and (not ok or not con_cors):
            self.responder(403, cuerpo_error(grupo, 'Origen no permitido.'))
            self.close_connection = True
            return self.registrar(t0)
        if (self.headers.get('Transfer-Encoding') or '').lower() not in ('', 'identity'):
            self.responder(411, cuerpo_error(grupo, 'Falta Content-Length.'), cors)
            self.close_connection = True
            return self.registrar(t0)
        try:
            largo = int(self.headers.get('Content-Length') or '-1')
        except ValueError:
            largo = -1
        if largo < 0:
            self.responder(411, cuerpo_error(grupo, 'Falta Content-Length.'), cors)
            self.close_connection = True
            return self.registrar(t0)
        if largo > max_cuerpo:
            self.responder(413, cuerpo_error(grupo, 'Tu mensaje es muy largo. ¿Me lo resumes?' if grupo == 'chat' else 'La solicitud es demasiado grande.'), cors)
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
            self.responder(415, cuerpo_error(grupo, 'Formato no válido.'), cors)
            return self.registrar(t0)
        try:
            datos = json.loads(cuerpo.decode('utf-8'))
        except (UnicodeDecodeError, ValueError):
            datos = None
        if not isinstance(datos, dict):
            self.responder(400, cuerpo_error(grupo, 'No pude leer tu mensaje. Recarga la página y vuelve a intentarlo.'), cors)
            return self.registrar(t0)
        ip = self.ip_visitante()
        g = GRUPOS[grupo]
        if not permitir((grupo, ip), _por_ip, g['ip'], _totales[grupo], g['total']):
            self.responder(429, cuerpo_error(grupo, 'Vas muy rápido: espera unos segundos y vuelve a intentarlo.'), cors, {'Retry-After': '30'})
            return self.registrar(t0)
        if not g['cupos'].acquire(blocking=False):
            self.responder(503, cuerpo_error(grupo, RESPALDO if grupo == 'chat' else RESPALDO_PEDIDO), cors, {'Retry-After': '20'})
            return self.registrar(t0)
        try:
            status, resp = self.reenviar(webhook, grupo, timeout, datos, ip)
        finally:
            g['cupos'].release()
        self.responder(status, resp, cors)
        self.registrar(t0)

    def extras_mp(self):
        """Query y cabeceras que Mercado Pago necesita para la firma (solo valores con forma valida)."""
        q = [(k, v) for k, v in parse_qsl(urlsplit(self.path).query, keep_blank_values=False)
             if k in QUERY_MP and re.fullmatch(r'[A-Za-z0-9_.-]{1,40}', v)]
        cab = {}
        firma = (self.headers.get('x-signature') or '').strip()
        if firma and len(firma) <= 300 and re.fullmatch(r'[A-Za-z0-9=,._-]+', firma):
            cab['x-signature'] = firma
        rid = (self.headers.get('x-request-id') or '').strip()
        if rid and len(rid) <= 100 and re.fullmatch(r'[A-Za-z0-9._-]+', rid):
            cab['x-request-id'] = rid
        return ('?' + urlencode(q[:6])) if q else '', cab

    def reenviar(self, webhook, grupo, timeout, datos, ip):
        """POST a n8n solo con cabeceras propias. Devuelve (status, json)."""
        url = BASE_WEBHOOK + webhook
        cab = {'Content-Type': 'application/json', 'User-Agent': 'pb-chat-proxy/1', 'X-Forwarded-For': ip, 'X-Real-IP': ip}
        if grupo == 'mp':
            q, extra = self.extras_mp()
            url += q
            cab.update(extra)
        carga = json.dumps(datos, ensure_ascii=False, separators=(',', ':')).encode('utf-8')
        req = urllib.request.Request(url, data=carga, method='POST', headers=cab)
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:
                status, crudo = r.status, r.read(MAX_RESPUESTA + 1)
        except urllib.error.HTTPError as e:
            status, crudo = e.code, e.read(MAX_RESPUESTA + 1)
        except Exception as e:  # n8n apagado, timeout, etc.
            lento = isinstance(e, TimeoutError) or 'timed out' in str(e).lower()
            print('  n8n no respondio (%s): %s' % (grupo, type(e).__name__), file=sys.stderr, flush=True)
            return (504 if lento else 502), cuerpo_error(grupo, RESPALDO if grupo == 'chat' else RESPALDO_PEDIDO)
        if grupo == 'mp':  # Mercado Pago solo necesita saber si se recibio (2xx); si no, reintenta luego
            return (200, {'ok': True}) if 200 <= status < 300 else (502, {'ok': False})
        if len(crudo) <= MAX_RESPUESTA:
            try:
                j = json.loads(crudo.decode('utf-8'))
            except (UnicodeDecodeError, ValueError):
                j = None
            if grupo == 'chat' and status in (200, 400, 429) and isinstance(j, dict) and isinstance(j.get('respuesta'), str):
                return status, j
            if grupo != 'chat' and status in (200, 400, 409, 429, 502, 503) and isinstance(j, dict) and isinstance(j.get('ok'), bool):
                return status, j
        print('  n8n devolvio HTTP %s inesperado (%s)' % (status, grupo), file=sys.stderr, flush=True)
        return 502, cuerpo_error(grupo, RESPALDO if grupo == 'chat' else RESPALDO_PEDIDO)


class Servidor(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = False  # en Windows permitiria compartir el puerto con otro proceso


def main():
    try:
        srv = Servidor((HOST, PUERTO), Manejador)
    except OSError as e:
        print('No pude abrir %s:%d (%s). Siguiente paso: cierra el otro chat-proxy o usa tools\\detener-chat.bat.' % (HOST, PUERTO, e), file=sys.stderr, flush=True)
        return 1
    print('chat-proxy escuchando en http://%s:%d -> %s* (solo %s y GET /salud)' % (HOST, PUERTO, BASE_WEBHOOK, ', '.join(sorted(RUTAS))), flush=True)
    try:
        srv.serve_forever(poll_interval=0.5)
    except KeyboardInterrupt:
        pass
    finally:
        srv.server_close()
    return 0


if __name__ == '__main__':
    sys.exit(main())
