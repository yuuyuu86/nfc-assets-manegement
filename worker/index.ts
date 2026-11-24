import { Hono } from 'hono'
type User = {id:string;name:string;role:'student'|'admin'}
type Env = { Bindings:{DB:D1Database;DEMO_MODE:string}; Variables:{user:User} }
const app = new Hono<Env>()
const now = () => new Date().toISOString()
const id = () => crypto.randomUUID()
const stmt = (db:D1Database,sql:string,...args:unknown[]) => db.prepare(sql).bind(...args)
const rows = async (db:D1Database,sql:string,...args:unknown[]) => (await stmt(db,sql,...args).all()).results
const date = (v:unknown) => typeof v==='string' && Number.isFinite(Date.parse(v)) ? new Date(v).toISOString() : null
const valid = (v:unknown,max=120): v is string => typeof v==='string' && v.trim().length>0 && v.length<=max
const notify = (db:D1Database,key:string,user:string,title:string,message:string,t:string) => stmt(db,'INSERT OR IGNORE INTO notifications(id,user_id,title,message,created_at) VALUES(?,?,?,?,?)',key,user,title,message,t)
async function tick(db:D1Database) {
 const t=now(), soon=new Date(Date.now()+15*60000).toISOString(), late=new Date(Date.now()-15*60000).toISOString()
 await db.batch([
 stmt(db,"UPDATE reservations SET status='expired' WHERE status='active' AND (start_at<=? OR end_at<=?)",late,t),
 stmt(db,`INSERT OR IGNORE INTO notifications(id,user_id,title,message,created_at) SELECT 'due:'||l.id,l.user_id,'返却時間が近づいています',e.name||' の返却予定を確認してください。',? FROM loans l JOIN equipment_items i ON i.id=l.item_id JOIN equipment_types e ON e.id=i.type_id WHERE l.returned_at IS NULL AND l.due_at>? AND l.due_at<=?`,t,t,soon),
 stmt(db,`INSERT OR IGNORE INTO notifications(id,user_id,title,message,created_at) SELECT 'late:'||l.id,l.user_id,'返却期限を過ぎました',e.name||' を返却してください。',? FROM loans l JOIN equipment_items i ON i.id=l.item_id JOIN equipment_types e ON e.id=i.type_id WHERE l.returned_at IS NULL AND l.due_at<=?`,t,t),
 stmt(db,`INSERT OR IGNORE INTO notifications(id,user_id,title,message,created_at) SELECT 'reserve:'||r.id,r.user_id,'予約時間が近づいています',e.name||' の貸出手続きを行ってください。',? FROM reservations r JOIN equipment_items i ON i.id=r.item_id JOIN equipment_types e ON e.id=i.type_id WHERE r.status='active' AND r.start_at<=?`,t,soon),
 stmt(db,`INSERT OR IGNORE INTO notifications(id,user_id,title,message,created_at) SELECT 'expired:'||r.id,r.user_id,'予約が失効しました','開始時刻から15分以内に貸出されませんでした。',? FROM reservations r WHERE r.status='expired'`,t),
 ])
}
app.use('/api/*',async(c,next)=>{
 c.header('Cache-Control','no-store')
 if(c.env.DEMO_MODE!=='true') return c.json({error:'デモ認証が無効です。本番認証を実装してください。'},503)
 const user=await stmt(c.env.DB,'SELECT * FROM users WHERE id=?',c.req.header('X-Demo-User')||'').first<User>()
 if(!user) return c.json({error:'デモアカウントを選択してください。'},401)
 c.set('user',user); await next()
})
app.use('/api/admin/*',async(c,next)=>{if(c.get('user').role!=='admin')return c.json({error:'管理者専用です。'},403); await next()})
app.onError((err,c)=>{if(/reservation_conflict|loan_conflict|one_open_loan|UNIQUE constraint failed: loans.item_id|item_unavailable|invalid_reservation/.test(err.message))return c.json({error:'貸出・予約が重複しているか、現在利用できません。'},409);console.error(err);return c.json({error:'処理に失敗しました。入力や接続を確認してください。'},500)})
const nfcUid=(v:unknown)=>{if(typeof v!=='string'||v.length>128)return null;const uid=v.trim().replace(/[:\s-]/g,'').toUpperCase();return /^(?:[0-9A-F]{2}){1,32}$/.test(uid)?uid:null}
app.post('/api/nfc/resolve',async c=>{
 const b=await c.req.json(),uid=nfcUid(b.uid),db=c.env.DB
 if(!uid||!['student','item'].includes(b.kind))return c.json({error:'UIDまたは読み取り種別が不正です。'},400)
 if(b.kind==='student'){
  const u=await stmt(db,"SELECT u.id,u.name FROM nfc_tags t JOIN users u ON u.id=t.user_id WHERE t.uid=? AND u.role='student'",uid).first()
  return u?c.json(u):c.json({error:'登録されていない学生証です。管理者に確認してください。'},404)
 }
 const item=await stmt(db,"SELECT i.id,i.type_id,i.label,i.condition,e.name FROM nfc_tags t JOIN equipment_items i ON i.id=t.item_id JOIN equipment_types e ON e.id=i.type_id WHERE t.uid=? AND i.condition<>'retired'",uid).first()
 return item?c.json(item):c.json({error:'登録されていない、または廃止された備品タグです。'},404)
})
app.get('/api/admin/nfc',async c=>c.json({students:await rows(c.env.DB,"SELECT u.id,u.name,CASE WHEN t.uid IS NULL THEN 0 ELSE 1 END registered FROM users u LEFT JOIN nfc_tags t ON t.user_id=u.id WHERE u.role='student' ORDER BY u.name"),items:await rows(c.env.DB,"SELECT i.id,i.label,e.name,CASE WHEN t.uid IS NULL THEN 0 ELSE 1 END registered FROM equipment_items i JOIN equipment_types e ON e.id=i.type_id LEFT JOIN nfc_tags t ON t.item_id=i.id WHERE i.condition<>'retired' ORDER BY e.name,i.label")}))
app.post('/api/admin/nfc',async c=>{
 const b=await c.req.json(),uid=nfcUid(b.uid),db=c.env.DB
 if(!uid||!valid(b.target_id)||!['student','item'].includes(b.kind))return c.json({error:'登録内容が不正です。'},400)
 const student=b.kind==='student',column=student?'user_id':'item_id';const target=await stmt(db,student?"SELECT id FROM users WHERE id=? AND role='student'":"SELECT id FROM equipment_items WHERE id=? AND condition<>'retired'",b.target_id).first()
 if(!target)return c.json({error:'登録先が見つかりません。'},404)
 try{await stmt(db,`INSERT INTO nfc_tags(uid,${column},created_at) VALUES(?,?,?)`,uid,b.target_id,now()).run()}catch(e){if(/UNIQUE constraint failed/i.test(String(e)))return c.json({error:'UIDまたは登録先が既に登録されています。解除してから再登録してください。'},409);throw e}
 return c.json({ok:true},201)
})
app.delete('/api/admin/nfc/:kind/:id',async c=>{
 const kind=c.req.param('kind');if(!['student','item'].includes(kind))return c.json({error:'種別が不正です。'},400)
 await stmt(c.env.DB,`DELETE FROM nfc_tags WHERE ${kind==='student'?'user_id':'item_id'}=?`,c.req.param('id')).run();return c.json({ok:true})
})
app.get('/api/me',c=>c.json(c.get('user')))
app.get('/api/equipment',async c=>{
 const db=c.env.DB; const t=now(); await tick(db)
 return c.json(await rows(db,`SELECT e.*, (SELECT COUNT(*) FROM equipment_items i WHERE i.type_id=e.id AND i.condition<>'retired') total,
 (SELECT COUNT(*) FROM equipment_items i WHERE i.type_id=e.id AND i.condition='ready' AND NOT EXISTS(SELECT 1 FROM loans l WHERE l.item_id=i.id AND l.returned_at IS NULL) AND NOT EXISTS(SELECT 1 FROM reservations r WHERE r.item_id=i.id AND r.status='active' AND r.start_at<=? AND r.end_at>?)) available,
 (SELECT MIN(l.due_at) FROM loans l JOIN equipment_items i ON i.id=l.item_id WHERE i.type_id=e.id AND l.returned_at IS NULL) next_due FROM equipment_types e ORDER BY e.name`,t,t))
})
app.get('/api/equipment/:id',async c=>{
 const db=c.env.DB,t=now(),typeId=c.req.param('id'); await tick(db)
 const equipment=await stmt(db,'SELECT * FROM equipment_types WHERE id=?',typeId).first(); if(!equipment)return c.json({error:'備品がありません。'},404)
 const items=await rows(db,`SELECT i.*,l.due_at,CASE WHEN l.user_id=? THEN 1 ELSE 0 END mine, CASE WHEN EXISTS(SELECT 1 FROM reservations r WHERE r.item_id=i.id AND r.status='active' AND r.start_at<=? AND r.end_at>?) THEN 1 ELSE 0 END held FROM equipment_items i LEFT JOIN loans l ON l.item_id=i.id AND l.returned_at IS NULL WHERE i.type_id=? AND i.condition<>'retired' ORDER BY i.label`,c.get('user').id,t,t,typeId)
 const reservations=await rows(db,`SELECT r.id,r.item_id,r.start_at,r.end_at,CASE WHEN r.user_id=? THEN 1 ELSE 0 END mine FROM reservations r JOIN equipment_items i ON i.id=r.item_id WHERE i.type_id=? AND r.status='active' AND r.end_at>? ORDER BY r.start_at`,c.get('user').id,typeId,t)
 const watch=await stmt(db,'SELECT 1 FROM availability_watches WHERE user_id=? AND type_id=?',c.get('user').id,typeId).first()
 return c.json({equipment,items,reservations,watch:!!watch})
})
app.get('/api/me/loans',async c=>c.json(await rows(c.env.DB,`SELECT l.*,i.label,e.name,e.location FROM loans l JOIN equipment_items i ON i.id=l.item_id JOIN equipment_types e ON e.id=i.type_id WHERE l.user_id=? ORDER BY l.returned_at IS NOT NULL,l.borrowed_at DESC`,c.get('user').id)))
app.get('/api/me/reservations',async c=>{await tick(c.env.DB);return c.json(await rows(c.env.DB,`SELECT r.*,i.label,e.name FROM reservations r JOIN equipment_items i ON i.id=r.item_id JOIN equipment_types e ON e.id=i.type_id WHERE r.user_id=? ORDER BY r.start_at DESC`,c.get('user').id))})
app.post('/api/reservations',async c=>{
 const db=c.env.DB,u=c.get('user'),b=await c.req.json(),start=date(b.start_at),end=date(b.end_at),t=now()
 if(!valid(b.item_id)||!start||!end||start<t||end<=start||Date.parse(end)-Date.parse(start)>8*3600000||Date.parse(start)>Date.now()+30*86400000)return c.json({error:'30日以内の未来の日時、最大8時間を指定してください。'},400)
 await tick(db); const key=id(); await db.batch([stmt(db,'INSERT INTO reservations(id,user_id,item_id,start_at,end_at,created_at) VALUES(?,?,?,?,?,?)',key,u.id,b.item_id,start,end,t),notify(db,'created:'+key,u.id,'予約が完了しました','予約一覧から日時を確認できます。',t)])
 return c.json({id:key},201)
})
app.delete('/api/reservations/:id',async c=>{const r=await stmt(c.env.DB,"UPDATE reservations SET status='cancelled' WHERE id=? AND user_id=? AND status='active'",c.req.param('id'),c.get('user').id).run();return r.meta.changes?c.json({ok:true}):c.json({error:'キャンセルできる予約がありません。'},404)})
app.post('/api/loans',async c=>{
 const db=c.env.DB,u=c.get('user'),b=await c.req.json(),due=date(b.due_at),t=now()
 if(!valid(b.item_id)||!due||due<=t||Date.parse(due)-Date.parse(t)>8*3600000)return c.json({error:'返却予定は現在から8時間以内にしてください。'},400)
 await tick(db)
 const reserved=await stmt(db,"SELECT id FROM reservations WHERE item_id=? AND user_id=? AND status='active' AND start_at<=? AND end_at>=? ORDER BY start_at LIMIT 1",b.item_id,u.id,t,due).first<{id:string}>()
 const key=id(); await db.batch([stmt(db,'INSERT INTO loans(id,user_id,item_id,borrowed_at,due_at,reservation_id) VALUES(?,?,?,?,?,?)',key,u.id,b.item_id,t,due,reserved?.id||null),notify(db,'borrow:'+key,u.id,'貸出が完了しました','マイページで返却予定を確認してください。',t)])
 return c.json({id:key},201)
})
app.post('/api/loans/:id/return',async c=>{
 const db=c.env.DB,u=c.get('user'),key=c.req.param('id'),t=now(),b=await c.req.json()
 const loan=await stmt(db,`SELECT l.*,i.type_id FROM loans l JOIN equipment_items i ON i.id=l.item_id WHERE l.id=? AND l.user_id=? AND l.returned_at IS NULL`,key,u.id).first<{item_id:string;type_id:string}>()
 if(!loan||b.item_id!==loan.item_id)return c.json({error:'貸出記録と備品が一致しません。'},404)
 const report=valid(b.report,500)?b.report.trim():null
 const token=id()
 const operations=[stmt(db,'UPDATE loans SET returned_at=?,return_token=? WHERE id=? AND user_id=? AND returned_at IS NULL',t,token,key,u.id),
 stmt(db,`INSERT OR IGNORE INTO notifications(id,user_id,title,message,created_at) SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM loans WHERE id=? AND return_token=?)`,'returned:'+key,u.id,'返却が完了しました','備品の返却を記録しました。',t,key,token)]
 if(report){operations.push(stmt(db,'INSERT INTO reports(id,user_id,item_id,message,created_at) SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM loans WHERE id=? AND return_token=?)','return:'+key,u.id,loan.item_id,report,t,key,token),stmt(db,"UPDATE equipment_items SET condition='maintenance' WHERE id=? AND EXISTS(SELECT 1 FROM loans WHERE id=? AND return_token=?)",loan.item_id,key,token),stmt(db,"UPDATE reservations SET status='cancelled' WHERE item_id=? AND status='active' AND EXISTS(SELECT 1 FROM loans WHERE id=? AND return_token=?)",loan.item_id,key,token))}
 else {operations.push(stmt(db,`INSERT OR IGNORE INTO notifications(id,user_id,title,message,created_at) SELECT 'available:'||?||':'||w.user_id,w.user_id,'備品が返却されました',e.name||' の空き状況をご確認ください。',? FROM availability_watches w JOIN equipment_types e ON e.id=w.type_id WHERE w.type_id=? AND EXISTS(SELECT 1 FROM loans WHERE id=? AND return_token=?) AND NOT EXISTS(SELECT 1 FROM reservations r WHERE r.item_id=? AND r.status='active' AND r.start_at<=? AND r.end_at>?)`,key,t,loan.type_id,key,token,loan.item_id,t,t))}
 const result=await db.batch(operations);if(!result[0].meta.changes)return c.json({error:'すでに返却されています。'},409);return c.json({ok:true})
})
app.get('/api/notifications',async c=>{await tick(c.env.DB);return c.json(await rows(c.env.DB,'SELECT * FROM notifications WHERE user_id=? ORDER BY created_at DESC LIMIT 100',c.get('user').id))})
app.post('/api/notifications/read',async c=>{await stmt(c.env.DB,'UPDATE notifications SET read_at=? WHERE user_id=? AND read_at IS NULL',now(),c.get('user').id).run();return c.json({ok:true})})
app.post('/api/watches',async c=>{const b=await c.req.json();if(!valid(b.type_id))return c.json({error:'備品を指定してください。'},400);if(b.enabled)await stmt(c.env.DB,'INSERT OR IGNORE INTO availability_watches VALUES(?,?)',c.get('user').id,b.type_id).run();else await stmt(c.env.DB,'DELETE FROM availability_watches WHERE user_id=? AND type_id=?',c.get('user').id,b.type_id).run();return c.json({ok:true})})
app.get('/api/admin/stats',async c=>{
 const db=c.env.DB,t=now(); await tick(db)
 return c.json({items:await rows(db,`SELECT i.*,e.name,e.location,l.due_at,u.name borrower FROM equipment_items i JOIN equipment_types e ON e.id=i.type_id LEFT JOIN loans l ON l.item_id=i.id AND l.returned_at IS NULL LEFT JOIN users u ON u.id=l.user_id ORDER BY e.name,i.label`),reports:await rows(db,`SELECT r.*,e.name,i.label FROM reports r JOIN equipment_items i ON i.id=r.item_id JOIN equipment_types e ON e.id=i.type_id ORDER BY r.created_at DESC`),ranking:await rows(db,`SELECT e.name,COUNT(l.id) count FROM equipment_types e LEFT JOIN equipment_items i ON i.type_id=e.id LEFT JOIN loans l ON l.item_id=i.id GROUP BY e.id ORDER BY count DESC`),history:await rows(db,`SELECT l.*,u.name borrower,e.name,i.label FROM loans l JOIN users u ON u.id=l.user_id JOIN equipment_items i ON i.id=l.item_id JOIN equipment_types e ON e.id=i.type_id ORDER BY l.borrowed_at DESC LIMIT 200`),as_of:t})
})
app.post('/api/admin/equipment',async c=>{const b=await c.req.json(),db=c.env.DB;if(!valid(b.name)||!valid(b.category)||!valid(b.location)||!Number.isInteger(b.count)||b.count<1||b.count>20)return c.json({error:'名前・カテゴリ・場所・個数（1〜20）を入力してください。'},400);const key=id();await db.batch([stmt(db,'INSERT INTO equipment_types(id,name,category,location,description) VALUES(?,?,?,?,?)',key,b.name.trim(),b.category.trim(),b.location.trim(),valid(b.description,500)?b.description.trim():''),...Array.from({length:b.count},(_,i)=>stmt(db,'INSERT INTO equipment_items(id,type_id,label) VALUES(?,?,?)',id(),key,'#'+String(i+1).padStart(2,'0')))]);return c.json({id:key},201)})
app.patch('/api/admin/items/:id',async c=>{const b=await c.req.json();if(!['ready','maintenance','retired'].includes(b.condition))return c.json({error:'状態が正しくありません。'},400);const db=c.env.DB,key=c.req.param('id'),t=now();await db.batch([stmt(db,'UPDATE equipment_items SET condition=? WHERE id=?',b.condition,key),stmt(db,"UPDATE reservations SET status='cancelled' WHERE item_id=? AND status='active' AND ?<>'ready'",key,b.condition),stmt(db,"UPDATE reports SET resolved_at=? WHERE item_id=? AND resolved_at IS NULL AND ?='ready'",t,key,b.condition)]);return c.json({ok:true})})
app.notFound(c=>c.json({error:'APIが見つかりません。'},404))
export default {fetch:app.fetch,scheduled(_controller:ScheduledController,env:Env['Bindings'],ctx:ExecutionContext){ctx.waitUntil(tick(env.DB))}} satisfies ExportedHandler<Env['Bindings']>
