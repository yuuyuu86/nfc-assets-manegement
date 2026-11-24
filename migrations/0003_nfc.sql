-- One UID belongs to exactly one student or one physical item.
CREATE TABLE nfc_tags (
 uid TEXT PRIMARY KEY CHECK(length(uid) BETWEEN 2 AND 64 AND length(uid)%2=0 AND uid NOT GLOB '*[^0-9A-F]*'),
 user_id TEXT REFERENCES users(id),
 item_id TEXT REFERENCES equipment_items(id),
 created_at TEXT NOT NULL,
 CHECK((user_id IS NOT NULL AND item_id IS NULL) OR (user_id IS NULL AND item_id IS NOT NULL))
);
CREATE UNIQUE INDEX nfc_student_unique ON nfc_tags(user_id) WHERE user_id IS NOT NULL;
CREATE UNIQUE INDEX nfc_item_unique ON nfc_tags(item_id) WHERE item_id IS NOT NULL;
-- No real card IDs are seeded. Register approved demo cards in the admin UI.
