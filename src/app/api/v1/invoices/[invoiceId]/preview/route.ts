import { NextRequest, NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2";
import { pool } from "@/lib/db/pool";
import { requirePermission } from "@/lib/auth/authorize";
import { jsonNoStore } from "@/lib/http/api-response";
import { DocumentWorkflowError, generateDocumentPdf, downloadGeneratedDocument } from "@/lib/documents/service";
import { renderDraftInvoicePreviewPdf } from "@/lib/documents/draft-preview";
import { documentApiError } from "@/lib/documents/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request:NextRequest,context:{params:Promise<{invoiceId:string}>}) {
  try {
    const actor=await requirePermission("invoices:read");
    const {invoiceId}=await context.params;
    if(!/^[0-9a-f-]{36}$/i.test(invoiceId)) {
      return jsonNoStore({error:{code:"VALIDATION_ERROR",message:"invoiceId must be a UUID."}},400);
    }
    const [rows]=await pool.execute<(RowDataPacket & {legal_entity_id:string;lifecycle_status:string;invoice_number:string|null})[]>(
      "SELECT legal_entity_id,lifecycle_status,invoice_number FROM invoices WHERE id=? LIMIT 1",[invoiceId],
    );
    const source=rows[0];
    if(!source||!actor.legalEntityIds.includes(source.legal_entity_id)) {
      return jsonNoStore({error:{code:"NOT_FOUND",message:"Invoice not found in your assigned scope."}},404);
    }
    let bytes:Buffer;
    let fileName="proforma-preview.pdf";
    if(source.lifecycle_status==="DRAFT") {
      bytes=await renderDraftInvoicePreviewPdf(invoiceId);
      fileName="proforma-draft-preview.pdf";
    } else if(source.lifecycle_status==="ISSUED"||source.lifecycle_status==="CANCELLED") {
      const generated=await generateDocumentPdf("INVOICE",invoiceId,actor.userId);
      if(generated.status!=="READY") {
        throw new DocumentWorkflowError("DOCUMENT_GENERATION_PENDING",409,"The verified invoice PDF is still being generated. Refresh the preview to try again.");
      }
      const download=await downloadGeneratedDocument(generated.id,actor.userId,true);
      bytes=download.bytes;
      const safeNumber=source.invoice_number?.replace(/[^A-Za-z0-9._-]+/g,"_").slice(0,80)??"invoice";
      fileName=safeNumber+".pdf";
    } else {
      return jsonNoStore({error:{code:"DOCUMENT_SOURCE_NOT_READY",message:"Only draft, issued or cancelled invoice records can be previewed."}},409);
    }
    return new NextResponse(new Uint8Array(bytes),{
      status:200,
      headers:{
        "Content-Type":"application/pdf",
        "Content-Disposition":(request.nextUrl.searchParams.get("download")==="1"?"attachment":"inline")+'; filename="'+fileName+'"',
        "Content-Length":String(bytes.length),
        "Cache-Control":"private, no-store, max-age=0",
        "Pragma":"no-cache",
        "X-Content-Type-Options":"nosniff",
        "Content-Security-Policy":"sandbox",
        "Referrer-Policy":"no-referrer",
      },
    });
  } catch(error) {
    return documentApiError(error);
  }
}
