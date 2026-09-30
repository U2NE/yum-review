"use client";

import { useState, type FormEvent } from "react";
import { passwordPolicyIssue, passwordPolicyMessage } from "@/lib/auth/password-policy";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import styles from "./auth.module.css";

function clearSubmittedPasswords(formElement: HTMLFormElement) {
  for (const name of ["currentPassword", "password", "confirmation"]) {
    const field = formElement.elements.namedItem(name);
    if (field instanceof HTMLInputElement) field.value = "";
  }
}

const unknownPasswordChangeMessage = "요청 결과를 확인하지 못했어요. 방금 제출한 새 비밀번호가 현재 비밀번호로 적용됐을 수 있습니다. 현재 비밀번호 입력란에 그 비밀번호를 입력하고, 다음 새 비밀번호는 그 비밀번호와 다르게 설정해 주세요.";

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
  const [gateRecoveryRequired, setGateRecoveryRequired] = useState(false);
  const [passwordOutcomeUnknown, setPasswordOutcomeUnknown] = useState(false);
  const [passwordChangeCommittedNeedsRecovery, setPasswordChangeCommittedNeedsRecovery] = useState(false);

  async function saveDisplayName(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setNameMessage("");
    const cleaned = displayName.trim();
    if (!cleaned || cleaned.length > 80) {
      setNameMessage("이름은 1자 이상 80자 이하로 입력해 주세요.");
      return;
    }

    setNamePending(true);
    const supabase = createSupabaseBrowserClient();
    const { data: frozen, error: freezeError } = await supabase.rpc("personal_data_write_is_frozen");
    if (freezeError || frozen !== false) {
      setNamePending(false);
      setNameMessage("개인정보 변경을 잠시 중단했습니다.");
      return;
    }
    const { error } = await supabase
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

    const policyIssue = passwordPolicyIssue(password);
    if (policyIssue) {
      setPasswordMessage(passwordPolicyMessage(policyIssue));
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
    try {
      const response = await fetch("/api/account/legacy-password-change", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword: password }),
        credentials: "same-origin",
        cache: "no-store",
      });
      const result = await response.json().catch(() => null) as {
        error?: string;
        gatePending?: boolean;
        outcomeUnknown?: boolean;
        passwordChanged?: boolean;
        passwordUnchanged?: boolean;
      } | null;

      if (!response.ok) {
        if (result?.passwordUnchanged === true || response.status === 400 || response.status === 401 || response.status === 403 || response.status === 422) {
          setGateRecoveryRequired(false);
          setPasswordChangeCommittedNeedsRecovery(false);
          setPasswordOutcomeUnknown(false);
          setPasswordMessage(result?.error ?? "비밀번호를 변경하지 못했어요. 입력한 내용을 확인하고 다시 시도해 주세요.");
          return;
        }
        if (!result) {
          setGateRecoveryRequired(false);
          setPasswordChangeCommittedNeedsRecovery(false);
          setPasswordOutcomeUnknown(true);
          clearSubmittedPasswords(formElement);
          setPasswordMessage(unknownPasswordChangeMessage);
          return;
        }

        if (result?.gatePending === true) {
          setGateRecoveryRequired(true);
          setPasswordChangeCommittedNeedsRecovery(result.passwordChanged === true);
          setPasswordOutcomeUnknown(result.passwordChanged !== true);
          clearSubmittedPasswords(formElement);
        } else if (result?.passwordChanged === true) {
          setGateRecoveryRequired(false);
          setPasswordChangeCommittedNeedsRecovery(true);
          setPasswordOutcomeUnknown(false);
          clearSubmittedPasswords(formElement);
        } else if (result?.outcomeUnknown === true) {
          setGateRecoveryRequired(false);
          setPasswordChangeCommittedNeedsRecovery(false);
          setPasswordOutcomeUnknown(true);
          clearSubmittedPasswords(formElement);
        } else if (response.status >= 500) {
          setGateRecoveryRequired(false);
          setPasswordChangeCommittedNeedsRecovery(false);
          setPasswordOutcomeUnknown(true);
          clearSubmittedPasswords(formElement);
          setPasswordMessage(unknownPasswordChangeMessage);
          return;
        }
        setPasswordMessage(result.error ?? "비밀번호를 변경하지 못했어요. 잠시 후 다시 시도해 주세요.");
        return;
      }

      formElement.reset();
      setGateRecoveryRequired(false);
      setPasswordOutcomeUnknown(false);
      setPasswordChangeCommittedNeedsRecovery(false);
      setPasswordMessage("비밀번호를 변경했어요.");
    } catch {
      setGateRecoveryRequired(false);
      setPasswordChangeCommittedNeedsRecovery(false);
      setPasswordOutcomeUnknown(true);
      clearSubmittedPasswords(formElement);
      setPasswordMessage(unknownPasswordChangeMessage);
    } finally {
      setPasswordPending(false);
    }
  }

  return (
    <section className={styles.card} aria-labelledby="account-settings-title">
      <h2 className={styles.title} id="account-settings-title">프로필과 비밀번호</h2>
      <p className={styles.description}>표시 이름과 비밀번호를 관리할 수 있어요.</p>

      <h3 className={styles.sectionTitle}>표시 이름</h3>
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

      <h3 className={styles.sectionTitle}>비밀번호</h3>
      <form className={styles.form} method="post" onSubmit={savePassword}>
        <label className={styles.field}>
          {passwordChangeCommittedNeedsRecovery
            ? "방금 제출해 변경된 비밀번호 (현재 비밀번호)"
            : gateRecoveryRequired || passwordOutcomeUnknown
              ? "방금 제출한 새 비밀번호일 수 있는 현재 비밀번호"
              : "현재 비밀번호"}
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
          <p className={`${styles.message} ${passwordMessage === "비밀번호를 변경했어요." ? styles.success : ""}`} role="status">
            {passwordMessage}
          </p>
        ) : null}
        <button className={styles.button} type="submit" disabled={passwordPending}>
          {passwordPending ? "변경 중…" : gateRecoveryRequired ? "다른 비밀번호로 변경하고 완료 처리" : "비밀번호 변경"}
        </button>
      </form>
    </section>
  );
}
