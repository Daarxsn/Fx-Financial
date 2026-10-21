"use client";
import { useCallback,useEffect,useState,type FormEvent } from "react";
import Link from "next/link";
import { Button,InlineAlert,LoadingState,StatusBadge } from "@/components/ui";

type CorrectionEvent={id:string;eventType:string;previousStatus:string|null;status:string;reason:string;actorId:string;createdAt:string};
type Correction={id:string;invoiceId:string;invoiceNumber:string|null;correctionType:"CANCEL"|"CREDIT_NOTE"|"DEBIT_NOTE";status:"PENDING_REVIEW"|"REJECTED"|"EXECUTED";reason:string;requestedBy:string;reviewedBy:string|null;reviewDecision:string|null;reviewReason:string|null;createdAt:string;history:CorrectionEvent[]};
type Props={invoiceId:string;invoiceNumber:string|null;lifecycleStatus:string;documentType:string;canRequest:boolean;canReview:boolean};
type ListResponse={data?:Correction[];error?:{message?:string}};
async function csrfToken(){
 const cookie=document.cookie.split(";").map(x=>x.trim()).find(x=>x.startsWith("fx_csrf="))?.slice("fx_csrf=".length);
 if(cookie)return decodeURIComponent(cookie);
 const response=await fetch("/api/v1/auth/csrf",{cache:"no-store",credentials:"same-origin"});const body=await response.json();
 if(!response.ok||!body.data?.csrfToken)throw new Error("Request validation expired. Refresh and retry.");
 return body.data.csrfToken as string;
}
const statusTone=(s:Correction["status"])=>s==="EXECUTED"?"success":s==="REJECTED"?"danger":"warning";
export function InvoiceCorrectionPanel({invoiceId,invoiceNumber,lifecycleStatus,documentType,canRequest,canReview}:Props){
 const [rows,setRows]=useState<Correction[]>([]);
 const [loading,setLoading]=useState(false),[saving,setSaving]=useState(false),[error,setError]=useState(""),[success,setSuccess]=useState("");
 const [correctionType,setCorrectionType]=useState<Correction["correctionType"]>("CANCEL"),[reason,setReason]=useState(""),[idempotencyKey,setIdempotencyKey]=useState(()=>crypto.randomUUID()+crypto.randomUUID());
 const available=lifecycleStatus==="ISSUED"&&documentType==="INVOICE";
 const refresh=useCallback(async()=>{
  setLoading(true);
  try{
   const response=await fetch("/api/v1/correction-requests?invoiceId="+encodeURIComponent(invoiceId)+"&status=all",{cache:"no-store",credentials:"same-origin"});
   const body=await response.json() as ListResponse;
   if(response.status===403){setRows([]);return;}
   if(!response.ok)throw new Error(body.error?.message??"Correction requests could not be loaded.");
   setRows(Array.isArray(body.data)?body.data:[]);
  }catch(e){setError(e instanceof Error?e.message:"Correction requests could not be loaded.");}
  finally{setLoading(false);}
 },[invoiceId]);
 useEffect(()=>{if(available&&(canRequest||canReview))Promise.resolve().then(()=>refresh());},[available,canRequest,canReview,refresh]);
 const submit=async(event:FormEvent<HTMLFormElement>)=>{
  event.preventDefault();if(!available||!canRequest||reason.trim().length<10)return;
  setSaving(true);setError("");setSuccess("");
  try{
   const token=await csrfToken();
   const response=await fetch("/api/v1/correction-requests",{method:"POST",cache:"no-store",credentials:"same-origin",
    headers:{"Content-Type":"application/json","X-CSRF-Token":token,"Idempotency-Key":idempotencyKey},
    body:JSON.stringify({invoiceId,correctionType,reason:reason.trim()})});
   const body=await response.json() as {data?:{status?:string};error?:{message?:string}};
   if(!response.ok)throw new Error(body.error?.message??"Correction request could not be submitted.");
   setSuccess("Correction request recorded for independent review; the issued invoice remains unchanged.");
   setReason("");setIdempotencyKey(crypto.randomUUID()+crypto.randomUUID());await refresh();
  }catch(e){setError(e instanceof Error?e.message:"Correction request could not be submitted.");}
  finally{setSaving(false);}
 };
 if(!available||(!canRequest&&!canReview))return null;
 return <section className="master-data-panel correction-panel" aria-labelledby="invoice-correction-heading">
  <div className="master-data-panel__heading"><div><h3 id="invoice-correction-heading">Issued-document correction</h3><p>Requests preserve the original invoice. A separate authorized reviewer decides; this form never edits or cancels the source directly.</p></div><StatusBadge tone="warning">Review required</StatusBadge></div>
  {error?<InlineAlert tone="danger" title="Correction workflow">{error}</InlineAlert>:null}
  {success?<InlineAlert tone="success" title="Request recorded">{success}</InlineAlert>:null}
  {canRequest?<form onSubmit={submit}><div className="invoice-form-grid">
   <div className="invoice-form-field"><label className="form-label" htmlFor="invoice-correction-type">Requested path</label><select id="invoice-correction-type" className="form-control" value={correctionType} onChange={e=>setCorrectionType(e.target.value as Correction["correctionType"])}><option value="CANCEL">Request cancellation (unpaid invoices only, subject to policy)</option><option value="CREDIT_NOTE">Request credit note (blocked pending approved treatment)</option><option value="DEBIT_NOTE">Request debit note (blocked pending approved treatment)</option></select></div>
   <div className="invoice-form-field invoice-form-field--wide"><label className="form-label" htmlFor="invoice-correction-reason">Business reason (required)</label><textarea id="invoice-correction-reason" className="form-control form-control--textarea" required minLength={10} maxLength={1000} value={reason} onChange={e=>setReason(e.target.value)} placeholder="Describe the issue and evidence for the correction request."/></div>
  </div><div className="invoice-editor__actions"><Button type="submit" disabled={saving||reason.trim().length<10}>{saving?"Submitting request…":"Submit correction request"}</Button></div></form>:null}
  {loading?<LoadingState label="Loading correction request history…"/>:null}
  {!loading&&rows.length?<div className="correction-request-list">{rows.map(row=><article className="correction-request-card" key={row.id}><div className="correction-request-card__head"><div><p className="eyebrow">{row.correctionType.replaceAll("_"," ")} · {new Date(row.createdAt).toLocaleString()}</p><h4>Request {row.id.slice(0,8)}</h4></div><StatusBadge tone={statusTone(row.status)}>{row.status.replaceAll("_"," ")}</StatusBadge></div><p className="correction-request-card__reason">{row.reason}</p>{row.reviewReason?<p className="form-hint">Review: {row.reviewReason}</p>:null}<details><summary>Audit history ({row.history.length} events)</summary><ol>{row.history.map(event=><li key={event.id}><strong>{event.eventType.replaceAll("_"," ")}</strong> · {new Date(event.createdAt).toLocaleString()}<p>{event.reason}</p></li>)}</ol></details></article>)}</div>:null}
  {canReview?<p className="form-hint"><Link href="/approvals">Open the correction review queue →</Link></p>:null}
 </section>;
}
