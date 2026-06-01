import { randomBytes } from "node:crypto";

import { NextResponse } from "next/server";

import type { StaffRole } from "@/lib/domain/route-access";
import { createSupabaseServiceClient } from "@/lib/supabase/server";

const DEFAULT_EMAIL = "vtecoding@gmail.com";
const DEFAULT_FULL_NAME = "Vtecoding Owner";
const DEFAULT_ROLE: StaffRole = "owner";

type Body = {
  email?: string;
  fullName?: string;
  password?: string;
  role?: StaffRole;
};

function makePassword() {
  return `${randomBytes(16).toString("base64url")}9A!`;
}

async function findUserByEmail(email: string) {
  const supabase = createSupabaseServiceClient();

  let page = 1;
  for (;;) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;

    const match = data.users.find((user) => user.email?.toLowerCase() === email.toLowerCase());
    if (match) return match;
    if (data.users.length < 200) return null;
    page += 1;
  }
}

export async function POST(request: Request) {
  const token = request.headers.get("x-provision-token")?.trim();
  const expectedToken = process.env.PROVISION_OWNER_TOKEN?.trim();

  if (!expectedToken) {
    return NextResponse.json({ message: "Provisioning is not configured." }, { status: 500 });
  }

  if (!token || token !== expectedToken) {
    return NextResponse.json({ message: "Unauthorized." }, { status: 401 });
  }

  let body: Body = {};
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ message: "Request body must be valid JSON." }, { status: 400 });
  }

  const email = String(body.email ?? DEFAULT_EMAIL).trim().toLowerCase();
  const fullName = String(body.fullName ?? DEFAULT_FULL_NAME).trim() || DEFAULT_FULL_NAME;
  const role = body.role ?? DEFAULT_ROLE;
  const password = String(body.password ?? makePassword());

  if (!email || !password) {
    return NextResponse.json({ message: "Email and password are required." }, { status: 400 });
  }

  if (role !== "owner") {
    return NextResponse.json({ message: "Only owner provisioning is allowed." }, { status: 400 });
  }

  const supabase = createSupabaseServiceClient();
  const existingUser = await findUserByEmail(email);

  let userId: string;
  let action: "created" | "updated";

  if (existingUser) {
    const { error } = await supabase.auth.admin.updateUserById(existingUser.id, {
      password,
      email_confirm: true,
    });
    if (error) {
      return NextResponse.json({ message: error.message }, { status: 500 });
    }
    userId = existingUser.id;
    action = "updated";
  } else {
    const { data, error } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (error || !data.user) {
      return NextResponse.json({ message: error?.message ?? "Unable to create user." }, { status: 500 });
    }
    userId = data.user.id;
    action = "created";
  }

  const { error: profileError } = await supabase.from("profiles").upsert(
    {
      id: userId,
      email,
      full_name: fullName,
      role,
      branch_id: null,
      is_active: true,
    },
    { onConflict: "id" },
  );

  if (profileError) {
    return NextResponse.json({ message: profileError.message }, { status: 500 });
  }

  return NextResponse.json(
    {
      action,
      email,
      password,
      role,
      userId,
    },
    { status: 200 },
  );
}
