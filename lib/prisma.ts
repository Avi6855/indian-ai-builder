// lib/prisma.ts
//
// Drop-in Prisma-compatible db client backed by Supabase REST API.
// Uses @supabase/supabase-js over HTTPS so no direct TCP/postgres
// connection is required — works regardless of IPv4/IPv6 constraints.

import { createClient, SupabaseClient } from "@supabase/supabase-js";

// ─── Types ────────────────────────────────────────────────────────────────────

export type User = {
  id: string;
  clerkId: string;
  name: string;
  email: string;
  imageUrl: string;
  credits: number;
  plan: string;
  createdAt: Date;
  updatedAt: Date;
};

export type Workspace = {
  id: string;
  title: string | null;
  userId: string;
  messages: unknown[];
  fileData: unknown | null;
  createdAt: Date;
  updatedAt: Date;
};

type CreditUpdate = number | { decrement?: number; increment?: number };

// ─── Supabase admin client (server-side only) ─────────────────────────────────

function getSupabaseAdmin(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  // Use service role key if available, otherwise fall back to anon key
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function normalizeUser(row: Record<string, unknown>): User {
  return {
    id: row.id as string,
    clerkId: row.clerkId as string,
    name: row.name as string,
    email: row.email as string,
    imageUrl: (row.imageUrl as string) ?? "",
    credits: (row.credits as number) ?? 0,
    plan: (row.plan as string) ?? "free",
    createdAt: new Date(row.createdAt as string),
    updatedAt: new Date(row.updatedAt as string),
  };
}

function normalizeWorkspace(row: Record<string, unknown>): Workspace {
  return {
    id: row.id as string,
    title: (row.title as string | null) ?? null,
    userId: row.userId as string,
    messages: Array.isArray(row.messages) ? row.messages : [],
    fileData: row.fileData ?? null,
    createdAt: new Date(row.createdAt as string),
    updatedAt: new Date(row.updatedAt as string),
  };
}

function throwIfError<T>(
  data: T | null,
  error: { message: string } | null,
  context: string
): T {
  if (error) throw new Error(`[db:${context}] ${error.message}`);
  if (data === null) throw new Error(`[db:${context}] null result`);
  return data;
}

// ─── User model ───────────────────────────────────────────────────────────────

const userModel = {
  async findUnique(args: {
    where: { id?: string; clerkId?: string; email?: string };
    select?: Partial<Record<keyof User, boolean>>;
  }): Promise<User | null> {
    const supabase = getSupabaseAdmin();
    let query = supabase.from("User").select("*");

    if (args.where.id) query = query.eq("id", args.where.id);
    if (args.where.clerkId) query = query.eq("clerkId", args.where.clerkId);
    if (args.where.email) query = query.eq("email", args.where.email);

    const { data, error } = await query.maybeSingle();
    if (error) throw new Error(`[db:user.findUnique] ${error.message}`);
    if (!data) return null;

    return normalizeUser(data as Record<string, unknown>);
  },

  async create(args: {
    data: {
      clerkId: string;
      name: string;
      email: string;
      imageUrl?: string;
      credits?: number;
      plan?: string;
    };
  }): Promise<User> {
    const supabase = getSupabaseAdmin();
    const now = new Date().toISOString();
    const newUser = {
      id: generateCuid(),
      imageUrl: "",
      credits: 10,
      plan: "free",
      ...args.data,
      createdAt: now,
      updatedAt: now,
    };
    const { data, error } = await supabase
      .from("User")
      .insert(newUser)
      .select()
      .single();
    const row = throwIfError(data, error, "user.create");
    return normalizeUser(row as Record<string, unknown>);
  },

  async update(args: {
    where: { id?: string; clerkId?: string };
    data: {
      plan?: string;
      credits?: CreditUpdate;
      name?: string;
      email?: string;
      imageUrl?: string;
    };
    select?: Partial<Record<keyof User, boolean>>;
  }): Promise<User> {
    const supabase = getSupabaseAdmin();

    // Resolve credits increment/decrement
    let resolvedCredits: number | undefined;
    if (args.data.credits !== undefined) {
      if (typeof args.data.credits === "number") {
        resolvedCredits = args.data.credits;
      } else {
        // Need current value to compute delta
        const existing = await userModel.findUnique({ where: args.where });
        if (!existing) throw new Error("[db:user.update] user not found");
        const cur = existing.credits;
        const op = args.data.credits;
        resolvedCredits =
          op.decrement !== undefined
            ? cur - op.decrement
            : op.increment !== undefined
            ? cur + op.increment
            : cur;
      }
    }

    const updateData: Record<string, unknown> = {
      ...args.data,
      updatedAt: new Date().toISOString(),
    };
    if (resolvedCredits !== undefined) {
      updateData.credits = resolvedCredits;
    }

    let query = supabase.from("User").update(updateData).select();
    if (args.where.id) query = query.eq("id", args.where.id);
    if (args.where.clerkId) query = query.eq("clerkId", args.where.clerkId);

    const { data, error } = await query.single();
    const row = throwIfError(data, error, "user.update");
    return normalizeUser(row as Record<string, unknown>);
  },

  async updateMany(args: {
    where: { id?: string; clerkId?: string; plan?: string };
    data: {
      plan?: string;
      credits?: CreditUpdate;
    };
  }): Promise<{ count: number }> {
    const supabase = getSupabaseAdmin();

    let resolvedCredits: number | undefined;
    if (args.data.credits !== undefined) {
      if (typeof args.data.credits === "number") {
        resolvedCredits = args.data.credits;
      } else {
        const existing = await userModel.findUnique({ where: args.where });
        if (!existing) return { count: 0 };
        const cur = existing.credits;
        const op = args.data.credits;
        resolvedCredits =
          op.decrement !== undefined
            ? cur - op.decrement
            : op.increment !== undefined
            ? cur + op.increment
            : cur;
      }
    }

    const updateData: Record<string, unknown> = {
      ...args.data,
      updatedAt: new Date().toISOString(),
    };
    if (resolvedCredits !== undefined) updateData.credits = resolvedCredits;

    let query = supabase.from("User").update(updateData).select("id");
    if (args.where.id) query = query.eq("id", args.where.id);
    if (args.where.clerkId) query = query.eq("clerkId", args.where.clerkId);
    if (args.where.plan) query = query.eq("plan", args.where.plan);

    const { data, error } = await query;
    if (error) throw new Error(`[db:user.updateMany] ${error.message}`);
    return { count: (data ?? []).length };
  },
};

// ─── Workspace model ──────────────────────────────────────────────────────────

const workspaceModel = {
  async findUnique(args: {
    where: { id?: string; userId?: string };
    select?: Partial<Record<keyof Workspace, boolean>>;
  }): Promise<Workspace | null> {
    const supabase = getSupabaseAdmin();
    let query = supabase.from("Workspace").select("*");
    if (args.where.id) query = query.eq("id", args.where.id);
    if (args.where.userId) query = query.eq("userId", args.where.userId);

    const { data, error } = await query.maybeSingle();
    if (error)
      throw new Error(`[db:workspace.findUnique] ${error.message}`);
    if (!data) return null;

    return normalizeWorkspace(data as Record<string, unknown>);
  },

  async findMany(args: {
    where?: { userId?: string };
    select?: Partial<Record<keyof Workspace, boolean>>;
    orderBy?: Partial<Record<keyof Workspace, "asc" | "desc">>;
  }): Promise<Workspace[]> {
    const supabase = getSupabaseAdmin();
    let query = supabase.from("Workspace").select("*");
    if (args.where?.userId) query = query.eq("userId", args.where.userId);

    if (args.orderBy) {
      for (const [col, dir] of Object.entries(args.orderBy)) {
        query = query.order(col, { ascending: dir === "asc" });
      }
    }

    const { data, error } = await query;
    if (error) throw new Error(`[db:workspace.findMany] ${error.message}`);
    return (data ?? []).map((r) =>
      normalizeWorkspace(r as Record<string, unknown>)
    );
  },

  async create(args: {
    data: {
      userId: string;
      title?: string;
      messages?: unknown[];
      fileData?: unknown;
    };
  }): Promise<Workspace> {
    const supabase = getSupabaseAdmin();
    const now = new Date().toISOString();
    const newWs = {
      id: generateCuid(),
      title: null,
      messages: [],
      fileData: null,
      ...args.data,
      createdAt: now,
      updatedAt: now,
    };
    const { data, error } = await supabase
      .from("Workspace")
      .insert(newWs)
      .select()
      .single();
    const row = throwIfError(data, error, "workspace.create");
    return normalizeWorkspace(row as Record<string, unknown>);
  },

  async update(args: {
    where: { id?: string; userId?: string };
    data: {
      title?: string | null;
      messages?: unknown;
      fileData?: unknown;
    };
  }): Promise<Workspace> {
    const supabase = getSupabaseAdmin();
    const updateData = {
      ...args.data,
      updatedAt: new Date().toISOString(),
    };

    let query = supabase.from("Workspace").update(updateData).select();
    if (args.where.id) query = query.eq("id", args.where.id);
    if (args.where.userId) query = query.eq("userId", args.where.userId);

    const { data, error } = await query.single();
    const row = throwIfError(data, error, "workspace.update");
    return normalizeWorkspace(row as Record<string, unknown>);
  },

  async deleteMany(args: {
    where: { id?: string; userId?: string };
  }): Promise<{ count: number }> {
    const supabase = getSupabaseAdmin();
    let query = supabase.from("Workspace").delete().select("id");
    if (args.where.id) query = query.eq("id", args.where.id);
    if (args.where.userId) query = query.eq("userId", args.where.userId);

    const { data, error } = await query;
    if (error)
      throw new Error(`[db:workspace.deleteMany] ${error.message}`);
    return { count: (data ?? []).length };
  },
};

// ─── Transaction helper ───────────────────────────────────────────────────────
// Supabase JS doesn't have real transactions over REST, but sequential
// execution is sufficient for this app's usage patterns.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function $transaction<T extends Promise<any>[]>(
  ops: T
): Promise<{ [K in keyof T]: Awaited<T[K]> }> {
  const results: unknown[] = [];
  for (const op of ops) {
    results.push(await op);
  }
  return results as { [K in keyof T]: Awaited<T[K]> };
}

// ─── Exported db object (Prisma-compatible surface) ───────────────────────────

export const db = {
  user: userModel,
  workspace: workspaceModel,
  $transaction,
};

// ─── CUID generator ───────────────────────────────────────────────────────────

let _cuidCounter = 0;
function generateCuid(): string {
  const timestamp = Date.now().toString(36);
  const counter = (++_cuidCounter).toString(36).padStart(4, "0");
  const random = Math.random().toString(36).slice(2, 10);
  return `c${timestamp}${counter}${random}`;
}
