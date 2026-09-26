"use client";

import { useState, type FormEvent } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import styles from "./auth.module.css";

export function AccountSettings({
  userId,
  initialDisplayName,
}: {
  userId: string;
  initialDisplayName: string;
}) {
  const [displayName, setDisplayName] = useState(initialDisplayName);
  const [nameMessage, setNameMessage] = useState("");
  const [passwordMessage, setPasswordMessage] = useState("");
  const [namePending, setNamePending] = useState(false);
  const [passwordPending, setPasswordPending] = useState(false);

  async function saveDisplayName(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setNameMessage("");
    const cleaned = displayName.trim();
    if (!cleaned || cleaned.length > 80) {
      setNameMessage("이름은 1자 이상 80자 이하로 입력해 주세요.");
      return;
    }

    setNamePending(true);
    const { error } = await createSupabaseBrowserClient()
      .from("profiles")
      .update({ display_name: cleaned })
      .eq("user_id", userId);
    setNamePending(false);

    if (error) {
      setNameMessage("표시 이름을 저장하지 못했어요. 잠시 후 다시 시도해 주세요.");
      return;
    }
    setDisplayName(cleaned);
    setNameMessage("표시 이름을 저장했어요.");
  }

  async function savePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPasswordMessage("");
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const currentPassword = String(form.get("currentPassword") ?? "");
    const password = String(form.get("password") ?? "");
    const confirmation = String(form.get("confirmation") ?? "");

    if (password.length < 8) {
      setPasswordMessage("비밀번호를 8자 이상 입력해 주세요.");
      return;
    }
    if (password !== confirmation) {
      setPasswordMessage("새 비밀번호가 서로 다릅니다.");
      return;
    }
    if (!currentPassword || currentPassword === password) {
      setPasswordMessage("현재와 다른 비밀번호를 입력해 주세요.");
      return;
    }

    setPasswordPending(true);
    const response = await fetch("/api/account/legacy-password-change", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ currentPassword, newPassword: password }),
      credentials: "same-origin",
      cache: "no-store",
    });
    setPasswordPending(false);

    if (!response.ok) {
      const result = await response.json().catch(() => null) as { error?: string } | null;
      setPasswordMessage(result?.error ?? "비밀번호를 변경하지 못했어요. 잠시 후 다시 시도해 주세요.");
      return;
    }
    formElement.reset();
    setPasswordMessage("비밀번호를 변경했어요.");
  }

  return (
    <div className={styles.card}>
      <h1 className={styles.title}>내 계정</h1>
      <p className={styles.description}>표시 이름과 비밀번호를 관리할 수 있어요.</p>

      <h2 className={styles.sectionTitle}>표시 이름</h2>
      <form className={styles.form} onSubmit={saveDisplayName}>
        <label className={styles.field}>
          이름
          <input
            className={styles.input}
            name="displayName"
            autoComplete="nickname"
            maxLength={80}
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            required
          />
        </label>
        {nameMessage ? (
          <p className={`${styles.message} ${nameMessage.includes("저장했어요") ? styles.success : ""}`} role="status">
            {nameMessage}
          </p>
        ) : null}
        <button className={styles.button} type="submit" disabled={namePending}>
          {namePending ? "저장 중…" : "이름 저장"}
        </button>
      </form>

      <h2 className={styles.sectionTitle}>비밀번호</h2>
      <form className={styles.form} onSubmit={savePassword}>
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
        {passwordMessage ? (
          <p className={`${styles.message} ${passwordMessage.includes("변경했어요") ? styles.success : ""}`} role="status">
            {passwordMessage}
          </p>
        ) : null}
        <button className={styles.button} type="submit" disabled={passwordPending}>
          {passwordPending ? "변경 중…" : "비밀번호 변경"}
        </button>
      </form>
    </div>
  );
}
