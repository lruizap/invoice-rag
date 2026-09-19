"use client";

import { useState } from "react";
import UploadArea from "@/components/UploadArea";
import DocumentList from "@/components/DocumentList";
import ChatPanel from "@/components/ChatPanel";

export default function ExtractoApp() {
  const [refreshToken, setRefreshToken] = useState(0);

  return (
    <div className="w-full flex flex-col gap-16">
      <UploadArea onSaved={() => setRefreshToken((t) => t + 1)} />
      <DocumentList refreshToken={refreshToken} />
      <ChatPanel />
    </div>
  );
}
