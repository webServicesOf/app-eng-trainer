import React, { useEffect, useState, useRef } from 'react';
import {
  Box,
  Paper,
  Typography,
  IconButton,
  Card,
  CardContent,
  CircularProgress,
  LinearProgress,
  Chip,
  Stack,
  Slider,
  TextField,
  useTheme,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  List,
  ListItem,
  ListItemText,
  Tooltip,
  Badge,
  Popover,
  FormControlLabel,
  Switch,
} from '@mui/material';
import {
  ArrowUpward,
  ArrowDownward,
  KeyboardArrowLeft,
  KeyboardArrowRight,
  KeyboardDoubleArrowLeft,
  KeyboardDoubleArrowRight,
  PlayArrow,
  Pause,
  OpenInNew,
  Replay,
  Home,
  Bookmark,
  BookmarkBorder,
  Visibility,
  VisibilityOff,
  VisibilityOffOutlined,
  Save,
  FormatListBulleted,
  RestoreFromTrash,
  YouTube as YouTubeIcon,
  Audiotrack,
  Settings,
  Gamepad,
} from '@mui/icons-material';
import { useParams, useNavigate } from 'react-router-dom';
import { FullArticle, StoreArticle, SentenceEntry } from '../types';
import { useLearningStore, useAppStore } from '../stores/appStore';
import { localDB } from '../services/database';
import { audioSeekService } from '../services/audioSeekService';
import { startMediaSession, setMediaPlaybackState, stopMediaSession } from '../services/mediaSession';
import { GoogleDriveService } from '../services/googleDriveService';
import YouTubePlayer from 'react-youtube';

