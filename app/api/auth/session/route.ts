import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { currentUser } from "@/lib/security/session";
import { routeError } from "@/lib/api";
export async function GET() { try { const [user, count] = await Promise.all([currentUser(), db.user.count()]); return NextResponse.json({ user: user ? { id: user.id, email: user.email } : null, setupRequired: count === 0 }); } catch (error) { return routeError(error); } }
