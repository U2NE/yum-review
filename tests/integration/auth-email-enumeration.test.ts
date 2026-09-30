import assert from "node:assert/strict";
import { AsyncLocalStorage } from "node:async_hooks";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import { transformSync } from "esbuild";
import { safeAuthReturnTo } from "@/lib/auth/redirect-url";

const endpointUrl = "https://supabase.invalid";

// Next 16.3 reads this Node primitive from globalThis while initializing its request stores.
(globalThis as typeof globalThis & { AsyncLocalStorage?: typeof AsyncLocalStorage }).AsyncLocalStorage ??= AsyncLocalStorage;

test("rate limit SQL preserves same-window increments and records the attempted bucket", async () => {
  const migration = await readFile(
    resolve(process.cwd(), "supabase/migrations/20260928130000_auth_email_lookup_limits.sql"),
    "utf8",
  );

  // This structural check does not exercise PostgreSQL transaction or lock concurrency behavior.
  assert.match(
    migration,
    /WHEN current_state\.window_started_at = EXCLUDED\.window_started_at\s+THEN current_state\.attempt_count \+ 1\s+ELSE 1\s+END/,
  );
  assert.match(
    migration,
    /WHERE EXCLUDED\.window_started_at > current_state\.window_started_at\s+OR\s+\(\s*EXCLUDED\.window_started_at = current_state\.window_started_at\s+AND current_state\.attempt_count < 10\s*\)/,
  );
  assert.match(migration, /v_attempted_window_started_at timestamptz/);
  assert.match(migration, /p_ip_hash, v_attempted_window_started_at, 1, v_now/);
});

test("a delayed old-window request is rebucketed before Retry-After is calculated", async () => {
  const migration = await readFile(
    resolve(process.cwd(), "supabase/migrations/20260928130000_auth_email_lookup_limits.sql"),
    "utf8",
  );
  const staleRequestRecovery = migration.indexOf("A request may have waited on the per-IP row across a minute boundary.");
  const refreshNow = migration.indexOf("v_now := pg_catalog.clock_timestamp();", staleRequestRecovery);
  const compareWithCurrentWindow = migration.indexOf("IF v_attempted_window_started_at < pg_catalog.to_timestamp(", refreshNow);
  const retryCurrentBucket = migration.indexOf("CONTINUE;", compareWithCurrentWindow);
  const retryAfter = migration.indexOf("v_retry_after := GREATEST(", retryCurrentBucket);

  assert.ok(staleRequestRecovery >= 0);
  assert.ok(refreshNow > staleRequestRecovery);
  assert.ok(compareWithCurrentWindow > refreshNow);
  assert.ok(retryCurrentBucket > compareWithCurrentWindow);
  assert.ok(retryAfter > retryCurrentBucket);
});

test("stale-bucket model retries old attempts and preserves 429 for a full current bucket", async () => {
  const migration = await readFile(
    resolve(process.cwd(), "supabase/migrations/20260928130000_auth_email_lookup_limits.sql"),
    "utf8",
  );
  // Model-level only: this does not exercise PostgreSQL row locks or transactions.
  const shouldRetry = (attempted: number, stored: number, current: number) => attempted < current || stored < current;
  assert.equal(shouldRetry(60, 120, 120), true, "an old attempted bucket retries into the current bucket");
  assert.equal(shouldRetry(120, 120, 120), false, "a full current bucket remains rate-limited");
  assert.match(migration, /LEAST\(v_retry_after, 60\)/);
});

test("direct Supabase signup has an explicit provider rate limit while duplicate guidance stays enabled", async () => {
  const [config, signup, guidance] = await Promise.all([
    readFile(resolve(process.cwd(), "supabase/config.toml"), "utf8"),
    readFile(resolve(process.cwd(), "components/auth/SignupForm.tsx"), "utf8"),
    readFile(resolve(process.cwd(), "docs/migration/confirmation-email.md"), "utf8"),
  ]);

  assert.match(config, /\[auth\.rate_limit\][\s\S]*?sign_in_sign_ups\s*=\s*10/);
  assert.match(signup, /이미 가입된 이메일입니다\. 로그인하거나 비밀번호를 확인해 주세요\./);
  assert.match(signup, /data\.user\.identities\.length === 0/);
  assert.match(guidance, /직접 요청은 앱의 이메일 상태 조회 카운터를 사용하지 않습니다|direct requests do not consume the app's email-status counter/);
  assert.match(guidance, /hosted sign-up\/sign-in rate limit before deployment/);
});

test("password-change route requires a real different password update before clearing the legacy gate", async () => {
  const route = await readFile(resolve(process.cwd(), "app/api/account/legacy-password-change/route.ts"), "utf8");

  assert.doesNotMatch(route, /completeGateOnly/);
  assert.match(route, /passwordPolicyIssue\(newPassword\)/);
  assert.match(route, /currentPassword === newPassword/);
  assert.match(route, /supabase\.auth\.updateUser\(\{ password: newPassword \}\)/);
  assert.ok(route.indexOf("supabase.auth.updateUser({ password: newPassword })") < route.indexOf('admin.rpc("clear_legacy_password_gate_after_verified_change"'));
  assert.match(route, /passwordChanged = true/);
  assert.match(route, /passwordChanged:\s*true,\s*gatePending:\s*true/);
  assert.match(route, /방금 제출한 새 비밀번호를 현재 비밀번호로 입력하고, 다른 새 비밀번호로 다시 변경/);
});

test("legacy password-change route rejects non-string password fields before authentication", async () => {
  const { POST: postLegacyPasswordChange } = await import("@/app/api/account/legacy-password-change/route");
  const invalidBodies = [
    { currentPassword: { toString: "value" }, newPassword: "Validpass123" },
    { currentPassword: "Currentpass123", newPassword: { toString: "value" } },
    { currentPassword: ["value"], newPassword: "Validpass123" },
  ];

  for (const body of invalidBodies) {
    const response = await postLegacyPasswordChange(new Request("http://localhost:3000/api/account/legacy-password-change", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "http://localhost:3000" },
      body: JSON.stringify(body),
    }));
    assert.equal(response.status, 400);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.deepEqual(await response.json(), { error: "현재 비밀번호와 새 비밀번호를 확인해 주세요." });
  }
});

