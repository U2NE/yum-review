import type { Metadata } from "next";
import { SiteHeader } from "@/components/site/SiteHeader";
import { LoginForm } from "@/components/auth/LoginForm";
import { safeReturnTo } from "@/components/auth/safeReturnTo";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import styles from "@/components/auth/auth.module.css";

export const metadata: Metadata = { title: "로그인" };
export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{
    next?: string | string[];
    code?: string | string[];
    error?: string | string[];
  }>;
}) {
  const params = await searchParams;
  const candidate = Array.isArray(params.next) ? params.next[0] : params.next;
  const code = Array.isArray(params.code) ? params.code[0] : params.code;
  const callbackError = Array.isArray(params.error) ? params.error[0] : params.error;
  const returnTo = safeReturnTo(candidate);

  async function exchangeAuthorizationCode(value: string) {
    "use server";

    const codeValue = value.trim();
    if (!codeValue || codeValue.length > 4096) return { ok: false };

    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.exchangeCodeForSession(codeValue);
    return { ok: !error };
  }

  return (
    <div className={styles.page}>
      <SiteHeader />
      <main className={styles.content}>
        <LoginForm
          returnTo={returnTo}
          authorizationCode={code ?? null}
          callbackError={Boolean(callbackError)}
          exchangeAuthorizationCode={exchangeAuthorizationCode}
        />
      </main>
    </div>
  );
}
