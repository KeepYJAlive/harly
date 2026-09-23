import { isDemoMode } from "@harly/config";
import { AutomationsManager } from "@/features/automations/AutomationsManager";
import { AutomationsDemo } from "@/features/automations/AutomationsDemo";
import {
  listPendingWorkflowApprovals,
  listWorkflows,
  serializeWorkflow,
} from "@/features/automations/data";
import { requirePagePermission } from "@/features/workspaces/permissions-server";

export const dynamic = "force-dynamic";

export default async function AutomationsPage() {
  if (isDemoMode()) {
    return <AutomationsDemo />;
  }

  const workspace = await requirePagePermission("automations:manage");
  const workflows = await listWorkflows(workspace.organization.id);
  const approvals = await listPendingWorkflowApprovals({
    workspaceId: workspace.organization.id,
    actorId: workspace.user.id,
  });

  return (
    <AutomationsManager
      initialWorkflows={workflows.map(serializeWorkflow)}
      initialApprovals={approvals}
    />
  );
}