test("ambiguous password update outcomes keep recovery pending until a verified retry", async () => {
  const route = await readFile(resolve(process.cwd(), "app/api/account/legacy-password-change/route.ts"), "utf8");
  const gatePreflight = route.indexOf('await supabase.rpc("legacy_password_change_required")');
  const updateAttempt = route.indexOf("passwordUpdateAttempted = true;");
  const providerUpdate = route.indexOf("await supabase.auth.updateUser({ password: newPassword })", updateAttempt);
  const gateClear = route.indexOf('admin.rpc("clear_legacy_password_gate_after_verified_change"', providerUpdate);
  const rejectedAttemptRecovery = route.indexOf("if (passwordUpdateAttempted) return uncertainPasswordUpdateReply(legacyGateConfirmed);", gateClear);
  const recovery = route.slice(0, updateAttempt);

  assert.ok(gatePreflight >= 0);
  assert.ok(gatePreflight < updateAttempt);
  assert.ok(updateAttempt >= 0);
  assert.ok(providerUpdate > updateAttempt);
  assert.ok(gateClear > providerUpdate);
  assert.ok(rejectedAttemptRecovery > gateClear);
  assert.match(route, /if \(isRetryablePasswordUpdateError\(changeError\)\) return uncertainPasswordUpdateReply\(legacyGateConfirmed\)/);
  assert.match(route, /return unchangedPasswordReply\("비밀번호를 변경하지 못했습니다\. 다시 시도해 주세요\.", 422\)/);
  assert.match(route, /if \(changed\.user\?\.id !== user\.id\) return uncertainPasswordUpdateReply\(legacyGateConfirmed\)/);
  assert.match(route, /function unchangedPasswordReply\(error: string, status: number\)[\s\S]*passwordUnchanged: true/);
  assert.match(recovery, /function uncertainPasswordUpdateReply\(legacyGateConfirmed: boolean\)/);
  assert.match(recovery, /if \(legacyGateConfirmed\)[\s\S]*gatePending: true, outcomeUnknown: true/);
  assert.match(recovery, /outcomeUnknown: true/);
  assert.match(recovery, /방금 제출한 새 비밀번호가 현재 비밀번호로 적용됐을 수 있습니다/);
  assert.match(recovery, /그 비밀번호를 현재 비밀번호로 입력하고, 이전과 다른 새 비밀번호로 다시 변경해 주세요/);
  assert.match(route, /headers:\s*\{\s*"Cache-Control":\s*"no-store"/);
});

const passwordChangeUser = {
  id: "password-change-test-user",
  aud: "authenticated",
  role: "authenticated",
  email: "password-change@example.test",
  app_metadata: { provider: "email", providers: ["email"] },
  user_metadata: {},
  created_at: "2024-01-01T00:00:00.000Z",
};

function passwordChangeSession() {
  const expiresAt = Math.floor(Date.now() / 1000) + 3600;
  return {
    access_token: "test-access-token",
    token_type: "bearer",
    expires_in: 3600,
    expires_at: expiresAt,
    refresh_token: "test-refresh-token",
    user: passwordChangeUser,
  };
}

async function inNextRequestContext<T>(run: () => Promise<T>) {
  const [{ RequestCookies }, { workAsyncStorage }, { workUnitAsyncStorage }] = await Promise.all([
    import("next/dist/server/web/spec-extension/cookies"),
    import("next/dist/server/app-render/work-async-storage.external"),
    import("next/dist/server/app-render/work-unit-async-storage.external"),
  ]);
  const session = passwordChangeSession();
  const encodedSession = Buffer.from(JSON.stringify(session), "utf8").toString("base64url");
  const cookieStore = new RequestCookies(new Headers({ cookie: `sb-project-auth-token=base64-${encodedSession}` }));
  const workStore = { route: "/api/account/legacy-password-change", forceStatic: false, dynamicShouldError: false };
  const workUnitStore = { type: "request", phase: "render", cookies: cookieStore };
  return workAsyncStorage.run(workStore as never, () => workUnitAsyncStorage.run(workUnitStore as never, run));
}

async function postPasswordChangeWithMockedUpdate(
  update: () => Promise<Response>,
  legacyGateRequired = true,
  postflightGateResponse?: Response,
  preflightGateResponse?: Response,
) {
  const { POST: postLegacyPasswordChange } = await import("@/app/api/account/legacy-password-change/route");
  const originalFetch = globalThis.fetch;
  const previousUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const previousPublishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const endpoint = "https://project.supabase.co";
  let updateCalls = 0;
  let gateCalls = 0;
  const freshSession = passwordChangeSession();
  process.env.NEXT_PUBLIC_SUPABASE_URL = endpoint;
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "test-only-publishable-key";
  globalThis.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const method = init?.method ?? (input instanceof Request ? input.method : "GET");
    const pathname = new URL(url).pathname;
    if (pathname.endsWith("/auth/v1/user") && method === "GET") return Response.json(passwordChangeUser);
    if (pathname.endsWith("/auth/v1/token")) return Response.json(freshSession);
    if (pathname.endsWith("/rest/v1/rpc/legacy_password_change_required")) {
      gateCalls += 1;
      if (gateCalls === 1 && preflightGateResponse) return preflightGateResponse;
      if (gateCalls > 1 && postflightGateResponse) return postflightGateResponse;
      return Response.json(legacyGateRequired);
    }
    if (pathname.endsWith("/auth/v1/user") && method === "PUT") {
      updateCalls += 1;
      return update();
    }
    throw new Error("Unexpected Supabase request in password change test");
  };

  try {
    const response = await inNextRequestContext(() => postLegacyPasswordChange(new Request(
      "http://localhost:3000/api/account/legacy-password-change",
      {
        method: "POST",
        headers: { "content-type": "application/json", origin: "http://localhost:3000" },
        body: JSON.stringify({ currentPassword: "Currentpass123", newPassword: "Newpass1234" }),
      },
    )));
    return { response, updateCalls, gateCalls };
  } finally {
    globalThis.fetch = originalFetch;
    if (previousUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    else process.env.NEXT_PUBLIC_SUPABASE_URL = previousUrl;
    if (previousPublishableKey === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    else process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = previousPublishableKey;
  }
}

test("retryable failures preserve gate recovery only for a confirmed legacy-gated account", async () => {
  const outcomes = [
    await postPasswordChangeWithMockedUpdate(async () => new Response(JSON.stringify({ message: "temporary auth outage" }), {
      status: 503,
      headers: { "content-type": "application/json" },
    }), true),
    await postPasswordChangeWithMockedUpdate(async () => { throw new TypeError("simulated network interruption"); }, true),
  ];

  for (const { response, updateCalls } of outcomes) {
    assert.equal(updateCalls, 1);
    assert.equal(response.status, 503);
    assert.equal(response.headers.get("cache-control"), "no-store");
    const body = await response.json();
    assert.equal(body.gatePending, true);
    assert.match(body.error, /비밀번호가 현재 비밀번호로 적용됐을 수 있습니다/);
    assert.doesNotMatch(JSON.stringify(body), /password-change@example\.test|Currentpass123|Newpass1234/);
  }
});

test("ordinary member retryable failures report an unknown outcome without legacy gate guidance", async () => {
  const outcomes = [
    await postPasswordChangeWithMockedUpdate(async () => new Response(JSON.stringify({ message: "temporary auth outage" }), {
      status: 503,
      headers: { "content-type": "application/json" },
    }), false),
    await postPasswordChangeWithMockedUpdate(async () => { throw new TypeError("simulated network interruption"); }, false),
  ];

  for (const { response, updateCalls } of outcomes) {
    assert.equal(updateCalls, 1);
    assert.equal(response.status, 503);
    assert.equal(response.headers.get("cache-control"), "no-store");
    const body = await response.json();
    assert.equal(body.gatePending, undefined);
    assert.equal(body.outcomeUnknown, true);
    assert.match(body.error, /새 비밀번호로 로그인되는지 확인해 주세요/);
    assert.doesNotMatch(JSON.stringify(body), /계정 완료 처리는 보류|legacy|레거시/);
    assert.doesNotMatch(JSON.stringify(body), /password-change@example\.test|Currentpass123|Newpass1234/);
  }
});

test("resolved definite password update rejection remains 422 without pending recovery", async () => {
  const { response, updateCalls } = await postPasswordChangeWithMockedUpdate(async () => new Response(JSON.stringify({
    message: "password rejected",
    code: "weak_password",
  }), { status: 422, headers: { "content-type": "application/json" } }), true);

  assert.equal(updateCalls, 1);
  assert.equal(response.status, 422);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), { error: "비밀번호를 변경하지 못했습니다. 다시 시도해 주세요.", passwordUnchanged: true });
});

