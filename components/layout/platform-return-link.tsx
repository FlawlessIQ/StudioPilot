"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ShieldCheck } from "lucide-react";
import { getFirebaseClient } from "@/lib/firebase/client";
import { authIsLive } from "@/lib/runtime-mode";

export function PlatformReturnLink() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!authIsLive) return;
    const user = getFirebaseClient().auth.currentUser;
    if (!user) return;
    void user
      .getIdTokenResult()
      .then((token) => setVisible(token.claims.platformAdmin === true));
  }, []);

  if (!visible) return null;
  return (
    <Link href="/platform-admin" className="nav-item">
      <ShieldCheck size={18} />
      <span>Platform admin</span>
    </Link>
  );
}
