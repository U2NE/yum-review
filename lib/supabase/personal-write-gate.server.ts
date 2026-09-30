import "server-only";

import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type ServerSupabaseClient = Awaited<ReturnType<typeof createSupabaseServerClient>>;

/** Fail closed before a Next server action or route reaches a personal-data write. */
export async function personalWriteFreezeResponse(
  client?: ServerSupabaseClient,
): Promise<NextResponse | null> {
  try {
    const supabase = client ?? await createSupabaseServerClient();
    const { data, error } = await supabase.rpc("personal_data_write_is_frozen");
    if (!error && data === false) return null;
  } catch {
    // An unavailable gate is treated as active so write APIs fail closed.
  }
  return NextResponse.json(
    { error: "개인정보 변경을 잠시 중단했습니다.", code: "PERSONAL_DATA_WRITE_FROZEN" },
    { status: 503, headers: { "Cache-Control": "no-store" } },
  );
}
