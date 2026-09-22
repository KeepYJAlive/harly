import { notFound } from "next/navigation";

import { requirePagePermission } from "@/features/workspaces/permissions-server";
import { getWorkflowDocumentTemplate } from "@/features/document-templates/data";
import { DocumentTemplateEditorPage } from "@/features/document-templates/DocumentTemplateEditorPage";

export const dynamic = "force-dynamic";

export default async function DocumentTemplateEditorRoute({ params }: { params: Promise<{ templateId: string }> }) {
  await requirePagePermission("templates:manage");
  const { templateId } = await params;
  const template = templateId === "new" ? null : await getWorkflowDocumentTemplate(templateId);
  if (templateId !== "new" && !template) notFound();
  return <DocumentTemplateEditorPage template={template} />;
}
