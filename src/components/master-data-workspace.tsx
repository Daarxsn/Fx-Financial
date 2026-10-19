"use client";

import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, type FormEvent, type RefObject } from "react";
import { Button, InlineAlert, StatusBadge } from "@/components/ui";

type Resource = "customers" | "catalog";
type Row = Record<string, unknown> & { id: string; recordVersion?: number; isActive?: boolean };
type Permissions = string[];
type ImportError = { rowNumber: number; field?: string; message: string };
type ImportWarning = { rowNumber: number; matches: Array<{ id?: string; name: string; itemCode?: string | null; customerCode?: string | null; matchOn?: string[] }> };
type ImportReport = { mode?: string; valid?: boolean; rowCount?: number; validRows?: number; createdCount?: number; errors: ImportError[]; duplicateWarnings: ImportWarning[] };
type ContactDraft = { fullName: string; jobTitle: string; email: string; phone: string };
type TaxDraft = { identifierType: string; countryCode: string; jurisdiction: string; identifierValue: string };
const emptyContact = (): ContactDraft => ({fullName:"",jobTitle:"",email:"",phone:""});
const emptyTax = (): TaxDraft => ({identifierType:"OTHER",countryCode:"",jurisdiction:"",identifierValue:""});
type ApiPayload = { data?: unknown; report?: unknown; error?: { code?: string; message?: string; fields?: Record<string,string> }; duplicateWarnings?: Array<{id:string;name:string;itemCode?:string|null;customerCode?:string|null;matchOn?:string[]}>; meta?: { pagination?: { limit:number; offset:number; total:number; hasMore:boolean } } };
type FieldErrors = Record<string,string>;
type FieldConfig = { key:string; label:string; type?:"text"|"email"|"number"|"textarea"; required?:boolean; placeholder?:string; help?:string };
const customerFields: FieldConfig[] = [
  {key:"customerCode",label:"Customer code",help:"Optional. Must be unique when supplied."},
  {key:"name",label:"Customer / legal name",required:true},
  {key:"email",label:"Billing email",type:"email"},
  {key:"phone",label:"Phone"},
  {key:"purchaseOrderReference",label:"Default PO / reference"},
  {key:"paymentTermsDays",label:"Payment terms (days)",type:"number",help:"Leave blank until approved terms are configured; 0 means due immediately."},
  {key:"taxIdentifier",label:"Primary tax identifier",help:"Legacy primary identifier; registration validity is not inferred."},
];
const catalogFields: FieldConfig[] = [
  {key:"itemCode",label:"SKU / service code",help:"Optional, but unique when supplied."},
  {key:"name",label:"Item / service name",required:true},
  {key:"unitCode",label:"Unit of measure",required:true,placeholder:"unit, hour, month…"},
  {key:"defaultUnitPrice",label:"Default unit price",required:true,help:"Exact decimal, up to four fractional digits."},
  {key:"currency",label:"Currency (ISO 4217)",required:true,placeholder:"Approved currency code"},
  {key:"defaultTaxCode",label:"Default tax code",help:"A code from approved configuration only; no rate is inferred."},
];
const emptyForm = (resource:Resource):Record<string,string> => resource==="customers"
  ? {customerCode:"",name:"",email:"",phone:"",purchaseOrderReference:"",paymentTermsDays:"",taxIdentifier:"",
     billLine1:"",billLine2:"",billCity:"",billState:"",billPostalCode:"",billCountryCode:"",
     shipLine1:"",shipLine2:"",shipCity:"",shipState:"",shipPostalCode:"",shipCountryCode:"",notes:""}
  : {itemCode:"",itemType:"",name:"",customerDescription:"",internalDescription:"",unitCode:"",
     defaultUnitPrice:"",currency:"",defaultTaxCode:""};