test("legacy gate preflight failure marks the password unchanged before updateUser", async () => {
  const { response, updateCalls, gateCalls } = await postPasswordChangeWithMockedUpdate(
    async () => Response.json(passwordChangeUser),
    true,
    undefined,
    new Response(JSON.stringify({ message: "temporary RPC outage" }), {
      status: 503,
      headers: { "content-type": "application/json" },
    }),
  );

  assert.equal(updateCalls, 0);
  assert.equal(gateCalls, 1);
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), {
    error: "계정 상태를 확인할 수 없어 비밀번호를 변경하지 않았습니다. 잠시 후 다시 시도해 주세요.",
    passwordUnchanged: true,
  });

  for (const file of ["components/auth/AccountSettings.tsx", "components/auth/ForcePasswordChange.tsx"]) {
    const source = await readFile(resolve(process.cwd(), file), "utf8");
    const responseStart = source.indexOf(file.endsWith("AccountSettings.tsx") ? "      if (!response.ok) {" : "      if (!changed.ok) {");
    const responseEnd = source.indexOf("      formElement.reset();", responseStart);
    const nonOkResponse = source.slice(responseStart, responseEnd);
    const definiteBranchStart = nonOkResponse.indexOf("if (result?.passwordUnchanged === true");
    const branchEnds = [
      nonOkResponse.indexOf("if (!result)", definiteBranchStart),
      nonOkResponse.indexOf("} else if", definiteBranchStart),
    ].filter((position) => position >= 0);
    const definiteBranchEnd = Math.min(...branchEnds);
    const definiteBranch = nonOkResponse.slice(definiteBranchStart, definiteBranchEnd);
    assert.match(source, /passwordUnchanged\?: boolean/);
    assert.match(nonOkResponse, /passwordUnchanged === true \|\| (?:response|changed)\.status === 400[\s\S]*\.status === 401[\s\S]*\.status === 403[\s\S]*\.status === 422[\s\S]*setPasswordOutcomeUnknown\(false\)/);
    assert.match(nonOkResponse, file.endsWith("AccountSettings.tsx")
      ? /setPasswordMessage\(result\?\.error[\s\S]*return;/
      : /setMessage\(result\?\.error[\s\S]*return;/);
    assert.doesNotMatch(definiteBranch, /clearSubmittedPasswords\(formElement\)/);
  }
});

type PasswordFormFetchCall = { input: RequestInfo | URL; init?: RequestInit };

function getGlobalPropertyDescriptor(name: "FormData" | "fetch" | "HTMLInputElement") {
  return Object.getOwnPropertyDescriptor(globalThis, name);
}

function restoreGlobalProperty(name: "FormData" | "fetch" | "HTMLInputElement", descriptor: PropertyDescriptor | undefined) {
  if (descriptor) Object.defineProperty(globalThis, name, descriptor);
  else Reflect.deleteProperty(globalThis, name);
}

