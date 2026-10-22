import { NextRequest } from "next/server";
import { handleReportExport } from "@/lib/reports/http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: NextRequest) { return handleReportExport(request, "invoices"); }