function str(value:unknown):string { return typeof value==="string"||typeof value==="number" ? String(value) : ""; }
function obj(value:unknown):Record<string,unknown> { return value&&typeof value==="object"&&!Array.isArray(value)?value as Record<string,unknown>:{}; }
function rowData(payload:ApiPayload):Row[] { return Array.isArray(payload.data)?payload.data.filter((v):v is Row=>Boolean(v)&&typeof v==="object"&&"id" in v) as Row[]:[]; }
function valueOf(row:Row,key:string):string { return str(row[key]); }
function addressValue(record:Row,key:string,field:string):string { return str(obj(record[key])[field]); }
function recordToForm(resource:Resource,record:Row):Record<string,string>{
  const form={...emptyForm(resource)};
  if(resource==="catalog"){
    for(const f of catalogFields)form[f.key]=valueOf(record,f.key);
    form.itemType=valueOf(record,"itemType")||"SERVICE";
    form.customerDescription=valueOf(record,"customerDescription");
    form.internalDescription=valueOf(record,"internalDescription");
    return form;
  }
  for(const f of customerFields)form[f.key]=valueOf(record,f.key);
  for(const [prefix,key] of [["bill","billingAddress"],["ship","shippingAddress"]] as const){
    for(const [from,to] of [["line1","Line1"],["line2","Line2"],["city","City"],["state","State"],["postalCode","PostalCode"],["countryCode","CountryCode"]] as const)
      form[prefix+to]=addressValue(record,key,from);
  }
  form.notes=str(record.notes);
  return form;
}
// Wires a control to its hint and server error so assistive technology announces both.
function describedBy(id:string,errors:FieldErrors,hint?:boolean){
  const ids=[hint?id+"-hint":"",errors[id]?id+"-error":""].filter(Boolean).join(" ");
  return {"aria-invalid":errors[id]?true:undefined,"aria-describedby":ids||undefined};
}
function FieldError({id,errors}:{id:string;errors:FieldErrors}){
  return errors[id]?<p className="form-error" id={id+"-error"}>{errors[id]}</p>:null;
}
function fieldControl(field:FieldConfig,value:string,onChange:(value:string)=>void,errors:FieldErrors={}){
  const a11y=describedBy(field.key,errors,Boolean(field.help));
  if(field.type==="textarea")return <textarea className="form-control form-control--textarea" id={field.key} value={value} onChange={e=>onChange(e.target.value)} required={field.required} {...a11y}/>;
  return <input className="form-control" id={field.key} type={field.type==="number"?"number":field.type??"text"} min={field.type==="number"?0:undefined} max={field.type==="number"?65535:undefined} step={field.type==="number"?1:undefined} value={value} onChange={e=>onChange(e.target.value)} required={field.required} placeholder={field.placeholder} {...a11y}/>;
}
// Maps a server field path (e.g. "billingAddress.countryCode", "contacts.0.email") to the form control id.
function controlIdForField(path:string,contactIndexes:number[],taxIndexes:number[]):string{
  const [head,second,third]=path.split(".");
  const address:Record<string,string>={line1:"Line1",line2:"Line2",city:"City",state:"State",postalCode:"PostalCode",countryCode:"CountryCode"};
  if(head==="billingAddress"&&second)return "bill"+(address[second]??"Line1");
  if(head==="shippingAddress"&&second)return "ship"+(address[second]??"Line1");
  if(head==="contacts"&&third)return `contact-${contactIndexes[Number(second)]??0}-${third}`;
  if(head==="taxIdentifiers"&&third)return `tax-${taxIndexes[Number(second)]??0}-${third}`;
  if(head==="notes")return "customerNotes";
  return head;
}
// Moves focus into a panel when it opens, closes it on Escape, optionally traps Tab (modal dialogs only)
// and returns focus to the control that opened it.
function useDialogFocus(open:boolean,ref:RefObject<HTMLElement|null>,onClose:()=>void,trap:boolean){
  const onCloseRef=useRef(onClose);
  useEffect(()=>{onCloseRef.current=onClose;},[onClose]);
  useEffect(()=>{
    if(!open)return;
    const previous=document.activeElement instanceof HTMLElement?document.activeElement:null;
    const selector='a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])';
    const first=ref.current?.querySelector<HTMLElement>("input:not(:disabled), select:not(:disabled), textarea:not(:disabled)")??ref.current?.querySelector<HTMLElement>(selector);
    first?.focus();
    const onKeyDown=(event:KeyboardEvent)=>{
      if(event.key==="Escape"){event.preventDefault();onCloseRef.current();return;}
      if(!trap||event.key!=="Tab")return;
      const focusable=ref.current?.querySelectorAll<HTMLElement>(selector);
      if(!focusable?.length){event.preventDefault();return;}
      const firstItem=focusable[0];const last=focusable[focusable.length-1];
      if(event.shiftKey&&document.activeElement===firstItem){event.preventDefault();last.focus();}
      else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();firstItem.focus();}
    };
    document.addEventListener("keydown",onKeyDown);
    return ()=>{document.removeEventListener("keydown",onKeyDown);if(previous?.isConnected)previous.focus();};
  },[open,ref,trap]);
}
function countText(value:unknown):string{return value===null?"Restricted":value===undefined?"—":str(value)||"0";}
function referenceSummary(resource:Resource,counts:unknown):string{
  const c=obj(counts);
  return resource==="customers"
    ?`Invoices: ${countText(c.invoices)} · Quotations: ${countText(c.quotations)} · Payments: ${countText(c.payments)}`
    :`Invoice lines: ${countText(c.invoiceLines)} · Quotation lines: ${countText(c.quotationLines)}`;
}
function fieldValue(form:Record<string,string>,key:string){return form[key]??"";}
function makeAddress(form:Record<string,string>,prefix:"bill"|"ship"){
 const pairs=[["line1","Line1"],["line2","Line2"],["city","City"],["state","State"],["postalCode","PostalCode"],["countryCode","CountryCode"]] as const;
 const address:Record<string,string>={};
 for(const [target,source] of pairs){const value=form[prefix+source]?.trim();if(value)address[target]=source==="CountryCode"?value.toUpperCase():value;}
 return Object.keys(address).length?address:undefined;
}

