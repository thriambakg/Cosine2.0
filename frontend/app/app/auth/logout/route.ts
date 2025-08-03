// OAuth logout endpoint for Cognito federated authentication
// This endpoint handles the redirect from Cognito after logout

import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  try {
    console.log('OAuth logout callback received');

    // Create response with redirect to home page
    const response = NextResponse.redirect(new URL('/', request.url));

    // Clear all authentication cookies
    const cookieOptions = {
      httpOnly: true,
      secure: true,
      sameSite: 'lax' as const,
      path: '/',
      maxAge: 0, // Immediately expire
    };

    response.cookies.set('access_token', '', cookieOptions);
    response.cookies.set('id_token', '', cookieOptions);
    response.cookies.set('refresh_token', '', cookieOptions);

    console.log('User successfully logged out, cookies cleared');

    return response;

  } catch (error) {
    console.error('OAuth logout error:', error);
    
    // Even if there's an error, redirect to home and clear cookies
    const response = NextResponse.redirect(new URL('/', request.url));
    
    const cookieOptions = {
      httpOnly: true,
      secure: true,
      sameSite: 'lax' as const,
      path: '/',
      maxAge: 0,
    };

    response.cookies.set('access_token', '', cookieOptions);
    response.cookies.set('id_token', '', cookieOptions);
    response.cookies.set('refresh_token', '', cookieOptions);

    return response;
  }
}
