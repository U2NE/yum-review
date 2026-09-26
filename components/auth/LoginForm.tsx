"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { safeReturnTo } from "./safeReturnTo";
import styles from "./auth.module.css";

export function LoginForm({
  returnTo,
  authorizationCode,
  callbackError,
  exchangeAuthorizationCode,
}: {
  returnTo: string;
  authorizationCode: string | null;
  callbackError: boolean;
  exchangeAuthorizationCode: (code: string) => Promise<{ ok: boolean }>;
}) {
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);
  const attemptedCode = useRef<string | null>(null);

  useEffect(() => {
    if (callbackError) {
      setMessage("인증 링크가 만료되었거나 이미 사용되었어요. 다시 로그인하거나 새 가입 확인 메일을 받아 주세요.");
      cleanCallbackParameters(returnTo);
      return;
    }
    if (!authorizationCode || attemptedCode.current === authorizationCode) return;

    attemptedCode.current = authorizationCode;
    cleanCallbackParameters(returnTo);
    setPending(true);
    setMessage("가입 확인을 마치는 중이에요…");

    void exchangeAuthorizationCode(authorizationCode)
      .then((result) => {
        if (!result.ok) {
          setMessage("인증 링크가 만료되었거나 이미 사용되었어요. 다시 로그인하거나 새 가입 확인 메일을 받아 주세요.");
          return;
        }
        window.location.assign(safeReturnTo(returnTo));
      })
      .catch(() => {
        setMessage("가입 확인을 마치지 못했어요. 로그인하거나 새 가입 확인 메일을 받아 주세요.");
      })
      .finally(() => {
        setPending(false);
      });
  }, [authorizationCode, callbackError, exchangeAuthorizationCode, returnTo]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    setPending(true);

    const form = new FormData(event.currentTarget);
    const email = String(form.get("email") ?? "").trim();
    const password = String(form.get("password") ?? "");
    const { error } = await createSupabaseBrowserClient().auth.signInWithPassword({
      email,
      password,
    });

    setPending(false);
    if (error) {
      setMessage("로그인 정보를 확인해 주세요. 이메일 확인이 필요하다면 받은 편지함을 확인해 주세요.");
      return;
    }

    window.location.assign(safeReturnTo(returnTo));
  }

  return (
    <div className={styles.card}>
      <h1 className={styles.title}>로그인</h1>
      <p className={styles.description}>한입기록에 다시 오신 것을 환영해요.</p>
      <form className={styles.form} onSubmit={submit}>
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
        {message ? <p className={styles.message} role="status">{message}</p> : null}
        <button className={styles.button} type="submit" disabled={pending}>
          {pending ? "확인 중…" : "로그인"}
        </button>
      </form>
      <p className={styles.footerLinks}>
        아직 계정이 없으신가요? <Link href={`/signup?next=${encodeURIComponent(safeReturnTo(returnTo))}`}>회원가입</Link>
      </p>
    </div>
  );
}

function cleanCallbackParameters(returnTo: string) {
  const url = new URL(window.location.href);
  url.search = "";
  const safeTarget = safeReturnTo(returnTo);
  if (safeTarget !== "/") url.searchParams.set("next", safeTarget);
  window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}`);
}
