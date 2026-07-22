import { notFound, redirect } from "next/navigation";

import { FileManager } from "@/components/file-manager";

import { getCurrentUser, getFolderDriveView, getSetupStatus } from "@/lib/api";

export const dynamic = "force-dynamic";

export default async function FolderPage({
  params,
}: {
  params: Promise<{
    folderId: string;
  }>;
}) {
  const { folderId } = await params;

  const setup = await getSetupStatus();

  if (!setup.setupComplete) {
    redirect("/setup");
  }

  const user = await getCurrentUser();

  if (!user) {
    redirect("/login");
  }

  const view = await getFolderDriveView(folderId);

  if (!view) {
    notFound();
  }

  return <FileManager view={view} />;
}