async function invokePasswordFormHandler(
  file: string,
  componentName: string,
  statuses: number[],
  responseBodies: Array<Record<string, unknown> | null> = [],
  refills?: Array<{ currentPassword: string; password: string; confirmation: string }>,
) {
  const source = await readFile(resolve(process.cwd(), file), "utf8");
  const compiled = transformSync(source, { loader: "tsx", format: "cjs", jsx: "automatic", target: "node20" }).code;
  const hookValues: unknown[] = [];
  let hookIndex = 0;
  const jsx = (type: unknown, props: Record<string, unknown>) => ({ type, props });
  const reactStub = {
    useState<T>(initial: T): [T, (next: T | ((previous: T) => T)) => void] {
      const index = hookIndex++;
      hookValues[index] ??= initial;
      return [hookValues[index] as T, (next) => {
        hookValues[index] = typeof next === "function" ? (next as (previous: T) => T)(hookValues[index] as T) : next;
      }];
    },
  };
  class TestInputElement { value = ""; }
  const fields = Object.fromEntries(["currentPassword", "password", "confirmation"].map((name) => {
    const field = new TestInputElement();
    field.value = name === "currentPassword" ? "Currentpass123" : "Newpass1234";
    return [name, field];
  }));
  const formElement = {
    elements: { namedItem: (name: string) => fields[name as keyof typeof fields] },
    reset() { for (const field of Object.values(fields)) field.value = ""; },
  };
  const originalDescriptors = {
    FormData: getGlobalPropertyDescriptor("FormData"),
    HTMLInputElement: getGlobalPropertyDescriptor("HTMLInputElement"),
    fetch: getGlobalPropertyDescriptor("fetch"),
  };
  const fetchCalls: PasswordFormFetchCall[] = [];
  let responseIndex = 0;
  Object.assign(globalThis, {
    FormData: class { get(name: string) { return fields[name as keyof typeof fields]?.value ?? null; } },
    HTMLInputElement: TestInputElement,
    fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
      fetchCalls.push({ input, init });
      const status = statuses[responseIndex++];
      if (status === undefined) throw new Error("Unexpected extra password form fetch");
      const body = responseBodies[responseIndex - 1];
      return new Response(body === undefined || body === null ? null : JSON.stringify(body), {
        status,
        headers: body === undefined || body === null ? undefined : { "content-type": "application/json" },
      });
    },
  });

  try {
    const moduleObject = { exports: {} as Record<string, unknown> };
    const requireStub = (specifier: string) => {
      if (specifier === "react") return reactStub;
      if (specifier === "react/jsx-runtime") return { jsx, jsxs: jsx };
      if (specifier === "./auth.module.css") return {};
      if (specifier === "next/navigation") return { useRouter: () => ({ replace() {}, refresh() {} }) };
      if (specifier === "@/lib/auth/password-policy") return { passwordPolicyIssue: () => null, passwordPolicyMessage: () => "" };
      if (specifier === "@/lib/auth/redirect-url") return { safeAuthReturnTo: (value: string) => value };
      if (specifier === "@/lib/supabase/browser") return { createSupabaseBrowserClient: () => ({}) };
      throw new Error(`Unexpected component import: ${specifier}`);
    };
    new Function("require", "module", "exports", compiled)(requireStub, moduleObject, moduleObject.exports);
    const component = moduleObject.exports[componentName] as (props: Record<string, string>) => unknown;
    const render = () => {
      hookIndex = 0;
      return component(componentName === "AccountSettings" ? { userId: "test-user", initialDisplayName: "Test" } : { returnTo: "/account" });
    };
    const findForm = (node: unknown): { props: { onSubmit: (event: unknown) => Promise<void> } } | undefined => {
      if (!node || typeof node !== "object") return undefined;
      const element = node as { type?: unknown; props?: { children?: unknown; onSubmit?: unknown } };
      if (element.type === "form" && typeof element.props?.onSubmit === "function") return element as { props: { onSubmit: (event: unknown) => Promise<void> } };
      const children = element.props?.children;
      for (const child of Array.isArray(children) ? children : [children]) {
        const found = findForm(child);
        if (found) return found;
      }
      return undefined;
    };
    const initialTree = render();
    const forms: unknown[] = [];
    const collectForms = (node: unknown) => {
      if (!node || typeof node !== "object") return;
      const element = node as { type?: unknown; props?: { children?: unknown; onSubmit?: unknown } };
      if (element.type === "form" && typeof element.props?.onSubmit === "function") forms.push(node);
      const children = element.props?.children;
      for (const child of Array.isArray(children) ? children : [children]) collectForms(child);
    };
    collectForms(initialTree);
    const form = componentName === "AccountSettings" ? forms[1] : findForm(initialTree);
    assert.ok(form, `${componentName} password form should render`);
    const textContent = (node: unknown): string => {
      if (typeof node === "string") return node;
      if (!node || typeof node !== "object") return "";
      const children = (node as { props?: { children?: unknown } }).props?.children;
      return (Array.isArray(children) ? children : [children]).map(textContent).join(" ");
    };
    const submit = (target: typeof formElement) => (form as { props: { onSubmit: (event: unknown) => Promise<void> } }).props.onSubmit({
      preventDefault() {},
      currentTarget: target,
    });
    const snapshot = () => ({
      values: Object.fromEntries(Object.entries(fields).map(([name, field]) => [name, field.value])),
      text: textContent(render()),
    });
    const steps = [];
    for (let index = 0; index < statuses.length; index += 1) {
      if (index > 0) {
        const refill = refills?.[index - 1] ?? {
          currentPassword: "RecoveredCurrent456",
          password: "RecoveredNew789",
          confirmation: "RecoveredNew789",
        };
        fields.currentPassword.value = refill.currentPassword;
        fields.password.value = refill.password;
        fields.confirmation.value = refill.confirmation;
      }
      await submit(formElement);
      steps.push(snapshot());
    }
    return { steps, fetchCalls };
  } finally {
    restoreGlobalProperty("FormData", originalDescriptors.FormData);
    restoreGlobalProperty("fetch", originalDescriptors.fetch);
    restoreGlobalProperty("HTMLInputElement", originalDescriptors.HTMLInputElement);
  }
}

test("empty definite 400, 401, 403, and 422 responses preserve inputs and request contract in both password forms", async () => {
  for (const [file, component] of [
    ["components/auth/AccountSettings.tsx", "AccountSettings"],
    ["components/auth/ForcePasswordChange.tsx", "ForcePasswordChange"],
  ]) {
    for (const status of [400, 401, 403, 422]) {
      const result = await invokePasswordFormHandler(file, component, [status]);
      assert.equal(result.fetchCalls.length, 1, `${component} should make one request for ${status}`);
      const [call] = result.fetchCalls;
      assert.equal(call.input, "/api/account/legacy-password-change");
      assert.equal(call.init?.method, "POST");
      assert.equal(call.init?.credentials, "same-origin");
      assert.equal(call.init?.cache, "no-store");
      assert.deepEqual(JSON.parse(String(call.init?.body)), {
        currentPassword: "Currentpass123",
        newPassword: "Newpass1234",
      });
      assert.deepEqual(result.steps[0].values, {
        currentPassword: "Currentpass123",
        password: "Newpass1234",
        confirmation: "Newpass1234",
      }, `${component} should preserve submitted fields for ${status}`);
      assert.match(result.steps[0].text, /비밀번호를 변경하지 못했어요/);
      assert.doesNotMatch(result.steps[0].text, /요청 결과를 확인하지 못했어요|적용됐을 수 있습니다|완료 처리가 보류/);
    }
  }
});

