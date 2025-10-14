import React, { useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { CssBaseline } from '@mui/material';
import { GoogleOAuthProvider } from '@react-oauth/google';
import HomeScreen from './screens/HomeScreen';
import SentenceLearningScreen from './screens/SentenceLearningScreen';
import SavedSentencesScreen from './screens/SavedSentencesScreen';
import { useAppStore } from './stores/appStore';

// Create Material-UI theme
const theme = createTheme({
  palette: {
    primary: {
      main: '#1976d2',
    },
    secondary: {
      main: '#dc004e',
    },
  },
  typography: {
    h4: {
      fontWeight: 600,
    },
    h5: {
      fontWeight: 600,
    },
    h6: {
      fontWeight: 600,
    },
  },
});

// Google OAuth Client ID - 사용자가 설정해야 함
const GOOGLE_CLIENT_ID = process.env.REACT_APP_GOOGLE_CLIENT_ID || '';

const App: React.FC = () => {
  const { loadArticles, loadGoogleSheetsConfig, loadAccessToken } = useAppStore();

  useEffect(() => {
    // Initialize app data on startup
    const initializeApp = async () => {
      loadGoogleSheetsConfig();
      loadAccessToken();
      await loadArticles();
    };

    initializeApp();
  }, [loadArticles, loadGoogleSheetsConfig, loadAccessToken]);

  return (
    <GoogleOAuthProvider clientId={GOOGLE_CLIENT_ID}>
      <ThemeProvider theme={theme}>
        <CssBaseline />
        <Router>
          <Routes>
            <Route path="/" element={<HomeScreen />} />
            <Route path="/learn/:id" element={<SentenceLearningScreen />} />
            <Route path="/saved" element={<SavedSentencesScreen />} />
          </Routes>
        </Router>
      </ThemeProvider>
    </GoogleOAuthProvider>
  );
};

export default App;
