INSERT INTO users VALUES ('student-a','デモ学生 A','student'),('student-b','デモ学生 B','student'),('admin','デモ管理者','admin');
INSERT INTO equipment_types VALUES
 ('basket','バスケットボール','スポーツ','体育館・備品庫','屋内用の共有ボール。使用後は備品庫へ戻してください。','basketball'),
 ('badminton','バドミントンラケット','スポーツ','体育館・備品庫','ラケット単体の貸出です。','racket'),
 ('tabletennis','卓球ラケット','スポーツ','体育館・備品庫','卓球台の近くに保管しています。','racket'),
 ('hdmi','HDMIケーブル','電子機器','教室・共有棚','モニター接続用。長さ2m。','cable'),
 ('charger','USB-C充電器','電子機器','寮・共有スペース','共有のUSB-C充電器。','charger'),
 ('tripod','三脚','撮影機材','教室・共有棚','スマートフォン用ホルダー付き。','camera');
INSERT INTO equipment_items(id,type_id,label) VALUES
 ('B01','basket','#01'),('B02','basket','#02'),('B03','basket','#03'),('R01','badminton','#01'),('R02','badminton','#02'),('R03','badminton','#03'),('T01','tabletennis','#01'),('T02','tabletennis','#02'),('H01','hdmi','#01'),('H02','hdmi','#02'),('C01','charger','#01'),('C02','charger','#02'),('P01','tripod','#01');
UPDATE equipment_items SET condition='maintenance' WHERE id='T02';
