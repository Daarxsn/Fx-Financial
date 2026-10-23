"use client";

import Link from "next/link";
import Image from "next/image";
import { cloneElement, isValidElement, useCallback, useEffect, useId, useMemo, useState, type FormEvent, type ReactElement, type ReactNode } from "react";
import { Button, EmptyState, InlineAlert, LoadingState, StatusBadge } from "@/components/ui";
import { InvoiceCorrectionPanel } from "@/components/invoice-correction-panel";
import { DocumentHistoryPanel } from "@/components/document-history-panel";
import { EmailDeliveryPanel } from "@/components/email-delivery-panel";

type LineKind="ITEM"|"CHARGE"; type DiscountType="AMOUNT"|"PERCENT";
type LineDraft={key:string;catalogItemId:string;lineKind:LineKind;milestone:string;description:string;unitCode:string;quantity:string;unitPrice:string;discountType:DiscountType;discountValue:string;taxCode:string};
type Entity={id:string;name:string;currency:string;taxSetupStatus:string};
type Customer={id:string;name:string;customerCode:string|null;email:string|null;paymentTermsDays:number|null};
type BrandChoice={id:string;name:string;code:string;logoReference:string|null;defaultTemplateKey:string|null;theme?:Record<string,unknown>;legalEntityId:string;legalEntityName:string;currency:string;taxSetupStatus:string;defaultTaxCode:string|null;canAutoMap:boolean};
type QuickCustomer={name:string;phone:string;line1:string;city:string;state:string;postalCode:string;countryCode:string};
type Item={id:string;itemCode:string|null;itemType:string;name:string;description:string;unitCode:string;defaultUnitPrice:string;currency:string;defaultTaxCode:string|null};
type TaxRule={id:string;legalEntityId:string;taxCode:string;displayName:string;ratePercent:string;calculationMode:"EXCLUSIVE"|"INCLUSIVE";effectiveFrom:string;effectiveUntil:string|null};
type Options={legalEntities:Entity[];brands:BrandChoice[];customers:Customer[];catalogItems:Item[];taxRules:TaxRule[]};
type Invoice= {id:string;legalEntityId:string;brandId:string|null;customerId:string;customerName:string;draftRecipientEmail:string;documentType:string;invoiceNumber:string|null;lifecycleStatus:string;paymentStatus:string;currency:string;subtotal:string;discountTotal:string;taxableValue:string;taxTotal:string;grandTotal:string;paidAmount:string;outstandingBalance:string;invoiceDate:string|null;dueDate:string|null;paymentTermsDays:number;recordVersion:number;createdAt:string;updatedAt:string;lines?:Array<Record<string,unknown>>;notes?:string|null};
type InvoicePayment = { id:string; invoiceId:string; receiptReference:string; customerId:string; amount:string; allocatedAmount:string; allocationCount:number; currency:string; paymentDate:string|null; method:string; reference:string|null; status:"RECORDED"|"REVERSED"; notes:string|null; createdAt:string; reversedAt:string|null; reversalReason:string|null };
type Api={data?:unknown;meta?:{pagination?:{total:number;limit:number;offset:number;hasMore:boolean}};error?:{message?:string;code?:string;fields?:Record<string,string>}};
const freshLine=(taxCode=""):LineDraft=>({key:crypto.randomUUID(),catalogItemId:"",lineKind:"ITEM",milestone:"",description:"",unitCode:"unit",quantity:"1.0000",unitPrice:"0.0000",discountType:"AMOUNT",discountValue:"0.0000",taxCode});
const today=()=>{const d=new Date();return [d.getFullYear(),String(d.getMonth()+1).padStart(2,"0"),String(d.getDate()).padStart(2,"0")].join("-");};
const record=(v:unknown):Record<string,unknown>=>v&&typeof v==="object"&&!Array.isArray(v)?v as Record<string,unknown>:{};
const str=(v:unknown)=>typeof v==="string"||typeof v==="number"?String(v):"";
const linesFrom=(v:unknown):LineDraft[]=>Array.isArray(v)&&v.length?v.map(x=>{const r=record(x);return {
 key:crypto.randomUUID(),catalogItemId:str(r.catalogItemId),lineKind:r.lineKind==="CHARGE"?"CHARGE":"ITEM",milestone:str(r.milestone),
 description:str(r.description),unitCode:str(r.unitCode)||"unit",quantity:str(r.quantity)||"1.0000",unitPrice:str(r.unitPrice)||"0.0000",
 discountType:r.discountType==="PERCENT"?"PERCENT":"AMOUNT",discountValue:str(r.discountValue)||"0.0000",taxCode:str(r.taxCode),
};}):[freshLine()];
function Field({label,children,wide=false,hint}:{label:string;children:ReactNode;wide?:boolean;hint?:string}){const fieldId=useId();const control=isValidElement(children)?cloneElement(children as ReactElement<{id?:string}>,{id:fieldId}):children;return <div className={wide?"invoice-form-field invoice-form-field--wide":"invoice-form-field"}><label className="form-label" htmlFor={fieldId}>{label}</label>{control}{hint?<p className="form-hint">{hint}</p>:null}</div>;}

