"use client";

import { useCallback, useEffect, useState } from "react";
import { Button, InlineAlert, LoadingState, StatusBadge } from "@/components/ui";

type SourceType = "INVOICE" | "QUOTATION" | "RECEIPT";
type DeliveryEvent = { type:string; previousStatus:string|null; status:string|null; reasonCode:string|null; createdAt:string };
type EmailItem = {
  id:string; sourceType:SourceType; sourceDocumentId:string; documentNumber:string; messageKind:"DOCUMENT"|"OVERDUE_REMINDER";
  recipientEmail:string; subject:string; attachmentSha256:string|null; attachmentByteSize:number|null;
  providerMessageId:string|null; status:string; attemptCount:number; nextAttemptAt:string|null; lastAttemptAt:string|null;
  lastErrorCode:string|null; sentAt:string|null; deliveredAt:string|null; createdAt:string; updatedAt:string; events:DeliveryEvent[];
};
type ResponseBody = {
  data?: { items?:EmailItem[]; defaultRecipientEmail?:string; recipientName?:string };
  error?: { message?:string; code?:string };
};
type Props = { sourceType:SourceType; sourceId:string };

function prettyDate(value:string|null|undefined) {
  if(!value) return "—";
  const parsed=new Date(value);
  return Number.isNaN(parsed.getTime())?value:parsed.toLocaleString();
}
function statusTone(status:string):"success"|"danger"|"warning" {
  if(status==="DELIVERED" || status==="SENT") return "success";
  if(status==="FAILED" || status==="BOUNCED" || status==="COMPLAINED" || status==="REQUIRES_REVIEW") return "danger";
  return "warning";
}

