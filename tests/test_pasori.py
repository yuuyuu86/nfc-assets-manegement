import sys
import unittest
import threading
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock, patch
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'nfc'))
from bridge import felica_idm, Presence, State, monitor_pasori, RC_S330

class PasoriTests(unittest.TestCase):
    def target(self, suffix=''):
        return SimpleNamespace(sensf_res=bytes.fromhex('010102030405060708'+'FFFFFFFFFFFFFFFF'+suffix))
    def test_idm(self):
        self.assertEqual(felica_idm(self.target()), '0102030405060708')
    def test_system_code(self):
        self.assertEqual(felica_idm(self.target('12FC')), '0102030405060708')
    def test_bad_response(self):
        for t in [None, SimpleNamespace(), SimpleNamespace(sensf_res=b'\x01'), SimpleNamespace(sensf_res=b'\x02'+b'\x00'*16)]:
            self.assertIsNone(felica_idm(t))
    def test_held_and_rearm(self):
        p=Presence(); self.assertEqual(p.observe('AA'),'AA'); self.assertIsNone(p.observe('AA'))
        p.observe(None); p.observe(None); self.assertIsNone(p.observe('AA'))
        for _ in range(3): p.observe(None)
        self.assertEqual(p.observe('AA'),'AA')
    def test_different_card(self):
        p=Presence(); p.observe('AA'); self.assertEqual(p.observe('BB'),'BB')
    def test_monitor_mock(self):
        s=State(); stop=threading.Event(); mock=MagicMock(); clf=mock.ContactlessFrontend.return_value.__enter__.return_value
        def sense(*args,**kwargs):
            stop.set(); return self.target()
        clf.sense.side_effect=sense
        with patch.dict(sys.modules, {'nfc':mock}): monitor_pasori(s,RC_S330,stop)
        mock.ContactlessFrontend.assert_called_once_with(RC_S330)
        mock.clf.RemoteTarget.assert_called_once_with('212F')
        self.assertEqual(s.snapshot()['uid'],'0102030405060708')
        self.assertIsNotNone(s.snapshot()['event'])
    def test_connection_failure(self):
        s=State(); stop=MagicMock(); stop.is_set.side_effect=[False,True]; mock=MagicMock(); mock.ContactlessFrontend.side_effect=OSError('private details')
        with patch.dict(sys.modules,{'nfc':mock}): monitor_pasori(s,RC_S330,stop)
        self.assertIn('接続エラー',s.snapshot()['status']); self.assertNotIn('private details',s.snapshot()['status'])

if __name__=='__main__': unittest.main()
