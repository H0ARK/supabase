Deno.serve(async (req) => {
  return new Response(JSON.stringify({ message: "Test deployment successful" }), {
    headers: { "Content-Type": "application/json" },
  });
});