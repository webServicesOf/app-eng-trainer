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
} from '@mui/icons-material';
import { useGoogleLogin } from '@react-oauth/google';
import { useAppStore } from '../stores/appStore';
import { SavedSentence } from '../types';
import { localDB } from '../services/database';
import { googleCloudTtsService } from '../services/googleCloudTtsService';

export const HomeScreen: React.FC = () => {
  const navigate = useNavigate();
  const {
    articles,
    isLoading,
    error,
    googleSheetsConfig,
    isAuthenticated,
    accessToken,
    loadArticles,
    deleteArticle,
    updateLastAccessed,
    setGoogleSheetsConfig,
    loadGoogleSheetsConfig,
    setAccessToken,
    setLoading,
    setError,
    logout,
  } = useAppStore();

  const [sheetsConfigDialogOpen, setSheetsConfigDialogOpen] = useState(false);
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
  const [ttsApiKeyDialogOpen, setTtsApiKeyDialogOpen] = useState(false);
  const [ttsApiKey, setTtsApiKey] = useState('');

  const login = useGoogleLogin({
    onSuccess: (tokenResponse) => {
      setAccessToken(tokenResponse.access_token);
    },
    onError: () => {
      console.error('Login Failed');
    },
    scope: 'https://www.googleapis.com/auth/spreadsheets.readonly',
  });

  useEffect(() => {
    loadGoogleSheetsConfig();
    loadArticles();

    // Google Cloud TTS API 키 로드
    const savedKey = localStorage.getItem('google_cloud_tts_api_key');
    if (savedKey) {
      setTtsApiKey(savedKey);
    }
  }, [loadArticles, loadGoogleSheetsConfig]);

  useEffect(() => {
    if (currentTab === 1) {
      loadSavedSentences();
    }
  }, [currentTab]);

  const handleSaveTtsApiKey = () => {
    if (ttsApiKey.trim()) {
      googleCloudTtsService.setApiKey(ttsApiKey);
      localStorage.setItem('google_cloud_tts_api_key', ttsApiKey);
      setTtsApiKeyDialogOpen(false);
      alert('Google Cloud TTS API 키가 저장되었습니다!');
    } else {
      alert('API 키를 입력해주세요.');
    }
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

  // Filter articles based on difficulty and length
  const filteredArticles = React.useMemo(() => {
    return articles.filter((article) => {
      const difficultyMatch = difficultyFilter === 'all' || article.difficulty === difficultyFilter;
      const lengthMatch = lengthFilter === 'all' || article.length === lengthFilter;
      return difficultyMatch && lengthMatch;
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

  const handleSaveSheetsConfig = () => {
    if (spreadsheetId && range) {
      setGoogleSheetsConfig({ spreadsheetId, range, hasHeader });
      setSheetsConfigDialogOpen(false);
    }
  };

  const handleFetchArticles = async (mode: 'full-refresh' | 'upsert') => {
    if (!isAuthenticated) {
      login();
      return;
    }
    if (!googleSheetsConfig) {
      setSheetsConfigDialogOpen(true);
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
    setSheetsConfigDialogOpen(true);
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
    if (newValue === 0) {
      setSavedManagementMode(false);
      setSelectedSentences(new Set());
    } else {
      setManagementMode(false);
      setSelectedArticles(new Set());
    }
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
          <IconButton
            color="primary"
            onClick={() => setTtsApiKeyDialogOpen(true)}
            title="Google Cloud TTS API 키 설정"
          >
            <SettingsIcon />
          </IconButton>
          <IconButton
            color="primary"
            onClick={handleOpenSettings}
            title="Google Sheets 설정"
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
        <Tab label="Main" />
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
                border: managementMode && selectedArticles.has(article.id) ? 2 : 0,
                borderColor: 'primary.main',
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
              </CardContent>
              {!managementMode && (
                <CardActions>
                  <Button
                    size="small"
                    color="primary"
                    onClick={() => handleLearnArticle(article.id)}
                  >
                    학습하기
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

      {/* Google Cloud TTS API 키 설정 다이얼로그 */}
      <Dialog
        open={ttsApiKeyDialogOpen}
        onClose={() => setTtsApiKeyDialogOpen(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>Google Cloud TTS API 키 설정</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2, mt: 2 }}>
            Google Cloud Text-to-Speech API 키를 입력해주세요.
          </Typography>
          <TextField
            fullWidth
            label="API 키"
            type="password"
            value={ttsApiKey}
            onChange={(e) => setTtsApiKey(e.target.value)}
            placeholder="Google Cloud API 키"
            variant="outlined"
            size="small"
            helperText="API 키는 localStorage에 안전하게 저장됩니다"
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setTtsApiKeyDialogOpen(false)}>취소</Button>
          <Button onClick={handleSaveTtsApiKey} variant="contained">
            저장
          </Button>
        </DialogActions>
      </Dialog>

      {/* Google Sheets 설정 다이얼로그 */}
      <Dialog
        open={sheetsConfigDialogOpen}
        onClose={() => setSheetsConfigDialogOpen(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>Google Sheets 설정</DialogTitle>
        <DialogContent>
          <Alert severity="info" sx={{ mb: 2 }}>
            <Typography variant="body2" gutterBottom>
              <strong>Google 계정으로 로그인하면 개인 스프레드시트에 접근할 수 있습니다</strong>
            </Typography>
            <Typography variant="body2">
              스프레드시트를 공개로 설정할 필요가 없습니다.
            </Typography>
          </Alert>
          <TextField
            fullWidth
            label="Spreadsheet ID"
            value={spreadsheetId}
            onChange={(e) => setSpreadsheetId(e.target.value)}
            margin="normal"
            helperText="스프레드시트 URL에서 /d/ 뒤의 ID"
            placeholder="예: 1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms"
            autoFocus
          />
          <TextField
            fullWidth
            label="Range"
            value={range}
            onChange={(e) => setRange(e.target.value)}
            margin="normal"
            placeholder="Sheet1!A:E"
            helperText="예: Sheet1!A:E (A=No, B=Topic, C=Content, D=Difficulty, E=Length)"
          />
          <FormControlLabel
            control={
              <Checkbox
                checked={hasHeader}
                onChange={(e) => setHasHeader(e.target.checked)}
              />
            }
            label="첫 번째 행이 헤더입니다"
            sx={{ mt: 2 }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setSheetsConfigDialogOpen(false)}>취소</Button>
          <Button onClick={handleSaveSheetsConfig} variant="contained" disabled={!spreadsheetId || !range}>
            저장
          </Button>
        </DialogActions>
      </Dialog>
    </Container>
  );
};

export default HomeScreen;