test("a definite rejection after an ambiguous password response clears stale recovery UI in both forms", async () => {
  for (const [file, component] of [
    ["components/auth/AccountSettings.tsx", "AccountSettings"],
    ["components/auth/ForcePasswordChange.tsx", "ForcePasswordChange"],
  ]) {
    const result = await invokePasswordFormHandler(file, component, [503, 401]);
    assert.equal(result.fetchCalls.length, 2, `${component} should make exactly two requests`);
    assert.deepEqual(result.steps[0].values, { currentPassword: "", password: "", confirmation: "" });
    assert.match(result.steps[0].text, /요청 결과를 확인하지 못했어요|적용됐을 수 있습니다/);
    assert.deepEqual(result.steps[1].values, {
      currentPassword: "RecoveredCurrent456",
      password: "RecoveredNew789",
      confirmation: "RecoveredNew789",
    });
    assert.match(result.steps[1].text, /비밀번호를 변경하지 못했어요/);
    assert.doesNotMatch(result.steps[1].text, /요청 결과를 확인하지 못했어요|적용됐을 수 있습니다|완료 처리가 보류/);
    assert.deepEqual(result.fetchCalls.map(({ input, init }) => ({
      input,
      method: init?.method,
      credentials: init?.credentials,
      cache: init?.cache,
      body: JSON.parse(String(init?.body)),
    })), [
      {
        input: "/api/account/legacy-password-change",
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        body: { currentPassword: "Currentpass123", newPassword: "Newpass1234" },
      },
      {
        input: "/api/account/legacy-password-change",
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        body: { currentPassword: "RecoveredCurrent456", newPassword: "RecoveredNew789" },
      },
    ]);
  }
});

test("a definite rejection clears confirmed gate-pending recovery UI in both password forms", async () => {
  for (const [file, component] of [
    ["components/auth/AccountSettings.tsx", "AccountSettings"],
    ["components/auth/ForcePasswordChange.tsx", "ForcePasswordChange"],
  ]) {
    const result = await invokePasswordFormHandler(file, component, [503, 401], [
      {
        error: "비밀번호 변경 결과를 확인하지 못했어요. 방금 제출한 새 비밀번호가 현재 비밀번호로 적용됐을 수 있습니다. 그 비밀번호를 현재 비밀번호로 입력하고, 이전과 다른 새 비밀번호로 다시 변경해 주세요. 변경을 확인할 때까지 계정 완료 처리는 보류됩니다.",
        gatePending: true,
        outcomeUnknown: true,
      },
      null,
    ]);
    assert.deepEqual(result.steps[0].values, { currentPassword: "", password: "", confirmation: "" });
    assert.match(result.steps[0].text, /계정 완료 처리는 보류됩니다/);
    assert.match(result.steps[0].text, /방금 제출한 새 비밀번호일 수 있는 현재 비밀번호/);
    assert.match(result.steps[0].text, /다른 비밀번호로 변경하고 완료 처리/);
    assert.deepEqual(result.steps[1].values, {
      currentPassword: "RecoveredCurrent456",
      password: "RecoveredNew789",
      confirmation: "RecoveredNew789",
    });
    assert.match(result.steps[1].text, /비밀번호를 변경하지 못했어요/);
    assert.doesNotMatch(result.steps[1].text, /완료 처리|계정 완료 처리가 보류 중이에요|방금 제출한 새 비밀번호일 수 있는 현재 비밀번호|요청 결과를 확인하지 못했어요|적용됐을 수 있습니다/);
    assert.deepEqual(result.fetchCalls.map(({ input, init }) => ({
      input,
      method: init?.method,
      credentials: init?.credentials,
      cache: init?.cache,
      body: JSON.parse(String(init?.body)),
    })), [
      {
        input: "/api/account/legacy-password-change",
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        body: { currentPassword: "Currentpass123", newPassword: "Newpass1234" },
      },
      {
        input: "/api/account/legacy-password-change",
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        body: { currentPassword: "RecoveredCurrent456", newPassword: "RecoveredNew789" },
      },
    ]);
  }
});

test("a definite rejection clears committed-password recovery UI in both password forms", async () => {
  const refill = {
    currentPassword: "Newpass1234",
    password: "Differentpass5678",
    confirmation: "Differentpass5678",
  };
  assert.notEqual(refill.currentPassword, refill.password);

  for (const [file, component] of [
    ["components/auth/AccountSettings.tsx", "AccountSettings"],
    ["components/auth/ForcePasswordChange.tsx", "ForcePasswordChange"],
  ]) {
    const result = await invokePasswordFormHandler(
      file,
      component,
      [503, 401],
      [
        {
          error: "비밀번호 변경은 적용됐어요. 방금 제출한 새 비밀번호를 현재 비밀번호로 입력하고, 다른 새 비밀번호로 다시 변경해 계정 완료 처리를 마쳐 주세요.",
          passwordChanged: true,
          gatePending: true,
        },
        null,
      ],
      [refill],
    );
    assert.deepEqual(result.steps[0].values, { currentPassword: "", password: "", confirmation: "" });
    assert.match(result.steps[0].text, /방금 제출해 변경된 비밀번호 \(현재 비밀번호\)/);
    assert.match(result.steps[0].text, /변경해 계정 완료 처리를 마쳐 주세요/);
    assert.match(result.steps[0].text, /다른 비밀번호로 변경하고 완료 처리/);
    assert.deepEqual(result.steps[1].values, refill);
    assert.match(result.steps[1].text, /비밀번호를 변경하지 못했어요/);
    assert.doesNotMatch(result.steps[1].text, /방금 제출해 변경된 비밀번호 \(현재 비밀번호\)|방금 제출한 새 비밀번호가 현재 비밀번호입니다|비밀번호 변경은 적용됐어요|요청 결과를 확인하지 못했어요|완료 처리가 보류/);
    assert.deepEqual(result.fetchCalls.map(({ input, init }) => ({
      input,
      method: init?.method,
      credentials: init?.credentials,
      cache: init?.cache,
      body: JSON.parse(String(init?.body)),
    })), [
      {
        input: "/api/account/legacy-password-change",
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        body: { currentPassword: "Currentpass123", newPassword: "Newpass1234" },
      },
      {
        input: "/api/account/legacy-password-change",
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        body: { currentPassword: refill.currentPassword, newPassword: refill.password },
      },
    ]);
  }
});

