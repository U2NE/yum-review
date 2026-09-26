"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import styles from "./auth.module.css";

export function LogoutButton() {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function logout() {
    setPending(true);
    const { error } = await createSupabaseBrowserClient().auth.signOut();
    setPending(false);
    if (error) {
      window.alert("로그아웃하지 못했어요. 잠시 후 다시 시도해 주세요.");
      return;
    }
    router.replace("/login");
    router.refresh();
  }

  return (
    <button className={styles.secondaryButton} type="button" onClick={logout} disabled={pending}>
      {pending ? "로그아웃 중…" : "로그아웃"}
    </button>
  );
}
