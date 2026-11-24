#!/usr/bin/env python3
"""Local-only read-only PC/SC and PaSoRi RC-S330 identifier bridge."""
import argparse
import hmac
import json
import secrets
import threading
import time
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit

class State:
    def __init__(self):
        self.lock = threading.Lock()
        self.reader = ''
        self.status = 'リーダーを探しています'
        self.event = None
        self.uid = None
    def update(self, reader, status, uid=None):
        with self.lock:
            self.reader, self.status = reader, status
            if uid is not None:
                self.event, self.uid = uuid.uuid4().hex, uid
    def snapshot(self):
        with self.lock:
            return dict(reader=self.reader, status=self.status, event=self.event, uid=self.uid)

def monitor(state, reader_filter, stop):
    from smartcard.System import readers
    from smartcard.Exceptions import NoCardException, CardConnectionException
    last = None
    while not stop.is_set():
        try:
            devices = [r for r in readers() if not reader_filter or reader_filter.lower() in str(r).lower()]
            if not devices:
                last = None
                state.update('', 'PC/SCリーダーが見つかりません')
            elif len(devices) != 1:
                last = None
                state.update('', '複数のリーダーがあります。--reader で指定してください')
            else:
                reader = devices[0]
                connection = reader.createConnection()
                try:
                    connection.connect()
                    data, sw1, sw2 = connection.transmit([0xFF, 0xCA, 0, 0, 0])
                    if (sw1, sw2) == (0x90, 0) and 1 <= len(data) <= 32:
                        uid = bytes(data).hex().upper()
                        key = (str(reader), uid)
                        state.update(str(reader), 'カードを検出。次の読み取り前に離してください', uid if key != last else None)
                        last = key
                    else:
                        state.update(str(reader), 'このカードまたはリーダーはUID取得に非対応です')
                except NoCardException:
                    last = None
                    state.update(str(reader), 'カード待機中')
                except CardConnectionException:
                    last = None
                    state.update(str(reader), 'カード待機中 / 通信を確認してください')
                finally:
                    try: connection.disconnect()
                    except Exception: pass
        except Exception:
            last = None
            state.update('', 'PC/SC接続エラー。ドライバーとリーダーを確認してください')
        stop.wait(0.30)

RC_S330 = 'usb:054c:02e1'


def felica_idm(target):
    """NFC-F SENSF_RES: response code, eight IDm bytes, eight PMm bytes, optional system code."""
    if target is None:
        return None
    data = bytes(getattr(target, 'sensf_res', None) or b'')
    if len(data) not in (17, 19) or data[0] != 1:
        return None
    return data[1:9].hex().upper()


class Presence:
    """Emit one event per presentation, rearm after three absent polls."""
    def __init__(self):
        self.last = None
        self.misses = 0

    def observe(self, uid):
        if uid is None:
            self.misses += 1
            if self.misses >= 3:
                self.last = None
            return None
        self.misses = 0
        if uid == self.last:
            return None
        self.last = uid
        return uid


def monitor_pasori(state, device, stop):
    import nfc
    while not stop.is_set():
        try:
            with nfc.ContactlessFrontend(device) as clf:
                name = 'Sony PaSoRi RC-S330 (NFC-F)'
                state.update(name, 'FeliCaカード待機中')
                presence = Presence()
                while not stop.is_set():
                    target = clf.sense(nfc.clf.RemoteTarget('212F'), iterations=1)
                    uid = felica_idm(target)
                    event = presence.observe(uid)
                    status = ('カードを検出。次の読み取り前に離してください' if uid
                              else 'FeliCaカード待機中')
                    state.update(name, status, event)
                    stop.wait(0.20)
        except Exception as exc:
            # Never include raw exception content (may contain card data).
            state.update('', 'RC-S330接続エラー: ' + type(exc).__name__ + '。USB・libusb・他アプリの使用状況を確認してください')
            stop.wait(2)

