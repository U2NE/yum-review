"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import styles from "./auth.module.css";

export function ForcePasswordChange({ returnTo }: { returnTo: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    setMessage("");
    const form = new FormData(formElement);
    const currentPassword = String(form.get("currentPassword") ?? "");
    const password = String(form.get("password") ?? "");
    const confirmation = String(form.get("confirmation") ?? "");
    if (password.length < 8) {
      setMessage("새 비밀번호를 8자 이상 입력해 주세요.");
      return;
    }
    if (password !== confirmation) {
      setMessage("새 비밀번호가 서로 다릅니다.");
      return;
    }
    if (!currentPassword || password === currentPassword) {
      setMessage("현재와 다른 비밀번호를 입력해 주세요.");
      return;
    }

    setPending(true);
    const changed = await fetch("/api/account/legacy-password-change", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ currentPassword, newPassword: password }),
      credentials: "same-origin",
      cache: "no-store",
    });
    setPending(false);
    if (!changed.ok) {
      const result = await changed.json().catch(() => null) as { error?: string } | null;
      setMessage(result?.error ?? "비밀번호를 변경하지 못했어요. 입력한 내용을 확인하고 다시 시도해 주세요.");
      return;
    }

    formElement.reset();
    router.replace(returnTo);
    router.refresh();
  }

  return (
    <section className={styles.card}>
      <h1 className={styles.title}>비밀번호를 새로 설정해 주세요</h1>
      <p className={styles.description}>
        계속 이용하려면 새 비밀번호가 필요해요. 변경이 확인되면 서비스를 이용할 수 있습니다.
      </p>
      <form className={styles.form} onSubmit={submit}>
        <label className={styles.field}>
          현재 비밀번호
          <input
            className={styles.input}
            name="currentPassword"
            type="password"
            autoComplete="current-password"
            required
          />
        </label>
        <label className={styles.field}>
          새 비밀번호
          <input
            className={styles.input}
            name="password"
            type="password"
            autoComplete="new-password"
            minLength={8}
            required
          />
        </label>
        <label className={styles.field}>
          새 비밀번호 확인
          <input
            className={styles.input}
            name="confirmation"
            type="password"
            autoComplete="new-password"
            minLength={8}
            required
          />
        </label>
        {message ? <p className={styles.message} role="alert">{message}</p> : null}
        <button className={styles.button} type="submit" disabled={pending}>
          {pending ? "변경 확인 중…" : "비밀번호 변경"}
        </button>
      </form>
    </section>
  );
}