export function MasterDataWorkspace({resource}:{resource:Resource}){
 const [query,setQuery]=useState("");const deferredQuery=useDeferredValue(query);
 const [status,setStatus]=useState("active");const [offset,setOffset]=useState(0);const limit=25;
 const [records,setRecords]=useState<Row[]>([]);const [pagination,setPagination]=useState({total:0,hasMore:false});const refreshGeneration=useRef(0);
 const [permissions,setPermissions]=useState<Permissions>([]);
 const [importFile,setImportFile]=useState<File|null>(null);const [importReport,setImportReport]=useState<ImportReport|null>(null);const [importValidationToken,setImportValidationToken]=useState<string|null>(null);
 const [importBusy,setImportBusy]=useState(false);const [confirmImportDuplicates,setConfirmImportDuplicates]=useState(false);const [fileInputKey,setFileInputKey]=useState(0);
 const [loading,setLoading]=useState(true);const [saving,setSaving]=useState(false);const [error,setError]=useState("");const [fieldErrors,setFieldErrors]=useState<FieldErrors>({});
 const [success,setSuccess]=useState("");const [warnings,setWarnings]=useState<ApiPayload["duplicateWarnings"]>([]);
 const [form,setForm]=useState<Record<string,string>>(emptyForm(resource));
 const [contactDrafts,setContactDrafts]=useState<ContactDraft[]>([emptyContact()]);
 const [taxDrafts,setTaxDrafts]=useState<TaxDraft[]>([emptyTax()]);
 const [editorOpen,setEditorOpen]=useState(false);const [editing,setEditing]=useState<Row|null>(null);
 const [detail,setDetail]=useState<Row|null>(null);const [detailLoading,setDetailLoading]=useState(false);
 const [archiveTarget,setArchiveTarget]=useState<Row|null>(null);const [archiveReason,setArchiveReason]=useState("");
 const editorPanelRef=useRef<HTMLElement|null>(null);
 const archivePanelRef=useRef<HTMLElement|null>(null);
 useDialogFocus(editorOpen,editorPanelRef,()=>setEditorOpen(false),false);
 useDialogFocus(Boolean(archiveTarget),archivePanelRef,()=>{setArchiveTarget(null);setArchiveReason("");},false);

 const title=resource==="customers"?"Customers":"Items & services";
 const canCreate=permissions.includes(resource==="customers"?"customers:create":"catalog:create");
 const canUpdate=permissions.includes(resource==="customers"?"customers:update":"catalog:update");
 const canArchive=permissions.includes(resource==="customers"?"customers:archive":"catalog:archive");
 const basePath=resource==="customers"?"/api/v1/customers":"/api/v1/catalog/items";

 const request=useCallback(async(url:string,init:RequestInit={}):Promise<{response:Response;body:ApiPayload}>=>{
  const response=await fetch(url,{...init,cache:"no-store",headers:{"Accept":"application/json",...(init.body?{"Content-Type":"application/json"}:{}),...(init.headers??{})}});
  let body:ApiPayload={};try{body=await response.json() as ApiPayload;}catch{/* safe fallback handled below */}
  return {response,body};
 },[]);

 const refresh=useCallback(async()=>{
  const generation=++refreshGeneration.current;setLoading(true);setError("");
  try{
   const [list,profile]=await Promise.all([
    request(`${basePath}?query=${encodeURIComponent(deferredQuery)}&status=${encodeURIComponent(status)}&limit=${limit}&offset=${offset}`),
    fetch("/api/v1/auth/me",{cache:"no-store"}).then(async r=>({ok:r.ok,body:await r.json() as {data?:{user?:{permissions?:string[]}}}})),
   ]);
   if(generation!==refreshGeneration.current)return;
  if(!list.response.ok)throw new Error(list.body.error?.message??"Could not load records.");
   setRecords(rowData(list.body));const p=list.body.meta?.pagination??{total:0,hasMore:false};
   setPagination({total:Number(p.total??0),hasMore:Boolean(p.hasMore)});
   setPermissions(profile.ok?profile.body.data?.user?.permissions??[]:[]);
  }catch(e){if(generation===refreshGeneration.current)setError(e instanceof Error?e.message:"Could not load records.");}
  finally{if(generation===refreshGeneration.current)setLoading(false);}
 },[basePath,deferredQuery,status,offset,request]);
 useEffect(()=>{Promise.resolve().then(()=>refresh());},[refresh]);

 const openCreate=()=>{setEditing(null);setForm(emptyForm(resource));setContactDrafts([emptyContact()]);setTaxDrafts([emptyTax()]);setWarnings([]);setError("");setFieldErrors({});setSuccess("");setDetail(null);setEditorOpen(true);};
 const openDetails=async(id:string)=>{
  setDetailLoading(true);setError("");
  try{const r=await request(basePath+"/"+id);if(!r.response.ok)throw new Error(r.body.error?.message??"Could not load record.");setDetail(obj(r.body.data) as Row);}
  catch(e){setError(e instanceof Error?e.message:"Could not load record.");}
  finally{setDetailLoading(false);}
 };
 const openEdit=async(row:Row)=>{
  setSaving(true);setError("");setFieldErrors({});setWarnings([]);
  try{const r=await request(basePath+"/"+row.id);if(!r.response.ok)throw new Error(r.body.error?.message??"Could not load record to edit.");
   const full=obj(r.body.data) as Row;setDetail(full);setEditing(full);setForm(recordToForm(resource,full));
   setContactDrafts(resource==="customers"&&Array.isArray(full.contacts)&&full.contacts.length?full.contacts.map(v=>({fullName:str(obj(v).fullName),jobTitle:str(obj(v).jobTitle),email:str(obj(v).email),phone:str(obj(v).phone)})):[emptyContact()]);
   setTaxDrafts(resource==="customers"&&Array.isArray(full.taxIdentifiers)&&full.taxIdentifiers.length?full.taxIdentifiers.map(v=>({identifierType:str(obj(v).identifierType)||"OTHER",countryCode:str(obj(v).countryCode),jurisdiction:str(obj(v).jurisdiction),identifierValue:str(obj(v).identifierValue)})):[emptyTax()]);setEditorOpen(true);setSuccess("");
  }catch(e){setError(e instanceof Error?e.message:"Could not load record.");}
  finally{setSaving(false);}
 };

 const getCsrf=async()=>{
  const r=await fetch("/api/v1/auth/csrf",{cache:"no-store"});const body=await r.json() as {data?:{csrfToken?:string}};
  if(!r.ok||!body.data?.csrfToken)throw new Error("Could not validate this request. Refresh and try again.");
  return body.data.csrfToken;
 };
 const mutate=async(url:string,method:string,payload:unknown)=>{
  const csrf=await getCsrf();
  return request(url,{method,headers:{"X-CSRF-Token":csrf},body:JSON.stringify(payload)});
 };
 const save=async(event:FormEvent<HTMLFormElement>)=>{
  event.preventDefault();
 const contactIndexes=contactDrafts.map((v,i)=>v.fullName.trim()?i:-1).filter(i=>i>=0);
 const taxIndexes=taxDrafts.map((v,i)=>v.identifierValue.trim()?i:-1).filter(i=>i>=0);
 setSaving(true);setError("");setFieldErrors({});setSuccess("");setWarnings([]);
  try{
   let payload:Record<string,unknown>;
   if(resource==="customers"){
    const contacts=contactDrafts.filter(v=>v.fullName.trim()).map((v,i)=>({fullName:v.fullName.trim(),jobTitle:v.jobTitle.trim(),email:v.email.trim(),phone:v.phone.trim(),isPrimary:i===0}));
    const taxIdentifiers=taxDrafts.filter(v=>v.identifierValue.trim()).map(v=>({identifierType:v.identifierType.trim()||"OTHER",countryCode:v.countryCode.trim().toUpperCase(),jurisdiction:v.jurisdiction.trim(),identifierValue:v.identifierValue.trim()}));
    payload={customerCode:form.customerCode.trim(),name:form.name.trim(),email:form.email.trim(),phone:form.phone.trim(),
      purchaseOrderReference:form.purchaseOrderReference.trim(),contacts};
    if(form.paymentTermsDays.trim())payload.paymentTermsDays=Number(form.paymentTermsDays);else if(editing)payload.paymentTermsDays=null;
    if(permissions.includes("settings:manage")){
      payload.taxIdentifier=form.taxIdentifier.trim();
      payload.taxIdentifiers=taxIdentifiers;
      payload.notes=form.notes;
    }
    const billingAddress=makeAddress(form,"bill");const shippingAddress=makeAddress(form,"ship");
    if(billingAddress)payload.billingAddress=billingAddress;else if(editing)payload.billingAddress=null;
    if(shippingAddress)payload.shippingAddress=shippingAddress;else if(editing)payload.shippingAddress=null;
   }else{
    payload={itemCode:form.itemCode.trim(),itemType:form.itemType,name:form.name.trim(),
      customerDescription:form.customerDescription.trim(),internalDescription:form.internalDescription,
      unitCode:form.unitCode.trim(),defaultUnitPrice:form.defaultUnitPrice.trim(),currency:form.currency.trim().toUpperCase(),
      defaultTaxCode:form.defaultTaxCode.trim()};
   }
   if(editing)payload.expectedVersion=Number(editing.recordVersion);
   const url=editing?basePath+"/"+editing.id:basePath;
   const result=await mutate(url,editing?"PATCH":"POST",payload);
   if(!result.response.ok){
   const serverFields=result.body.error?.fields;
   if(serverFields){
    const mapped:FieldErrors={};
    for(const [serverPath,message] of Object.entries(serverFields)){
     const id=controlIdForField(serverPath,contactIndexes,taxIndexes);
     if(typeof message==="string"&&message)mapped[id]=message;
    }
    setFieldErrors(mapped);
   }
   throw new Error(result.body.error?.message??"The record could not be saved.");
  }
   setWarnings(result.body.duplicateWarnings??[]);
   const savedId=str(obj(result.body.data).id);setEditorOpen(false);setSuccess(editing?"Record updated. Any prior invoice/quotation snapshots remain unchanged.":"Record created.");
   await refresh();if(savedId)await openDetails(savedId);else setDetail(null);
  }catch(e){setError(e instanceof Error?e.message:"The record could not be saved.");}
  finally{setSaving(false);}
 };
 const asImportReport=(body:ApiPayload,mode:string):ImportReport=>{
  const source=obj(body.report??body.data);
  const errors=Array.isArray(source.errors)?source.errors.map(v=>{const r=obj(v);return {rowNumber:Number(r.rowNumber??0),field:typeof r.field==="string"?r.field:undefined,message:str(r.message)||"Invalid row"} as ImportError;}):[];
  const duplicateWarnings=Array.isArray(source.duplicateWarnings)?source.duplicateWarnings.map(v=>{
   const w=obj(v);const matches=Array.isArray(w.matches)?w.matches.map(m=>{const r=obj(m);return {id:str(r.id)||undefined,name:str(r.name)||"Possible duplicate",itemCode:typeof r.itemCode==="string"?r.itemCode:null,customerCode:typeof r.customerCode==="string"?r.customerCode:null,matchOn:Array.isArray(r.matchOn)?r.matchOn.map(str):[]};}):[];
   return {rowNumber:Number(w.rowNumber??0),matches};
  }):[];
  return {mode:typeof source.mode==="string"?(source.mode as "validate"|"commit"):mode,valid:typeof source.valid==="boolean"?source.valid:errors.length===0&&!body.error,
   rowCount:Number(source.rowCount??source.createdCount??0),validRows:Number(source.validRows??source.rowCount??0),
   createdCount:Number(source.createdCount??0),errors,duplicateWarnings};
 };
 const runImport=async(mode:"validate"|"commit")=>{
  if(!importFile)return;
  if(mode==="commit"&&!importValidationToken){setError("Validate this exact CSV file before committing.");return;}
  if(mode==="validate")setImportValidationToken(null);
  setImportBusy(true);setError("");setSuccess("");
  try{
   const csrf=await getCsrf();const source=await importFile.text();
   const confirmation=mode==="commit"&&confirmImportDuplicates?"&confirmDuplicates=true":"";
    const result=await request(basePath+"/import?mode="+mode+confirmation,{method:"POST",headers:{"Content-Type":"text/csv","X-CSRF-Token":csrf,...(mode==="commit"&&importValidationToken?{"x-import-validation-token":importValidationToken}:{})},body:source});
   const responseData=obj(result.body.data);
  if(mode==="validate"){
   if(result.response.ok&&typeof responseData.validationToken==="string")setImportValidationToken(responseData.validationToken);
   else setImportValidationToken(null);
  }else if(!result.response.ok&&["VALIDATION_TOKEN_REQUIRED","VALIDATION_TOKEN_INVALID","VALIDATION_TOKEN_EXPIRED"].includes(result.body.error?.code??"")){
   setImportValidationToken(null);
  }
  const report=asImportReport(result.body,mode);setImportReport(report);
   if(!result.response.ok){setError(result.body.error?.message??"CSV import could not be completed.");return;}
   if(mode==="validate"){
    setSuccess(report.duplicateWarnings.length?"Validation passed with possible duplicates. Review the report and explicitly confirm before committing.":"Validation passed. No records have been created yet.");
    setConfirmImportDuplicates(false);
   }else{
    setSuccess(`Imported ${report.createdCount} ${resource==="customers"?"customer":"item/service"} records. Review the duplicate report if one was returned.`);
    setImportFile(null);setImportReport(null);setImportValidationToken(null);setConfirmImportDuplicates(false);setFileInputKey(v=>v+1);await refresh();
   }
  }catch(e){setError(e instanceof Error?e.message:"CSV import failed.");}
  finally{setImportBusy(false);}
 };
 const archive=async(event:FormEvent<HTMLFormElement>)=>{
  event.preventDefault();if(!archiveTarget)return;
  setSaving(true);setError("");setSuccess("");
  try{
   const result=await mutate(basePath+"/"+archiveTarget.id+"/archive","POST",{expectedVersion:Number(archiveTarget.recordVersion),reason:archiveReason.trim()});
   if(!result.response.ok)throw new Error(result.body.error?.message??"The record could not be archived.");
   const data=obj(result.body.data);setSuccess(str(data.message)||"Record archived safely. Historical records remain linked.");
   setArchiveTarget(null);setArchiveReason("");setDetail(null);await refresh();
  }catch(e){setError(e instanceof Error?e.message:"The record could not be archived.");}
  finally{setSaving(false);}
 };
 const displayName=(row:Row)=>valueOf(row,"name")||"Unnamed record";
 const tableColumns=useMemo(()=>resource==="customers"?[
  {key:"customerCode",label:"Code"},{key:"name",label:"Customer"},{key:"email",label:"Email"},{key:"phone",label:"Phone"},
  {key:"paymentTermsDays",label:"Terms",render:(r:Row)=>valueOf(r,"paymentTermsDays")?`${valueOf(r,"paymentTermsDays")} days`:"Not configured"},
 ]:[
  {key:"itemCode",label:"Code"},{key:"name",label:"Item / service"},{key:"itemType",label:"Type"},
  {key:"unitCode",label:"Unit"},{key:"defaultUnitPrice",label:"Default price",render:(r:Row)=>`${valueOf(r,"currency")} ${valueOf(r,"defaultUnitPrice")}`},
 ],[resource]);

 return <div className="master-data-workspace">
  <div className="master-data-toolbar">
   <div className="master-data-search"><label className="form-label" htmlFor={resource+"-search"}>Search records</label>
    <input className="form-control" id={resource+"-search"} value={query} onChange={e=>{setQuery(e.target.value);setOffset(0);}} placeholder={resource==="customers"?(permissions.includes("settings:manage")?"Name, code, email, phone or tax ID":"Name, code, email or phone"):"Name or item/service code"} />
   </div>
   <div className="master-data-filter"><label className="form-label" htmlFor={resource+"-status"}>Status</label>
    <select id={resource+"-status"} className="form-control" value={status} onChange={e=>{setStatus(e.target.value);setOffset(0);}}>
     <option value="active">Active</option><option value="archived">Archived</option><option value="all">All records</option>
    </select>
   </div>
   <a className="button button--secondary button--sm" href={basePath+"/export?status="+encodeURIComponent(status)}>Export CSV</a>
   {canCreate?<Button onClick={openCreate}>+ New {resource==="customers"?"customer":"item / service"}</Button>:null}
  </div>
  {canCreate?<details className="master-data-import"><summary>Import CSV with validation</summary>
   <div className="master-data-import__body">
    <p>Choose a CSV, validate every row first, review possible duplicate matches, then explicitly commit. Imports are atomic; invalid files do not create partial records.</p>
    <div className="master-data-import__controls">
     <div className="form-field"><label className="form-label" htmlFor={resource+"-csv-file"}>CSV file</label>
      <input key={fileInputKey} className="form-control" id={resource+"-csv-file"} type="file" accept=".csv,text/csv" disabled={importBusy} onChange={e=>{setImportFile(e.target.files?.[0]??null);setImportReport(null);setImportValidationToken(null);setConfirmImportDuplicates(false);setError("");setSuccess("");}}/>
     </div>
     <a href={resource==="customers"?"/templates/customers-import-template.csv":"/templates/catalog-items-import-template.csv"} download>Download CSV template</a>
     <Button type="button" variant="secondary" disabled={!importFile||importBusy} onClick={()=>void runImport("validate")}>{importBusy?"Working…":"Validate CSV"}</Button>
    </div>
    {importReport?<div className="master-data-import__report" aria-live="polite">
      <strong>{importReport.mode==="commit"?`Committed ${importReport.createdCount??0} rows`:importReport.valid?`Validated ${importReport.rowCount??0} rows`:`Found ${importReport.errors.length} validation error(s)`}</strong>
      {importReport.errors.length?<div className="master-data-import__errors"><p>Fix the rows below and validate the updated file before committing:</p><ul>{importReport.errors.map((issue,index)=><li key={index}>Row {issue.rowNumber}{issue.field?" · "+issue.field:""}: {issue.message}</li>)}</ul></div>:null}
      {importReport.duplicateWarnings.length?<div className="master-data-import__warnings"><p>Possible duplicates do not block a deliberate import, but they are never auto-merged:</p><ul>{importReport.duplicateWarnings.map((warning,index)=><li key={index}>Row {warning.rowNumber}: {warning.matches.map(match=>match.name+(match.customerCode||match.itemCode?" ("+(match.customerCode||match.itemCode)+")":"")).join(", ")}</li>)}</ul></div>:null}
      {importReport.valid&&importReport.mode==="validate"?<div className="master-data-import__commit">
       {importReport.duplicateWarnings.length?<label className="master-data-import__confirm"><input type="checkbox" checked={confirmImportDuplicates} onChange={e=>setConfirmImportDuplicates(e.target.checked)}/> I reviewed the duplicate warnings and explicitly want to continue.</label>:null}
       <Button type="button" disabled={!importFile||importBusy||(importReport.duplicateWarnings.length>0&&!confirmImportDuplicates)} onClick={()=>void runImport("commit")}>{importBusy?"Importing…":`Commit ${importReport.rowCount??0} rows`}</Button>
      </div>:null}
    </div>:null}
   </div>
  </details>:null}
  {error?<InlineAlert tone="danger" title="Action needs attention">{error}</InlineAlert>:null}
  {success?<InlineAlert tone="success" title="Saved">{success}</InlineAlert>:null}
  {warnings?.length?<InlineAlert tone="warning" title="Possible duplicates found">No records were merged. Review these possible matches before creating more records: {warnings.map(w=>w.name+(w.customerCode||w.itemCode?" ("+(w.customerCode||w.itemCode)+")":"")).join("; ")}.</InlineAlert>:null}
  <div className="master-data-summary"><span>{loading?"Loading records…":`${pagination.total} ${pagination.total===1?"record":"records"}`}</span><span>Changes apply to future drafts only; historical document snapshots are preserved.</span></div>
  <div className="data-table-scroll">
   <table className="data-table"><thead><tr>{tableColumns.map(c=><th key={c.key}>{c.label}</th>)}<th>Status</th><th>Actions</th></tr></thead>
    <tbody>{!loading&&!records.length?<tr><td colSpan={tableColumns.length+2}><div className="master-data-empty"><strong>No {status==="active"?"active ":""}{resource==="customers"?"customers":"items or services"} found</strong><p>Try another search or create a record with approved business data.</p></div></td></tr>:null}
    {records.map(row=><tr key={row.id}>{tableColumns.map(c=><td key={c.key}>{c.render?c.render(row):valueOf(row,c.key)||"—"}</td>)}
     <td><StatusBadge tone={row.isActive?"success":"neutral"}>{row.isActive?"Active":"Archived"}</StatusBadge></td>
     <td><div className="master-data-actions"><Button size="sm" variant="ghost" onClick={()=>void openDetails(row.id)}>Details</Button>
      {canUpdate&&row.isActive?<Button size="sm" variant="secondary" disabled={saving} onClick={()=>void openEdit(row)}>Edit</Button>:null}
      {canArchive&&row.isActive?<Button size="sm" variant="danger" disabled={saving} onClick={()=>{setEditorOpen(false);setArchiveTarget(row);setArchiveReason("");setError("");}}>Archive</Button>:null}
     </div></td>
    </tr>)}</tbody>
   </table>
  </div>
  <div className="master-data-pagination"><span>Showing {pagination.total===0?0:offset+1}–{Math.min(offset+records.length,pagination.total)} of {pagination.total}</span><div>
   <Button variant="secondary" size="sm" disabled={offset===0||loading} onClick={()=>setOffset(Math.max(0,offset-limit))}>Previous</Button>
   <Button variant="secondary" size="sm" disabled={!pagination.hasMore||loading} onClick={()=>setOffset(offset+limit)}>Next</Button>
  </div></div>

  {editorOpen?<section ref={editorPanelRef} className="master-data-panel" aria-labelledby="master-data-form-title">
   <div className="master-data-panel__heading"><div><p className="page-eyebrow">{editing?"EDIT MASTER DATA":"NEW MASTER DATA"}</p><h2 id="master-data-form-title">{editing?"Edit "+title.slice(0,-1):"Create "+(resource==="customers"?"customer":"item / service")}</h2><p>Only approved information belongs in this record. Fields marked * are required.</p></div><Button variant="ghost" onClick={()=>setEditorOpen(false)}>Close</Button></div>
   <form onSubmit={save}>
    {resource==="catalog"?<div className="master-data-form-grid">
     <div className="form-field"><label className="form-label" htmlFor="itemType">Record type *</label><select className="form-control" id="itemType" required {...describedBy("itemType",fieldErrors)} value={form.itemType} onChange={e=>setForm(p=>({...p,itemType:e.target.value}))}><option value="" disabled>Select type</option><option value="PRODUCT">Product</option><option value="SERVICE">Service</option></select><FieldError id="itemType" errors={fieldErrors}/></div>
     {catalogFields.map(f=><div className="form-field" key={f.key}><label className="form-label" htmlFor={f.key}>{f.label}{f.required?<span className="form-required"> *</span>:null}</label>{fieldControl(f,fieldValue(form,f.key),v=>setForm(p=>({...p,[f.key]:v})),fieldErrors)}<FieldError id={f.key} errors={fieldErrors}/>{f.help?<p className="form-hint" id={f.key+"-hint"}>{f.help}</p>:null}</div>)}
     <div className="form-field form-field--wide"><label className="form-label" htmlFor="customerDescription">Customer-facing description *</label><textarea id="customerDescription" className="form-control form-control--textarea" required {...describedBy("customerDescription",fieldErrors)} value={form.customerDescription} onChange={e=>setForm(p=>({...p,customerDescription:e.target.value}))} maxLength={1000}/><FieldError id="customerDescription" errors={fieldErrors}/></div>
     <div className="form-field form-field--wide"><label className="form-label" htmlFor="internalDescription">Internal description</label><textarea id="internalDescription" className="form-control form-control--textarea" {...describedBy("internalDescription",fieldErrors,true)} value={form.internalDescription} onChange={e=>setForm(p=>({...p,internalDescription:e.target.value}))} maxLength={1000}/><FieldError id="internalDescription" errors={fieldErrors}/><p className="form-hint" id="internalDescription-hint">Internal description is not included on customer-facing documents by default.</p></div>
    </div>:<div className="master-data-form-grid">
     {customerFields.filter(f=>f.key!=="taxIdentifier"||permissions.includes("settings:manage")).map(f=><div className="form-field" key={f.key}><label className="form-label" htmlFor={f.key}>{f.label}{f.required?<span className="form-required"> *</span>:null}</label>{fieldControl(f,fieldValue(form,f.key),v=>setForm(p=>({...p,[f.key]:v})),fieldErrors)}<FieldError id={f.key} errors={fieldErrors}/>{f.help?<p className="form-hint" id={f.key+"-hint"}>{f.help}</p>:null}</div>)}
     <fieldset className="master-data-fieldset"><legend>Billing address</legend><div className="master-data-form-grid">
      {([["billLine1","Address line 1"],["billLine2","Address line 2"],["billCity","City"],["billState","State / province"],["billPostalCode","Postal code"],["billCountryCode","Country code"]] as const).map(([key,label])=><div className="form-field" key={key}><label className="form-label" htmlFor={key}>{label}</label><input className="form-control" id={key} value={form[key]} onChange={e=>setForm(p=>({...p,[key]:e.target.value}))} maxLength={255} {...describedBy(key,fieldErrors)}/><FieldError id={key} errors={fieldErrors}/></div>)}
     </div></fieldset>
     <fieldset className="master-data-fieldset"><legend>Shipping / service address (optional)</legend><div className="master-data-form-grid">
      {([["shipLine1","Address line 1"],["shipLine2","Address line 2"],["shipCity","City"],["shipState","State / province"],["shipPostalCode","Postal code"],["shipCountryCode","Country code"]] as const).map(([key,label])=><div className="form-field" key={key}><label className="form-label" htmlFor={key}>{label}</label><input className="form-control" id={key} value={form[key]} onChange={e=>setForm(p=>({...p,[key]:e.target.value}))} maxLength={255} {...describedBy(key,fieldErrors)}/><FieldError id={key} errors={fieldErrors}/></div>)}
     </div></fieldset>
     <fieldset className="master-data-fieldset"><legend>Contacts (optional)</legend>
      {contactDrafts.map((contact,index)=><div className="master-data-child-editor" key={index}><div className="master-data-child-editor__heading"><strong>{index===0?"Primary contact":`Contact ${index+1}`}</strong>{contactDrafts.length>1?<Button size="sm" variant="ghost" type="button" onClick={()=>setContactDrafts(rows=>rows.filter((_,i)=>i!==index))}>Remove</Button>:null}</div><div className="master-data-form-grid">
       {([["fullName","Full name"],["jobTitle","Job title"],["email","Email"],["phone","Phone"]] as const).map(([key,label])=><div className="form-field" key={key}><label className="form-label" htmlFor={`contact-${index}-${key}`}>{label}{key==="fullName"?" (required for contact)":""}</label><input className="form-control" id={`contact-${index}-${key}`} type={key==="email"?"email":"text"} value={contact[key]} onChange={e=>setContactDrafts(rows=>rows.map((row,i)=>i===index?{...row,[key]:e.target.value}:row))} maxLength={key==="fullName"?160:key==="email"?320:160} {...describedBy(`contact-${index}-${key}`,fieldErrors)}/><FieldError id={`contact-${index}-${key}`} errors={fieldErrors}/></div>)}
      </div></div>)}
      <Button variant="secondary" size="sm" type="button" disabled={contactDrafts.length>=30} onClick={()=>setContactDrafts(rows=>[...rows,emptyContact()])}>+ Add contact</Button>
     </fieldset>
     {permissions.includes("settings:manage")?<fieldset className="master-data-fieldset"><legend>Tax identifiers (optional)</legend>
      {taxDrafts.map((tax,index)=><div className="master-data-child-editor" key={index}><div className="master-data-child-editor__heading"><strong>Tax identifier {index+1}</strong>{taxDrafts.length>1?<Button size="sm" variant="ghost" type="button" onClick={()=>setTaxDrafts(rows=>rows.filter((_,i)=>i!==index))}>Remove</Button>:null}</div><div className="master-data-form-grid">
       {([["identifierType","Identifier type"],["countryCode","Country code"],["jurisdiction","Jurisdiction"],["identifierValue","Identifier value"]] as const).map(([key,label])=><div className="form-field" key={key}><label className="form-label" htmlFor={`tax-${index}-${key}`}>{label}</label><input className="form-control" id={`tax-${index}-${key}`} value={tax[key]} onChange={e=>setTaxDrafts(rows=>rows.map((row,i)=>i===index?{...row,[key]:e.target.value}:row))} maxLength={key==="identifierValue"?160:120} {...describedBy(`tax-${index}-${key}`,fieldErrors)} /><FieldError id={`tax-${index}-${key}`} errors={fieldErrors}/></div>)}
      </div></div>)}
      <Button variant="secondary" size="sm" type="button" disabled={taxDrafts.length>=30} onClick={()=>setTaxDrafts(rows=>[...rows,emptyTax()])}>+ Add tax identifier</Button>
      <p className="form-hint">Values are stored as supplied, with a normalized matching key. This does not verify legal registration or tax validity.</p>
     </fieldset>:null}
     {permissions.includes("settings:manage")?<div className="form-field form-field--wide"><label className="form-label" htmlFor="customerNotes">Internal notes (restricted)</label><textarea id="customerNotes" className="form-control form-control--textarea" maxLength={5000} {...describedBy("customerNotes",fieldErrors,true)} value={form.notes} onChange={e=>setForm(p=>({...p,notes:e.target.value}))}/><FieldError id="customerNotes" errors={fieldErrors}/><p className="form-hint" id="customerNotes-hint">Finance/settings administrators only. Internal notes must not appear on customer-facing documents by default.</p></div>:null}
    </div>}
    <div className="master-data-form-actions"><Button variant="secondary" type="button" disabled={saving} onClick={()=>setEditorOpen(false)}>Cancel</Button><Button type="submit" disabled={saving}>{saving?"Saving…":editing?"Save changes":"Create record"}</Button></div>
   </form>
  </section>:null}

  {detail?<div className="master-data-detail" aria-labelledby="master-data-detail-title">
   <div className="master-data-detail__heading"><div><p className="page-eyebrow">RECORD DETAILS</p><h2 id="master-data-detail-title">{displayName(detail)}</h2></div><Button variant="ghost" onClick={()=>setDetail(null)}>Close details</Button></div>
   <div className="master-data-detail__grid">
    {resource==="customers"?<>
     <div><span>Customer code</span><strong>{valueOf(detail,"customerCode")||"Not assigned"}</strong></div><div><span>Email</span><strong>{valueOf(detail,"email")||"Not supplied"}</strong></div>
     <div><span>Phone</span><strong>{valueOf(detail,"phone")||"Not supplied"}</strong></div><div><span>Payment terms</span><strong>{valueOf(detail,"paymentTermsDays")?valueOf(detail,"paymentTermsDays")+" days":"Not configured"}</strong></div>
     <div><span>Billing address</span><strong>{Object.values(obj(detail.billingAddress)).map(str).filter(Boolean).join(", ")||"Not supplied"}</strong></div>
     <div><span>Shipping / service address</span><strong>{Object.values(obj(detail.shippingAddress)).map(str).filter(Boolean).join(", ")||"Same / not supplied"}</strong></div>
     {permissions.includes("settings:manage")?<div><span>Legacy primary tax identifier</span><strong>{valueOf(detail,"taxIdentifier")||"Not supplied"}</strong></div>:null}
     <div><span>Primary contact</span><strong>{Array.isArray(detail.contacts)?str(obj(detail.contacts.find(x=>Boolean(obj(x).isPrimary))??detail.contacts[0]).fullName)||"Not supplied":"Not supplied"}</strong></div>
     {permissions.includes("settings:manage")&&Array.isArray(detail.taxIdentifiers)&&detail.taxIdentifiers.length?<div className="master-data-detail__wide"><span>Tax identifiers</span><strong>{detail.taxIdentifiers.map(t=>{const x=obj(t);return [str(x.identifierType),str(x.countryCode),str(x.jurisdiction),str(x.identifierValue)].filter(Boolean).join(" · ")}).join("; ")}</strong></div>:null}
     {detail.referenceCounts?<div className="master-data-detail__wide"><span>Historical references</span><strong>Invoices: {obj(detail.referenceCounts).invoices===null?"Restricted":str(obj(detail.referenceCounts).invoices)||"0"} · Quotations: {obj(detail.referenceCounts).quotations===null?"Restricted":str(obj(detail.referenceCounts).quotations)||"0"} · Payments: {obj(detail.referenceCounts).payments===null?"Restricted":str(obj(detail.referenceCounts).payments)||"0"}</strong></div>:null}
     {Array.isArray(detail.linkedInvoices)?<div className="master-data-detail__wide"><span>Invoices you can access</span>{detail.linkedInvoices.length?<ul className="master-data-linked-documents">{detail.linkedInvoices.map(item=>{const inv=obj(item);return <li key={str(inv.id)}><strong>{str(inv.invoiceNumber)||"Draft invoice"}</strong><span>{str(inv.status)} · {str(inv.currency)} {str(inv.grandTotal)}{str(inv.invoiceDate)?" · "+str(inv.invoiceDate):""}</span></li>;})}</ul>:<p className="form-hint">No invoices are visible for your current legal-entity scope.</p>}</div>:null}
     {Array.isArray(detail.linkedQuotations)?<div className="master-data-detail__wide"><span>Quotations you can access</span>{detail.linkedQuotations.length?<ul className="master-data-linked-documents">{detail.linkedQuotations.map(item=>{const quote=obj(item);return <li key={str(quote.id)}><strong>{str(quote.quotationNumber)||"Draft quotation"}</strong><span>{str(quote.status)} · {str(quote.currency)} {str(quote.grandTotal)}{str(quote.issueDate)?" · "+str(quote.issueDate):""}</span></li>;})}</ul>:<p className="form-hint">No quotations are visible for your current legal-entity scope.</p>}</div>:null}
    </>:<>
     <div><span>Code</span><strong>{valueOf(detail,"itemCode")||"Not assigned"}</strong></div><div><span>Type</span><strong>{valueOf(detail,"itemType")}</strong></div>
     <div><span>Unit</span><strong>{valueOf(detail,"unitCode")}</strong></div><div><span>Default unit price</span><strong>{valueOf(detail,"currency")} {valueOf(detail,"defaultUnitPrice")}</strong></div>
     <div className="master-data-detail__wide"><span>Customer-facing description</span><strong>{valueOf(detail,"customerDescription")}</strong></div>
     {detail.internalDescription?<div className="master-data-detail__wide"><span>Internal description</span><strong>{valueOf(detail,"internalDescription")}</strong></div>:null}
     <div><span>Default tax code</span><strong>{valueOf(detail,"defaultTaxCode")||"Not configured"}</strong></div>
     {detail.referenceCounts?<div className="master-data-detail__wide"><span>Historical references</span><strong>{referenceSummary(resource,detail.referenceCounts)}</strong></div>:null}
    </>}
    <div><span>Record version</span><strong>{valueOf(detail,"recordVersion")}</strong></div>
    <div><span>Created</span><strong>{valueOf(detail,"createdAt")||"—"}</strong></div>
   </div>
   {detail.isActive&&(canUpdate||canArchive)?<div className="master-data-form-actions">{canUpdate?<Button variant="secondary" onClick={()=>void openEdit(detail)}>Edit record</Button>:null}{canArchive?<Button variant="danger" onClick={()=>{setEditorOpen(false);setArchiveTarget(detail);setArchiveReason("");}}>Archive record</Button>:null}</div>:null}
  </div>:detailLoading?<p className="master-data-summary">Loading details…</p>:null}

  {archiveTarget?<section ref={archivePanelRef} className="master-data-panel master-data-panel--narrow" aria-labelledby="archive-title"><div className="master-data-panel__heading"><div><p className="page-eyebrow">ARCHIVE MASTER DATA</p><h2 id="archive-title">Archive {displayName(archiveTarget)}?</h2><p>This hides the record from new selection but preserves linked invoices, quotations and audit history. It is not a delete.</p></div></div>
   <form onSubmit={archive}><div className="form-field"><label className="form-label" htmlFor="archiveReason">Reason (required)</label><textarea id="archiveReason" className="form-control form-control--textarea" value={archiveReason} onChange={e=>setArchiveReason(e.target.value)} minLength={3} maxLength={500} required/></div>
    <div className="master-data-form-actions"><Button variant="secondary" type="button" onClick={()=>setArchiveTarget(null)} disabled={saving}>Cancel</Button><Button variant="danger" type="submit" disabled={saving||archiveReason.trim().length<3}>{saving?"Archiving…":"Confirm archive"}</Button></div></form>
  </section>:null}
 </div>;
}
