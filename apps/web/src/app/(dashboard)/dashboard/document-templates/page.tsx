import { requirePagePermission } from "@/features/workspaces/permissions-server";
import { listWorkflowDocumentTemplates } from "@/features/document-templates/data";
import { DocumentTemplatesManager } from "@/features/document-templates/DocumentTemplatesManager";

export const dynamic = "force-dynamic";

export default async function DocumentTemplatesPage() {
  await requirePagePermission("templates:manage");
  const templates = await listWorkflowDocumentTemplates();
  return <DocumentTemplatesManager templates={templates} />;
}
