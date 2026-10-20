import { AccessWorkspace } from "@/components/access-workspace";
import { Breadcrumbs, PageHeader } from "@/components/ui";

export default function AccessPage() {
  return <div className="page page--section">
    <Breadcrumbs items={[{ label: "Workspace", href: "/" }, { label: "Users & access" }]} />
    <PageHeader eyebrow="WORKSPACE ADMINISTRATION" title="Users & access" description="Invite team members with explicit finance roles and legal-entity scopes." />
    <AccessWorkspace />
  </div>;
}
