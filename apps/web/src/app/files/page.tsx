import {
  redirect,
} from "next/navigation";

import {
  FileManager,
} from "@/components/file-manager";

import {
  getCurrentUser,
  getRootDriveView,
  getSetupStatus,
} from "@/lib/api";

export const dynamic =
  "force-dynamic";

export default async function FilesPage() {
  const setup =
    await getSetupStatus();

  if (
    !setup.setupComplete
  ) {
    redirect("/setup");
  }

  const user =
    await getCurrentUser();

  if (!user) {
    redirect("/login");
  }

  const view =
    await getRootDriveView();

  if (!view) {
    throw new Error(
      "PiCloud nedokázal načíst kořenovou složku.",
    );
  }

  return (
    <FileManager
      view={view}
    />
  );
}