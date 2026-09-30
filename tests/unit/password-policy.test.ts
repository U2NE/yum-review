import assert from "node:assert/strict";
import test from "node:test";
import { passwordPolicyIssue, passwordPolicyMessage } from "@/lib/auth/password-policy";
import { resolveAuthSiteOrigin, safeAuthReturnTo } from "@/lib/auth/redirect-url";

test("password policy requires eight characters, an ASCII letter, and a digit", () => {
  assert.equal(passwordPolicyIssue("A2345678"), null);
  assert.equal(passwordPolicyIssue("a234567!"), null);
  assert.equal(passwordPolicyIssue("ABCD1234"), null);
  assert.equal(passwordPolicyIssue("abc!defg"), "missing_digit");
  assert.equal(passwordPolicyIssue("1234!567"), "missing_letter");
  assert.equal(passwordPolicyIssue("A123456"), "too_short");
  assert.equal(passwordPolicyIssue("😀😀😀A1"), "too_short");
  assert.equal(passwordPolicyIssue("😀😀😀😀A1BC"), null);
  assert.equal(passwordPolicyMessage("missing_digit"), "비밀번호에 숫자를 1자 이상 포함해 주세요.");
});

test("production auth callbacks use the configured HTTPS site origin", () => {
  assert.equal(
    resolveAuthSiteOrigin({
      siteUrl: "https://yum-review.vercel.app/",
      requestOrigin: "http://localhost:3000",
      environment: "production",
    }),
    "https://yum-review.vercel.app",
  );
  assert.equal(
    resolveAuthSiteOrigin({ siteUrl: null, requestOrigin: "http://localhost:3000", environment: "production" }),
    null,
  );
  assert.equal(
    resolveAuthSiteOrigin({ siteUrl: null, requestOrigin: "http://localhost:3000", environment: "development" }),
    "http://localhost:3000",
  );
});

test("auth return paths cannot redirect to an external origin", () => {
  assert.equal(safeAuthReturnTo("/account?tab=reviews"), "/account?tab=reviews");
  assert.equal(safeAuthReturnTo("//example.com"), "/");
  assert.equal(safeAuthReturnTo("https://example.com"), "/");
});
