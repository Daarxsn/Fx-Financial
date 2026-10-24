import { Breadcrumbs, PageHeader } from "@/components/ui";
import { InvoiceWorkspace } from "@/components/invoice-workspace";

export default function InvoicesPage() {
  return (
    <main className="page page--invoices">
      <Breadcrumbs items={[{ label: "Workspace", href: "/" }, { label: "Invoices" }]} />
      <PageHeader
        eyebrow="BILLING"
        title="Invoices"
        description="Create a draft, review its details, issue it when the required configuration is approved, and manage payment and delivery history from one place."
      />
      <InvoiceWorkspace />
    </main>
  );
}
