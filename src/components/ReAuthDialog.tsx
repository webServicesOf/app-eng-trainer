import React from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogContentText,
  DialogActions,
  Button,
} from '@mui/material';
import { useAppStore } from '../stores/appStore';

/**
 * Modal dialog shown when DriveAuthError occurs.
 * Appears on any screen — user can re-login without losing current state.
 * After successful re-auth, dirty articles are auto-saved via retryAfterReAuth.
 */
const ReAuthDialog: React.FC = () => {
  const { needsReAuth, triggerLogin, setNeedsReAuth, dirtyAudioIds } = useAppStore();

  const handleLogin = () => {
    if (triggerLogin) {
      triggerLogin();
    }
    // Dialog closes when setAccessToken clears needsReAuth
  };

  const handleDismiss = () => {
    setNeedsReAuth(false);
  };

  const dirtyCount = dirtyAudioIds.size;

  return (
    <Dialog open={needsReAuth} onClose={handleDismiss}>
      <DialogTitle>세션 만료</DialogTitle>
      <DialogContent>
        <DialogContentText>
          Google 인증이 만료되었습니다.
          {dirtyCount > 0 && (
            <>
              <br /><br />
              <strong>저장되지 않은 변경사항 {dirtyCount}건이 있습니다.</strong>
              <br />
              재로그인하면 자동으로 저장됩니다. 편집 내용은 안전합니다.
            </>
          )}
        </DialogContentText>
      </DialogContent>
      <DialogActions>
        <Button onClick={handleDismiss} color="inherit">
          나중에
        </Button>
        <Button onClick={handleLogin} variant="contained" autoFocus>
          Google 재로그인
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default ReAuthDialog;
