import "server-only";

import PDFDocument from "pdfkit";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

export type PdfSnapshot = {
  sourceType: "INVOICE" | "QUOTATION" | "RECEIPT";
  sourceDocumentId: string;
  documentNumber: string;
  lifecycleStatus: string;
  documentDate: string | null;
  dueDate: string | null;
  validUntil: string | null;
  currency: string;
  subtotal: string;
  discountTotal: string;
  taxTotal: string;
  grandTotal: string;
  paidAmount: string;
  paymentStatus: string;
  notes: string | null;
  supplier: unknown;
  customer: unknown;
  configurationSnapshotId: string | null;
  configurationSha256: string | null;
  configurationSnapshot: unknown;
  lines: unknown[];
  method?: string;
  reference?: string | null;
  reversalReason?: string | null;
  [key: string]: unknown;
};

function object(value: unknown): Record<string, unknown> {
  if (typeof value === "string") { try { value = JSON.parse(value) as unknown; } catch { return {}; } }
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function text(value: unknown, fallback = "—"): string {
  if (value === null || value === undefined || value === "") return fallback;
  if (typeof value === "object") return fallback;
  return String(value).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g," ").trim() || fallback;
}
function addressLines(value: unknown): string[] {
  const address = object(value);
  return ["line1","line2","addressLine1","addressLine2","city","district","state","postalCode","postal_code","country","countryCode"]
    .map(key => address[key]).filter(v => typeof v === "string" && v.trim()).map(v => String(v).trim());
}
function fontPath(): string {
  const root = resolve(process.cwd(),"node_modules","@fontsource","noto-sans");
  const candidates = [
    join(root,"files","noto-sans-devanagari-400-normal.woff2"),
    join(root,"files","noto-sans-latin-400-normal.woff2"),
    join(root,"files","noto-sans-latin-400-normal.woff"),
  ];
  return candidates.find(existsSync) ?? "";
}
const amt = (value: unknown) => text(value,"0.0000");

