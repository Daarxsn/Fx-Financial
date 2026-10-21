"use client";
import { useCallback,useEffect,useState } from "react";
import { Button,Card,InlineAlert,LoadingState,StatusBadge } from "@/components/ui";

type EventRow={id:string;eventType:string;previousStatus:string|null;status:string;reason:string;actorId:string;createdAt:string};
type Correction={id:string;invoiceId:string;legalEntityId:string;invoiceNumber:string|null;correctionType:"CANCEL"|"CREDIT_NOTE"|"DEBIT_NOTE";status:"PENDING_REVIEW"|"REJECTED"|"EXECUTED";reason:string;requestedBy:string;reviewedBy:string|null;reviewDecision:string|null;reviewReason:string|null;createdAt:string;history:EventRow[]};
type ListResponse={data?:Correction[];error?:{message?:string}};
async function csrfToken(){
 const cookie=document.cookie.split(";").map(x=>x.trim()).find(x=>x.startsWith("fx_csrf="))?.slice("fx_csrf=".length);
 if(cookie)return decodeURIComponent(cookie);
 const r=await fetch("/api/v1/auth/csrf",{cache:"no-store",credentials:"same-origin"});const b=await r.json();
 if(!r.ok||!b.data?.csrfToken)throw new Error("Request validation expired. Refresh and retry.");return b.data.csrfToken as string;
}
export function CorrectionReviewWorkspace(){
 const [rows,setRows]=useState<Correction[]>([]),[reasons,setReasons]=useState<Record<string,string>>({}),[busy,setBusy]=useState(""),[loading,setLoading]=useState(true),[error,setError]=useState(""),[success,setSuccess]=useState(""),[canReview,setCanReview]=useState(false);
 const refresh=useCallback(async()=>{
  setLoading(true);setError("");
  try{
   const profile=await fetch("/api/v1/auth/me",{cache:"no-store",credentials:"same-origin"});const p=await profile.json();
   const permissions=p.data?.user?.permissions??[];
   setCanReview(permissions.includes("invoices:cancel")&&permissions.includes("approvals:decide"));
   const r=await fetch("/api/v1/correction-requests?status=PENDING_REVIEW",{cache:"no-store",credentials:"same-origin"});
   const body=await r.json() as ListResponse;
   if(r.status===403){setRows([]);throw new Error("Approval queue access is not assigned to this role or legal-entity scope.");}
   if(!r.ok)throw new Error(body.error?.message??"Correction queue could not be loaded.");
   setRows(Array.isArray(body.data)?body.data:[]);
  }catch(e){setError(e instanceof Error?e.message:"Correction queue could not be loaded.");}
  finally{setLoading(false);}
 },[]);
 useEffect(()=>{Promise.resolve().then(()=>refresh());},[refresh]);
 const decide=async(row:Correction,decision:"APPROVE"|"REJECT")=>{
  const reason=reasons[row.id]?.trim()??"";
  if(reason.length<10){setError("Add a review rationale of at least 10 characters before deciding.");return;}
  setBusy(row.id);setError("");setSuccess("");
  try{
   const token=await csrfToken();
   const r=await fetch("/api/v1/correction-requests/"+row.id+"/decision",{method:"POST",cache:"no-store",credentials:"same-origin",
    headers:{"Content-Type":"application/json","X-CSRF-Token":token},body:JSON.stringify({decision,reason})});
   const body=await r.json() as {data?:{status?:string;invoiceNumber?:string};error?:{message?:string;code?:string}};
   if(!r.ok)throw new Error(body.error?.message??"Correction decision could not be recorded.");
   setSuccess(decision==="REJECT"?"Correction request rejected with its rationale.":"Correction approved and executed under the recorded cancellation policy. The original number and audit record are preserved.");
   await refresh();
  }catch(e){setError(e instanceof Error?e.message:"Correction decision could not be recorded.");}
  finally{setBusy("");}
 };
 return <div className="correction-review-workspace">
  <InlineAlert tone="warning" title="Independent review and payment guard">Requesters cannot review their own requests. Direct cancellation requires an explicit approved policy, finance review, and zero active recorded allocations. Credit/debit-note execution stays blocked until note treatment is approved and implemented.</InlineAlert>
  {error?<InlineAlert tone="danger" title="Review action">{error}</InlineAlert>:null}
  {success?<InlineAlert tone="success" title="Review outcome">{success}</InlineAlert>:null}
  {loading?<LoadingState label="Loading correction requests…"/>:null}
  {!loading&&!rows.length&&!error?<InlineAlert tone="info" title="No pending correction requests">New requests for issued invoices will appear here.</InlineAlert>:null}
  {rows.map(row=><Card className="correction-request-card" key={row.id}>
   <div className="correction-request-card__head"><div><p className="eyebrow">{row.invoiceNumber??("Invoice "+row.invoiceId.slice(0,8))} · {row.correctionType.replaceAll("_"," ")}</p><h3>Requested {new Date(row.createdAt).toLocaleString()}</h3></div><StatusBadge tone="warning">PENDING REVIEW</StatusBadge></div>
   <p className="correction-request-card__reason">{row.reason}</p><p className="form-hint">Requester ID: {row.requestedBy} · Legal entity: {row.legalEntityId}</p>
   <div className="invoice-form-field"><label className="form-label" htmlFor={"correction-review-reason-"+row.id}>Review rationale (required)</label><textarea id={"correction-review-reason-"+row.id} className="form-control form-control--textarea" required minLength={10} maxLength={1000} value={reasons[row.id]??""} onChange={e=>setReasons(old=>({...old,[row.id]:e.target.value}))}/></div>
   {row.correctionType!=="CANCEL"?<InlineAlert tone="warning" title="Execution blocked">Credit/debit-note treatment is not implemented because actual issuer-specific tax, numbering, template and statutory treatment must be approved first. Reject the request or retain it pending; do not mark it executed.</InlineAlert>:null}
   <div className="invoice-editor__actions"><Button type="button" variant="secondary" disabled={!canReview||busy===row.id} onClick={()=>void decide(row,"REJECT")}>{busy===row.id?"Saving…":"Reject request"}</Button><Button type="button" disabled={!canReview||busy===row.id||row.correctionType!=="CANCEL"||(reasons[row.id]??"").trim().length<10} onClick={()=>void decide(row,"APPROVE")}>{busy===row.id?"Applying…":"Approve and cancel"}</Button></div>
   <details><summary>Recorded request history ({row.history.length} events)</summary><ol>{row.history.map(event=><li key={event.id}><strong>{event.eventType}</strong> · {new Date(event.createdAt).toLocaleString()}<p>{event.reason}</p></li>)}</ol></details>
  </Card>)}
 </div>;
}
