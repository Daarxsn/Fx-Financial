"use client";

interface Props {
  totalCgst: number;
  totalSgst: number;
  totalIgst: number;
  totalTax: number;
  gstin: string;
  taxJurisdiction: string;
}

function formatCurrency(val: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(val);
}

export function TaxTimelineChart({
  totalCgst,
  totalSgst,
  totalIgst,
  totalTax,
  gstin,
  taxJurisdiction,
}: Props) {
  const safeTotal = totalTax > 0 ? totalTax : (totalCgst + totalSgst + totalIgst);
  const intrastateTax = totalCgst + totalSgst;
  const interstateTax = totalIgst;

  const intrastatePct = safeTotal > 0 ? ((intrastateTax / safeTotal) * 100).toFixed(1) : "0.0";
  const interstatePct = safeTotal > 0 ? ((interstateTax / safeTotal) * 100).toFixed(1) : "0.0";

  return (
    <div className="analytics-chart-card">
      <div className="chart-header">
        <div>
          <h3 className="chart-title">Statutory Tax Liability & GST Breakdown</h3>
          <p className="chart-subtitle">Reconciled tax obligations under legal GSTIN registration</p>
        </div>
        <div className="gstin-badge-pill">
          <span className="gstin-label">GSTIN:</span>
          <span className="gstin-value">{gstin}</span>
          <span className="gstin-state">({taxJurisdiction})</span>
        </div>
      </div>

      <div className="tax-grid">
        <div className="tax-card tax-card--cgst">
          <div className="tax-card-header">
            <span className="tax-type-tag">Central GST (9%)</span>
            <span className="tax-rate-label">CGST</span>
          </div>
          <div className="tax-amount">{formatCurrency(totalCgst)}</div>
          <p className="tax-note">Intrastate supplies within {taxJurisdiction}</p>
        </div>

        <div className="tax-card tax-card--sgst">
          <div className="tax-card-header">
            <span className="tax-type-tag">State GST (9%)</span>
            <span className="tax-rate-label">SGST</span>
          </div>
          <div className="tax-amount">{formatCurrency(totalSgst)}</div>
          <p className="tax-note">Maharashtra State tax collected</p>
        </div>

        <div className="tax-card tax-card--igst">
          <div className="tax-card-header">
            <span className="tax-type-tag">Integrated GST (18%)</span>
            <span className="tax-rate-label">IGST</span>
          </div>
          <div className="tax-amount">{formatCurrency(totalIgst)}</div>
          <p className="tax-note">Interstate supplies to other states</p>
        </div>

        <div className="tax-card tax-card--total">
          <div className="tax-card-header">
            <span className="tax-type-tag tax-type-tag--gold">Total Tax Liability</span>
            <span className="tax-rate-label">NET TAX</span>
          </div>
          <div className="tax-amount tax-amount--gold">{formatCurrency(safeTotal)}</div>
          <p className="tax-note">Cumulative tax to remit for return filing</p>
        </div>
      </div>

      {/* Visual Jurisdiction Ratio Bar */}
      <div className="tax-ratio-section">
        <div className="tax-ratio-header">
          <span>Tax Supply Ratio</span>
          <span>Intrastate (9+9%): {intrastatePct}% · Interstate (18%): {interstatePct}%</span>
        </div>
        <div className="tax-ratio-bar">
          <div
            className="tax-ratio-seg tax-ratio-seg--intra"
            style={{ width: `${intrastatePct}%` }}
            title={`Intrastate CGST+SGST: ${formatCurrency(intrastateTax)} (${intrastatePct}%)`}
          />
          <div
            className="tax-ratio-seg tax-ratio-seg--inter"
            style={{ width: `${interstatePct}%` }}
            title={`Interstate IGST: ${formatCurrency(interstateTax)} (${interstatePct}%)`}
          />
        </div>
      </div>
    </div>
  );
}
