import { Box, Typography } from '@mui/material';
import { Check } from '@mui/icons-material';

interface VerificationSuccessModalProps {
  email: string;
  onLoginClick: () => void;
}

export default function VerificationSuccessModal({ email, onLoginClick }: VerificationSuccessModalProps) {
  return (
    <Box
      sx={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        p: 2,
        zIndex: 1400,
      }}
    >
      {/* Backdrop Blur Overlay */}
      <Box
        sx={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0, 0, 0, 0.5)',
          backdropFilter: 'blur(8px)',
          zIndex: -1,
        }}
      />

      {/* Success Card */}
      <Box sx={{
        maxWidth: 448,
        width: '100%',
        p: 4,
        backgroundColor: 'rgba(15, 23, 42, 0.95)',
        borderRadius: '0px',
        boxShadow: '0 25px 50px -12px rgb(0 0 0 / 0.5)',
        border: '2px solid #374151',
        backdropFilter: 'blur(16px)',
        textAlign: 'center',
      }}>
        {/* Success Icon */}
        <Box sx={{ mb: 3 }}>
          <Box
            sx={{
              width: 80,
              height: 80,
              margin: '0 auto',
              backgroundColor: 'rgba(34, 197, 94, 0.1)',
              border: '2px solid #22c55e',
              borderRadius: '50%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Check sx={{ fontSize: 48, color: '#22c55e' }} />
          </Box>
        </Box>

        {/* Header */}
        <Typography 
          variant="h4" 
          sx={{ 
            fontSize: '1.875rem',
            fontWeight: 800,
            color: '#ffffff',
            mb: 2,
            textTransform: 'uppercase'
          }}
        >
          Account Created!
        </Typography>

        {/* Message */}
        <Typography 
          variant="body1" 
          sx={{ 
            fontSize: '1rem',
            color: '#e2e8f0',
            mb: 3,
            lineHeight: 1.6
          }}
        >
          We've sent a verification link to:
        </Typography>

        {/* Email Display */}
        <Box sx={{
          backgroundColor: 'rgba(34, 197, 94, 0.1)',
          border: '1px solid #22c55e',
          borderRadius: '0px',
          p: 2,
          mb: 4,
        }}>
          <Typography 
            sx={{ 
              color: '#86efac',
              fontSize: '0.875rem',
              fontWeight: 600,
              wordBreak: 'break-all'
            }}
          >
            {email}
          </Typography>
        </Box>

        {/* Instructions */}
        <Typography 
          variant="body2" 
          sx={{ 
            fontSize: '0.875rem',
            color: '#9ca3af',
            mb: 4,
            lineHeight: 1.6
          }}
        >
          Click the link in the email to verify your account. After verification, come back here to log in.
        </Typography>

        {/* Login Button - Native HTML button for full control */}
        <button
          onClick={onLoginClick}
          style={{
            width: '100%',
            padding: '12px 16px',
            backgroundColor: '#dc2626',
            color: '#ffffff',
            fontSize: '0.875rem',
            fontWeight: 700,
            textTransform: 'uppercase',
            border: '2px solid #dc2626',
            borderRadius: '0px',
            cursor: 'pointer',
            transition: 'all 0.2s ease',
          }}
          onMouseEnter={(e) => {
            (e.target as HTMLButtonElement).style.backgroundColor = '#b91c1c';
            (e.target as HTMLButtonElement).style.borderColor = '#b91c1c';
          }}
          onMouseLeave={(e) => {
            (e.target as HTMLButtonElement).style.backgroundColor = '#dc2626';
            (e.target as HTMLButtonElement).style.borderColor = '#dc2626';
          }}
        >
          Ready to Log In
        </button>

        {/* Spam Tip */}
        <Typography 
          variant="caption" 
          sx={{ 
            fontSize: '0.75rem',
            color: '#64748b',
            mt: 3,
            display: 'block',
            lineHeight: 1.6
          }}
        >
          💡 <strong>Tip:</strong> If you don't see the email, check your spam folder.
        </Typography>
      </Box>
    </Box>
  );
}
