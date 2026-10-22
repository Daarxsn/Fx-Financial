"use client";

import Image from "next/image";
import Link from "next/link";
import { BRAND_LOGO_ASSETS, APPROVED_BRAND_COLORS, resolveBrandLogo, isApprovedBrandColor } from "@/lib/brand-assets";
import { useCallback, useEffect, useState, type FormEvent, type Dispatch, type SetStateAction, type ReactNode, type CSSProperties } from "react";
import { Breadcrumbs, Button, Card, EmptyState, InlineAlert, LoadingState, PageHeader, StatusBadge, TextField, TextAreaField, SelectField } from "@/components/ui";

type Entity = {
  id:string; legalName:string; displayName:string; registrationNumber:string|null; taxIdentifier:string|null;
  address:Record<string,string>; billingAddress:Record<string,string>|null; countryCode:string|null; invoiceEmail:string|null; invoicePhone:string|null; website:string|null;
  currency:string; locale:string|null; timeZone:string|null; logoReference:string|null; bankDetailsConfigured:boolean;
  bankAccountLast4:string|null; invoiceTerms:string|null; invoiceFooter:string|null; defaultTaxCode:string|null;
  taxSetupStatus:string; taxSetupApprovalReference:string|null; isActive:boolean;
};
type Brand={id:string;name:string;code:string;description:string|null;logoReference:string|null;defaultTemplateKey:string|null;theme:Record<string,unknown>|null;isActive:boolean;legalEntityMappings:{legalEntityId:string;isDefault:boolean}[]};
type Unit={id:string;code:string;name:string;description:string|null;isActive:boolean;legalEntities:{id:string;isPrimary:boolean}[];brandIds:string[]};
type Registration={id:string;registrationKey:string;versionNumber:number;registrationType:string;jurisdiction:string;registrationNumber:string;displayLabel:string;isPrimary:boolean;effectiveFrom:string;effectiveUntil:string|null;approvalReference:string;isActive:boolean};
type TaxRule={id:string;legalEntityId:string;taxCode:string;displayName:string;jurisdiction:string;ratePercent:string;calculationMode:string;effectiveFrom:string;effectiveUntil:string|null;isActive:boolean;approvalReference:string|null};
type Numbering={id:string;legalEntityId:string;documentType:string;seriesCode:string;prefix:string;suffix:string;sequenceWidth:number;includeFinancialYear:boolean;financialYearStartMonth:number;financialYearStartDay:number;timeZone:string;versionNumber:number;effectiveFrom:string;effectiveUntil:string|null;approvalReference:string|null;isActive:boolean};
type Template={id:string;legalEntityId:string;brandId:string|null;documentType:string;templateKey:string;displayName:string;versionNumber:number;templateConfig:Record<string,unknown>;effectiveFrom:string;effectiveUntil:string|null;isActive:boolean};
type Check={key:string;passed:boolean;message:string};
type Readiness={legalEntityId:string;ready:boolean;checks:Check[]};
type Tab="company"|"brands"|"units"|"tax"|"numbering"|"templates";
type Draft=Record<string,string|boolean>;
// Configuration defaults use the company's default business timezone, not UTC. This
// avoids a one-day error for Asia/Kolkata during the first 5h30m of a local calendar day.
const today=(timeZone="Asia/Kolkata")=>{
 const parts=new Intl.DateTimeFormat("en-GB",{timeZone,year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date());
 const part=(type:"year"|"month"|"day")=>parts.find(value=>value.type===type)?.value??"";
 return `${part("year")}-${part("month")}-${part("day")}`;
};
const companyBlank=():Draft=>({legalName:"",displayName:"",registrationNumber:"",taxIdentifier:"",countryCode:"",currency:"INR",line1:"",line2:"",city:"",state:"",postalCode:"",billingLine1:"",billingLine2:"",billingCity:"",billingState:"",billingPostalCode:"",billingCountryCode:"",invoiceEmail:"",invoicePhone:"",website:"",locale:"en-IN",timeZone:"Asia/Kolkata",logoReference:"",invoiceTerms:"",invoiceFooter:"",defaultTaxCode:"",taxSetupStatus:"UNCONFIGURED",taxSetupApprovalReference:"",bankAccountName:"",bankName:"",bankAccountNumber:"",bankIfsc:"",bankSwift:"",replaceBank:false,changeReason:"Initial legal entity configuration"});
const brandBlank=():Draft=>({name:"",code:"",description:"",logoReference:"",defaultTemplateKey:"",themeAccent:"#931314",themeStyle:"STANDARD",legalEntityIds:"",changeReason:"Initial brand configuration"});
const unitBlank=():Draft=>({code:"",name:"",description:"",legalEntityIds:"",brandIds:"",changeReason:"Initial business unit configuration"});
const registrationBlank=():Draft=>({registrationKey:"",registrationType:"GSTIN",jurisdiction:"",registrationNumber:"",displayLabel:"",isPrimary:true,effectiveFrom:today(),effectiveUntil:"",approvalReference:"",changeReason:"Approved tax registration configuration"});
const taxBlank=():Draft=>({taxCode:"",displayName:"",jurisdiction:"",ratePercent:"",calculationMode:"EXCLUSIVE",effectiveFrom:today(),effectiveUntil:"",approvalReference:"",changeReason:"Approved tax rule configuration"});
const numberingBlank=():Draft=>({documentType:"INVOICE",seriesCode:"INV",prefix:"",suffix:"",sequenceWidth:"5",includeFinancialYear:true,financialYearStartMonth:"4",financialYearStartDay:"1",timeZone:"Asia/Kolkata",effectiveFrom:today(),effectiveUntil:"",approvalReference:"",activate:false,changeReason:"Numbering configuration"});
const templateBlank=():Draft=>({brandId:"",documentType:"INVOICE",templateKey:"STANDARD",displayName:"Standard invoice",
 templateConfig:JSON.stringify({pageSize:"A4",orientation:"PORTRAIT",layout:"STANDARD",accentColor:"#931314",showLogo:true,showTaxBreakdown:true,showBankDetails:false,showPaymentTerms:true,showCustomerTaxIdentifier:false,showFooter:true,footerText:""},null,2),
 effectiveFrom:today(),effectiveUntil:"",activate:false,changeReason:"Document template configuration"});
async function api<T>(path:string,method="GET",body?:unknown):Promise<T>{
 let csrf="";
 if(method!=="GET"){
  csrf=document.cookie.split(";").map(p=>p.trim()).find(p=>p.startsWith("fx_csrf="))?.slice(8)??"";
  if(!csrf){const boot=await fetch("/api/v1/auth/csrf",{cache:"no-store",credentials:"same-origin"});const v=await boot.json();if(!boot.ok)throw new Error("Request verification failed. Refresh and try again.");csrf=String(v?.data?.csrfToken??"")}
 }
 const response=await fetch(path,{method,cache:"no-store",credentials:"same-origin",headers:{"Accept":"application/json",...(body?{"Content-Type":"application/json"}:{}),...(csrf?{"X-CSRF-Token":csrf}:{})},...(body?{body:JSON.stringify(body)}:{})});
 const payload=await response.json().catch(()=>null);if(!response.ok)throw new Error(payload?.error?.message??"The configuration request failed.");return payload?.data as T;
}
function Input({id,label,value,onChange,type="text",required=false,disabled=false,hint}:{id:string;label:string;value:string;onChange:(s:string)=>void;type?:string;required?:boolean;disabled?:boolean;hint?:string}){
 return <TextField id={id} label={label} value={value} onChange={e=>onChange(e.target.value)} type={type} required={required} disabled={disabled} hint={hint}/>;
}
function Select({id,label,value,onChange,options,required=false}:{id:string;label:string;value:string;onChange:(s:string)=>void;options:{value:string;label:string}[];required?:boolean}){
 return <SelectField id={id} label={label} value={value} onChange={e=>onChange(e.target.value)} options={options} required={required}/>;
}
function Grid({children}:{children:ReactNode}){return <div className="config-form-grid">{children}</div>}
function Heading({label,title,description,action}:{label:string;title:string;description:string;action?:ReactNode}){return <div className="config-section-heading"><div><p className="eyebrow">{label}</p><h2>{title}</h2><p>{description}</p></div>{action}</div>}
function RecordCard({title,subtitle,meta,active,details,actions}:{title:string;subtitle:string;meta?:string;active:boolean;details:React.ReactNode;actions?:React.ReactNode}){
 return <Card className="config-record-card"><div className="config-record-top"><div className="config-identity-mark"><span>{title.slice(0,1).toUpperCase()}</span></div><div className="config-record-name"><h3>{title}</h3><p>{subtitle}</p>{meta?<small>{meta}</small>:null}</div><StatusBadge tone={active?"success":"neutral"}>{active?"Active":"Inactive"}</StatusBadge></div><div className="config-record-details">{details}</div>{actions?<div className="config-record-bottom"><span/><div className="config-action-row">{actions}</div></div>:null}</Card>;
}
function Detail({label,children}:{label:string;children:ReactNode}){return <span><small>{label}</small>{children}</span>}
function TemplatePreview({config,title,documentType,issuerName,logoSource,logoAlt}:{config:Record<string,unknown>|null;title:string;documentType:string;issuerName:string;logoSource:string;logoAlt:string}){
 const accent=isApprovedBrandColor(config?.accentColor)?config.accentColor:"#931314";
 const pageSize=config?.pageSize==="A5"?"A5":config?.pageSize==="LETTER"?"LETTER":"A4";
 const orientation=config?.orientation==="LANDSCAPE"?"LANDSCAPE":"PORTRAIT";
 const showLogo=config?.showLogo!==false,showTax=config?.showTaxBreakdown!==false,showTerms=config?.showPaymentTerms!==false;
 const showBank=config?.showBankDetails===true,showCustomerTax=config?.showCustomerTaxIdentifier===true,showFooter=config?.showFooter!==false;
 const footer=typeof config?.footerText==="string"&&config.footerText.trim()?config.footerText:"Footer text configured for this template";
 const issuer=issuerName.trim()||"Your legal business name";
 const docLabel=({"INVOICE":"Invoice","CREDIT_NOTE":"Credit note","DEBIT_NOTE":"Debit note","QUOTATION":"Quotation"} as Record<string,string>)[documentType]??"Financial document";
 return <section className="config-template-preview" aria-label="Live document template preview">
  <div className="config-template-preview__heading">
   <div><p className="eyebrow">LIVE PREVIEW</p><h3>{title.trim()||docLabel}</h3><p>Illustrative layout only. No invoice number, customer data, totals or payment instructions are created here.</p></div>
   <span className="config-template-preview__format">{pageSize} · {orientation}</span>
  </div>
  {!config?<div className="config-template-preview__invalid" role="status">Enter valid JSON to preview the template configuration.</div>:
   <article className={`config-template-paper config-template-paper--${orientation.toLowerCase()}`} style={{"--template-accent":accent} as CSSProperties} aria-label="Illustrative document page">
    <div className="config-template-paper__accent"/>
    <header className="config-template-paper__header">
     {showLogo?<div className="config-template-paper__logo" aria-label="Illustrative brand logo"><Image className="config-template-paper__logo-image" src={logoSource} alt={logoAlt} width={180} height={58} unoptimized /></div>:null}
     <div className="config-template-paper__issuer"><strong>{issuer}</strong><span>Registered supplier · Contact and address</span></div>
     <div className="config-template-paper__document"><small>DOCUMENT PREVIEW</small><h4>{docLabel}</h4><span>NOT ISSUED</span></div>
    </header>
    <div className="config-template-paper__identity">
     <div><small>BILL TO</small><strong>Customer name</strong><span>Billing address and contact</span>{showCustomerTax?<span>Customer tax identifier</span>:null}</div>
     <div><small>DOCUMENT DETAILS</small><span>Date: Not assigned</span><span>Number: Not allocated</span><span>Currency: As configured</span></div>
    </div>
    <table className="config-template-paper__table">
     <thead><tr><th>Description</th><th>Qty</th><th>Unit price</th><th>Amount</th></tr></thead>
     <tbody><tr><td>Line item description</td><td>—</td><td>—</td><td>—</td></tr></tbody>
    </table>
    <div className="config-template-paper__summary">
     <div className="config-template-paper__options">
      {showTerms?<p><strong>Payment terms</strong><span>Configured terms will appear here</span></p>:null}
      {showBank?<p><strong>Payment instructions</strong><span>Approved payment details placeholder — no bank information is shown in this preview</span></p>:null}
      {showTax?<p><strong>Tax breakdown</strong><span>Approved tax details are selected for the document date</span></p>:null}
     </div>
     <div className="config-template-paper__totals"><span>Subtotal</span><strong>Calculated on issue</strong><span>Tax</span><strong>Calculated on issue</strong><span className="config-template-paper__grand">Total</span><strong className="config-template-paper__grand">Calculated on issue</strong></div>
    </div>
    {showFooter?<footer className="config-template-paper__footer">{footer}</footer>:null}
   </article>}
 </section>;
}
function commaIds(value:string){return value.split(/[\s,]+/).map(v=>v.trim()).filter(Boolean)}
function compactDate(value:string|null|undefined){return value?String(value).slice(0,10):"Open"}

export default function SettingsPage(){
 const [tab,setTab]=useState<Tab>("company");
 const [showAdvancedSettings,setShowAdvancedSettings]=useState(false);
 const [quickAddEntity,setQuickAddEntity]=useState(false);
 const [entities,setEntities]=useState<Entity[]>([]);const [brands,setBrands]=useState<Brand[]>([]);const [units,setUnits]=useState<Unit[]>([]);
 const [registrations,setRegistrations]=useState<Registration[]>([]);const [taxRules,setTaxRules]=useState<TaxRule[]>([]);
 const [numberings,setNumberings]=useState<Numbering[]>([]);const [templates,setTemplates]=useState<Template[]>([]);
 const [readiness,setReadiness]=useState<Record<string,Readiness>>({});
 const [entityId,setEntityId]=useState("");const [busy,setBusy]=useState(true);const [saving,setSaving]=useState(false);
 const [error,setError]=useState("");const [notice,setNotice]=useState("");
 const [entityEdit,setEntityEdit]=useState("");const [brandEdit,setBrandEdit]=useState("");const [unitEdit,setUnitEdit]=useState("");
 const [company,setCompany]=useState<Draft>(companyBlank());const [brand,setBrand]=useState<Draft>(brandBlank());const [unit,setUnit]=useState<Draft>(unitBlank());
 const [registration,setRegistration]=useState<Draft>(registrationBlank());const [tax,setTax]=useState<Draft>(taxBlank());const [numbering,setNumbering]=useState<Draft>(numberingBlank());const [template,setTemplate]=useState<Draft>(templateBlank());
 const setValue=(setter:Dispatch<SetStateAction<Draft>>,key:string,value:string|boolean)=>setter(old=>({...old,[key]:value}));
 const loadAll=useCallback(async()=>{
  setBusy(true);setError("");
  try{
   const results=await Promise.all([
    api<Entity[]>("/api/v1/legal-entities?status=all"),api<Brand[]>("/api/v1/brands?status=all"),
    api<Unit[]>("/api/v1/business-units?status=all"),api<TaxRule[]>("/api/v1/tax-rules"),
    api<Numbering[]>("/api/v1/numbering-configs"),api<Template[]>("/api/v1/document-templates")
   ]);
   const es=results[0]??[];setEntities(es);setBrands(results[1]??[]);setUnits(results[2]??[]);setTaxRules(results[3]??[]);setNumberings(results[4]??[]);setTemplates(results[5]??[]);
   setEntityId(old=>es.some(e=>e.id===old)?old:(es[0]?.id??""));
   const rr=await Promise.all(es.map(async e=>{try{return [e.id,await api<Readiness>("/api/v1/legal-entities/"+e.id+"/readiness")] as const}catch{return [e.id,{legalEntityId:e.id,ready:false,checks:[{key:"unavailable",passed:false,message:"Readiness could not be verified."}]}] as const}}));
   setReadiness(Object.fromEntries(rr));
  }catch(e){setError(e instanceof Error?e.message:"Company settings failed to load.")}
  finally{setBusy(false)}
 },[]);
 useEffect(()=>{
  let current=true;
  // Defer initial loading out of the effect's synchronous execution.
  void Promise.resolve().then(()=>{if(current)return loadAll()});
  return()=>{current=false};
 },[loadAll]);
 useEffect(()=>{
  let current=true;
  // Clear prior-entity rows in the next microtask, then load only the selected entity's records.
  void Promise.resolve().then(()=>{
   if(!current)return;
   setRegistrations([]);
   if(!entityId)return;
   return api<Registration[]>("/api/v1/legal-entities/"+entityId+"/tax-registrations")
    .then(rows=>{if(current)setRegistrations(rows??[])})
    .catch(e=>{if(current)setError(e instanceof Error?e.message:"Tax registrations failed to load.")});
  });
  return()=>{current=false};
 },[entityId]);
 const entity=entities.find(e=>e.id===entityId)??null;
 const accessibleBrands=brands.filter(b=>b.legalEntityMappings.some(m=>m.legalEntityId===entityId));
 const templateBrand=accessibleBrands.find(b=>b.id===String(template.brandId))??null;
 const selectedLogo=resolveBrandLogo(templateBrand?.logoReference??entity?.logoReference);
 async function mutate(event:FormEvent<HTMLFormElement>|undefined,action:()=>Promise<unknown>,message:string){
  event?.preventDefault();setSaving(true);setError("");setNotice("");
  try{await action();setNotice(message);await loadAll()}
  catch(e){setError(e instanceof Error?e.message:"The change was not saved.")}
  finally{setSaving(false)}
 }
 function editEntity(e:Entity){
  setEntityEdit(e.id);const a=e.address??{};
  setCompany({...companyBlank(),legalName:e.legalName,displayName:e.displayName,registrationNumber:e.registrationNumber??"",taxIdentifier:e.taxIdentifier??"",
   countryCode:e.countryCode??a.countryCode??"",currency:e.currency,line1:a.line1??"",line2:a.line2??"",city:a.city??"",state:a.state??"",postalCode:a.postalCode??"",
   billingLine1:e.billingAddress?.line1??"",billingLine2:e.billingAddress?.line2??"",billingCity:e.billingAddress?.city??"",billingState:e.billingAddress?.state??"",billingPostalCode:e.billingAddress?.postalCode??"",billingCountryCode:e.billingAddress?.countryCode??"",
   invoiceEmail:e.invoiceEmail??"",invoicePhone:e.invoicePhone??"",website:e.website??"",locale:e.locale??"",timeZone:e.timeZone??"",logoReference:e.logoReference??"",
   invoiceTerms:e.invoiceTerms??"",invoiceFooter:e.invoiceFooter??"",defaultTaxCode:e.defaultTaxCode??"",taxSetupStatus:e.taxSetupStatus,
   taxSetupApprovalReference:e.taxSetupApprovalReference??"",changeReason:"Update legal entity configuration"});
 }
 async function saveEntity(){
  const address={line1:String(company.line1),line2:String(company.line2),city:String(company.city),state:String(company.state),postalCode:String(company.postalCode),countryCode:String(company.countryCode)};
  const billingFields=[company.billingLine1,company.billingLine2,company.billingCity,company.billingState,company.billingPostalCode,company.billingCountryCode].map(v=>String(v??"").trim());
  const hasBillingAddress=billingFields.some(Boolean);
  if(hasBillingAddress&&(!String(company.billingLine1).trim()||!String(company.billingCity).trim()||!String(company.billingPostalCode).trim()||!String(company.billingCountryCode||company.countryCode).trim())) {
   throw new Error("Complete billing address line 1, city, postal code and country code, or leave all billing address fields blank.");
  }
  const billingAddress=hasBillingAddress?{line1:String(company.billingLine1),line2:String(company.billingLine2),city:String(company.billingCity),state:String(company.billingState),postalCode:String(company.billingPostalCode),countryCode:String(company.billingCountryCode||company.countryCode)}:null;
  const body:Record<string,unknown>={legalName:company.legalName,displayName:company.displayName,registrationNumber:company.registrationNumber,
   taxIdentifier:company.taxIdentifier,address,billingAddress,countryCode:company.countryCode,currency:company.currency,invoiceEmail:company.invoiceEmail,
   invoicePhone:company.invoicePhone,website:company.website,locale:company.locale,timeZone:company.timeZone,logoReference:company.logoReference,
   invoiceTerms:company.invoiceTerms,invoiceFooter:company.invoiceFooter,defaultTaxCode:company.defaultTaxCode,taxSetupStatus:company.taxSetupStatus,
   taxSetupApprovalReference:company.taxSetupApprovalReference,changeReason:company.changeReason};
  const bank={accountName:company.bankAccountName,bankName:company.bankName,accountNumber:company.bankAccountNumber,ifsc:company.bankIfsc,swift:company.bankSwift};
  const hasAnyBankValue=Object.values(bank).some(v=>String(v).trim().length>0);
  if(company.replaceBank===true || (entityEdit==="new" && hasAnyBankValue)){
   if(!bank.accountName||!bank.bankName||!bank.accountNumber)throw new Error("To save bank details, enter the account holder, bank name and account number.");
   body.bankDetails=bank;
  }
  if(entityEdit==="new")await api("/api/v1/legal-entities","POST",body);
  else{
   if(company.taxSetupStatus!=="UNCONFIGURED"&&!company.taxSetupApprovalReference)throw new Error("An approval reference is required for an approved tax setup.");
   await api("/api/v1/legal-entities/"+entityEdit,"PATCH",body);
  }
  setEntityEdit("");setCompany(companyBlank());
 }
 async function toggle(path:string,active:boolean,label:string){
  const reason=window.prompt("Reason to "+(active?"deactivate ":"activate ")+label+":");
  if(!reason||reason.trim().length<3)return;
  await api(path,"PATCH",{isActive:!active,changeReason:reason.trim()});
  setNotice(label+" "+(active?"deactivated.":"activated."));await loadAll();
 }
 async function saveBrand(){
  const entityIds=commaIds(String(brand.legalEntityIds));
  const body={name:brand.name,description:brand.description,logoReference:brand.logoReference,defaultTemplateKey:brand.defaultTemplateKey,
   theme:{accentColor:String(brand.themeAccent),presentationStyle:String(brand.themeStyle)},
   legalEntityIds:entityIds,changeReason:brand.changeReason};
  if(brandEdit)await api("/api/v1/brands/"+brandEdit,"PATCH",body);
  else await api("/api/v1/brands","POST",{...body,code:brand.code});
  setBrandEdit("");setBrand(brandBlank());
 }
 async function saveUnit(){
  const entityIds=commaIds(String(unit.legalEntityIds));const brandIds=commaIds(String(unit.brandIds));
  const body={name:unit.name,description:unit.description,legalEntityIds:entityIds,brandIds,changeReason:unit.changeReason};
  if(unitEdit)await api("/api/v1/business-units/"+unitEdit,"PATCH",body);
  else await api("/api/v1/business-units","POST",{...body,code:unit.code});
  setUnitEdit("");setUnit(unitBlank());
 }
 async function saveRegistration(){
  if(!entityId)throw new Error("Select a legal entity first.");
  await api("/api/v1/legal-entities/"+entityId+"/tax-registrations","POST",{...registration,effectiveUntil:registration.effectiveUntil||""});
  setRegistration(registrationBlank());
 }
 async function saveTax(){
  if(!entityId)throw new Error("Select a legal entity first.");
  await api("/api/v1/tax-rules","POST",{...tax,legalEntityId:entityId,effectiveUntil:tax.effectiveUntil||""});setTax(taxBlank());
 }
 async function saveNumbering(){
  if(!entityId)throw new Error("Select a legal entity first.");
  await api("/api/v1/numbering-configs","POST",{...numbering,legalEntityId:entityId,sequenceWidth:Number(numbering.sequenceWidth),
   financialYearStartMonth:Number(numbering.financialYearStartMonth),financialYearStartDay:Number(numbering.financialYearStartDay),effectiveUntil:numbering.effectiveUntil||""});
  setNumbering(numberingBlank());
 }
 async function saveTemplate(){
  if(!entityId)throw new Error("Select a legal entity first.");let config:unknown;
  try{config=JSON.parse(String(template.templateConfig))}catch{throw new Error("Template configuration must be valid JSON.")}
  await api("/api/v1/document-templates","POST",{...template,legalEntityId:entityId,brandId:template.brandId||"",templateConfig:config,effectiveUntil:template.effectiveUntil||""});
  setTemplate(templateBlank());
 }

 async function saveQuickSetup(){
  const countryCode=String(company.countryCode).trim().toUpperCase();
  if(!/^[A-Z]{2}$/.test(countryCode))throw new Error("Enter the two-letter country code for the business, such as IN.");
  await api("/api/v1/legal-entities","POST",{
   legalName:String(company.legalName).trim(),displayName:String(company.displayName).trim(),
   registrationNumber:String(company.registrationNumber),taxIdentifier:String(company.taxIdentifier),
   address:{line1:String(company.line1).trim(),line2:String(company.line2),city:String(company.city).trim(),state:String(company.state),postalCode:String(company.postalCode).trim(),countryCode},
   billingAddress:null,countryCode,currency:String(company.currency),invoiceEmail:String(company.invoiceEmail).trim(),
   invoicePhone:String(company.invoicePhone).trim(),website:String(company.website),locale:String(company.locale||"en-IN"),
   timeZone:String(company.timeZone||"Asia/Kolkata"),logoReference:String(company.logoReference),
   invoiceTerms:String(company.invoiceTerms),invoiceFooter:String(company.invoiceFooter),defaultTaxCode:"",
   taxSetupStatus:"UNCONFIGURED",taxSetupApprovalReference:"",
   changeReason:"Initial quick invoicing setup"
  });
  setCompany(companyBlank());setQuickAddEntity(false);
 }

 let templatePreviewConfig:Record<string,unknown>|null=null;
 try{const parsed:unknown=JSON.parse(String(template.templateConfig));if(parsed&&typeof parsed==="object"&&!Array.isArray(parsed))templatePreviewConfig=parsed as Record<string,unknown>}catch{/* Invalid JSON should not be rendered as a document. */}
 const tabs:[Tab,string,string][]=[["company","Company & entities","Legal identities"],["brands","Brands","Commercial identities"],["units","Business units","Organization"],["tax","Tax","Registrations & rules"],["numbering","Numbering series","Fiscal-year rules"],["templates","Templates","Document layout"]];
 if(busy)return <div className="page"><Breadcrumbs items={[{label:"Workspace",href:"/"},{label:"Settings"}]}/><PageHeader eyebrow="INVOICING SETUP" title="Your invoicing workspace" description="Loading your business profile and first-invoice checklist…"/><LoadingState label="Loading your invoicing setup…"/></div>;

 const activeEntities=entities.filter(e=>e.isActive);
 const quickEntity=activeEntities.find(e=>e.id===entityId)??activeEntities[0]??null;
 const quickReadiness=quickEntity?readiness[quickEntity.id]:undefined;
 const failedReadinessChecks=quickReadiness?.checks.filter(c=>!c.passed).length??0;
 if(!showAdvancedSettings)return <div className="page page--configuration page--quick-settings">
  <Breadcrumbs items={[{label:"Workspace",href:"/"},{label:"Settings"}]}/>
  <PageHeader eyebrow="INVOICING SETUP" title="Your invoicing workspace" description="Set up only what you need to start creating and sending invoices. Advanced finance controls remain available when you need them." action={<Button variant="secondary" onClick={()=>setShowAdvancedSettings(true)}>Advanced settings</Button>}/>
  {error?<div className="config-message"><InlineAlert tone="danger" title="Setup needs attention">{error}</InlineAlert><Button variant="secondary" onClick={()=>void loadAll()}>Reload</Button></div>:null}
  {notice?<div className="config-message"><InlineAlert tone="success" title="Saved">{notice}</InlineAlert><Button variant="ghost" size="sm" onClick={()=>setNotice("")}>Dismiss</Button></div>:null}
  <div className="quick-setup-grid">
   <section className="quick-setup-primary">
    {activeEntities.length===0||quickAddEntity?<Card className="quick-setup-card">
     <p className="eyebrow">STEP 1 · BUSINESS BASICS</p>
     <h2>{quickAddEntity?"Add another business":"Add your business"}</h2>
     <p className="quick-setup-lead">These are the only details we need to create your supplier profile. We do not fill in tax IDs, tax rates, or bank details for you.</p>
     <form className="config-form" onSubmit={e=>void mutate(e,saveQuickSetup,"Business profile saved. Next, add your first customer.")}>
      <Grid>
       <Input id="quick-legal-name" label="Registered business name" required value={String(company.legalName)} onChange={s=>setValue(setCompany,"legalName",s)}/>
       <Input id="quick-display-name" label="Name shown on invoices" required value={String(company.displayName)} onChange={s=>setValue(setCompany,"displayName",s)}/>
       <Input id="quick-country-code" label="Country code" required value={String(company.countryCode)} onChange={s=>setValue(setCompany,"countryCode",s.toUpperCase())} hint="Two letters, such as IN for India."/>
       <Select id="quick-currency" label="Invoice currency" value={String(company.currency)} onChange={s=>setValue(setCompany,"currency",s)} options={[{value:"INR",label:"INR · Indian rupee"},{value:"AED",label:"AED · UAE dirham"},{value:"USD",label:"USD · US dollar"},{value:"GBP",label:"GBP · Pound sterling"},{value:"EUR",label:"EUR · Euro"}]} required/>
       <Input id="quick-address-line1" label="Business address" required value={String(company.line1)} onChange={s=>setValue(setCompany,"line1",s)}/>
       <Input id="quick-city" label="City" required value={String(company.city)} onChange={s=>setValue(setCompany,"city",s)}/>
       <Input id="quick-state" label="State / region" value={String(company.state)} onChange={s=>setValue(setCompany,"state",s)}/>
       <Input id="quick-postal-code" label="Postal code" required value={String(company.postalCode)} onChange={s=>setValue(setCompany,"postalCode",s)}/>
       <Input id="quick-invoice-email" label="Invoice contact email" type="email" value={String(company.invoiceEmail)} onChange={s=>setValue(setCompany,"invoiceEmail",s)} hint="Optional; used for invoice correspondence where configured."/>
       <Input id="quick-invoice-phone" label="Contact phone" type="tel" value={String(company.invoicePhone)} onChange={s=>setValue(setCompany,"invoicePhone",s)}/>
      </Grid>
      <div className="config-form-actions"><span>Tax treatment and numbering will be checked before the first invoice can be issued.</span><Button type="submit" disabled={saving}>{saving?"Saving…":"Save business details"}</Button>{activeEntities.length>0?<Button variant="ghost" onClick={()=>setQuickAddEntity(false)}>Cancel</Button>:null}</div>
     </form>
    </Card>:<Card className="quick-setup-card">
     <p className="eyebrow">YOUR BUSINESS</p>
     <div className="quick-setup-heading"><div><h2>Business profile</h2><p className="quick-setup-lead">Choose the business that will appear as the supplier on your invoices.</p></div><Button variant="secondary" onClick={()=>{setQuickAddEntity(true);setCompany(companyBlank())}}>Add another business</Button></div>
     <div className="config-record-list">{activeEntities.map(e=><RecordCard key={e.id} title={e.displayName} subtitle={e.legalName} meta={(e.countryCode??"Country not set")+" · "+e.currency} active={e.isActive}
      details={<><Detail label="Address">{[e.address?.line1,e.address?.city,e.address?.countryCode??e.countryCode].filter(Boolean).join(", ")||"Address incomplete"}</Detail><Detail label="Tax setup">{e.taxSetupStatus.replaceAll("_"," ").toLowerCase()}</Detail><Detail label="Contact">{e.invoiceEmail||e.invoicePhone||"Not added"}</Detail></>}
      actions={<><Button size="sm" variant="secondary" onClick={()=>{editEntity(e);setTab("company");setShowAdvancedSettings(true)}}>Edit full details</Button></>}/>)}</div>
    </Card>}
    {activeEntities.length>0?<Card className="quick-setup-card quick-setup-status-card">
     <p className="eyebrow">FIRST INVOICE STATUS</p>
     {quickReadiness?.ready?<h2>Core issuance checks passed</h2>:<h2>{quickReadiness?failedReadinessChecks+" setup checks need attention":"Invoice readiness has not been verified yet"}</h2>}
     <p>{quickReadiness?.ready?"Your current setup passed the available readiness checks. You can continue to create a draft and review the issue step.":"We keep this summary simple here. Open Advanced settings only when you need to review the tax, numbering, and other required invoice controls."}</p>
     {!quickReadiness?.ready?<Button variant="secondary" onClick={()=>{setTab("company");setShowAdvancedSettings(true)}}>Review invoice readiness</Button>:null}
    </Card>:null}
   </section>
   <aside className="quick-setup-secondary">
    <Card className="quick-setup-card">
     <p className="eyebrow">YOUR SIMPLE WORKFLOW</p><h2>From draft to paid</h2>
     <ol className="quick-setup-steps">
      <li><span>01</span><div><strong>Set up your business</strong><p>{activeEntities.length?"Business profile saved.":"Add the supplier details shown on the invoice."}</p></div></li>
      <li><span>02</span><div><strong>Add a customer</strong><p>Save the customer and their invoice email.</p><Link href="/customers" className="quick-setup-text-link">Go to customers <span aria-hidden="true">→</span></Link></div></li>
      <li><span>03</span><div><strong>Create and send an invoice</strong><p>Add line items, review the PDF, then issue and send it from the invoice workflow.</p>{activeEntities.length>0?<Link href="/invoices" className="button button--primary button--md quick-setup-full-link">Open invoices</Link>:<span className="quick-setup-muted">Available after you save a business profile.</span>}</div></li>
     </ol>
    </Card>
    <Card className="quick-setup-card quick-setup-boundary">
     <p className="eyebrow">WHAT STAYS SIMPLE</p><h2>No setup maze</h2>
     <p>Brands, business units, template versions, and detailed policy controls stay out of your way unless your business needs them.</p>
     <p>We will never invent a tax rate, registration number, invoice number, or bank detail. Required issue checks still protect your invoices.</p>
     <Button variant="ghost" onClick={()=>setShowAdvancedSettings(true)}>Open advanced settings</Button>
    </Card>
   </aside>
  </div>
 </div>;

 return <div className="page page--configuration">
  <Breadcrumbs items={[{label:"Configure"},{label:"Settings",href:"/settings"},{label:"Company & invoicing"}]}/>
  <PageHeader eyebrow="ADVANCED CONFIGURATION" title="Company & invoice configuration" description="Detailed company, tax, numbering, brand, and document controls. Changes are audited and versioned." action={<Button variant="secondary" onClick={()=>setShowAdvancedSettings(false)}>Back to quick setup</Button>}/>
  {error?<div className="config-message"><InlineAlert tone="danger" title="Configuration issue">{error}</InlineAlert><Button variant="secondary" onClick={()=>void loadAll()}>Reload</Button></div>:null}
  {notice?<div className="config-message"><InlineAlert tone="success" title="Saved">{notice}</InlineAlert><Button variant="ghost" size="sm" onClick={()=>setNotice("")}>Dismiss</Button></div>:null}
  <div className="config-scope-bar"><div className="config-scope-bar__copy"><span className="config-scope-dot"/><div><strong>Active configuration scope</strong><small>All records and mutations are filtered server-side by legal-entity authorization.</small></div></div>
   <div className="config-scope-bar__select"><SelectField id="configuration-entity" label="Working legal entity" value={entityId} onChange={e=>setEntityId(e.target.value)} options={entities.map(e=>({value:e.id,label:e.displayName+" · "+e.legalName}))} placeholder="Choose a legal entity"/></div>
  </div>
  <nav className="config-tabs" aria-label="Company configuration">{tabs.map(([id,label,subtitle])=><button type="button" key={id} className={tab===id?"config-tab config-tab--active":"config-tab"} aria-current={tab===id?"page":undefined} onClick={()=>setTab(id)}><span>{label}</span><small>{subtitle}</small></button>)}</nav>
  {tab==="company"?<div className="config-layout"><div className="config-main">
   <Heading label="LEGAL SUPPLIER IDENTITY" title={entityEdit&&entityEdit!=="new"?"Edit legal entity":"Legal entities"} description="A legal entity is the supplier named on an issued invoice. A logo or brand name does not create a legal entity."
    action={<Button onClick={()=>{setEntityEdit("new");setCompany(companyBlank())}}>Add legal entity</Button>}/>
   {entityEdit?<Card className="config-form-card"><form className="config-form" onSubmit={e=>void mutate(e,saveEntity,entityEdit==="new"?"Legal entity created; initial version captured.":"Configuration version saved.")}>
    <h3>Legal details</h3><Grid>
     <Input id="legalName" label="Registered legal name" required value={String(company.legalName)} onChange={s=>setValue(setCompany,"legalName",s)}/>
     <Input id="displayName" label="Display name" required value={String(company.displayName)} onChange={s=>setValue(setCompany,"displayName",s)}/>
     <Input id="registrationNumber" label="Company registration number" value={String(company.registrationNumber)} onChange={s=>setValue(setCompany,"registrationNumber",s)}/>
     <Input id="taxIdentifier" label="General / legacy tax identifier" value={String(company.taxIdentifier)} onChange={s=>setValue(setCompany,"taxIdentifier",s)} hint="Use the Tax tab for multiple effective-dated registrations."/>
     <Input id="countryCode" label="Country code" required value={String(company.countryCode)} onChange={s=>setValue(setCompany,"countryCode",s.toUpperCase())} hint="Two-letter country code; must match the address."/>
     <Input id="currency" label="Invoice currency" required value={String(company.currency)} onChange={s=>setValue(setCompany,"currency",s.toUpperCase())}/>
    </Grid>
    <h3>Registered address</h3><Grid>
     <Input id="line1" label="Address line 1" required value={String(company.line1)} onChange={s=>setValue(setCompany,"line1",s)}/>
     <Input id="line2" label="Address line 2" value={String(company.line2)} onChange={s=>setValue(setCompany,"line2",s)}/>
     <Input id="city" label="City" required value={String(company.city)} onChange={s=>setValue(setCompany,"city",s)}/>
     <Input id="state" label="State / region" value={String(company.state)} onChange={s=>setValue(setCompany,"state",s)}/>
     <Input id="postalCode" label="Postal code" required value={String(company.postalCode)} onChange={s=>setValue(setCompany,"postalCode",s)}/>
    </Grid>
    <h3>Billing address</h3><p className="config-muted">Leave all fields blank to indicate that the registered address is also used for billing.</p><Grid>
     <Input id="billingLine1" label="Billing address line 1" value={String(company.billingLine1)} onChange={s=>setValue(setCompany,"billingLine1",s)}/>
     <Input id="billingLine2" label="Billing address line 2" value={String(company.billingLine2)} onChange={s=>setValue(setCompany,"billingLine2",s)}/>
     <Input id="billingCity" label="Billing city" value={String(company.billingCity)} onChange={s=>setValue(setCompany,"billingCity",s)}/>
     <Input id="billingState" label="Billing state / region" value={String(company.billingState)} onChange={s=>setValue(setCompany,"billingState",s)}/>
     <Input id="billingPostalCode" label="Billing postal code" value={String(company.billingPostalCode)} onChange={s=>setValue(setCompany,"billingPostalCode",s)}/>
     <Input id="billingCountryCode" label="Billing country code" value={String(company.billingCountryCode)} onChange={s=>setValue(setCompany,"billingCountryCode",s.toUpperCase())} hint="Defaults to the registered country when not set."/>
    </Grid>
    <h3>Invoice identity and terms</h3><Grid>
     <Input id="invoiceEmail" label="Invoice email" type="email" value={String(company.invoiceEmail)} onChange={s=>setValue(setCompany,"invoiceEmail",s)}/>
     <Input id="invoicePhone" label="Invoice phone" value={String(company.invoicePhone)} onChange={s=>setValue(setCompany,"invoicePhone",s)}/>
     <Input id="website" label="Website" type="url" value={String(company.website)} onChange={s=>setValue(setCompany,"website",s)}/>
     <Input id="locale" label="Locale" value={String(company.locale)} onChange={s=>setValue(setCompany,"locale",s)}/>
     <Input id="timeZone" label="IANA time zone" value={String(company.timeZone)} onChange={s=>setValue(setCompany,"timeZone",s)} hint="For example Asia/Kolkata."/>
     <Input id="logoReference" label="Logo reference" value={String(company.logoReference)} onChange={s=>setValue(setCompany,"logoReference",s)} hint="Asset/storage reference. A secure upload provider is not activated by this phase."/>
    </Grid>
    <TextAreaField id="invoiceTerms" label="Invoice terms" value={String(company.invoiceTerms)} onChange={e=>setValue(setCompany,"invoiceTerms",e.target.value)} rows={3}/>
    <TextAreaField id="invoiceFooter" label="Invoice footer / legal text" value={String(company.invoiceFooter)} onChange={e=>setValue(setCompany,"invoiceFooter",e.target.value)} rows={3}/>
    <Input id="defaultTaxCode" label="Default tax code" value={String(company.defaultTaxCode)} onChange={s=>setValue(setCompany,"defaultTaxCode",s)} hint="Reference only; rates must be separately approved in Tax."/>
    <h3>Finance / tax approval</h3><Grid>
     <Select id="taxSetupStatus" label="Tax configuration state" value={String(company.taxSetupStatus)} onChange={s=>setValue(setCompany,"taxSetupStatus",s)} required options={[
      {value:"UNCONFIGURED",label:"Unconfigured — issuance blocked"},{value:"APPROVED_CONFIGURED",label:"Approved and configured"},
      {value:"APPROVED_NOT_APPLICABLE",label:"Approved as not applicable"}]}/>
     <Input id="taxSetupApprovalReference" label="Finance/tax approval reference" value={String(company.taxSetupApprovalReference)} onChange={s=>setValue(setCompany,"taxSetupApprovalReference",s)} hint="A reference is required for either approved state."/>
    </Grid>
    <h3>Bank details</h3>
    {entity?.bankDetailsConfigured&&entityEdit!== "new"?<InlineAlert title="Existing bank details are protected" tone="info">Account ending {entity.bankAccountLast4??"not shown"}. Full values are not returned through the normal settings API.</InlineAlert>:null}
    <label className="config-checkbox"><input type="checkbox" checked={company.replaceBank===true} onChange={e=>{setValue(setCompany,"replaceBank",e.target.checked)}}/><span>Enter or replace bank details (requires full replacement; blank fields will not be sent if this remains unchecked)</span></label>
    {company.replaceBank===true||entityEdit==="new"?<Grid>
     <Input id="bankAccountName" label="Account holder" value={String(company.bankAccountName)} onChange={s=>setValue(setCompany,"bankAccountName",s)} required={company.replaceBank===true}/>
     <Input id="bankName" label="Bank name" value={String(company.bankName)} onChange={s=>setValue(setCompany,"bankName",s)} required={company.replaceBank===true}/>
     <Input id="bankAccountNumber" label="Account number" type="password" value={String(company.bankAccountNumber)} onChange={s=>setValue(setCompany,"bankAccountNumber",s)} required={company.replaceBank===true} hint="Never shown after saving; only its last four digits are returned."/>
     <Input id="bankIfsc" label="IFSC / routing code" value={String(company.bankIfsc)} onChange={s=>setValue(setCompany,"bankIfsc",s)}/>
     <Input id="bankSwift" label="SWIFT / BIC" value={String(company.bankSwift)} onChange={s=>setValue(setCompany,"bankSwift",s)}/>
    </Grid>:null}
    <TextField id="changeReason" label="Reason for change" required minLength={3} value={String(company.changeReason)} onChange={e=>setValue(setCompany,"changeReason",e.target.value)}/>
    <div className="config-form-actions"><Button type="submit" disabled={saving}>{saving?"Saving…":entityEdit==="new"?"Create entity":"Save new version"}</Button><Button variant="ghost" onClick={()=>{setEntityEdit("");setCompany(companyBlank())}}>Cancel</Button></div>
   </form></Card>:null}
   {entities.length===0?<EmptyState title="No legal entities in your scope" description="Add an explicit legal identity. No entity mappings or tax details are guessed." icon="building"/>:
    <div className="config-record-list">{entities.map(e=>{return <RecordCard key={e.id} title={e.displayName} subtitle={e.legalName} meta={(e.countryCode??"Country unset")+" · "+e.currency} active={e.isActive}
     details={<><Detail label="Address">{[e.address?.line1,e.address?.city,e.countryCode].filter(Boolean).join(", ")||"Incomplete"}</Detail><Detail label="Tax setup">{e.taxSetupStatus.replaceAll("_"," ").toLowerCase()}</Detail><Detail label="Bank details">{e.bankDetailsConfigured?"Configured"+(e.bankAccountLast4?" · •••• "+e.bankAccountLast4:""):"Not configured"}</Detail></>}
     actions={<><Button size="sm" variant="secondary" onClick={()=>editEntity(e)}>Edit</Button><Button size="sm" variant={e.isActive?"danger":"secondary"} onClick={()=>void mutate(undefined,()=>api("/api/v1/legal-entities/"+e.id,"PATCH",{isActive:!e.isActive,changeReason:e.isActive?"Legal entity deactivation":"Legal entity reactivation"}),e.isActive?"Legal entity deactivated.":"Legal entity reactivated.")}>{e.isActive?"Deactivate":"Reactivate"}</Button></>}/>})}</div>}
  </div><aside className="config-aside"><Card className="config-readiness-card"><p className="eyebrow">ISSUANCE GUARD</p><h3>{entity?(readiness[entity.id]?.ready?"Readiness checks passed":"Configuration readiness"):"Select an entity"}</h3><p>Passing readiness checks does not issue an invoice; the issue workflow remains a separate controlled operation.</p>
   {entity&&readiness[entity.id]?<ul className="config-check-list">{readiness[entity.id].checks.map(c=><li key={c.key}><span className={c.passed?"config-check config-check--pass":"config-check"}>{c.passed?"✓":"!"}</span><span>{c.passed?c.key.replace(/([A-Z])/g," $1").replace(/^./,s=>s.toUpperCase()):c.message}</span></li>)}</ul>:null}<Button variant="secondary" className="config-readiness-refresh" onClick={()=>void loadAll()}>Refresh checklist</Button></Card>
   <Card className="config-note-card"><p className="eyebrow">BOUNDARIES</p><h3>One entity, one supplier</h3><p>Brands are presentation identities; business units organize operations. Neither can silently replace the legal supplier identity.</p></Card>
  </aside></div>:null}

  {tab==="brands"?<div className="config-main config-main--full">
   <Heading label="COMMERCIAL IDENTITIES" title="Brands" description="A brand can map to multiple authorized entities; an entity can carry multiple explicitly mapped brands." action={<Button onClick={()=>{setBrandEdit("");setBrand(brandBlank())}}>New brand</Button>}/>
   <Card className="config-form-card"><form className="config-form" onSubmit={e=>void mutate(e,saveBrand,brandEdit?"Brand version saved.":"Brand and entity mappings saved.")}><Grid>
    <Input id="brandName" label="Brand name" value={String(brand.name)} required onChange={s=>setValue(setBrand,"name",s)}/>
    <Input id="brandCode" label="Stable brand code" value={String(brand.code)} required disabled={Boolean(brandEdit)} onChange={s=>setValue(setBrand,"code",s.toUpperCase())}/>
    <Input id="brandLogo" label="Logo reference" value={String(brand.logoReference)} onChange={s=>setValue(setBrand,"logoReference",s)} hint="Select a supplied brand asset below; custom storage references require an approved asset pipeline."/>
    <Input id="brandTemplate" label="Preferred template key" value={String(brand.defaultTemplateKey)} onChange={s=>setValue(setBrand,"defaultTemplateKey",s)}/>
    <Select id="brandAccent" label="Presentation accent" value={String(brand.themeAccent)} onChange={s=>setValue(setBrand,"themeAccent",s)} options={APPROVED_BRAND_COLORS.map(c=>({value:c.value,label:c.name+" · "+c.value}))}/>
    <Select id="brandStyle" label="Presentation style" value={String(brand.themeStyle)} onChange={s=>setValue(setBrand,"themeStyle",s)} options={[{value:"STANDARD",label:"Standard"},{value:"MINIMAL",label:"Minimal"},{value:"EDITORIAL",label:"Editorial"}]}/>
   </Grid><div className="form-field form-field--wide"><span className="form-label">Approved logo asset</span><p className="form-hint">Choose only an asset from the approved brand library. Selecting a logo also applies its documented accent.</p><div className="brand-logo-picker" role="group" aria-label="Choose a brand logo">{BRAND_LOGO_ASSETS.map(asset=><button key={asset.code} type="button" className="brand-logo-picker__choice" aria-pressed={String(brand.logoReference)===asset.logoReference} onClick={()=>{setValue(setBrand,"logoReference",asset.logoReference);setValue(setBrand,"themeAccent",asset.accentColor)}}><span className="brand-logo-picker__preview"><Image src={asset.logoReference} alt="" width={120} height={52} unoptimized /></span><span className="brand-logo-picker__copy"><strong>{asset.name}</strong><small>{asset.audience} identity</small><span style={{"--brand-accent":asset.accentColor} as CSSProperties}/></span></button>)}</div></div><TextAreaField id="brandDescription" label="Description" value={String(brand.description)} onChange={e=>setValue(setBrand,"description",e.target.value)} rows={2}/>
   <TextField id="brandEntities" label="Legal entity UUIDs" required value={String(brand.legalEntityIds)} onChange={e=>setValue(setBrand,"legalEntityIds",e.target.value)} hint="Comma-separated IDs from your entity list; the server verifies each mapping."/>
   <TextField id="brandReason" label="Reason for change" required value={String(brand.changeReason)} onChange={e=>setValue(setBrand,"changeReason",e.target.value)}/>
   <div className="config-form-actions"><Button type="submit" disabled={saving}>{saving?"Saving…":brandEdit?"Save brand version":"Create brand"}</Button>{brandEdit?<Button variant="ghost" onClick={()=>{setBrandEdit("");setBrand(brandBlank())}}>Cancel</Button>:null}</div></form></Card>
   {brands.length===0?<EmptyState title="No mapped brands" description="Create a brand and select the legal entities it is explicitly permitted to represent." icon="box"/>:<div className="config-record-list">{brands.map(b=><RecordCard key={b.id} title={b.name} subtitle={b.code} meta={b.description??"Brand identity"} active={b.isActive}
    details={<><Detail label="Entity mappings">{b.legalEntityMappings.length}</Detail><Detail label="Logo">{b.logoReference||"Not set"}</Detail><Detail label="Preferred template">{b.defaultTemplateKey||"None"}</Detail></>}
    actions={<><Button size="sm" variant="secondary" onClick={()=>{setBrandEdit(b.id);setBrand({name:b.name,code:b.code,description:b.description??"",logoReference:b.logoReference??"",defaultTemplateKey:b.defaultTemplateKey??"",themeAccent:typeof b.theme?.accentColor==="string"?b.theme.accentColor:"#931314",themeStyle:typeof b.theme?.presentationStyle==="string"?b.theme.presentationStyle:"STANDARD",legalEntityIds:b.legalEntityMappings.map(m=>m.legalEntityId).join(", "),changeReason:"Update brand configuration"})}}>Edit</Button><Button size="sm" variant={b.isActive?"danger":"secondary"} onClick={()=>void toggle("/api/v1/brands/"+b.id,b.isActive,b.name)}>{b.isActive?"Deactivate":"Reactivate"}</Button></>}/>)}</div>}
  </div>:null}

  {tab==="units"?<div className="config-main config-main--full">
   <Heading label="ORGANIZATIONAL STRUCTURE" title="Business units" description="A business unit is an operating grouping, separate from legal supplier entities and customer-facing brands." action={<Button onClick={()=>{setUnitEdit("");setUnit(unitBlank())}}>New business unit</Button>}/>
   <Card className="config-form-card"><form className="config-form" onSubmit={e=>void mutate(e,saveUnit,unitEdit?"Business unit version saved.":"Business unit mapped and saved.")}><Grid>
    <Input id="unitCode" label="Stable unit code" value={String(unit.code)} required disabled={Boolean(unitEdit)} onChange={s=>setValue(setUnit,"code",s.toUpperCase())}/>
    <Input id="unitName" label="Business unit name" value={String(unit.name)} required onChange={s=>setValue(setUnit,"name",s)}/>
   </Grid><TextAreaField id="unitDescription" label="Description" value={String(unit.description)} onChange={e=>setValue(setUnit,"description",e.target.value)} rows={2}/>
   <TextField id="unitEntities" label="Legal entity UUIDs" required value={String(unit.legalEntityIds)} onChange={e=>setValue(setUnit,"legalEntityIds",e.target.value)} hint="Comma-separated, in-scope entity IDs."/>
   <TextField id="unitBrands" label="Brand UUIDs" value={String(unit.brandIds)} onChange={e=>setValue(setUnit,"brandIds",e.target.value)} hint="Optional; each must map to at least one selected entity."/>
   <TextField id="unitReason" label="Reason for change" required value={String(unit.changeReason)} onChange={e=>setValue(setUnit,"changeReason",e.target.value)}/>
   <div className="config-form-actions"><Button type="submit" disabled={saving}>{saving?"Saving…":unitEdit?"Save unit version":"Create business unit"}</Button>{unitEdit?<Button variant="ghost" onClick={()=>{setUnitEdit("");setUnit(unitBlank())}}>Cancel</Button>:null}</div></form></Card>
   {units.length===0?<EmptyState title="No accessible business units" description="Create a business unit and explicitly map it to active legal entities." icon="users"/>:<div className="config-record-list">{units.map(u=><RecordCard key={u.id} title={u.name} subtitle={u.code} meta={u.description??"Operating unit"} active={u.isActive}
    details={<><Detail label="Legal entities">{u.legalEntities.length}</Detail><Detail label="Brands">{u.brandIds.length}</Detail><Detail label="Scope">Explicitly mapped</Detail></>}
    actions={<><Button size="sm" variant="secondary" onClick={()=>{setUnitEdit(u.id);setUnit({code:u.code,name:u.name,description:u.description??"",legalEntityIds:u.legalEntities.map(x=>x.id).join(", "),brandIds:u.brandIds.join(", "),changeReason:"Update business unit"})}}>Edit</Button><Button size="sm" variant={u.isActive?"danger":"secondary"} onClick={()=>void toggle("/api/v1/business-units/"+u.id,u.isActive,u.name)}>{u.isActive?"Deactivate":"Reactivate"}</Button></>}/>)}</div>}
  </div>:null}

  {tab==="tax"?<div className="config-main config-main--full">
   <Heading label="TAX POLICY" title="Registrations and tax rules" description="Tax identifiers and rules are effective-dated, tied to a legal entity, and require an explicitly recorded finance approval."/>
   {!entity?<EmptyState title="Select a legal entity" description="Tax records must belong to a legal supplier." icon="building"/>:<>
    <Card className="config-context-card"><div><p className="eyebrow">CURRENT ENTITY</p><h3>{entity.legalName}</h3><p>{entity.displayName} · {entity.countryCode??"Country not set"}</p></div><StatusBadge tone={entity.taxSetupStatus==="UNCONFIGURED"?"warning":"info"}>{entity.taxSetupStatus.replaceAll("_"," ")}</StatusBadge></Card>
    <div className="config-two-column"><Card className="config-form-card"><Heading label="REGISTRATION" title="Add or revise a registration" description="Reuse the stable key for a later version; past versions remain available for document snapshots."/>
     <form className="config-form" onSubmit={e=>void mutate(e,saveRegistration,"Tax registration version saved.")}><Grid>
      <Input id="regKey" label="Stable registration key" value={String(registration.registrationKey)} required onChange={s=>setValue(setRegistration,"registrationKey",s.toUpperCase())}/>
      <Select id="regType" label="Registration type" value={String(registration.registrationType)} onChange={s=>setValue(setRegistration,"registrationType",s)} required options={[{value:"GSTIN",label:"GSTIN"},{value:"VAT",label:"VAT"},{value:"TAX_ID",label:"Tax ID"},{value:"COMPANY_REGISTRATION",label:"Company registration"},{value:"OTHER",label:"Other"}]}/>
      <Input id="regLabel" label="Display label" value={String(registration.displayLabel)} required onChange={s=>setValue(setRegistration,"displayLabel",s)}/>
      <Input id="regJurisdiction" label="Jurisdiction" value={String(registration.jurisdiction)} required onChange={s=>setValue(setRegistration,"jurisdiction",s)}/>
      <Input id="regNumber" label="Registration number" value={String(registration.registrationNumber)} required onChange={s=>setValue(setRegistration,"registrationNumber",s)}/>
      <Input id="regFrom" label="Effective from" type="date" value={String(registration.effectiveFrom)} required onChange={s=>setValue(setRegistration,"effectiveFrom",s)}/>
      <Input id="regUntil" label="Effective until" type="date" value={String(registration.effectiveUntil)} onChange={s=>setValue(setRegistration,"effectiveUntil",s)}/>
      <Input id="regApproval" label="Finance approval reference" value={String(registration.approvalReference)} required onChange={s=>setValue(setRegistration,"approvalReference",s)}/>
     </Grid><label className="config-checkbox"><input type="checkbox" checked={registration.isPrimary===true} onChange={e=>setValue(setRegistration,"isPrimary",e.target.checked)}/><span>Primary registration of this type</span></label>
     <TextField id="regReason" label="Reason for change" required value={String(registration.changeReason)} onChange={e=>setValue(setRegistration,"changeReason",e.target.value)}/><Button type="submit" disabled={saving}>{saving?"Saving…":"Save approved registration"}</Button></form>
    </Card><Card className="config-form-card"><Heading label="TAX RULE" title="Add approved tax rule" description="The API rate unit is percentage points. Actual tax values must come from your finance/tax reviewer."/>
     <form className="config-form" onSubmit={e=>void mutate(e,saveTax,"Tax rule saved and approved.")}><Grid>
      <Input id="taxCode" label="Tax code" value={String(tax.taxCode)} required onChange={s=>setValue(setTax,"taxCode",s.toUpperCase())}/>
      <Input id="taxName" label="Display name" value={String(tax.displayName)} required onChange={s=>setValue(setTax,"displayName",s)}/>
      <Input id="taxJurisdiction" label="Jurisdiction" value={String(tax.jurisdiction)} required onChange={s=>setValue(setTax,"jurisdiction",s)}/>
      <Input id="taxRate" label="Rate (%)" type="number" value={String(tax.ratePercent)} required onChange={s=>setValue(setTax,"ratePercent",s)}/>
      <Select id="taxMode" label="Tax treatment" value={String(tax.calculationMode)} onChange={s=>setValue(setTax,"calculationMode",s)} required options={[{value:"EXCLUSIVE",label:"Tax exclusive"},{value:"INCLUSIVE",label:"Tax inclusive"}]}/>
      <Input id="taxFrom" label="Effective from" type="date" value={String(tax.effectiveFrom)} required onChange={s=>setValue(setTax,"effectiveFrom",s)}/>
      <Input id="taxUntil" label="Effective until" type="date" value={String(tax.effectiveUntil)} onChange={s=>setValue(setTax,"effectiveUntil",s)}/>
      <Input id="taxApproval" label="Finance/tax approval reference" value={String(tax.approvalReference)} required onChange={s=>setValue(setTax,"approvalReference",s)}/>
     </Grid><TextField id="taxReason" label="Reason for change" required value={String(tax.changeReason)} onChange={e=>setValue(setTax,"changeReason",e.target.value)}/>
     <Button type="submit" disabled={saving||entity.taxSetupStatus!=="APPROVED_CONFIGURED"}>Save tax rule</Button>{entity.taxSetupStatus!=="APPROVED_CONFIGURED"?<p className="config-muted">First approve the entity as “Approved and configured”. The API separately verifies finance authority.</p>:null}</form>
    </Card></div>
    <Heading label="TAX REGISTRATION HISTORY" title="Registrations" description="Registration identifiers are visible only to authorized users in the entity's scope; deactivate instead of deleting."/>
    {registrations.length===0?<EmptyState title="No tax registrations" description="Record a tax registration only after approval. No values are inferred." icon="shield"/>:<div className="config-record-list">{registrations.map(r=><RecordCard key={r.id} title={r.displayLabel} subtitle={r.registrationType+" · "+r.registrationNumber} meta={r.registrationKey+" · Version "+r.versionNumber} active={r.isActive}
      details={<><Detail label="Jurisdiction">{r.jurisdiction}</Detail><Detail label="Effective">{compactDate(r.effectiveFrom)+" → "+compactDate(r.effectiveUntil)}</Detail><Detail label="Approval">{r.approvalReference}</Detail></>}
      actions={r.isActive?<Button size="sm" variant="danger" onClick={()=>void toggle("/api/v1/legal-entities/"+entityId+"/tax-registrations/"+r.id,r.isActive,r.displayLabel)}>Deactivate version</Button>:null}/>)}</div>}
    <Heading label="EFFECTIVE TAX RULES" title="Tax rule registry" description="Overlapping active effective windows for the same code are rejected."/>
    {taxRules.filter(r=>r.legalEntityId===entityId).length===0?<EmptyState title="No rules configured" description="Create approved rules only when supported by your current accounting/tax policy." icon="file"/>:<div className="config-record-list">{taxRules.filter(r=>r.legalEntityId===entityId).map(r=><RecordCard key={r.id} title={r.displayName} subtitle={r.taxCode+" · "+r.jurisdiction} meta={r.ratePercent+"% · "+r.calculationMode} active={r.isActive}
     details={<><Detail label="Effective">{compactDate(r.effectiveFrom)+" → "+compactDate(r.effectiveUntil)}</Detail><Detail label="Approval">{r.approvalReference??"Not recorded"}</Detail></>}
     actions={<Button size="sm" variant={r.isActive?"danger":"secondary"} onClick={()=>void toggle("/api/v1/tax-rules/"+r.id,r.isActive,r.taxCode)}>{r.isActive?"Deactivate":"Reactivate"}</Button>}/>)}</div>}
   </>}
  </div>:null}

  {tab==="numbering"?<div className="config-main config-main--full">
   <Heading label="DOCUMENT NUMBERING" title="Numbering series and financial-year rules" description="Sequence counters are separate from versioned series. A change to a prefix never resets or reuses an allocated number."/>
   {!entity?<EmptyState title="Select a legal entity" description="Every series is owned by one legal supplier." icon="building"/>:<>
    <Card className="config-form-card"><form className="config-form" onSubmit={e=>void mutate(e,saveNumbering,"Numbering series configuration saved.")}><Grid>
     <Select id="numType" label="Document type" value={String(numbering.documentType)} required onChange={s=>setValue(setNumbering,"documentType",s)} options={[{value:"INVOICE",label:"Invoice"},{value:"CREDIT_NOTE",label:"Credit note"},{value:"DEBIT_NOTE",label:"Debit note"},{value:"QUOTATION",label:"Quotation"}]}/>
     <Input id="numSeries" label="Series code" value={String(numbering.seriesCode)} required onChange={s=>setValue(setNumbering,"seriesCode",s.toUpperCase())}/>
     <Input id="numPrefix" label="Prefix" value={String(numbering.prefix)} onChange={s=>setValue(setNumbering,"prefix",s)}/>
     <Input id="numSuffix" label="Suffix" value={String(numbering.suffix)} onChange={s=>setValue(setNumbering,"suffix",s)}/>
     <Input id="numWidth" label="Sequence width" type="number" value={String(numbering.sequenceWidth)} required onChange={s=>setValue(setNumbering,"sequenceWidth",s)}/>
     <Input id="fyMonth" label="Financial-year start month" type="number" value={String(numbering.financialYearStartMonth)} required onChange={s=>setValue(setNumbering,"financialYearStartMonth",s)}/>
     <Input id="fyDay" label="Financial-year start day" type="number" value={String(numbering.financialYearStartDay)} required onChange={s=>setValue(setNumbering,"financialYearStartDay",s)}/>
     <Input id="numZone" label="Financial-year IANA time zone" value={String(numbering.timeZone)} required onChange={s=>setValue(setNumbering,"timeZone",s)}/>
     <Input id="numFrom" label="Effective from" type="date" value={String(numbering.effectiveFrom)} required onChange={s=>setValue(setNumbering,"effectiveFrom",s)}/>
     <Input id="numUntil" label="Effective until" type="date" value={String(numbering.effectiveUntil)} onChange={s=>setValue(setNumbering,"effectiveUntil",s)}/>
     <Input id="numApproval" label="Finance approval reference" value={String(numbering.approvalReference)} required onChange={s=>setValue(setNumbering,"approvalReference",s)}/>
    </Grid><label className="config-checkbox"><input type="checkbox" checked={numbering.includeFinancialYear===true} onChange={e=>setValue(setNumbering,"includeFinancialYear",e.target.checked)}/><span>Include financial-year label in displayed number</span></label>
    <label className="config-checkbox"><input type="checkbox" checked={numbering.activate===true} onChange={e=>setValue(setNumbering,"activate",e.target.checked)}/><span>Activate immediately (requires finance administrator and no overlapping series)</span></label>
    <TextField id="numReason" label="Reason for change" required value={String(numbering.changeReason)} onChange={e=>setValue(setNumbering,"changeReason",e.target.value)}/>
    <div className="config-preview-number"><small>Illustrative format only — no number has been allocated</small><strong>{String(numbering.prefix)+(numbering.includeFinancialYear?"YYYY-YYYY":"")+"0".repeat(Math.max(1,Math.min(12,Number(numbering.sequenceWidth)||5)))+String(numbering.suffix)}</strong></div>
    <Button type="submit" disabled={saving}>Save numbering version</Button></form></Card>
    {numberings.filter(n=>n.legalEntityId===entityId).length===0?<EmptyState title="No numbering series" description="A finance-approved invoice series is required for readiness." icon="invoice"/>:<div className="config-record-list">{numberings.filter(n=>n.legalEntityId===entityId).map(n=><RecordCard key={n.id} title={n.documentType+" · "+n.seriesCode} subtitle={n.prefix+(n.includeFinancialYear?"FY":"")+"0".repeat(Math.max(1,Math.min(12,n.sequenceWidth)))+n.suffix} meta={"Version "+n.versionNumber+" · FY starts "+n.financialYearStartDay+"/"+n.financialYearStartMonth+" · "+n.timeZone} active={n.isActive}
     details={<><Detail label="Effective">{compactDate(n.effectiveFrom)+" → "+compactDate(n.effectiveUntil)}</Detail><Detail label="Approval">{n.approvalReference??"Missing"}</Detail></>}
     actions={<Button size="sm" variant={n.isActive?"danger":"secondary"} onClick={()=>void toggle("/api/v1/numbering-configs/"+n.id,n.isActive,n.seriesCode)}>{n.isActive?"Deactivate":"Activate"}</Button>}/>)}</div>}
   </>}
  </div>:null}

  {tab==="templates"?<div className="config-main config-main--full">
   <Heading label="DOCUMENT PRESENTATION" title="Invoice and document templates" description="Configure versioned document rules and compare them against sanitized invoice-layout reconstructions based on the supplied brand samples. Reference artwork is not an active template or an issued PDF."/>
   <section className="config-template-reference" aria-labelledby="config-template-reference-title">
    <div className="config-template-reference__heading">
     <p className="eyebrow">BRAND &amp; TEMPLATE REFERENCES</p>
     <h3 id="config-template-reference-title">Invoice layout reference reconstructions</h3>
     <p>These editable SVG reference layouts are visual reconstructions guided by your supplied MyFX POS, Digitech and Coworks sample pack. They are shown for design matching only; they are not pixel copies of the source sheets and do not create a configured template, store customer data, allocate a document number or issue an invoice.</p>
    </div>
    <div className="config-template-reference-grid">
     <article className="config-template-reference-card">
      <div className="config-template-reference-card__brand config-template-reference-card__brand--myfx"><Image src="/brand/myfx-pos.webp" alt="MyFX POS logo from supplied brand pack" width={360} height={142}/></div>
      <Image className="config-template-reference-card__image" src="/brand/templates/myfx-pos-sample.svg" alt="MyFX POS invoice reference reconstruction, not issued" width={680} height={962}/>
      <div className="config-template-reference-card__body"><strong>MyFX POS</strong><span>POS invoice layout reconstructed for visual comparison.</span><span className="config-template-reference-card__status">Reference only · not active</span></div>
     </article>
     <article className="config-template-reference-card">
      <div className="config-template-reference-card__brand"><Image src="/brand/fx-digitech.webp" alt="FX Digitech logo from supplied brand pack" width={360} height={94}/></div>
      <Image className="config-template-reference-card__image" src="/brand/templates/digitech-sample.svg" alt="Digitech invoice reference reconstruction, not issued" width={680} height={962}/>
      <div className="config-template-reference-card__body"><strong>Digitech</strong><span>Digital services invoice layout reconstructed for visual comparison.</span><span className="config-template-reference-card__status">Reference only · not active</span></div>
     </article>
     <article className="config-template-reference-card">
      <div className="config-template-reference-card__brand"><Image src="/brand/fx-coworks.webp" alt="FX Coworks logo from supplied brand pack" width={226} height={180}/></div>
      <Image className="config-template-reference-card__image" src="/brand/templates/coworks-sample.svg" alt="Coworks invoice reference reconstruction, not issued" width={680} height={962}/>
      <div className="config-template-reference-card__body"><strong>Coworks</strong><span>Coworking invoice layout reconstructed for visual comparison.</span><span className="config-template-reference-card__status">Reference only · not active</span></div>
     </article>
    </div>
   </section>
   {!entity?<EmptyState title="Select a legal entity" description="Every template is owned by one legal entity." icon="building"/>:<>
    <Card className="config-form-card"><form className="config-form" onSubmit={e=>void mutate(e,saveTemplate,"Document template saved.")}><Grid>
     <Select id="tplType" label="Document type" value={String(template.documentType)} required onChange={s=>setValue(setTemplate,"documentType",s)} options={[{value:"INVOICE",label:"Invoice"},{value:"CREDIT_NOTE",label:"Credit note"},{value:"DEBIT_NOTE",label:"Debit note"},{value:"QUOTATION",label:"Quotation"}]}/>
     <Select id="tplBrand" label="Optional brand" value={String(template.brandId)} onChange={s=>setValue(setTemplate,"brandId",s)} options={accessibleBrands.map(b=>({value:b.id,label:b.name+" · "+b.code}))}/>
     <Input id="tplKey" label="Template key" value={String(template.templateKey)} required onChange={s=>setValue(setTemplate,"templateKey",s.toUpperCase())}/>
     <Input id="tplName" label="Template display name" value={String(template.displayName)} required onChange={s=>setValue(setTemplate,"displayName",s)}/>
     <Input id="tplFrom" label="Effective from" type="date" value={String(template.effectiveFrom)} required onChange={s=>setValue(setTemplate,"effectiveFrom",s)}/>
     <Input id="tplUntil" label="Effective until" type="date" value={String(template.effectiveUntil)} onChange={s=>setValue(setTemplate,"effectiveUntil",s)}/>
    </Grid><TextAreaField id="tplConfig" label="Validated template configuration (JSON)" value={String(template.templateConfig)} required onChange={e=>setValue(setTemplate,"templateConfig",e.target.value)} rows={12} hint="Supported keys: pageSize, orientation, layout, accentColor, showLogo, showTaxBreakdown, showBankDetails, showPaymentTerms, showCustomerTaxIdentifier, showFooter, footerText."/>
    <label className="config-checkbox"><input type="checkbox" checked={template.activate===true} onChange={e=>setValue(setTemplate,"activate",e.target.checked)}/><span>Activate now if there is no overlapping active template for this entity/brand/type</span></label>
    <TextField id="tplReason" label="Reason for change" required value={String(template.changeReason)} onChange={e=>setValue(setTemplate,"changeReason",e.target.value)}/><Button type="submit" disabled={saving}>Save template version</Button></form></Card>
    <TemplatePreview config={templatePreviewConfig} title={String(template.displayName)} documentType={String(template.documentType)} issuerName={entity.displayName} logoSource={selectedLogo.logoReference} logoAlt={selectedLogo.name}/>
    {templates.filter(t=>t.legalEntityId===entityId).length===0?<EmptyState title="No templates yet" description="An active invoice template is required for readiness." icon="file"/>:<div className="config-record-list">{templates.filter(t=>t.legalEntityId===entityId).map(t=><RecordCard key={t.id} title={t.displayName} subtitle={t.templateKey+" · "+t.documentType} meta={"Version "+t.versionNumber+" · "+(t.brandId?accessibleBrands.find(b=>b.id===t.brandId)?.name??"Brand-specific":"Entity default")} active={t.isActive}
     details={<><Detail label="Page">{String(t.templateConfig.pageSize??"—")+" · "+String(t.templateConfig.orientation??"—")}</Detail><Detail label="Tax breakdown">{t.templateConfig.showTaxBreakdown?"Shown":"Hidden"}</Detail><Detail label="Effective">{compactDate(t.effectiveFrom)+" → "+compactDate(t.effectiveUntil)}</Detail></>}
     actions={<Button size="sm" variant={t.isActive?"danger":"secondary"} onClick={()=>void toggle("/api/v1/document-templates/"+t.id,t.isActive,t.displayName)}>{t.isActive?"Deactivate":"Activate"}</Button>}/>)}</div>}
   </>}
  </div>:null}
  <div className="config-footer-note"><strong>Deployment boundary:</strong> configuration and versioning are implemented here. Production migration execution, company-approved values, logo upload/object storage, and live invoice issuance/PDF delivery remain separate activation/feature gates.</div>
 </div>;
}
