"use client";

import { use } from "react";
import { AdminParticipantsScreen } from "../../AdminParticipantsScreen";

export default function AdminAssignPage({
  params,
}: {
  params: Promise<{ pid: string }>;
}) {
  const { pid } = use(params);
  return <AdminParticipantsScreen assignPid={pid} />;
}
