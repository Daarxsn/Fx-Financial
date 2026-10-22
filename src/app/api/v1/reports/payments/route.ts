import { NextRequest } from "next/server";
import { handleReportRows } from "@/lib/reports/http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: NextRequest) { return handleReportRows(request, "payments"); }