test("ordinary account reports committed password and recovery input when postflight gate verification fails", async () => {
  const outcomes = [
    await postPasswordChangeWithMockedUpdate(
      async () => Response.json(passwordChangeUser),
      false,
      new Response(JSON.stringify({ message: "temporary RPC outage" }), {
        status: 503,
        headers: { "content-type": "application/json" },
      }),
    ),
    await postPasswordChangeWithMockedUpdate(
      async () => Response.json(passwordChangeUser),
      false,
      Response.json("unexpected-gate-value"),
    ),
  ];

  for (const { response, updateCalls, gateCalls } of outcomes) {
    assert.equal(updateCalls, 1);
    assert.equal(gateCalls, 2);
    assert.equal(response.status, 503);
    assert.equal(response.headers.get("cache-control"), "no-store");
    const body = await response.json();
    assert.equal(body.passwordChanged, true);
    assert.equal(body.gatePending, undefined);
    assert.equal(body.outcomeUnknown, undefined);
    assert.match(body.error, /비밀번호 변경은 적용됐어요/);
    assert.match(body.error, /방금 제출한 새 비밀번호가 현재 비밀번호입니다/);
    assert.match(body.error, /현재 비밀번호 입력란에 방금 제출한 비밀번호/);
    assert.doesNotMatch(body.error, /계정 완료 처리|레거시/);
  }

  const settings = await readFile(resolve(process.cwd(), "components/auth/AccountSettings.tsx"), "utf8");
  assert.match(settings, /passwordChanged\?: boolean/);
  assert.match(settings, /result\?\.passwordChanged === true/);
  assert.match(settings, /setPasswordChangeCommittedNeedsRecovery\(true\)/);
  assert.match(settings, /clearSubmittedPasswords\(formElement\)/);
  assert.match(settings, /방금 제출해 변경된 비밀번호 \(현재 비밀번호\)/);
});

test("a committed password with a lost response clears every submitted field and requires a different retry", async () => {
  let committedPassword: string | null = null;
  const { response, updateCalls } = await postPasswordChangeWithMockedUpdate(async () => {
    committedPassword = "Newpass1234";
    throw new TypeError("simulated lost response after password commit");
  }, true);

  assert.equal(committedPassword, "Newpass1234");
  assert.equal(updateCalls, 1);
  assert.equal(response.status, 503);
  const result = await response.json();
  assert.equal(result.gatePending, true);
  assert.equal(result.outcomeUnknown, true);

  for (const file of ["components/auth/AccountSettings.tsx", "components/auth/ForcePasswordChange.tsx"]) {
    const source = await readFile(resolve(process.cwd(), file), "utf8");
    const helper = source.match(/function clearSubmittedPasswords\(formElement: HTMLFormElement\) \{([\s\S]*?)\r?\n\}/);
    const nonOkStart = source.indexOf("      if (!response.ok) {") >= 0
      ? source.indexOf("      if (!response.ok) {")
      : source.indexOf("      if (!changed.ok) {");
    const nonOkEnd = source.indexOf("      formElement.reset();", nonOkStart);
    const nonOkResponse = source.slice(nonOkStart, nonOkEnd);
    const definiteBranchStart = nonOkResponse.indexOf("if (result?.passwordUnchanged === true");
    const branchEnds = [
      nonOkResponse.indexOf("if (!result)", definiteBranchStart),
      nonOkResponse.indexOf("} else if", definiteBranchStart),
    ].filter((position) => position >= 0);
    const definiteBranchEnd = Math.min(...branchEnds);
    assert.ok(helper, `${file} should clear submitted password fields in one helper`);
    assert.match(source, /clearSubmittedPasswords\(formElement\)/);
    assert.match(source, /(?:currentPassword === password|password === currentPassword)/);
    assert.match(nonOkResponse, /(?:response|changed)\.status >= 500[\s\S]*clearSubmittedPasswords\(formElement\)/);
    assert.ok(definiteBranchStart >= 0, `${file} should recognize an explicitly unchanged password`);
    assert.ok(definiteBranchEnd > definiteBranchStart, `${file} should separate definite outcomes from ambiguous ones`);
    assert.doesNotMatch(nonOkResponse.slice(definiteBranchStart, definiteBranchEnd), /clearSubmittedPasswords\(formElement\)/);

    class TestInput {
      value: string;
      constructor(value: string) { this.value = value; }
    }
    const clearSubmittedPasswords = new Function(
      "HTMLInputElement",
      `return function(formElement) {${helper[1]}}`,
    )(TestInput) as (formElement: { elements: { namedItem(name: string): TestInput | null } }) => void;
    const fields = {
      currentPassword: new TestInput("Currentpass123"),
      password: new TestInput(committedPassword),
      confirmation: new TestInput(committedPassword),
    };
    clearSubmittedPasswords({ elements: { namedItem: (name) => fields[name as keyof typeof fields] ?? null } });
    assert.deepEqual(Object.values(fields).map((field) => field.value), ["", "", ""]);
  }

  const accountSettings = await readFile(resolve(process.cwd(), "components/auth/AccountSettings.tsx"), "utf8");
  assert.match(accountSettings, /방금 제출한 새 비밀번호가 현재 비밀번호로 적용됐을 수 있습니다[\s\S]*다음 새 비밀번호는 그 비밀번호와 다르게 설정해 주세요/);
  const retry = { currentPassword: committedPassword, newPassword: "Differentpass5678" };
  assert.notEqual(retry.newPassword, retry.currentPassword);
});

test("account settings distinguish an unknown password outcome from a confirmed legacy gate", async () => {
  const source = await readFile(resolve(process.cwd(), "components/auth/AccountSettings.tsx"), "utf8");
  const catchStart = source.indexOf("    } catch {", source.indexOf("async function savePassword"));
  const catchEnd = source.indexOf("    } finally {", catchStart);
  const fetchCatch = source.slice(catchStart, catchEnd);

  assert.match(source, /outcomeUnknown\?: boolean/);
  assert.match(source, /result\?\.outcomeUnknown === true/);
  assert.match(source, /gateRecoveryRequired \|\| passwordOutcomeUnknown/);
  assert.match(fetchCatch, /setPasswordOutcomeUnknown\(true\)/);
  assert.match(fetchCatch, /clearSubmittedPasswords\(formElement\)/);
  assert.doesNotMatch(fetchCatch, /setGateRecoveryRequired\(true\)/);
  assert.doesNotMatch(fetchCatch, /계정 완료 처리를 마쳐 주세요/);
});

