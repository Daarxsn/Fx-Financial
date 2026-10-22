"use client";

import { useCallback, useEffect, useState } from "react";
import { Breadcrumbs, Button, InlineAlert, LoadingState, PageHeader, StatusBadge } from "@/components/ui";

type Entity={id:string;legalName?:string;displayName?:string;name?:string;isActive?:boolean};
type Policy={
 id:string;legalEntityId:string;version:number;firstReminderAfterDays:number;maxReminders:number;intervalDays:number;status:string;
 requestedBy:string;approvedBy:string|null;approvalReference:string|null;approvalEvidenceNotes:string|null;requestedAt:string;
 approvedAt:string|null;disabledAt:string|null;disableReason:string|null;
};
type Api<T>={data?:T;error?:{message?:string;code?:string}};
const uuid=()=>crypto.randomUUID();

export function ReminderPolicyWorkspace(){
 const [entities,setEntities]=useState<Entity[]>([]);
 const [policies,setPolicies]=useState<Policy[]>([]);
 const [actorId,setActorId]=useState("");
 const [entityId,setEntityId]=useState("");
 const [firstDays,setFirstDays]=useState("7");
 const [maxReminders,setMaxReminders]=useState("3");
 const [intervalDays,setIntervalDays]=useState("7");
 const [approvalRefs,setApprovalRefs]=useState<Record<string,string>>({});
 const [approvalNotes,setApprovalNotes]=useState<Record<string,string>>({});
 const [disableReasons,setDisableReasons]=useState<Record<string,string>>({});
 const [loading,setLoading]=useState(true);
 const [busy,setBusy]=useState("");
 const [error,setError]=useState("");
 const [message,setMessage]=useState("");

 const request=useCallback(async(url:string,init:RequestInit={})=>{
  const response=await fetch(url,{...init,cache:"no-store",headers:{"Accept":"application/json",...(init.body?{"Content-Type":"application/json"}:{}),...(init.headers??{})}});
  let body:Api<unknown>={};try{body=await response.json() as Api<unknown>;}catch{/* safe message below */}
  return {response,body};
 },[]);

 const refresh=useCallback(async()=>{
  setLoading(true);setError("");
  try{
   const [p,e,u]=await Promise.all([
    request("/api/v1/reminders/policies"),
    request("/api/v1/legal-entities"),
    request("/api/v1/auth/me"),
   ]);
   if(!p.response.ok)throw new Error((p.body as Api<unknown>).error?.message??"Reminder policies could not be loaded.");
   if(!e.response.ok)throw new Error((e.body as Api<unknown>).error?.message??"Legal entities could not be loaded.");
   const rows=Array.isArray(p.body.data)?p.body.data as Policy[]:[];
   const ents=Array.isArray(e.body.data)?e.body.data as Entity[]:[];
   const user=(u.body as Api<{user?:{id?:string};data?:{user?:{id?:string}}}>).data;
   setPolicies(rows);setEntities(ents.filter(x=>x.isActive!==false));
   setActorId(user?.user?.id??"");
   setEntityId(current=>current||ents.find(x=>x.isActive!==false)?.id||"");
  }catch(cause){setError(cause instanceof Error?cause.message:"Reminder policies could not be loaded.");}
  finally{setLoading(false);}
 },[request]);

 useEffect(()=>{void refresh();},[refresh]);

 async function csrf(){
  const {response,body}=await request("/api/v1/auth/csrf");
  const value=(body as Api<{csrfToken?:string}>).data?.csrfToken;
  if(!response.ok||!value)throw new Error("Security verification expired. Refresh and try again.");
  return value;
 }

 async function createPolicy(){
  setBusy("create");setError("");setMessage("");
  try{
   const token=await csrf();
   const {response,body}=await request("/api/v1/reminders/policies",{
    method:"POST",headers:{"X-CSRF-Token":token},
    body:JSON.stringify({legalEntityId:entityId,firstReminderAfterDays:Number(firstDays),maxReminders:Number(maxReminders),intervalDays:Number(intervalDays)}),
   });
   if(!response.ok)throw new Error(body.error?.message??"The policy request could not be saved.");
   setMessage("Policy saved as pending approval. No reminders will be scheduled until a different authorized approver activates it.");
   await refresh();
  }catch(cause){setError(cause instanceof Error?cause.message:"The policy request could not be saved.");}
  finally{setBusy("");}
 }

 async function approve(policy:Policy){
  setBusy(policy.id);setError("");setMessage("");
  try{
   const token=await csrf();
   const {response,body}=await request("/api/v1/reminders/policies/"+policy.id+"/approve",{
    method:"POST",headers:{"X-CSRF-Token":token},
    body:JSON.stringify({approvalReference:approvalRefs[policy.id]??"",evidenceNotes:approvalNotes[policy.id]??""}),
   });
   if(!response.ok)throw new Error(body.error?.message??"The reminder policy could not be approved.");
   setMessage("Reminder policy activated with recorded approval evidence.");
   await refresh();
  }catch(cause){setError(cause instanceof Error?cause.message:"The reminder policy could not be approved.");}
  finally{setBusy("");}
 }

 async function disable(policy:Policy){
  setBusy(policy.id);setError("");setMessage("");
  try{
   const token=await csrf();
   const {response,body}=await request("/api/v1/reminders/policies/"+policy.id+"/disable",{
    method:"POST",headers:{"X-CSRF-Token":token},
    body:JSON.stringify({reason:disableReasons[policy.id]??""}),
   });
   if(!response.ok)throw new Error(body.error?.message??"The reminder policy could not be disabled.");
   setMessage("Reminder policy disabled. Already-queued email records remain visible for audit, and the worker re-checks policy state before send.");
   await refresh();
  }catch(cause){setError(cause instanceof Error?cause.message:"The reminder policy could not be disabled.");}
  finally{setBusy("");}
 }

 const entityName=(id:string)=>{const entity=entities.find(x=>x.id===id);return entity?.displayName??entity?.legalName??entity?.name??id;};

 return <div className="page">
  <Breadcrumbs items={[{label:"Workspace",href:"/"},{label:"Communications"},{label:"Overdue reminders"}]}/>
  <PageHeader eyebrow="COMMUNICATIONS" title="Overdue reminder policies" description="Reminder rules are off until submitted, independently approved with evidence, and activated for a specific legal entity."/>
  {error?<InlineAlert tone="danger" title="Action needs attention">{error}</InlineAlert>:null}
  {message?<InlineAlert tone="success" title="Policy status">{message}</InlineAlert>:null}
  <section className="master-data-panel">
   <div className="master-data-panel__heading"><div><h2>Request a reminder policy</h2><p>Policies require approval by a different user with reminder-management and approval permissions. This setting never sends email directly.</p></div></div>
   {loading?<LoadingState label="Loading reminder policies…"/>:<div className="invoice-form-grid">
    <div className="invoice-form-field invoice-form-field--wide"><label className="form-label" htmlFor="reminder-entity">Legal entity</label><select id="reminder-entity" className="form-input" value={entityId} onChange={e=>setEntityId(e.target.value)}><option value="">Choose a legal entity</option>{entities.map(entity=><option key={entity.id} value={entity.id}>{entity.displayName??entity.legalName??entity.name??entity.id}</option>)}</select></div>
    <div className="invoice-form-field"><label className="form-label" htmlFor="reminder-first">First reminder after (days overdue)</label><input id="reminder-first" className="form-input" type="number" min={1} max={365} value={firstDays} onChange={e=>setFirstDays(e.target.value)}/></div>
    <div className="invoice-form-field"><label className="form-label" htmlFor="reminder-max">Maximum reminders</label><input id="reminder-max" className="form-input" type="number" min={1} max={6} value={maxReminders} onChange={e=>setMaxReminders(e.target.value)}/></div>
    <div className="invoice-form-field"><label className="form-label" htmlFor="reminder-interval">Days between reminders</label><input id="reminder-interval" className="form-input" type="number" min={1} max={90} value={intervalDays} onChange={e=>setIntervalDays(e.target.value)}/></div>
    <div className="invoice-form-field invoice-form-field--wide"><Button disabled={busy!==""||loading||!entityId} onClick={()=>void createPolicy()}>{busy==="create"?"Saving…":"Submit for independent approval"}</Button></div>
   </div>}
  </section>
  <section className="master-data-panel">
   <div className="master-data-panel__heading"><div><h2>Policy versions and approvals</h2><p>Approval reference and evidence notes are retained in policy history. Existing versions are not overwritten.</p></div><Button size="sm" variant="secondary" disabled={loading||busy!==""} onClick={()=>void refresh()}>Refresh</Button></div>
   {loading?<LoadingState label="Loading reminder policy versions…"/>:policies.length===0?<p className="form-hint">No reminder policy versions have been requested.</p>:<div className="data-table-scroll"><table className="data-table"><thead><tr><th>Entity / version</th><th>Rule</th><th>Status</th><th>Approval evidence</th><th>Action</th></tr></thead><tbody>
    {policies.map(policy=><tr key={policy.id}>
     <td><strong>{entityName(policy.legalEntityId)}</strong><div className="invoice-workspace-muted">Version {policy.version} · requested {new Date(policy.requestedAt).toLocaleString()}</div></td>
     <td>First after {policy.firstReminderAfterDays} days · max {policy.maxReminders} · interval {policy.intervalDays} days</td>
     <td><StatusBadge tone={policy.status==="ACTIVE"?"success":policy.status==="DISABLED"?"danger":"warning"}>{policy.status}</StatusBadge>{policy.approvedBy?<div className="invoice-workspace-muted">Approved by {policy.approvedBy}</div>:null}</td>
     <td>{policy.approvalReference?<><strong>{policy.approvalReference}</strong><div className="invoice-workspace-muted">{policy.approvalEvidenceNotes}</div></>:"No approval evidence recorded"}</td>
     <td>{policy.status==="PENDING_APPROVAL"?(policy.requestedBy===actorId?<span className="form-hint">Awaiting a different approver</span>:<div className="invoice-form-field">
       <label className="form-label" htmlFor={"approval-ref-"+policy.id}>Approval reference</label><input className="form-input" id={"approval-ref-"+policy.id} value={approvalRefs[policy.id]??""} onChange={e=>setApprovalRefs(current=>({...current,[policy.id]:e.target.value}))} maxLength={255}/>
       <label className="form-label" htmlFor={"approval-evidence-"+policy.id}>Evidence / rationale (20+ characters)</label><textarea className="form-input" id={"approval-evidence-"+policy.id} rows={3} value={approvalNotes[policy.id]??""} onChange={e=>setApprovalNotes(current=>({...current,[policy.id]:e.target.value}))} maxLength={2000}/>
       <Button size="sm" disabled={busy!==""||!approvalRefs[policy.id]?.trim()||(approvalNotes[policy.id]??"").trim().length<20} onClick={()=>void approve(policy)}>Approve and activate</Button>
      </div>):policy.status==="ACTIVE"?<div className="invoice-form-field">
       <label className="form-label" htmlFor={"disable-reason-"+policy.id}>Reason to disable</label><input className="form-input" id={"disable-reason-"+policy.id} value={disableReasons[policy.id]??""} onChange={e=>setDisableReasons(current=>({...current,[policy.id]:e.target.value}))} maxLength={1000}/>
       <Button size="sm" variant="secondary" disabled={busy!==""||(disableReasons[policy.id]??"").trim().length<10} onClick={()=>void disable(policy)}>Disable policy</Button>
      </div>:"—"}</td>
    </tr>)}
   </tbody></table></div>}
  </section>
  <p className="form-hint">Scheduler behavior: it only considers issued invoices with a positive current outstanding balance and a previously provider-accepted original invoice email. It skips drafts, cancelled invoices, fully settled balances and unresolved/uncertain previous reminders. Every queued reminder is re-checked immediately before sending.</p>
 </div>;
}
