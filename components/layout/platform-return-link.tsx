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
    /**
     * No class: `.ds-user-pop a` styles every link in this popover, and this
     * one carried `nav-item` from the pre-`ds-` shell. That rule still sets a
     * font size, weight, colour and radius of its own, so the one link a
     * platform admin sees here rendered a shade off from "Switch workspace"
     * directly above it. It is also the only thing still rendering `.nav-item`,
     * which is why the rest of that shell's CSS could not be removed.
     */
    <Link href="/platform-admin">
      <ShieldCheck size={18} />
      <span>Platform admin</span>
    </Link>
  );
}
