import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ForcePasswordChange } from "@/components/auth/ForcePasswordChange";
import { safeReturnTo } from "@/components/auth/safeReturnTo";
import { requireSignedIn } from "@/lib/auth/guards";
import styles from "@/components/auth/auth.module.css";

export const metadata: Metadata = { title: "비밀번호 변경" };
export const dynamic = "force-dynamic";

export default async function ForcePasswordChangePage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | string[] }>;
}) {
  const [{ supabase }, params] = await Promise.all([
    requireSignedIn("/account/force-password-change", { allowForcedPasswordChange: true }),
    searchParams,
  ]);
  const candidate = Array.isArray(params.next) ? params.next[0] : params.next;
  const returnTo = safeReturnTo(candidate);
  const { data: mustChange, error } = await supabase.rpc("legacy_password_change_required");
  if (!error && mustChange === false) {
    redirect(returnTo === "/account/force-password-change" ? "/" : returnTo);
  }

  return (
    <div className={styles.page}>
      <main className={styles.content}>
        {error ? (
          <section className={styles.card}>
            <h1 className={styles.title}>계정 상태를 확인하지 못했어요</h1>
            <p className={styles.message} role="alert">
              안전을 위해 다른 기능을 잠시 제한했어요. 연결을 확인한 뒤 새로고침해 주세요.
            </p>
          </section>
        ) : (
          <ForcePasswordChange returnTo={returnTo} />
        )}
      </main>
    </div>
  );
}
