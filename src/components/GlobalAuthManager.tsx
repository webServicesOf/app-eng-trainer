import { useEffect, useRef, useCallback } from 'react';
import { useGoogleLogin } from '@react-oauth/google';
import { useAppStore } from '../stores/appStore';
import { localDB } from '../services/database';

/**
 * Invisible component that manages Google OAuth globally.
 * Provides login() to the store so any screen can trigger re-auth.
 * Handles proactive token refresh scheduling.
 * Must be rendered inside GoogleOAuthProvider.
 */
const GlobalAuthManager: React.FC = () => {
  const {
    isAuthenticated,
    setAccessToken,
    setTriggerLogin,
    setNeedsReAuth,
    loadAudioArticles,
    retryAfterReAuth,
  } = useAppStore();

  const tokenRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const scheduleTokenRefresh = useCallback((expiresIn: number) => {
    if (tokenRefreshTimerRef.current) clearTimeout(tokenRefreshTimerRef.current);
    // Refresh 5 minutes before expiry
    const refreshMs = Math.max((expiresIn - 300) * 1000, 60000);
    tokenRefreshTimerRef.current = setTimeout(() => {
      console.log('[auth] auto-refreshing token (silent)...');
      login({ prompt: '' }); // silent: 세션 유효+동의완료면 팝업 없이 갱신
    }, refreshMs);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const login = useGoogleLogin({
    onSuccess: async (tokenResponse) => {
      setAccessToken(tokenResponse.access_token, tokenResponse.expires_in);
      scheduleTokenRefresh(tokenResponse.expires_in);
      // Retry any pending saves after re-auth
      await retryAfterReAuth();
      // Reload Drive data
      await loadAudioArticles();
    },
    onError: () => {
      // silent 갱신 실패(세션 만료/동의 철회 등) → 수동 재로그인 필요 표시(팝업 강제 안 함)
      console.error('[auth] Login failed — needs manual re-auth');
      setNeedsReAuth(true);
    },
    scope: 'https://www.googleapis.com/auth/spreadsheets.readonly https://www.googleapis.com/auth/drive.file',
  });

  // Register login function in store so any component/screen can trigger it.
  // 프로그램적 재로그인(401 등)은 silent 우선. 첫 로그인은 필요 시 GIS가 consent 표시.
  useEffect(() => {
    setTriggerLogin(() => login({ prompt: '' }));
    return () => setTriggerLogin(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setTriggerLogin]);

  // On mount: schedule refresh for existing token
  useEffect(() => {
    const expiry = localDB.getTokenExpiryMs();
    if (expiry && isAuthenticated) {
      const remainingSec = Math.floor((expiry - Date.now()) / 1000);
      if (remainingSec > 0) {
        scheduleTokenRefresh(remainingSec);
      } else {
        login({ prompt: '' }); // 만료 상태로 켜짐 → silent 갱신 시도
      }
    }
    return () => {
      if (tokenRefreshTimerRef.current) clearTimeout(tokenRefreshTimerRef.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated]);

  return null; // Invisible — no UI
};

export default GlobalAuthManager;
