// OAuth callback endpoint for Cognito federated authentication
// This endpoint handles the redirect from Google/Microsoft OAuth

import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const code = searchParams.get('code');
    const state = searchParams.get('state');
    const error = searchParams.get('error');
    const errorDescription = searchParams.get('error_description');

    console.log('OAuth callback received:', {
      code: code ? 'present' : 'missing',
      state: state ? 'present' : 'missing',
      error,
      errorDescription
    });

    // Handle OAuth errors
    if (error) {
      console.error('OAuth error:', error, errorDescription);
      return NextResponse.redirect(
        new URL(`/login?error=${encodeURIComponent(error)}&description=${encodeURIComponent(errorDescription || '')}`, request.url)
      );
    }

    // Validate required parameters
    if (!code) {
      console.error('No authorization code received');
      return NextResponse.redirect(
        new URL('/login?error=missing_code', request.url)
      );
    }

    // Exchange authorization code for tokens
    const tokenUrl = `https://${process.env.NEXT_PUBLIC_COGNITO_DOMAIN}/oauth2/token`;
    
    const tokenResponse = await fetch(tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: process.env.NEXT_PUBLIC_COGNITO_USER_POOL_CLIENT_ID!,
        code,
        redirect_uri: `${request.nextUrl.origin}/auth/callback`,
      }),
    });

    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text();
      console.error('Token exchange failed:', tokenResponse.status, errorText);
      return NextResponse.redirect(
        new URL('/login?error=token_exchange_failed', request.url)
      );
    }

    const tokens = await tokenResponse.json();
    console.log('Token exchange successful:', { 
      access_token: tokens.access_token ? 'present' : 'missing',
      id_token: tokens.id_token ? 'present' : 'missing',
      refresh_token: tokens.refresh_token ? 'present' : 'missing'
    });

    // Create response with redirect to dashboard
    const response = NextResponse.redirect(new URL('/app', request.url));

    // Set secure HTTP-only cookies for tokens
    if (tokens.access_token) {
      response.cookies.set('access_token', tokens.access_token, {
        httpOnly: true,
        secure: true,
        sameSite: 'lax',
        maxAge: 3600, // 1 hour
        path: '/',
      });
    }

    if (tokens.id_token) {
      response.cookies.set('id_token', tokens.id_token, {
        httpOnly: true,
        secure: true,
        sameSite: 'lax',
        maxAge: 3600, // 1 hour
        path: '/',
      });
    }

    if (tokens.refresh_token) {
      response.cookies.set('refresh_token', tokens.refresh_token, {
        httpOnly: true,
        secure: true,
        sameSite: 'lax',
        maxAge: 2592000, // 30 days
        path: '/',
      });
    }

    return response;

  } catch (error) {
    console.error('OAuth callback error:', error);
    return NextResponse.redirect(
      new URL('/login?error=callback_failed', request.url)
    );
  }
}