def handler_for(state, origins, token, port):
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_): pass  # never log UIDs or tokens
        def origin_ok(self):
            return self.headers.get('Host') == f'127.0.0.1:{port}' and self.headers.get('Origin') in origins
        def respond(self, code, body=None, cors=False):
            self.send_response(code)
            self.send_header('Cache-Control', 'no-store')
            if cors:
                self.send_header('Access-Control-Allow-Origin', self.headers['Origin'])
                self.send_header('Vary', 'Origin')
                self.send_header('Access-Control-Allow-Methods', 'GET, OPTIONS')
                self.send_header('Access-Control-Allow-Headers', 'Authorization')
                if self.headers.get('Access-Control-Request-Private-Network') == 'true':
                    self.send_header('Access-Control-Allow-Private-Network', 'true')
            data = b'' if body is None else json.dumps(body, ensure_ascii=False).encode()
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.send_header('Content-Length', str(len(data)))
            self.end_headers()
            if data: self.wfile.write(data)
        def do_OPTIONS(self):
            if not self.origin_ok() or self.path != '/scan': return self.respond(403)
            self.respond(204, cors=True)
        def do_GET(self):
            if not self.origin_ok(): return self.respond(403)
            if self.path != '/scan': return self.respond(404, cors=True)
            supplied = self.headers.get('Authorization', '')
            if not hmac.compare_digest(supplied.encode(), ('Bearer '+token).encode()): return self.respond(401, cors=True)
            self.respond(200, state.snapshot(), cors=True)
    return Handler

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--origin', action='append', help='Allowed exact browser origin (repeatable)')
    parser.add_argument('--backend', choices=['pcsc','pasori'], default='pasori', help='pasori: RC-S330 / FeliCa (default); pcsc: generic readers')
    parser.add_argument('--device', default=RC_S330, help='nfcpy device path for PaSoRi')
    parser.add_argument('--reader', help='Substring of PC/SC reader name')
    parser.add_argument('--list', action='store_true', help='Check selected reader and exit')
    args = parser.parse_args()
    if args.backend == 'pasori':
        try: import nfc
        except ImportError: parser.exit(1, 'Install nfcpy: python -m pip install -r nfc/requirements-pasori.txt\n')
        if args.list:
            try:
                with nfc.ContactlessFrontend(args.device) as clf:
                    print('Reader connected:', clf.device)
            except Exception as exc:
                parser.exit(1, 'RC-S330 connection failed: ' + type(exc).__name__ + '\nCheck USB, libusb, and other reader apps.\n')
            return
        worker, selector = monitor_pasori, args.device
    else:
        try: from smartcard.System import readers
        except ImportError: parser.exit(1, 'Install pyscard: python -m pip install -r nfc/requirements.txt\n')
        if args.list:
            for reader in readers(): print(reader)
            return
        worker, selector = monitor, args.reader
    origins = set(args.origin or ['http://localhost:5173', 'http://127.0.0.1:5173'])
    for origin in origins:
        parsed = urlsplit(origin)
        if parsed.scheme not in ('http','https') or not parsed.netloc or parsed.username or parsed.password or parsed.path or parsed.query or parsed.fragment or '*' in origin: parser.error('Use exact origin without trailing slash')
        if parsed.scheme == 'http' and parsed.hostname not in ('localhost','127.0.0.1'): parser.error('Non-local origin must use HTTPS')
    token, state, stop = secrets.token_urlsafe(24), State(), threading.Event()
    server = ThreadingHTTPServer(('127.0.0.1',8765), handler_for(state,origins,token,8765))
    threading.Thread(target=worker,args=(state,selector,stop),daemon=True).start()
    print('ShareShelf NFC bridge: http://127.0.0.1:8765',flush=True)
    print('Backend:', args.backend, flush=True)
    print('Allowed origins:', ', '.join(sorted(origins)),flush=True)
    print('接続トークン（Webアプリに入力）:',token,flush=True)
    try: server.serve_forever()
    except KeyboardInterrupt: pass
    finally: stop.set(); server.server_close()
if __name__ == '__main__': main()
