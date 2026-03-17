/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * @license
 */

/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-type-assertion */

/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  CountTokensParameters,
  CountTokensResponse,
  EmbedContentParameters,
  EmbedContentResponse,
  GenerateContentParameters,
  GenerateContentResponse,
  Content,
  Part,
  Tool,
} from '@google/genai';
import type { Config } from '../config/config.js';
import type { ContentGeneratorConfig, ContentGenerator } from './contentGenerator.js';
import type { LlmRole } from '../telemetry/llmRole.js';
import { debugLogger } from '../utils/debugLogger.js';

export class OpenAiContentGenerator implements ContentGenerator {
  constructor(
    private readonly config: ContentGeneratorConfig,
    private readonly gcConfig: Config
  ) {}

  private mapToOpenAiMessages(contentsUnion: any, systemInstruction?: any) {
    const messages: any[] = [];
    if (systemInstruction) {
      let text = '';
      if (typeof systemInstruction === 'string') {
        text = systemInstruction;
      } else if (systemInstruction.parts) {
        text = systemInstruction.parts.map((p: any) => p.text).join('\n');
      }
      messages.push({ role: 'system', content: text });
    }
    
    let contents: Content[] = [];
    if (typeof contentsUnion === 'string') {
      contents = [{ role: 'user', parts: [{ text: contentsUnion }] }];
    } else if (Array.isArray(contentsUnion)) {
      contents = contentsUnion as Content[];
    } else {
      contents = [contentsUnion as Content];
    }
    
    for (const content of contents) {
      const role = content.role === 'model' ? 'assistant' : 'user';
      if (content.parts?.some(p => p.functionCall || p.functionResponse)) {
        // Simple mapping for tools if needed, but for now we might just map text
        // If there is function call, we format it as OpenAI tool call
        const toolCalls = content.parts.filter(p => p.functionCall).map((p, i) => ({
          id: `call_${i}`,
          type: 'function',
          function: {
            name: p.functionCall!.name,
            arguments: JSON.stringify(p.functionCall!.args || {})
          }
        }));
        if (toolCalls.length > 0) {
          messages.push({ role, tool_calls: toolCalls });
          continue;
        }

        const toolResponses = content.parts.filter(p => p.functionResponse);
        for (const p of toolResponses) {
          messages.push({
            role: 'tool',
            tool_call_id: `call_0`, // simplistic mapping
            name: p.functionResponse!.name,
            content: JSON.stringify(p.functionResponse!.response || {})
          });
        }
        continue;
      }
      const text = content.parts?.map(p => p.text).join('') || '';
      messages.push({ role, content: text });
    }
    return messages;
  }

  private mapTools(tools?: Tool[]) {
    if (!tools) return undefined;
    const openaiTools: any[] = [];
    for (const tool of tools) {
      if (tool.functionDeclarations) {
        for (const fd of tool.functionDeclarations) {
          openaiTools.push({
            type: 'function',
            function: {
              name: fd.name,
              description: fd.description,
              parameters: fd.parameters,
            }
          });
        }
      }
    }
    return openaiTools.length > 0 ? openaiTools : undefined;
  }

