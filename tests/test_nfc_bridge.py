import unittest
from pathlib import Path
import sys
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'nfc'))
from bridge import State, handler_for
from unittest.mock import Mock
class BridgeTests(unittest.TestCase):
    def test_scan_event(self):
        s=State();self.assertIsNone(s.snapshot()['event']);s.update('reader','detected','AABB');a=s.snapshot();self.assertEqual(a['uid'],'AABB');s.update('reader','waiting');self.assertEqual(a['event'],s.snapshot()['event']);s.update('reader','detected','AABB');self.assertNotEqual(a['event'],s.snapshot()['event'])
    def handler(self, headers, path='/scan'):
        cls=handler_for(State(),{'http://localhost:5173'},'test-token',8765)
        h=object.__new__(cls);h.headers=headers;h.path=path;h.respond=Mock();return h
    def test_reject_origin(self):
        h=self.handler({'Host':'127.0.0.1:8765','Origin':'https://evil.invalid','Authorization':'Bearer test-token'});h.do_GET();h.respond.assert_called_once_with(403)
    def test_reject_host(self):
        h=self.handler({'Host':'evil.invalid','Origin':'http://localhost:5173','Authorization':'Bearer test-token'});h.do_GET();h.respond.assert_called_once_with(403)
    def test_reject_token(self):
        h=self.handler({'Host':'127.0.0.1:8765','Origin':'http://localhost:5173','Authorization':'Bearer wrong'});h.do_GET();h.respond.assert_called_once_with(401,cors=True)
    def test_accept_token(self):
        h=self.handler({'Host':'127.0.0.1:8765','Origin':'http://localhost:5173','Authorization':'Bearer test-token'});h.do_GET();self.assertEqual(h.respond.call_args.args[0],200)
    def test_preflight(self):
        h=self.handler({'Host':'127.0.0.1:8765','Origin':'http://localhost:5173'});h.do_OPTIONS();h.respond.assert_called_once_with(204,cors=True)
if __name__=='__main__':unittest.main(verbosity=2)
