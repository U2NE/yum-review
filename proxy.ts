import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";

export async function proxy(request: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!url || !publishableKey) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY must be configured.",
    );
  }

  let response = NextResponse.next({ request });

  const supabase = createServerClient(url, publishableKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, responseHeaders) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }

        response = NextResponse.next({ request });

        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }

        for (const [name, value] of Object.entries(responseHeaders ?? {})) {
          response.headers.set(name, value);
        }
      },
    },
  });

  // Verify/refresh the JWT; never authorize based only on cookie contents.
  const { data: claimData } = await supabase.auth.getClaims();
  const userId = typeof claimData?.claims?.sub === "string" ? claimData.claims.sub : null;
  const pathname = request.nextUrl.pathname;

  if (
    userId &&
    pathname !== "/account/force-password-change" &&
    pathname !== "/api/account/legacy-password-change"
  ) {
    const { data: mustChange, error } = await supabase.rpc("legacy_password_change_required");
    if (error || mustChange === true) {
      const destination = new URL("/account/force-password-change", request.url);
      destination.searchParams.set("next", `${pathname}${request.nextUrl.search}`);
      const redirectResponse = NextResponse.redirect(destination);
      for (const cookie of response.cookies.getAll()) redirectResponse.cookies.set(cookie);
      redirectResponse.headers.set("Cache-Control", "private, no-store");
      return redirectResponse;
    }
  }

  // A response that can set session cookies must never be shared across users.
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