export function EmailDeliveryPanel({sourceType,sourceId}:Props) {
  const [items,setItems]=useState<EmailItem[]>([]);
  const [recipientEmail,setRecipientEmail]=useState("");
  const [recipientName,setRecipientName]=useState("");
  const [confirmed,setConfirmed]=useState(false);
  const [loading,setLoading]=useState(true);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  const [message,setMessage]=useState("");
  const [idempotencyKey,setIdempotencyKey]=useState(()=>crypto.randomUUID());

  const refresh=useCallback(async(signal?:AbortSignal)=>{
    setLoading(true);
    try {
      const response=await fetch("/api/v1/email/outbox?sourceType="+sourceType+"&sourceId="+sourceId,{cache:"no-store",signal});
      let body:ResponseBody={};
      try { body=await response.json() as ResponseBody; } catch { /* generic error below */ }
      if(!response.ok) throw new Error(body.error?.message??"Email history could not be loaded.");
      setItems(Array.isArray(body.data?.items)?body.data.items:[]);
      const suggested=body.data?.defaultRecipientEmail??"";
      setRecipientEmail(current=>current.trim()?current:suggested);
      setRecipientName(body.data?.recipientName??"");
      setError("");
    } catch(cause) {
      if(cause instanceof Error && cause.name==="AbortError") return;
      setError(cause instanceof Error?cause.message:"Email history could not be loaded.");
    } finally { if(!signal?.aborted) setLoading(false); }
  },[sourceId,sourceType]);

  useEffect(()=>{
    const controller=new AbortController();
    void Promise.resolve().then(()=>refresh(controller.signal));
    return ()=>controller.abort();
  },[refresh]);

  async function csrfToken() {
    const response=await fetch("/api/v1/auth/csrf",{cache:"no-store"});
    let body: {data?:{csrfToken?:string}}={};
    try { body=await response.json() as typeof body; } catch { /* handled below */ }
    if(!response.ok || !body.data?.csrfToken) throw new Error("Security verification expired. Refresh the page and try again.");
    return body.data.csrfToken;
  }

  async function send() {
    setBusy(true);setError("");setMessage("");
    try {
      const csrf=await csrfToken();
      const response=await fetch("/api/v1/email/outbox",{
        method:"POST",cache:"no-store",
        headers:{"Accept":"application/json","Content-Type":"application/json","X-CSRF-Token":csrf,"Idempotency-Key":idempotencyKey},
        body:JSON.stringify({sourceType,sourceId,recipientEmail:recipientEmail.trim(),recipientConfirmed:confirmed}),
      });
      let body: {data?:EmailItem & {idempotentReplay?:boolean;immediateDeliveryAttempted?:boolean;immediateDeliveryDeferred?:boolean};error?:{message?:string}}={};
      try { body=await response.json() as typeof body; } catch { /* generic error below */ }
      if(!response.ok) throw new Error(body.error?.message??"The email could not be queued.");
      const status=body.data?.status??"QUEUED";
      const deliveryMessage=status==="DELIVERED"
        ?"The provider confirms this email was delivered."
        :status==="SENT"
          ?"The email provider accepted the message. Delivery confirmation will appear when the provider sends its event."
          :status==="FAILED"||status==="BOUNCED"||status==="COMPLAINED"||status==="REQUIRES_REVIEW"
            ?"The email was not confirmed as delivered ("+status+"). Review the delivery timeline and retry if appropriate."
            :body.data?.immediateDeliveryDeferred
              ?"The email is saved in the durable outbox. An immediate attempt was deferred; the worker will retry it."
              :body.data?.immediateDeliveryAttempted
                ?"The immediate send attempt did not complete delivery. The durable outbox will retry according to policy."
                :"The email is saved in the durable outbox and awaits delivery processing.";
      setMessage(body.data?.idempotentReplay?"This email request was already accepted; no duplicate was created. "+deliveryMessage:deliveryMessage);
      setIdempotencyKey(crypto.randomUUID());
      setConfirmed(false);
      await refresh();
    } catch(cause) {
      // Keep the same idempotency key after a network-uncertain error so a retry cannot create a second email.
      setError(cause instanceof Error?cause.message:"The email could not be queued.");
    } finally { setBusy(false); }
  }

  async function retry(item:EmailItem) {
    setBusy(true);setError("");setMessage("");
    try {
      const csrf=await csrfToken();
      const response=await fetch("/api/v1/email/outbox/"+item.id+"/retry",{
        method:"POST",cache:"no-store",headers:{"Accept":"application/json","Content-Type":"application/json","X-CSRF-Token":csrf},body:"{}",
      });
      let body:{data?:(EmailItem & {immediateDeliveryAttempted?:boolean;immediateDeliveryDeferred?:boolean});error?:{message?:string}}={};
      try { body=await response.json() as typeof body; } catch { /* generic error below */ }
      if(!response.ok) throw new Error(body.error?.message??"The failed email could not be retried.");
      const status=body.data?.status??"QUEUED";
      setMessage(status==="DELIVERED"
        ?"Retry succeeded and the provider confirms delivery."
        :status==="SENT"
          ?"Retry succeeded: the email provider accepted the message. Delivery confirmation is pending."
          :status==="FAILED"||status==="BOUNCED"||status==="COMPLAINED"||status==="REQUIRES_REVIEW"
            ?"The retry did not resolve delivery ("+status+"). Review the delivery timeline before retrying again."
            :body.data?.immediateDeliveryDeferred
              ?"The retry is saved for the durable worker; the immediate attempt was deferred."
              :"The retry was processed. Current status: "+status+".");
      await refresh();
    } catch(cause) { setError(cause instanceof Error?cause.message:"The failed email could not be retried."); }
    finally { setBusy(false); }
  }

  return (
    <section className="master-data-panel" aria-labelledby={"email-delivery-"+sourceType+"-"+sourceId}>
      <div className="master-data-panel__heading">
        <div>
          <h3 id={"email-delivery-"+sourceType+"-"+sourceId}>Email delivery and evidence</h3>
          <p>Email requests are saved to a durable outbox. “Sent” means accepted by the provider; “Delivered” requires a verified provider event.</p>
        </div>
        <Button size="sm" variant="secondary" disabled={loading||busy} onClick={()=>void refresh()}>{loading?"Refreshing…":"Refresh history"}</Button>
      </div>
      {error?<InlineAlert tone="danger" title="Email action needs attention">{error}</InlineAlert>:null}
      {message?<InlineAlert tone="success" title="Email status">{message}</InlineAlert>:null}
      <div className="invoice-form-grid">
        <div className="invoice-form-field">
          <label className="form-label" htmlFor={"email-recipient-"+sourceId}>Confirmed recipient email</label>
          <input id={"email-recipient-"+sourceId} className="form-input" type="email" maxLength={320} autoComplete="email" value={recipientEmail}
            onChange={event=>{setRecipientEmail(event.target.value);setConfirmed(false);setIdempotencyKey(crypto.randomUUID());}} />
          <p className="form-hint">Suggested from the immutable document snapshot{recipientName?" for "+recipientName:""}. Verify this exact address before sending.</p>
        </div>
        <div className="invoice-form-field invoice-form-field--wide">
          <label className="form-label">
            <input type="checkbox" checked={confirmed} onChange={event=>setConfirmed(event.target.checked)} />
            {" "}I have checked the recipient email address and authorize sending this document.
          </label>
        </div>
      </div>
      <div className="master-data-actions">
        <Button disabled={busy||loading||!confirmed||!recipientEmail.trim()} onClick={()=>void send()}>{busy?"Processing…":"Queue email with verified PDF"}</Button>
      </div>
      <p className="form-hint">The message uses the immutable source snapshot and its verified private PDF. Internal notes and provider credentials are never included.</p>
      {loading&&items.length===0?<LoadingState label="Loading email delivery history…"/>:null}
      {!loading&&items.length===0?<p className="form-hint">No email has been queued for this document.</p>:null}
      {items.length>0?<div className="data-table-scroll"><table className="data-table">
        <thead><tr><th>Status</th><th>Recipient / subject</th><th>Attempts</th><th>Provider evidence</th><th>Updated</th><th>Action</th></tr></thead>
        <tbody>{items.map(item=><tr key={item.id}>
          <td><StatusBadge tone={statusTone(item.status)}>{item.status}</StatusBadge>{item.lastErrorCode?<div className="invoice-workspace-muted">{item.lastErrorCode}</div>:null}</td>
          <td><strong>{item.recipientEmail}</strong><div className="invoice-workspace-muted">{item.subject}</div><div className="invoice-workspace-muted">{item.messageKind==="OVERDUE_REMINDER"?"Overdue reminder":"Document email"}</div></td>
          <td>{item.attemptCount}</td>
          <td>{item.providerMessageId?<code>{item.providerMessageId}</code>:"Awaiting provider"}{item.attachmentSha256?<div className="invoice-workspace-muted">PDF SHA-256: {item.attachmentSha256.slice(0,16)}…</div>:null}
            {item.events?.length?<details><summary>Events ({item.events.length})</summary><ul>{item.events.map((event,index)=><li key={item.id+"-"+event.type+"-"+index}>{event.type} · {event.status??"—"} · {prettyDate(event.createdAt)}{event.reasonCode?" · "+event.reasonCode:""}</li>)}</ul></details>:null}</td>
          <td>{prettyDate(item.updatedAt)}{item.sentAt?<div className="invoice-workspace-muted">Accepted {prettyDate(item.sentAt)}</div>:null}{item.deliveredAt?<div className="invoice-workspace-muted">Delivered {prettyDate(item.deliveredAt)}</div>:null}</td>
          <td>{item.status==="FAILED"?<Button size="sm" variant="secondary" disabled={busy} onClick={()=>void retry(item)}>Retry failed send</Button>:item.status==="REQUIRES_REVIEW"?"Review provider outcome":"—"}</td>
        </tr>)}</tbody>
      </table></div>:null}
    </section>
  );
}
