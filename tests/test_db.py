import sqlite3, unittest
from pathlib import Path
ROOT=Path(__file__).resolve().parent.parent
T='2026-11-24T01:00:00.000Z'; A='2026-11-24T02:00:00.000Z'; B='2026-11-24T03:00:00.000Z'; C='2026-11-24T04:00:00.000Z'
class DatabaseTests(unittest.TestCase):
    def setUp(self):
        self.db=sqlite3.connect(':memory:')
        for path in sorted((ROOT/'migrations').glob('*.sql')): self.db.executescript(path.read_text())
    def tearDown(self): self.db.close()
    def loan(self,key,user='student-a',item='B01',start=T,end=A,res=None):
        self.db.execute('INSERT INTO loans(id,user_id,item_id,borrowed_at,due_at,reservation_id) VALUES(?,?,?,?,?,?)',(key,user,item,start,end,res))
    def reserve(self,key,user='student-a',item='B01',start=A,end=B):
        self.db.execute('INSERT INTO reservations(id,user_id,item_id,start_at,end_at,created_at) VALUES(?,?,?,?,?,?)',(key,user,item,start,end,T))
    def test_seed(self): self.assertEqual(self.db.execute('SELECT count(*) FROM equipment_items').fetchone()[0],13)
    def test_double_loan(self):
        self.loan('l1')
        with self.assertRaises(sqlite3.IntegrityError): self.loan('l2','student-b')
    def test_return_and_reloan(self):
        self.loan('l1');self.db.execute('UPDATE loans SET returned_at=? WHERE id=?',(A,'l1'));self.loan('l2','student-b',start=A,end=B)
    def test_overlapping_reservation(self):
        self.reserve('r1')
        with self.assertRaisesRegex(sqlite3.IntegrityError,'reservation_conflict'): self.reserve('r2','student-b')
    def test_adjacent_reservations(self): self.reserve('r1');self.reserve('r2','student-b',start=B,end=C)
    def test_loan_overlaps_reservation(self):
        self.reserve('r1')
        with self.assertRaisesRegex(sqlite3.IntegrityError,'reservation_conflict'): self.loan('l1','student-b',end=B)
    def test_reservation_overlaps_loan(self):
        self.loan('l1',end=B)
        with self.assertRaisesRegex(sqlite3.IntegrityError,'loan_conflict'): self.reserve('r1')
    def test_valid_reserved_pickup(self):
        self.reserve('r1');self.loan('l1',start=A,end=B,res='r1');self.assertEqual(self.db.execute('SELECT status FROM reservations WHERE id=\'r1\'').fetchone()[0],'fulfilled')
    def test_wrong_student_pickup(self):
        self.reserve('r1')
        with self.assertRaisesRegex(sqlite3.IntegrityError,'invalid_reservation'): self.loan('l1','student-b',start=A,end=B,res='r1')
    def test_maintenance(self):
        with self.assertRaisesRegex(sqlite3.IntegrityError,'item_unavailable'): self.loan('l1',item='T02')
    def test_maintenance_during_loan(self):
        self.loan('l1')
        with self.assertRaisesRegex(sqlite3.IntegrityError,'loan_conflict'): self.db.execute("UPDATE equipment_items SET condition='maintenance' WHERE id='B01'")
    def test_cancel_frees_reservation(self):
        self.reserve('r1');self.db.execute("UPDATE reservations SET status='cancelled' WHERE id='r1'");self.reserve('r2','student-b')
    def test_nfc_register_and_resolve(self):
        self.db.execute('INSERT INTO nfc_tags(uid,user_id,created_at) VALUES(?,?,?)',('04A1B2C3','student-a',T))
        self.db.execute('INSERT INTO nfc_tags(uid,item_id,created_at) VALUES(?,?,?)',('04A1B2C4','B01',T))
        self.assertEqual(self.db.execute("SELECT user_id FROM nfc_tags WHERE uid='04A1B2C3'").fetchone()[0],'student-a')
        self.assertEqual(self.db.execute("SELECT item_id FROM nfc_tags WHERE uid='04A1B2C4'").fetchone()[0],'B01')
    def test_nfc_duplicate_uid(self):
        self.db.execute('INSERT INTO nfc_tags(uid,user_id,created_at) VALUES(?,?,?)',('AABB','student-a',T))
        with self.assertRaises(sqlite3.IntegrityError): self.db.execute('INSERT INTO nfc_tags(uid,item_id,created_at) VALUES(?,?,?)',('AABB','B01',T))
    def test_nfc_duplicate_target(self):
        self.db.execute('INSERT INTO nfc_tags(uid,item_id,created_at) VALUES(?,?,?)',('AABB','B01',T))
        with self.assertRaises(sqlite3.IntegrityError): self.db.execute('INSERT INTO nfc_tags(uid,item_id,created_at) VALUES(?,?,?)',('AABC','B01',T))
    def test_nfc_invalid_uid(self):
        for value in ('XY','aabb','A',''):
            with self.assertRaises(sqlite3.IntegrityError): self.db.execute('INSERT INTO nfc_tags(uid,user_id,created_at) VALUES(?,?,?)',(value,'student-a',T))
    def test_nfc_exactly_one_target(self):
        with self.assertRaises(sqlite3.IntegrityError): self.db.execute('INSERT INTO nfc_tags(uid,user_id,item_id,created_at) VALUES(?,?,?,?)',('AABB','student-a','B01',T))
        with self.assertRaises(sqlite3.IntegrityError): self.db.execute('INSERT INTO nfc_tags(uid,created_at) VALUES(?,?)',('AABB',T))
    def test_nfc_unlink_and_register_again(self):
        self.db.execute('INSERT INTO nfc_tags(uid,user_id,created_at) VALUES(?,?,?)',('AABB','student-a',T))
        self.db.execute("DELETE FROM nfc_tags WHERE user_id='student-a'")
        self.db.execute('INSERT INTO nfc_tags(uid,user_id,created_at) VALUES(?,?,?)',('AABC','student-a',T))
if __name__=='__main__': unittest.main(verbosity=2)
