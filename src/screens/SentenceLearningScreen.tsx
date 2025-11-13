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
import { Article } from '../types';
import { useLearningStore } from '../stores/appStore';
import { localDB } from '../services/database';
import { googleCloudTtsService } from '../services/googleCloudTtsService';

const SentenceLearningScreen: React.FC = () => {
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

  const [article, setArticle] = useState<Article | null>(null);
  const [displayText, setDisplayText] = useState<string>('');
  const [highlightIndex, setHighlightIndex] = useState<number>(-1);
  const [ttsRate, setTtsRate] = useState<number>(1.0);
  const [isSaved, setIsSaved] = useState<boolean>(false);
  const [isBlindMode, setIsBlindMode] = useState<boolean>(false);

  const loadArticle = React.useCallback(async (articleId: string) => {
    try {
      const loadedArticle = await localDB.getArticleById(articleId);
      if (loadedArticle) {
        setArticle(loadedArticle);
      } else {
        navigate('/');
      }
    } catch (error) {
      console.error('Failed to load article:', error);
      navigate('/');
    }
  }, [navigate]);

  useEffect(() => {
    if (id) {
      loadArticle(id);

      // Check if there's a sentence parameter in URL
      const params = new URLSearchParams(window.location.search);
      const sentenceParam = params.get('sentence');
      if (sentenceParam) {
        const sentenceIndex = parseInt(sentenceParam, 10);
        if (!isNaN(sentenceIndex)) {
          setCurrentIndex(sentenceIndex);
          setIsCumulative(false); // Switch to single mode
        }
      }
    }

    return () => {
      resetLearningState();
      googleCloudTtsService.stop();
    };
  }, [id, resetLearningState, loadArticle, setCurrentIndex, setIsCumulative]);

  const updateDisplayText = React.useCallback(() => {
    if (!article) return;

    if (isCumulative) {
      // 누적 표시: windowSize에 따라 범위 결정
      let startIndex: number;
      if (windowSize === 'full') {
        startIndex = 1; // 전체 누적
      } else {
        startIndex = Math.max(1, currentIndex - windowSize + 1); // 윈도우 크기만큼만
      }

      const text = article.sentences
        .filter((s) => s.index >= startIndex && s.index <= currentIndex)
        .map((s) => s.text)
        .join(' ');
      setDisplayText(text);
    } else {
      // 단일 표시: 현재 인덱스만
      const sentence = article.sentences.find((s) => s.index === currentIndex);
      setDisplayText(sentence ? sentence.text : '');
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
    // 누적 표시 모드
    setIsCumulative(true);
  }, [setIsCumulative]);

  const handleDownArrow = React.useCallback(() => {
    // 단일 표시 모드
    setIsCumulative(false);
  }, [setIsCumulative]);

  const handleLeftArrow = React.useCallback(() => {
    // 이전 문장으로
    goToPreviousSentence();
  }, [goToPreviousSentence]);

  const handleRightArrow = React.useCallback(() => {
    // 다음 문장으로
    if (article) {
      goToNextSentence(article.sentences.length);
    }
  }, [article, goToNextSentence]);

  const handleSpeak = React.useCallback((startFromWord?: string) => {
    // Google Cloud TTS API 키 확인
    const apiKey = localStorage.getItem('google_cloud_tts_api_key');
    if (!apiKey) {
      alert('Google Cloud TTS API 키가 설정되지 않았습니다. 홈 화면에서 설정해주세요.');
      navigate('/');
      return;
    }
    googleCloudTtsService.setApiKey(apiKey);

    if (displayText) {
      const words = displayText.split(/\s+/);

      // 단어별 시작 위치 미리 계산 (charIndex -> wordIndex 매핑용)
      const wordStartPositions: number[] = [];
      let searchStart = 0;
      for (const word of words) {
        const pos = displayText.indexOf(word, searchStart);
        wordStartPositions.push(pos);
        searchStart = pos + word.length;
      }

      googleCloudTtsService.speakWithHighlight(
        displayText,
        (charIndex) => {
          // charIndex로부터 단어 인덱스 찾기
          for (let i = 0; i < wordStartPositions.length; i++) {
            const wordStart = wordStartPositions[i];
            const wordEnd = i + 1 < wordStartPositions.length ? wordStartPositions[i + 1] : displayText.length;

            if (charIndex >= wordStart && charIndex < wordEnd) {
              setHighlightIndex(i);
              return;
            }
          }
        },
        () => {
          // 읽기 완료 시 하이라이트 제거
          setHighlightIndex(-1);
        },
        startFromWord
      ).catch((error) => {
        console.error('TTS Error:', error);
        alert('TTS 재생 중 오류가 발생했습니다. API 키를 확인하세요.');
      });
    }
  }, [displayText, navigate]);

  const handleRateChange = (newRate: number) => {
    setTtsRate(newRate);
    googleCloudTtsService.setRate(newRate);
  };

  const handleSaveSentence = async () => {
    if (!article || isCumulative) return;

    const sentence = article.sentences.find((s) => s.index === currentIndex);
    if (!sentence) return;

    if (isSaved) {
      // Already saved - no action needed (could implement unsave if desired)
      return;
    }

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

  // 키보드 이벤트 처리
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
              title={isBlindMode ? '통암기 모드' : '기본 모드'}
            >
              {isBlindMode ? <VisibilityOff /> : <Visibility />}
            </IconButton>
            {!isCumulative && (
              <IconButton
                onClick={handleSaveSentence}
                color={isSaved ? 'primary' : 'default'}
                size="small"
                title={isSaved ? '저장됨' : '문장 저장'}
              >
                {isSaved ? <Bookmark /> : <BookmarkBorder />}
              </IconButton>
            )}
            <IconButton onClick={() => handleSpeak()} color="primary" size="small">
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
          </Stack>
          <Stack direction="row" spacing={{ xs: 0.5, sm: 1 }} flexWrap="wrap">
            {article.difficulty && (
              <Chip
                label={`${article.difficulty}`}
                size="small"
                color="primary"
                variant="outlined"
                sx={{ fontSize: { xs: '0.7rem', sm: '0.8rem' } }}
              />
            )}
            {article.length && (
              <Chip
                label={`${article.length}`}
                size="small"
                color="secondary"
                variant="outlined"
                sx={{ fontSize: { xs: '0.7rem', sm: '0.8rem' } }}
              />
            )}
          </Stack>
        </Stack>

        <Stack direction="row" spacing={1} sx={{ display: { xs: 'none', md: 'flex' } }}>
          <IconButton
            onClick={() => setIsBlindMode(!isBlindMode)}
            color={isBlindMode ? 'primary' : 'default'}
            size="large"
            title={isBlindMode ? '통암기 모드' : '기본 모드'}
          >
            {isBlindMode ? <VisibilityOff /> : <Visibility />}
          </IconButton>
          {!isCumulative && (
            <IconButton
              onClick={handleSaveSentence}
              color={isSaved ? 'primary' : 'default'}
              size="large"
              title={isSaved ? '저장됨' : '문장 저장'}
            >
              {isSaved ? <Bookmark /> : <BookmarkBorder />}
            </IconButton>
          )}
          <IconButton onClick={() => handleSpeak()} color="primary" size="large">
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
            영어 ({isCumulative ? '누적' : '현재'})
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
              {displayText ? (
                displayText.split(/\s+/).map((word, index) => (
                  <span
                    key={index}
                    onClick={() => {
                      // Start TTS from this word
                      handleSpeak(word);
                    }}
                    style={{
                      color: index === highlightIndex ? '#000000' : (isBlindMode ? 'transparent' : '#cccccc'),
                      marginRight: '0.3em',
                      transition: 'color 0.2s',
                      display: 'inline',
                      cursor: 'pointer',
                      textShadow: isBlindMode && index !== highlightIndex ? '0 0 8px rgba(0,0,0,0.3)' : 'none',
                    }}
                  >
                    {word}
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
            {ttsRate.toFixed(1)}x
          </Typography>
          <Slider
            value={ttsRate}
            onChange={(_, newValue) => handleRateChange(newValue as number)}
            min={0.6}
            max={3.0}
            step={0.2}
            marks={[
              { value: 0.6, label: '0.6x' },
              { value: 1.0, label: '1.0x' },
              { value: 2.0, label: '2.0x' },
              { value: 3.0, label: '3.0x' },
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
          {/* Top Row */}
          <Box />
          <IconButton
            onClick={handleUpArrow}
            size="small"
            color="primary"
            sx={{
              backgroundColor: theme.palette.primary.light,
              color: theme.palette.common.white,
              '&:hover': {
                backgroundColor: theme.palette.primary.main,
              },
            }}
          >
            <ArrowUpward fontSize="small" />
          </IconButton>
          <Box />

          {/* Middle Row */}
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
            onClick={() => handleSpeak()}
            size="small"
            color="secondary"
            sx={{
              backgroundColor: theme.palette.secondary.main,
              color: theme.palette.common.white,
              '&:hover': {
                backgroundColor: theme.palette.secondary.dark,
              },
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

          {/* Bottom Row */}
          <Box />
          <IconButton
            onClick={handleDownArrow}
            size="small"
            color="primary"
            sx={{
              backgroundColor: theme.palette.primary.light,
              color: theme.palette.common.white,
              '&:hover': {
                backgroundColor: theme.palette.primary.main,
              },
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
          <Typography variant="body2" sx={{ fontSize: { xs: '0.75rem', sm: '0.875rem' } }}>Space TTS 재생</Typography>
        </Box>
      </Paper>
    </Box>
  );
};

export default SentenceLearningScreen;
