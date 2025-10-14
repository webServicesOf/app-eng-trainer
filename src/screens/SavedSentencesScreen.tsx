import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box,
  Container,
  Typography,
  Card,
  CardContent,
  CardActions,
  Button,
  IconButton,
  CircularProgress,
} from '@mui/material';
import {
  Delete as DeleteIcon,
  Home as HomeIcon,
  PlayArrow,
} from '@mui/icons-material';
import { SavedSentence } from '../types';
import { localDB } from '../services/database';

export const SavedSentencesScreen: React.FC = () => {
  const navigate = useNavigate();
  const [sentences, setSentences] = useState<SavedSentence[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    loadSentences();
  }, []);

  const loadSentences = async () => {
    try {
      setIsLoading(true);
      const saved = await localDB.getSavedSentences();
      setSentences(saved);
    } catch (error) {
      console.error('Failed to load saved sentences:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (window.confirm('이 문장을 삭제하시겠습니까?')) {
      await localDB.deleteSavedSentence(id);
      await loadSentences();
    }
  };

  const handleGoToArticle = (articleId: string, sentenceIndex: number) => {
    // Navigate to learning screen and set the sentence index
    navigate(`/learn/${articleId}?sentence=${sentenceIndex}`);
  };

  return (
    <Container maxWidth="lg" sx={{ py: 4 }}>
      <Box sx={{ mb: 4, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Typography variant="h4" component="h1">
          저장된 문장
        </Typography>
        <IconButton onClick={() => navigate('/')} color="primary">
          <HomeIcon />
        </IconButton>
      </Box>

      {isLoading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
          <CircularProgress />
        </Box>
      ) : sentences.length === 0 ? (
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
          {sentences.map((sentence) => (
            <Card key={sentence.id}>
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
                  onClick={() => handleDelete(sentence.id)}
                >
                  <DeleteIcon fontSize="small" />
                </IconButton>
              </CardActions>
            </Card>
          ))}
        </Box>
      )}
    </Container>
  );
};

export default SavedSentencesScreen;