export function InvoiceWorkspace(){
 const [permissions,setPermissions]=useState<string[]>([]);
 const [options,setOptions]=useState<Options>({legalEntities:[],brands:[],customers:[],catalogItems:[],taxRules:[]});
 const [rows,setRows]=useState<Invoice[]>([]);const [total,setTotal]=useState(0);const [offset,setOffset]=useState(0);
 const [status,setStatus]=useState("all");const [query,setQuery]=useState("");
 const [loading,setLoading]=useState(true);const [optionsLoading,setOptionsLoading]=useState(false);
 const [saving,setSaving]=useState(false);const [issuing,setIssuing]=useState("");
 const [error,setError]=useState("");const [success,setSuccess]=useState("");
 const [editor,setEditor]=useState(false);const [selected,setSelected]=useState<Invoice|null>(null);
 const [form,setForm]=useState({legalEntityId:"",brandId:"",customerId:"",currency:"",invoiceDate:today(),dueDate:"",paymentTermsDays:"0",notes:""});
 const [customerMode,setCustomerMode]=useState<"existing"|"new">("existing");
 const [quickCustomer,setQuickCustomer]=useState<QuickCustomer>({name:"",phone:"",line1:"",city:"",state:"",postalCode:"",countryCode:"IN"});
 const [recipientEmail,setRecipientEmail]=useState("");const [emailKey,setEmailKey]=useState(()=>crypto.randomUUID());
 const [lines,setLines]=useState<LineDraft[]>([freshLine()]);const [dirty,setDirty]=useState(false);
 const [createKey,setCreateKey]=useState(()=>crypto.randomUUID()+crypto.randomUUID());const [issueKeys,setIssueKeys]=useState<Record<string,string>>({});
 const [paymentHistory,setPaymentHistory]=useState<InvoicePayment[]>([]);const [paymentHistoryLoading,setPaymentHistoryLoading]=useState(false);
 const [paymentForm,setPaymentForm]=useState({amount:"",paymentDate:today(),method:"BANK_TRANSFER",reference:"",notes:""});
 const [paymentKey,setPaymentKey]=useState(()=>crypto.randomUUID()+crypto.randomUUID());
 const [reversingPaymentId,setReversingPaymentId]=useState("");const [reversalReason,setReversalReason]=useState("");const [reversalKey,setReversalKey]=useState(()=>crypto.randomUUID()+crypto.randomUUID());
 const limit=25;const canCreate=permissions.includes("invoices:draft:create");const canUpdate=permissions.includes("invoices:draft:update");const canIssue=permissions.includes("invoices:issue");
 const canRead=permissions.includes("invoices:read");const canAddCustomer=permissions.includes("customers:create");const canSendEmail=permissions.includes("email:send");
 const canReadPayments=permissions.includes("payments:read");const canRecordPayment=permissions.includes("payments:record");const canReversePayment=permissions.includes("payments:reverse");
 const validBrands=options.brands.filter(b=>b.canAutoMap);
 const missingSetup=!optionsLoading&&canCreate&&(!options.legalEntities.length||!validBrands.length);
 const selectedBrand=options.brands.find(b=>b.id===form.brandId);
 const selectedEntity=options.legalEntities.find(e=>e.id===form.legalEntityId);
 const rules=useMemo(()=>options.taxRules.filter(r=>r.legalEntityId===form.legalEntityId&&(!form.invoiceDate||r.effectiveFrom<=form.invoiceDate)&&(!r.effectiveUntil||r.effectiveUntil>=form.invoiceDate)),[options.taxRules,form.legalEntityId,form.invoiceDate]);
 const getRequest=useCallback(async(url:string,init:RequestInit={})=>{
  const response=await fetch(url,{...init,cache:"no-store",headers:{"Accept":"application/json",...(init.body?{"Content-Type":"application/json"}:{}),...(init.headers??{})}});
  let body:Api={};try{body=await response.json() as Api;}catch{/* safe generic message below */}
  return {response,body};
 },[]);
 const refreshProfile=useCallback(async()=>{try{const r=await fetch("/api/v1/auth/me",{cache:"no-store"});const b=await r.json() as {data?:{user?:{permissions?:string[]}}};if(r.ok)setPermissions(b.data?.user?.permissions??[]);}catch{/* server still enforces all access */}},[]);
 const refreshOptions=useCallback(async()=>{
  if(!canCreate&&!canUpdate)return;setOptionsLoading(true);
  try{const r=await getRequest("/api/v1/invoices/draft-options");if(!r.response.ok)throw new Error(r.body.error?.message??"Invoice form options could not be loaded.");setOptions((r.body.data??{legalEntities:[],brands:[],customers:[],catalogItems:[],taxRules:[]}) as Options);}
  catch(e){setError(e instanceof Error?e.message:"Invoice form options could not be loaded.");}
  finally{setOptionsLoading(false);}
 },[canCreate,canUpdate,getRequest]);
 const refresh=useCallback(async()=>{
  setLoading(true);setError("");
  try{const r=await getRequest("/api/v1/invoices?status="+encodeURIComponent(status)+"&query="+encodeURIComponent(query)+"&limit="+limit+"&offset="+offset);
   if(!r.response.ok)throw new Error(r.body.error?.message??"Invoices could not be loaded.");
   setRows(Array.isArray(r.body.data)?r.body.data as Invoice[]:[]);setTotal(Number(r.body.meta?.pagination?.total??0));
  }catch(e){setError(e instanceof Error?e.message:"Invoices could not be loaded.");}finally{setLoading(false);}
 },[getRequest,status,query,offset]);
 useEffect(()=>{Promise.resolve().then(()=>refreshProfile());},[refreshProfile]);
 useEffect(()=>{Promise.resolve().then(()=>refresh());},[refresh]);
 useEffect(()=>{Promise.resolve().then(()=>refreshOptions());},[refreshOptions]);
 const csrf=async()=>{const r=await fetch("/api/v1/auth/csrf",{cache:"no-store"});const b=await r.json() as {data?:{csrfToken?:string}};if(!r.ok||!b.data?.csrfToken)throw new Error("Request validation expired. Refresh the page and try again.");return b.data.csrfToken;};
 const refreshPaymentHistory=async(id:string)=>{
   if(!permissions.includes("payments:read")){setPaymentHistory([]);return;}
   setPaymentHistoryLoading(true);
   try{const r=await getRequest("/api/v1/invoices/"+id+"/payments");if(!r.response.ok)throw new Error(r.body.error?.message??"Payment history could not be loaded.");setPaymentHistory(Array.isArray(r.body.data)?r.body.data as InvoicePayment[]:[]);}
   catch(e){setError(e instanceof Error?e.message:"Payment history could not be loaded.");}
   finally{setPaymentHistoryLoading(false);}
  };
  const updatePaymentForm=(field:keyof typeof paymentForm,value:string)=>{setPaymentForm(old=>({...old,[field]:value}));setPaymentKey(crypto.randomUUID()+crypto.randomUUID());};
  const recordInvoicePayment=async(e:FormEvent<HTMLFormElement>)=>{
   e.preventDefault();if(!selected||selected.lifecycleStatus!=="ISSUED")return;
   setSaving(true);setError("");setSuccess("");
   try{
    const token=await csrf();
    const r=await getRequest("/api/v1/invoices/"+selected.id+"/payments",{method:"POST",headers:{"X-CSRF-Token":token,"Idempotency-Key":paymentKey},
     body:JSON.stringify({amount:paymentForm.amount,paymentDate:paymentForm.paymentDate,method:paymentForm.method,
      ...(paymentForm.reference.trim()?{reference:paymentForm.reference.trim()}:{}),...(paymentForm.notes.trim()?{notes:paymentForm.notes.trim()}:{})})});
    if(!r.response.ok)throw new Error(r.body.error?.message??"Payment could not be recorded.");
    const receiptReference=str(record(r.body.data).receiptReference)||"receipt";
    setPaymentForm(old=>({...old,amount:"",reference:"",notes:""}));setPaymentKey(crypto.randomUUID()+crypto.randomUUID());
    await refresh();await openInvoice(selected.id,true);setSuccess("Payment "+receiptReference+" recorded and fully allocated to this invoice.");
   }catch(e){setError(e instanceof Error?e.message:"Payment could not be recorded.");}finally{setSaving(false);}
  };
  const reverseInvoicePayment=async(e:FormEvent<HTMLFormElement>)=>{
   e.preventDefault();if(!selected||!reversingPaymentId||reversalReason.trim().length<3){setError("Enter a reversal reason of at least 3 characters.");return;}
   setSaving(true);setError("");setSuccess("");
   try{
    const token=await csrf();
    const r=await getRequest("/api/v1/payments/"+reversingPaymentId+"/reverse",{method:"POST",headers:{"X-CSRF-Token":token,"Idempotency-Key":reversalKey},body:JSON.stringify({reason:reversalReason.trim()})});
    if(!r.response.ok)throw new Error(r.body.error?.message??"Payment reversal failed.");
    const oldPayment=paymentHistory.find(item=>item.id===reversingPaymentId);
    setReversingPaymentId("");setReversalReason("");setReversalKey(crypto.randomUUID()+crypto.randomUUID());
    await refresh();await openInvoice(selected.id,true);
    setSuccess("Receipt "+(oldPayment?.receiptReference??"")+" reversed. Its history remains retained and linked balances were recalculated.");
   }catch(e){setError(e instanceof Error?e.message:"Payment reversal failed.");}finally{setSaving(false);}
  };
  const updateForm=(key:keyof typeof form,value:string)=>{setForm(old=>({...old,[key]:value}));setDirty(true);setCreateKey(crypto.randomUUID()+crypto.randomUUID());};
 const updateLine=(key:string,patch:Partial<LineDraft>)=>{setLines(old=>old.map(line=>line.key===key?{...line,...patch}:line));setDirty(true);setCreateKey(crypto.randomUUID()+crypto.randomUUID());};
 const updateQuickCustomer=(key:keyof QuickCustomer,value:string)=>setQuickCustomer(old=>({...old,[key]:value}));
 const chooseBrand=(brandId:string)=>{const brand=validBrands.find(b=>b.id===brandId);setForm(old=>({...old,brandId,legalEntityId:brand?.legalEntityId??"",currency:brand?.currency??"INR"}));setLines(old=>old.map(line=>({...line,taxCode:brand?.defaultTaxCode??""})));setDirty(true);setCreateKey(crypto.randomUUID()+crypto.randomUUID());};
 const logoForBrand=(brand:BrandChoice)=>{const code=(brand.code+" "+brand.name).toUpperCase();if(code.includes("COWORK"))return "/brand/fx-coworks.webp";if(code.includes("DIGI"))return "/brand/fx-digitech.webp";if(code.includes("MYFX")||code.includes("POS"))return "/brand/myfx-pos.webp";return brand.logoReference?.startsWith("/brand/")?brand.logoReference:"/brand/falchion-xeniaa-logo.webp";};
 const startNew=()=>{setSelected(null);setPaymentHistory([]);setReversingPaymentId("");setCustomerMode(canAddCustomer?"new":"existing");setQuickCustomer({name:"",phone:"",line1:"",city:"",state:"",postalCode:"",countryCode:"IN"});setRecipientEmail("");setEmailKey(crypto.randomUUID());setForm({legalEntityId:"",brandId:"",customerId:"",currency:"",invoiceDate:today(),dueDate:"",paymentTermsDays:"0",notes:""});setLines([freshLine()]);setDirty(true);setEditor(true);setError("");setSuccess("");setCreateKey(crypto.randomUUID()+crypto.randomUUID());};
 const openInvoice=async(id:string,preserveMessages=false)=>{
  if(!preserveMessages){setError("");setSuccess("");}setSaving(true);
  try{const r=await getRequest("/api/v1/invoices/"+id);if(!r.response.ok)throw new Error(r.body.error?.message??"Invoice could not be opened.");
   const v=record(r.body.data) as unknown as Invoice;setSelected(v);setCustomerMode("existing");setRecipientEmail(v.draftRecipientEmail??options.customers.find(c=>c.id===v.customerId)?.email??recipientEmail);setEmailKey(crypto.randomUUID());setForm({legalEntityId:v.legalEntityId,brandId:v.brandId??"",customerId:v.customerId,currency:v.currency,invoiceDate:v.invoiceDate??today(),dueDate:v.dueDate??"",paymentTermsDays:String(v.paymentTermsDays??0),notes:v.notes??""});
   setLines(linesFrom(v.lines));setDirty(false);setEditor(v.lifecycleStatus==="DRAFT"&&canUpdate);await refreshPaymentHistory(id);
  }catch(e){setError(e instanceof Error?e.message:"Invoice could not be opened.");}finally{setSaving(false);}
 };
 const makePayload=(customerId:string)=>({legalEntityId:form.legalEntityId,brandId:form.brandId||null,customerId,currency:form.currency,invoiceDate:form.invoiceDate||null,dueDate:form.dueDate||null,paymentTermsDays:Number(form.paymentTermsDays),notes:form.notes||null,recipientEmail:recipientEmail.trim(),
  lines:lines.map(l=>({...l.catalogItemId?{catalogItemId:l.catalogItemId}:{},lineKind:l.lineKind,milestone:l.milestone.trim()||null,description:l.description.trim(),unitCode:l.unitCode.trim(),quantity:l.quantity,unitPrice:l.unitPrice,discountType:l.discountType,discountValue:l.discountValue,taxCode:l.taxCode.trim()||null}))});
 const resolveCustomerId=async()=>{
  if(customerMode==="existing"){if(!form.customerId)throw new Error("Choose a customer or add the customer details here.");return form.customerId;}
  if(!canAddCustomer)throw new Error("This account cannot create customers. Ask an administrator to grant customer creation access.");
  if(!quickCustomer.name.trim())throw new Error("Enter the customer or company name.");
  const hasAddress=Boolean(quickCustomer.line1.trim()||quickCustomer.city.trim()||quickCustomer.state.trim()||quickCustomer.postalCode.trim());
  const token=await csrf();
  const address=hasAddress?{line1:quickCustomer.line1.trim(),city:quickCustomer.city.trim(),state:quickCustomer.state.trim(),postalCode:quickCustomer.postalCode.trim(),countryCode:quickCustomer.countryCode.trim().toUpperCase()||"IN"}:undefined;
  const r=await getRequest("/api/v1/customers",{method:"POST",headers:{"X-CSRF-Token":token},body:JSON.stringify({name:quickCustomer.name.trim(),...(recipientEmail.trim()?{email:recipientEmail.trim()}:{}),...(quickCustomer.phone.trim()?{phone:quickCustomer.phone.trim()}:{}),...(address?{billingAddress:address}:{})})});
  if(!r.response.ok)throw new Error(r.body.error?.message??"Customer details could not be saved.");
  const id=str(record(r.body.data).id);if(!id)throw new Error("The customer was saved but no customer ID was returned. Refresh customer options before continuing.");
  setCustomerMode("existing");setForm(old=>({...old,customerId:id,paymentTermsDays:"0"}));setQuickCustomer({name:"",phone:"",line1:"",city:"",state:"",postalCode:"",countryCode:"IN"});
  await refreshOptions();return id;
 };
 const save=async(e?:FormEvent<HTMLFormElement>,issueAndSend=false)=>{e?.preventDefault();setSaving(true);setError("");setSuccess("");
  try{
   if(!form.brandId||!form.legalEntityId)throw new Error("Choose an invoice brand. Its approved issuer is selected automatically.");
   if(issueAndSend&&(!canIssue||!canSendEmail))throw new Error("Your role cannot both issue and email invoices. Save the draft or ask the administrator to update access.");
   if(issueAndSend&&!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(recipientEmail.trim()))throw new Error("Enter a valid recipient email before issuing and sending.");
   if(customerMode==="new"&&!quickCustomer.name.trim())throw new Error("Enter the customer or company name.");
   if(!lines.length||lines.some(l=>!l.description.trim()))throw new Error("Each invoice line requires a description.");
   const invalidTaxLine=lines.find(l=>l.taxCode.trim()&&!rules.some(r=>r.taxCode===l.taxCode.trim()));
   if(invalidTaxLine)throw new Error("Line "+(lines.indexOf(invalidTaxLine)+1)+" tax code is not approved and effective for this invoice date. Choose an effective tax code under “Discount & tax (optional)”.");
   const customerId=await resolveCustomerId();
   const token=await csrf();const body=makePayload(customerId);const url=selected?"/api/v1/invoices/"+selected.id:"/api/v1/invoices";
   const r=await getRequest(url,{method:selected?"PATCH":"POST",headers:{"X-CSRF-Token":token,...(!selected?{"Idempotency-Key":createKey}:{})},body:JSON.stringify(selected?{...body,expectedVersion:selected.recordVersion}:body)});
   if(!r.response.ok)throw new Error(r.body.error?.message??"Invoice draft could not be saved.");
   const id=str(record(r.body.data).id)||selected?.id||"";
   if(!id)throw new Error("Invoice draft was saved but the response did not include its document ID.");
   setDirty(false);
   if(!issueAndSend){setSuccess("Draft saved. The server recalculated the totals.");setEditor(false);await refresh();await openInvoice(id,true);return;}
   const key=issueKeys[id]??("fx-issue-"+crypto.randomUUID()+"-"+crypto.randomUUID());setIssueKeys(old=>({...old,[id]:key}));
   const issueToken=await csrf();
   const issued=await getRequest("/api/v1/invoices/"+id+"/issue",{method:"POST",headers:{"X-CSRF-Token":issueToken,"Idempotency-Key":key},body:JSON.stringify({documentDate:form.invoiceDate||today()})});
   if(!issued.response.ok){setSuccess("Draft saved, but it was not issued.");setError(issued.body.error?.message??"Issuance is blocked by a required approval or configuration.");setEditor(false);await refresh();await openInvoice(id,true);return;}
   let emailError="";
   try{
    const emailToken=await csrf();
    const sent=await getRequest("/api/v1/email/outbox",{method:"POST",headers:{"X-CSRF-Token":emailToken,"Idempotency-Key":emailKey},body:JSON.stringify({sourceType:"INVOICE",sourceId:id,recipientEmail:recipientEmail.trim(),recipientConfirmed:true})});
    if(!sent.response.ok)throw new Error(sent.body.error?.message??"Email could not be queued.");
    setEmailKey(crypto.randomUUID());
   }catch(mailCause){emailError=mailCause instanceof Error?mailCause.message:"Email could not be queued.";}
   setSuccess(emailError?"Invoice issued successfully. Email needs attention.":"Invoice issued and email queued. Check its delivery status in the invoice details.");
   if(emailError)setError("The invoice was issued, but email was not queued: "+emailError);
   setEditor(false);await refresh();await openInvoice(id,true);
  }catch(e){setError(e instanceof Error?e.message:"Invoice draft could not be saved.");}finally{setSaving(false);}
 };
 const issue=async(row:Invoice)=>{setIssuing(row.id);setError("");setSuccess("");
  try{const token=await csrf();const key=issueKeys[row.id]??("fx-issue-"+crypto.randomUUID()+"-"+crypto.randomUUID());setIssueKeys(old=>({...old,[row.id]:key}));
   const r=await getRequest("/api/v1/invoices/"+row.id+"/issue",{method:"POST",headers:{"X-CSRF-Token":token,"Idempotency-Key":key},body:JSON.stringify({documentDate:row.invoiceDate||today()})});
   if(!r.response.ok)throw new Error(r.body.error?.message??"Invoice issuance is blocked by a configuration or validation check.");
   setSuccess("Invoice issued successfully. Its number and issue-time configuration snapshot are preserved.");setSelected(null);setEditor(false);await refresh();
  }catch(e){setError(e instanceof Error?e.message:"Invoice could not be issued.");}finally{setIssuing("");}
 };
 const fmt=(v:unknown)=>str(v)||"0.0000";
 const currency=(cur:string,v:unknown)=>cur+" "+fmt(v);
 return <div className="invoice-workspace">
  <div className="invoice-workspace-toolbar">
   <div className="invoice-workspace-search"><label className="form-label" htmlFor="invoice-search">Search invoices</label><input id="invoice-search" className="form-control" value={query} placeholder="Invoice number or customer" onChange={e=>{setQuery(e.target.value);setOffset(0);}}/></div>
   <div><label className="form-label" htmlFor="invoice-status">Status</label><select className="form-control" id="invoice-status" value={status} onChange={e=>{setStatus(e.target.value);setOffset(0);}}><option value="all">All statuses</option><option value="DRAFT">Draft</option><option value="ISSUED">Issued</option><option value="CANCELLED">Cancelled</option></select></div>
   {canCreate?<Button disabled={optionsLoading||!options.legalEntities.length||!validBrands.length||(!options.customers.length&&!canAddCustomer)} onClick={startNew}>+ New invoice</Button>:null}
  </div>
  <InlineAlert tone="info" title="Server-authoritative financials">The server calculates exact-decimal amounts using HALF_UP rounding to four places. Approved, effective tax rules determine rates and inclusive/exclusive treatment. Multi-currency conversion is disabled until an approved FX policy exists.</InlineAlert>
  {!canRead?<InlineAlert tone="warning" title="Invoice access is not assigned">
    This account does not have <code>invoices:read</code>, so the invoice list and draft actions are unavailable. A system administrator must assign an approved finance role and the appropriate legal-entity scope. The system administrator role alone does not grant finance permissions.
  </InlineAlert>:null}
  {canRead&&!canCreate?<InlineAlert tone="warning" title="Invoice creation permission required">
    You can view invoices, but your role cannot create drafts. Ask an access administrator to assign <code>invoices:draft:create</code> (typically the Finance Administrator or Invoice Creator role) and an active legal-entity scope.
  </InlineAlert>:null}
  {missingSetup?<div className="invoice-setup-callout">
    <InlineAlert tone="warning" title="One-time invoice setup is incomplete">
     {!options.legalEntities.length?"An approved company profile is needed before invoices can be issued. Complete this once in Settings.":"At least one active brand needs a default issuer mapping. After that one-time setup, choose the brand and enter customer details directly here."} No sample or placeholder business data is inserted.
    </InlineAlert>
    <div className="invoice-setup-actions">
     {!options.legalEntities.length?<Link href="/settings" className="button button--secondary button--md">Complete company setup</Link>:null}
     {options.legalEntities.length&&validBrands.length===0?<Link href="/settings" className="button button--primary button--md">Review brand mapping</Link>:null}
    </div>
   </div>:null}
  {error?<InlineAlert tone="danger" title="Invoice action needs attention">{error}</InlineAlert>:null}
  {success?<InlineAlert tone="success" title="Invoice updated">{success}</InlineAlert>:null}
  {optionsLoading?<LoadingState label="Loading legal entities, customers, catalog and approved tax rules…"/>:null}
  <div className="invoice-workspace-summary"><strong>{loading?"Loading invoices…":total+" "+(total===1?"invoice":"invoices")}</strong><span>Outstanding is based on recorded allocations. Draft, issue and payment status are separate.</span></div>
  <div className="data-table-scroll"><table className="data-table"><thead><tr><th>Invoice</th><th>Customer</th><th>Status</th><th>Date</th><th>Total</th><th>Outstanding</th><th>Actions</th></tr></thead><tbody>
   {!loading&&!rows.length?<tr><td colSpan={7}><EmptyState title="No invoices found" description="Create a draft from approved customer and entity data. No sample financial totals are fabricated." icon="invoice"/></td></tr>:null}
   {rows.map(row=><tr key={row.id}><td><strong>{row.invoiceNumber||"Draft · "+row.id.slice(0,8)}</strong><div className="invoice-workspace-muted">{row.currency}</div></td><td>{row.customerName}</td><td><StatusBadge tone={row.lifecycleStatus==="ISSUED"?"success":row.lifecycleStatus==="CANCELLED"?"danger":"warning"}>{row.lifecycleStatus}</StatusBadge><div className="invoice-workspace-muted">{row.paymentStatus}</div></td><td>{row.invoiceDate||"Not dated"}</td><td>{currency(row.currency,row.grandTotal)}</td><td>{currency(row.currency,row.outstandingBalance)}</td><td><div className="master-data-actions"><Button variant="secondary" size="sm" disabled={saving||Boolean(issuing)} onClick={()=>void openInvoice(row.id)}>Details</Button>{row.lifecycleStatus==="DRAFT"&&canIssue?<Button size="sm" disabled={Boolean(issuing)} onClick={()=>void issue(row)}>{issuing===row.id?"Issuing…":"Issue"}</Button>:null}</div></td></tr>)}
  </tbody></table></div>
  <div className="master-data-pagination"><span>Showing {total===0?0:offset+1}–{Math.min(offset+rows.length,total)} of {total}</span><div><Button variant="secondary" size="sm" disabled={offset===0||loading} onClick={()=>setOffset(Math.max(0,offset-limit))}>Previous</Button><Button variant="secondary" size="sm" disabled={loading||offset+limit>=total} onClick={()=>setOffset(offset+limit)}>Next</Button></div></div>
  {selected&&!editor?<div className="invoice-editor">
   <div className="invoice-editor__heading"><div><p className="page-eyebrow">{selected.lifecycleStatus==="ISSUED"?"ISSUED DOCUMENT":"INVOICE DETAILS"}</p><h2>{selected.invoiceNumber||"Draft · "+selected.id.slice(0,8)}</h2><p>{selected.customerName} · {selected.lifecycleStatus} · {selected.paymentStatus}</p></div><Button variant="ghost" onClick={()=>setSelected(null)}>Close details</Button></div>
   {selected.lifecycleStatus==="ISSUED"?<InlineAlert tone="warning" title="Issued financial record is immutable">Amounts and line descriptions cannot be edited after issuance. Use an approved correction workflow for changes.</InlineAlert>:null}
    <InvoiceCorrectionPanel invoiceId={selected.id} lifecycleStatus={selected.lifecycleStatus} documentType={selected.documentType} canRequest={canUpdate} canReview={permissions.includes("approvals:read")} />
   <div className="invoice-editor__calculation">
    <div><span>Subtotal (net of tax)</span><strong>{currency(selected.currency,selected.subtotal)}</strong></div>
    <div><span>Discount total</span><strong>− {currency(selected.currency,selected.discountTotal)}</strong></div>
    <div><span>Taxable value</span><strong>{currency(selected.currency,selected.taxableValue)}</strong></div>
    <div><span>Tax</span><strong>{currency(selected.currency,selected.taxTotal)}</strong></div>
    <div className="invoice-editor__grand"><span>Grand total</span><strong>{currency(selected.currency,selected.grandTotal)}</strong></div>
    <div><span>Paid</span><strong>{currency(selected.currency,selected.paidAmount)}</strong></div>
    <div className="invoice-editor__grand"><span>Outstanding</span><strong>{currency(selected.currency,selected.outstandingBalance)}</strong></div>
   </div>
   {Array.isArray(selected.lines)&&selected.lines.length?<div className="data-table-scroll"><table className="data-table"><thead><tr><th>Line</th><th>Milestone</th><th>Qty</th><th>Unit rate</th><th>Discount</th><th>Tax</th><th>Total</th></tr></thead><tbody>{selected.lines.map((v,index)=>{const l=record(v);return <tr key={str(l.id)||index}><td><strong>{str(l.description)}</strong><div className="invoice-workspace-muted">{str(l.unitCode)} · {str(l.lineKind)}</div></td><td>{str(l.milestone)||"—"}</td><td>{str(l.quantity)}</td><td>{currency(selected.currency,str(l.unitPrice))}</td><td>{str(l.discountType)==="PERCENT"?str(l.discountValue)+"%":currency(selected.currency,str(l.discountValue))}</td><td>{currency(selected.currency,str(l.taxAmount))}{str(l.taxCode)?" · "+str(l.taxCode):""}</td><td>{currency(selected.currency,str(l.lineTotal))}</td></tr>;})}</tbody></table></div>:<p className="form-hint">No line details returned.</p>}
    {selected.lifecycleStatus!=="DRAFT"?<DocumentHistoryPanel sourceType="INVOICE" sourceId={selected.id}/>:null}
     {selected.lifecycleStatus==="ISSUED"?<EmailDeliveryPanel sourceType="INVOICE" sourceId={selected.id}/>:null}
   <div className="invoice-editor__actions">{selected.lifecycleStatus==="DRAFT"&&canUpdate?<Button variant="secondary" onClick={()=>{setEditor(true);setDirty(false);}}>Edit draft</Button>:null}{selected.lifecycleStatus==="DRAFT"&&canIssue?<Button disabled={Boolean(issuing)} onClick={()=>void issue(selected)}>{issuing===selected.id?"Issuing…":"Issue invoice"}</Button>:null}</div>
      <section className="master-data-panel" aria-labelledby="invoice-payments-title">
     <div className="master-data-panel__heading"><div><h3 id="invoice-payments-title">Payments and receipts</h3><p>Paid/outstanding values are calculated from recorded allocations. Reversals preserve their ledger history.</p></div><Link href="/payments">Open payment ledger</Link></div>
     <div className="invoice-editor__calculation"><div><span>Paid</span><strong>{currency(selected.currency,selected.paidAmount)}</strong></div><div className="invoice-editor__grand"><span>Outstanding</span><strong>{currency(selected.currency,selected.outstandingBalance)}</strong></div></div>
     {!canReadPayments?<InlineAlert tone="warning" title="Payment history access is not assigned">Assign payments:read to this account to view payment history.</InlineAlert>:null}
     {canReadPayments&&paymentHistoryLoading?<LoadingState label="Loading payment history…"/>:null}
     {canReadPayments&&!paymentHistoryLoading?<div className="data-table-scroll"><table className="data-table"><thead><tr><th>Receipt</th><th>Date / method</th><th>Amount</th><th>Allocated</th><th>Status</th><th>Reversal</th><th>Action</th></tr></thead><tbody>
      {!paymentHistory.length?<tr><td colSpan={7}><EmptyState title="No payments recorded" description="Record a payment when funds are received. Each receipt and allocation will appear here."/></td></tr>:null}
      {paymentHistory.map(payment=><tr key={payment.id}><td><strong>{payment.receiptReference}</strong>{payment.allocationCount>1?<div className="invoice-workspace-muted">{payment.allocationCount} allocation chunks</div>:null}</td><td>{payment.paymentDate||"—"} · {payment.method}</td><td>{currency(payment.currency,payment.amount)}</td><td>{currency(payment.currency,payment.allocatedAmount)}</td><td><StatusBadge tone={payment.status==="RECORDED"?"success":"danger"}>{payment.status}</StatusBadge></td><td>{payment.reversalReason||"—"}</td><td>{canReversePayment&&payment.status==="RECORDED"?<Button size="sm" variant="danger" disabled={saving||Boolean(reversingPaymentId)} onClick={()=>{setReversingPaymentId(payment.id);setReversalReason("");setReversalKey(crypto.randomUUID()+crypto.randomUUID());}}>Reverse full receipt</Button>:null}</td></tr>)}
     </tbody></table></div>:null}
     {canRecordPayment&&selected.lifecycleStatus==="ISSUED"&&selected.outstandingBalance!=="0.0000"?<section className="master-data-panel master-data-panel--narrow" aria-labelledby="invoice-record-payment-title">
      <div className="master-data-panel__heading"><div><h4 id="invoice-record-payment-title">Record payment against this invoice</h4><p>Creates a receipt and fully allocates it to this issued invoice. For standalone or partial receipts, use the payment ledger.</p></div></div>
      <form onSubmit={recordInvoicePayment}><div className="invoice-form-grid">
       <div className="invoice-form-field"><label className="form-label" htmlFor="invoice-payment-amount">Amount</label><input id="invoice-payment-amount" className="form-control" required inputMode="decimal" value={paymentForm.amount} onChange={e=>updatePaymentForm("amount",e.target.value)} placeholder="0.0000"/></div>
       <div className="invoice-form-field"><label className="form-label" htmlFor="invoice-payment-date">Payment date</label><input id="invoice-payment-date" className="form-control" type="date" required value={paymentForm.paymentDate} onChange={e=>updatePaymentForm("paymentDate",e.target.value)}/></div>
       <div className="invoice-form-field"><label className="form-label" htmlFor="invoice-payment-method">Method</label><select id="invoice-payment-method" className="form-control" value={paymentForm.method} onChange={e=>updatePaymentForm("method",e.target.value)}><option value="BANK_TRANSFER">Bank transfer</option><option value="CASH">Cash</option><option value="UPI">UPI</option><option value="CARD">Card</option><option value="CHEQUE">Cheque</option><option value="OTHER">Other</option></select></div>
       <div className="invoice-form-field"><label className="form-label" htmlFor="invoice-payment-reference">Reference (optional)</label><input id="invoice-payment-reference" className="form-control" maxLength={160} value={paymentForm.reference} onChange={e=>updatePaymentForm("reference",e.target.value)}/></div>
       <div className="invoice-form-field invoice-form-field--wide"><label className="form-label" htmlFor="invoice-payment-notes">Notes (optional)</label><textarea id="invoice-payment-notes" className="form-control form-control--textarea" maxLength={2000} value={paymentForm.notes} onChange={e=>updatePaymentForm("notes",e.target.value)}/></div>
      </div><p className="form-hint">Outstanding limit: {currency(selected.currency,selected.outstandingBalance)}. The server validates amount and concurrent changes.</p>
      <div className="invoice-editor__actions"><Button type="submit" disabled={saving}>{saving?"Recording payment…":"Record and allocate payment"}</Button></div></form>
     </section>:null}
     {reversingPaymentId&&canReversePayment?<section className="master-data-panel master-data-panel--narrow" aria-labelledby="invoice-payment-reversal-title"><div className="master-data-panel__heading"><div><h4 id="invoice-payment-reversal-title">Reverse entire receipt?</h4><p>This is a full receipt reversal. If the receipt is linked to multiple invoices, all its allocations are reversed.</p></div></div>
      <form onSubmit={reverseInvoicePayment}><div className="invoice-form-field"><label className="form-label" htmlFor="invoice-payment-reversal-reason">Reason (required)</label><textarea id="invoice-payment-reversal-reason" className="form-control form-control--textarea" required minLength={3} maxLength={1000} value={reversalReason} onChange={e=>{setReversalReason(e.target.value);setReversalKey(crypto.randomUUID()+crypto.randomUUID());}}/></div>
       <div className="invoice-editor__actions"><Button type="button" variant="secondary" disabled={saving} onClick={()=>setReversingPaymentId("")}>Keep receipt</Button><Button type="submit" variant="danger" disabled={saving||reversalReason.trim().length<3}>{saving?"Reversing…":"Confirm full reversal"}</Button></div>
      </form>
     </section>:null}
    </section>
</div>:null}
  {editor?<div className="invoice-editor">
   <div className="invoice-editor__heading"><div><p className="page-eyebrow">{selected?"DRAFT EDITOR":"NEW INVOICE"}</p><h2>{selected?"Edit invoice draft":"Create invoice"}</h2><p>Choose the brand, enter the customer and invoice details, then save or issue and send.</p></div><Button variant="ghost" onClick={()=>setEditor(false)}>Close</Button></div>
   {selectedEntity&& !["APPROVED_CONFIGURED","APPROVED_NOT_APPLICABLE"].includes(selectedEntity.taxSetupStatus)?<InlineAlert tone="warning" title="This brand is not ready to issue invoices yet">The one-time tax/company approval still needs completing in Settings. You can save a draft here; issuance remains blocked until it is approved.</InlineAlert>:null}
   <form id="invoice-composer-form" onSubmit={e=>void save(e)}>
    <div className="invoice-composer-brand">
     <div className="invoice-composer-brand__picker">
      <label className="form-label" htmlFor="invoice-brand">Invoice from</label>
      <select id="invoice-brand" required className="form-control" disabled={Boolean(selected)} value={form.brandId} onChange={e=>chooseBrand(e.target.value)}>
       <option value="">Choose brand</option>{validBrands.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}
      </select>
      {selectedBrand?<div className="invoice-composer-brand__issuer"><Image src={logoForBrand(selectedBrand)} alt={selectedBrand.name+" logo"} width={144} height={48} unoptimized/><div><strong>{selectedBrand.name}</strong><span>Issued by {selectedBrand.legalEntityName} · {selectedBrand.currency}</span></div></div>:<p className="form-hint">Choose MyFX POS, FX Digitech or FX Coworks. The approved issuer and template are selected automatically.</p>}
     </div>
     <div className="invoice-composer-brand__meta"><span>INVOICE DATE</span><input className="form-control" aria-label="Invoice date" type="date" required value={form.invoiceDate} onChange={e=>updateForm("invoiceDate",e.target.value)}/><label className="form-label" htmlFor="invoice-due-date">Due date (optional)</label><input id="invoice-due-date" className="form-control" type="date" min={form.invoiceDate||undefined} value={form.dueDate} onChange={e=>updateForm("dueDate",e.target.value)}/></div>
    </div>
    <div className="invoice-form-grid">
     <Field label={customerMode==="new"?"Customer / company name":"Customer"}>
      {customerMode==="existing"?<select required className="form-control" value={form.customerId} onChange={e=>{if(e.target.value==="__new__"&&canAddCustomer){setCustomerMode("new");setForm(old=>({...old,customerId:""}));setQuickCustomer({name:"",phone:"",line1:"",city:"",state:"",postalCode:"",countryCode:"IN"});setRecipientEmail("");return;}const item=options.customers.find(x=>x.id===e.target.value);setForm(old=>({...old,customerId:e.target.value,paymentTermsDays:String(item?.paymentTermsDays??old.paymentTermsDays)}));setRecipientEmail(item?.email??"");setEmailKey(crypto.randomUUID());setDirty(true);setCreateKey(crypto.randomUUID()+crypto.randomUUID());}}><option value="">Choose customer</option>{options.customers.map(x=><option key={x.id} value={x.id}>{x.name}{x.customerCode?" · "+x.customerCode:""}</option>)}{canAddCustomer?<option value="__new__">+ Add new customer…</option>:null}</select>:<input className="form-control" required maxLength={255} value={quickCustomer.name} onChange={e=>updateQuickCustomer("name",e.target.value)} placeholder="Company or person's full name"/>}
     </Field>
     {customerMode==="new"?<Field label="Phone (optional)"><input className="form-control" autoComplete="tel" maxLength={50} value={quickCustomer.phone} onChange={e=>updateQuickCustomer("phone",e.target.value)}/></Field>:<Field label="Currency"><input className="form-control" readOnly aria-readonly="true" value={form.currency||"—"}/></Field>}
     <Field label="Email to send the invoice to" wide hint="Use the customer’s usual billing address or enter a different recipient for this invoice. Email is sent only after you choose Issue & send invoice."><input type="email" className="form-control" maxLength={320} autoComplete="email" placeholder="billing@company.com" value={recipientEmail} onChange={e=>{setRecipientEmail(e.target.value);setEmailKey(crypto.randomUUID());}}/></Field>
     {customerMode==="new"?<><Field label="Billing address (optional)"><input className="form-control" maxLength={255} placeholder="Street / building" value={quickCustomer.line1} onChange={e=>updateQuickCustomer("line1",e.target.value)}/></Field><Field label="City"><input className="form-control" maxLength={255} value={quickCustomer.city} onChange={e=>updateQuickCustomer("city",e.target.value)}/></Field><Field label="State"><input className="form-control" maxLength={255} value={quickCustomer.state} onChange={e=>updateQuickCustomer("state",e.target.value)}/></Field><Field label="Postal code"><input className="form-control" maxLength={255} value={quickCustomer.postalCode} onChange={e=>updateQuickCustomer("postalCode",e.target.value)}/></Field><Field label="Country"><select className="form-control" value={quickCustomer.countryCode} onChange={e=>updateQuickCustomer("countryCode",e.target.value)}><option value="IN">India</option><option value="US">United States</option><option value="GB">United Kingdom</option><option value="AE">United Arab Emirates</option><option value="SG">Singapore</option><option value="">Other / not set</option></select></Field><div className="invoice-form-field invoice-form-field--wide"><button type="button" className="invoice-inline-link" onClick={()=>{setCustomerMode("existing");setQuickCustomer({name:"",phone:"",line1:"",city:"",state:"",postalCode:"",countryCode:"IN"});}}>Choose an existing customer instead</button></div></>:null}
     <Field label="Notes (optional)" wide><textarea className="form-control form-control--textarea" maxLength={5000} value={form.notes} onChange={e=>updateForm("notes",e.target.value)} placeholder="Reference or short note for this invoice"/></Field>
    </div>
    <div className="invoice-line-list-heading"><div><h3>Items / services</h3><p className="form-hint">Enter the description, quantity and rate. Milestone is optional and appears on the invoice.</p></div><Button type="button" variant="secondary" disabled={lines.length>=500} onClick={()=>{setLines(old=>[...old,freshLine(selectedBrand?.defaultTaxCode??"")]);setDirty(true);setCreateKey(crypto.randomUUID()+crypto.randomUUID());}}>+ Add item</Button></div>
    {lines.map((line,index)=><div className="invoice-line-card invoice-line-card--simple" key={line.key}>
     <div className="invoice-line-card__head"><strong>Item {index+1}</strong>{lines.length>1?<Button type="button" size="sm" variant="ghost" onClick={()=>{setLines(old=>old.filter(x=>x.key!==line.key));setDirty(true);setCreateKey(crypto.randomUUID()+crypto.randomUUID());}}>Remove</Button>:null}</div>
     <div className="invoice-line-grid invoice-line-grid--simple">
      <Field label="Milestone (optional)"><input className="form-control" maxLength={160} placeholder="e.g. Milestone 1" value={line.milestone} onChange={e=>updateLine(line.key,{milestone:e.target.value})}/></Field>
      <Field label="Description" wide><input className="form-control" required maxLength={1000} placeholder="What are you billing for?" value={line.description} onChange={e=>updateLine(line.key,{description:e.target.value})}/></Field>
      <Field label="Quantity"><input className="form-control" required inputMode="decimal" value={line.quantity} onChange={e=>updateLine(line.key,{quantity:e.target.value})}/></Field>
      <Field label={"Rate ("+(form.currency||"currency")+")"}><input className="form-control" required inputMode="decimal" value={line.unitPrice} onChange={e=>updateLine(line.key,{unitPrice:e.target.value})}/></Field>
     </div>
     <details className="invoice-line-advanced"><summary>Discount, tax and catalog (optional)</summary><div className="invoice-line-grid" style={{marginTop:12}}>
      <Field label="Catalog item (optional)"><select className="form-control" value={line.catalogItemId} onChange={e=>{const item=options.catalogItems.find(x=>x.id===e.target.value);updateLine(line.key,item?{catalogItemId:item.id,description:item.name,unitCode:item.unitCode,unitPrice:item.defaultUnitPrice,taxCode:item.defaultTaxCode??selectedBrand?.defaultTaxCode??""}:{catalogItemId:""});}}><option value="">Manual line</option>{options.catalogItems.filter(x=>x.currency===form.currency).map(x=><option key={x.id} value={x.id}>{x.itemCode?x.itemCode+" · ":""}{x.name}</option>)}</select></Field>
      <Field label="Unit"><input className="form-control" required maxLength={40} value={line.unitCode} onChange={e=>updateLine(line.key,{unitCode:e.target.value})}/></Field>
      <Field label="Discount type"><select className="form-control" value={line.discountType} onChange={e=>updateLine(line.key,{discountType:e.target.value as DiscountType})}><option value="AMOUNT">Fixed amount</option><option value="PERCENT">Percent</option></select></Field>
      <Field label={line.discountType==="PERCENT"?"Discount (%)":"Discount amount"}><input className="form-control" required inputMode="decimal" value={line.discountValue} onChange={e=>updateLine(line.key,{discountValue:e.target.value})}/></Field>
      <Field label="Approved tax code"><select className="form-control" value={line.taxCode} onChange={e=>updateLine(line.key,{taxCode:e.target.value})}><option value="">No tax code</option>{rules.map(r=><option key={r.id} value={r.taxCode}>{r.taxCode} · {r.ratePercent}%</option>)}</select></Field>
     </div></details>
    </div>)}
    <div className="invoice-editor__calculation">
     {dirty?<p>Unsaved changes. Save the draft to display server-calculated totals.</p>:selected?<><div><span>Subtotal (net of tax)</span><strong>{currency(form.currency,selected.subtotal)}</strong></div><div><span>Discount total</span><strong>− {currency(form.currency,selected.discountTotal)}</strong></div><div><span>Taxable value</span><strong>{currency(form.currency,selected.taxableValue)}</strong></div><div><span>Tax</span><strong>{currency(form.currency,selected.taxTotal)}</strong></div><div className="invoice-editor__grand"><span>Grand total</span><strong>{currency(form.currency,selected.grandTotal)}</strong></div><div><span>Paid</span><strong>{currency(form.currency,selected.paidAmount)}</strong></div><div className="invoice-editor__grand"><span>Outstanding</span><strong>{currency(form.currency,selected.outstandingBalance)}</strong></div></>:<p>Totals appear after the server accepts and calculates this draft.</p>}
    </div>
    <div className="invoice-editor__actions"><Button type="button" variant="secondary" disabled={saving} onClick={()=>setEditor(false)}>Cancel</Button><Button type="submit" disabled={saving||optionsLoading||(!selected&&!canCreate)||(Boolean(selected)&&!canUpdate)}>{saving?"Saving…":"Save draft"}</Button>{canIssue&&canSendEmail?<Button type="button" disabled={saving||optionsLoading||!recipientEmail.trim()||(!selected&&!canCreate)||(Boolean(selected)&&!canUpdate)} onClick={()=>{const formElement=document.getElementById("invoice-composer-form") as HTMLFormElement|null;if(formElement?.reportValidity())void save(undefined,true);}}>{saving?"Processing…":"Issue & send invoice"}</Button>:canIssue&&selected?.lifecycleStatus==="DRAFT"?<Button type="button" disabled={saving||Boolean(issuing)} onClick={()=>void issue(selected)}>{issuing===selected.id?"Issuing…":"Issue invoice"}</Button>:null}</div>
   </form>
  </div>:null}
 </div>;
}
