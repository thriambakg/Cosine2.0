import { createTheme } from '@mui/material/styles';

// Color palette: solid blue primary (no purple/iridescent)
const colors = {
  primary: {
    main: '#3B82F6', // Blue-500
    light: '#60A5FA', // Blue-400
    dark: '#1E40AF', // Blue-700
    gradient: '#3B82F6', // Solid blue (no gradient)
  },
  secondary: {
    main: '#2563EB', // Blue-600
    light: '#60A5FA', // Blue-400
    dark: '#1E40AF', // Blue-700
  },
  accent: {
    green: '#10B981', // Emerald-500
    orange: '#F59E0B', // Amber-500
    red: '#EF4444', // Red-500
  },
  background: {
    primary: 'linear-gradient(135deg, #1E3A8A 0%, #1E40AF 50%, #312E81 100%)', // Blue only
    glass: 'rgba(255, 255, 255, 0.1)',
    glassBorder: 'rgba(255, 255, 255, 0.2)',
  },
  text: {
    primary: '#FFFFFF',
    secondary: 'rgba(255, 255, 255, 0.8)',
    accent: 'rgba(255, 255, 255, 0.6)',
  }
};

// Custom MUI theme that preserves your design language
export const theme = createTheme({
  palette: {
    mode: 'dark',
    primary: {
      main: colors.primary.main,
      light: colors.primary.light,
      dark: colors.primary.dark,
    },
    secondary: {
      main: colors.secondary.main,
      light: colors.secondary.light,
      dark: colors.secondary.dark,
    },
    background: {
      default: '#0f172a', // Blue slate-900 to match page gradients
      paper: 'rgba(255, 255, 255, 0.1)', // Glass effect
    },
    text: {
      primary: colors.text.primary,
      secondary: colors.text.secondary,
    },
    success: {
      main: colors.accent.green,
    },
    warning: {
      main: colors.accent.orange,
    },
    error: {
      main: colors.accent.red,
    },
  },
  typography: {
    fontFamily: '"Inter", "Roboto", "Helvetica", "Arial", sans-serif',
    h1: {
      fontSize: '3.5rem',
      fontWeight: 700,
      lineHeight: 1.2,
      '@media (min-width:1024px)': {
        fontSize: '4rem',
      },
    },
    h2: {
      fontSize: '2.25rem',
      fontWeight: 700,
      lineHeight: 1.3,
    },
    h3: {
      fontSize: '1.5rem',
      fontWeight: 600,
      lineHeight: 1.4,
    },
    h4: {
      fontSize: '1.25rem',
      fontWeight: 600,
    },
    body1: {
      fontSize: '1rem',
      lineHeight: 1.6,
    },
    body2: {
      fontSize: '0.875rem',
      lineHeight: 1.5,
    },
  },
  shape: {
    borderRadius: 12, // Rounded corners like your design
  },
  spacing: 8, // 8px base spacing unit
  components: {
    // Custom Button component matching your design
    MuiButton: {
      styleOverrides: {
        root: {
          textTransform: 'none',
          fontWeight: 600,
          borderRadius: 12,
          padding: '12px 24px',
          boxShadow: 'none',
          '&:hover': {
            boxShadow: '0 8px 32px rgba(0, 0, 0, 0.3)',
            transform: 'translateY(-2px)',
          },
          transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
        },
        containedPrimary: {
          background: colors.primary.main,
          color: colors.text.primary,
          '&:hover': {
            background: colors.primary.dark,
          },
        },
        outlined: {
          borderColor: colors.background.glassBorder,
          backgroundColor: colors.background.glass,
          backdropFilter: 'blur(12px)',
          color: colors.text.primary,
          '&:hover': {
            backgroundColor: 'rgba(255, 255, 255, 0.15)',
            borderColor: 'rgba(255, 255, 255, 0.3)',
          },
        },
      },
    },
    // Custom Card component with glassmorphism
    MuiCard: {
      styleOverrides: {
        root: {
          backgroundColor: colors.background.glass,
          backdropFilter: 'blur(16px)',
          border: `1px solid ${colors.background.glassBorder}`,
          borderRadius: 16,
          boxShadow: '0 8px 32px rgba(0, 0, 0, 0.3)',
          transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
          '&:hover': {
            backgroundColor: 'rgba(255, 255, 255, 0.15)',
            transform: 'translateY(-4px)',
            boxShadow: '0 16px 48px rgba(0, 0, 0, 0.4)',
          },
        },
      },
    },
    // Custom Paper component
    MuiPaper: {
      styleOverrides: {
        root: {
          backgroundColor: colors.background.glass,
          backdropFilter: 'blur(16px)',
          border: `1px solid ${colors.background.glassBorder}`,
          boxShadow: '0 8px 32px rgba(0, 0, 0, 0.3)',
        },
      },
    },
    // Custom AppBar
    MuiAppBar: {
      styleOverrides: {
        root: {
          backgroundColor: 'transparent',
          backdropFilter: 'blur(16px)',
          border: `1px solid ${colors.background.glassBorder}`,
          boxShadow: 'none',
        },
      },
    },
    // Custom Typography
    MuiTypography: {
      styleOverrides: {
        h1: {
          background: 'linear-gradient(135deg, #60A5FA 0%, #A78BFA 100%)',
          WebkitBackgroundClip: 'text',
          WebkitTextFillColor: 'transparent',
          backgroundClip: 'text',
        },
      },
    },
    // Custom Container
    MuiContainer: {
      styleOverrides: {
        root: {
          paddingLeft: 24,
          paddingRight: 24,
          '@media (min-width:600px)': {
            paddingLeft: 32,
            paddingRight: 32,
          },
        },
      },
    },
  },
});

// Extended theme with custom properties
declare module '@mui/material/styles' {
  interface Theme {
    customColors: typeof colors;
  }
  interface ThemeOptions {
    customColors?: typeof colors;
  }
  
  interface Palette {
    gradient: {
      primary: string;
      secondary: string;
    };
  }
  interface PaletteOptions {
    gradient?: {
      primary: string;
      secondary: string;
    };
  }
}

// Add custom colors to theme
theme.customColors = colors;
theme.palette.gradient = {
  primary: colors.primary.main,
  secondary: 'linear-gradient(135deg, #2563EB 0%, #3B82F6 100%)',
};

export default theme;
