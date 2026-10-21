import { Breadcrumbs, PageHeader } from "@/components/ui";
import { PolicyDecisionWorkspace } from "@/components/policy-decision-workspace";
export default function PolicyDecisionsPage(){
 return <div className="page"><Breadcrumbs items={[{label:"Configure",href:"/settings"},{label:"Policy decisions"}]}/><PageHeader eyebrow="GOVERNANCE · PACK 4" title="Business and finance decisions" description="Record actual approved accounting, issuer, correction and statutory decisions with evidence references. No outcome is approved by default."/><PolicyDecisionWorkspace/></div>;
}
