import { NextResponse } from 'next/server';
import { casdoorSDK } from '@/lib/auth/casdoor';
import { cookies } from 'next/headers';

export async function GET() {
  const cookieStore = await cookies();
  const token = cookieStore.get('casdoor_token')?.value;

  if (!token) {
    return NextResponse.json({ authenticated: false }, { status: 401 });
  }

  try {
    const user = casdoorSDK.verifyAuthToken(token);
    return NextResponse.json({
      authenticated: true,
      user: {
        id: user.id || user.name,
        nickname: user.displayName || user.name,
        avatar: user.avatar,
        email: user.email,
      },
    });
  } catch (error) {
    console.error('Invalid Casdoor token:', error);
    return NextResponse.json({ authenticated: false }, { status: 401 });
  }
}
