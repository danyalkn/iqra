import { BUILD } from "@/lib/build";

// Always served fresh so clients can compare against their baked-in BUILD.
export const dynamic = "force-dynamic";

export function GET() {
  return Response.json(
    { build: BUILD },
    { headers: { "Cache-Control": "no-store" } },
  );
}
