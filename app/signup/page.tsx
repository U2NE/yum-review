import type { Metadata } from "next";
import { SiteHeader } from "@/components/site/SiteHeader";
import { SignupForm } from "@/components/auth/SignupForm";
import { safeReturnTo } from "@/components/auth/safeReturnTo";
import styles from "@/components/auth/auth.module.css";

export const metadata: Metadata = { title: "회원가입" };
export const dynamic = "force-dynamic";

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | string[] }>;
}) {
  const params = await searchParams;
  const candidate = Array.isArray(params.next) ? params.next[0] : params.next;
  const returnTo = safeReturnTo(candidate);

  return (
    <div className={styles.page}>
      <SiteHeader />
      <main className={styles.content}>
        <SignupForm returnTo={returnTo} />
      </main>
    </div>
  );
}
