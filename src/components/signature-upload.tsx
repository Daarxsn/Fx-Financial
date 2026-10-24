"use client";

import { useState, type ChangeEvent } from "react";

type Props = { entityId: string; configured: boolean; onUploaded: () => void };

export function SignatureUpload({ entityId, configured, onUploaded }: Props) {
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  const [message,setMessage]=useState("");

  async function upload(event: ChangeEvent<HTMLInputElement>) {
    const file=event.target.files?.[0];
    event.target.value="";
    if(!file)return;
    setBusy(true);setError("");setMessage("");
    try {
      const csrfResponse=await fetch("/api/v1/auth/csrf",{cache:"no-store"});
      const csrfBody=await csrfResponse.json() as {data?:{csrfToken?:string};error?:{message?:string}};
      if(!csrfResponse.ok||!csrfBody.data?.csrfToken)throw new Error(csrfBody.error?.message??"Security verification expired. Refresh and try again.");
      const form=new FormData();form.set("signature",file);
      const response=await fetch("/api/v1/legal-entities/"+entityId+"/signature",{
        method:"POST",cache:"no-store",headers:{"X-CSRF-Token":csrfBody.data.csrfToken},body:form,
      });
      const body=await response.json() as {data?:{signatureConfigured?:boolean};error?:{message?:string}};
      if(!response.ok)throw new Error(body.error?.message??"The signature image could not be saved.");
      setMessage("Signature saved privately. Future invoice previews and issued PDFs will use this configuration version.");
      onUploaded();
    } catch(cause) {
      setError(cause instanceof Error?cause.message:"The signature image could not be saved.");
    } finally { setBusy(false); }
  }

  return <section className="config-record-card" aria-labelledby={"invoice-signature-title-"+entityId} style={{margin:"14px 0",padding:18}}>
    <div className="config-record-name">
      <h3 id={"invoice-signature-title-"+entityId}>Invoice signature</h3>
      <p>{configured?"A signature image is configured. Replacing it creates a new configuration version.":"No signature is configured. Upload the authorised signatory’s image to show it on proforma PDFs."}</p>
      <p className="config-muted">PNG, JPEG or WebP · up to 6 MB. Stored privately, not at a public URL.</p>
      <label className="form-label" htmlFor={"invoice-signature-file-"+entityId}>Upload signature image</label>
      <input id={"invoice-signature-file-"+entityId} type="file" accept="image/png,image/jpeg,image/webp" disabled={busy} onChange={upload}/>
      {busy?<p role="status" className="config-muted">Validating and saving signature…</p>:null}
      {message?<p role="status" className="config-muted">{message}</p>:null}
      {error?<p role="alert" className="config-error">{error}</p>:null}
    </div>
  </section>;
}
