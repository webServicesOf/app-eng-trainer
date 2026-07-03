import React, { useEffect, useState, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box,
  Container,
  Typography,
  Button,
  Card,
  CardContent,
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
  List,
  ListItem,
  ListItemButton,
  ListItemText,
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
  Upload as UploadIcon,

  DoneAll as DoneAllIcon,
  Save as SaveIcon,
  Bookmark,
  BookmarkBorder,
  Link as LinkIcon,
  DriveFileRenameOutline as RenameIcon,
} from '@mui/icons-material';
import { useGoogleLogin } from '@react-oauth/google';
import { useAppStore } from '../stores/appStore';
import { SavedSentence, AudioArticle, SentenceEntry } from '../types';
import { localDB } from '../services/database';
import { googleCloudTtsService } from '../services/googleCloudTtsService';
import { GoogleDriveService } from '../services/googleDriveService';

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
    dirtyAudioIds,
    pendingDeleteIds,
    saveDirtyArticles,
    updateSavedSentenceIndices,
    toggleSavedDeck,
  } = useAppStore();

  const [spreadsheetId, setSpreadsheetId] = useState('');
  const [range, setRange] = useState('Sheet1!A:E');
  const [hasHeader, setHasHeader] = useState(true);
  const [managementMode, setManagementMode] = useState(false);
  const [selectedArticles, setSelectedArticles] = useState<Set<string>>(new Set());
  const [currentTab, setCurrentTab] = useState(0);
  const [sortBy, setSortBy] = useState<'review' | 'name'>('review');
  const [savedSentences, setSavedSentences] = useState<SavedSentence[]>([]);
  // Derive saved deck IDs from Drive SSOT (audioArticles + subDeckReviews)
  const savedDeckIds = React.useMemo(() => {
    const ids = new Set<string>();
    audioArticles.forEach(aa => {
      if (aa.savedAsDeck) ids.add(aa.id);
      (aa.subDeckReviews || []).forEach(r => {
        if (r.saved) {
          const sd = subDecks.find(s => s.parentId === aa.id && s.startIndex === r.startIndex && s.endIndex === r.endIndex);
          if (sd) ids.add(sd.id);
        }
      });
    });
    return ids;
  }, [audioArticles, subDecks]);
  const [loadingSaved, setLoadingSaved] = useState(false);
  const [pendingUnsaveSentences, setPendingUnsaveSentences] = useState<Set<string>>(new Set());
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
  // Batch upload state
  const [batchFolders, setBatchFolders] = useState<{ name: string; mp3: File; json: File; skip: boolean }[]>([]);
  const [batchMode, setBatchMode] = useState(false);
  const [batchProgress, setBatchProgress] = useState('');
  const [editingTitleId, setEditingTitleId] = useState<string | null>(null);
  const [editingTitleValue, setEditingTitleValue] = useState('');
  const [editSourceId, setEditSourceId] = useState<string | null>(null);
  const [editSourceValue, setEditSourceValue] = useState('');

  const tokenRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const scheduleTokenRefresh = useCallback((expiresIn: number) => {
    if (tokenRefreshTimerRef.current) clearTimeout(tokenRefreshTimerRef.current);
    // Refresh 5 minutes before expiry
    const refreshMs = Math.max((expiresIn - 300) * 1000, 60000);
    tokenRefreshTimerRef.current = setTimeout(() => {
      console.log('[auth] auto-refreshing token...');
      login();
    }, refreshMs);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const login = useGoogleLogin({
    onSuccess: async (tokenResponse) => {
      setAccessToken(tokenResponse.access_token, tokenResponse.expires_in);
      scheduleTokenRefresh(tokenResponse.expires_in);
      // Reload Drive-backed data after login
      await loadAudioArticles();
      await loadSubDecks();
    },
    onError: () => {
      console.error('Login Failed');
    },
    scope: 'https://www.googleapis.com/auth/spreadsheets.readonly https://www.googleapis.com/auth/drive.file',
  });

  // On mount: schedule refresh for existing token
  useEffect(() => {
    const expiry = localDB.getTokenExpiryMs();
    if (expiry && isAuthenticated) {
      const remainingSec = Math.floor((expiry - Date.now()) / 1000);
      if (remainingSec > 0) {
        scheduleTokenRefresh(remainingSec);
      } else {
        // Token expired, trigger re-login
        login();
      }
    }
    return () => { if (tokenRefreshTimerRef.current) clearTimeout(tokenRefreshTimerRef.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated]);

  useEffect(() => {
    loadGoogleSheetsConfig();
    loadArticles();
    // Audio articles loaded after token check below

    // Load saved settings
    const savedKey = localStorage.getItem('google_cloud_tts_api_key');
    if (savedKey) setTtsApiKey(savedKey);
    const savedFolder = localStorage.getItem('drive_folder_name');
    if (savedFolder) setDriveFolderName(savedFolder);
  }, [loadArticles, loadGoogleSheetsConfig]);

  // Load Drive-backed data + settings when authenticated
  useEffect(() => {
    if (!isAuthenticated || !accessToken) return;
    const init = async () => {
      // Load settings from Drive
      try {
        const drive = new GoogleDriveService(accessToken);
        const settings = await drive.loadSettings();
        if (settings) {
          if (settings.spreadsheetId) {
            setSpreadsheetId(settings.spreadsheetId);
            setRange(settings.range || 'Sheet1!A:E');
            setHasHeader(settings.hasHeader !== undefined ? settings.hasHeader : true);
            setGoogleSheetsConfig({
              spreadsheetId: settings.spreadsheetId,
              range: settings.range || 'Sheet1!A:E',
              hasHeader: settings.hasHeader !== undefined ? settings.hasHeader : true,
            });
          }
          if (settings.driveFolderName) {
            setDriveFolderName(settings.driveFolderName);
            localStorage.setItem('drive_folder_name', settings.driveFolderName);
          }
        }
      } catch { /* ignore settings load failure */ }
      // Load audio articles + subdecks
      await loadAudioArticles();
      await loadSubDecks();
    };
    init();
  }, [isAuthenticated, accessToken]); // eslint-disable-line react-hooks/exhaustive-deps


  useEffect(() => {
    if (currentTab === 2) {
      loadSavedSentences();
    }
  }, [currentTab]);

  const handleSaveAllSettings = async () => {
    // TTS API key (local only — sensitive)
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
    // Sync non-sensitive settings to Drive
    if (accessToken) {
      const drive = new GoogleDriveService(accessToken);
      drive.saveSettings({
        spreadsheetId,
        range,
        hasHeader,
        driveFolderName: driveFolderName.trim() || 'eng-trainer',
      }).catch(() => {});
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

  const handleRenameAudioArticle = async (id: string, newTitle: string) => {
    if (!newTitle.trim()) return;
    const aa = audioArticles.find(a => a.id === id);
    if (!aa) return;
    const trimmed = newTitle.trim();
    if (aa.kind === 'loaded') {
      // FullArticle — safe to save full JSON
      await saveAudioArticle({ ...aa, title: trimmed, lastAccessed: new Date() } as AudioArticle);
    } else {
      // SummaryArticle — index-only update via Drive, never write empty sentences
      if (accessToken) {
        const drive = new GoogleDriveService(accessToken);
        const summaries = await drive.loadIndex();
        if (summaries) {
          const idx = summaries.findIndex(s => s.id === id);
          if (idx >= 0) {
            summaries[idx] = { ...summaries[idx], title: trimmed, lastAccessed: new Date().toISOString() };
            await drive.saveIndex(summaries);
          }
        }
      }
      await loadAudioArticles();
    }
    // Update SubDeck titles
    const subs = await localDB.getSubDecksByParent(id);
    for (const sd of subs) {
      const partMatch = sd.title.match(/Part \d+$/);
      const partSuffix = partMatch ? partMatch[0] : `${sd.startIndex}-${sd.endIndex}`;
      await localDB.saveSubDeck({ ...sd, title: `${trimmed} ${partSuffix}` });
    }
    await loadSubDecks();
    setEditingTitleId(null);
  };

  /** Upload a single article from mp3 + json + title */
  const uploadSingleArticle = async (mp3: File, json: File, title: string, source?: string) => {
    const jsonText = await json.text();
    const parsed = JSON.parse(jsonText);
    // Support both array format and object format {source, sentences}
    const rawSentences = Array.isArray(parsed) ? parsed : parsed.sentences;
    const jsonSource = Array.isArray(parsed) ? undefined : parsed.source;
    const sentences: SentenceEntry[] = rawSentences.map((s: any, i: number) => ({
      index: s.index ?? i + 1,
      text: s.text,
      start: s.start ?? 0,
      end: s.end ?? 0,
      words: s.words,
      memo: s.memo,
    }));

    const audioBlob = new Blob([await mp3.arrayBuffer()], { type: 'audio/mpeg' });

    const audioArticle: AudioArticle = {
      id: `audio-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      title,
      audioBlob,
      sentences,
      source: source || jsonSource || undefined,
      nextReviewDate: null,
      reviewInterval: 0,
      createdAt: new Date(),
      lastAccessed: new Date(),
    };

    await saveAudioArticle(audioArticle);
  };

  const handleUploadAudioArticle = async () => {
    if (!uploadMp3File || !uploadJsonFile || !uploadTitle.trim()) {
      alert('제목, MP3, sentences.json 모두 필요합니다. 로컬에서 yt2mp3 실행 후 업로드하세요.');
      return;
    }

    try {
      setLoading(true);
      await uploadSingleArticle(uploadMp3File, uploadJsonFile, uploadTitle.trim(), uploadSource.trim());

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

  const handleBatchUpload = async () => {
    const toUpload = batchFolders.filter(f => !f.skip);
    if (toUpload.length === 0) return;

    try {
      setLoading(true);
      let uploaded = 0;
      let failed = 0;
      for (const folder of toUpload) {
        try {
          setBatchProgress(`${uploaded + 1}/${toUpload.length}: ${folder.name}`);
          await uploadSingleArticle(folder.mp3, folder.json, folder.name);
          uploaded++;
        } catch (e) {
          console.error(`Failed to upload ${folder.name}:`, e);
          failed++;
        }
      }
      const skipped = batchFolders.filter(f => f.skip).length;
      alert(`완료: ${uploaded}개 업로드${skipped ? `, ${skipped}개 스킵 (이미 존재)` : ''}${failed ? `, ${failed}개 실패` : ''}`);

      setBatchFolders([]);
      setBatchMode(false);
      setBatchProgress('');
      setUploadDialogOpen(false);
    } catch (error) {
      console.error('Batch upload failed:', error);
      alert('배치 업로드 실패: ' + (error instanceof Error ? error.message : 'Unknown error'));
    } finally {
      setLoading(false);
      setBatchProgress('');
    }
  };


  const handleDeleteAudioArticle = async (id: string) => {
    await deleteAudioArticle(id); // toggles pending delete
  };

  const handleLearnAudioArticle = async (id: string) => {
    const aa = audioArticles.find(a => a.id === id);
    // Update lastAccessed — index-only for summary, full save for loaded
    if (aa) {
      if (aa.kind === 'loaded') {
        saveAudioArticle({ ...aa, lastAccessed: new Date() } as AudioArticle).catch(() => {});
      } else if (accessToken) {
        // SummaryArticle — update index.json only, never write empty sentences to Drive
        const drive = new GoogleDriveService(accessToken);
        const summaries = await drive.loadIndex();
        if (summaries) {
          const idx = summaries.findIndex(s => s.id === id);
          if (idx >= 0) {
            summaries[idx] = { ...summaries[idx], lastAccessed: new Date().toISOString() };
            drive.saveIndex(summaries).catch(() => {});
          }
        }
      }
    }
    navigate(`/learn-audio/${id}`);
  };

  const loadSavedSentences = async () => {
    try {
      setLoadingSaved(true);
      const saved = await localDB.getSavedSentences();
      setSavedSentences(saved);
    } catch (error) {
      console.error('Failed to load saved:', error);
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

  const handleToggleSaveDeck = (id: string, _title: string, _sentenceCount: number, parentId?: string) => {
    toggleSavedDeck(parentId || id, parentId ? id : undefined);
  };

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

  const handleToggleSavedSentence = (sentence: SavedSentence) => {
    setPendingUnsaveSentences(prev => {
      const next = new Set(prev);
      if (next.has(sentence.id)) next.delete(sentence.id);
      else next.add(sentence.id);
      return next;
    });
  };

  const applyPendingUnsaveSentences = async () => {
    if (pendingUnsaveSentences.size === 0) return;
    const toRemove = savedSentences.filter(s => pendingUnsaveSentences.has(s.id));
    const byArticle = new Map<string, number[]>();
    for (const s of toRemove) {
      if (!byArticle.has(s.articleId)) byArticle.set(s.articleId, []);
      byArticle.get(s.articleId)!.push(s.sentenceIndex);
    }
    for (const id of Array.from(pendingUnsaveSentences)) {
      await localDB.deleteSavedSentence(id);
    }
    for (const [articleId, removedIndices] of Array.from(byArticle.entries())) {
      const aa = audioArticles.find(a => a.id === articleId);
      if (aa) {
        const removeSet = new Set(removedIndices);
        const newIndices = (aa.savedSentenceIndices || []).filter(i => !removeSet.has(i));
        updateSavedSentenceIndices(articleId, newIndices);
      }
    }
    setPendingUnsaveSentences(new Set());
    await loadSavedSentences();
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
    if (window.confirm(`선택한 ${selectedSentences.size}개의 문장을 저장 해제하시겠습니까?`)) {
      // Group selected sentences by articleId for Drive sync
      const toRemove = savedSentences.filter(s => selectedSentences.has(s.id));
      const byArticle = new Map<string, number[]>();
      for (const s of toRemove) {
        if (!byArticle.has(s.articleId)) byArticle.set(s.articleId, []);
        byArticle.get(s.articleId)!.push(s.sentenceIndex);
      }
      for (const id of Array.from(selectedSentences)) {
        await localDB.deleteSavedSentence(id);
      }
      // Update Drive SSOT per article
      for (const [articleId, removedIndices] of Array.from(byArticle.entries())) {
        const aa = audioArticles.find(a => a.id === articleId);
        if (aa) {
          const removeSet = new Set(removedIndices);
          const newIndices = (aa.savedSentenceIndices || []).filter(i => !removeSet.has(i));
          updateSavedSentenceIndices(articleId, newIndices);
        }
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
          Infinite Lang Trainer
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
            <IconButton
              color="primary"
              onClick={async () => { await loadAudioArticles(); await loadSubDecks(); }}
              title="Drive에서 새로고침"
              size="small"
            >
              <RefreshIcon />
            </IconButton>
          )}
          <IconButton
            color="primary"
            onClick={handleOpenSettings}
            title="설정"
          >
            <SettingsIcon />
          </IconButton>
          {currentTab === 0 ? (
            <Box sx={{ display: 'flex', gap: 1 }}>
              <Button
                variant="contained"
                startIcon={<UploadIcon />}
                onClick={() => setUploadDialogOpen(true)}
                size="small"
              >
                MP3 업로드
              </Button>
              {(dirtyAudioIds.size > 0 || pendingDeleteIds.size > 0) && (
                <Button
                  variant="contained"
                  color="warning"
                  startIcon={<SaveIcon />}
                  onClick={saveDirtyArticles}
                  size="small"
                  disabled={isLoading}
                >
                  저장 ({dirtyAudioIds.size + pendingDeleteIds.size})
                </Button>
              )}
            </Box>
          ) : currentTab === 1 ? (
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
            <Box sx={{ display: 'flex', gap: 1 }}>
              <Button
                variant={savedManagementMode ? 'outlined' : 'contained'}
                startIcon={<EditIcon />}
                onClick={toggleSavedManagementMode}
                size="small"
              >
                {savedManagementMode ? '완료' : '관리'}
              </Button>
              {(dirtyAudioIds.size > 0 || pendingDeleteIds.size > 0 || pendingUnsaveSentences.size > 0) && (
                <Button
                  variant="contained"
                  color="warning"
                  startIcon={<SaveIcon />}
                  onClick={async () => {
                    await applyPendingUnsaveSentences();
                    await saveDirtyArticles();
                  }}
                  size="small"
                  disabled={isLoading}
                >
                  저장 ({dirtyAudioIds.size + pendingDeleteIds.size + pendingUnsaveSentences.size})
                </Button>
              )}
            </Box>
          )}
        </Box>
      </Box>

      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
        <Tabs value={currentTab} onChange={handleTabChange} sx={{ flex: 1 }}>
          <Tab label="Audio" />
          <Tab label="Text" />
          <Tab label="Saved" />
        </Tabs>
        {(currentTab === 0 || currentTab === 1) && (
          <Button
            size="small"
            variant="outlined"
            onClick={() => setSortBy(prev => prev === 'review' ? 'name' : 'review')}
            sx={{ fontSize: '0.7rem', minWidth: 0, px: 1, flexShrink: 0 }}
          >
            {sortBy === 'review' ? '복습순' : '이름순'}
          </Button>
        )}
      </Box>

      {currentTab === 1 && (
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

      {currentTab === 1 && (
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
            <List dense disablePadding>
              {[...filteredArticles].sort((a, b) => {
                if (sortBy === 'name') return a.title.localeCompare(b.title);
                const aDue = isDue(a.nextReviewDate) ? 0 : 1;
                const bDue = isDue(b.nextReviewDate) ? 0 : 1;
                if (aDue !== bDue) return aDue - bDue;
                const aDate = a.nextReviewDate ? new Date(a.nextReviewDate).getTime() : Infinity;
                const bDate = b.nextReviewDate ? new Date(b.nextReviewDate).getTime() : Infinity;
                return aDate - bDate;
              }).map((article) => (
                <ListItem
                  key={article.id}
                  disablePadding
                  sx={{
                    borderLeft: isDue(article.nextReviewDate) ? '3px solid' : '3px solid transparent',
                    borderColor: isDue(article.nextReviewDate) ? 'error.main' : 'transparent',
                    mb: 0.5,
                  }}
                >
                  {managementMode && (
                    <IconButton size="small" sx={{ p: 0.3, mr: 0.5 }} onClick={() => toggleArticleSelection(article.id)}>
                      {selectedArticles.has(article.id) ? <CheckBox color="primary" sx={{ fontSize: 16 }} /> : <CheckBoxOutlineBlank sx={{ fontSize: 16 }} />}
                    </IconButton>
                  )}
                  <ListItemButton onClick={() => handleLearnArticle(article.id)} sx={{ py: 0.5, px: 1 }}>
                    <ListItemText
                      primary={`${article.title} (${article.sentences.length})`}
                      primaryTypographyProps={{ noWrap: true, variant: 'body2' }}
                      secondary={article.nextReviewDate ? (isDue(article.nextReviewDate) ? '복습 필요' : new Date(article.nextReviewDate).toLocaleDateString()) : undefined}
                      secondaryTypographyProps={{ variant: 'caption', color: isDue(article.nextReviewDate) ? 'error' : 'text.secondary' }}
                    />
                  </ListItemButton>
                  {!managementMode && (
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0, flexShrink: 0, pr: 0.5 }}>
                      <IconButton size="small" sx={{ p: 0.3 }} onClick={() => cycleReviewInterval('article', article.id)} title={`${article.reviewInterval || 0}일`}>
                        <Typography variant="caption" sx={{ fontSize: '0.65rem', minWidth: 16, textAlign: 'center' }}>{article.reviewInterval || 0}d</Typography>
                      </IconButton>
                      <IconButton size="small" sx={{ p: 0.3 }} color="success" onClick={() => markReviewDone('article', article.id)} title="복습 완료">
                        <DoneAllIcon sx={{ fontSize: 16 }} />
                      </IconButton>
                      <IconButton size="small" sx={{ p: 0.3 }} color="error" onClick={() => handleDeleteArticle(article.id)} title="삭제">
                        <DeleteIcon sx={{ fontSize: 16 }} />
                      </IconButton>
                    </Box>
                  )}
                </ListItem>
              ))}
            </List>
          )}
        </>
      )}

      {currentTab === 0 && (
        <>
          {audioArticles.length === 0 ? (
            <Box sx={{ textAlign: 'center', py: 8 }}>
              <Typography variant="h6" color="text.secondary" gutterBottom>
                Audio Article이 없습니다
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                {isAuthenticated ? 'Drive에 데이터가 없거나 로딩 중입니다' : '로그인 후 Drive에서 불러옵니다'}
              </Typography>
            </Box>
          ) : (
            <List dense disablePadding>
              {[...audioArticles].sort((a, b) => {
                if (sortBy === 'name') return a.title.localeCompare(b.title);
                const aDue = isDue(a.nextReviewDate) ? 0 : 1;
                const bDue = isDue(b.nextReviewDate) ? 0 : 1;
                if (aDue !== bDue) return aDue - bDue;
                const aDate = a.nextReviewDate ? new Date(a.nextReviewDate).getTime() : Infinity;
                const bDate = b.nextReviewDate ? new Date(b.nextReviewDate).getTime() : Infinity;
                return aDate - bDate;
              }).map((aa) => (
                <React.Fragment key={aa.id}>
                  <ListItem
                    disablePadding
                    sx={{
                      borderLeft: isDue(aa.nextReviewDate) && !pendingDeleteIds.has(aa.id) ? '3px solid' : '3px solid transparent',
                      borderColor: isDue(aa.nextReviewDate) && !pendingDeleteIds.has(aa.id) ? 'error.main' : 'transparent',
                      opacity: pendingDeleteIds.has(aa.id) ? 0.4 : 1,
                      mb: 0.5,
                    }}
                  >
                    <ListItemButton onClick={() => handleLearnAudioArticle(aa.id)} sx={{ py: 0.5, px: 1 }}>
                      {editingTitleId === aa.id ? (
                        <TextField
                          fullWidth
                          size="small"
                          value={editingTitleValue}
                          onChange={(e) => setEditingTitleValue(e.target.value)}
                          onBlur={() => handleRenameAudioArticle(aa.id, editingTitleValue)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') handleRenameAudioArticle(aa.id, editingTitleValue);
                            if (e.key === 'Escape') setEditingTitleId(null);
                          }}
                          onClick={(e) => e.stopPropagation()}
                          autoFocus
                        />
                      ) : (
                        <ListItemText
                          primary={`${aa.title} (${aa.kind === 'loaded' ? aa.sentences.length : aa.sentenceCount})`}
                          primaryTypographyProps={{ noWrap: true, variant: 'body2' }}
                          secondary={aa.nextReviewDate ? (isDue(aa.nextReviewDate) ? '복습 필요' : new Date(aa.nextReviewDate).toLocaleDateString()) : undefined}
                          secondaryTypographyProps={{ variant: 'caption', color: isDue(aa.nextReviewDate) ? 'error' : 'text.secondary' }}
                        />
                      )}
                    </ListItemButton>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0, flexShrink: 0, pr: 0.5 }}>
                      <IconButton
                        size="small" sx={{ p: 0.3 }}
                        color={savedDeckIds.has(aa.id) ? 'primary' : 'default'}
                        onClick={() => handleToggleSaveDeck(aa.id, aa.title, (aa.kind === 'loaded' ? aa.sentences.length : aa.sentenceCount))}
                        title={savedDeckIds.has(aa.id) ? '저장 해제' : '덱 저장'}
                      >
                        {savedDeckIds.has(aa.id) ? <Bookmark sx={{ fontSize: 16 }} /> : <BookmarkBorder sx={{ fontSize: 16 }} />}
                      </IconButton>
                      <IconButton size="small" sx={{ p: 0.3 }} onClick={(e) => { e.stopPropagation(); cycleReviewInterval('audio', aa.id); }} title={`${aa.reviewInterval || 0}일`}>
                        <Typography variant="caption" sx={{ fontSize: '0.65rem', minWidth: 16, textAlign: 'center' }}>{aa.reviewInterval || 0}d</Typography>
                      </IconButton>
                      <IconButton size="small" sx={{ p: 0.3 }} color="success" onClick={() => markReviewDone('audio', aa.id)} title="복습 완료">
                        <DoneAllIcon sx={{ fontSize: 16 }} />
                      </IconButton>
                      <IconButton size="small" sx={{ p: 0.3 }} color="secondary" onClick={() => navigate(`/edit-timestamps/${aa.id}`)} title="편집">
                        <EditIcon sx={{ fontSize: 16 }} />
                      </IconButton>
                      <IconButton
                        size="small" sx={{ p: 0.3 }}
                        onClick={(e) => { e.stopPropagation(); setEditingTitleId(aa.id); setEditingTitleValue(aa.title); }}
                        title="이름 변경"
                      >
                        <RenameIcon sx={{ fontSize: 16 }} />
                      </IconButton>
                      <IconButton
                        size="small" sx={{ p: 0.3 }}
                        color={aa.source ? 'info' : 'default'}
                        onClick={() => { setEditSourceId(aa.id); setEditSourceValue(aa.source || ''); }}
                        title={aa.source ? `출처: ${aa.source}` : '출처 URL 추가'}
                      >
                        <LinkIcon sx={{ fontSize: 16 }} />
                      </IconButton>
                      <IconButton size="small" sx={{ p: 0.3 }} color="error" onClick={() => handleDeleteAudioArticle(aa.id)} title="삭제">
                        <DeleteIcon sx={{ fontSize: 16 }} />
                      </IconButton>
                    </Box>
                  </ListItem>
                  {/* SubDecks */}
                  {subDecks.filter(sd => sd.parentId === aa.id).sort((a, b) => a.startIndex - b.startIndex).map(sd => (
                    <ListItem
                      key={sd.id}
                      disablePadding
                      sx={{
                        pl: 3,
                        borderLeft: isDue(sd.nextReviewDate) ? '2px solid' : '2px solid transparent',
                        borderColor: isDue(sd.nextReviewDate) ? 'error.main' : 'transparent',
                        mb: 0.25,
                      }}
                    >
                      <ListItemButton onClick={() => navigate(`/learn-audio/${aa.id}?start=${sd.startIndex}&end=${sd.endIndex}`)} sx={{ py: 0.3, px: 1 }}>
                        <ListItemText
                          primary={`${sd.title} (${sd.startIndex + 1}–${sd.endIndex})`}
                          primaryTypographyProps={{ variant: 'caption' }}
                          secondary={sd.nextReviewDate ? (isDue(sd.nextReviewDate) ? '복습 필요' : new Date(sd.nextReviewDate).toLocaleDateString()) : undefined}
                          secondaryTypographyProps={{ variant: 'caption', sx: { fontSize: '0.6rem' }, color: isDue(sd.nextReviewDate) ? 'error' : 'text.secondary' }}
                        />
                      </ListItemButton>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0, flexShrink: 0, pr: 0.5 }}>
                        <IconButton
                          size="small" sx={{ p: 0.3 }}
                          color={savedDeckIds.has(sd.id) ? 'primary' : 'default'}
                          onClick={() => handleToggleSaveDeck(sd.id, sd.title, sd.endIndex - sd.startIndex, sd.parentId)}
                        >
                          {savedDeckIds.has(sd.id) ? <Bookmark sx={{ fontSize: 14 }} /> : <BookmarkBorder sx={{ fontSize: 14 }} />}
                        </IconButton>
                        <IconButton size="small" sx={{ p: 0.3 }} onClick={() => cycleReviewInterval('subdeck', sd.id)} title={`${sd.reviewInterval || 0}일`}>
                          <Typography variant="caption" sx={{ fontSize: '0.6rem', minWidth: 14, textAlign: 'center' }}>{sd.reviewInterval || 0}d</Typography>
                        </IconButton>
                        <IconButton size="small" sx={{ p: 0.3 }} color="success" onClick={() => markReviewDone('subdeck', sd.id)} title="복습 완료">
                          <DoneAllIcon sx={{ fontSize: 14 }} />
                        </IconButton>
                        <IconButton size="small" sx={{ p: 0.3 }} color="error" onClick={() => deleteSubDeck(sd.id)} title="삭제">
                          <DeleteIcon sx={{ fontSize: 14 }} />
                        </IconButton>
                      </Box>
                    </ListItem>
                  ))}
                </React.Fragment>
              ))}
            </List>
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
          ) : (
            <>
              {/* Saved Decks — derived from Drive SSOT */}
              {(() => {
                const savedDeckItems: { id: string; title: string; sentenceCount: number; parentId?: string; reviewInterval: number; nextReviewDate: Date | null; reviewType: 'audio' | 'subdeck'; }[] = [];
                audioArticles.forEach(aa => {
                  if (aa.savedAsDeck) {
                    savedDeckItems.push({ id: aa.id, title: aa.title, sentenceCount: (aa.kind === 'loaded' ? aa.sentences.length : aa.sentenceCount), reviewInterval: aa.reviewInterval || 0, nextReviewDate: aa.nextReviewDate, reviewType: 'audio' });
                  }
                  (aa.subDeckReviews || []).forEach(r => {
                    if (!r.saved) return;
                    const sd = subDecks.find(s => s.parentId === aa.id && s.startIndex === r.startIndex && s.endIndex === r.endIndex);
                    if (sd) {
                      savedDeckItems.push({ id: sd.id, title: sd.title, sentenceCount: sd.endIndex - sd.startIndex, parentId: aa.id, reviewInterval: sd.reviewInterval || 0, nextReviewDate: sd.nextReviewDate, reviewType: 'subdeck' });
                    }
                  });
                });
                return (
                  <>
                    <Typography variant="subtitle1" sx={{ mb: 1, fontWeight: 600 }}>
                      Saved Decks ({savedDeckItems.length})
                    </Typography>
                    {savedDeckItems.length === 0 ? (
                      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
                        Audio 탭에서 덱을 저장해보세요
                      </Typography>
                    ) : (
                      <Box sx={{ mb: 3, display: 'flex', flexDirection: 'column', gap: 1 }}>
                        {savedDeckItems.map((deck) => {
                          const sd = deck.parentId ? subDecks.find(s => s.id === deck.id) : null;
                          const deckDue = isDue(deck.nextReviewDate);
                          return (
                            <Card key={deck.id} variant="outlined" sx={{
                              border: deckDue ? 2 : undefined,
                              borderColor: deckDue ? 'error.main' : undefined,
                            }}>
                              <CardContent sx={{ py: 1, '&:last-child': { pb: 1 } }}>
                                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                  <Box>
                                    <Typography variant="body2" sx={{ fontWeight: 500 }}>{deck.title}</Typography>
                                    <Typography variant="caption" color="text.secondary">
                                      {deck.sentenceCount}문장
                                      {deck.nextReviewDate && ` · 복습: ${new Date(deck.nextReviewDate).toLocaleDateString()}`}
                                    </Typography>
                                  </Box>
                                  <Box sx={{ display: 'flex', gap: 0.5, alignItems: 'center' }}>
                                    <Button size="small" color="primary" onClick={() => {
                                      if (sd) navigate(`/learn-audio/${deck.parentId}?start=${sd.startIndex}&end=${sd.endIndex}`);
                                      else navigate(`/learn-audio/${deck.id}`);
                                    }}>학습</Button>
                                    <Button size="small" variant="outlined" onClick={() => cycleReviewInterval(deck.reviewType, deck.id)}>
                                      {deck.reviewInterval}일
                                    </Button>
                                    <IconButton size="small" color="success" onClick={() => markReviewDone(deck.reviewType, deck.id)} title="복습 완료">
                                      <DoneAllIcon sx={{ fontSize: 14 }} />
                                    </IconButton>
                                    {deckDue && <Chip label="복습 필요" size="small" color="error" variant="filled" />}
                                    <IconButton size="small" color="primary" onClick={() => handleToggleSaveDeck(deck.id, deck.title, deck.sentenceCount, deck.parentId)} title="저장 해제">
                                      <Bookmark sx={{ fontSize: 16 }} />
                                    </IconButton>
                                  </Box>
                                </Box>
                              </CardContent>
                            </Card>
                          );
                        })}
                      </Box>
                    )}
                  </>
                );
              })()}

              {/* Saved Sentences — grouped by deck */}
              <Typography variant="subtitle1" sx={{ mb: 1, fontWeight: 600 }}>
                Saved Sentences ({savedSentences.length})
              </Typography>
              {savedSentences.length === 0 ? (
                <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
                  단일 모드에서 문장을 저장해보세요
                </Typography>
              ) : (
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  {(() => {
                    // Group sentences by articleTitle
                    const groups = new Map<string, SavedSentence[]>();
                    savedSentences.forEach(s => {
                      const key = s.articleTitle || s.articleId;
                      if (!groups.has(key)) groups.set(key, []);
                      groups.get(key)!.push(s);
                    });
                    return Array.from(groups.entries()).map(([title, sentences]) => {
                      const articleId = sentences[0].articleId;
                      const aa = audioArticles.find(a => a.id === articleId);
                      const sgReview = aa?.savedSentenceReview;
                      const sgDue = sgReview?.nextReviewDate ? new Date(sgReview.nextReviewDate) <= new Date() : false;
                      const sentenceIndices = sentences.map(s => s.sentenceIndex);
                      return (
                      <Card key={title} variant="outlined" sx={{
                        border: sgDue ? 2 : undefined,
                        borderColor: sgDue ? 'error.main' : undefined,
                      }}>
                        <CardContent sx={{ pb: 1 }}>
                          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1, flexWrap: 'wrap', gap: 0.5 }}>
                            <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
                              {title} ({sentences.length}문장)
                            </Typography>
                            <Box sx={{ display: 'flex', gap: 0.5, alignItems: 'center' }}>
                              <Button
                                size="small"
                                color="primary"
                                onClick={() => navigate(`/learn-audio/${articleId}?sentences=${sentenceIndices.join(',')}`)}
                              >
                                학습
                              </Button>
                              <Button size="small" variant="outlined" onClick={() => cycleReviewInterval('saved-sentences', articleId)}>
                                {sgReview?.reviewInterval || 0}일
                              </Button>
                              <IconButton size="small" color="success" onClick={() => markReviewDone('saved-sentences', articleId)} title="복습 완료">
                                <DoneAllIcon sx={{ fontSize: 16 }} />
                              </IconButton>
                              {sgReview?.nextReviewDate && (
                                <Chip
                                  label={sgDue ? '복습 필요' : `${new Date(sgReview.nextReviewDate).toLocaleDateString()}`}
                                  size="small"
                                  color={sgDue ? 'error' : 'default'}
                                  variant={sgDue ? 'filled' : 'outlined'}
                                />
                              )}
                            </Box>
                          </Box>
                          {sentences
                            .sort((a, b) => a.sentenceIndex - b.sentenceIndex)
                            .map((sentence) => (
                            <Box
                              key={sentence.id}
                              sx={{
                                display: 'flex',
                                alignItems: 'flex-start',
                                gap: 1,
                                py: 0.5,
                                borderBottom: '1px solid',
                                borderColor: 'divider',
                                '&:last-child': { borderBottom: 0 },
                                opacity: pendingUnsaveSentences.has(sentence.id) ? 0.4 : (savedManagementMode && selectedSentences.has(sentence.id) ? 1 : undefined),
                                textDecoration: pendingUnsaveSentences.has(sentence.id) ? 'line-through' : undefined,
                                bgcolor: savedManagementMode && selectedSentences.has(sentence.id) ? 'action.selected' : undefined,
                              }}
                            >
                              {savedManagementMode && (
                                <IconButton size="small" onClick={() => toggleSentenceSelection(sentence.id)} sx={{ mt: -0.5 }}>
                                  {selectedSentences.has(sentence.id) ? <CheckBox color="primary" fontSize="small" /> : <CheckBoxOutlineBlank fontSize="small" />}
                                </IconButton>
                              )}
                              <Typography variant="caption" color="text.secondary" sx={{ minWidth: 24, mt: 0.3 }}>
                                {sentence.sentenceIndex}
                              </Typography>
                              <Typography variant="body2" sx={{ flex: 1 }}>
                                {sentence.text}
                              </Typography>
                              {!savedManagementMode && (
                                <IconButton
                                  size="small"
                                  color={pendingUnsaveSentences.has(sentence.id) ? 'default' : 'primary'}
                                  onClick={() => handleToggleSavedSentence(sentence)}
                                  title={pendingUnsaveSentences.has(sentence.id) ? '저장 해제 취소' : '저장 해제'}
                                >
                                  {pendingUnsaveSentences.has(sentence.id) ? <BookmarkBorder sx={{ fontSize: 16 }} /> : <Bookmark sx={{ fontSize: 16 }} />}
                                </IconButton>
                              )}
                            </Box>
                          ))}
                        </CardContent>
                      </Card>
                    );});
                  })()}
                </Box>
              )}
            </>
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
        onClose={() => { if (!isLoading) { setUploadDialogOpen(false); setBatchMode(false); setBatchFolders([]); setBatchProgress(''); } }}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>Audio Article 업로드</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2, mt: 1 }}>
            단일 폴더 또는 여러 폴더가 들어있는 상위 폴더를 선택하세요.
          </Typography>
          <Box sx={{ mt: 1 }}>
            <Button
              variant="outlined"
              component="label"
              fullWidth
              sx={{ mb: 1, justifyContent: 'flex-start' }}
            >
              {batchMode
                ? `📁 ${batchFolders.length}개 폴더 감지`
                : uploadMp3File && uploadJsonFile
                  ? `📁 ${uploadMp3File.name} + ${uploadJsonFile.name}`
                  : uploadMp3File
                    ? `MP3: ${uploadMp3File.name} (JSON 없음)`
                    : '폴더 선택 (MP3 + sentences.json)'}
              <input
                type="file"
                hidden
                {...{ webkitdirectory: '', directory: '' } as any}
                onChange={(e) => {
                  const files = e.target.files;
                  if (!files || files.length === 0) return;

                  // Group files by subfolder
                  const groups: Record<string, { mp3?: File; json?: File }> = {};
                  for (let i = 0; i < files.length; i++) {
                    const f = files[i];
                    const parts = ((f as any).webkitRelativePath || f.name).split('/');
                    // depth 1: "folder/file" → single, depth 2+: "parent/sub/file" → batch
                    const key = parts.length >= 3 ? parts[1] : parts[0];
                    if (!groups[key]) groups[key] = {};
                    if (f.name.endsWith('.mp3')) groups[key].mp3 = f;
                    if (f.name === 'sentences.json') groups[key].json = f;
                  }

                  // Filter valid folders (have both mp3 + json)
                  const validFolders = Object.entries(groups)
                    .filter(([, g]) => g.mp3 && g.json)
                    .map(([name, g]) => ({ name, mp3: g.mp3!, json: g.json!, skip: false }));

                  if (validFolders.length === 0) {
                    alert('MP3 + sentences.json이 있는 폴더를 찾을 수 없습니다.');
                    return;
                  }

                  if (validFolders.length === 1) {
                    // Single folder mode
                    setBatchMode(false);
                    setBatchFolders([]);
                    setUploadMp3File(validFolders[0].mp3);
                    setUploadJsonFile(validFolders[0].json);
                    setUploadTitle(validFolders[0].name);
                  } else {
                    // Batch mode: mark existing titles as skip
                    const existingTitles = new Set(audioArticles.map(a => a.title));
                    const marked = validFolders.map(f => ({
                      ...f,
                      skip: existingTitles.has(f.name),
                    }));
                    setBatchMode(true);
                    setBatchFolders(marked);
                    setUploadMp3File(null);
                    setUploadJsonFile(null);
                    setUploadTitle('');
                  }
                }}
              />
            </Button>
          </Box>

          {batchMode ? (
            /* Batch mode: folder list with skip indicators */
            <Box sx={{ mt: 1 }}>
              {batchProgress && (
                <Typography variant="body2" color="primary" sx={{ mb: 1 }}>
                  {batchProgress}
                </Typography>
              )}
              <List dense sx={{ maxHeight: 300, overflow: 'auto' }}>
                {batchFolders.map((f, i) => (
                  <ListItem key={i} disablePadding>
                    <ListItemButton
                      onClick={() => {
                        setBatchFolders(prev => prev.map((ff, j) =>
                          j === i ? { ...ff, skip: !ff.skip } : ff
                        ));
                      }}
                      sx={{ opacity: f.skip ? 0.4 : 1 }}
                    >
                      <ListItemText
                        primary={f.name}
                        secondary={f.skip ? '스킵 (이미 존재)' : `${f.mp3.name} + sentences.json`}
                      />
                      {f.skip && <Chip label="스킵" size="small" color="default" />}
                    </ListItemButton>
                  </ListItem>
                ))}
              </List>
              <Typography variant="caption" color="text.secondary">
                {batchFolders.filter(f => !f.skip).length}개 업로드 예정,{' '}
                {batchFolders.filter(f => f.skip).length}개 스킵 (클릭으로 토글)
              </Typography>
            </Box>
          ) : (
            /* Single mode: title + source fields */
            <>
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
            </>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => { setUploadDialogOpen(false); setBatchMode(false); setBatchFolders([]); setBatchProgress(''); }} disabled={isLoading}>취소</Button>
          {batchMode ? (
            <Button
              onClick={handleBatchUpload}
              variant="contained"
              disabled={batchFolders.filter(f => !f.skip).length === 0 || isLoading}
            >
              {isLoading ? batchProgress || '업로드 중...' : `${batchFolders.filter(f => !f.skip).length}개 업로드`}
            </Button>
          ) : (
            <Button
              onClick={handleUploadAudioArticle}
              variant="contained"
              disabled={!uploadMp3File || !uploadJsonFile || !uploadTitle.trim() || isLoading}
            >
              업로드
            </Button>
          )}
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

      {/* Source URL Edit Dialog */}
      <Dialog open={!!editSourceId} onClose={() => setEditSourceId(null)} maxWidth="sm" fullWidth>
        <DialogTitle>출처 URL 편집</DialogTitle>
        <DialogContent>
          <TextField
            fullWidth
            label="출처 URL"
            value={editSourceValue}
            onChange={(e) => setEditSourceValue(e.target.value)}
            margin="normal"
            placeholder="https://youtube.com/watch?v=..."
            autoFocus
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEditSourceId(null)}>취소</Button>
          <Button
            variant="contained"
            onClick={() => {
              if (editSourceId) {
                useAppStore.getState().updateArticleSource(editSourceId, editSourceValue.trim());
              }
              setEditSourceId(null);
            }}
          >
            저장
          </Button>
        </DialogActions>
      </Dialog>

    </Container>
  );
};

export default HomeScreen;
