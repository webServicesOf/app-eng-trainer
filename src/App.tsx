import React, { useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, useParams } from 'react-router-dom';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { CssBaseline } from '@mui/material';
import { GoogleOAuthProvider } from '@react-oauth/google';
import HomeScreen from './screens/HomeScreen';
import SentenceLearningScreen from './screens/SentenceLearningScreen';
import SavedSentencesScreen from './screens/SavedSentencesScreen';
import AudioLearningScreen from './screens/AudioLearningScreen';
import TimestampEditorScreen from './screens/TimestampEditorScreen';
import GlobalAuthManager from './components/GlobalAuthManager';
import ReAuthDialog from './components/ReAuthDialog';
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

// 플레이리스트 이전/다음 영상 전환 시 로컬 state(audio, article) 완전 리셋 — id별 강제 remount
const AudioLearningRoute: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  return <AudioLearningScreen key={id} />;
};

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
        <GlobalAuthManager />
        <ReAuthDialog />
        <Router>
          <Routes>
            <Route path="/" element={<HomeScreen />} />
            <Route path="/learn/:id" element={<SentenceLearningScreen />} />
            <Route path="/learn-audio/:id" element={<AudioLearningRoute />} />
            <Route path="/edit-timestamps/:id" element={<TimestampEditorScreen />} />
            <Route path="/saved" element={<SavedSentencesScreen />} />
          </Routes>
        </Router>
      </ThemeProvider>
    </GoogleOAuthProvider>
  );
};

export default App;
