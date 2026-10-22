"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, InlineAlert, LoadingState, StatusBadge } from "@/components/ui";

type SourceType = "INVOICE" | "QUOTATION" | "RECEIPT";
type EventItem = { type: string; previousStatus: string | null; status: string; actorId: string | null; reason: string | null; createdAt: string };
type DocumentItem = {
  id: string; contentSnapshotId: string; sourceType: SourceType; sourceDocumentId: string; documentNumber: string;
  mimeType: string; byteSize: number | null; fileSha256: string | null; status: "PENDING" | "READY" | "FAILED";
  generationAttempts: number; lastErrorCode: string | null; createdAt: string; readyAt: string | null; reused?: boolean; events: EventItem[];
};
type Props = { sourceType: SourceType; sourceId: string };

function statusTone(status: DocumentItem["status"]): "success" | "danger" | "warning" {
  return status === "READY" ? "success" : status === "FAILED" ? "danger" : "warning";
}
function dateLabel(value: unknown) {
  if (!value) return "—";
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toLocaleString();
}
function sizeLabel(bytes: number | null) {
  if (!bytes || bytes <= 0) return "Size pending";
  return bytes < 1024 * 1024 ? Math.ceil(bytes / 1024) + " KB" : (bytes / (1024 * 1024)).toFixed(2) + " MB";
}

export function DocumentHistoryPanel({ sourceType, sourceId }: Props) {
  const [items, setItems] = useState<DocumentItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const refresh = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    try {
      const response = await fetch("/api/v1/documents/" + sourceType + "/" + sourceId, { cache: "no-store", signal });
      let body: { data?: unknown; error?: { message?: string } } = {};
      try { body = await response.json() as typeof body; } catch { /* generic message below */ }
      if (!response.ok) throw new Error(body.error?.message ?? "Document history could not be loaded.");
      const data = Array.isArray(body.data) ? body.data as DocumentItem[] : [];
      setItems(data);
      setError("");
    } catch (cause) {
      if (cause instanceof Error && cause.name === "AbortError") return;
      setError(cause instanceof Error ? cause.message : "Document history could not be loaded.");
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [sourceId, sourceType]);

  useEffect(() => {
    const controller = new AbortController();
    void Promise.resolve().then(() => refresh(controller.signal));
    return () => controller.abort();
  }, [refresh]);

  const latest = items[0];
  const readyCount = useMemo(() => items.filter(item => item.status === "READY").length, [items]);

  const generate = async () => {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const csrfResponse = await fetch("/api/v1/auth/csrf", { cache: "no-store" });
      const csrfBody = await csrfResponse.json() as { data?: { csrfToken?: string } };
      if (!csrfResponse.ok || !csrfBody.data?.csrfToken) throw new Error("Security verification expired. Refresh the page and try again.");
      const response = await fetch("/api/v1/documents/" + sourceType + "/" + sourceId + "/generate", {
        method: "POST",
        cache: "no-store",
        headers: { Accept: "application/json", "Content-Type": "application/json", "X-CSRF-Token": csrfBody.data.csrfToken },
        body: JSON.stringify({ forceNew: latest?.status === "READY" }),
      });
      const body = await response.json() as { data?: DocumentItem; error?: { message?: string } };
      if (!response.ok) throw new Error(body.error?.message ?? "The PDF could not be generated.");
      const result = body.data;
      if (result?.status === "READY") {
        setMessage(result.reused ? "The verified PDF is already current." : "The PDF was generated, checksum-verified, and stored as a new history item.");
      } else {
        setMessage("A generation attempt is already active. Refresh the history shortly to see its final status.");
      }
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The PDF could not be generated.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="master-data-panel" aria-labelledby={"document-history-" + sourceType + "-" + sourceId}>
      <div className="master-data-panel__heading">
        <div>
          <h3 id={"document-history-" + sourceType + "-" + sourceId}>PDF documents and history</h3>
          <p>Generated from immutable source snapshots. Files stay private and every download is re-authorized and checksum-verified.</p>
        </div>
        <div className="master-data-actions">
          <Button size="sm" variant="secondary" disabled={loading || busy} onClick={() => void refresh()}>
            {loading ? "Refreshing…" : "Refresh history"}
          </Button>
          <Button size="sm" disabled={busy || loading || latest?.status === "PENDING"} onClick={() => void generate()}>
            {busy ? "Generating…" : latest?.status === "READY" ? "Regenerate PDF" : latest?.status === "FAILED" ? "Retry PDF" : "Generate PDF"}
          </Button>
        </div>
      </div>
      {error ? <InlineAlert tone="danger" title="Document action needs attention">{error}</InlineAlert> : null}
      {message ? <InlineAlert tone="success" title="Document status">{message}</InlineAlert> : null}
      <p className="form-hint">{readyCount} verified PDF {readyCount === 1 ? "artifact" : "artifacts"} available · up to 25 recent generation attempts are retained in this view.</p>
      {loading && items.length === 0 ? <LoadingState label="Loading PDF history…" /> : null}
      {!loading && !items.length ? <p className="form-hint">No PDF artifact has been generated yet. Generate one to create a private, checksum-verified file and begin the document history.</p> : null}
      {items.length ? <div className="data-table-scroll">
        <table className="data-table">
          <thead><tr><th>Status</th><th>Document / source snapshot</th><th>Created</th><th>Size / attempts</th><th>Integrity</th><th>Action</th></tr></thead>
          <tbody>
            {items.map(item => <tr key={item.id}>
              <td><StatusBadge tone={statusTone(item.status)}>{item.status}</StatusBadge>{item.lastErrorCode ? <div className="invoice-workspace-muted">{item.lastErrorCode}</div> : null}</td>
              <td><strong>{item.documentNumber}</strong><div className="invoice-workspace-muted">Snapshot {item.contentSnapshotId.slice(0, 8)}… · artifact {item.id.slice(0, 8)}…</div>
                {item.events?.length ? <details><summary>Event history ({item.events.length})</summary><ul>{item.events.map((event, index) => <li key={item.id + "-" + event.type + "-" + index}>{event.type} · {event.status} · {dateLabel(event.createdAt)}{event.reason ? " · " + event.reason : ""}</li>)}</ul></details> : null}
              </td>
              <td>{dateLabel(item.createdAt)}{item.readyAt ? <div className="invoice-workspace-muted">Ready {dateLabel(item.readyAt)}</div> : null}</td>
              <td>{sizeLabel(item.byteSize)}<div className="invoice-workspace-muted">Attempt {item.generationAttempts}</div></td>
              <td>{item.fileSha256 ? <code>{item.fileSha256.slice(0, 16)}…</code> : "Not verified"}</td>
              <td>{item.status === "READY" ? <a href={"/api/v1/documents/files/" + item.id} className="form-hint">Download PDF</a> : "Not available"}</td>
            </tr>)}
          </tbody>
        </table>
      </div> : null}
    </section>
  );
}
