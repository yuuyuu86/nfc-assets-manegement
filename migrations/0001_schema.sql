PRAGMA foreign_keys = ON;
CREATE TABLE users (id TEXT PRIMARY KEY, name TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('student','admin')));
CREATE TABLE equipment_types (id TEXT PRIMARY KEY, name TEXT NOT NULL, category TEXT NOT NULL, location TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', icon TEXT NOT NULL DEFAULT 'package');
CREATE TABLE equipment_items (id TEXT PRIMARY KEY, type_id TEXT NOT NULL REFERENCES equipment_types(id), label TEXT NOT NULL, condition TEXT NOT NULL DEFAULT 'ready' CHECK(condition IN ('ready','maintenance','retired')), UNIQUE(type_id,label));
CREATE TABLE reservations (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), item_id TEXT NOT NULL REFERENCES equipment_items(id), start_at TEXT NOT NULL, end_at TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','cancelled','fulfilled','expired')), created_at TEXT NOT NULL, CHECK(start_at < end_at));
CREATE INDEX reservations_item_time ON reservations(item_id,status,start_at,end_at);
CREATE TABLE loans (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), item_id TEXT NOT NULL REFERENCES equipment_items(id), borrowed_at TEXT NOT NULL, due_at TEXT NOT NULL, returned_at TEXT, return_token TEXT UNIQUE, reservation_id TEXT UNIQUE REFERENCES reservations(id), CHECK(borrowed_at < due_at), CHECK(returned_at IS NULL OR returned_at >= borrowed_at));
CREATE UNIQUE INDEX one_open_loan ON loans(item_id) WHERE returned_at IS NULL;
CREATE INDEX loans_user ON loans(user_id,returned_at);
CREATE TABLE notifications (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), title TEXT NOT NULL, message TEXT NOT NULL, created_at TEXT NOT NULL, read_at TEXT);
CREATE TABLE availability_watches (user_id TEXT NOT NULL REFERENCES users(id), type_id TEXT NOT NULL REFERENCES equipment_types(id), PRIMARY KEY(user_id,type_id));
CREATE TABLE reports (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), item_id TEXT NOT NULL REFERENCES equipment_items(id), message TEXT NOT NULL, created_at TEXT NOT NULL, resolved_at TEXT);
-- Guards run inside the write transaction; overlap uses half-open intervals [start,end).
CREATE TRIGGER reservation_guard BEFORE INSERT ON reservations WHEN NEW.status='active' BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM equipment_items WHERE id=NEW.item_id AND condition='ready') THEN RAISE(ABORT,'item_unavailable') END;
 SELECT CASE WHEN EXISTS(SELECT 1 FROM reservations r WHERE r.item_id=NEW.item_id AND r.status='active' AND r.start_at<NEW.end_at AND r.end_at>NEW.start_at) THEN RAISE(ABORT,'reservation_conflict') END;
 SELECT CASE WHEN EXISTS(SELECT 1 FROM loans l WHERE l.item_id=NEW.item_id AND l.returned_at IS NULL AND (l.due_at<=NEW.created_at OR l.due_at>NEW.start_at)) THEN RAISE(ABORT,'loan_conflict') END;
END;
CREATE TRIGGER loan_guard BEFORE INSERT ON loans BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM equipment_items WHERE id=NEW.item_id AND condition='ready') THEN RAISE(ABORT,'item_unavailable') END;
 SELECT CASE WHEN EXISTS(SELECT 1 FROM reservations r WHERE r.item_id=NEW.item_id AND r.status='active' AND r.start_at<NEW.due_at AND r.end_at>NEW.borrowed_at AND (NEW.reservation_id IS NULL OR r.id<>NEW.reservation_id)) THEN RAISE(ABORT,'reservation_conflict') END;
 SELECT CASE WHEN NEW.reservation_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM reservations r WHERE r.id=NEW.reservation_id AND r.item_id=NEW.item_id AND r.user_id=NEW.user_id AND r.status='active' AND r.start_at<=NEW.borrowed_at AND r.end_at>=NEW.due_at AND NEW.borrowed_at<strftime('%Y-%m-%dT%H:%M:%fZ',r.start_at,'+15 minutes')) THEN RAISE(ABORT,'invalid_reservation') END;
END;
CREATE TRIGGER loan_fulfill AFTER INSERT ON loans WHEN NEW.reservation_id IS NOT NULL BEGIN
 UPDATE reservations SET status='fulfilled' WHERE id=NEW.reservation_id;
END;
CREATE TRIGGER item_maintenance_guard BEFORE UPDATE OF condition ON equipment_items WHEN NEW.condition<>'ready' BEGIN
 SELECT CASE WHEN EXISTS(SELECT 1 FROM loans WHERE item_id=NEW.id AND returned_at IS NULL) THEN RAISE(ABORT,'loan_conflict') END;
END;
