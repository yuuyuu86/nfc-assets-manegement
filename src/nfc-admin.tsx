import {useEffect,useState} from 'react'
import {ReaderInput} from './nfc'
type Target={id:string;name:string;label?:string;registered:number}
type Registry={students:Target[];items:Target[]}
type Api=<T,>(path:string,method?:string,body?:unknown)=>Promise<T>
export function NfcAdmin({api}:{api:Api}){
 const [data,setData]=useState<Registry|null>(null),[kind,setKind]=useState<'student'|'item'>('student'),[target,setTarget]=useState(''),[notice,setNotice]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false)
 const load=async()=>setData(await api<Registry>('/admin/nfc'))
 useEffect(()=>{void load().catch(e=>setError(e.message))},[])
 const targets=(kind==='student'?data?.students:data?.items)||[],selected=targets.find(x=>x.id===target)
 return <section className="panel form"><h2>NFCタグ登録</h2><p>学校の許可を得た検証用カード・タグだけを登録してください。UIDは本人認証には使えません。</p><label>登録対象<select value={kind} disabled={busy} onChange={e=>{setKind(e.target.value as 'student'|'item');setTarget('');setNotice('')}}><option value="student">学生証</option><option value="item">備品タグ</option></select></label><label>登録先<select value={target} disabled={busy} onChange={e=>{setTarget(e.target.value);setNotice('')}}><option value="">選択してください</option>{targets.map(t=><option key={t.id} value={t.id}>{t.name} {t.label||''} ({t.id}) — {t.registered?'登録済み':'未登録'}</option>)}</select></label>{selected?.registered===1?<button type="button" className="secondary" disabled={busy} onClick={async()=>{if(!confirm('このタグの紐づけを解除しますか？'))return;setBusy(true);setError('');try{await api('/admin/nfc/'+kind+'/'+encodeURIComponent(target),'DELETE');await load();setNotice('登録を解除しました')}catch(e){setError(e instanceof Error?e.message:'解除失敗')}finally{setBusy(false)}}}>登録を解除する</button>:selected&&<ReaderInput key={kind+target} disabled={busy} onScan={async uid=>{setBusy(true);setError('');setNotice('');try{await api('/admin/nfc','POST',{kind,target_id:target,uid});await load();setNotice('タグを登録しました')}finally{setBusy(false)}}}/>} {notice&&<p role="status">{notice}</p>}{error&&<p role="alert" className="nfc-error">{error}</p>}</section>
}
