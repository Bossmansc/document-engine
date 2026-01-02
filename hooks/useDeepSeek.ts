import { useState, useCallback } from 'react';
import { DocumentChunk } from '../types';

const DEEPSEEK_API_URL = 'https://api.deepseek.com/chat/completions';

export const useDeepSeek = (apiKey: string) => {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const analyzeChunk = useCallback(async (chunk: DocumentChunk, depth: 'quick' | 'deep' | 'thematic') => {
    if (!apiKey) throw new Error('API key not configured');

    const depthPrompts = {
      quick: 'Summarize this section briefly:',
      deep: 'Analyze this text in detail, extracting key concepts, entities, and relationships:',
      thematic: 'Identify main themes, patterns, and insights from this text:'
    };

    const prompt = `${depthPrompts[depth]}\n\n${chunk.text}`;

    try {
      setIsLoading(true);
      setError(null);

      const response = await fetch(DEEPSEEK_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model: 'deepseek-chat',
          messages: [
            {
              role: 'system',
              content: 'You are a document analysis assistant. Analyze the provided text thoroughly.'
            },
            {
              role: 'user',
              content: prompt
            }
          ],
          temperature: 0.3,
          max_tokens: 1000,
          stream: false
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`API error ${response.status}: ${errorText}`);
      }

      const data = await response.json();
      return data.choices[0]?.message?.content || 'No analysis generated';
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      setError(errorMessage);
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, [apiKey]);

  const chat = useCallback(async (message: string, context: string) => {
    if (!apiKey) throw new Error('API key not configured');

    try {
      setIsLoading(true);
      setError(null);

      const response = await fetch(DEEPSEEK_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model: 'deepseek-chat',
          messages: [
            {
              role: 'system',
              content: `You are an intelligent and conversational AI assistant. You have access to the following context from uploaded documents, but you should not feel restricted to only this information.

CONTEXT FROM DOCUMENTS:
${context}

INSTRUCTIONS:
1. Use the provided context to answer questions about specific documents.
2. If the user asks for opinions, ideas, or general conversation, feel free to use your own knowledge and formulate your own thoughts.
3. Be engaging, helpful, and conversational.
4. If you use specific facts from the context, mention the source source briefly.`
            },
            {
              role: 'user',
              content: message
            }
          ],
          temperature: 0.7,
          max_tokens: 2000,
          stream: false
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`API error ${response.status}: ${errorText}`);
      }

      const data = await response.json();
      return data.choices[0]?.message?.content || 'No response generated';
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      setError(errorMessage);
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, [apiKey]);

  return {
    analyzeChunk,
    chat,
    isLoading,
    error
  };
};
