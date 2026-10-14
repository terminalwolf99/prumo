-- The daily keep-alive ping (GitHub Actions) calls this without signing in.
-- It only returns the server clock.
grant execute on function public.server_time() to anon;