const AudioLearningScreen: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const theme = useTheme();

  const {
    currentIndex,
    isCumulative,
    windowSize,
    setCurrentIndex,
    setIsCumulative,
    setWindowSize,
    resetLearningState,
  } = useLearningStore();

  const { dirtyAudioIds, saveDirtyArticles } = useAppStore();

  const [article, setArticle] = useState<FullArticle | null>(null);
  // Phase 4 exit resume guards
  const plainOpenRef = useRef(false);             // remap 모드(저장덱/subdeck) 제외 — 실제 index 공간일 때만 true
  const resumeRestoredRef = useRef(false);        // lastIndex 복원 1회 가드
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [subDeckRange, setSubDeckRange] = useState<{ start: number; end: number } | null>(null);
  const [displaySentences, setDisplaySentences] = useState<SentenceEntry[]>([]);
  const [activeSentenceLocalIdx, setActiveSentenceLocalIdx] = useState<number>(-1);
  const [activeWordIdx, setActiveWordIdx] = useState<number>(-1);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [playbackRate, setPlaybackRate] = useState<number>(1.0);
  const [isSaved, setIsSaved] = useState<boolean>(false);
  const [isBlindMode, setIsBlindMode] = useState<boolean>(false);
  const [audioLoaded, setAudioLoaded] = useState<boolean>(false);
  const [showHiddenList, setShowHiddenList] = useState(false);
  const [isYouTubeMode, setIsYouTubeMode] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const [windowStepMode, setWindowStepMode] = useState(false);
  const [settingsAnchorEl, setSettingsAnchorEl] = useState<HTMLElement | null>(null);

  const sentenceRefs = useRef<(HTMLDivElement | null)[]>([]);
  const activeWordRef = useRef<HTMLSpanElement | null>(null);

  const loadedArticleIdRef = React.useRef<string | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ytPlayerRef = React.useRef<any>(null);
  const ytPollingRef = React.useRef<ReturnType<typeof setInterval> | null>(null);
  const ytEndTimeRef = React.useRef<number>(0);
  const displaySentencesRef = React.useRef(displaySentences);
  React.useEffect(() => { displaySentencesRef.current = displaySentences; }, [displaySentences]);

  // Wake Lock — keep screen on during learning (joystick/keyboard control)
  React.useEffect(() => {
    let wakeLock: any = null;
    const request = async () => {
      try {
        if ('wakeLock' in navigator) {
          wakeLock = await (navigator as any).wakeLock.request('screen');
        }
      } catch { /* user denied or not supported */ }
    };
    request();
    const onVisibility = () => { if (document.visibilityState === 'visible') request(); };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      wakeLock?.release();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  // Scroll active word into view when it changes
  React.useEffect(() => {
    if (activeWordRef.current) {
      activeWordRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
    }
  }, [activeSentenceLocalIdx, activeWordIdx]);

  const loadArticle = React.useCallback(async (articleId: string, range?: { start: number; end: number }, indices?: number[]) => {
    // Guard: only load once per article ID
    if (loadedArticleIdRef.current === articleId) return;
    loadedArticleIdRef.current = articleId;

    try {
      const storeState = useAppStore.getState();
      console.log('[loadArticle] START', { articleId, storeArticleCount: storeState.audioArticles.length, hasToken: !!storeState.accessToken });

      // Read store directly (not via closure) to avoid dep on audioArticles
      let storeArticle = storeState.audioArticles.find(a => a.id === articleId);
      console.log('[loadArticle] meta from store:', storeArticle ? { id: storeArticle.id, kind: storeArticle.kind } : 'NOT FOUND');

      // Articles might still be loading from Drive — wait for them
      if (!storeArticle) {
        console.log('[loadArticle] waiting for store to populate...');
        storeArticle = await new Promise<StoreArticle | undefined>((resolve) => {
          const found = useAppStore.getState().audioArticles.find(a => a.id === articleId);
          if (found) { resolve(found); return; }
          const unsub = useAppStore.subscribe(() => {
            const found = useAppStore.getState().audioArticles.find(a => a.id === articleId);
            if (found) { unsub(); resolve(found); }
          });
          setTimeout(() => { unsub(); resolve(undefined); }, 15000);
        });
        console.log('[loadArticle] after wait:', storeArticle ? { id: storeArticle.id, kind: storeArticle.kind } : 'TIMEOUT/NOT FOUND');
        if (!storeArticle) {
          console.error('[loadArticle] BAIL: article not found after wait');
          loadedArticleIdRef.current = null;
          navigate('/');
          return;
        }
      }

      // On-demand: load full article if only summary (discriminated union check)
      let fullArticle: FullArticle | undefined;
      if (storeArticle.kind === 'loaded') {
        fullArticle = storeArticle;
      } else {
        console.log('[loadArticle] summary-only, calling loadFullArticle...');
        try {
          await useAppStore.getState().loadFullArticle(articleId);
          fullArticle = useAppStore.getState().getFullArticle(articleId);
          console.log('[loadArticle] after loadFullArticle:', fullArticle ? { sentencesLen: fullArticle.sentences.length } : 'NOT FOUND');
        } catch (e) {
          console.error('[loadArticle] loadFullArticle THREW:', e);
        }

        // Direct fallback
        if (!fullArticle) {
          console.log('[loadArticle] trying direct drive.getArticle fallback...');
          const token = useAppStore.getState().accessToken;
          if (token) {
            const drive = new GoogleDriveService(token);
            const directArticle = await drive.getArticle(articleId);
            console.log('[loadArticle] direct result:', directArticle ? { sentencesLen: directArticle.sentences.length } : 'NULL');
            if (directArticle && directArticle.sentences.length > 0) {
              fullArticle = { ...directArticle, kind: 'loaded' } as FullArticle;
            }
          } else {
            console.error('[loadArticle] no token for direct fallback');
          }
        }

        if (!fullArticle || fullArticle.sentences.length === 0) {
          console.error('[loadArticle] BAIL: no sentences after all attempts');
          loadedArticleIdRef.current = null;
          navigate('/');
          return;
        }
      }

      if (indices && indices.length > 0) {
        const indexSet = new Set(indices);
        const picked = fullArticle.sentences
          .filter((s: SentenceEntry) => indexSet.has(s.index))
          .map((s: SentenceEntry, i: number) => ({ ...s, index: i + 1 }));
        setArticle({ ...fullArticle, sentences: picked });
      } else if (range) {
        const sliced = fullArticle.sentences
          .slice(range.start, range.end)
          .map((s: SentenceEntry, i: number) => ({ ...s, index: i + 1 }));
        setArticle({ ...fullArticle, sentences: sliced });
      } else {
        setArticle(fullArticle);
      }

      // YouTube source → skip MP3 loading, use YouTube iframe
      const hasVideo = !!fullArticle.source?.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|v\/))([^?&#]+)/);
      if (hasVideo) {
        setIsYouTubeMode(true);
        setAudioLoaded(true);
      } else {
        // Get MP3: try cache first, then Drive download
        try {
          const token = useAppStore.getState().accessToken;
          let audioBlob = await localDB.getCachedMp3(articleId);
          if (!audioBlob && token) {
            const drive = new GoogleDriveService(token);
            audioBlob = (await drive.downloadMp3(articleId)) || undefined;
            if (audioBlob) {
              await localDB.cacheMp3(articleId, audioBlob);
            }
          }

          if (audioBlob) {
            const blobUrl = URL.createObjectURL(audioBlob);
            await audioSeekService.load(blobUrl);
            setAudioLoaded(true);
          } else {
            console.warn('MP3 not found for:', articleId);
          }
        } catch (mp3Error) {
          console.error('MP3 load failed (article data OK):', mp3Error);
        }
      }
    } catch (error) {
      console.error('Failed to load audio article:', error);
      loadedArticleIdRef.current = null;
      navigate('/');
    }
  }, [navigate]);

  useEffect(() => {
    if (id) {
      const params = new URLSearchParams(window.location.search);
      const startParam = params.get('start');
      const endParam = params.get('end');
      const sentenceParam = params.get('sentence');
      const sentencesParam = params.get('sentences');
      // resume 대상 = 실제 index 공간(plain / 명시 sentence). 저장덱·subdeck은 remap → 제외
      resumeRestoredRef.current = false;
      plainOpenRef.current = !sentencesParam && !(startParam && endParam);

      if (sentencesParam) {
        // Specific sentence indices (saved sentences deck)
        const indices = sentencesParam.split(',').map(Number).filter(n => !isNaN(n));
        if (indices.length > 0) {
          loadArticle(id, undefined, indices);
          setCurrentIndex(1);
        } else {
          loadArticle(id);
        }
      } else if (startParam && endParam) {
        const start = parseInt(startParam, 10);
        const end = parseInt(endParam, 10);
        if (!isNaN(start) && !isNaN(end)) {
          setSubDeckRange({ start, end });
          loadArticle(id, { start, end });
          setCurrentIndex(1);
        } else {
          loadArticle(id);
        }
      } else {
        loadArticle(id);
        if (sentenceParam) {
          const sentenceIndex = parseInt(sentenceParam, 10);
          if (!isNaN(sentenceIndex)) {
            setCurrentIndex(sentenceIndex);
            setIsCumulative(false);
          }
        }
      }
    }

    return () => {
      resetLearningState();
      audioSeekService.stop();
      if (ytPollingRef.current) clearInterval(ytPollingRef.current);
    };
  }, [id, resetLearningState, loadArticle, setCurrentIndex, setIsCumulative]);

  const updateDisplayText = React.useCallback(() => {
    if (!article) return;

    if (isCumulative) {
      let startIndex: number;
      if (windowSize === 'full') {
        startIndex = 1;
      } else {
        startIndex = Math.max(1, currentIndex - windowSize + 1);
      }

      const filtered = article.sentences
        .filter((s) => s.index >= startIndex && s.index <= currentIndex && !s.hidden);
      setDisplaySentences(filtered);
    } else {
      const sentence = article.sentences.find((s) => s.index === currentIndex);
      // Show even if hidden in single mode (so user knows they're on a hidden sentence)
      setDisplaySentences(sentence ? [sentence] : []);
    }
  }, [article, isCumulative, currentIndex, windowSize]);

  useEffect(() => {
    if (article) {
      updateDisplayText();
    }
  }, [article, updateDisplayText]);

  // Auto-scroll active sentence to center
  useEffect(() => {
    if (activeSentenceLocalIdx >= 0 && sentenceRefs.current[activeSentenceLocalIdx]) {
      sentenceRefs.current[activeSentenceLocalIdx]?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  }, [activeSentenceLocalIdx]);

  // Check if current sentence is saved
  useEffect(() => {
    const checkSaved = async () => {
      if (article && !isCumulative) {
        const saved = await localDB.isSentenceSaved(article.id, currentIndex);
        setIsSaved(saved);
      } else {
        setIsSaved(false);
      }
    };
    checkSaved();
  }, [article, currentIndex, isCumulative]);

  const videoId = React.useMemo(() => {
    if (!article?.source) return null;
    const match = article.source.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|v\/))([^?&#]+)/);
    return match?.[1] || null;
  }, [article?.source]);

  const stopYouTubePolling = React.useCallback(() => {
    if (ytPollingRef.current) {
      clearInterval(ytPollingRef.current);
      ytPollingRef.current = null;
    }
  }, []);

  const startYouTubePolling = React.useCallback(() => {
    stopYouTubePolling();
    ytPollingRef.current = setInterval(() => {
      const player = ytPlayerRef.current;
      if (!player || typeof player.getCurrentTime !== 'function') return;
      const currentTime = player.getCurrentTime();

      if (ytEndTimeRef.current > 0 && currentTime >= ytEndTimeRef.current) {
        player.pauseVideo();
        setIsPlaying(false);
        setActiveSentenceLocalIdx(-1);
        setActiveWordIdx(-1);
        ytEndTimeRef.current = 0;
        if (ytPollingRef.current) { clearInterval(ytPollingRef.current); ytPollingRef.current = null; }
        return;
      }

      const sents = displaySentencesRef.current;
      let foundSent = -1;
      let foundWord = -1;
      for (let i = sents.length - 1; i >= 0; i--) {
        if (sents[i].start != null && currentTime >= sents[i].start!) {
          foundSent = i;
          if (sents[i].words) {
            for (let w = sents[i].words!.length - 1; w >= 0; w--) {
              if (currentTime >= sents[i].words![w].start) {
                foundWord = w;
                break;
              }
            }
          }
          break;
        }
      }
      setActiveSentenceLocalIdx(foundSent);
      setActiveWordIdx(foundWord);
    }, 100);
  }, [stopYouTubePolling]);

  const handleToggleYouTubeMode = React.useCallback(() => {
    // Toggle video visibility only — audio always stays on YouTube player
    setIsYouTubeMode(prev => !prev);
  }, []);

  // ↑ = 윈도우 크기 1~5 순환 (5에서 다시 1). 'full'이면 1부터.
  const handleUpArrow = React.useCallback(() => {
    const cur = typeof windowSize === 'number' ? windowSize : 0;
    setWindowSize(cur >= 5 || cur < 1 ? 1 : cur + 1);
  }, [windowSize, setWindowSize]);

  const handleDownArrow = React.useCallback(() => {
    setIsCumulative(false);
  }, [setIsCumulative]);

  // 키/미디어키용: 누적↔단일 토글 (화면 버튼은 up/down 개별 유지)
  const handleToggleCumulative = React.useCallback(() => {
    setIsCumulative(!isCumulative);
  }, [setIsCumulative, isCumulative]);

  const handleSpeakRef = React.useRef<() => void>(() => {});
  const speakTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  /** Debounced speak: cancels any pending play, only the last arrow press triggers playback */
  const debouncedSpeak = React.useCallback(() => {
    if (speakTimerRef.current) clearTimeout(speakTimerRef.current);
    speakTimerRef.current = setTimeout(() => {
      speakTimerRef.current = null;
      handleSpeakRef.current();
    }, 50);
  }, []);

  const handleLeftArrow = React.useCallback(() => {
    if (!article) return;
    audioSeekService.stop();
    setIsPlaying(false);
    setActiveSentenceLocalIdx(-1);
    setActiveWordIdx(-1);
    const step = windowStepMode && typeof windowSize === 'number' ? windowSize : 1;
    // Skip hidden sentences
    let target = currentIndex - step;
    while (target >= 1 && article.sentences[target - 1]?.hidden) {
      target--;
    }
    if (target >= 1) {
      setCurrentIndex(target);
    }
    debouncedSpeak();
  }, [article, currentIndex, setCurrentIndex, debouncedSpeak, windowStepMode, windowSize]);

  const handleRightArrow = React.useCallback(() => {
    if (!article) return;
    audioSeekService.stop();
    setIsPlaying(false);
    setActiveSentenceLocalIdx(-1);
    setActiveWordIdx(-1);
    const step = windowStepMode && typeof windowSize === 'number' ? windowSize : 1;
    // Clamp to max instead of blocking when remaining < step
    let target = Math.min(currentIndex + step, article.sentences.length);
    // Skip hidden sentences
    while (target <= article.sentences.length && article.sentences[target - 1]?.hidden) {
      target++;
    }
    if (target <= article.sentences.length && target !== currentIndex) {
      setCurrentIndex(target);
    }
    debouncedSpeak();
  }, [article, currentIndex, setCurrentIndex, debouncedSpeak, windowStepMode, windowSize]);

  const onPlayEnd = React.useCallback(() => {
    setActiveSentenceLocalIdx(-1);
    setActiveWordIdx(-1);
    setIsPlaying(false);
  }, []);

  const onWordUpdate = React.useCallback((sentIdx: number, wordIdx: number) => {
    setActiveSentenceLocalIdx(sentIdx);
    setActiveWordIdx(wordIdx);
  }, []);

  const handleSpeak = React.useCallback(() => {
    if (!article) return;

    if (videoId) {
      // YouTube source: always use YouTube player for audio
      const player = ytPlayerRef.current;
      if (!player) return;
      if (isCumulative) {
        let startIdx: number;
        if (windowSize === 'full') {
          startIdx = 0;
        } else {
          startIdx = Math.max(0, currentIndex - (windowSize as number));
        }
        const endIdx = currentIndex - 1;
        const visible = article.sentences
          .slice(startIdx, endIdx + 1)
          .filter(s => !s.hidden && s.start != null && s.end != null);
        if (visible.length > 0) {
          player.seekTo(visible[0].start!, true);
          ytEndTimeRef.current = visible[visible.length - 1].end!;
          player.playVideo();
          setActiveSentenceLocalIdx(0);
          setActiveWordIdx(-1);
          setIsPlaying(true);
          startYouTubePolling();
        }
      } else {
        const sentence = article.sentences.find(s => s.index === currentIndex);
        if (sentence?.start != null && sentence?.end != null) {
          player.seekTo(sentence.start, true);
          ytEndTimeRef.current = sentence.end;
          player.playVideo();
          setActiveSentenceLocalIdx(0);
          setActiveWordIdx(-1);
          setIsPlaying(true);
          startYouTubePolling();
        }
      }
      return;
    }

    if (!audioLoaded) return;

    if (isCumulative) {
      let startIdx: number;
      if (windowSize === 'full') {
        startIdx = 0;
      } else {
        startIdx = Math.max(0, currentIndex - (windowSize as number));
      }
      const endIdx = currentIndex - 1;

      const visible = article.sentences
        .slice(startIdx, endIdx + 1)
        .filter(s => !s.hidden && s.start != null && s.end != null);

      if (visible.length > 0) {
        setActiveSentenceLocalIdx(0);
        setActiveWordIdx(-1);
        setIsPlaying(true);
        audioSeekService.playSegments(
          visible,
          onPlayEnd,
          (localIdx) => setActiveSentenceLocalIdx(localIdx),
          onWordUpdate,
        );
      }
    } else {
      const sentence = article.sentences.find((s) => s.index === currentIndex);
      if (sentence?.start != null && sentence?.end != null) {
        setActiveSentenceLocalIdx(0);
        setActiveWordIdx(-1);
        setIsPlaying(true);
        audioSeekService.playSentence(
          sentence.start,
          sentence.end,
          onPlayEnd,
          undefined,
          [sentence],
          onWordUpdate,
        );
      }
    }
  }, [article, audioLoaded, isCumulative, currentIndex, windowSize, onPlayEnd, onWordUpdate, videoId, startYouTubePolling]);

  // Keep ref in sync for arrow handlers
  handleSpeakRef.current = handleSpeak;

  const handleTogglePlay = React.useCallback(() => {
    if (videoId) {
      const player = ytPlayerRef.current;
      if (!player) return;
      if (isPlaying) {
        player.pauseVideo();
        setIsPlaying(false);
        stopYouTubePolling();
      } else if (activeSentenceLocalIdx >= 0) {
        player.playVideo();
        setIsPlaying(true);
        startYouTubePolling();
      } else {
        handleSpeak();
      }
      return;
    }
    if (isPlaying) {
      audioSeekService.pause();
      setIsPlaying(false);
    } else {
      if (audioSeekService.isPaused() && activeSentenceLocalIdx >= 0) {
        audioSeekService.resume();
        setIsPlaying(true);
      } else {
        handleSpeak();
      }
    }
  }, [isPlaying, activeSentenceLocalIdx, handleSpeak, videoId, startYouTubePolling, stopYouTubePolling]);

  const handlePlayFromStart = React.useCallback(() => {
    if (!article) return;

    if (videoId) {
      const player = ytPlayerRef.current;
      if (!player) return;
      let si: number;
      if (isCumulative) {
        if (windowSize === 'full') si = 0;
        else si = Math.max(0, currentIndex - (windowSize as number));
      } else {
        si = currentIndex - 1;
      }
      const visible = article.sentences
        .slice(si, currentIndex)
        .filter(s => !s.hidden && s.start != null && s.end != null);
      if (visible.length > 0) {
        player.seekTo(visible[0].start!, true);
        ytEndTimeRef.current = visible[visible.length - 1].end!;
        player.playVideo();
        setActiveSentenceLocalIdx(0);
        setActiveWordIdx(-1);
        setIsPlaying(true);
        startYouTubePolling();
      }
      return;
    }

    if (!audioLoaded) return;
    let startIdx: number;
    if (isCumulative) {
      if (windowSize === 'full') {
        startIdx = 0;
      } else {
        startIdx = Math.max(0, currentIndex - (windowSize as number));
      }
    } else {
      startIdx = currentIndex - 1;
    }
    const endIdx = currentIndex - 1;
    const visible = article.sentences
      .slice(startIdx, endIdx + 1)
      .filter(s => !s.hidden && s.start != null && s.end != null);
    if (visible.length > 0) {
      setActiveSentenceLocalIdx(0);
      setActiveWordIdx(-1);
      setIsPlaying(true);
      audioSeekService.playSegments(
        visible,
        onPlayEnd,
        (localIdx) => setActiveSentenceLocalIdx(localIdx),
        onWordUpdate,
      );
    }
  }, [article, audioLoaded, isCumulative, currentIndex, windowSize, onPlayEnd, onWordUpdate, videoId, startYouTubePolling]);


  // YouTube 앱 열기(easy access) — 첫 문장 start 지점으로 deep link. YouTube 아티클에서만 노출.
  const handleOpenYouTubeApp = React.useCallback(() => {
    if (!videoId) return;
    const start = article?.sentences.find(s => !s.hidden && s.start != null)?.start;
    const t = start != null ? `&t=${Math.floor(start)}s` : '';
    window.open(`https://www.youtube.com/watch?v=${videoId}${t}`, '_blank');
  }, [videoId, article]);

  // Tap sentence to play from it
  const handleSentenceTap = React.useCallback((sentLocalIdx: number) => {
    if (!article) return;

    if (videoId) {
      const player = ytPlayerRef.current;
      if (!player) return;
      const fromDisplay = displaySentences.slice(sentLocalIdx)
        .filter(s => s.start != null && s.end != null);
      if (fromDisplay.length > 0) {
        player.seekTo(fromDisplay[0].start!, true);
        ytEndTimeRef.current = fromDisplay[fromDisplay.length - 1].end!;
        player.playVideo();
        setActiveSentenceLocalIdx(sentLocalIdx);
        setActiveWordIdx(-1);
        setIsPlaying(true);
        startYouTubePolling();
      }
      return;
    }

    if (!audioLoaded) return;
    const fromDisplay = displaySentences.slice(sentLocalIdx)
      .filter(s => s.start != null && s.end != null);
    if (fromDisplay.length > 0) {
      setActiveSentenceLocalIdx(sentLocalIdx);
      setActiveWordIdx(-1);
      setIsPlaying(true);
      audioSeekService.playSegments(
        fromDisplay,
        onPlayEnd,
        (localIdx) => setActiveSentenceLocalIdx(sentLocalIdx + localIdx),
        (sentIdx, wordIdx) => onWordUpdate(sentLocalIdx + sentIdx, wordIdx),
      );
    }
  }, [article, audioLoaded, displaySentences, onPlayEnd, onWordUpdate, videoId, startYouTubePolling]);

  // Tap word to play from that word's timestamp
  const handleWordTap = React.useCallback((sentLocalIdx: number, wordIdx: number, e: React.MouseEvent) => {
    e.stopPropagation(); // prevent sentence tap
    if (!article) return;

    if (videoId) {
      const player = ytPlayerRef.current;
      if (!player) return;
      const sent = displaySentences[sentLocalIdx];
      if (!sent?.words?.[wordIdx]) {
        handleSentenceTap(sentLocalIdx);
        return;
      }
      player.seekTo(sent.words[wordIdx].start, true);
      const lastSent = displaySentences[displaySentences.length - 1];
      ytEndTimeRef.current = lastSent?.end ?? 0;
      player.playVideo();
      setActiveSentenceLocalIdx(sentLocalIdx);
      setActiveWordIdx(wordIdx);
      setIsPlaying(true);
      startYouTubePolling();
      return;
    }

    if (!audioLoaded) return;
    const sent = displaySentences[sentLocalIdx];
    if (!sent?.words || !sent.words[wordIdx] || sent.start == null || sent.end == null) {
      handleSentenceTap(sentLocalIdx);
      return;
    }
    const wordStart = sent.words[wordIdx].start;
    const fromDisplay = displaySentences.slice(sentLocalIdx)
      .filter(s => s.start != null && s.end != null);
    if (fromDisplay.length === 0) return;
    const adjusted = [{ ...fromDisplay[0], start: wordStart }, ...fromDisplay.slice(1)];
    setActiveSentenceLocalIdx(sentLocalIdx);
    setActiveWordIdx(wordIdx);
    setIsPlaying(true);
    audioSeekService.playSegments(
      adjusted,
      onPlayEnd,
      (localIdx) => setActiveSentenceLocalIdx(sentLocalIdx + localIdx),
      (sentIdx, wordIdx) => onWordUpdate(sentLocalIdx + sentIdx, wordIdx),
    );
  }, [article, audioLoaded, displaySentences, handleSentenceTap, onPlayEnd, onWordUpdate, videoId, startYouTubePolling]);

  const handleRateChange = (newRate: number) => {
    setPlaybackRate(newRate);
    if (videoId && ytPlayerRef.current) {
      ytPlayerRef.current.setPlaybackRate(newRate);
    } else {
      audioSeekService.setRate(newRate);
    }
  };

  const handleSaveSentence = React.useCallback(async () => {
    if (!article || isCumulative) return;

    const sentence = article.sentences.find((s) => s.index === currentIndex);
    if (!sentence) return;

    const savedId = `${article.id}-${currentIndex}`;
    const store = useAppStore.getState();
    const meta = id ? store.audioArticles.find(a => a.id === id) : undefined;

    if (isSaved) {
      // 토글: 저장 취소
      await localDB.deleteSavedSentence(savedId);
      setIsSaved(false);
      if (id && meta) {
        const indices = (meta.savedSentenceIndices || []).filter(i => i !== currentIndex);
        store.updateSavedSentenceIndices(id, indices);
      }
      return;
    }

    await localDB.saveSentence({
      id: savedId,
      articleId: article.id,
      articleTitle: article.title,
      sentenceIndex: currentIndex,
      text: sentence.text,
      savedAt: new Date(),
    });
    setIsSaved(true);
    if (id && meta) {
      const indices = Array.from(new Set([...(meta.savedSentenceIndices || []), currentIndex]));
      store.updateSavedSentenceIndices(id, indices);
    }
  }, [article, isCumulative, currentIndex, isSaved, id]);

  const handleToggleHideSentence = React.useCallback(() => {
    if (!article || !id) return;
    const sentence = article.sentences.find((s) => s.index === currentIndex);
    if (!sentence) return;

    const updatedSentences = article.sentences.map(s =>
      s.index === currentIndex ? { ...s, hidden: !s.hidden } : s
    );
    setArticle({ ...article, sentences: updatedSentences });
    useAppStore.getState().updateArticleSentences(id, updatedSentences);
  }, [article, id, currentIndex]);

  const handleUnhideSentence = React.useCallback((sentenceIndex: number) => {
    if (!article || !id) return;
    const updatedSentences = article.sentences.map(s =>
      s.index === sentenceIndex ? { ...s, hidden: false } : s
    );
    setArticle({ ...article, sentences: updatedSentences });
    useAppStore.getState().updateArticleSentences(id, updatedSentences);
  }, [article, id]);

  // Keyboard events
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Use e.code for letter keys (IME-safe: works with Korean input mode)
      // Use e.key for special keys (arrows, space)
      // ↑=윈도우 크기(1~5 순환), ↓=누적/단일 토글, ←=이전 문장, →=다음, R=처음부터 재생, S=저장 토글
      if (e.key === 'ArrowUp') { e.preventDefault(); handleUpArrow(); return; }
      if (e.key === 'ArrowDown') { e.preventDefault(); handleToggleCumulative(); return; }
      if (e.key === 'ArrowLeft') { e.preventDefault(); handleLeftArrow(); return; }
      if (e.key === 'ArrowRight') { e.preventDefault(); handleRightArrow(); return; }
      if (e.key === ' ' || e.code === 'Space') { e.preventDefault(); handleTogglePlay(); return; }
      if (e.code === 'KeyR') { e.preventDefault(); handlePlayFromStart(); return; }
      if (e.code === 'KeyS') { e.preventDefault(); handleSaveSentence(); return; }
      if (e.code === 'KeyY') { e.preventDefault(); handleToggleYouTubeMode(); return; }
    };

    window.addEventListener('keydown', handleKeyDown);
    // Reclaim focus from YouTube iframe periodically
    const focusInterval = setInterval(() => {
      if (document.activeElement instanceof HTMLIFrameElement) {
        document.activeElement.blur();
      }
    }, 500);
    return () => { window.removeEventListener('keydown', handleKeyDown); clearInterval(focusInterval); };
  }, [handleUpArrow, handleToggleCumulative, handleLeftArrow, handleRightArrow, handleTogglePlay, handlePlayFromStart, handleSaveSentence, handleToggleYouTubeMode]);

  // Phase 3: MediaSession — 잠금화면 미디어키(Android). 키보드와 동일 shared handler 공유.
  // prev=이전 문장, next=다음, play/pause=재생정지, stop=저장. (처음부터 재생은 R 키 전용)
  useEffect(() => {
    if (!article) return;
    startMediaSession(article.title, {
      prev: handleLeftArrow,
      next: handleRightArrow,
      togglePlay: handleTogglePlay,
      save: handleSaveSentence,
    });
  }, [article, handleLeftArrow, handleRightArrow, handleTogglePlay, handleSaveSentence]);

  useEffect(() => { setMediaPlaybackState(isPlaying); }, [isPlaying]);
  useEffect(() => () => { stopMediaSession(); }, []);

  // Phase 4: resume — 로드 시 Drive의 lastIndex로 위치 복원
  useEffect(() => {
    if (!article || resumeRestoredRef.current || !plainOpenRef.current) return;
    resumeRestoredRef.current = true;
    if (new URLSearchParams(window.location.search).get('sentence')) return; // URL 위치 우선
    const li = article.lastIndex;
    if (li && li >= 1 && li <= article.sentences.length) {
      setCurrentIndex(li);
      setIsCumulative(false);
    }
  }, [article, setCurrentIndex, setIsCumulative]);

  // 문장 이동 시 lastIndex를 dirty 마킹 → 저장 버튼 활성화. Save 눌러야 Drive 반영(auto-save 없음).
  // 복원(restore)으로 currentIndex=article.lastIndex 세팅 시엔 setLastIndex가 값 동일 → no-op(dirty 안 뜸).
  useEffect(() => {
    if (!id || !plainOpenRef.current || !resumeRestoredRef.current) return;
    useAppStore.getState().setLastIndex(id, currentIndex);
  }, [id, currentIndex]);

  if (!article || !audioLoaded) {
    return (
      <Box sx={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', minHeight: '100vh', gap: 2 }}>
        <CircularProgress />
        <Typography>{!article ? '데이터 로딩 중…' : '오디오 로딩 중…'}</Typography>
      </Box>
    );
  }

  const hiddenSentences = article.sentences.filter(s => s.hidden);
  const hiddenCount = hiddenSentences.length;
  const progress = (currentIndex / article.sentences.length) * 100;
  const settingsOpen = Boolean(settingsAnchorEl);

  return (
    <Box
      sx={{
        height: '100vh',
        backgroundColor: theme.palette.grey[100],
        display: 'flex',
        flexDirection: 'column',
        padding: { xs: 1, sm: 2 },
        overflow: 'hidden',
      }}
    >
      {/* Top Bar: home + title + chips + toggle buttons */}
      <Paper
        elevation={2}
        sx={{
          p: { xs: 1, sm: 1.5 },
          mb: 1,
          display: 'flex',
          flexDirection: { xs: 'column', md: 'row' },
          justifyContent: 'space-between',
          alignItems: { xs: 'stretch', md: 'center' },
          gap: { xs: 0.5, md: 0 },
          flexShrink: 0,
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            <IconButton onClick={() => navigate('/')} color="primary" size="small">
              <Home />
            </IconButton>
            {dirtyAudioIds.size > 0 && (
              <IconButton
                onClick={() => saveDirtyArticles()}
                color="warning"
                size="small"
                title="변경사항 저장"
              >
                <Save />
              </IconButton>
            )}
          </Box>

          <Stack direction="row" spacing={0.5} alignItems="center">
            <IconButton
              onClick={() => setIsBlindMode(!isBlindMode)}
              color={isBlindMode ? 'primary' : 'default'}
              size="small"
            >
              {isBlindMode ? <VisibilityOff /> : <Visibility />}
            </IconButton>
            {!isCumulative && (
              <>
                <IconButton
                  onClick={handleSaveSentence}
                  color={isSaved ? 'primary' : 'default'}
                  size="small"
                >
                  {isSaved ? <Bookmark /> : <BookmarkBorder />}
                </IconButton>
                <IconButton
                  onClick={handleToggleHideSentence}
                  size="small"
                  color={article.sentences.find(s => s.index === currentIndex)?.hidden ? 'warning' : 'default'}
                  title={article.sentences.find(s => s.index === currentIndex)?.hidden ? '숨김 해제' : '숨기기'}
                >
                  {article.sentences.find(s => s.index === currentIndex)?.hidden ? <VisibilityOff /> : <VisibilityOffOutlined />}
                </IconButton>
              </>
            )}
            {videoId && (
              <Tooltip title="YouTube 앱에서 열기">
                <IconButton onClick={handleOpenYouTubeApp} size="small" color="success">
                  <OpenInNew />
                </IconButton>
              </Tooltip>
            )}
            <Tooltip title="숨김 목록">
              <IconButton onClick={() => setShowHiddenList(true)} size="small">
                <Badge badgeContent={hiddenCount} color="warning" max={99} invisible={hiddenCount === 0}>
                  <FormatListBulleted />
                </Badge>
              </IconButton>
            </Tooltip>
            {videoId ? (
              <Tooltip title={isYouTubeMode ? 'MP3로 전환 (y)' : 'YouTube로 전환 (y)'}>
                <IconButton onClick={handleToggleYouTubeMode} size="small" color={isYouTubeMode ? 'error' : 'default'}>
                  {isYouTubeMode ? <Audiotrack /> : <YouTubeIcon />}
                </IconButton>
              </Tooltip>
            ) : null}
            <Tooltip title="설정">
              <IconButton onClick={(e) => setSettingsAnchorEl(e.currentTarget)} size="small">
                <Settings />
              </IconButton>
            </Tooltip>
            <Tooltip title={showControls ? '패드 숨기기' : '패드 보이기'}>
              <IconButton onClick={() => setShowControls(prev => !prev)} size="small" color={showControls ? 'primary' : 'default'}>
                <Gamepad />
              </IconButton>
            </Tooltip>
          </Stack>
        </Box>

        <Stack spacing={0.5} sx={{ flex: 1, minWidth: 0 }}>
          <Stack direction="row" alignItems="center" spacing={{ xs: 0.5, sm: 1 }} flexWrap="wrap">
            <Typography
              variant="h6"
              component="h1"
              sx={{
                fontSize: { xs: '0.9rem', sm: '1.1rem' },
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                flex: { xs: '1 1 100%', sm: '0 1 auto' },
              }}
            >
              {article.title}
            </Typography>
            <Chip
              label={`${currentIndex}/${article.sentences.length}`}
              color="primary"
              variant="outlined"
              size="small"
            />
            <Chip
              label={isCumulative ? '누적' : '단일'}
              color="secondary"
              variant="filled"
              size="small"
            />
            <Chip label={isYouTubeMode ? 'YouTube' : 'Audio'} size="small" color={isYouTubeMode ? 'error' : 'info'} variant="outlined" />
            {windowStepMode && <Chip label="Window Step" size="small" color="success" variant="outlined" />}
          </Stack>
        </Stack>
      </Paper>

      {/* Settings Popover */}
      <Popover
        open={settingsOpen}
        anchorEl={settingsAnchorEl}
        onClose={() => setSettingsAnchorEl(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
      >
        <Box sx={{ p: 2, width: 260 }}>
          <Typography variant="caption" color="text.secondary">재생속도: {playbackRate.toFixed(1)}x</Typography>
          <Slider
            value={playbackRate}
            onChange={(_, newValue) => handleRateChange(newValue as number)}
            min={0.5}
            max={3.0}
            step={0.1}
            valueLabelDisplay="auto"
            valueLabelFormat={(value) => `${value.toFixed(1)}x`}
            size="small"
          />

          <Typography variant="caption" color="text.secondary">윈도우 크기</Typography>
          <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', mt: 0.5 }}>
            <TextField
              type="number"
              size="small"
              value={windowSize === 'full' ? '' : windowSize}
              placeholder={windowSize === 'full' ? '전체' : ''}
              disabled={windowSize === 'full'}
              onChange={(e) => {
                const n = parseInt(e.target.value, 10);
                if (isNaN(n)) return;
                setWindowSize(Math.max(1, Math.min(n, article.sentences.length)));
              }}
              inputProps={{ min: 1, max: article.sentences.length }}
              sx={{ width: 100 }}
            />
            <Button
              size="small"
              variant={windowSize === 'full' ? 'contained' : 'outlined'}
              onClick={() => setWindowSize(windowSize === 'full' ? 1 : 'full')}
            >
              전체
            </Button>
          </Box>

          <FormControlLabel
            control={
              <Switch
                checked={windowStepMode}
                onChange={(e) => setWindowStepMode(e.target.checked)}
                size="small"
                color="success"
              />
            }
            label={<Typography variant="caption" color="text.secondary">{windowStepMode ? '블록 이동' : '문장 이동'}</Typography>}
            sx={{ mt: 0 }}
          />
        </Box>
      </Popover>

      {/* Progress Bar */}
      <LinearProgress variant="determinate" value={progress} sx={{ mb: 1, height: 6, borderRadius: 3, flexShrink: 0 }} />

      {/* Main Content Area */}
      <Card
        elevation={3}
        sx={{
          flex: 1,
          minHeight: 0,
          mb: 1,
          backgroundColor: theme.palette.grey[50],
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <CardContent sx={{ p: { xs: 1.5, sm: 2, md: 3 }, flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {videoId && (
            <Box sx={{
              flexShrink: 1, flexGrow: isYouTubeMode ? 1 : 0, mb: isYouTubeMode ? 1 : 0, width: '100%', maxWidth: 640, mx: 'auto', minHeight: 0, position: 'relative',
              // Hidden: 1px iframe keeps YouTube player alive for audio playback
              ...(isYouTubeMode ? {} : { height: '1px', overflow: 'hidden', position: 'absolute', opacity: 0, pointerEvents: 'none' }),
              '& > div:first-of-type': { width: '100%', height: '100%' }, '& iframe': { width: '100%', height: '100%', border: 'none' }
            }}>
              <YouTubePlayer
                videoId={videoId}
                opts={{ width: '100%', playerVars: { autoplay: 0, controls: 0, modestbranding: 1, rel: 0, showinfo: 0, iv_load_policy: 3 } }}
                onReady={(e) => { ytPlayerRef.current = e.target; }}
                onStateChange={(e) => {
                  const state = e.data;
                  // Reclaim focus from YouTube iframe so keyboard shortcuts work
                  if (document.activeElement instanceof HTMLIFrameElement) {
                    (document.activeElement as HTMLElement).blur();
                  }
                  if (state === 1) {
                    setIsPlaying(true);
                    // Set end boundary if not already set (user pressed play via YouTube controls)
                    if (ytEndTimeRef.current === 0 && article) {
                      const sentence = article.sentences.find(s => s.index === currentIndex);
                      if (sentence?.end != null) ytEndTimeRef.current = sentence.end;
                    }
                    startYouTubePolling();
                  }
                  else if (state === 2) { setIsPlaying(false); stopYouTubePolling(); }
                  else if (state === 0) { setIsPlaying(false); setActiveSentenceLocalIdx(-1); setActiveWordIdx(-1); stopYouTubePolling(); }
                }}
              />
              {/* Transparent overlay to intercept clicks — play/pause via API without YouTube UI */}
              <Box
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  handleTogglePlay();
                }}
                sx={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  right: 0,
                  bottom: 0,
                  zIndex: 1,
                  cursor: 'pointer',
                }}
              />
            </Box>
          )}

          {/* Sentence display container */}
          <Box
            sx={{
              flex: isYouTubeMode && videoId ? '0 0 auto' : 1,
              minHeight: isYouTubeMode && videoId ? undefined : 0,
              maxHeight: isYouTubeMode && videoId ? '4.5em' : undefined,
              overflow: 'hidden',
              position: 'relative',
            }}
          >
            <Box
              sx={{
                height: '100%',
                overflow: 'auto',
                scrollbarWidth: 'none',
                '&::-webkit-scrollbar': { display: 'none' },
                display: 'flex',
                flexDirection: 'column',
                px: { xs: 1, sm: 2 },
              }}
            >
              {displaySentences.length > 0 ? (
                displaySentences.map((sent, sentIdx) => {
                  const isActiveSent = activeSentenceLocalIdx === sentIdx;
                  const hasActiveAnySent = activeSentenceLocalIdx >= 0;
                  const words = sent.words && sent.words.length > 0
                    ? sent.words.map(w => w.word)
                    : sent.text.split(/\s+/);

                  return (
                    <Box
                      key={sentIdx}
                      ref={(el: HTMLDivElement | null) => { sentenceRefs.current[sentIdx] = el; }}
                      onClick={() => handleSentenceTap(sentIdx)}
                      sx={{
                        cursor: 'pointer',
                        py: 0.5,
                        fontSize: { xs: '1rem', sm: '1.1rem', md: '1.25rem' },
                        lineHeight: 1.8,
                        textAlign: 'left',
                        wordWrap: 'break-word',
                        overflowWrap: 'break-word',
                        borderLeft: isActiveSent ? `3px solid ${theme.palette.primary.main}` : '3px solid transparent',
                        pl: 1,
                        transition: 'border-color 0.2s',
                      }}
                    >
                      {words.map((word, wIdx) => {
                        const isActiveWord = isActiveSent && activeWordIdx === wIdx;
                        const duringPlayback = hasActiveAnySent;
                        let color: string;
                        if (isActiveWord) {
                          color = '#000000';
                        } else if (isBlindMode && duringPlayback) {
                          color = 'transparent';
                        } else if (isBlindMode) {
                          color = 'transparent';
                        } else if (duringPlayback) {
                          color = '#cccccc';
                        } else {
                          color = '#cccccc';
                        }
                        return (
                          <span
                            key={wIdx}
                            ref={isActiveWord ? (el: HTMLSpanElement | null) => { activeWordRef.current = el; } : undefined}
                            onClick={(e) => handleWordTap(sentIdx, wIdx, e)}
                            style={{
                              color,
                              marginRight: '0.3em',
                              transition: 'color 0.15s',
                              display: 'inline',
                              fontWeight: isActiveWord ? 700 : 400,
                              textShadow: isBlindMode && !isActiveWord ? '0 0 8px rgba(0,0,0,0.3)' : 'none',
                              cursor: sent.words?.[wIdx] ? 'pointer' : 'default',
                            }}
                          >
                            {word}
                          </span>
                        );
                      })}
                    </Box>
                  );
                })
              ) : (
                <Typography sx={{ textAlign: 'center', color: 'text.secondary', mt: 4 }}>
                  문장을 선택하세요.
                </Typography>
              )}
            </Box>
          </Box>
        </CardContent>
      </Card>

      {/* Hidden Sentences List */}
      <Dialog open={showHiddenList} onClose={() => setShowHiddenList(false)} maxWidth="sm" fullWidth>
        <DialogTitle>숨김 문장 목록</DialogTitle>
        <DialogContent dividers>
          {hiddenSentences.length > 0 ? (
            <List dense>
              {hiddenSentences.map(s => (
                <ListItem
                  key={`hidden-${s.index}`}
                  secondaryAction={
                    <IconButton edge="end" onClick={() => handleUnhideSentence(s.index)} size="small">
                      <RestoreFromTrash />
                    </IconButton>
                  }
                >
                  <ListItemText
                    primary={`#${s.index}`}
                    secondary={s.text}
                    secondaryTypographyProps={{ noWrap: true }}
                  />
                </ListItem>
              ))}
            </List>
          ) : (
            <Typography color="text.secondary">숨김 문장이 없습니다.</Typography>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setShowHiddenList(false)}>닫기</Button>
        </DialogActions>
      </Dialog>

      {/* Bottom: 3x3 Navigation Pad (hideable) */}
      {showControls && (
        <Paper
          elevation={3}
          sx={{
            flexShrink: 0,
            p: { xs: 1.5, sm: 2 },
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            gap: { xs: 1, sm: 2 },
          }}
        >
          {/* Navigation Grid */}
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: 'repeat(3, 1fr)',
              gridTemplateRows: 'repeat(3, 1fr)',
              gap: 0.5,
              width: { xs: '100px', sm: '120px' },
              height: { xs: '100px', sm: '120px' },
            }}
          >
            <Box />
            <IconButton
              onClick={handleUpArrow}
              size="small"
              color="primary"
              sx={{
                backgroundColor: theme.palette.primary.light,
                color: theme.palette.common.white,
                '&:hover': { backgroundColor: theme.palette.primary.main },
              }}
            >
              <ArrowUpward fontSize="small" />
            </IconButton>
            <Box />

            <IconButton
              onClick={handleLeftArrow}
              size="small"
              color="primary"
              disabled={currentIndex <= 1}
              sx={{
                backgroundColor: currentIndex <= 1 ? theme.palette.grey[300] : theme.palette.primary.light,
                color: theme.palette.common.white,
                '&:hover': {
                  backgroundColor: currentIndex <= 1 ? theme.palette.grey[300] : theme.palette.primary.main,
                },
              }}
            >
              {windowStepMode ? <KeyboardDoubleArrowLeft fontSize="small" /> : <KeyboardArrowLeft fontSize="small" />}
            </IconButton>

            <IconButton
              onClick={handleTogglePlay}
              size="small"
              color="secondary"
              sx={{
                backgroundColor: theme.palette.secondary.main,
                color: theme.palette.common.white,
                '&:hover': { backgroundColor: theme.palette.secondary.dark },
              }}
            >
              {isPlaying ? <Pause fontSize="small" /> : <PlayArrow fontSize="small" />}
            </IconButton>

            <IconButton
              onClick={handleRightArrow}
              size="small"
              color="primary"
              disabled={currentIndex >= article.sentences.length}
              sx={{
                backgroundColor:
                  currentIndex >= article.sentences.length ? theme.palette.grey[300] : theme.palette.primary.light,
                color: theme.palette.common.white,
                '&:hover': {
                  backgroundColor:
                    currentIndex >= article.sentences.length ? theme.palette.grey[300] : theme.palette.primary.main,
                },
              }}
            >
              {windowStepMode ? <KeyboardDoubleArrowRight fontSize="small" /> : <KeyboardArrowRight fontSize="small" />}
            </IconButton>

            <Box />
            <IconButton
              onClick={handleDownArrow}
              size="small"
              color="primary"
              sx={{
                backgroundColor: theme.palette.primary.light,
                color: theme.palette.common.white,
                '&:hover': { backgroundColor: theme.palette.primary.main },
              }}
            >
              <ArrowDownward fontSize="small" />
            </IconButton>
            <IconButton
              onClick={handlePlayFromStart}
              size="small"
              sx={{
                backgroundColor: theme.palette.info.light,
                color: theme.palette.common.white,
                '&:hover': { backgroundColor: theme.palette.info.main },
              }}
            >
              <Replay fontSize="small" />
            </IconButton>
          </Box>
        </Paper>
      )}
    </Box>
  );
};

export default AudioLearningScreen;
