import React, { useEffect, useState, useRef, useCallback } from 'react';
import {
  Box,
  Paper,
  Typography,
  IconButton,
  Button,
  List,
  ListItem,
  ListItemText,
  ListItemButton,
  Slider,
  Stack,
  Chip,
  TextField,
  useTheme,
} from '@mui/material';
import {
  Home,
  PlayArrow,
  Pause,
  Save,
  Remove,
  Add,
  SkipPrevious,
  SkipNext,
  MergeType,
} from '@mui/icons-material';
import { useParams, useNavigate } from 'react-router-dom';
import WaveSurfer from 'wavesurfer.js';
import RegionsPlugin from 'wavesurfer.js/dist/plugins/regions.js';
import { AudioArticle, SentenceEntry, SubDeck } from '../types';
import { localDB } from '../services/database';
import { useAppStore } from '../stores/appStore';

const TimestampEditorScreen: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const theme = useTheme();
  const { createSubDeck, loadSubDecks } = useAppStore();

  const waveformRef = useRef<HTMLDivElement>(null);
  const wavesurferRef = useRef<WaveSurfer | null>(null);
  const regionsRef = useRef<RegionsPlugin | null>(null);

  const [article, setArticle] = useState<AudioArticle | null>(null);
  const [sentences, setSentences] = useState<SentenceEntry[]>([]);
  const [selectedIndex, setSelectedIndex] = useState<number>(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [hasChanges, setHasChanges] = useState(false);
  const [zoom, setZoom] = useState(50);
  const [splitMarkers, setSplitMarkers] = useState<Set<number>>(new Set()); // sentence indices where splits occur (after this index)
  const undoStackRef = useRef<SentenceEntry[][]>([]);
  const redoStackRef = useRef<SentenceEntry[][]>([]);

  // Load article
  useEffect(() => {
    const load = async () => {
      if (!id) return;
      const loaded = await localDB.getAudioArticleById(id);
      if (loaded) {
        setArticle(loaded);
        setSentences([...loaded.sentences]);
        if (loaded.splitPoints?.length) {
          setSplitMarkers(new Set(loaded.splitPoints));
        }
      } else {
        navigate('/');
      }
    };
    load();
  }, [id, navigate]);

  // Initialize WaveSurfer
  useEffect(() => {
    if (!article?.audioBlob || !waveformRef.current) return;

    const regions = RegionsPlugin.create();
    regionsRef.current = regions;

    const ws = WaveSurfer.create({
      container: waveformRef.current,
      waveColor: '#b0bec5',
      progressColor: '#1976d2',
      cursorColor: '#dc004e',
      height: 128,
      normalize: true,
      plugins: [regions],
    });

    let destroyed = false;
    wavesurferRef.current = ws;

    const blobUrl = URL.createObjectURL(article.audioBlob);
    ws.load(blobUrl).catch((err: Error) => {
      // Ignore abort errors from React Strict Mode double-mount
      if (destroyed || err.name === 'AbortError') return;
      console.error('WaveSurfer load error:', err);
    });

    ws.on('ready', () => {
      if (!destroyed) setDuration(ws.getDuration());
    });

    ws.on('timeupdate', (time: number) => {
      if (!destroyed) setCurrentTime(time);
    });

    ws.on('play', () => { if (!destroyed) setIsPlaying(true); });
    ws.on('pause', () => { if (!destroyed) setIsPlaying(false); });

    return () => {
      destroyed = true;
      ws.destroy();
      URL.revokeObjectURL(blobUrl);
    };
  }, [article]);

  // Draw regions when sentences change
  useEffect(() => {
    const regions = regionsRef.current;
    if (!regions || duration === 0) return;

    regions.clearRegions();

    // Only show prev, current, next
    const indicesToShow = [selectedIndex - 1, selectedIndex, selectedIndex + 1];

    indicesToShow.forEach((i) => {
      if (i < 0 || i >= sentences.length) return;
      const s = sentences[i];
      if (s.start == null || s.end == null) return;

      const isCurrent = i === selectedIndex;
      const isPrev = i === selectedIndex - 1;
      const regionColor = isCurrent
        ? 'rgba(25, 118, 210, 0.2)'
        : isPrev
          ? 'rgba(255, 152, 0, 0.15)'
          : 'rgba(244, 67, 54, 0.15)';
      const region = regions.addRegion({
        id: `s-${s.index}`,
        start: s.start,
        end: s.end,
        color: regionColor,
        drag: isCurrent,
        resize: isCurrent,
      });
      if (region.element) {
        region.element.classList.add(
          isCurrent ? 'region-current' : isPrev ? 'region-prev' : 'region-next'
        );
      }
      // Bind drag/resize update directly on current region
      if (isCurrent) {
        region.on('update-end', () => {
          setSentences(prev => {
            const updated = prev.map(ss =>
              ss.index === s.index
                ? { ...ss, start: Math.round(region.start * 1000) / 1000, end: Math.round(region.end * 1000) / 1000 }
                : ss
            );
            return updated;
          });
          setHasChanges(true);
        });
      }
    });
  }, [sentences, selectedIndex, duration]);

  // Region drag/resize handled via per-region 'update-end' event above

  // Zoom control
  useEffect(() => {
    if (wavesurferRef.current) {
      wavesurferRef.current.zoom(zoom);
    }
  }, [zoom]);

  const pushUndo = useCallback(() => {
    undoStackRef.current.push(sentences.map(s => ({ ...s })));
    if (undoStackRef.current.length > 50) undoStackRef.current.shift();
    redoStackRef.current = []; // new action clears redo
  }, [sentences]);

  const handleUndo = useCallback(() => {
    const prev = undoStackRef.current.pop();
    if (prev) {
      redoStackRef.current.push(sentences.map(s => ({ ...s })));
      setSentences(prev);
      setHasChanges(true);
    }
  }, [sentences]);

  const handleRedo = useCallback(() => {
    const next = redoStackRef.current.pop();
    if (next) {
      undoStackRef.current.push(sentences.map(s => ({ ...s })));
      setSentences(next);
      setHasChanges(true);
    }
  }, [sentences]);

  const endCheckRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const clearEndCheck = useCallback(() => {
    if (endCheckRef.current) {
      clearInterval(endCheckRef.current);
      endCheckRef.current = null;
    }
  }, []);

  const startEndCheck = useCallback((endTime: number) => {
    clearEndCheck();
    endCheckRef.current = setInterval(() => {
      const ws = wavesurferRef.current;
      if (!ws) { clearEndCheck(); return; }
      if (ws.getCurrentTime() >= endTime) {
        ws.pause();
        clearEndCheck();
      }
    }, 30);
  }, [clearEndCheck]);

  const handlePlayPause = useCallback(() => {
    const ws = wavesurferRef.current;
    if (!ws) return;
    const s = sentences[selectedIndex];

    if (!ws.isPlaying()) {
      ws.play();
      if (s?.end != null) startEndCheck(s.end);
    } else {
      ws.pause();
      clearEndCheck();
    }
  }, [sentences, selectedIndex, startEndCheck, clearEndCheck]);

  const handlePlaySentence = useCallback(() => {
    const ws = wavesurferRef.current;
    const s = sentences[selectedIndex];
    if (!s || s.start == null || s.end == null || !ws) return;

    if (ws.isPlaying()) {
      // 재생 중 → 정지 (현재 위치 유지)
      ws.pause();
      clearEndCheck();
    } else {
      // 정지 상태 → 처음부터 재생
      ws.setTime(s.start);
      ws.play();
      startEndCheck(s.end);
    }
  }, [sentences, selectedIndex, startEndCheck, clearEndCheck]);

  const handlePlayFromEnd = useCallback(() => {
    const s = sentences[selectedIndex];
    if (!s || s.end == null || !wavesurferRef.current) return;
    const startAt = Math.max(0, s.end - 1);
    wavesurferRef.current.setTime(startAt);
    wavesurferRef.current.play();
    startEndCheck(s.end);
  }, [sentences, selectedIndex, startEndCheck]);

  const adjustTime = useCallback((field: 'start' | 'end', delta: number) => {
    pushUndo();
    setSentences(prev => prev.map((s, i) => {
      if (i !== selectedIndex) return s;
      const val = (s[field] ?? 0) + delta;
      return { ...s, [field]: Math.max(0, Math.round(val * 1000) / 1000) };
    }));
    setHasChanges(true);
  }, [selectedIndex, pushUndo]);

  const handleTextEdit = useCallback((newText: string) => {
    pushUndo();
    setSentences(prev => prev.map((s, i) =>
      i === selectedIndex ? { ...s, text: newText } : s
    ));
    setHasChanges(true);
  }, [selectedIndex, pushUndo]);

  const handleMergeSentences = useCallback(() => {
    if (selectedIndex >= sentences.length - 1) return;
    pushUndo();
    const current = sentences[selectedIndex];
    const next = sentences[selectedIndex + 1];

    const merged: SentenceEntry = {
      index: current.index,
      text: current.text.trimEnd() + ' ' + next.text.trimStart(),
      start: current.start,
      end: next.end,
    };

    const updated = [...sentences];
    updated.splice(selectedIndex, 2, merged);

    const reindexed = updated.map((s, i) => ({ ...s, index: i + 1 }));
    setSentences(reindexed);
    setHasChanges(true);
  }, [sentences, selectedIndex, pushUndo]);

  const handleSave = useCallback(async () => {
    if (!article) return;
    const updated: AudioArticle = {
      ...article,
      sentences,
    };
    await localDB.saveAudioArticle(updated);
    setArticle(updated);
    setHasChanges(false);
  }, [article, sentences]);

  const toggleSplitMarker = useCallback((idx: number) => {
    setSplitMarkers(prev => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  }, []);

  const handleSaveSplits = useCallback(async () => {
    if (!article || splitMarkers.size === 0) return;

    const sortedMarkers = Array.from(splitMarkers).sort((a, b) => a - b);

    // Save splitPoints into the article (for Drive sync)
    const updated: AudioArticle = { ...article, sentences, splitPoints: sortedMarkers };
    await localDB.saveAudioArticle(updated);
    setArticle(updated);

    // Recreate SubDecks from splitPoints
    await localDB.deleteSubDecksByParent(article.id);
    let prev = 0;
    for (let i = 0; i <= sortedMarkers.length; i++) {
      const end = i < sortedMarkers.length ? sortedMarkers[i] + 1 : sentences.length;
      await createSubDeck(article.id, `${article.title} Part ${i + 1}`, prev, end);
      prev = end;
    }
    await loadSubDecks();
    setHasChanges(false);
    alert(`${sortedMarkers.length + 1}개 파트로 분할 완료`);
  }, [article, sentences, splitMarkers, createSubDeck, loadSubDecks]);

  const handleSelectSentence = useCallback((idx: number) => {
    setSelectedIndex(idx);
    const s = sentences[idx];
    if (s?.start != null && wavesurferRef.current) {
      wavesurferRef.current.setTime(s.start);
    }
  }, [sentences]);

  const handlePrevSentence = useCallback(() => {
    if (selectedIndex > 0) handleSelectSentence(selectedIndex - 1);
  }, [selectedIndex, handleSelectSentence]);

  const handleNextSentence = useCallback(() => {
    if (selectedIndex < sentences.length - 1) handleSelectSentence(selectedIndex + 1);
  }, [selectedIndex, sentences.length, handleSelectSentence]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        // Only allow ⌘Z in text fields
        if ((e.metaKey || e.ctrlKey) && e.key === 'z') {
          e.preventDefault();
          if (e.shiftKey) handleRedo();
          else handleUndo();
        }
        return;
      }

      // Use e.code for IME-safe detection (한글 모드에서도 동작)
      const code = e.code;

      if (code === 'Space') {
        e.preventDefault();
        handlePlaySentence();
      } else if (code === 'KeyE') {
        e.preventDefault();
        handlePlayFromEnd();
      } else if (code === 'KeyD') {
        e.preventDefault();
        toggleSplitMarker(selectedIndex);
      } else if (code === 'KeyM') {
        e.preventDefault();
        handleMergeSentences();
      } else if (code === 'KeyZ' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        if (e.shiftKey) handleRedo();
        else handleUndo();
      } else if (code === 'KeyS' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        handleSave();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        handlePrevSentence();
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        handleNextSentence();
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        adjustTime('start', -0.1);
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        adjustTime('end', 0.1);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handlePlaySentence, handlePlayPause, handlePlayFromEnd, handlePrevSentence, handleNextSentence, adjustTime, handleSave, handleMergeSentences, handleUndo, handleRedo, handleTextEdit, toggleSplitMarker, selectedIndex]);

  if (!article) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh' }}>
        <Typography>Loading...</Typography>
      </Box>
    );
  }

  const selected = sentences[selectedIndex];
  const formatTime = (t: number) => `${Math.floor(t / 60)}:${(t % 60).toFixed(2).padStart(5, '0')}`;

  return (
    <Box
      sx={{
        minHeight: '100vh',
        backgroundColor: theme.palette.grey[100],
        display: 'flex',
        flexDirection: 'column',
        p: { xs: 1, sm: 2 },
      }}
    >
      {/* Header */}
      <Paper elevation={2} sx={{ p: 1.5, mb: 2, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <IconButton onClick={() => navigate('/')} color="primary" size="small">
            <Home />
          </IconButton>
          <Typography variant="h6" sx={{ fontSize: { xs: '0.9rem', sm: '1.25rem' } }} noWrap>
            Timestamp Editor — {article.title}
          </Typography>
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          {hasChanges && <Chip label="변경됨" color="warning" size="small" />}
          {splitMarkers.size > 0 && (
            <Button
              variant="outlined"
              color="info"
              onClick={handleSaveSplits}
              size="small"
            >
              분할 저장 ({splitMarkers.size + 1}파트)
            </Button>
          )}
          <Button
            variant="contained"
            startIcon={<Save />}
            onClick={handleSave}
            disabled={!hasChanges}
            size="small"
          >
            저장
          </Button>
        </Box>
      </Paper>

      {/* Waveform */}
      <Paper elevation={3} sx={{ p: 2, mb: 2 }}>
        <style>{`
          .wavesurfer-region[data-id^="s-"].region-prev {
            border-left: 2px dashed rgba(255,152,0,0.6) !important;
            border-right: 2px dashed rgba(255,152,0,0.6) !important;
          }
          .wavesurfer-region[data-id^="s-"].region-next {
            border-left: 2px dashed rgba(244,67,54,0.6) !important;
            border-right: 2px dashed rgba(244,67,54,0.6) !important;
          }
          .wavesurfer-region[data-id^="s-"].region-current {
            border-left: 2px solid #1976d2 !important;
            border-right: 2px solid #1976d2 !important;
          }
        `}</style>
        <Box ref={waveformRef} sx={{ width: '100%', overflow: 'hidden' }} />
        <Stack direction="row" alignItems="center" spacing={2} sx={{ mt: 1 }}>
          <Typography variant="caption" color="text.secondary">
            {formatTime(currentTime)} / {formatTime(duration)}
          </Typography>
          <Typography variant="caption" color="text.secondary">Zoom:</Typography>
          <Slider
            value={zoom}
            onChange={(_, v) => setZoom(v as number)}
            min={10}
            max={500}
            sx={{ width: 150 }}
            size="small"
          />
        </Stack>
      </Paper>

      {/* Controls + Sentence List */}
      <Box sx={{ display: 'flex', flexDirection: { xs: 'column', md: 'row' }, gap: 2, flex: 1 }}>
        {/* Controls */}
        <Paper elevation={3} sx={{ p: 2, minWidth: { md: 320 } }}>
          <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1 }}>
            <Typography variant="subtitle2">
              문장 {selected?.index ?? '-'} / {sentences.length}
            </Typography>
            <Button
              size="small"
              variant="outlined"
              startIcon={<MergeType />}
              onClick={handleMergeSentences}
              disabled={selectedIndex >= sentences.length - 1}
              title="다음 문장과 합치기"
            >
              합치기
            </Button>
          </Stack>
          <TextField
            fullWidth
            multiline
            minRows={2}
            maxRows={4}
            size="small"
            value={selected?.text ?? ''}
            onChange={(e) => handleTextEdit(e.target.value)}
            sx={{ mb: 2 }}
          />

          {/* Playback */}
          <Stack direction="row" spacing={1} sx={{ mb: 2 }} justifyContent="center">
            <IconButton onClick={handlePrevSentence} disabled={selectedIndex <= 0}>
              <SkipPrevious />
            </IconButton>
            <IconButton onClick={handlePlayPause} color="primary">
              {isPlaying ? <Pause /> : <PlayArrow />}
            </IconButton>
            <IconButton
              onClick={handlePlaySentence}
              color="secondary"
              title="선택 구간 재생"
            >
              <PlayArrow />
            </IconButton>
            <IconButton onClick={handleNextSentence} disabled={selectedIndex >= sentences.length - 1}>
              <SkipNext />
            </IconButton>
          </Stack>

          {/* Fine adjustment */}
          <Typography variant="subtitle2" gutterBottom>Start: {(selected?.start ?? 0).toFixed(2)}s</Typography>
          <Stack direction="row" spacing={1} sx={{ mb: 1.5 }} justifyContent="center">
            <Button size="small" variant="outlined" startIcon={<Remove />} onClick={() => adjustTime('start', -0.5)}>0.5</Button>
            <Button size="small" variant="outlined" startIcon={<Remove />} onClick={() => adjustTime('start', -0.1)}>0.1</Button>
            <Button size="small" variant="outlined" startIcon={<Add />} onClick={() => adjustTime('start', 0.1)}>0.1</Button>
            <Button size="small" variant="outlined" startIcon={<Add />} onClick={() => adjustTime('start', 0.5)}>0.5</Button>
          </Stack>

          <Typography variant="subtitle2" gutterBottom>End: {(selected?.end ?? 0).toFixed(2)}s</Typography>
          <Stack direction="row" spacing={1} sx={{ mb: 2 }} justifyContent="center">
            <Button size="small" variant="outlined" startIcon={<Remove />} onClick={() => adjustTime('end', -0.5)}>0.5</Button>
            <Button size="small" variant="outlined" startIcon={<Remove />} onClick={() => adjustTime('end', -0.1)}>0.1</Button>
            <Button size="small" variant="outlined" startIcon={<Add />} onClick={() => adjustTime('end', 0.1)}>0.1</Button>
            <Button size="small" variant="outlined" startIcon={<Add />} onClick={() => adjustTime('end', 0.5)}>0.5</Button>
          </Stack>

          {/* Shortcuts */}
          <Box sx={{ color: theme.palette.text.secondary, display: { xs: 'none', sm: 'block' } }}>
            <Typography variant="caption" display="block">Space: 처음부터 재생</Typography>
            <Typography variant="caption" display="block">E: 끝 1초 전</Typography>
            <Typography variant="caption" display="block">↑↓: 이전/다음 문장</Typography>
            <Typography variant="caption" display="block">←→: start -0.1s / end +0.1s</Typography>
            <Typography variant="caption" display="block">D: 분할점 토글 (더블클릭도 가능)</Typography>
            <Typography variant="caption" display="block">M: 다음 문장과 합치기</Typography>
            <Typography variant="caption" display="block">⌘Z: 되돌리기 / ⌘⇧Z: 다시하기</Typography>
            <Typography variant="caption" display="block">⌘S: 저장</Typography>
          </Box>
        </Paper>

        {/* Sentence List */}
        <Paper elevation={3} sx={{ flex: 1, overflow: 'auto', maxHeight: { xs: 300, md: 'calc(100vh - 380px)' } }}>
          <List dense disablePadding>
            {sentences.map((s, i) => (
              <React.Fragment key={s.index}>
                <ListItem disablePadding>
                  <ListItemButton
                    selected={i === selectedIndex}
                    onClick={() => handleSelectSentence(i)}
                    onDoubleClick={() => toggleSplitMarker(i)}
                    sx={{
                      borderLeft: i === selectedIndex ? `3px solid ${theme.palette.primary.main}` : '3px solid transparent',
                    }}
                  >
                    <ListItemText
                      primary={
                        <Typography
                          variant="body2"
                          sx={{
                            fontWeight: i === selectedIndex ? 600 : 400,
                            fontSize: '0.85rem',
                          }}
                        >
                          [{s.index}] {s.text}
                        </Typography>
                      }
                      secondary={
                        <Typography variant="caption" color="text.secondary">
                          {(s.start ?? 0).toFixed(2)}s — {(s.end ?? 0).toFixed(2)}s
                          ({((s.end ?? 0) - (s.start ?? 0)).toFixed(2)}s)
                        </Typography>
                      }
                    />
                  </ListItemButton>
                </ListItem>
                {splitMarkers.has(i) && (
                  <Box
                    sx={{
                      height: 3,
                      backgroundColor: theme.palette.info.main,
                      mx: 1,
                      borderRadius: 1,
                      cursor: 'pointer',
                      '&:hover': { backgroundColor: theme.palette.info.dark },
                    }}
                    onClick={() => toggleSplitMarker(i)}
                    title="분할점 — 클릭하여 제거"
                  />
                )}
              </React.Fragment>
            ))}
          </List>
        </Paper>
      </Box>
    </Box>
  );
};

export default TimestampEditorScreen;
