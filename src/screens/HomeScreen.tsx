import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box,
  Container,
  Typography,
  Button,
  Card,
  CardContent,
  CardActions,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Alert,
  CircularProgress,
  IconButton,
  Chip,
  Tabs,
  Tab,
  MenuItem,
  FormControlLabel,
  Checkbox,
} from '@mui/material';
import {
  Delete as DeleteIcon,
  Settings as SettingsIcon,
  Refresh as RefreshIcon,
  Logout as LogoutIcon,
  Edit as EditIcon,
  CheckBox,
  CheckBoxOutlineBlank,
  SelectAll,
  DeleteSweep,
  PlayArrow,
  Upload as UploadIcon,

  DoneAll as DoneAllIcon,
  CloudSync as CloudSyncIcon,
} from '@mui/icons-material';
import { useGoogleLogin } from '@react-oauth/google';
import { useAppStore } from '../stores/appStore';
import { SavedSentence, AudioArticle, SentenceEntry } from '../types';
import { localDB } from '../services/database';
import { googleCloudTtsService } from '../services/googleCloudTtsService';

export const HomeScreen: React.FC = () => {
  const navigate = useNavigate();
  const {
    articles,
    audioArticles,
    subDecks,
    isLoading,
    error,
    googleSheetsConfig,
    isAuthenticated,
    accessToken,
    loadArticles,
    loadAudioArticles,
    saveAudioArticle,
    deleteAudioArticle,
    deleteArticle,
    updateLastAccessed,
    setGoogleSheetsConfig,
    loadGoogleSheetsConfig,
    setAccessToken,
    setLoading,
    setError,
    logout,
    markReviewDone,
    cycleReviewInterval,
    loadSubDecks,
    deleteSubDeck,
    isSyncing,
    lastSyncedAt,
    syncError,
    syncDrive,
  } = useAppStore();

  const [spreadsheetId, setSpreadsheetId] = useState('');
  const [range, setRange] = useState('Sheet1!A:E');
  const [hasHeader, setHasHeader] = useState(true);
  const [managementMode, setManagementMode] = useState(false);
  const [selectedArticles, setSelectedArticles] = useState<Set<string>>(new Set());
  const [currentTab, setCurrentTab] = useState(0);
  const [savedSentences, setSavedSentences] = useState<SavedSentence[]>([]);
  const [loadingSaved, setLoadingSaved] = useState(false);
  const [savedManagementMode, setSavedManagementMode] = useState(false);
  const [selectedSentences, setSelectedSentences] = useState<Set<string>>(new Set());
  const [difficultyFilter, setDifficultyFilter] = useState<string>('all');
  const [lengthFilter, setLengthFilter] = useState<string>('all');
  const [fetchModeDialogOpen, setFetchModeDialogOpen] = useState(false);
  const [settingsDialogOpen, setSettingsDialogOpen] = useState(false);
  const [ttsApiKey, setTtsApiKey] = useState('');
  const [driveFolderName, setDriveFolderName] = useState('eng-trainer');
  const [sheetTabs, setSheetTabs] = useState<string[]>([]);
  const [uploadDialogOpen, setUploadDialogOpen] = useState(false);
  const [uploadMp3File, setUploadMp3File] = useState<File | null>(null);
  const [uploadJsonFile, setUploadJsonFile] = useState<File | null>(null);
  const [uploadTitle, setUploadTitle] = useState('');
  const [uploadSource, setUploadSource] = useState('');

  const login = useGoogleLogin({
    onSuccess: (tokenResponse) => {
      setAccessToken(tokenResponse.access_token);
    },
    onError: () => {
      console.error('Login Failed');
    },
    scope: 'https://www.googleapis.com/auth/spreadsheets.readonly https://www.googleapis.com/auth/drive.file',
  });

  useEffect(() => {
    loadGoogleSheetsConfig();
    loadArticles();
    loadAudioArticles();
    loadSubDecks();

    // Load saved settings
    const savedKey = localStorage.getItem('google_cloud_tts_api_key');
    if (savedKey) setTtsApiKey(savedKey);
    const savedFolder = localStorage.getItem('drive_folder_name');
    if (savedFolder) setDriveFolderName(savedFolder);
  }, [loadArticles, loadAudioArticles, loadGoogleSheetsConfig]);

  // Auto-sync on login
  useEffect(() => {
    if (isAuthenticated && accessToken) {
      syncDrive();
    }
  }, [isAuthenticated]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (currentTab === 2) {
      loadSavedSentences();
    }
  }, [currentTab]);

  const handleSaveAllSettings = () => {
    // TTS API key
    if (ttsApiKey.trim()) {
      googleCloudTtsService.setApiKey(ttsApiKey);
      localStorage.setItem('google_cloud_tts_api_key', ttsApiKey);
    }
    // Drive folder name
    if (driveFolderName.trim()) {
      localStorage.setItem('drive_folder_name', driveFolderName);
    }
    // Sheets config
    if (spreadsheetId && range) {
      setGoogleSheetsConfig({ spreadsheetId, range, hasHeader });
    }
    setSettingsDialogOpen(false);
  };

  const handleFetchSheetTabs = async () => {
    if (!spreadsheetId.trim() || !accessToken) return;
    try {
      const res = await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=sheets.properties.title`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
      if (!res.ok) throw new Error(`${res.status}`);
      const data = await res.json();
      const tabs = (data.sheets || []).map((s: any) => s.properties.title);
      setSheetTabs(tabs);
    } catch (e) {
      console.error('Failed to fetch sheet tabs:', e);
      setSheetTabs([]);
    }
  };

  const handleUploadAudioArticle = async () => {
    if (!uploadMp3File || !uploadJsonFile || !uploadTitle.trim()) {
      alert('제목, MP3 파일, JSON 파일 모두 필요합니다.');
      return;
    }

    try {
      setLoading(true);

      // Parse sentences.json
      const jsonText = await uploadJsonFile.text();
      const rawSentences = JSON.parse(jsonText);

      // Validate & normalize sentences
      const sentences: SentenceEntry[] = rawSentences.map((s: any, i: number) => ({
        index: s.index ?? i + 1,
        text: s.text,
        start: s.start ?? 0,
        end: s.end ?? 0,
        memo: s.memo,
      }));

      // Read mp3 as blob
      const audioBlob = new Blob([await uploadMp3File.arrayBuffer()], {
        type: 'audio/mpeg',
      });

      const audioArticle: AudioArticle = {
        id: `audio-${Date.now()}`,
        title: uploadTitle.trim(),
        audioBlob,
        sentences,
        source: uploadSource.trim() || undefined,
        nextReviewDate: null,
        reviewInterval: 0,
        createdAt: new Date(),
        lastAccessed: new Date(),
      };

      await saveAudioArticle(audioArticle);

      // Reset form
      setUploadMp3File(null);
      setUploadJsonFile(null);
      setUploadTitle('');
      setUploadSource('');
      setUploadDialogOpen(false);
    } catch (error) {
      console.error('Upload failed:', error);
      alert('업로드 실패: ' + (error instanceof Error ? error.message : 'Unknown error'));
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteAudioArticle = async (id: string) => {
    if (window.confirm('이 Audio Article을 삭제하시겠습니까?')) {
      await deleteAudioArticle(id);
    }
  };

  const handleLearnAudioArticle = async (id: string) => {
    // Set initial review schedule on first learning
    const aa = audioArticles.find(a => a.id === id);
    if (aa && !aa.nextReviewDate && !aa.reviewInterval) {
      await cycleReviewInterval('audio', id);
    }
    await localDB.updateAudioArticleLastAccessed(id);
    navigate(`/learn-audio/${id}`);
  };

  const loadSavedSentences = async () => {
    try {
      setLoadingSaved(true);
      const saved = await localDB.getSavedSentences();
      setSavedSentences(saved);
    } catch (error) {
      console.error('Failed to load saved sentences:', error);
    } finally {
      setLoadingSaved(false);
    }
  };

  useEffect(() => {
    if (googleSheetsConfig) {
      setSpreadsheetId(googleSheetsConfig.spreadsheetId);
      setRange(googleSheetsConfig.range);
      setHasHeader(googleSheetsConfig.hasHeader !== undefined ? googleSheetsConfig.hasHeader : true);
    }
  }, [googleSheetsConfig]);

  // Helper: check if an article is due for review
  const isDue = (nextReviewDate: Date | null | undefined): boolean => {
    if (!nextReviewDate) return false;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const review = new Date(nextReviewDate);
    review.setHours(0, 0, 0, 0);
    return review <= today;
  };

  // Filter articles based on difficulty and length, sort due to top
  const filteredArticles = React.useMemo(() => {
    const filtered = articles.filter((article) => {
      const difficultyMatch = difficultyFilter === 'all' || article.difficulty === difficultyFilter;
      const lengthMatch = lengthFilter === 'all' || article.length === lengthFilter;
      return difficultyMatch && lengthMatch;
    });
    return filtered.sort((a, b) => {
      const aDue = isDue(a.nextReviewDate) ? 0 : 1;
      const bDue = isDue(b.nextReviewDate) ? 0 : 1;
      if (aDue !== bDue) return aDue - bDue;
      return new Date(b.lastAccessed).getTime() - new Date(a.lastAccessed).getTime();
    });
  }, [articles, difficultyFilter, lengthFilter]);

  // Get unique difficulty and length values
  const difficulties = React.useMemo(() => {
    const unique = new Set(articles.map(a => a.difficulty).filter(Boolean));
    return Array.from(unique).sort();
  }, [articles]);

  const lengths = React.useMemo(() => {
    const unique = new Set(articles.map(a => a.length).filter(Boolean));
    return Array.from(unique).sort();
  }, [articles]);

  const handleFetchArticles = async (mode: 'full-refresh' | 'upsert') => {
    if (!isAuthenticated) {
      login();
      return;
    }
    if (!googleSheetsConfig) {
      setSettingsDialogOpen(true);
      return;
    }

    if (mode === 'full-refresh') {
      // Full refresh: Delete existing articles with same sheetName, then fetch new
      await fetchArticlesFullRefresh();
    } else {
      // Upsert: Update existing, insert new
      await fetchArticlesUpsert();
    }
  };

  const fetchArticlesFullRefresh = async () => {
    const config = googleSheetsConfig;
    const token = accessToken;

    if (!config || !token) return;

    try {
      setLoading(true);
      setError(null);

      const sheetsService = new (await import('../services/googleSheetsService')).GoogleSheetsService(token, config);
      const newArticles = await sheetsService.fetchArticles();

      // Extract sheet name from range
      const sheetName = config.range.split('!')[0];

      // Delete all existing articles with the same sheetName
      const existingArticles = articles;
      for (const article of existingArticles) {
        if (article.sheetName === sheetName) {
          await localDB.deleteArticle(article.id);
        }
      }

      // Save new articles
      for (const article of newArticles) {
        await localDB.saveArticle(article);
      }

      await loadArticles();
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to fetch articles';
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  const fetchArticlesUpsert = async () => {
    const config = googleSheetsConfig;
    const token = accessToken;

    if (!config || !token) return;

    try {
      setLoading(true);
      setError(null);

      const sheetsService = new (await import('../services/googleSheetsService')).GoogleSheetsService(token, config);
      const newArticles = await sheetsService.fetchArticles();

      // Extract sheet name from range (e.g., "Sheet1!A:E" -> "Sheet1")
      const sheetName = config.range.split('!')[0];

      // Get existing articles
      const existingArticles = articles;

      // Create map of existing articles by sheetName+number
      const existingMap = new Map(
        existingArticles.map(a => [`${a.sheetName || ''}-${a.number || ''}`, a])
      );

      // Process new articles
      for (const newArticle of newArticles) {
        const key = `${sheetName}-${newArticle.number || ''}`;
        const existing = existingMap.get(key);

        if (existing) {
          // Update existing article
          const updatedArticle = {
            ...newArticle,
            id: existing.id, // Keep original ID
            createdAt: existing.createdAt, // Keep original creation date
            lastAccessed: existing.lastAccessed, // Keep last accessed
            nextReviewDate: existing.nextReviewDate, // Keep review state
            reviewInterval: existing.reviewInterval, // Keep review state
            sheetName, // Add sheet name
          };
          await localDB.saveArticle(updatedArticle);
        } else {
          // Insert new article
          const articleWithSheet = {
            ...newArticle,
            sheetName, // Add sheet name
          };
          await localDB.saveArticle(articleWithSheet);
        }
      }

      await loadArticles();
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to fetch articles';
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  const handleOpenSettings = () => {
    setSettingsDialogOpen(true);
  };

  const handleLogout = () => {
    logout();
  };

  const handleDeleteArticle = async (id: string) => {
    if (window.confirm('정말 이 Article을 삭제하시겠습니까?')) {
      await deleteArticle(id);
    }
  };

  const handleLearnArticle = async (id: string) => {
    // Set initial review schedule on first learning
    const article = articles.find(a => a.id === id);
    if (article && !article.nextReviewDate && !article.reviewInterval) {
      await cycleReviewInterval('article', id);
    }
    await updateLastAccessed(id);
    navigate(`/learn/${id}`);
  };

  const toggleManagementMode = () => {
    setManagementMode(!managementMode);
    setSelectedArticles(new Set());
  };

  const toggleArticleSelection = (id: string) => {
    const newSelected = new Set(selectedArticles);
    if (newSelected.has(id)) {
      newSelected.delete(id);
    } else {
      newSelected.add(id);
    }
    setSelectedArticles(newSelected);
  };

  const selectAllArticles = () => {
    if (selectedArticles.size === articles.length) {
      setSelectedArticles(new Set());
    } else {
      setSelectedArticles(new Set(articles.map(a => a.id)));
    }
  };

  const handleBulkDelete = async () => {
    if (selectedArticles.size === 0) return;
    if (window.confirm(`선택한 ${selectedArticles.size}개의 Article을 삭제하시겠습니까?`)) {
      for (const id of Array.from(selectedArticles)) {
        await deleteArticle(id);
      }
      setSelectedArticles(new Set());
      setManagementMode(false);
    }
  };

  const handleDeleteSavedSentence = async (id: string) => {
    if (window.confirm('이 문장을 삭제하시겠습니까?')) {
      await localDB.deleteSavedSentence(id);
      await loadSavedSentences();
    }
  };

  const handleGoToArticle = (articleId: string, sentenceIndex: number) => {
    navigate(`/learn/${articleId}?sentence=${sentenceIndex}`);
  };

  const handleTabChange = (_event: React.SyntheticEvent, newValue: number) => {
    setCurrentTab(newValue);
    setManagementMode(false);
    setSelectedArticles(new Set());
    setSavedManagementMode(false);
    setSelectedSentences(new Set());
  };

  const toggleSavedManagementMode = () => {
    setSavedManagementMode(!savedManagementMode);
    setSelectedSentences(new Set());
  };

  const toggleSentenceSelection = (id: string) => {
    const newSelected = new Set(selectedSentences);
    if (newSelected.has(id)) {
      newSelected.delete(id);
    } else {
      newSelected.add(id);
    }
    setSelectedSentences(newSelected);
  };

  const selectAllSentences = () => {
    if (selectedSentences.size === savedSentences.length) {
      setSelectedSentences(new Set());
    } else {
      setSelectedSentences(new Set(savedSentences.map(s => s.id)));
    }
  };

  const handleBulkDeleteSentences = async () => {
    if (selectedSentences.size === 0) return;
    if (window.confirm(`선택한 ${selectedSentences.size}개의 문장을 삭제하시겠습니까?`)) {
      for (const id of Array.from(selectedSentences)) {
        await localDB.deleteSavedSentence(id);
      }
      setSelectedSentences(new Set());
      setSavedManagementMode(false);
      await loadSavedSentences();
    }
  };

  return (
    <Container maxWidth="lg" sx={{ py: { xs: 2, sm: 4 }, px: { xs: 1, sm: 2 } }}>
      <Box sx={{ mb: { xs: 2, sm: 4 }, display: 'flex', flexDirection: { xs: 'column', sm: 'row' }, justifyContent: 'space-between', alignItems: { xs: 'stretch', sm: 'center' }, gap: { xs: 2, sm: 0 } }}>
        <Typography variant="h4" component="h1" sx={{ fontSize: { xs: '1.5rem', sm: '2.125rem' } }}>
          English Learning
        </Typography>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: { xs: 0.5, sm: 1 }, flexWrap: 'wrap', justifyContent: { xs: 'flex-start', sm: 'flex-end' } }}>
          {isAuthenticated ? (
            <>
              <Chip label="로그인됨" color="success" size="small" />
              <IconButton
                color="primary"
                onClick={handleLogout}
                title="로그아웃"
                size="small"
              >
                <LogoutIcon />
              </IconButton>
            </>
          ) : (
            <Button
              variant="outlined"
              size="small"
              onClick={() => login()}
            >
              Google 로그인
            </Button>
          )}
          {isAuthenticated && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
              <IconButton
                color={syncError ? 'error' : 'primary'}
                onClick={syncDrive}
                disabled={isSyncing}
                title={syncError ? `Sync error: ${syncError}` : 'Drive 동기화'}
                size="small"
              >
                {isSyncing ? <CircularProgress size={20} /> : <CloudSyncIcon />}
              </IconButton>
              {lastSyncedAt && (
                <Typography variant="caption" color="text.secondary" sx={{ display: { xs: 'none', sm: 'block' } }}>
                  {new Date(lastSyncedAt).toLocaleTimeString()}
                </Typography>
              )}
            </Box>
          )}
          <IconButton
            color="primary"
            onClick={handleOpenSettings}
            title="설정"
          >
            <SettingsIcon />
          </IconButton>
          {currentTab === 0 ? (
            <>
              <Button
                variant={managementMode ? 'outlined' : 'contained'}
                startIcon={<EditIcon />}
                onClick={toggleManagementMode}
                size="small"
              >
                {managementMode ? '완료' : '관리'}
              </Button>
              <Button
                variant="contained"
                startIcon={<RefreshIcon />}
                onClick={() => setFetchModeDialogOpen(true)}
                disabled={isLoading}
              >
                불러오기
              </Button>
            </>
          ) : currentTab === 1 ? (
            <Button
              variant="contained"
              startIcon={<UploadIcon />}
              onClick={() => setUploadDialogOpen(true)}
              disabled={isLoading}
              size="small"
            >
              업로드
            </Button>
          ) : (
            <Button
              variant={savedManagementMode ? 'outlined' : 'contained'}
              startIcon={<EditIcon />}
              onClick={toggleSavedManagementMode}
              size="small"
            >
              {savedManagementMode ? '완료' : '관리'}
            </Button>
          )}
        </Box>
      </Box>

      <Tabs value={currentTab} onChange={handleTabChange} sx={{ mb: 3 }}>
        <Tab label="Text" />
        <Tab label="Audio" />
        <Tab label="Saved" />
      </Tabs>

      {currentTab === 0 && (
        <>
          {/* Filters */}
          {articles.length > 0 && (
            <Box sx={{ mb: 2, display: 'flex', flexDirection: { xs: 'column', sm: 'row' }, gap: { xs: 1, sm: 2 }, alignItems: 'stretch' }}>
              <TextField
                select
                label="Difficulty"
                value={difficultyFilter}
                onChange={(e) => setDifficultyFilter(e.target.value)}
                size="small"
                sx={{ minWidth: { xs: '100%', sm: 150 } }}
              >
                <MenuItem value="all">All</MenuItem>
                {difficulties.map((diff) => (
                  <MenuItem key={diff} value={diff}>
                    {diff}
                  </MenuItem>
                ))}
              </TextField>
              <TextField
                select
                label="Length"
                value={lengthFilter}
                onChange={(e) => setLengthFilter(e.target.value)}
                size="small"
                sx={{ minWidth: { xs: '100%', sm: 150 } }}
              >
                <MenuItem value="all">All</MenuItem>
                {lengths.map((len) => (
                  <MenuItem key={len} value={len}>
                    {len}
                  </MenuItem>
                ))}
              </TextField>
            </Box>
          )}

          {managementMode && filteredArticles.length > 0 && (
            <Box sx={{ mb: 2, display: 'flex', flexDirection: { xs: 'column', sm: 'row' }, gap: 1, alignItems: 'stretch' }}>
              <Button
                variant="outlined"
                startIcon={<SelectAll />}
                onClick={selectAllArticles}
                size="small"
                fullWidth={true}
                sx={{ width: { xs: '100%', sm: 'auto' } }}
              >
                {selectedArticles.size === articles.length ? '전체 해제' : '전체 선택'}
              </Button>
              <Button
                variant="contained"
                color="error"
                startIcon={<DeleteSweep />}
                onClick={handleBulkDelete}
                disabled={selectedArticles.size === 0}
                size="small"
                fullWidth={true}
                sx={{ width: { xs: '100%', sm: 'auto' } }}
              >
                선택 삭제 ({selectedArticles.size})
              </Button>
            </Box>
          )}
        </>
      )}

      {currentTab === 0 && (
        <>
          {error && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {error}
            </Alert>
          )}

          {isLoading ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
              <CircularProgress />
            </Box>
          ) : articles.length === 0 ? (
            <Box sx={{ textAlign: 'center', py: 8 }}>
              <Typography variant="h6" color="text.secondary" gutterBottom>
                저장된 Article이 없습니다
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                Google Sheets에서 Article을 불러오세요
              </Typography>
              <Button
                variant="outlined"
                startIcon={<SettingsIcon />}
                onClick={handleOpenSettings}
              >
                설정하기
              </Button>
            </Box>
          ) : filteredArticles.length === 0 ? (
            <Box sx={{ textAlign: 'center', py: 8 }}>
              <Typography variant="h6" color="text.secondary" gutterBottom>
                필터 조건에 맞는 Article이 없습니다
              </Typography>
            </Box>
          ) : (
            <Box
              sx={{
                display: 'grid',
                gridTemplateColumns: {
                  xs: 'repeat(1, 1fr)',
                  sm: 'repeat(2, 1fr)',
                  md: 'repeat(3, 1fr)',
                },
                gap: 3,
              }}
            >
              {filteredArticles.map((article) => (
            <Card
              key={article.id}
              sx={{
                border: managementMode && selectedArticles.has(article.id) ? 2 : isDue(article.nextReviewDate) ? 2 : 0,
                borderColor: managementMode && selectedArticles.has(article.id) ? 'primary.main' : isDue(article.nextReviewDate) ? 'error.main' : 'transparent',
                position: 'relative',
              }}
            >
              {managementMode && (
                <IconButton
                  sx={{
                    position: 'absolute',
                    top: 8,
                    right: 8,
                    zIndex: 1,
                  }}
                  onClick={() => toggleArticleSelection(article.id)}
                >
                  {selectedArticles.has(article.id) ? (
                    <CheckBox color="primary" />
                  ) : (
                    <CheckBoxOutlineBlank />
                  )}
                </IconButton>
              )}
              <CardContent>
                <Typography variant="h6" gutterBottom noWrap>
                  {article.title}
                </Typography>
                <Box sx={{ display: 'flex', gap: 1, mb: 1 }}>
                  {article.difficulty && (
                    <Chip label={article.difficulty} size="small" color="primary" variant="outlined" />
                  )}
                  {article.length && (
                    <Chip label={article.length} size="small" color="secondary" variant="outlined" />
                  )}
                </Box>
                <Typography variant="body2" color="text.secondary" noWrap>
                  {article.sentences.length}개 문장
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  최근 접근: {new Date(article.lastAccessed).toLocaleDateString()}
                </Typography>
                {article.nextReviewDate && (
                  <Box sx={{ mt: 0.5 }}>
                    <Chip
                      label={isDue(article.nextReviewDate) ? '복습 필요' : `다음 복습: ${new Date(article.nextReviewDate).toLocaleDateString()}`}
                      size="small"
                      color={isDue(article.nextReviewDate) ? 'error' : 'default'}
                      variant={isDue(article.nextReviewDate) ? 'filled' : 'outlined'}
                    />
                  </Box>
                )}
              </CardContent>
              {!managementMode && (
                <CardActions sx={{ flexWrap: 'wrap', gap: 0.5, alignItems: 'center' }}>
                  <Button
                    size="small"
                    color="primary"
                    onClick={() => handleLearnArticle(article.id)}
                  >
                    학습하기
                  </Button>
                  <Button
                    size="small"
                    variant="outlined"
                    onClick={() => cycleReviewInterval('article', article.id)}
                  >
                    {article.reviewInterval || 0}일
                  </Button>
                  <Button
                    size="small"
                    color="success"
                    startIcon={<DoneAllIcon />}
                    onClick={() => markReviewDone('article', article.id)}
                  >
                    완료
                  </Button>
                  <IconButton
                    size="small"
                    color="error"
                    onClick={() => handleDeleteArticle(article.id)}
                  >
                    <DeleteIcon fontSize="small" />
                  </IconButton>
                </CardActions>
              )}
            </Card>
              ))}
            </Box>
          )}
        </>
      )}

      {currentTab === 1 && (
        <>
          {audioArticles.length === 0 ? (
            <Box sx={{ textAlign: 'center', py: 8 }}>
              <Typography variant="h6" color="text.secondary" gutterBottom>
                Audio Article이 없습니다
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                MP3 + sentences.json을 업로드하세요
              </Typography>
              <Button
                variant="outlined"
                startIcon={<UploadIcon />}
                onClick={() => setUploadDialogOpen(true)}
              >
                업로드
              </Button>
            </Box>
          ) : (
            <Box
              sx={{
                display: 'grid',
                gridTemplateColumns: {
                  xs: 'repeat(1, 1fr)',
                  sm: 'repeat(2, 1fr)',
                  md: 'repeat(3, 1fr)',
                },
                gap: 3,
              }}
            >
              {[...audioArticles].sort((a, b) => {
                const aDue = isDue(a.nextReviewDate) ? 0 : 1;
                const bDue = isDue(b.nextReviewDate) ? 0 : 1;
                if (aDue !== bDue) return aDue - bDue;
                return new Date(b.lastAccessed).getTime() - new Date(a.lastAccessed).getTime();
              }).map((aa) => (
                <Card
                  key={aa.id}
                  sx={{
                    border: isDue(aa.nextReviewDate) ? 2 : 0,
                    borderColor: isDue(aa.nextReviewDate) ? 'error.main' : 'transparent',
                  }}
                >
                  <CardContent>
                    <Typography variant="h6" gutterBottom noWrap>
                      {aa.title}
                    </Typography>
                    <Chip label="Audio" size="small" color="info" variant="outlined" sx={{ mr: 1 }} />
                    <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                      {aa.sentences.length}개 문장
                    </Typography>
                    {aa.source && (
                      <Typography variant="caption" color="text.secondary" display="block">
                        {aa.source}
                      </Typography>
                    )}
                    <Typography variant="caption" color="text.secondary">
                      최근 접근: {new Date(aa.lastAccessed).toLocaleDateString()}
                    </Typography>
                    {aa.nextReviewDate && (
                      <Box sx={{ mt: 0.5 }}>
                        <Chip
                          label={isDue(aa.nextReviewDate) ? '복습 필요' : `다음 복습: ${new Date(aa.nextReviewDate).toLocaleDateString()}`}
                          size="small"
                          color={isDue(aa.nextReviewDate) ? 'error' : 'default'}
                          variant={isDue(aa.nextReviewDate) ? 'filled' : 'outlined'}
                        />
                      </Box>
                    )}
                  </CardContent>
                  <CardActions sx={{ flexWrap: 'wrap', gap: 0.5 }}>
                    <Button
                      size="small"
                      color="primary"
                      onClick={() => handleLearnAudioArticle(aa.id)}
                    >
                      학습하기
                    </Button>
                    <Button
                      size="small"
                      variant="outlined"
                      onClick={() => cycleReviewInterval('audio', aa.id)}
                    >
                      {aa.reviewInterval || 0}일
                    </Button>
                    <Button
                      size="small"
                      color="success"
                      startIcon={<DoneAllIcon />}
                      onClick={() => markReviewDone('audio', aa.id)}
                    >
                      완료
                    </Button>
                    <Button
                      size="small"
                      color="secondary"
                      startIcon={<EditIcon />}
                      onClick={() => navigate(`/edit-timestamps/${aa.id}`)}
                    >
                      편집
                    </Button>
                    <IconButton
                      size="small"
                      color="error"
                      onClick={() => handleDeleteAudioArticle(aa.id)}
                    >
                      <DeleteIcon fontSize="small" />
                    </IconButton>
                  </CardActions>
                  {/* SubDecks for this audio article */}
                  {subDecks.filter(sd => sd.parentId === aa.id).length > 0 && (
                    <Box sx={{ px: 2, pb: 1 }}>
                      <Typography variant="caption" color="text.secondary" sx={{ mb: 0.5, display: 'block' }}>
                        Sub-Decks:
                      </Typography>
                      {subDecks
                        .filter(sd => sd.parentId === aa.id)
                        .sort((a, b) => a.startIndex - b.startIndex)
                        .map(sd => (
                          <Box key={sd.id} sx={{
                            display: 'flex', alignItems: 'center', gap: 0.5, mb: 0.5,
                            border: isDue(sd.nextReviewDate) ? '1px solid' : '1px solid transparent',
                            borderColor: isDue(sd.nextReviewDate) ? 'error.main' : 'divider',
                            borderRadius: 1, px: 1, py: 0.3,
                          }}>
                            <Typography variant="caption" sx={{ flex: 1 }}>
                              {sd.title} ({sd.startIndex + 1}–{sd.endIndex})
                            </Typography>
                            <Button size="small" onClick={() => navigate(`/learn-audio/${aa.id}?start=${sd.startIndex}&end=${sd.endIndex}`)}>
                              학습
                            </Button>
                            <Button size="small" variant="outlined" onClick={() => cycleReviewInterval('subdeck', sd.id)}>
                              {sd.reviewInterval || 0}일
                            </Button>
                            <Button size="small" color="success" onClick={() => markReviewDone('subdeck', sd.id)}>
                              완료
                            </Button>
                            <IconButton size="small" color="error" onClick={() => deleteSubDeck(sd.id)}>
                              <DeleteIcon sx={{ fontSize: 14 }} />
                            </IconButton>
                          </Box>
                        ))}
                    </Box>
                  )}
                </Card>
              ))}
            </Box>
          )}
        </>
      )}

      {currentTab === 2 && (
        <>
          {savedManagementMode && savedSentences.length > 0 && (
            <Box sx={{ mb: 2, display: 'flex', flexDirection: { xs: 'column', sm: 'row' }, gap: 1, alignItems: 'stretch' }}>
              <Button
                variant="outlined"
                startIcon={<SelectAll />}
                onClick={selectAllSentences}
                size="small"
                fullWidth={true}
                sx={{ width: { xs: '100%', sm: 'auto' } }}
              >
                {selectedSentences.size === savedSentences.length ? '전체 해제' : '전체 선택'}
              </Button>
              <Button
                variant="contained"
                color="error"
                startIcon={<DeleteSweep />}
                onClick={handleBulkDeleteSentences}
                disabled={selectedSentences.size === 0}
                size="small"
                fullWidth={true}
                sx={{ width: { xs: '100%', sm: 'auto' } }}
              >
                선택 삭제 ({selectedSentences.size})
              </Button>
            </Box>
          )}

          {loadingSaved ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
              <CircularProgress />
            </Box>
          ) : savedSentences.length === 0 ? (
            <Box sx={{ textAlign: 'center', py: 8 }}>
              <Typography variant="h6" color="text.secondary" gutterBottom>
                저장된 문장이 없습니다
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                단일 모드에서 문장을 저장해보세요
              </Typography>
            </Box>
          ) : (
            <Box
              sx={{
                display: 'grid',
                gridTemplateColumns: {
                  xs: 'repeat(1, 1fr)',
                  md: 'repeat(2, 1fr)',
                },
                gap: 3,
              }}
            >
              {savedSentences.map((sentence) => (
                <Card
                  key={sentence.id}
                  sx={{
                    border: savedManagementMode && selectedSentences.has(sentence.id) ? 2 : 0,
                    borderColor: 'primary.main',
                    position: 'relative',
                  }}
                >
                  {savedManagementMode && (
                    <IconButton
                      sx={{
                        position: 'absolute',
                        top: 8,
                        right: 8,
                        zIndex: 1,
                      }}
                      onClick={() => toggleSentenceSelection(sentence.id)}
                    >
                      {selectedSentences.has(sentence.id) ? (
                        <CheckBox color="primary" />
                      ) : (
                        <CheckBoxOutlineBlank />
                      )}
                    </IconButton>
                  )}
                  <CardContent>
                    <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                      {sentence.articleTitle} - 문장 {sentence.sentenceIndex}
                    </Typography>
                    <Typography variant="body1" sx={{ my: 2 }}>
                      {sentence.text}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      저장: {new Date(sentence.savedAt).toLocaleDateString()}
                    </Typography>
                  </CardContent>
                  {!savedManagementMode && (
                    <CardActions>
                      <Button
                        size="small"
                        color="primary"
                        startIcon={<PlayArrow />}
                        onClick={() => handleGoToArticle(sentence.articleId, sentence.sentenceIndex)}
                      >
                        원본 보기
                      </Button>
                      <IconButton
                        size="small"
                        color="error"
                        onClick={() => handleDeleteSavedSentence(sentence.id)}
                      >
                        <DeleteIcon fontSize="small" />
                      </IconButton>
                    </CardActions>
                  )}
                </Card>
              ))}
            </Box>
          )}
        </>
      )}

      {/* Fetch Mode Selection Dialog */}
      <Dialog
        open={fetchModeDialogOpen}
        onClose={() => setFetchModeDialogOpen(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>불러오기 모드 선택</DialogTitle>
        <DialogContent>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 2 }}>
            <Button
              variant="outlined"
              onClick={() => {
                setFetchModeDialogOpen(false);
                handleFetchArticles('full-refresh');
              }}
              fullWidth
            >
              <Box sx={{ textAlign: 'left', width: '100%' }}>
                <Typography variant="subtitle1">Full Refresh</Typography>
                <Typography variant="body2" color="text.secondary">
                  기존 데이터를 모두 삭제하고 새로 불러옵니다
                </Typography>
              </Box>
            </Button>
            <Button
              variant="outlined"
              onClick={() => {
                setFetchModeDialogOpen(false);
                handleFetchArticles('upsert');
              }}
              fullWidth
            >
              <Box sx={{ textAlign: 'left', width: '100%' }}>
                <Typography variant="subtitle1">Upsert</Typography>
                <Typography variant="body2" color="text.secondary">
                  탭명+No가 동일하면 업데이트, 없으면 추가합니다
                </Typography>
              </Box>
            </Button>
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setFetchModeDialogOpen(false)}>취소</Button>
        </DialogActions>
      </Dialog>

      {/* (TTS dialog removed — merged into unified settings) */}

      {/* Audio Upload 다이얼로그 */}
      <Dialog
        open={uploadDialogOpen}
        onClose={() => setUploadDialogOpen(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>Audio Article 업로드</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2, mt: 1 }}>
            yt2csv로 생성한 _full.mp3 + sentences.json을 업로드합니다.
          </Typography>
          <TextField
            fullWidth
            label="제목"
            value={uploadTitle}
            onChange={(e) => setUploadTitle(e.target.value)}
            margin="normal"
            placeholder="예: Statistical Rethinking Lecture B01"
            autoFocus
          />
          <TextField
            fullWidth
            label="출처 (선택)"
            value={uploadSource}
            onChange={(e) => setUploadSource(e.target.value)}
            margin="normal"
            placeholder="예: https://youtube.com/watch?v=..."
          />
          <Box sx={{ mt: 2 }}>
            <Button
              variant="outlined"
              component="label"
              fullWidth
              sx={{ mb: 1, justifyContent: 'flex-start' }}
            >
              {uploadMp3File ? `MP3: ${uploadMp3File.name}` : 'MP3 파일 선택'}
              <input
                type="file"
                accept=".mp3,audio/mpeg"
                hidden
                onChange={(e) => setUploadMp3File(e.target.files?.[0] || null)}
              />
            </Button>
            <Button
              variant="outlined"
              component="label"
              fullWidth
              sx={{ justifyContent: 'flex-start' }}
            >
              {uploadJsonFile ? `JSON: ${uploadJsonFile.name}` : 'sentences.json 선택'}
              <input
                type="file"
                accept=".json,application/json"
                hidden
                onChange={(e) => setUploadJsonFile(e.target.files?.[0] || null)}
              />
            </Button>
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setUploadDialogOpen(false)}>취소</Button>
          <Button
            onClick={handleUploadAudioArticle}
            variant="contained"
            disabled={!uploadMp3File || !uploadJsonFile || !uploadTitle.trim() || isLoading}
          >
            업로드
          </Button>
        </DialogActions>
      </Dialog>

      {/* 통합 설정 다이얼로그 */}
      <Dialog
        open={settingsDialogOpen}
        onClose={() => setSettingsDialogOpen(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>설정</DialogTitle>
        <DialogContent>
          {/* Google Cloud TTS */}
          <Typography variant="subtitle2" sx={{ mt: 1, mb: 1 }}>Google Cloud TTS</Typography>
          <TextField
            fullWidth
            label="TTS API 키"
            type="password"
            value={ttsApiKey}
            onChange={(e) => setTtsApiKey(e.target.value)}
            placeholder="Google Cloud API 키"
            size="small"
            helperText="Text 탭 음성 재생용"
          />

          {/* Google Drive Sync */}
          <Typography variant="subtitle2" sx={{ mt: 3, mb: 1 }}>Google Drive 동기화</Typography>
          <TextField
            fullWidth
            label="Drive 폴더명"
            value={driveFolderName}
            onChange={(e) => setDriveFolderName(e.target.value)}
            size="small"
            helperText="내 Drive에 생성될 동기화 폴더"
          />

          {/* Google Sheets */}
          <Typography variant="subtitle2" sx={{ mt: 3, mb: 1 }}>Google Sheets</Typography>
          <TextField
            fullWidth
            label="Spreadsheet ID"
            value={spreadsheetId}
            onChange={(e) => setSpreadsheetId(e.target.value)}
            margin="dense"
            helperText="스프레드시트 URL에서 /d/ 뒤의 ID"
            placeholder="1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms"
            size="small"
          />
          <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-start', mt: 1 }}>
            <TextField
              fullWidth
              label="Range"
              value={range}
              onChange={(e) => setRange(e.target.value)}
              placeholder="Sheet1!A:E"
              helperText="탭 선택 후 자동 입력되거나 직접 입력"
              size="small"
              select={sheetTabs.length > 0}
            >
              {sheetTabs.map((tab) => (
                <MenuItem key={tab} value={`${tab}!A:E`} onClick={() => setRange(`${tab}!A:E`)}>
                  {tab}
                </MenuItem>
              ))}
            </TextField>
            <Button
              variant="outlined"
              size="small"
              onClick={handleFetchSheetTabs}
              disabled={!spreadsheetId.trim() || !accessToken}
              sx={{ mt: 0.5, whiteSpace: 'nowrap' }}
            >
              탭 불러오기
            </Button>
          </Box>
          <FormControlLabel
            control={
              <Checkbox
                checked={hasHeader}
                onChange={(e) => setHasHeader(e.target.checked)}
              />
            }
            label="첫 번째 행이 헤더입니다"
            sx={{ mt: 1 }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setSettingsDialogOpen(false)}>취소</Button>
          <Button onClick={handleSaveAllSettings} variant="contained">
            저장
          </Button>
        </DialogActions>
      </Dialog>

    </Container>
  );
};

export default HomeScreen;
