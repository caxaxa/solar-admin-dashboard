import { NextResponse } from 'next/server';
import { authenticateUser, getUserInfo } from '@/lib/auth';

export async function POST(request: Request) {
  try {
    const { email, password } = await request.json();

    if (!email || !password) {
      return NextResponse.json(
        { error: 'Email and password are required' },
        { status: 400 }
      );
    }

    const authResult = await authenticateUser(email, password);

    if (!authResult.success) {
      return NextResponse.json(
        { error: authResult.error || 'Authentication failed' },
        { status: 401 }
      );
    }

    // Check if user is admin
    const userInfo = await getUserInfo(authResult.accessToken!);

    if (!userInfo || !userInfo.isAdmin) {
      return NextResponse.json(
        { error: 'Access denied. Admin privileges required.' },
        { status: 403 }
      );
    }

    // Return tokens to client
    return NextResponse.json({
      success: true,
      accessToken: authResult.accessToken,
      idToken: authResult.idToken,
      refreshToken: authResult.refreshToken,
      user: userInfo,
    });
  } catch (error) {
    console.error('Login error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
