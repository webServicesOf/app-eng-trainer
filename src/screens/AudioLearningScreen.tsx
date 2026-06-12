import React, { useEffect, useState } from 'react';
import {
  Box,
  Paper,
  Typography,
  IconButton,
  Card,
  CardContent,
  LinearProgress,
  Chip,
  Stack,
  Slider,
  TextField,
  MenuItem,
  useTheme,
} from '@mui/material';
import {
  ArrowUpward,
  ArrowDownward,
  ArrowBack,
  ArrowForward,
  VolumeUp,
  Home,
  Bookmark,
  BookmarkBorder,
  Visibility,
  VisibilityOff,
} from '@mui/icons-material';
import { useParams, useNavigate } from 'react-router-dom';
import { AudioArticle } from '../types';
import { useLearningStore, useAppStore } from '../stores/appStore';
import { localDB } from '../services/database';
import { audioSeekService } from '../services/audioSeekService';
import { GoogleDriveService } from '../services/googleDriveService';

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
    goToNextSentence,
    goToPreviousSentence,
    resetLearningState,
  } = useLearningStore();

  const { audioArticles, accessToken } = useAppStore();

  const [article, setArticle] = useState<AudioArticle | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [subDeckRange, setSubDeckRange] = useState<{ start: number; end: number } | null>(null);
  const [displaySentences, setDisplaySentences] = useState<string[]>([]);
  const [activeSentenceLocalIdx, setActiveSentenceLocalIdx] = useState<number>(-1);
  const [playbackRate, setPlaybackRate] = useState<number>(1.0);
  const [isSaved, setIsSaved] = useState<boolean>(false);
  const [isBlindMode, setIsBlindMode] = useState<boolean>(false);
  const [audioLoaded, setAudioLoaded] = useState<boolean>(false);

  const loadArticle = React.useCallback(async (articleId: string, range?: { start: number; end: number }) => {
    try {
      // Get metadata from store (Drive-backed)
      const meta = audioArticles.find(a => a.id === articleId);
      if (!meta) {
        navigate('/');
        return;
      }

      // If subdeck range, slice sentences and re-index
      if (range) {
        const sliced = meta.sentences
          .slice(range.start, range.end)
          .map((s, i) => ({ ...s, index: i + 1 }));
        setArticle({ ...meta, sentences: sliced });
      } else {
        setArticle(meta);
      }

      // Get MP3: try cache first, then Drive download
      let audioBlob = await localDB.getCachedMp3(articleId);
      if (!audioBlob && accessToken) {
        const drive = new GoogleDriveService(accessToken);
        audioBlob = (await drive.downloadMp3(articleId)) || undefined;
        if (audioBlob) {
          await localDB.cacheMp3(articleId, audioBlob);
        }
      }

      if (audioBlob) {
        const blobUrl = URL.createObjectURL(audioBlob);
        audioSeekService.load(blobUrl);
        setAudioLoaded(true);
      }
    } catch (error) {
      console.error('Failed to load audio article:', error);
      navigate('/');
    }
  }, [navigate, audioArticles, accessToken]);

  useEffect(() => {
    if (id) {
      const params = new URLSearchParams(window.location.search);
      const startParam = params.get('start');
      const endParam = params.get('end');
      const sentenceParam = params.get('sentence');

      if (startParam && endParam) {
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
        .filter((s) => s.index >= startIndex && s.index <= currentIndex);
      const texts = filtered.map((s) => s.text);
      setDisplaySentences(texts);
      // displayText removed — rendering uses displaySentences
    } else {
      const sentence = article.sentences.find((s) => s.index === currentIndex);
      const text = sentence ? sentence.text : '';
      setDisplaySentences([text]);
      // displayText removed — rendering uses displaySentences
    }
  }, [article, isCumulative, currentIndex, windowSize]);

  useEffect(() => {
    if (article) {
      updateDisplayText();
    }
  }, [article, updateDisplayText]);

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

  const handleUpArrow = React.useCallback(() => {
    setIsCumulative(true);
  }, [setIsCumulative]);

  const handleDownArrow = React.useCallback(() => {
    setIsCumulative(false);
  }, [setIsCumulative]);

  const handleLeftArrow = React.useCallback(() => {
    goToPreviousSentence();
  }, [goToPreviousSentence]);

  const handleRightArrow = React.useCallback(() => {
    if (article) {
      goToNextSentence(article.sentences.length);
    }
  }, [article, goToNextSentence]);

  const handleSpeak = React.useCallback(() => {
    if (!article || !audioLoaded) return;

    if (isCumulative) {
      // Cumulative: play from sentence[0] to sentence[currentIndex-1]
      let startIdx: number;
      if (windowSize === 'full') {
        startIdx = 0;
      } else {
        startIdx = Math.max(0, currentIndex - (windowSize as number));
      }
      const endIdx = currentIndex - 1;

      const startSentence = article.sentences[startIdx];
      const endSentence = article.sentences[endIdx];
      const sliced = article.sentences.slice(startIdx, endIdx + 1);

      if (startSentence?.start != null && endSentence?.end != null) {
        setActiveSentenceLocalIdx(0);
        audioSeekService.playCumulative(
          sliced,
          endIdx - startIdx,
          () => { setActiveSentenceLocalIdx(-1); },
          (localIdx) => setActiveSentenceLocalIdx(localIdx),
        );
      }
    } else {
      // Single sentence
      const sentence = article.sentences.find((s) => s.index === currentIndex);
      if (sentence?.start != null && sentence?.end != null) {
        setActiveSentenceLocalIdx(0);
        audioSeekService.playSentence(
          sentence.start,
          sentence.end,
          () => { setActiveSentenceLocalIdx(-1); },
        );
      }
    }
  }, [article, audioLoaded, isCumulative, currentIndex, windowSize]);

  const handleRateChange = (newRate: number) => {
    setPlaybackRate(newRate);
    audioSeekService.setRate(newRate);
  };

  const handleSaveSentence = async () => {
    if (!article || isCumulative) return;

    const sentence = article.sentences.find((s) => s.index === currentIndex);
    if (!sentence) return;

    if (isSaved) return;

    const savedSentence = {
      id: `${article.id}-${currentIndex}`,
      articleId: article.id,
      articleTitle: article.title,
      sentenceIndex: currentIndex,
      text: sentence.text,
      savedAt: new Date(),
    };

    await localDB.saveSentence(savedSentence);
    setIsSaved(true);
  };

  // Keyboard events
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      switch (e.key) {
        case 'ArrowUp':
          e.preventDefault();
          handleUpArrow();
          break;
        case 'ArrowDown':
          e.preventDefault();
          handleDownArrow();
          break;
        case 'ArrowLeft':
          e.preventDefault();
          handleLeftArrow();
          break;
        case 'ArrowRight':
          e.preventDefault();
          handleRightArrow();
          break;
        case ' ':
          e.preventDefault();
          handleSpeak();
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleUpArrow, handleDownArrow, handleLeftArrow, handleRightArrow, handleSpeak]);

  if (!article) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh' }}>
        <Typography>Loading...</Typography>
      </Box>
    );
  }

  const progress = (currentIndex / article.sentences.length) * 100;

  return (
    <Box
      sx={{
        minHeight: '100vh',
        backgroundColor: theme.palette.grey[100],
        display: 'flex',
        flexDirection: 'column',
        padding: { xs: 1, sm: 2 },
      }}
    >
      {/* Header */}
      <Paper
        elevation={2}
        sx={{
          p: { xs: 1, sm: 2 },
          mb: 2,
          display: 'flex',
          flexDirection: { xs: 'column', md: 'row' },
          justifyContent: 'space-between',
          alignItems: { xs: 'stretch', md: 'center' },
          gap: { xs: 1, md: 0 },
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <IconButton onClick={() => navigate('/')} color="primary" size="small">
            <Home />
          </IconButton>

          <Stack direction="row" spacing={{ xs: 0.5, sm: 1 }} sx={{ display: { xs: 'flex', md: 'none' } }}>
            <IconButton
              onClick={() => setIsBlindMode(!isBlindMode)}
              color={isBlindMode ? 'primary' : 'default'}
              size="small"
            >
              {isBlindMode ? <VisibilityOff /> : <Visibility />}
            </IconButton>
            {!isCumulative && (
              <IconButton
                onClick={handleSaveSentence}
                color={isSaved ? 'primary' : 'default'}
                size="small"
              >
                {isSaved ? <Bookmark /> : <BookmarkBorder />}
              </IconButton>
            )}
            <IconButton onClick={handleSpeak} color="primary" size="small">
              <VolumeUp />
            </IconButton>
          </Stack>
        </Box>

        <Stack spacing={1} sx={{ flex: 1, minWidth: 0 }}>
          <Stack direction="row" alignItems="center" spacing={{ xs: 0.5, sm: 1 }} flexWrap="wrap">
            <Typography
              variant="h6"
              component="h1"
              sx={{
                fontSize: { xs: '1rem', sm: '1.25rem' },
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
            <Chip label="Audio" size="small" color="info" variant="outlined" />
          </Stack>
        </Stack>

        <Stack direction="row" spacing={1} sx={{ display: { xs: 'none', md: 'flex' } }}>
          <IconButton
            onClick={() => setIsBlindMode(!isBlindMode)}
            color={isBlindMode ? 'primary' : 'default'}
            size="large"
          >
            {isBlindMode ? <VisibilityOff /> : <Visibility />}
          </IconButton>
          {!isCumulative && (
            <IconButton
              onClick={handleSaveSentence}
              color={isSaved ? 'primary' : 'default'}
              size="large"
            >
              {isSaved ? <Bookmark /> : <BookmarkBorder />}
            </IconButton>
          )}
          <IconButton onClick={handleSpeak} color="primary" size="large">
            <VolumeUp />
          </IconButton>
        </Stack>
      </Paper>

      {/* Progress Bar */}
      <LinearProgress variant="determinate" value={progress} sx={{ mb: 3, height: 6, borderRadius: 3 }} />

      {/* Main Content Area */}
      <Card
        elevation={3}
        sx={{
          flex: 1,
          mb: { xs: 2, sm: 3 },
          backgroundColor: theme.palette.grey[50],
        }}
      >
        <CardContent sx={{ p: { xs: 2, sm: 3, md: 4 } }}>
          <Typography variant="subtitle2" color="grey.600" gutterBottom sx={{ fontSize: { xs: '0.75rem', sm: '0.875rem' } }}>
            영어 ({isCumulative ? '누적' : '현재'}) — Audio Seek
          </Typography>

          <Box
            sx={{
              minHeight: { xs: '150px', sm: '200px' },
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              px: { xs: 1, sm: 2 },
            }}
          >
            <Typography
              sx={{
                fontSize: {
                  xs: '1rem',
                  sm: '1.1rem',
                  md: '1.25rem',
                },
                lineHeight: 1.8,
                textAlign: 'left',
                wordWrap: 'break-word',
                overflowWrap: 'break-word',
                width: '100%',
              }}
            >
              {displaySentences.length > 0 ? (
                displaySentences.map((sentenceText, sentIdx) => (
                  <span
                    key={sentIdx}
                    style={{
                      color: activeSentenceLocalIdx === sentIdx
                        ? '#000000'
                        : activeSentenceLocalIdx >= 0
                          ? (isBlindMode ? 'transparent' : '#aaaaaa')
                          : (isBlindMode ? 'transparent' : '#cccccc'),
                      transition: 'color 0.3s',
                      display: 'inline',
                      textShadow: isBlindMode && activeSentenceLocalIdx !== sentIdx ? '0 0 8px rgba(0,0,0,0.3)' : 'none',
                    }}
                  >
                    {sentenceText}{sentIdx < displaySentences.length - 1 ? ' ' : ''}
                  </span>
                ))
              ) : (
                '문장을 선택하세요.'
              )}
            </Typography>
          </Box>
        </CardContent>
      </Card>

      {/* Control Panel */}
      <Paper
        elevation={3}
        sx={{
          p: { xs: 2, sm: 3 },
          display: 'flex',
          flexDirection: { xs: 'column', lg: 'row' },
          justifyContent: 'center',
          alignItems: 'center',
          gap: { xs: 2, sm: 3 },
        }}
      >
        {/* Window Size Control */}
        <Box sx={{ textAlign: 'center', width: { xs: '100%', sm: 'auto' }, minWidth: { sm: '150px' } }}>
          <Typography variant="body2" color="text.secondary" gutterBottom sx={{ fontSize: { xs: '0.75rem', sm: '0.875rem' } }}>
            누적 윈도우
          </Typography>
          <TextField
            select
            value={windowSize}
            onChange={(e) => setWindowSize(e.target.value === 'full' ? 'full' : Number(e.target.value))}
            size="small"
            sx={{ width: '100%', mt: 1 }}
          >
            <MenuItem value="full">전체</MenuItem>
            <MenuItem value={3}>3문장</MenuItem>
            <MenuItem value={5}>5문장</MenuItem>
            <MenuItem value={7}>7문장</MenuItem>
            <MenuItem value={10}>10문장</MenuItem>
          </TextField>
        </Box>

        {/* Speed Control */}
        <Box sx={{ textAlign: 'center', width: { xs: '100%', sm: 'auto' }, minWidth: { sm: '200px' } }}>
          <Typography variant="body2" color="text.secondary" gutterBottom sx={{ fontSize: { xs: '0.75rem', sm: '0.875rem' } }}>
            재생 속도
          </Typography>
          <Typography variant="h6" color="primary" sx={{ mb: 1, fontSize: { xs: '1rem', sm: '1.25rem' } }}>
            {playbackRate.toFixed(1)}x
          </Typography>
          <Slider
            value={playbackRate}
            onChange={(_, newValue) => handleRateChange(newValue as number)}
            min={0.5}
            max={2.0}
            step={0.1}
            marks={[
              { value: 0.5, label: '0.5x' },
              { value: 1.0, label: '1.0x' },
              { value: 1.5, label: '1.5x' },
              { value: 2.0, label: '2.0x' },
            ]}
            valueLabelDisplay="auto"
            valueLabelFormat={(value) => `${value.toFixed(1)}x`}
            sx={{
              width: '100%',
              '& .MuiSlider-markLabel': {
                fontSize: { xs: '0.6rem', sm: '0.75rem' },
              },
            }}
          />
        </Box>

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
            <ArrowBack fontSize="small" />
          </IconButton>

          <IconButton
            onClick={handleSpeak}
            size="small"
            color="secondary"
            sx={{
              backgroundColor: theme.palette.secondary.main,
              color: theme.palette.common.white,
              '&:hover': { backgroundColor: theme.palette.secondary.dark },
            }}
          >
            <VolumeUp fontSize="small" />
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
            <ArrowForward fontSize="small" />
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
          <Box />
        </Box>

        {/* Control Info */}
        <Box sx={{ textAlign: 'left', color: theme.palette.text.secondary, display: { xs: 'none', sm: 'block' } }}>
          <Typography variant="body2" gutterBottom sx={{ fontSize: { xs: '0.75rem', sm: '0.875rem' } }}>
            ↑ 누적 표시
          </Typography>
          <Typography variant="body2" gutterBottom sx={{ fontSize: { xs: '0.75rem', sm: '0.875rem' } }}>
            ↓ 단일 표시
          </Typography>
          <Typography variant="body2" gutterBottom sx={{ fontSize: { xs: '0.75rem', sm: '0.875rem' } }}>
            ← 이전 문장
          </Typography>
          <Typography variant="body2" gutterBottom sx={{ fontSize: { xs: '0.75rem', sm: '0.875rem' } }}>
            → 다음 문장
          </Typography>
          <Typography variant="body2" sx={{ fontSize: { xs: '0.75rem', sm: '0.875rem' } }}>Space 재생 (Audio Seek)</Typography>
        </Box>
      </Paper>
    </Box>
  );
};

export default AudioLearningScreen;
