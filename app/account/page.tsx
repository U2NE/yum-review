import type { Metadata } from "next";
import Link from "next/link";
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
        <h1 className={styles.title}>내 계정</h1>
        <section className={styles.card} style={{ marginBottom: "1.25rem" }} aria-labelledby="account-lists-title">
          <h2 className={styles.title} id="account-lists-title">내 활동</h2>
          <p className={styles.description}>작성한 리뷰와 찜한 메뉴를 다시 확인할 수 있어요.</p>
          <nav className={styles.ownerLinks} aria-label="내 기록">
            <Link className={styles.button} href="/my-reviews" style={{ minHeight: "44px" }}>
              내 리뷰
            </Link>
            <Link className={styles.secondaryButton} href="/wishlist" style={{ minHeight: "44px" }}>
              찜한 메뉴
            </Link>
          </nav>
        </section>
        <AccountSettings userId={userId} initialDisplayName={data?.display_name ?? "회원"} />
      </main>
    </div>
  );
}
