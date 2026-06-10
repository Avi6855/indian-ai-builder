-- Run this SQL in your Supabase Dashboard → SQL Editor
-- This allows the app to read/write data using the anon key
-- (your app uses Clerk for auth, not Supabase Auth, so RLS policies
--  should allow server-side operations)

-- ─── Enable RLS (already enabled, just ensuring) ──────────────────────────────
ALTER TABLE "User" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Workspace" ENABLE ROW LEVEL SECURITY;

-- ─── Drop existing policies (if any) ─────────────────────────────────────────
DROP POLICY IF EXISTS "allow_all_user" ON "User";
DROP POLICY IF EXISTS "allow_all_workspace" ON "Workspace";

-- ─── User table: allow all operations for anon and service_role ───────────────
CREATE POLICY "allow_all_user"
ON "User"
FOR ALL
TO anon, service_role
USING (true)
WITH CHECK (true);

-- ─── Workspace table: allow all operations for anon and service_role ──────────
CREATE POLICY "allow_all_workspace"
ON "Workspace"
FOR ALL
TO anon, service_role
USING (true)
WITH CHECK (true);

-- ─── Grant table privileges ───────────────────────────────────────────────────
GRANT ALL ON "User" TO anon;
GRANT ALL ON "Workspace" TO anon;
GRANT ALL ON "User" TO service_role;
GRANT ALL ON "Workspace" TO service_role;
