import React from 'react';
import { Authenticator } from '@aws-amplify/ui-react';
import '@aws-amplify/ui-react/styles.css';

// Custom sign-in form with federated providers
const components = {
  SignIn: {
    Header() {
      return (
        <div style={{ textAlign: 'center', padding: '2rem' }}>
          <h1>Welcome to Cosine</h1>
          <p>Sign in to access your account</p>
        </div>
      );
    },
    Footer() {
      return (
        <div style={{ textAlign: 'center', marginTop: '1rem' }}>
          <p>
            <strong>Sign in with your preferred method:</strong>
          </p>
          <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center', marginTop: '1rem' }}>
            <button
              type="button"
              onClick={() => {
                // This will trigger Google OAuth
                window.location.href = `https://${process.env.NEXT_PUBLIC_COGNITO_DOMAIN}/oauth2/authorize?response_type=code&client_id=${process.env.NEXT_PUBLIC_COGNITO_CLIENT_ID}&redirect_uri=${encodeURIComponent(window.location.origin)}&identity_provider=Google&scope=email+openid+profile`;
              }}
              style={{
                padding: '0.75rem 1.5rem',
                backgroundColor: '#4285f4',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer',
                fontSize: '0.875rem',
                fontWeight: '500',
              }}
            >
              🔍 Continue with Google
            </button>
            <button
              type="button"
              onClick={() => {
                // This will trigger Microsoft OAuth
                window.location.href = `https://${process.env.NEXT_PUBLIC_COGNITO_DOMAIN}/oauth2/authorize?response_type=code&client_id=${process.env.NEXT_PUBLIC_COGNITO_CLIENT_ID}&redirect_uri=${encodeURIComponent(window.location.origin)}&identity_provider=Microsoft&scope=email+openid+profile`;
              }}
              style={{
                padding: '0.75rem 1.5rem',
                backgroundColor: '#0078d4',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer',
                fontSize: '0.875rem',
                fontWeight: '500',
              }}
            >
              🏢 Continue with Microsoft
            </button>
          </div>
          <div style={{ margin: '1rem 0', color: '#666' }}>
            <hr style={{ margin: '1rem 0' }} />
            <p>Or use email and password below</p>
          </div>
        </div>
      );
    },
  },
  SignUp: {
    Header() {
      return (
        <div style={{ textAlign: 'center', padding: '2rem' }}>
          <h1>Create Your Cosine Account</h1>
          <p>Join thousands of users already using Cosine</p>
        </div>
      );
    },
  },
};

// Form fields configuration
const formFields = {
  signIn: {
    username: {
      placeholder: 'Enter your email',
      isRequired: true,
      label: 'Email Address',
    },
    password: {
      placeholder: 'Enter your password',
      isRequired: true,
      label: 'Password',
    },
  },
  signUp: {
    email: {
      placeholder: 'Enter your email',
      isRequired: true,
      label: 'Email Address',
      order: 1,
    },
    given_name: {
      placeholder: 'Enter your first name',
      isRequired: true,
      label: 'First Name',
      order: 2,
    },
    family_name: {
      placeholder: 'Enter your last name',
      isRequired: true,
      label: 'Last Name',
      order: 3,
    },
    password: {
      placeholder: 'Create a password',
      isRequired: true,
      label: 'Password',
      order: 4,
    },
    confirm_password: {
      placeholder: 'Confirm your password',
      isRequired: true,
      label: 'Confirm Password',
      order: 5,
    },
  },
};

// Services configuration for social providers
const services = {
  async handleSignIn(formData) {
    // Custom sign-in logic can go here
    console.log('Sign in attempt:', formData);
  },
  async handleSignUp(formData) {
    // Custom sign-up logic can go here
    console.log('Sign up attempt:', formData);
  },
};

interface AuthenticationWrapperProps {
  children: React.ReactNode;
}

export default function AuthenticationWrapper({ children }: AuthenticationWrapperProps) {
  return (
    <Authenticator
      components={components}
      formFields={formFields}
      services={services}
      signUpAttributes={['email', 'given_name', 'family_name']}
      hideSignUp={false}
      variation="modal"
    >
      {({ signOut, user }) => (
        <div>
          {/* Navigation Bar with User Info */}
          <nav style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '1rem 2rem',
            backgroundColor: '#f8f9fa',
            borderBottom: '1px solid #e9ecef'
          }}>
            <div>
              <h2 style={{ margin: 0 }}>Cosine Dashboard</h2>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
              <span>Welcome, {user?.attributes?.given_name || user?.attributes?.email}!</span>
              <button
                onClick={signOut}
                style={{
                  padding: '0.5rem 1rem',
                  backgroundColor: '#dc3545',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer',
                }}
              >
                Sign Out
              </button>
            </div>
          </nav>

          {/* Main Application Content */}
          <main style={{ padding: '2rem' }}>
            {children}
          </main>
        </div>
      )}
    </Authenticator>
  );
}

// Usage example:
// 
// import AuthenticationWrapper from './components/AuthenticationWrapper';
// 
// function App() {
//   return (
//     <AuthenticationWrapper>
//       <div>
//         <h1>Your App Content Here</h1>
//         <p>This content is only visible to authenticated users.</p>
//       </div>
//     </AuthenticationWrapper>
//   );
// }