  async generateContent(
    request: GenerateContentParameters,
    _userPromptId: string,
    _role: LlmRole
  ): Promise<GenerateContentResponse> {
    const baseUrl = this.config.baseUrl || 'https://api.openai.com/v1';
    const endpoint = baseUrl.endsWith('/chat/completions') ? baseUrl : `${baseUrl.replace(/\/$/, '')}/chat/completions`;
    const model = request.model || this.gcConfig.getModel();

    const body = {
      model,
      messages: this.mapToOpenAiMessages(request.contents, request.config?.systemInstruction),
      tools: this.mapTools(request.config?.tools as Tool[]),
      temperature: request.config?.temperature,
      top_p: request.config?.topP,
      max_tokens: request.config?.maxOutputTokens,
      stream: false,
    };

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.config.apiKey}`,
        ...this.config.customHeaders,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`OpenAI API Error: ${response.status} ${response.statusText}\n${text}`);
    }

    const data = await response.json();
    const choice = data.choices[0];
    
    const parts: Part[] = [];
    if (choice.message.content) {
      parts.push({ text: choice.message.content });
    }
    if (choice.message.tool_calls) {
      for (const tc of choice.message.tool_calls) {
        if (tc.type === 'function') {
          parts.push({
            functionCall: {
              name: tc.function.name,
              args: JSON.parse(tc.function.arguments || '{}')
            }
          });
        }
      }
    }

    return {
      candidates: [{
        content: { parts, role: 'model' },
        finishReason: choice.finish_reason === 'tool_calls' ? 'STOP' : choice.finish_reason?.toUpperCase() || 'STOP',
      }],
      usageMetadata: {
        promptTokenCount: data.usage?.prompt_tokens,
        candidatesTokenCount: data.usage?.completion_tokens,
        totalTokenCount: data.usage?.total_tokens,
      }
    } as GenerateContentResponse;
  }

  async generateContentStream(
    request: GenerateContentParameters,
    _userPromptId: string,
    _role: LlmRole
  ): Promise<AsyncGenerator<GenerateContentResponse>> {
    const baseUrl = this.config.baseUrl || 'https://api.openai.com/v1';
    const endpoint = baseUrl.endsWith('/chat/completions') ? baseUrl : `${baseUrl.replace(/\/$/, '')}/chat/completions`;
    const model = request.model || this.gcConfig.getModel();

    const body = {
      model,
      messages: this.mapToOpenAiMessages(request.contents, request.config?.systemInstruction),
      tools: this.mapTools(request.config?.tools as Tool[]),
      temperature: request.config?.temperature,
      top_p: request.config?.topP,
      max_tokens: request.config?.maxOutputTokens,
      stream: true,
    };

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.config.apiKey}`,
        ...this.config.customHeaders,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`OpenAI API Error: ${response.status} ${response.statusText}\n${text}`);
    }

    if (!response.body) {
      throw new Error('Response body is null');
    }

    const generator = async function* () {
      // Using undici text() or arrayBuffer() isn't ideal for streams, 
      // but Node 20 fetch response body is an AsyncIterable<Uint8Array>.
      // So we can iterate over response.body directly.
      const decoder = new TextDecoder('utf-8');
      let buffer = '';

      for await (const chunk of response.body as any as AsyncIterable<Uint8Array>) {
        buffer += decoder.decode(chunk, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.trim() === '' || line.trim() === 'data: [DONE]') continue;
          if (line.startsWith('data: ')) {
            const dataStr = line.substring(6);
            try {
              const data = JSON.parse(dataStr);
              const choice = data.choices[0];
              if (!choice) continue;

              const parts: Part[] = [];
              if (choice.delta?.content) {
                parts.push({ text: choice.delta.content });
              }
              if (choice.delta?.tool_calls) {
                // Basic streaming tool call parser
                // Not fully supported in stream without buffer, but we do basic
                // We'll pass it as text or skip it for now to avoid breaking.
                // To handle streaming tool calls we'd need a buffer for JSON args.
                // For simplicity, we ignore it here and rely on the model generating text.
              }
              
              if (parts.length > 0) {
                yield {
                  candidates: [{
                    content: { parts, role: 'model' },
                    finishReason: choice.finish_reason ? choice.finish_reason.toUpperCase() : undefined,
                  }]
                } as GenerateContentResponse;
              }
            } catch (e) {
              debugLogger.error('Error parsing SSE data', e, dataStr);
            }
          }
        }
      }
    };

    return generator();
  }

  async countTokens(
    _request: CountTokensParameters
  ): Promise<CountTokensResponse> {
    return {
      totalTokens: 0,
    } as CountTokensResponse;
  }

  async embedContent(
    _request: EmbedContentParameters
  ): Promise<EmbedContentResponse> {
    throw new Error('Embeddings not supported for OpenAI yet');
  }
}
