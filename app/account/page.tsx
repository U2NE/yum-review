import type { Metadata } from "next";
import { AccountSettings } from "@/components/auth/AccountSettings";
import { SiteHeader } from "@/components/site/SiteHeader";
import { requireSignedIn } from "@/lib/auth/guards";
import styles from "@/components/auth/auth.module.css";

export const metadata: Metadata = { title: "내 계정" };
export const dynamic = "force-dynamic";

export default async function AccountPage() {
  const { supabase, userId } = await requireSignedIn("/account");
  const { data } = await supabase
    .from("profiles")
    .select("display_name")
    .eq("user_id", userId)
    .maybeSingle();

  return (
    <div className={styles.page}>
      <SiteHeader />
      <main className={styles.content}>
        <AccountSettings userId={userId} initialDisplayName={data?.display_name ?? "회원"} />
      </main>
    </div>
  );
}
