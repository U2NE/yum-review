"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { safeReturnTo } from "./safeReturnTo";
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
    const email = String(form.get("email") ?? "").trim();
    const password = String(form.get("password") ?? "");

    if (!displayName || displayName.length > 80) {
      setPending(false);
      setMessage("이름은 1자 이상 80자 이하로 입력해 주세요.");
      return;
    }
    if (password.length < 8) {
      setPending(false);
      setMessage("비밀번호를 8자 이상 입력해 주세요.");
      return;
    }

    const target = safeReturnTo(returnTo);
    const emailRedirectTo = new URL(
      `/login?next=${encodeURIComponent(target)}`,
      window.location.origin,
    ).toString();
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
      setMessage("가입을 완료하지 못했어요. 입력한 정보를 확인해 주세요.");
      return;
    }

    if (data.session) {
      window.location.assign(target);
      return;
    }

    setSuccess(true);
    setMessage("가입 확인 메일을 보냈어요. 메일의 링크를 눌러 가입을 마쳐 주세요.");
  }

  return (
    <div className={styles.card}>
      <h1 className={styles.title}>회원가입</h1>
      <p className={styles.description}>좋았던 메뉴의 기록을 한입씩 모아 보세요.</p>
      <form className={styles.form} onSubmit={submit}>
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
        이미 계정이 있으신가요? <Link href={`/login?next=${encodeURIComponent(safeReturnTo(returnTo))}`}>로그인</Link>
      </p>
    </div>
  );
}