export async function renderDocumentPdf(snapshot: PdfSnapshot, capturedAt: Date | string): Promise<Buffer> {
  return await new Promise<Buffer>((resolveBuffer,rejectBuffer) => {
    const config = object(snapshot.configurationSnapshot);
    const brand = object(config.brand);
    const template = object(config.template);
    const templateConfig = object(template.config);
    const candidateColor = text(templateConfig.primaryColor ?? templateConfig.accentColor ?? brand.primaryColor,"");
    const accent = /^#[0-9a-fA-F]{6}$/.test(candidateColor) ? candidateColor : "#223b63";
    const pale = "#eef2f7";
    const sourceLabel = snapshot.sourceType === "INVOICE" ? "INVOICE" : snapshot.sourceType === "QUOTATION" ? "QUOTATION" : "PAYMENT RECEIPT";
    const status = text(snapshot.lifecycleStatus,"UNKNOWN").toUpperCase();
    const issuedTime = capturedAt instanceof Date ? capturedAt : new Date(capturedAt);
    const doc = new PDFDocument({
      size:"A4",margins:{top:40,bottom:50,left:44,right:44},bufferPages:true,compress:true,
      info:{
        Title:sourceLabel+" "+snapshot.documentNumber,
        Subject:"Document snapshot "+text(snapshot.configurationSnapshotId,""),
        Author:text(object(snapshot.supplier).legalName ?? object(snapshot.supplier).displayName ?? object(snapshot.supplier).name,"Falchion Xeniaa"),
        Creator:"Falchion Xeniaa Invoice Management System",
        Producer:"PDFKit",
        CreationDate:Number.isFinite(issuedTime.getTime())?issuedTime:new Date(0),
        ModDate:Number.isFinite(issuedTime.getTime())?issuedTime:new Date(0),
      },
    });
    const chunks:Buffer[]=[];
    doc.on("data",(chunk:Buffer)=>chunks.push(Buffer.from(chunk)));
    doc.on("error",rejectBuffer);
    doc.on("end",()=>resolveBuffer(Buffer.concat(chunks)));
    let fontName = "Helvetica";
    const embedded = fontPath();
    if (embedded) {
      try { doc.registerFont("FalchionNoto",embedded); fontName="FalchionNoto"; }
      catch { fontName="Helvetica"; }
    }
    const supplier = object(snapshot.supplier);
    const customer = object(snapshot.customer);
    const issuer = text(supplier.legalName ?? supplier.displayName ?? supplier.name,"Falchion Xeniaa");
    const brandName = text(brand.name ?? brand.displayName ?? brand.brandName,"");
    const customerName = text(customer.name ?? customer.customerName,"Customer");
    const left=doc.page.margins.left;
    const right=doc.page.width-doc.page.margins.right;
    const width=right-left;
    const bottom=()=>doc.page.height-doc.page.margins.bottom-14;
    const line=(y:number,color="#d8dee8")=>doc.save().strokeColor(color).lineWidth(0.6).moveTo(left,y).lineTo(right,y).stroke().restore();
    const body=(size=8)=>doc.font(fontName).fontSize(size).fillColor("#172033");
    const ensure=(height:number)=>{if(doc.y+height>bottom())doc.addPage();};

    doc.rect(0,0,doc.page.width,13).fill(accent);
    doc.y=36;
    doc.font(fontName).fontSize(8).fillColor(accent).text(brandName || "FALCHION XENIAA",left,doc.y,{width:width*0.62});
    doc.font(fontName).fontSize(22).fillColor("#111827").text(sourceLabel,left,doc.y+2,{width:width*0.7});
    doc.font(fontName).fontSize(9).fillColor("#374151").text("Document no. "+text(snapshot.documentNumber),left,doc.y+7,{width:width*0.7});
    doc.font(fontName).fontSize(8).fillColor(status==="CANCELLED"||status==="REVERSED"||status==="REJECTED"?"#b42318":accent)
      .text(status,right-width*0.3,46,{width:width*0.3,align:"right"});
    doc.y=Math.max(doc.y+8,88);
    line(doc.y);doc.moveDown(0.7);

    const identityY=doc.y;
    const half=(width-20)/2;
    doc.font(fontName).fontSize(8).fillColor(accent).text("ISSUED BY",left,identityY,{width:half});
    doc.font(fontName).fontSize(10).fillColor("#111827").text(issuer,left,identityY+12,{width:half});
    body(8);
    const issuerLines=[
      ...addressLines(supplier.address ?? supplier.registeredAddress ?? supplier.billingAddress),
      text(supplier.invoiceEmail ?? supplier.email,""),text(supplier.invoicePhone ?? supplier.phone,""),
      text(supplier.taxIdentifier ?? supplier.gstNumber,""),
    ].filter(Boolean);
    doc.text(issuerLines.join("\n") || "Issuer details retained from the source snapshot.",left,identityY+28,{width:half,lineGap:2});
    const customerX=left+half+20;
    doc.font(fontName).fontSize(8).fillColor(accent).text(snapshot.sourceType==="RECEIPT"?"RECEIVED FROM":"BILL TO",customerX,identityY,{width:half});
    doc.font(fontName).fontSize(10).fillColor("#111827").text(customerName,customerX,identityY+12,{width:half});
    body(8);
    const customerLines=[
      ...addressLines(customer.billingAddress ?? customer.address),
      text(customer.email,""),text(customer.phone,""),text(customer.taxIdentifier,""),
    ].filter(Boolean);
    doc.text(customerLines.join("\n") || "Customer details retained from the source snapshot.",customerX,identityY+28,{width:half,lineGap:2});
    doc.y=Math.max(doc.y,identityY+84);
    line(doc.y);doc.moveDown(0.6);

    const meta=[
      ["DOCUMENT DATE",snapshot.documentDate?.slice(0,10) ?? "—"],
      ["DUE DATE",snapshot.sourceType==="INVOICE"?snapshot.dueDate?.slice(0,10) ?? "—":"—"],
      ["VALID UNTIL",snapshot.sourceType==="QUOTATION"?snapshot.validUntil?.slice(0,10) ?? "—":"—"],
      ["CURRENCY",text(snapshot.currency,"—")],
    ];
    const colWidth=width/meta.length;
    const my=doc.y;
    meta.forEach((entry,index)=>{
      const x=left+colWidth*index;
      doc.font(fontName).fontSize(7).fillColor("#667085").text(entry[0],x,my,{width:colWidth-8});
      doc.font(fontName).fontSize(9).fillColor("#101828").text(entry[1],x,my+11,{width:colWidth-8});
    });
    doc.y=my+31;line(doc.y);doc.moveDown(0.6);

    const rows=Array.isArray(snapshot.lines)?snapshot.lines:[];
    const drawLineHeader=()=>{
      const y=doc.y;
      doc.save().fillColor(pale).rect(left,y,width,22).fill().restore();
      doc.font(fontName).fontSize(7).fillColor("#344054").text("#",left+4,y+7,{width:20});
      doc.text("DESCRIPTION",left+24,y+7,{width:width-300});
      doc.text("QTY",right-268,y+7,{width:42,align:"right"});
      doc.text("RATE",right-215,y+7,{width:62,align:"right"});
      doc.text("TAX",right-145,y+7,{width:60,align:"right"});
      doc.text("AMOUNT",right-78,y+7,{width:74,align:"right"});
      doc.y=y+26;
    };
    drawLineHeader();
    rows.forEach((raw,index)=>{
      const item=object(raw);
      const description=text(item.description,"Item / service");
      doc.font(fontName).fontSize(8);
      const descHeight=doc.heightOfString(description,{width:width-310});
      const rowHeight=Math.max(24,descHeight+10);
      if(doc.y+rowHeight>bottom()){
        doc.addPage();doc.y=38;drawLineHeader();
      }
      const y=doc.y;
      doc.font(fontName).fontSize(8).fillColor("#344054").text(String(item.lineNumber ?? index+1),left+4,y+4,{width:20});
      doc.font(fontName).fontSize(8).fillColor("#172033").text(description,left+24,y+4,{width:width-310});
      doc.font(fontName).fontSize(8).fillColor("#172033").text(text(item.quantity,"0"),right-268,y+4,{width:42,align:"right"});
      doc.font(fontName).fontSize(8).fillColor("#172033").text(text(item.unitPrice,"0.0000"),right-215,y+4,{width:62,align:"right"});
      doc.font(fontName).fontSize(8).fillColor("#172033").text(text(item.taxAmount,"0.0000"),right-145,y+4,{width:60,align:"right"});
      doc.font(fontName).fontSize(8).fillColor("#172033").text(text(item.lineTotal,"0.0000"),right-78,y+4,{width:74,align:"right"});
      doc.y=y+rowHeight;line(doc.y,"#e8ecf2");
    });
    if(!rows.length){body(8);doc.text("No item lines are present in this source snapshot.");doc.moveDown(0.4);}

    const totalsX=right-220;
    const totalRows=snapshot.sourceType==="RECEIPT"
      ? [["RECEIPT AMOUNT",amt(snapshot.grandTotal)]]
      : [["SUBTOTAL",amt(snapshot.subtotal)],["DISCOUNT","− "+amt(snapshot.discountTotal)],["TAX",amt(snapshot.taxTotal)],["TOTAL",amt(snapshot.grandTotal)]];
    doc.moveDown(0.5);
    totalRows.forEach(([label,value])=>{
      ensure(23);
      const y=doc.y;
      const grand=label==="TOTAL"||label==="RECEIPT AMOUNT";
      if(grand)doc.save().fillColor(pale).rect(totalsX,y-2,220,23).fill().restore();
      doc.font(fontName).fontSize(grand?9:8).fillColor(grand?accent:"#667085").text(label,totalsX+6,y+3,{width:98});
      doc.font(fontName).fontSize(grand?10:8).fillColor("#101828").text(value+(grand?" "+text(snapshot.currency):""),totalsX+102,y+3,{width:112,align:"right"});
      doc.y=y+22;
    });
    if(snapshot.sourceType==="RECEIPT"){
      ensure(34);
      doc.moveDown(0.3);
      body(8).text("METHOD: "+text(snapshot.method)+"    REFERENCE: "+text(snapshot.reference),left,doc.y,{width});
      doc.moveDown(0.5);
    }
    if(snapshot.sourceType==="INVOICE"){
      ensure(28);doc.moveDown(0.3);
      body(8).text("PAYMENT STATUS AT SNAPSHOT: "+text(snapshot.paymentStatus,"ISSUED"),left,doc.y,{width});
    }
    if(snapshot.reversalReason){
      ensure(32);doc.moveDown(0.4);
      doc.font(fontName).fontSize(8).fillColor("#b42318").text("REVERSAL REASON: "+text(snapshot.reversalReason),left,doc.y,{width});
    }
    if(snapshot.notes){
      ensure(52);doc.moveDown(0.5);
      doc.font(fontName).fontSize(8).fillColor(accent).text("NOTES",left,doc.y);
      doc.moveDown(0.3);body(8).text(text(snapshot.notes),left,doc.y,{width,lineGap:2});
    }
    const entityCfg=object(config.legalEntity);
    const footer=text(templateConfig.footer ?? templateConfig.terms ?? entityCfg.invoiceFooter,"");
    if(footer){
      ensure(40);doc.moveDown(0.6);line(doc.y);doc.moveDown(0.35);body(7).fillColor("#667085").text(footer,left,doc.y,{width,lineGap:2});
    }
    if(snapshot.configurationSha256){
      doc.moveDown(0.4);doc.font(fontName).fontSize(6).fillColor("#667085").text("Configuration snapshot SHA-256: "+snapshot.configurationSha256,left,doc.y,{width});
    }
    const pages=doc.bufferedPageRange();
    for(let p=pages.start;p<pages.start+pages.count;p++){
      doc.switchToPage(p);
      const y=doc.page.height-34;
      doc.save().strokeColor("#d8dee8").lineWidth(0.5).moveTo(left,y-6).lineTo(right,y-6).stroke().restore();
      doc.font(fontName).fontSize(7).fillColor("#667085").text("Falchion Xeniaa · rendered from an immutable content snapshot",left,y,{width:width*0.78});
      doc.font(fontName).fontSize(7).fillColor("#667085").text("Page "+(p+1)+" of "+pages.count,right-width*0.2,y,{width:width*0.2,align:"right"});
    }
    doc.end();
  });
}
