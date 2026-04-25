import { NextResponse } from 'next/server';
import { optionalAuth } from '@/lib/server/auth-guard';

export async function GET() {
  const user = await optionalAuth();

  if (!user) {
    return NextResponse.json({ authenticated: false }, { status: 401 });
  }

  return NextResponse.json({
    authenticated: true,
    user: {
      id: user.id,
      nickname: user.nickname,
      avatar: user.avatar,
      email: user.email,
      roles: user.roles,
      permissions: user.permissions,
    },
  });
}
