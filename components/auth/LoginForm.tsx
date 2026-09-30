"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { safeAuthReturnTo } from "@/lib/auth/redirect-url";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import styles from "./auth.module.css";

const CONFIRMATION_ERROR = "인증 링크가 만료되었거나 이미 사용되었어요. 다시 로그인하거나 새 가입 확인 메일을 받아 주세요.";

export function LoginForm({
  returnTo,
  callbackError,
}: {
  returnTo: string;
  callbackError: boolean;
}) {
  const [message, setMessage] = useState(callbackError ? CONFIRMATION_ERROR : "");
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (callbackError) cleanCallbackParameters(returnTo);
  }, [callbackError, returnTo]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    setPending(true);

    const form = new FormData(event.currentTarget);
    const email = String(form.get("email") ?? "").trim().toLowerCase();
    const password = String(form.get("password") ?? "");

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
        setMessage(lookup?.error ?? "잠시 후 다시 로그인해 주세요.");
        return;
      }
      if (!lookupResponse.ok || typeof lookup?.exists !== "boolean") {
        setMessage(lookup?.error ?? "로그인 정보를 확인하지 못했어요. 잠시 후 다시 시도해 주세요.");
        return;
      }
      if (!lookup.exists) {
        setMessage("가입된 이메일을 찾을 수 없습니다. 이메일 주소를 확인하거나 회원가입해 주세요.");
        return;
      }

      const { error } = await createSupabaseBrowserClient().auth.signInWithPassword({ email, password });
      if (error) {
        if (error.code === "invalid_credentials") {
          setMessage("비밀번호가 맞지 않습니다. 다시 확인해 주세요.");
        } else if (error.code === "email_not_confirmed") {
          setMessage("이메일 인증이 아직 완료되지 않았어요. 받은 편지함에서 한입기록 확인 메일을 찾아 주세요.");
        } else {
          setMessage("로그인을 완료하지 못했어요. 입력한 정보를 확인한 뒤 다시 시도해 주세요.");
        }
        return;
      }

      window.location.assign(safeAuthReturnTo(returnTo));
    } catch {
      setMessage("로그인을 완료하지 못했어요. 잠시 후 다시 시도해 주세요.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className={styles.card}>
      <h1 className={styles.title}>로그인</h1>
      <p className={styles.description}>한입기록에 다시 오신 것을 환영해요.</p>
      <form className={styles.form} method="post" onSubmit={submit}>
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
            autoComplete="current-password"
            required
          />
        </label>
        {message ? <p className={styles.message} role="alert">{message}</p> : null}
        <button className={styles.button} type="submit" disabled={pending}>
          {pending ? "확인 중…" : "로그인"}
        </button>
      </form>
      <p className={styles.footerLinks}>
        아직 계정이 없으신가요? <Link href={`/signup?next=${encodeURIComponent(safeAuthReturnTo(returnTo))}`}>회원가입</Link>
      </p>
    </div>
  );
}

function cleanCallbackParameters(returnTo: string) {
  const url = new URL(window.location.href);
  url.search = "";
  const safeTarget = safeAuthReturnTo(returnTo);
  if (safeTarget !== "/") url.searchParams.set("next", safeTarget);
  window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}`);
}