test("forced password recovery distinguishes stale-gate committed and unknown outcomes", async () => {
  const source = await readFile(resolve(process.cwd(), "components/auth/ForcePasswordChange.tsx"), "utf8");
  const responseStart = source.indexOf("      if (!changed.ok) {");
  const responseEnd = source.indexOf("      formElement.reset();", responseStart);
  const nonOkResponse = source.slice(responseStart, responseEnd);
  const catchStart = source.indexOf("    } catch {", source.indexOf("async function submit"));
  const catchEnd = source.indexOf("    } finally {", catchStart);
  const fetchCatch = source.slice(catchStart, catchEnd);

  assert.match(source, /outcomeUnknown\?: boolean/);
  assert.match(source, /passwordChanged\?: boolean/);
  assert.match(nonOkResponse, /if \(result\?\.gatePending === true\)[\s\S]*setGateRecoveryRequired\(true\)/);
  assert.match(nonOkResponse, /else if \(result\?\.passwordChanged === true\)[\s\S]*setGateRecoveryRequired\(false\)[\s\S]*setPasswordChangeCommittedNeedsRecovery\(true\)[\s\S]*clearSubmittedPasswords\(formElement\)/);
  assert.match(nonOkResponse, /else if \(result\?\.outcomeUnknown === true \|\| result === null\)[\s\S]*setGateRecoveryRequired\(false\)[\s\S]*setPasswordOutcomeUnknown\(true\)[\s\S]*clearSubmittedPasswords\(formElement\)/);
  assert.match(nonOkResponse, /else if \(changed\.status >= 500\)[\s\S]*setGateRecoveryRequired\(false\)[\s\S]*setPasswordOutcomeUnknown\(true\)[\s\S]*clearSubmittedPasswords\(formElement\)[\s\S]*요청 결과를 확인하지 못했어요/);
  assert.match(nonOkResponse, /방금 제출한 새 비밀번호가 적용됐을 수 있습니다/);
  assert.match(fetchCatch, /setGateRecoveryRequired\(false\)/);
  assert.match(fetchCatch, /setPasswordOutcomeUnknown\(true\)/);
  assert.match(fetchCatch, /clearSubmittedPasswords\(formElement\)/);
  assert.match(source, /\? "다른 비밀번호로 변경하고 완료 처리"/);
  assert.match(source, /passwordChangeCommittedNeedsRecovery\s*\?\s*"방금 제출해 변경된 비밀번호 \(현재 비밀번호\)"/);
});

