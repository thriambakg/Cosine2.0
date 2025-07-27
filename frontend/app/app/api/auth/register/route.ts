import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    const { email, password, firstName, lastName, phoneNumber, termsAccepted, marketingConsent } = await request.json();

    // TODO: Integrate with AWS Cognito
    // For now, return a mock response for testing

    // Basic validation
    if (!email || !password || !firstName || !lastName || !termsAccepted) {
      return NextResponse.json(
        { success: false, error: 'All required fields must be provided' },
        { status: 400 }
      );
    }

    // Email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return NextResponse.json(
        { success: false, error: 'Invalid email address' },
        { status: 400 }
      );
    }

    // Password validation
    if (password.length < 8) {
      return NextResponse.json(
        { success: false, error: 'Password must be at least 8 characters long' },
        { status: 400 }
      );
    }

    // Check if user already exists (mock check)
    if (email === 'existing@cosine.com') {
      return NextResponse.json(
        { success: false, error: 'An account with this email already exists' },
        { status: 409 }
      );
    }

    // Mock user creation
    const newUser = {
      id: `user_${Date.now()}`,
      email: email.toLowerCase(),
      firstName,
      lastName,
      phoneNumber: phoneNumber || undefined,
      role: 'user' as const,
      verified: false, // Would typically require email verification
      mfaEnabled: false,
      createdAt: new Date().toISOString(),
      subscription: {
        plan: 'free' as const,
        status: 'active' as const,
      },
      cognitoSub: `mock-cognito-sub-${Date.now()}`,
      emailVerified: false,
      phoneVerified: phoneNumber ? false : undefined,
    };

    // Mock successful registration
    return NextResponse.json({
      success: true,
      user: newUser,
      token: 'mock-jwt-token',
      message: 'Account created successfully. Please check your email for verification.',
    });

  } catch (error) {
    console.error('Registration error:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
