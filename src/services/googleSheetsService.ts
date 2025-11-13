import axios from 'axios';
import { Article, SentenceEntry, GoogleSheetsConfig } from '../types';

export class GoogleSheetsService {
  private accessToken: string;
  private spreadsheetId: string;
  private range: string;
  private config: GoogleSheetsConfig;

  constructor(accessToken: string, config: GoogleSheetsConfig) {
    this.accessToken = accessToken;
    this.spreadsheetId = config.spreadsheetId;
    this.range = config.range;
    this.config = config;
  }

  /**
   * Google Sheets에서 데이터 가져오기
   * 예상 형식: [제목, 내용] 형태의 행들
   */
  async fetchArticles(): Promise<Article[]> {
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${this.spreadsheetId}/values/${this.range}`;

    try {
      const response = await axios.get(url, {
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
        },
      });
      const rows = response.data.values;

      if (!rows || rows.length === 0) {
        throw new Error('스프레드시트에 데이터가 없습니다.');
      }

      const articles: Article[] = [];

      // 헤더 여부에 따라 시작 인덱스 결정
      const startIndex = this.config.hasHeader ? 1 : 0;

      for (let i = startIndex; i < rows.length; i++) {
        const row = rows[i];
        // A:E 형식: No, Topic, Content, Difficulty, Length
        if (row.length >= 3 && row[2]) {
          const number = row[0] ? row[0].trim() : '';
          const topic = row[1] ? row[1].trim() : '';
          const content = row[2] ? row[2].trim() : ''; // Content 컬럼
          const difficulty = row[3] ? row[3].trim() : undefined;
          const length = row[4] ? row[4].trim() : undefined;

          // 제목은 No + Topic 조합
          const title = `${number} ${topic}`.trim();

          if (title && content) {
            const sentences = this.splitIntoSentences(content);

            // Extract sheet name from range
            const sheetName = this.config.range.split('!')[0];

            const article: Article = {
              id: `article-${Date.now()}-${i}`,
              number: number ? parseInt(number, 10) : undefined,
              topic,
              title,
              difficulty,
              length,
              content,
              sentences,
              sheetName,
              createdAt: new Date(),
              lastAccessed: new Date(),
            };
            articles.push(article);
          }
        }
      }

      return articles;
    } catch (error: any) {
      if (error.response) {
        if (error.response.status === 401) {
          throw new Error('인증이 만료되었습니다. 다시 로그인해주세요.');
        } else if (error.response.status === 403) {
          throw new Error('스프레드시트에 접근 권한이 없습니다.');
        } else if (error.response.status === 404) {
          throw new Error('스프레드시트를 찾을 수 없습니다. ID를 확인해주세요.');
        }
      }
      throw new Error(`데이터 가져오기 실패: ${error.message}`);
    }
  }

  /**
   * 텍스트를 문장 단위로 분리
   */
  private splitIntoSentences(text: string): SentenceEntry[] {
    const sentences: SentenceEntry[] = [];

    // 문장 끝 기호를 기준으로 분리하되, 구분자를 포함시킴
    let currentIndex = 0;
    let sentenceIndex = 1;

    const delimiterPattern = /[.!?]+/g;
    let match;

    while ((match = delimiterPattern.exec(text)) !== null) {
      const endIndex = match.index + match[0].length;
      const sentence = text.substring(currentIndex, endIndex).trim();

      if (sentence) {
        sentences.push({
          index: sentenceIndex,
          text: sentence,
        });
        sentenceIndex++;
      }

      currentIndex = endIndex;
    }

    // 마지막 남은 텍스트 처리 (구분자로 끝나지 않는 경우)
    const remaining = text.substring(currentIndex).trim();
    if (remaining) {
      sentences.push({
        index: sentenceIndex,
        text: remaining,
      });
    }

    return sentences;
  }

  /**
   * API 키 검증
   */
  async validateConfig(): Promise<boolean> {
    try {
      await this.fetchArticles();
      return true;
    } catch (error) {
      return false;
    }
  }
}
