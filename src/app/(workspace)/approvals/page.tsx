import { Breadcrumbs,PageHeader } from "@/components/ui";
import { CorrectionReviewWorkspace } from "@/components/correction-review-workspace";
export default function ApprovalsPage(){return <div className="page"><Breadcrumbs items={[{label:"Track"},{label:"Approvals"}]}/><PageHeader eyebrow="GOVERNANCE · PACK 4" title="Issued-document correction review" description="Review requested cancellations and preserve a maker-checker audit trail. Requests never mutate an issued invoice until a policy-gated decision executes."/><CorrectionReviewWorkspace/></div>;}
