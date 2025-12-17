// Minimal edge function that just returns success
export default async function handler(req: Request): Promise<Response> {
  return new Response(JSON.stringify({
    success: true,
    message: "Edge function is working",
    timestamp: new Date().toISOString()
  }), {
    headers: { 'Content-Type': 'application/json' }
  });
}

Deno.serve(handler);
