"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { passwordPolicyIssue, passwordPolicyMessage } from "@/lib/auth/password-policy";
import { safeAuthReturnTo } from "@/lib/auth/redirect-url";
import styles from "./auth.module.css";

function clearSubmittedPasswords(formElement: HTMLFormElement) {
  for (const name of ["currentPassword", "password", "confirmation"]) {
    const field = formElement.elements.namedItem(name);
    if (field instanceof HTMLInputElement) field.value = "";
  }
}

export function ForcePasswordChange({ returnTo }: { returnTo: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [gateRecoveryRequired, setGateRecoveryRequired] = useState(false);
  const [passwordOutcomeUnknown, setPasswordOutcomeUnknown] = useState(false);
  const [passwordChangeCommittedNeedsRecovery, setPasswordChangeCommittedNeedsRecovery] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    setMessage("");
    const form = new FormData(formElement);
    const currentPassword = String(form.get("currentPassword") ?? "");
    const password = String(form.get("password") ?? "");
    const confirmation = String(form.get("confirmation") ?? "");
    const policyIssue = passwordPolicyIssue(password);
    if (policyIssue) {
      setMessage(passwordPolicyMessage(policyIssue));
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
    try {
      const changed = await fetch("/api/account/legacy-password-change", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword: password }),
        credentials: "same-origin",
        cache: "no-store",
      });
      const result = await changed.json().catch(() => null) as {
        error?: string;
        gatePending?: boolean;
        outcomeUnknown?: boolean;
        passwordChanged?: boolean;
        passwordUnchanged?: boolean;
      } | null;

      if (!changed.ok) {
        if (result?.passwordUnchanged === true || changed.status === 400 || changed.status === 401 || changed.status === 403 || changed.status === 422) {
          setGateRecoveryRequired(false);
          setPasswordChangeCommittedNeedsRecovery(false);
          setPasswordOutcomeUnknown(false);
          setMessage(result?.error ?? "비밀번호를 변경하지 못했어요. 입력한 내용을 확인하고 다시 시도해 주세요.");
        } else if (result?.gatePending === true) {
          setGateRecoveryRequired(true);
          setPasswordChangeCommittedNeedsRecovery(result.passwordChanged === true);
          setPasswordOutcomeUnknown(result.passwordChanged !== true && result.outcomeUnknown === true);
          clearSubmittedPasswords(formElement);
          setMessage(result.error ?? "계정 완료 상태를 확인하지 못했어요. 현재 비밀번호에 방금 제출한 비밀번호를 입력하고 다시 변경해 주세요.");
        } else if (result?.passwordChanged === true) {
          setGateRecoveryRequired(false);
          setPasswordChangeCommittedNeedsRecovery(true);
          setPasswordOutcomeUnknown(false);
          clearSubmittedPasswords(formElement);
          setMessage(result.error ?? "비밀번호 변경은 적용됐어요. 방금 제출한 비밀번호가 현재 비밀번호입니다. 다시 변경하려면 현재 비밀번호 입력란에 입력해 주세요.");
        } else if (result?.outcomeUnknown === true || result === null) {
          setGateRecoveryRequired(false);
          setPasswordChangeCommittedNeedsRecovery(false);
          setPasswordOutcomeUnknown(true);
          clearSubmittedPasswords(formElement);
          setMessage(result?.error ?? "요청 결과를 확인하지 못했어요. 방금 제출한 새 비밀번호가 적용됐을 수 있습니다. 그 비밀번호를 현재 비밀번호로 입력하고, 다른 새 비밀번호로 다시 시도해 주세요.");
        } else if (changed.status >= 500) {
          setGateRecoveryRequired(false);
          setPasswordChangeCommittedNeedsRecovery(false);
          setPasswordOutcomeUnknown(true);
          clearSubmittedPasswords(formElement);
          setMessage("요청 결과를 확인하지 못했어요. 방금 제출한 새 비밀번호가 적용됐을 수 있습니다. 그 비밀번호를 현재 비밀번호로 입력하고, 다른 새 비밀번호로 다시 시도해 주세요.");
        } else {
          setMessage(result?.error ?? "비밀번호를 변경하지 못했어요. 입력한 내용을 확인하고 다시 시도해 주세요.");
        }
        return;
      }

      formElement.reset();
      setGateRecoveryRequired(false);
      setPasswordOutcomeUnknown(false);
      setPasswordChangeCommittedNeedsRecovery(false);
      router.replace(safeAuthReturnTo(returnTo));
      router.refresh();
    } catch {
      setGateRecoveryRequired(false);
      setPasswordChangeCommittedNeedsRecovery(false);
      setPasswordOutcomeUnknown(true);
      clearSubmittedPasswords(formElement);
      setMessage("요청 결과를 확인하지 못했어요. 방금 제출한 새 비밀번호가 현재 비밀번호로 적용됐을 수 있으니, 그것을 현재 비밀번호로 입력하고 다른 새 비밀번호로 다시 변경해 주세요.");
    } finally {
      setPending(false);
    }
  }

  return (
    <section className={styles.card}>
      <h1 className={styles.title}>
        {passwordChangeCommittedNeedsRecovery
          ? "비밀번호 변경은 적용됐어요"
          : passwordOutcomeUnknown
            ? "비밀번호 변경 결과를 확인해 주세요"
            : "비밀번호를 새로 설정해 주세요"}
      </h1>
      <p className={styles.description}>
        {gateRecoveryRequired
          ? passwordChangeCommittedNeedsRecovery
            ? "방금 제출한 새 비밀번호가 현재 비밀번호입니다. 다른 비밀번호로 다시 변경해 계정 완료 처리를 마쳐 주세요."
            : passwordOutcomeUnknown
              ? "계정 완료 처리가 보류 중이에요. 방금 제출한 새 비밀번호가 적용됐을 수 있으니 현재 비밀번호로 입력해 다시 변경해 주세요."
              : "계속 이용하려면 새 비밀번호가 필요해요. 변경이 확인되면 서비스를 이용할 수 있습니다."
          : passwordChangeCommittedNeedsRecovery
            ? "방금 제출한 새 비밀번호가 현재 비밀번호입니다. 이 비밀번호를 사용해 계속 이용해 주세요. 다시 변경하려면 현재 비밀번호 입력란에 방금 비밀번호를 입력하면 됩니다."
            : passwordOutcomeUnknown
              ? "요청 결과를 확인하지 못했어요. 방금 제출한 새 비밀번호가 적용됐을 수 있습니다. 그 비밀번호로 로그인되는지 확인하고, 적용되지 않았다면 현재 비밀번호를 다시 입력해 변경해 주세요."
              : "계속 이용하려면 새 비밀번호가 필요해요. 변경이 확인되면 서비스를 이용할 수 있습니다."}
      </p>
      <form className={styles.form} method="post" onSubmit={submit}>
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
        {message ? <p className={styles.message} role="alert">{message}</p> : null}
        <button className={styles.button} type="submit" disabled={pending}>
          {pending
            ? "변경 확인 중…"
            : gateRecoveryRequired
              ? "다른 비밀번호로 변경하고 완료 처리"
              : passwordChangeCommittedNeedsRecovery
                ? "다른 비밀번호로 변경"
                : passwordOutcomeUnknown
                  ? "비밀번호 변경 다시 시도"
                  : "비밀번호 변경"}
        </button>
      </form>
    </section>
  );
}
