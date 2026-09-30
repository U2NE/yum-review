import type { Metadata } from "next";
import { SiteHeader } from "@/components/site/SiteHeader";
import { LoginForm } from "@/components/auth/LoginForm";
import { safeReturnTo } from "@/components/auth/safeReturnTo";
import styles from "@/components/auth/auth.module.css";

export const metadata: Metadata = { title: "로그인" };
export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{
    next?: string | string[];
    error?: string | string[];
  }>;
}) {
  const params = await searchParams;
  const candidate = Array.isArray(params.next) ? params.next[0] : params.next;
  const callbackError = Array.isArray(params.error) ? params.error[0] : params.error;
  const returnTo = safeReturnTo(candidate);

  return (
    <div className={styles.page}>
      <SiteHeader />
      <main className={styles.content}>
        <LoginForm
          returnTo={returnTo}
          callbackError={Boolean(callbackError)}
        />
      </main>
    </div>
  );
}
