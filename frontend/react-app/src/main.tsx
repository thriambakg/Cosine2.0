import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { Provider } from 'react-redux'
import { ThemeProvider } from '@mui/material/styles'
import CssBaseline from '@mui/material/CssBaseline'
import App from './App.tsx'
import { store } from './store/store'
import { theme } from './theme/theme'
import configureAmplify from './config/amplify-config'
import './index.css'

// Initialize logging system early to override console methods globally
// This must be imported before any other modules that use console.log
import './utils/logger'

// Configure Amplify before rendering the app
configureAmplify()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Provider store={store}>
      <BrowserRouter>
        <ThemeProvider theme={theme}>
          <CssBaseline />
          <App />
        </ThemeProvider>
      </BrowserRouter>
    </Provider>
  </React.StrictMode>,
)