test("account settings treat unreadable password-change responses as unknown and clear stale gate UI", async () => {
  const source = await readFile(resolve(process.cwd(), "components/auth/AccountSettings.tsx"), "utf8");
  const responseStart = source.indexOf("      if (!response.ok) {");
  const responseEnd = source.indexOf("      formElement.reset();", responseStart);
  const nonOkResponse = source.slice(responseStart, responseEnd);
  const successRecoveryReset = source.slice(responseEnd, source.indexOf("      setPasswordMessage(\"비밀번호를 변경했어요.\")", responseEnd));

  assert.match(nonOkResponse, /if \(!result\)[\s\S]*setGateRecoveryRequired\(false\)[\s\S]*setPasswordOutcomeUnknown\(true\)[\s\S]*clearSubmittedPasswords\(formElement\)[\s\S]*setPasswordMessage\(unknownPasswordChangeMessage\)/);
  assert.match(nonOkResponse, /else if \(result\?\.passwordChanged === true\)[\s\S]*setGateRecoveryRequired\(false\)[\s\S]*setPasswordChangeCommittedNeedsRecovery\(true\)/);
  assert.match(nonOkResponse, /else if \(result\?\.outcomeUnknown === true\)[\s\S]*setGateRecoveryRequired\(false\)/);
  assert.match(nonOkResponse, /else if \(response\.status >= 500\)[\s\S]*setGateRecoveryRequired\(false\)[\s\S]*setPasswordOutcomeUnknown\(true\)[\s\S]*clearSubmittedPasswords\(formElement\)[\s\S]*setPasswordMessage\(unknownPasswordChangeMessage\)/);
  assert.match(nonOkResponse, /setPasswordMessage\(result\.error \?\? "비밀번호를 변경하지 못했어요/);
  assert.match(successRecoveryReset, /setGateRecoveryRequired\(false\)/);
  assert.match(successRecoveryReset, /setPasswordOutcomeUnknown\(false\)/);
  assert.match(successRecoveryReset, /setPasswordChangeCommittedNeedsRecovery\(false\)/);
});

test("credential forms submit with POST before client hydration", async () => {
  for (const file of [
    "components/auth/AccountSettings.tsx",
    "components/auth/ForcePasswordChange.tsx",
    "components/auth/LoginForm.tsx",
    "components/auth/SignupForm.tsx",
  ]) {
    const source = await readFile(resolve(process.cwd(), file), "utf8");
    const forms = [...source.matchAll(/<form\b[\s\S]*?<\/form>/g)].map((match) => match[0]);
    const credentialForms = forms.filter((form) => /name="(?:email|password|currentPassword|confirmation)"/.test(form));

    assert.ok(credentialForms.length > 0, `${file} should contain a credential form`);
    for (const form of credentialForms) assert.match(form, /<form\b[^>]*\bmethod="post"/i, `${file} credential form must use POST`);
  }

  const accountSettings = await readFile(resolve(process.cwd(), "components/auth/AccountSettings.tsx"), "utf8");
  assert.match(accountSettings, /<form className=\{styles\.form\} onSubmit=\{saveDisplayName\}>/);
});

test("auth return path rejects normalized protocol-relative paths and callback checks its final origin", async () => {
  assert.equal(safeAuthReturnTo("/..//attacker.example/path"), "/");
  assert.equal(safeAuthReturnTo("/account?tab=reviews"), "/account?tab=reviews");

  const callback = await readFile(resolve(process.cwd(), "app/auth/callback/route.ts"), "utf8");
  assert.match(callback, /const completed = new URL\(returnTo, origin\);\s*if \(completed\.origin !== origin\)/);
  assert.match(callback, /NextResponse\.redirect\(completed, 303\)/);
});

test("password-change recovery retains policy inputs and never sends gate-only completion", async () => {
  for (const file of ["components/auth/AccountSettings.tsx", "components/auth/ForcePasswordChange.tsx"]) {
    const source = await readFile(resolve(process.cwd(), file), "utf8");
    assert.doesNotMatch(source, /completeGateOnly/);
    assert.match(source, /name="currentPassword"/);
    assert.match(source, /name="password"/);
    assert.match(source, /name="confirmation"/);
    if (file === "components/auth/AccountSettings.tsx") {
      assert.match(source, /result\?\.gatePending === true/);
      assert.match(source, /result\?\.outcomeUnknown === true/);
    } else {
      assert.match(source, /방금 제출한 새 비밀번호가 현재 비밀번호로 적용됐을 수/);
    }
  }
});

test("password-change forms clear pending after a rejected fetch", async () => {
  const forms = [
    ["components/auth/AccountSettings.tsx", "setPasswordPending(false)"],
    ["components/auth/ForcePasswordChange.tsx", "setPending(false)"],
  ] as const;

  for (const [file, resetCall] of forms) {
    const source = await readFile(resolve(process.cwd(), file), "utf8");
    const fetchPosition = source.indexOf("await fetch(\"/api/account/legacy-password-change\"");
    const catchPosition = source.indexOf("} catch {", fetchPosition);
    const finallyPosition = source.indexOf("} finally {", catchPosition);

    assert.ok(fetchPosition >= 0, `${file} should post to the password-change route`);
    assert.ok(catchPosition > fetchPosition, `${file} should handle a rejected request`);
    assert.ok(finallyPosition > catchPosition, `${file} should reset pending in finally`);
    assert.match(source.slice(finallyPosition, finallyPosition + 96), new RegExp(resetCall.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});

async function postEmail(email: string, ip = "192.0.2.10") {
  const { POST } = await import("@/app/api/auth/email-status/route");
  return POST(new Request("http://localhost:3000/api/auth/email-status", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "http://localhost:3000",
      "x-real-ip": ip,
    },
    body: JSON.stringify({ email }),
  }));
}

test("email status lookup returns only existence and never echoes the submitted address", async () => {
  const originalFetch = globalThis.fetch;
  const previousUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const previousSecret = process.env.SUPABASE_SECRET_KEY;
  process.env.NEXT_PUBLIC_SUPABASE_URL = endpointUrl;
  process.env.SUPABASE_SECRET_KEY = "test-only-service-key";
  globalThis.fetch = async (input, init) => {
    assert.match(String(input), /\/rest\/v1\/rpc\/lookup_auth_email_status$/);
    const body = JSON.parse(String(init?.body)) as { p_email?: string; p_ip_hash?: string };
    assert.equal(body.p_email, "member@example.com");
    assert.match(body.p_ip_hash ?? "", /^[0-9a-f]{64}$/);
    return new Response(JSON.stringify([{ allowed: true, email_exists: true, retry_after_seconds: 0 }]), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  try {
    const response = await postEmail(" Member@Example.com ");
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { exists: true });
    assert.equal(response.headers.get("cache-control"), "no-store");
  } finally {
    globalThis.fetch = originalFetch;
    if (previousUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    else process.env.NEXT_PUBLIC_SUPABASE_URL = previousUrl;
    if (previousSecret === undefined) delete process.env.SUPABASE_SECRET_KEY;
    else process.env.SUPABASE_SECRET_KEY = previousSecret;
  }
});

test("rate-limited email status lookup returns a generic 429 response", async () => {
  const originalFetch = globalThis.fetch;
  const previousUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const previousSecret = process.env.SUPABASE_SECRET_KEY;
  process.env.NEXT_PUBLIC_SUPABASE_URL = endpointUrl;
  process.env.SUPABASE_SECRET_KEY = "test-only-service-key";
  globalThis.fetch = async () => new Response(JSON.stringify([
    { allowed: false, email_exists: null, retry_after_seconds: 37 },
  ]), { status: 200, headers: { "content-type": "application/json" } });

  try {
    const response = await postEmail("unknown@example.com");
    assert.equal(response.status, 429);
    assert.equal(response.headers.get("retry-after"), "37");
    assert.deepEqual(await response.json(), { error: "요청이 너무 많습니다. 잠시 후 다시 시도해 주세요." });
  } finally {
    globalThis.fetch = originalFetch;
    if (previousUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    else process.env.NEXT_PUBLIC_SUPABASE_URL = previousUrl;
    if (previousSecret === undefined) delete process.env.SUPABASE_SECRET_KEY;
    else process.env.SUPABASE_SECRET_KEY = previousSecret;
  }
});

test("email status rejects cross-origin requests before a lookup", async () => {
  const { POST } = await import("@/app/api/auth/email-status/route");
  const response = await POST(new Request("http://localhost:3000/api/auth/email-status", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://attacker.example" },
    body: JSON.stringify({ email: "person@example.com" }),
  }));
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { error: "요청을 확인해 주세요." });
});

test("production lookup fails closed without the trusted Vercel client IP header", async () => {
  const { POST } = await import("@/app/api/auth/email-status/route");
  const originalFetch = globalThis.fetch;
  const previousNodeEnv = process.env.NODE_ENV;
  const previousUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const previousSecret = process.env.SUPABASE_SECRET_KEY;
  process.env.NODE_ENV = "production";
  process.env.NEXT_PUBLIC_SUPABASE_URL = endpointUrl;
  process.env.SUPABASE_SECRET_KEY = "test-only-service-key";
  globalThis.fetch = async () => {
    throw new Error("lookup should not reach Supabase without a trusted IP header");
  };

  try {
    const response = await POST(new Request("http://localhost:3000/api/auth/email-status", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "http://localhost:3000",
        "x-forwarded-for": "198.51.100.20",
      },
      body: JSON.stringify({ email: "person@example.com" }),
    }));
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { error: "이메일 확인을 완료하지 못했어요. 잠시 후 다시 시도해 주세요." });
  } finally {
    globalThis.fetch = originalFetch;
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
    if (previousUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    else process.env.NEXT_PUBLIC_SUPABASE_URL = previousUrl;
    if (previousSecret === undefined) delete process.env.SUPABASE_SECRET_KEY;
    else process.env.SUPABASE_SECRET_KEY = previousSecret;
  }
});
