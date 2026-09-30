export type PasswordPolicyIssue = "too_short" | "missing_letter" | "missing_digit";

export function passwordPolicyIssue(password: string): PasswordPolicyIssue | null {
  if ([...password].length < 8) return "too_short";
  if (!/[A-Za-z]/.test(password)) return "missing_letter";
  if (!/[0-9]/.test(password)) return "missing_digit";
  return null;
}

export function passwordPolicyMessage(issue: PasswordPolicyIssue | null): string {
  switch (issue) {
    case "too_short":
      return "비밀번호는 8자 이상 입력해 주세요.";
    case "missing_letter":
      return "비밀번호에 영문자를 1자 이상 포함해 주세요.";
    case "missing_digit":
      return "비밀번호에 숫자를 1자 이상 포함해 주세요.";
    default:
      return "";
  }
}
