import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    const { email, password, mfaCode } = await request.json();

    // TODO: Integrate with AWS Cognito
    // For now, return a mock response for testing

    // Basic validation
    if (!email || !password) {
      return NextResponse.json(
        { success: false, error: 'Email and password are required' },
        { status: 400 }
      );
    }

    // Mock user data for testing
    const mockUser = {
      id: '123',
      email: email,
      firstName: 'John',
      lastName: 'Doe',
      role: 'user' as const,
      verified: true,
      mfaEnabled: false,
      createdAt: new Date().toISOString(),
      lastLogin: new Date().toISOString(),
      subscription: {
        plan: 'free' as const,
        status: 'active' as const,
      },
      cognitoSub: 'mock-cognito-sub',
      emailVerified: true,
    };

    // Mock authentication logic
    if (email === 'test@cosine.com' && password === 'Test123!') {
      return NextResponse.json({
        success: true,
        user: mockUser,
        accessToken: 'mock-jwt-access-token',
        refreshToken: 'mock-jwt-refresh-token',
        requiresMfa: false,
      });
    }

    // Mock MFA required scenario
    if (email === 'mfa@cosine.com' && password === 'Test123!') {
      if (!mfaCode) {
        return NextResponse.json({
          success: false,
          requiresMfa: true,
        });
      }
      
      if (mfaCode === '123456') {
        return NextResponse.json({
          success: true,
          user: { ...mockUser, mfaEnabled: true },
          accessToken: 'mock-jwt-access-token',
          refreshToken: 'mock-jwt-refresh-token',
          requiresMfa: false,
        });
      } else {
        return NextResponse.json(
          { success: false, error: 'Invalid MFA code' },
          { status: 400 }
        );
      }
    }

    return NextResponse.json(
      { success: false, error: 'Invalid credentials' },
      { status: 401 }
    );

  } catch (error) {
    console.error('Login error:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
