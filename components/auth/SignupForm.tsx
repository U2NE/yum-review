"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { passwordPolicyIssue, passwordPolicyMessage } from "@/lib/auth/password-policy";
import { buildAuthConfirmationRedirectUrl, safeAuthReturnTo } from "@/lib/auth/redirect-url";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import styles from "./auth.module.css";

export function SignupForm({ returnTo }: { returnTo: string }) {
  const [message, setMessage] = useState("");
  const [success, setSuccess] = useState(false);
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    setSuccess(false);
    setPending(true);

    const form = new FormData(event.currentTarget);
    const displayName = String(form.get("displayName") ?? "").trim();
    const email = String(form.get("email") ?? "").trim().toLowerCase();
    const password = String(form.get("password") ?? "");

    if (!displayName || displayName.length > 80) {
      setPending(false);
      setMessage("이름은 1자 이상 80자 이하로 입력해 주세요.");
      return;
    }
    const policyIssue = passwordPolicyIssue(password);
    if (policyIssue) {
      setPending(false);
      setMessage(passwordPolicyMessage(policyIssue));
      return;
    }

    const target = safeAuthReturnTo(returnTo);
    const emailRedirectTo = buildAuthConfirmationRedirectUrl(target, window.location.origin);
    if (!emailRedirectTo) {
      setPending(false);
      setMessage("가입 확인 주소 설정을 완료하지 못했어요. 잠시 후 다시 시도해 주세요.");
      return;
    }

    try {
      const lookupResponse = await fetch("/api/auth/email-status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
        credentials: "same-origin",
        cache: "no-store",
      });
      const lookup = await lookupResponse.json().catch(() => null) as { exists?: boolean; error?: string } | null;
      if (lookupResponse.status === 429) {
        setPending(false);
        setMessage(lookup?.error ?? "잠시 후 다시 확인해 주세요.");
        return;
      }
      if (!lookupResponse.ok || typeof lookup?.exists !== "boolean") {
        setPending(false);
        setMessage(lookup?.error ?? "가입 정보를 확인하지 못했어요. 잠시 후 다시 시도해 주세요.");
        return;
      }
      if (lookup.exists) {
        setPending(false);
        setMessage("이미 가입된 이메일입니다. 로그인하거나 비밀번호를 확인해 주세요.");
        return;
      }

      const { data, error } = await createSupabaseBrowserClient().auth.signUp({
        email,
        password,
        options: {
          data: { display_name: displayName },
          emailRedirectTo,
        },
      });

      setPending(false);
      if (error) {
        if (error.code === "user_already_exists" || error.code === "email_exists") {
          setMessage("이미 가입된 이메일입니다. 로그인하거나 비밀번호를 확인해 주세요.");
          return;
        }
        setMessage("가입을 완료하지 못했어요. 입력한 정보를 확인해 주세요.");
        return;
      }

      if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
        setMessage("이미 가입된 이메일입니다. 로그인하거나 비밀번호를 확인해 주세요.");
        return;
      }

      if (data.session) {
        window.location.assign(target);
        return;
      }

      setSuccess(true);
      setMessage("가입 확인 메일 요청이 접수됐어요. 실제 수신 여부는 메일 발송 설정에 따라 달라질 수 있으니 스팸함도 확인해 주세요.");
    } catch {
      setPending(false);
      setMessage("가입을 완료하지 못했어요. 잠시 후 다시 시도해 주세요.");
    }
  }

  return (
    <div className={styles.card}>
      <h1 className={styles.title}>회원가입</h1>
      <p className={styles.description}>좋았던 메뉴의 기록을 한입씩 모아 보세요.</p>
      <form className={styles.form} method="post" onSubmit={submit}>
        <label className={styles.field}>
          표시 이름
          <input
            className={styles.input}
            name="displayName"
            autoComplete="nickname"
            maxLength={80}
            required
          />
        </label>
        <label className={styles.field}>
          이메일
          <input className={styles.input} name="email" type="email" autoComplete="email" required />
        </label>
        <label className={styles.field}>
          비밀번호
          <input
            className={styles.input}
            name="password"
            type="password"
            autoComplete="new-password"
            minLength={8}
            required
          />
        </label>
        {message ? (
          <p className={`${styles.message} ${success ? styles.success : ""}`} role={success ? "status" : "alert"}>
            {message}
          </p>
        ) : null}
        <button className={styles.button} type="submit" disabled={pending}>
          {pending ? "가입 중…" : "가입하기"}
        </button>
      </form>
      <p className={styles.footerLinks}>
        이미 계정이 있으신가요? <Link href={`/login?next=${encodeURIComponent(safeAuthReturnTo(returnTo))}`}>로그인</Link>
      </p>
    </div>
  );
}
