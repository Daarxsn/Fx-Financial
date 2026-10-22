import { NextRequest } from "next/server";
import { handleReportSummary } from "@/lib/reports/http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: NextRequest) { return handleReportSummary(request); }
