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
  Dialog,
  DialogTitle,
  DialogContent,
  useTheme,
  CircularProgress,
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
  VisibilityOff,
  Visibility,
  FileDownload,
  Replay,
  Keyboard as KeyboardIcon,
} from '@mui/icons-material';
import { useParams, useNavigate } from 'react-router-dom';
import WaveSurfer from 'wavesurfer.js';
import RegionsPlugin from 'wavesurfer.js/dist/plugins/regions.js';
import { FullArticle, SentenceEntry, WordTimestamp } from '../types';
import { localDB } from '../services/database';
import { useAppStore } from '../stores/appStore';
import { GoogleDriveService } from '../services/googleDriveService';

const TimestampEditorScreen: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const theme = useTheme();
  const { createSubDeck, loadSubDecks, loadAudioArticles, accessToken, audioArticles } = useAppStore();

  const waveformRef = useRef<HTMLDivElement>(null);
  const shiftKeyRef = useRef(false);
  const metaKeyRef = useRef(false);
  const dragCreatingRef = useRef(false);

  // Track modifier key state globally for region drag
  useEffect(() => {
    const down = (e: KeyboardEvent) => { shiftKeyRef.current = e.shiftKey; metaKeyRef.current = e.metaKey; };
    const up = (e: KeyboardEvent) => { shiftKeyRef.current = e.shiftKey; metaKeyRef.current = e.metaKey; };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); };
  }, []);
  const wavesurferRef = useRef<WaveSurfer | null>(null);
  const regionsRef = useRef<RegionsPlugin | null>(null);

  const [article, setArticle] = useState<FullArticle | null>(null);
  const [sentences, setSentences] = useState<SentenceEntry[]>([]);
  const [selectedIndex, setSelectedIndex] = useState<number>(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [wsReady, setWsReady] = useState(false);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [hasChanges, setHasChanges] = useState(false);
  const [zoom, setZoom] = useState(50);
  const [splitMarkers, setSplitMarkers] = useState<Set<number>>(new Set());
  const [savedSplitMarkers, setSavedSplitMarkers] = useState<Set<number>>(new Set());
  const [splitMode, setSplitMode] = useState(false); // word-pick split mode
  const [wordEditMode, setWordEditMode] = useState(false);
  const [editingWordIndex, setEditingWordIndex] = useState(-1);
  const [isSaving, setIsSaving] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const handleSaveRef = useRef<() => Promise<void>>(() => Promise.resolve());
  const undoStackRef = useRef<SentenceEntry[][]>([]);
  const redoStackRef = useRef<SentenceEntry[][]>([]);
  const selectedItemRef = useRef<HTMLLIElement | null>(null);

  // Load article from Drive (metadata from store) + MP3 from cache or Drive
  const loadedRef = useRef(false);
  useEffect(() => {
    const load = async () => {
      if (!id || loadedRef.current) return;
      loadedRef.current = true;

      // Get metadata from store — must be FullArticle (loaded via loadFullArticle before navigating here)
      const storeArticle = audioArticles.find(a => a.id === id);
      if (!storeArticle) {
        navigate('/');
        return;
      }

      // Ensure full article is loaded
      let full: FullArticle | undefined;
      if (storeArticle.kind === 'loaded') {
        full = storeArticle;
      } else {
        // Load full article on demand
        await useAppStore.getState().loadFullArticle(id);
        full = useAppStore.getState().getFullArticle(id);
        if (!full) {
          navigate('/');
          return;
        }
      }

      // Get MP3: try cache first, then Drive
      let audioBlob = await localDB.getCachedMp3(id);
      if (!audioBlob && accessToken) {
        const drive = new GoogleDriveService(accessToken);
        audioBlob = (await drive.downloadMp3(id)) || undefined;
        if (audioBlob) {
          await localDB.cacheMp3(id, audioBlob);
        }
      }

      const loaded: FullArticle = { ...full, audioBlob };
      setArticle(loaded);

      setSentences([...loaded.sentences]);

      if (loaded.splitPoints?.length) {
        const pts = new Set(loaded.splitPoints);
        setSplitMarkers(pts);
        setSavedSplitMarkers(new Set(pts));
      }
    };
    load();
  }, [id, navigate, accessToken, audioArticles]);

  // Navigation guard: prompt save/discard on exit
  const handleNavigateAway = useCallback(async () => {
    if (!hasChanges || isSaving) {
      navigate('/');
      return;
    }
    const choice = window.confirm('변경사항이 있습니다. 저장하시겠습니까?\n\n확인 = 저장 후 나가기\n취소 = 변경사항 버리기');
    if (choice) {
      await handleSaveRef.current();
    }
    navigate('/');
  }, [hasChanges, isSaving, navigate]);

  // Browser tab close/refresh guard
  useEffect(() => {
    if (!hasChanges) return;
    const handler = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [hasChanges]);

  // Browser back button guard
  useEffect(() => {
    if (!hasChanges) return;
    const handler = (e: PopStateEvent) => {
      e.preventDefault();
      // Push state back to prevent navigation, then ask
      window.history.pushState(null, '', window.location.href);
      handleNavigateAway();
    };
    window.history.pushState(null, '', window.location.href);
    window.addEventListener('popstate', handler);
    return () => window.removeEventListener('popstate', handler);
  }, [hasChanges, handleNavigateAway]);

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
      backend: 'WebAudio',
      plugins: [regions],
    });

    let destroyed = false;
    wavesurferRef.current = ws;

    // Alt+drag on waveform to create new sentence region
    regions.enableDragSelection({
      color: 'rgba(76, 175, 80, 0.25)',
    });

    // Intercept mousedown: only allow drag-create when Cmd held
    const container = waveformRef.current;
    const guardDragCreate = (e: MouseEvent) => {
      dragCreatingRef.current = e.metaKey;
    };
    container.addEventListener('mousedown', guardDragCreate, true);

    // Handle user-created regions (from Cmd+drag)
    const onRegionCreated = (region: { id: string; start: number; end: number; remove: () => void }) => {
      if (destroyed) return;
      // Skip programmatic regions (our IDs start with bg-, s-, sn-, w-)
      if (/^(bg-|s-|sn-|w-)/.test(region.id)) return;
      // Not a Cmd+drag — remove the accidental drag region
      if (!dragCreatingRef.current) {
        region.remove();
        return;
      }
      dragCreatingRef.current = false;
      const start = Math.min(region.start, region.end);
      const end = Math.max(region.start, region.end);
      region.remove();
      if (end - start < 0.05) return; // ignore tiny accidental drags

      // Dispatch custom event to create sentence (avoids stale closure)
      container.dispatchEvent(new CustomEvent('create-sentence-from-drag', {
        detail: { start, end },
      }));
    };
    regions.on('region-created', onRegionCreated);

    const blobUrl = URL.createObjectURL(article.audioBlob);
    ws.load(blobUrl).catch((err: Error) => {
      // Ignore abort errors from React Strict Mode double-mount
      if (destroyed || err.name === 'AbortError') return;
      console.error('WaveSurfer load error:', err);
    });

    ws.on('ready', () => {
      if (!destroyed) {
        setDuration(ws.getDuration());
        setWsReady(true);
      }
    });

    ws.on('timeupdate', (time: number) => {
      if (!destroyed) setCurrentTime(time);
    });

    ws.on('play', () => { if (!destroyed) setIsPlaying(true); });
    ws.on('pause', () => { if (!destroyed) setIsPlaying(false); });

    return () => {
      destroyed = true;
      setWsReady(false);
      container.removeEventListener('mousedown', guardDragCreate, true);
      ws.destroy();
      URL.revokeObjectURL(blobUrl);
    };
  }, [article]);

  // Draw regions when sentences change (+ word regions in wordEditMode)
  const lastRegionKeyRef = useRef('');
  useEffect(() => {
    const regions = regionsRef.current;
    if (!regions || duration === 0) return;

    const sel = sentences[selectedIndex];

    // Only show prev, current, next
    const indicesToShow = [selectedIndex - 1, selectedIndex, selectedIndex + 1];

    // Skip redraw if regions haven't actually changed
    const wordKey = wordEditMode && sel?.words
      ? `:wm:${editingWordIndex}:${sel.words.map(w => `${w.start}:${w.end}`).join(',')}`
      : '';
    const regionKey = `${selectedIndex}:${sentences.length}:${
      indicesToShow
        .filter(i => i >= 0 && i < sentences.length)
        .map(i => `${i}:${sentences[i].start}:${sentences[i].end}`)
        .join('|')
    }${wordKey}`;
    if (regionKey === lastRegionKeyRef.current) return;
    lastRegionKeyRef.current = regionKey;

    regions.clearRegions();

    // Grey background for all sentences outside focus window
    const focusSet = new Set(indicesToShow.filter(i => i >= 0 && i < sentences.length));
    sentences.forEach((s, i) => {
      if (focusSet.has(i)) return;
      if (s.start == null || s.end == null) return;
      const bgR = regions.addRegion({
        id: `bg-${s.index}`,
        start: s.start,
        end: s.end,
        color: 'rgba(0, 0, 0, 0.08)',
        drag: false,
        resize: false,
      });
      if (bgR.element) {
        bgR.element.style.borderRight = '1px dotted rgba(0,0,0,0.25)';
        bgR.element.style.cursor = 'pointer';
        const idx = i;
        bgR.element.addEventListener('click', () => {
          handleSelectSentence(idx);
        });
      }
    });

    // Word edit mode: show sentence background + individual word regions
    if (wordEditMode && sel?.words && sel.start != null && sel.end != null) {
      // Show prev/next sentence regions (colored, not just grey)
      [selectedIndex - 1, selectedIndex + 1].forEach(ni => {
        if (ni < 0 || ni >= sentences.length) return;
        const ns = sentences[ni];
        if (ns.start == null || ns.end == null) return;
        const isPrev = ni === selectedIndex - 1;
        const neighborRegion = regions.addRegion({
          id: `sn-${ns.index}`,
          start: ns.start,
          end: ns.end,
          color: isPrev ? 'rgba(255, 152, 0, 0.15)' : 'rgba(244, 67, 54, 0.15)',
          drag: false,
          resize: false,
        });
        if (neighborRegion.element) {
          neighborRegion.element.style.borderRight = isPrev ? '2px solid rgba(255,152,0,0.4)' : '2px solid rgba(244,67,54,0.4)';
        }
      });

      // Sentence background
      const bgRegion = regions.addRegion({
        id: `s-bg-${sel.index}`,
        start: sel.start,
        end: sel.end,
        color: 'rgba(25, 118, 210, 0.08)',
        drag: false,
        resize: false,
      });
      if (bgRegion.element) {
        bgRegion.element.style.borderRight = '2px dashed rgba(25,118,210,0.4)';
      }

      // Word regions
      sel.words.forEach((w, wi) => {
        const isSelected = wi === editingWordIndex;
        const wordRegion = regions.addRegion({
          id: `w-${wi}`,
          start: w.start,
          end: w.end,
          color: isSelected ? 'rgba(76, 175, 80, 0.3)' : 'rgba(156, 39, 176, 0.2)',
          drag: isSelected,
          resize: isSelected,
        });

        // Click to select word + border styling
        if (wordRegion.element) {
          if (isSelected) {
            wordRegion.element.style.borderLeft = '3px solid rgba(76,175,80,0.9)';
            wordRegion.element.style.borderRight = '3px solid rgba(76,175,80,0.9)';
          } else {
            wordRegion.element.style.borderLeft = '1px dashed rgba(156,39,176,0.35)';
            wordRegion.element.style.borderRight = '1px dashed rgba(156,39,176,0.35)';
          }
          wordRegion.element.addEventListener('click', () => {
            setEditingWordIndex(wi);
          });
        }

        // Drag/resize cascade for selected word
        if (isSelected) {
          wordRegion.on('update-end', () => {
            pushUndo();
            const newStart = Math.round(wordRegion.start * 1000) / 1000;
            const newEnd = Math.round(wordRegion.end * 1000) / 1000;
            setSentences(prev => {
              const s = prev[selectedIndex];
              if (!s?.words) return prev;
              const words = s.words.map(ww => ({ ...ww }));
              words[wi] = { ...words[wi], start: newStart, end: newEnd };

              // Cascade backward: trim previous words
              for (let j = wi - 1; j >= 0; j--) {
                if (words[j].end > words[j + 1].start) {
                  words[j].end = words[j + 1].start;
                  if (words[j].start > words[j].end) {
                    words[j].start = words[j].end;
                  }
                } else break;
              }

              // Cascade forward: push subsequent words
              let pushBoundary = newEnd;
              for (let j = wi + 1; j < words.length; j++) {
                if (words[j].start < pushBoundary) {
                  const dur = words[j].end - words[j].start;
                  words[j].start = Math.round(pushBoundary * 1000) / 1000;
                  words[j].end = Math.round((words[j].start + dur) * 1000) / 1000;
                  pushBoundary = words[j].end;
                } else break;
              }

              clampWordsToSentence(words, s);
              return prev.map((ss, i) => i === selectedIndex ? { ...ss, words } : ss);
            });
            // Force region redraw — clamped values may match pre-drag regionKey
            lastRegionKeyRef.current = '';
            setHasChanges(true);
          });
        }
      });
    } else {
      // Normal sentence region mode
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
          if (!isCurrent) {
            region.element.style.cursor = 'pointer';
            region.element.addEventListener('click', () => {
              handleSelectSentence(i);
            });
          }
        }
        if (isCurrent) {
          region.on('update-end', () => {
            const newEnd = Math.round(region.end * 1000) / 1000;
            setSentences(prev => {
              const currentIdx = prev.findIndex(ss => ss.index === s.index);
              const updated = [...prev];
              const newStart = Math.round(region.start * 1000) / 1000;
              updated[currentIdx] = { ...updated[currentIdx], start: newStart, end: newEnd };
              if (currentIdx > 0) {
                const prevS = updated[currentIdx - 1];
                if ((prevS.end ?? 0) > newStart) {
                  updated[currentIdx - 1] = { ...prevS, end: newStart };
                }
              }
              // End overlap: Shift = push, default = trim
              if (currentIdx < updated.length - 1) {
                if (shiftKeyRef.current) {
                  let pushBoundary = newEnd;
                  for (let pi = currentIdx + 1; pi < updated.length; pi++) {
                    const ss = updated[pi];
                    const ssStart = ss.start ?? 0;
                    if (ssStart < pushBoundary) {
                      const shift = pushBoundary - ssStart;
                      const shifted = {
                        ...ss,
                        start: Math.round((ssStart + shift) * 1000) / 1000,
                        end: Math.round(((ss.end ?? 0) + shift) * 1000) / 1000,
                      };
                      if (shifted.words) {
                        shifted.words = shifted.words.map(w => ({
                          ...w,
                          start: Math.round((w.start + shift) * 1000) / 1000,
                          end: Math.round((w.end + shift) * 1000) / 1000,
                        }));
                      }
                      updated[pi] = shifted;
                      pushBoundary = updated[pi].end!;
                    } else break;
                  }
                } else {
                  const nextS = updated[currentIdx + 1];
                  if ((nextS.start ?? 0) < newEnd) {
                    updated[currentIdx + 1] = { ...nextS, start: newEnd };
                  }
                }
              }
              return updated;
            });
            setHasChanges(true);
          });
        }
      });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sentences, selectedIndex, duration, wordEditMode, editingWordIndex]);

  // Region drag/resize handled via per-region 'update-end' event above

  // Zoom control — guard against "No audio loaded"
  useEffect(() => {
    const ws = wavesurferRef.current;
    if (ws && ws.getDuration() > 0) {
      try { ws.zoom(zoom); } catch { /* audio not ready yet */ }
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

  /**
   * Synchronous play(start, end) — bypasses WaveSurfer's async play() chain.
   * Directly manipulates the WebAudioPlayer to avoid race conditions
   * where stopAtPosition gets cleared by async microtasks.
   */
  const syncPlay = useCallback((start: number, end: number) => {
    const ws = wavesurferRef.current;
    if (!ws) return;
    // 1. Pause (sync)
    ws.pause();
    // 2. Seek (sync) — sets playbackPosition, clears stopAtPosition
    ws.setTime(start);
    // 3. Play via WaveSurfer (will be async internally, but we set stopAtPosition after)
    //    We need the media to actually start playing first.
    //    Access internal media and call _play() + emit directly for sync behavior.
    const media = (ws as any).media;
    if (media && typeof media._play === 'function') {
      media._play();
      media.emit('play');
    }
    // 4. Set stopAtPosition AFTER play started (timer is already running from 'play' event)
    (ws as any).stopAtPosition = end;
  }, []);



  const handlePlayPause = useCallback(() => {
    const ws = wavesurferRef.current;
    if (!ws) return;
    const s = sentences[selectedIndex];

    if (!ws.isPlaying()) {
      const curTime = ws.getCurrentTime();

      // If cursor is inside current sentence, play to sentence end
      if (s?.start != null && s?.end != null && curTime >= s.start && curTime <= s.end) {
        syncPlay(curTime, s.end);
      } else if (s?.end != null && curTime < (s.start ?? 0)) {
        // Cursor before sentence — play from cursor to sentence start
        syncPlay(curTime, s.start!);
      } else {
        // Cursor is outside/after current sentence — play to next sentence start
        const nextSentence = sentences.find(ns => ns.start != null && ns.start! > curTime);
        if (nextSentence?.start != null) {
          syncPlay(curTime, nextSentence.start!);
        } else {
          // No next sentence — play to end of audio
          ws.play();
        }
      }
    } else {
      ws.pause();
    }
  }, [sentences, selectedIndex, syncPlay]);

  const lastPlayedIndexRef = React.useRef<number>(-1);
  const selectedIndexRef = React.useRef<number>(selectedIndex);
  selectedIndexRef.current = selectedIndex;

  const handlePlaySentence = useCallback(() => {
    const ws = wavesurferRef.current;
    const idx = selectedIndexRef.current;
    const s = sentences[idx];
    if (!s || s.start == null || s.end == null || !ws) return;

    syncPlay(s.start, s.end);
    lastPlayedIndexRef.current = idx;
  }, [sentences, syncPlay]);

  const handlePlayFromEnd = useCallback(() => {
    const ws = wavesurferRef.current;
    const s = sentences[selectedIndex];
    if (!s || s.end == null || !ws) return;
    const startAt = Math.max(s.start ?? 0, s.end - 3);
    syncPlay(startAt, s.end);
  }, [sentences, selectedIndex, syncPlay]);

  const adjustTime = useCallback((field: 'start' | 'end', delta: number, pushMode?: boolean) => {
    pushUndo();
    setSentences(prev => {
      const updated = [...prev];
      const s = updated[selectedIndex];
      const val = (s[field] ?? 0) + delta;
      updated[selectedIndex] = { ...s, [field]: Math.max(0, Math.round(val * 1000) / 1000) };

      // Trim previous sentence's end if current start overlaps it
      if (field === 'start' && selectedIndex > 0) {
        const prevS = updated[selectedIndex - 1];
        const newStart = updated[selectedIndex].start!;
        if ((prevS.end ?? 0) > newStart) {
          updated[selectedIndex - 1] = { ...prevS, end: newStart };
        }
      }

      if (field === 'end' && selectedIndex < updated.length - 1) {
        const newEnd = updated[selectedIndex].end!;
        if (pushMode) {
          // Shift+click: push subsequent sentences
          let pushBoundary = newEnd;
          for (let i = selectedIndex + 1; i < updated.length; i++) {
            const ss = updated[i];
            const ssStart = ss.start ?? 0;
            if (ssStart < pushBoundary) {
              const shift = pushBoundary - ssStart;
              const shifted = {
                ...ss,
                start: Math.round((ssStart + shift) * 1000) / 1000,
                end: Math.round(((ss.end ?? 0) + shift) * 1000) / 1000,
              };
              if (shifted.words) {
                shifted.words = shifted.words.map(w => ({
                  ...w,
                  start: Math.round((w.start + shift) * 1000) / 1000,
                  end: Math.round((w.end + shift) * 1000) / 1000,
                }));
              }
              updated[i] = shifted;
              pushBoundary = updated[i].end!;
            } else break;
          }
        } else {
          // Default: trim next sentence's start
          const nextS = updated[selectedIndex + 1];
          if ((nextS.start ?? 0) < newEnd) {
            updated[selectedIndex + 1] = { ...nextS, start: newEnd };
          }
        }
      }

      return updated;
    });
    setHasChanges(true);
  }, [selectedIndex, pushUndo]);

  const handleTextEdit = useCallback((newText: string) => {
    pushUndo();
    setSentences(prev => prev.map((s, i) =>
      i === selectedIndex ? { ...s, text: newText, words: [] } : s
    ));
    setHasChanges(true);
  }, [selectedIndex, pushUndo]);

  const handleWordDragStart = useCallback((e: React.DragEvent, fromIndex: number) => {
    e.dataTransfer.setData('text/plain', String(fromIndex));
    e.dataTransfer.effectAllowed = 'move';
  }, []);

  const handleWordDrop = useCallback((e: React.DragEvent, toIndex: number) => {
    e.preventDefault();
    const fromIndex = parseInt(e.dataTransfer.getData('text/plain'), 10);
    if (isNaN(fromIndex) || fromIndex === toIndex) return;
    pushUndo();
    setSentences(prev => {
      const s = prev[selectedIndex];
      if (!s?.words) return prev;
      const words = [...s.words];
      const [moved] = words.splice(fromIndex, 1);
      words.splice(toIndex, 0, moved);
      // Redistribute timing: preserve total duration, reassign based on new order
      const sentStart = s.start ?? 0;
      const sentEnd = s.end ?? 0;
      const totalDur = sentEnd - sentStart;
      const totalCharLen = words.reduce((sum, w) => sum + w.word.length, 0) || 1;
      let cursor = sentStart;
      const retimedWords = words.map(w => {
        const dur = (w.word.length / totalCharLen) * totalDur;
        const newWord = { ...w, start: Math.round(cursor * 1000) / 1000, end: Math.round((cursor + dur) * 1000) / 1000 };
        cursor += dur;
        return newWord;
      });
      return prev.map((ss, i) => i === selectedIndex ? { ...ss, words: retimedWords } : ss);
    });
    setHasChanges(true);
    setEditingWordIndex(toIndex);
  }, [selectedIndex, pushUndo]);

  const handleMergeSentences = useCallback(() => {
    if (selectedIndex >= sentences.length - 1) return;
    pushUndo();
    const current = sentences[selectedIndex];
    const next = sentences[selectedIndex + 1];

    const mergedWords = (current.words && next.words)
      ? [...current.words, ...next.words]
      : current.words ?? next.words;

    const merged: SentenceEntry = {
      index: current.index,
      text: current.text.trimEnd() + ' ' + next.text.trimStart(),
      start: current.start,
      end: next.end,
      ...(mergedWords && { words: mergedWords }),
    };

    const updated = [...sentences];
    updated.splice(selectedIndex, 2, merged);

    const reindexed = updated.map((s, i) => ({ ...s, index: i + 1 }));
    setSentences(reindexed);
    setHasChanges(true);
  }, [sentences, selectedIndex, pushUndo]);

  const handleSplitSentenceAt = useCallback((wordIndex: number) => {
    const current = sentences[selectedIndex];
    if (!current?.text || current.start == null || current.end == null) return;

    const words = current.text.split(/\s+/);
    if (wordIndex < 1 || wordIndex >= words.length) return;

    pushUndo();
    const ratio = wordIndex / words.length;
    const splitTime = current.start + (current.end - current.start) * ratio;

    const first: SentenceEntry = {
      index: current.index,
      text: words.slice(0, wordIndex).join(' '),
      start: current.start,
      end: splitTime,
      ...(current.words && { words: current.words.slice(0, wordIndex) }),
    };
    const second: SentenceEntry = {
      index: current.index + 1,
      text: words.slice(wordIndex).join(' '),
      start: splitTime,
      end: current.end,
      ...(current.words && { words: current.words.slice(wordIndex) }),
    };

    const updated = [...sentences];
    updated.splice(selectedIndex, 1, first, second);
    const reindexed = updated.map((s, i) => ({ ...s, index: i + 1 }));
    setSentences(reindexed);
    setHasChanges(true);
    setSplitMode(false);
  }, [sentences, selectedIndex, pushUndo]);

  const handleSave = useCallback(async () => {
    if (!article) return;
    if (!accessToken) {
      alert('로그인 필요 — 토큰이 만료되었습니다. 홈에서 재로그인 후 다시 시도하세요.');
      return;
    }
    setIsSaving(true);
    try {
      const updated: FullArticle = {
        ...article,
        sentences,
      };
      const drive = new GoogleDriveService(accessToken);
      await drive.saveArticle(updated);
      setArticle(updated);
      setHasChanges(false);
      // Sync store cache so other screens (learning mode) see fresh sentences
      if (id) {
        useAppStore.setState(state => ({
          audioArticles: state.audioArticles.map(a => a.id === id ? { ...a, sentences: updated.sentences, splitPoints: updated.splitPoints } : a),
        }));
      }
      await loadAudioArticles();
    } catch (error) {
      console.error('Save failed:', error);
      alert('저장 실패: ' + (error instanceof Error ? error.message : 'Unknown error'));
    } finally {
      setIsSaving(false);
    }
  }, [article, sentences, accessToken, loadAudioArticles, id]);
  handleSaveRef.current = handleSave;

  const toggleSplitMarker = useCallback((idx: number) => {
    setSplitMarkers(prev => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  }, []);

  const handleSaveSplits = useCallback(async () => {
    if (!article || splitMarkers.size === 0 || !accessToken) return;

    const sortedMarkers = Array.from(splitMarkers).sort((a, b) => a - b);

    // Save splitPoints into the article (Drive SSOT)
    const updated: FullArticle = { ...article, sentences, splitPoints: sortedMarkers };
    const drive = new GoogleDriveService(accessToken);
    await drive.saveArticle(updated);
    setArticle(updated);

    // Recreate SubDecks from splitPoints
    await localDB.deleteSubDecksByParent(article.id);
    let prev = 0;
    for (let i = 0; i <= sortedMarkers.length; i++) {
      const end = i < sortedMarkers.length ? sortedMarkers[i] + 1 : sentences.length;
      await createSubDeck(article.id, `${article.title} Part ${i + 1}`, prev, end);
      prev = end;
    }
    // Sync appStore so HomeScreen sees fresh splitPoints + SubDecks
    await loadAudioArticles();
    await loadSubDecks();
    setHasChanges(false);
    setSavedSplitMarkers(new Set(splitMarkers));
    alert(`${sortedMarkers.length + 1}개 파트로 분할 완료`);
  }, [article, sentences, splitMarkers, createSubDeck, loadSubDecks, loadAudioArticles, accessToken]);

  const handleHideSentence = useCallback(() => {
    pushUndo();
    setSentences(prev => prev.map((s, i) =>
      i === selectedIndex ? { ...s, hidden: true } : s
    ));
    setHasChanges(true);
  }, [selectedIndex, pushUndo]);

  const handleUnhideSentence = useCallback(() => {
    pushUndo();
    setSentences(prev => prev.map((s, i) =>
      i === selectedIndex ? { ...s, hidden: false } : s
    ));
    setHasChanges(true);
  }, [selectedIndex, pushUndo]);

  const handleExport = useCallback((visibleOnly: boolean) => {
    const exported = visibleOnly
      ? sentences.filter(s => !s.hidden)
      : sentences;
    const json = JSON.stringify(exported, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const suffix = visibleOnly ? '_visible' : '_all';
    a.download = `${article?.title ?? 'sentences'}${suffix}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [sentences, article]);

  // --- Word Edit Mode helpers ---

  const enterWordEditMode = useCallback(() => {
    const s = sentences[selectedIndex];
    if (!s) return;
    setSplitMode(false);
    setWordEditMode(true);
    setEditingWordIndex(0);
  }, [sentences, selectedIndex]);

  /** Clamp all words to stay within sentence boundaries (mutates in place) */
  const clampWordsToSentence = (words: WordTimestamp[], s: { start?: number; end?: number }) => {
    if (words.length === 0 || s.start == null || s.end == null) return;
    for (const w of words) {
      w.start = Math.max(Math.min(w.start, s.end), s.start);
      w.end = Math.max(Math.min(w.end, s.end), s.start);
      if (w.start > w.end) w.start = w.end;
    }
  };

  const exitWordEditMode = useCallback(() => {
    setWordEditMode(false);
    setEditingWordIndex(-1);
  }, []);

  /** Initialize words[] for a sentence that has none (uniform distribution) */
  const handleInitWords = useCallback(() => {
    const s = sentences[selectedIndex];
    if (!s || s.start == null || s.end == null) return;
    pushUndo();
    const textWords = s.text.split(/\s+/).filter(w => w.length > 0);
    if (textWords.length === 0) return;
    const dur = s.end - s.start;
    const step = dur / textWords.length;
    const words: WordTimestamp[] = textWords.map((w, i) => ({
      word: w,
      start: Math.round((s.start! + i * step) * 1000) / 1000,
      end: Math.round((s.start! + (i + 1) * step) * 1000) / 1000,
    }));
    setSentences(prev => prev.map((ss, i) =>
      i === selectedIndex ? { ...ss, words } : ss
    ));
    setHasChanges(true);
  }, [sentences, selectedIndex, pushUndo]);

  /** Update a word's text and sync sentence.text */
  const handleWordTextEdit = useCallback((wordIdx: number, newWord: string) => {
    pushUndo();
    setSentences(prev => {
      const s = prev[selectedIndex];
      if (!s?.words) return prev;
      const words = [...s.words];
      words[wordIdx] = { ...words[wordIdx], word: newWord };
      const text = words.map(w => w.word).join(' ');
      return prev.map((ss, i) => i === selectedIndex ? { ...ss, words, text } : ss);
    });
    setHasChanges(true);
  }, [selectedIndex, pushUndo]);

  /** Fine-adjust word boundary by delta ms */
  const handleWordTimeAdjust = useCallback((wordIdx: number, field: 'start' | 'end', deltaMs: number) => {
    pushUndo();
    setSentences(prev => {
      const s = prev[selectedIndex];
      if (!s?.words) return prev;
      const words = s.words.map(w => ({ ...w }));
      const delta = deltaMs / 1000;
      words[wordIdx][field] = Math.round((words[wordIdx][field] + delta) * 1000) / 1000;

      // Cascade backward: trim previous words
      if (field === 'start') {
        for (let j = wordIdx - 1; j >= 0; j--) {
          if (words[j].end > words[j + 1].start) {
            words[j].end = words[j + 1].start;
            if (words[j].start > words[j].end) words[j].start = words[j].end;
          } else break;
        }
      }

      // Cascade forward: push subsequent words
      if (field === 'end') {
        let pushBoundary = words[wordIdx].end;
        for (let j = wordIdx + 1; j < words.length; j++) {
          if (words[j].start < pushBoundary) {
            const dur = words[j].end - words[j].start;
            words[j].start = Math.round(pushBoundary * 1000) / 1000;
            words[j].end = Math.round((words[j].start + dur) * 1000) / 1000;
            pushBoundary = words[j].end;
          } else break;
        }
      }

      clampWordsToSentence(words, s);
      return prev.map((ss, i) => i === selectedIndex ? { ...ss, words } : ss);
    });
    setHasChanges(true);
  }, [selectedIndex, pushUndo]);

  /** Add a placeholder word before or after the selected word */
  const handleAddWord = useCallback((position: 'before' | 'after') => {
    pushUndo();
    setSentences(prev => {
      const s = prev[selectedIndex];
      if (!s?.words || editingWordIndex < 0) return prev;
      const words = s.words.map(w => ({ ...w }));
      const ref = words[editingWordIndex];
      let newWord: WordTimestamp;

      if (position === 'before') {
        const prevWord = editingWordIndex > 0 ? words[editingWordIndex - 1] : null;
        const gapStart = prevWord ? prevWord.end : (s.start ?? ref.start - 0.1);
        const gap = ref.start - gapStart;
        if (gap >= 0.05) {
          newWord = { word: '___', start: gapStart, end: ref.start };
        } else {
          // Steal 0.1s from current word
          const steal = Math.min(0.1, (ref.end - ref.start) / 2);
          newWord = { word: '___', start: ref.start, end: Math.round((ref.start + steal) * 1000) / 1000 };
          words[editingWordIndex] = { ...ref, start: newWord.end };
        }
        words.splice(editingWordIndex, 0, newWord);
        setEditingWordIndex(editingWordIndex + 1);
      } else {
        const nextWord = editingWordIndex < words.length - 1 ? words[editingWordIndex + 1] : null;
        const gapEnd = nextWord ? nextWord.start : (s.end ?? ref.end + 0.1);
        const gap = gapEnd - ref.end;
        if (gap >= 0.05) {
          newWord = { word: '___', start: ref.end, end: gapEnd };
        } else {
          const steal = Math.min(0.1, (ref.end - ref.start) / 2);
          newWord = { word: '___', start: Math.round((ref.end - steal) * 1000) / 1000, end: ref.end };
          words[editingWordIndex] = { ...ref, end: newWord.start };
        }
        words.splice(editingWordIndex + 1, 0, newWord);
      }

      clampWordsToSentence(words, s);
      const text = words.map(w => w.word).join(' ');
      return prev.map((ss, i) => i === selectedIndex ? { ...ss, words, text } : ss);
    });
    setHasChanges(true);
  }, [selectedIndex, editingWordIndex, pushUndo]);

  /** Delete selected word (must have >1 word) */
  const handleDeleteWord = useCallback(() => {
    pushUndo();
    setSentences(prev => {
      const s = prev[selectedIndex];
      if (!s?.words || s.words.length <= 1) return prev;
      const words = s.words.filter((_, i) => i !== editingWordIndex);
      const text = words.map(w => w.word).join(' ');
      const newIdx = Math.min(editingWordIndex, words.length - 1);
      setEditingWordIndex(newIdx);
      return prev.map((ss, i) => i === selectedIndex ? { ...ss, words, text } : ss);
    });
    setHasChanges(true);
  }, [selectedIndex, editingWordIndex, pushUndo]);

  /** Play only the selected word's audio range */
  const handlePlayWord = useCallback(() => {
    const ws = wavesurferRef.current;
    const s = sentences[selectedIndex];
    if (!ws || !s?.words || editingWordIndex < 0) return;
    const w = s.words[editingWordIndex];
    if (!w) return;
    syncPlay(w.start, w.end);
  }, [sentences, selectedIndex, editingWordIndex, syncPlay]);

  /** Pull all subsequent words to pack tightly after current word */
  const handlePullWords = useCallback(() => {
    const s = sentences[selectedIndex];
    if (!s?.words || editingWordIndex < 0 || editingWordIndex >= s.words.length - 1) return;
    pushUndo();
    setSentences(prev => {
      const s = prev[selectedIndex];
      if (!s?.words) return prev;
      const words = s.words.map(w => ({ ...w }));
      const gap = words[editingWordIndex + 1].start - words[editingWordIndex].end;
      for (let j = editingWordIndex + 1; j < words.length; j++) {
        words[j].start = Math.round((words[j].start - gap) * 1000) / 1000;
        words[j].end = Math.round((words[j].end - gap) * 1000) / 1000;
      }
      clampWordsToSentence(words, s);
      return prev.map((ss, i) => i === selectedIndex ? { ...ss, words } : ss);
    });
    setHasChanges(true);
    // Advance to next word
    const cur = sentences[selectedIndex];
    if (cur?.words && editingWordIndex < cur.words.length - 1) {
      setEditingWordIndex(editingWordIndex + 1);
    }
  }, [sentences, selectedIndex, editingWordIndex, pushUndo]);

  /** Pull all subsequent sentences to pack tightly after current sentence */
  const handlePullSentences = useCallback(() => {
    if (selectedIndex >= sentences.length - 1) return;
    const current = sentences[selectedIndex];
    if (current.end == null) return;
    pushUndo();
    setSentences(prev => {
      const updated = [...prev];
      const gap = updated[selectedIndex + 1].start! - updated[selectedIndex].end!;
      for (let j = selectedIndex + 1; j < updated.length; j++) {
        const shifted = {
          ...updated[j],
          start: Math.round(((updated[j].start ?? 0) - gap) * 1000) / 1000,
          end: Math.round(((updated[j].end ?? 0) - gap) * 1000) / 1000,
        };
        // Shift words by same offset
        if (shifted.words) {
          shifted.words = shifted.words.map(w => ({
            ...w,
            start: Math.round((w.start - gap) * 1000) / 1000,
            end: Math.round((w.end - gap) * 1000) / 1000,
          }));
        }
        updated[j] = shifted;
      }
      return updated;
    });
    setHasChanges(true);
    // Advance to next sentence
    if (selectedIndex < sentences.length - 1) {
      setSelectedIndex(selectedIndex + 1);
    }
  }, [sentences, selectedIndex, pushUndo]);

  /** Insert empty sentence above current (like Jupyter 'a') */
  const handleInsertAbove = useCallback(() => {
    pushUndo();
    setSentences(prev => {
      const updated = [...prev];
      const current = updated[selectedIndex];
      const empty: SentenceEntry = {
        index: current.index,
        text: '',
        start: current.start,
        end: current.start,
      };
      // Shift indices for current and all below
      for (let i = selectedIndex; i < updated.length; i++) {
        updated[i] = { ...updated[i], index: updated[i].index + 1 };
      }
      updated.splice(selectedIndex, 0, empty);
      return updated;
    });
    setHasChanges(true);
  }, [selectedIndex, pushUndo]);

  /** Insert empty sentence below current (like Jupyter 'b') */
  const handleInsertBelow = useCallback(() => {
    pushUndo();
    setSentences(prev => {
      const updated = [...prev];
      const current = updated[selectedIndex];
      const empty: SentenceEntry = {
        index: current.index + 1,
        text: '',
        start: current.end,
        end: current.end,
      };
      // Shift indices for all below
      for (let i = selectedIndex + 1; i < updated.length; i++) {
        updated[i] = { ...updated[i], index: updated[i].index + 1 };
      }
      updated.splice(selectedIndex + 1, 0, empty);
      return updated;
    });
    setSelectedIndex(selectedIndex + 1);
    setHasChanges(true);
  }, [selectedIndex, pushUndo]);

  /** Delete current sentence */
  const handleDeleteSentence = useCallback(() => {
    if (sentences.length <= 1) return; // keep at least 1 sentence
    pushUndo();
    setSentences(prev => {
      const updated = prev.filter((_, i) => i !== selectedIndex);
      // Reindex 1-based
      for (let i = 0; i < updated.length; i++) {
        updated[i] = { ...updated[i], index: i + 1 };
      }
      return updated;
    });
    setSelectedIndex(prev => Math.min(prev, sentences.length - 2));
    setHasChanges(true);
  }, [selectedIndex, sentences.length, pushUndo]);

  /** Alt+drag on waveform → create new sentence at dragged time range */
  const handleCreateFromDrag = useCallback((start: number, end: number) => {
    pushUndo();
    setSentences(prev => {
      // Find insertion position: first sentence whose start >= drag end, or append
      let insertAt = prev.length;
      for (let i = 0; i < prev.length; i++) {
        if (prev[i].start != null && prev[i].start! >= start) {
          insertAt = i;
          break;
        }
      }
      const newSentence: SentenceEntry = {
        index: insertAt + 1, // will be reindexed below
        text: '',
        start,
        end,
      };
      const updated = [...prev];
      updated.splice(insertAt, 0, newSentence);
      // Reindex all sentences 1-based
      for (let i = 0; i < updated.length; i++) {
        updated[i] = { ...updated[i], index: i + 1 };
      }
      return updated;
    });
    // Select the newly created sentence
    setSentences(prev => {
      // Find it by matching start/end
      const idx = prev.findIndex(s => s.start === start && s.end === end && s.text === '');
      if (idx >= 0) setSelectedIndex(idx);
      return prev;
    });
    setHasChanges(true);
  }, [pushUndo]);

  // Listen for drag-create custom events from WaveSurfer init
  useEffect(() => {
    const container = waveformRef.current;
    if (!container) return;
    const handler = (e: Event) => {
      const { start, end } = (e as CustomEvent).detail;
      handleCreateFromDrag(start, end);
    };
    container.addEventListener('create-sentence-from-drag', handler);
    return () => container.removeEventListener('create-sentence-from-drag', handler);
  }, [handleCreateFromDrag]);

  // Auto-scroll selected sentence to center
  useEffect(() => {
    if (selectedItemRef.current) {
      selectedItemRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [selectedIndex]);

  const handleSelectSentence = useCallback((idx: number) => {
    const ws = wavesurferRef.current;
    // Stop playback on navigation to prevent unwanted audio
    if (ws?.isPlaying()) {
      ws.pause();
      clearEndCheck();
    }
    setSelectedIndex(idx);
    setSplitMode(false);
    setWordEditMode(false);
    setEditingWordIndex(-1);
    const s = sentences[idx];
    if (s?.start != null && ws) {
      ws.setTime(s.start);
      // Center waveform on sentence midpoint
      const mid = ((s.start ?? 0) + (s.end ?? s.start ?? 0)) / 2;
      const dur = ws.getDuration();
      if (dur > 0 && waveformRef.current) {
        const containerWidth = waveformRef.current.clientWidth;
        const pxPerSec = zoom;
        const halfViewSec = containerWidth / pxPerSec / 2;
        const scrollTo = Math.max(0, mid - halfViewSec);
        ws.setScrollTime(scrollTo);
      }
    }
  }, [sentences, clearEndCheck, zoom]);

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
        // Esc: exit text editing
        if (e.key === 'Escape') {
          e.preventDefault();
          (e.target as HTMLElement).blur();
          return;
        }
        // Only allow ⌘Z in text fields
        if ((e.metaKey || e.ctrlKey) && e.key === 'z') {
          e.preventDefault();
          if (e.shiftKey) handleRedo();
          else handleUndo();
        }
        return;
      }

      // Escape: exit word edit mode
      if (e.key === 'Escape' && wordEditMode) {
        e.preventDefault();
        exitWordEditMode();
        return;
      }

      // Use e.code for IME-safe detection (한글 모드에서도 동작)
      const code = e.code;

      // Word edit mode: Left/Right navigate words, Space=toggle, S=play from start
      if (wordEditMode) {
        if (e.key === 'ArrowLeft') {
          e.preventDefault();
          setEditingWordIndex(prev => Math.max(0, prev - 1));
          return;
        } else if (e.key === 'ArrowRight') {
          e.preventDefault();
          const s = sentences[selectedIndex];
          const maxIdx = (s?.words?.length ?? 1) - 1;
          setEditingWordIndex(prev => Math.min(maxIdx, prev + 1));
          return;
        } else if (code === 'Space' && !e.repeat) {
          e.preventDefault();
          // Toggle: playing → pause, paused → resume word playback
          const ws = wavesurferRef.current;
          if (ws?.isPlaying()) {
            ws.pause();
          } else {
            handlePlayWord();
          }
          return;
        } else if (code === 'KeyS' && !e.metaKey && !e.ctrlKey) {
          e.preventDefault();
          handlePlayWord();
          return;
        } else if (code === 'KeyP' && !e.metaKey && !e.ctrlKey) {
          e.preventDefault();
          handlePullWords();
          return;
        }
      }

      if (code === 'Space' && !e.repeat) {
        e.preventDefault();
        handlePlayPause();
      } else if (code === 'KeyS' && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        handlePlaySentence();
      } else if (code === 'KeyE') {
        e.preventDefault();
        handlePlayFromEnd();
      } else if (code === 'KeyD' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        toggleSplitMarker(selectedIndex);
      } else if (code === 'KeyD' && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        setSplitMode(prev => !prev);
      } else if (code === 'KeyW' && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        enterWordEditMode();
      } else if (code === 'KeyM') {
        e.preventDefault();
        handleMergeSentences();
      } else if (code === 'KeyP' && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        handlePullSentences();
      } else if (code === 'KeyA' && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        handleInsertAbove();
      } else if (code === 'KeyB' && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        handleInsertBelow();
      } else if ((code === 'Backspace' || code === 'Delete') && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        handleDeleteSentence();
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
        handleUnhideSentence();
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        handleHideSentence();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handlePlaySentence, handlePlayPause, handlePlayFromEnd, handlePrevSentence, handleNextSentence, handleHideSentence, handleUnhideSentence, handleSave, handleMergeSentences, handleUndo, handleRedo, handleTextEdit, toggleSplitMarker, selectedIndex, wordEditMode, exitWordEditMode, enterWordEditMode, handlePlayWord, handlePullWords, handlePullSentences, handleInsertAbove, handleInsertBelow, handleDeleteSentence, sentences]);

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
          <IconButton onClick={handleNavigateAway} color="primary" size="small" disabled={isSaving}>
            <Home />
          </IconButton>
          <Typography variant="h6" sx={{ fontSize: { xs: '0.9rem', sm: '1.25rem' } }} noWrap>
            Timestamp Editor — {article.title}
          </Typography>
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          {hasChanges && <Chip label="변경됨" color="warning" size="small" />}
          <Button
            variant="outlined"
            size="small"
            startIcon={<FileDownload />}
            onClick={() => handleExport(false)}
          >
            전체
          </Button>
          <Button
            variant="outlined"
            color="success"
            size="small"
            startIcon={<FileDownload />}
            onClick={() => handleExport(true)}
          >
            학습용
          </Button>
          {splitMarkers.size > 0 && (splitMarkers.size !== savedSplitMarkers.size || Array.from(splitMarkers).some(m => !savedSplitMarkers.has(m))) && (
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
            startIcon={isSaving ? <CircularProgress size={18} color="inherit" /> : <Save />}
            onClick={handleSave}
            disabled={!hasChanges || isSaving}
            size="small"
          >
            {isSaving ? '저장 중...' : '저장'}
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
        <Box sx={{ position: 'relative' }}>
          <Box ref={waveformRef} sx={{ width: '100%', overflow: 'hidden' }} />
          {!wsReady && (
            <Box sx={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', bgcolor: 'rgba(255,255,255,0.8)' }}>
              <Typography color="text.secondary">오디오 파형 로딩 중…</Typography>
            </Box>
          )}
        </Box>
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
            <Stack direction="row" alignItems="center" spacing={0.5}>
              <Typography variant="subtitle2">
                문장 {selected?.index ?? '-'} / {sentences.length}
              </Typography>
              {selected?.hidden && (
                <Chip label="숨김" size="small" color="default" variant="outlined" />
              )}
            </Stack>
            <Box sx={{ display: 'flex', gap: 0.5 }}>
              {!wordEditMode && (
                <>
                  <IconButton
                    size="small"
                    onClick={selected?.hidden ? handleUnhideSentence : handleHideSentence}
                    color={selected?.hidden ? 'default' : 'primary'}
                    title={selected?.hidden ? '숨김 해제 (←)' : '숨기기 (→)'}
                  >
                    {selected?.hidden ? <VisibilityOff /> : <Visibility />}
                  </IconButton>
                  <Button
                    size="small"
                    variant={splitMode ? 'contained' : 'outlined'}
                    color={splitMode ? 'info' : 'primary'}
                    onClick={() => setSplitMode(prev => !prev)}
                    title="문장 분할 모드 (D)"
                  >
                    {splitMode ? '분할 취소' : '분할'}
                  </Button>
                  <Button
                    size="small"
                    variant="outlined"
                    startIcon={<MergeType />}
                    onClick={handleMergeSentences}
                    disabled={selectedIndex >= sentences.length - 1}
                    title="다음 문장과 합치기 (M)"
                  >
                    합치기
                  </Button>
                </>
              )}
              <Button
                size="small"
                variant={wordEditMode ? 'contained' : 'outlined'}
                color={wordEditMode ? 'secondary' : 'primary'}
                onClick={wordEditMode ? exitWordEditMode : enterWordEditMode}
                title="단어 타이밍 편집"
              >
                {wordEditMode ? '← 문장' : 'Words'}
              </Button>
            </Box>
          </Stack>
          {wordEditMode ? (
            /* --- Word Edit Panel --- */
            <Box sx={{ mb: 2 }}>
              {selected?.words && selected.words.length > 0 ? (
                <>
                  {/* Word list as clickable chips */}
                  <Box sx={{
                    p: 1, mb: 1, border: '2px solid', borderColor: 'secondary.main',
                    borderRadius: 1, display: 'flex', flexWrap: 'wrap', gap: 0.5,
                  }}>
                    {selected.words.map((w, wi) => (
                      <Chip
                        key={wi}
                        label={w.word}
                        size="small"
                        color={wi === editingWordIndex ? 'success' : 'default'}
                        variant={wi === editingWordIndex ? 'filled' : 'outlined'}
                        onClick={() => setEditingWordIndex(wi)}
                        draggable
                        onDragStart={(e) => handleWordDragStart(e as unknown as React.DragEvent, wi)}
                        onDragOver={(e) => e.preventDefault()}
                        onDrop={(e) => handleWordDrop(e as unknown as React.DragEvent, wi)}
                        sx={{ cursor: 'grab', '&:active': { cursor: 'grabbing' } }}
                      />
                    ))}
                  </Box>

                  {/* Selected word editor */}
                  {editingWordIndex >= 0 && editingWordIndex < (selected.words?.length ?? 0) && (() => {
                    const w = selected.words![editingWordIndex];
                    return (
                      <Box sx={{ p: 1, bgcolor: 'grey.50', borderRadius: 1 }}>
                        <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
                          <Typography variant="caption" sx={{ minWidth: 40 }}>Word:</Typography>
                          <TextField
                            size="small"
                            value={w.word}
                            onChange={(e) => handleWordTextEdit(editingWordIndex, e.target.value)}
                            onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                            sx={{ flex: 1 }}
                            inputProps={{ style: { fontSize: '0.85rem', padding: '4px 8px' } }}
                          />
                          <IconButton size="small" onClick={handlePlayWord} color="primary" title="Play word">
                            <PlayArrow fontSize="small" />
                          </IconButton>
                        </Stack>

                        <Typography variant="caption" color="text.secondary">
                          {w.start.toFixed(3)}s — {w.end.toFixed(3)}s ({((w.end - w.start) * 1000).toFixed(0)}ms)
                        </Typography>

                        {/* ±10ms fine adjust */}
                        <Stack direction="row" spacing={0.5} sx={{ mt: 0.5, mb: 0.5 }}>
                          <Button size="small" variant="outlined" onClick={() => handleWordTimeAdjust(editingWordIndex, 'start', -10)}>S-10</Button>
                          <Button size="small" variant="outlined" onClick={() => handleWordTimeAdjust(editingWordIndex, 'start', 10)}>S+10</Button>
                          <Button size="small" variant="outlined" onClick={() => handleWordTimeAdjust(editingWordIndex, 'end', -10)}>E-10</Button>
                          <Button size="small" variant="outlined" onClick={() => handleWordTimeAdjust(editingWordIndex, 'end', 10)}>E+10</Button>
                        </Stack>

                        {/* Add/Delete */}
                        <Stack direction="row" spacing={0.5}>
                          <Button size="small" variant="outlined" onClick={() => handleAddWord('before')}>+ Before</Button>
                          <Button size="small" variant="outlined" onClick={() => handleAddWord('after')}>+ After</Button>
                          <Button
                            size="small"
                            variant="outlined"
                            color="error"
                            onClick={handleDeleteWord}
                            disabled={(selected.words?.length ?? 0) <= 1}
                          >
                            Delete
                          </Button>
                          <Button
                            size="small"
                            variant="outlined"
                            color="warning"
                            onClick={handlePullWords}
                            disabled={editingWordIndex >= (selected.words?.length ?? 1) - 1}
                            title="이후 단어 전부 당기기"
                          >
                            당기기
                          </Button>
                        </Stack>
                      </Box>
                    );
                  })()}
                </>
              ) : (
                /* No words[] — offer Init */
                <Box sx={{ textAlign: 'center', py: 2 }}>
                  <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                    이 문장에 단어 타이밍 없음
                  </Typography>
                  <Button variant="contained" size="small" onClick={handleInitWords}>
                    Init Words (균등 분배)
                  </Button>
                </Box>
              )}
            </Box>
          ) : splitMode ? (
            <Box sx={{
              mb: 2, p: 1, border: '2px solid', borderColor: 'info.main',
              borderRadius: 1, minHeight: 60, display: 'flex', flexWrap: 'wrap',
              alignItems: 'center', gap: 0,
            }}>
              <Typography variant="caption" color="info.main" sx={{ width: '100%', mb: 0.5 }}>
                단어 사이를 클릭하여 분할 지점 선택:
              </Typography>
              {(selected?.text ?? '').split(/\s+/).map((word, wi, arr) => (
                <React.Fragment key={wi}>
                  <Typography
                    variant="body2"
                    component="span"
                    sx={{ px: 0.3, py: 0.2, fontSize: '0.85rem' }}
                  >
                    {word}
                  </Typography>
                  {wi < arr.length - 1 && (
                    <Box
                      onClick={() => handleSplitSentenceAt(wi + 1)}
                      sx={{
                        width: 16, height: 28, cursor: 'pointer',
                        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                        mx: 0.2, borderRadius: 0.5,
                        '&:hover': { backgroundColor: 'error.light', color: 'white' },
                        color: 'text.disabled', fontSize: '0.9rem', fontWeight: 700,
                      }}
                      title={`"${arr.slice(0, wi + 1).join(' ')}" | "${arr.slice(wi + 1).join(' ')}"`}
                    >
                      |
                    </Box>
                  )}
                </React.Fragment>
              ))}
            </Box>
          ) : (
            <TextField
              fullWidth
              multiline
              minRows={2}
              maxRows={4}
              size="small"
              value={selected?.text ?? ''}
              onChange={(e) => handleTextEdit(e.target.value)}
              helperText={selected?.words && selected.words.length > 0 ? "⚠️ 텍스트 수정 시 단어 타이밍 초기화됨" : undefined}
              sx={{ mb: 2 }}
            />
          )}

          {/* Playback */}
          <Stack direction="row" spacing={1} sx={{ mb: 2 }} justifyContent="center">
            <IconButton onClick={handlePrevSentence} disabled={selectedIndex <= 0}>
              <SkipPrevious />
            </IconButton>
            <IconButton onClick={handlePlayPause} color="primary" title="재생/일시정지 토글">
              {isPlaying ? <Pause /> : <PlayArrow />}
            </IconButton>
            <IconButton
              onClick={handlePlaySentence}
              color="primary"
              title="문장 처음부터 재생 (Space)"
            >
              <Replay />
            </IconButton>
            <IconButton onClick={handleNextSentence} disabled={selectedIndex >= sentences.length - 1}>
              <SkipNext />
            </IconButton>
          </Stack>

          {/* Fine adjustment (hidden in word edit mode — word has its own ±10ms) */}
          {!wordEditMode && (
            <>
              <Typography variant="subtitle2" gutterBottom>Start: {(selected?.start ?? 0).toFixed(2)}s</Typography>
              <Stack direction="row" spacing={1} sx={{ mb: 1.5 }} justifyContent="center">
                <Button size="small" variant="outlined" startIcon={<Remove />} onClick={() => adjustTime('start', -0.5)}>0.5</Button>
                <Button size="small" variant="outlined" startIcon={<Remove />} onClick={() => adjustTime('start', -0.1)}>0.1</Button>
                <Button size="small" variant="outlined" startIcon={<Add />} onClick={() => adjustTime('start', 0.1)}>0.1</Button>
                <Button size="small" variant="outlined" startIcon={<Add />} onClick={() => adjustTime('start', 0.5)}>0.5</Button>
              </Stack>

              <Typography variant="subtitle2" gutterBottom>End: {(selected?.end ?? 0).toFixed(2)}s</Typography>
              <Stack direction="row" spacing={1} sx={{ mb: 2 }} justifyContent="center">
                <Button size="small" variant="outlined" startIcon={<Remove />} onClick={(e) => adjustTime('end', -0.5, e.shiftKey)}>0.5</Button>
                <Button size="small" variant="outlined" startIcon={<Remove />} onClick={(e) => adjustTime('end', -0.1, e.shiftKey)}>0.1</Button>
                <Button size="small" variant="outlined" startIcon={<Add />} onClick={(e) => adjustTime('end', 0.1, e.shiftKey)}>0.1</Button>
                <Button size="small" variant="outlined" startIcon={<Add />} onClick={(e) => adjustTime('end', 0.5, e.shiftKey)}>0.5</Button>
              </Stack>

            </>
          )}

          {/* Shortcuts button */}
          <Box sx={{ textAlign: 'center', mt: 1 }}>
            <Button size="small" startIcon={<KeyboardIcon />} onClick={() => setShortcutsOpen(true)} color="inherit">
              단축키
            </Button>
          </Box>
          <Dialog open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} maxWidth="xs" fullWidth>
            <DialogTitle>단축키 목록</DialogTitle>
            <DialogContent>
              <Typography variant="subtitle2" gutterBottom sx={{ mt: 1 }}>문장 모드</Typography>
              <Typography variant="caption" display="block">Space: 재생/일시정지 토글</Typography>
              <Typography variant="caption" display="block">S: 문장 처음부터 재생</Typography>
              <Typography variant="caption" display="block">E: 끝 3초 전</Typography>
              <Typography variant="caption" display="block">↑↓: 이전/다음 문장</Typography>
              <Typography variant="caption" display="block">→: 문장 숨기기 / ←: 숨김 해제</Typography>
              <Typography variant="caption" display="block">W: 단어 편집 모드</Typography>
              <Typography variant="caption" display="block">D: 문장 분할</Typography>
              <Typography variant="caption" display="block">M: 다음 문장과 합치기</Typography>
              <Typography variant="caption" display="block">P: 이후 문장 당기기</Typography>
              <Typography variant="caption" display="block">A: 위에 빈 문장 추가</Typography>
              <Typography variant="caption" display="block">B: 아래에 빈 문장 추가</Typography>
              <Typography variant="caption" display="block">Backspace: 문장 삭제</Typography>
              <Typography variant="caption" display="block">Esc: 텍스트 편집 나가기</Typography>
              <Typography variant="caption" display="block">⌘D: 덱 분할점 토글</Typography>
              <Typography variant="caption" display="block">⌘+드래그: 파형에서 새 문장 생성</Typography>
              <Typography variant="caption" display="block">⌘Z: 되돌리기 / ⌘⇧Z: 다시하기</Typography>
              <Typography variant="caption" display="block">⌘S: 저장</Typography>

              <Typography variant="subtitle2" gutterBottom sx={{ mt: 2 }}>단어 편집 모드</Typography>
              <Typography variant="caption" display="block">←→: 이전/다음 단어</Typography>
              <Typography variant="caption" display="block">Space: 재생/일시정지 토글</Typography>
              <Typography variant="caption" display="block">S: 선택 단어 처음부터 재생</Typography>
              <Typography variant="caption" display="block">P: 이후 단어 당기기</Typography>
              <Typography variant="caption" display="block">Esc: 문장 모드로 돌아가기</Typography>
            </DialogContent>
          </Dialog>
        </Paper>

        {/* Sentence List */}
        <Paper elevation={3} sx={{ flex: 1, overflow: 'auto', maxHeight: { xs: 300, md: 'calc(100vh - 380px)' } }}>
          <List dense disablePadding>
            {sentences.map((s, i) => (
              <React.Fragment key={s.index}>
                <ListItem disablePadding ref={i === selectedIndex ? selectedItemRef : undefined}>
                  <ListItemButton
                    selected={i === selectedIndex}
                    onClick={(e) => {
                      handleSelectSentence(i);
                      // Remove focus so Space goes to window keydown, not MUI click
                      (e.currentTarget as HTMLElement).blur();
                    }}
                    onDoubleClick={() => toggleSplitMarker(i)}
                    tabIndex={-1}
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
                            opacity: s.hidden ? 0.4 : 1,
                            textDecoration: s.hidden ? 'line-through' : 'none',
                          }}
                        >
                          [{s.index}] {s.hidden ? '👁️‍🗨️ ' : ''}{s.text}
                        </Typography>
                      }
                      secondary={
                        <Typography variant="caption" color="text.secondary">
                          {(s.start ?? 0).toFixed(2)}s — {(s.end ?? 0).toFixed(2)}s
                          ({((s.end ?? 0) - (s.start ?? 0)).toFixed(2)}s)
                        </Typography>
                      }
                    />
                    {(!s.words || s.words.length === 0) && (
                      <span style={{ marginLeft: 'auto', fontSize: '0.8rem' }} title="단어 타이밍 없음">⚠️</span>
                    )}
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
