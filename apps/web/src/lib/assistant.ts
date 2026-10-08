import { ApiError, api, refreshSession, session } from './api';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export const assistantStatus = () => api<{ enabled: boolean }>('/assistant/status');

/**
 * Sends the conversation to the "Ask AI" endpoint and calls `onText` with each chunk of
 * the answer as it streams in. Resolves when the answer is complete.
 */
export async function streamChat(
  messages: ChatMessage[],
  page: string,
  onText: (chunk: string) => void,
  signal: AbortSignal,
  retried = false,
): Promise<void> {
  const res = await fetch('/api/v1/assistant/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...session.authHeader() },
    credentials: 'include',
    body: JSON.stringify({ messages, page }),
    signal,
  });
  if (res.status === 401 && !retried && (await refreshSession())) {
    return streamChat(messages, page, onText, signal, true);
  }
  if (!res.ok || !res.body) {
    let message = `Request failed (${res.status})`;
    try {
      message = ((await res.json()) as { error?: { message?: string } }).error?.message ?? message;
    } catch {
      /* non-JSON error */
    }
    throw new ApiError(res.status, 'INTERNAL', message);
  }

  // Newline-delimited JSON: {"text"} chunks, then {"done"} or {"error"}.
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += value;
    let nl: number;
    while ((nl = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line) continue;
      const evt = JSON.parse(line) as { text?: string; error?: string; done?: boolean };
      if (evt.text) onText(evt.text);
      if (evt.error) throw new ApiError(502, 'INTERNAL', evt.error);
      if (evt.done) return;
    }
  }
  throw new ApiError(502, 'INTERNAL', 'The answer was cut off. Try again.');
}
