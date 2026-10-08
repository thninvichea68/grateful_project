import {
  Fragment,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { assistantStatus, streamChat, type ChatMessage } from '../lib/assistant';
import { icons } from './icons';
import khmerFont from '@fontsource/khmer/files/khmer-khmer-400-normal.woff2';

// Google's "Khmer" font, self-hosted (the CSP blocks Google Fonts). Registered for Khmer
// characters only, so English in the chat keeps the app font. Only downloaded when used.
if (typeof FontFace !== 'undefined' && typeof document !== 'undefined' && document.fonts) {
  document.fonts.add(
    new FontFace('GS Khmer', `url(${khmerFont}) format('woff2')`, {
      unicodeRange: 'U+1780-17FF, U+19E0-19FF, U+200C-200D, U+25CC',
      display: 'swap',
    }),
  );
}

const SUGGESTIONS = [
  'How do I create a new shipment?',
  'Where can I see unpaid invoices?',
  'How do I import a CDC master list?',
  'What does CY / CY mean?',
];

/** Panel width: the default is also the minimum; drag the left edge to widen it. */
const MIN_WIDTH = 420;
const WIDTH_KEY = 'gs:ai-panel-width';
const maxWidth = () => Math.max(MIN_WIDTH, Math.min(960, window.innerWidth - 80));
const clampWidth = (w: number) => Math.round(Math.min(Math.max(w, MIN_WIDTH), maxWidth()));

function readWidth(): number {
  try {
    const saved = Number(localStorage.getItem(WIDTH_KEY));
    return saved ? clampWidth(saved) : MIN_WIDTH;
  } catch {
    return MIN_WIDTH;
  }
}

/** "Ask AI" top-bar button and the help-assistant chat panel it opens. */
export function AskAi() {
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ message: string; question?: string } | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [width, setWidth] = useState(readWidth);
  const [resizing, setResizing] = useState(false);

  useEffect(() => {
    try {
      localStorage.setItem(WIDTH_KEY, String(width));
    } catch {
      /* private mode */
    }
  }, [width]);

  function onResizeStart(e: ReactPointerEvent<HTMLDivElement>) {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    setResizing(true);
  }
  function onResizeMove(e: ReactPointerEvent<HTMLDivElement>) {
    if (resizing) setWidth(clampWidth(window.innerWidth - e.clientX));
  }
  function onResizeKey(e: ReactKeyboardEvent<HTMLDivElement>) {
    const step = e.shiftKey ? 80 : 20;
    if (e.key === 'ArrowLeft') setWidth((w) => clampWidth(w + step));
    else if (e.key === 'ArrowRight') setWidth((w) => clampWidth(w - step));
    else if (e.key === 'Home') setWidth(MIN_WIDTH);
    else if (e.key === 'End') setWidth(maxWidth());
    else return;
    e.preventDefault();
  }
  const status = useQuery({
    queryKey: ['assistant', 'status'],
    queryFn: assistantStatus,
    enabled: open,
    staleTime: 5 * 60_000,
  });
  const disabled = status.data?.enabled === false;

  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages, error]);

  useEffect(() => () => abortRef.current?.abort(), []);

  async function ask(question: string) {
    const text = question.trim();
    if (!text || busy) return;
    const history: ChatMessage[] = [...messages, { role: 'user', content: text }];
    // Send the last ~20 messages, starting with a question (the APIs reject a leading answer).
    let recent = history.slice(-21);
    while (recent[0]?.role === 'assistant') recent = recent.slice(1);
    setMessages([...history, { role: 'assistant', content: '' }]);
    setInput('');
    setError(null);
    setBusy(true);
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      await streamChat(
        recent,
        location.pathname,
        (chunk) => {
          setMessages((m) => {
            const last = m[m.length - 1]!;
            return [...m.slice(0, -1), { ...last, content: last.content + chunk }];
          });
        },
        ctrl.signal,
      );
    } catch (err) {
      if (ctrl.signal.aborted) return;
      const message = err instanceof Error ? err.message : 'Something went wrong.';
      setMessages((m) => {
        // Keep a partial answer. With no answer at all, take the question out of the history
        // (so the next request doesn't hold two questions in a row) and offer Retry instead.
        if (m[m.length - 1]?.content) {
          setError({ message });
          return m;
        }
        setError({ message, question: text });
        return m.slice(0, -2);
      });
    } finally {
      if (abortRef.current === ctrl) abortRef.current = null;
      setBusy(false);
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    void ask(input);
  }

  function reset() {
    abortRef.current?.abort();
    setMessages([]);
    setError(null);
    setBusy(false);
    inputRef.current?.focus();
  }

  return (
    <>
      <button
        type="button"
        className="ask-ai-btn"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls="ask-ai-panel"
      >
        {icons.bolt({})}
        Ask AI
      </button>

      <aside
        id="ask-ai-panel"
        className={`ai-panel${open ? ' open' : ''}${resizing ? ' resizing' : ''}`}
        style={{ width: `min(${width}px, 100vw)` }}
        aria-label="AI assistant"
        aria-hidden={!open}
      >
        <div
          className="ai-resize"
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize assistant panel"
          aria-valuemin={MIN_WIDTH}
          aria-valuemax={960}
          aria-valuenow={width}
          tabIndex={0}
          title="Drag to resize · double-click to reset"
          onPointerDown={onResizeStart}
          onPointerMove={onResizeMove}
          onPointerUp={() => setResizing(false)}
          onPointerCancel={() => setResizing(false)}
          onDoubleClick={() => setWidth(MIN_WIDTH)}
          onKeyDown={onResizeKey}
        />
        <header className="ai-panel-head">
          <div className="ai-panel-title">
            {icons.bolt({})}
            <div>
              <div className="name">Ask AI</div>
              <div className="sub">Your guide to GS Command Center</div>
            </div>
          </div>
          {messages.length > 0 && (
            <button type="button" className="ai-panel-link" onClick={reset}>
              New chat
            </button>
          )}
          <button
            type="button"
            className="ai-panel-close"
            onClick={() => setOpen(false)}
            aria-label="Close assistant"
          >
            {icons.close({})}
          </button>
        </header>

        <div className="ai-panel-body" ref={listRef} aria-live="polite">
          {messages.length === 0 && (
            <div className="ai-welcome">
              <p>
                Hi! Ask me how to do something in the system, where to find a page, or what a field
                or term means.
              </p>
              <div className="ai-suggestions">
                {SUGGESTIONS.map((s) => (
                  <button key={s} type="button" onClick={() => void ask(s)} disabled={disabled}>
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}
          {messages.map((m, i) => (
            <div key={i} className={`ai-msg ${m.role}`}>
              {m.role === 'assistant' ? (
                m.content ? (
                  <Markdown text={m.content} />
                ) : (
                  <span className="ai-typing" aria-label="Thinking">
                    <i />
                    <i />
                    <i />
                  </span>
                )
              ) : (
                m.content
              )}
            </div>
          ))}
          {error && (
            <div className="ai-error">
              {error.question && <div className="ai-error-q">“{error.question}”</div>}
              {error.message}
              {error.question && (
                <button
                  type="button"
                  className="ai-retry"
                  onClick={() => void ask(error.question!)}
                  disabled={busy}
                >
                  Retry
                </button>
              )}
            </div>
          )}
          {disabled && (
            <div className="ai-error">
              The assistant is not set up yet. An administrator must add an AI API key to the server
              configuration.
            </div>
          )}
        </div>

        <form className="ai-input" onSubmit={onSubmit}>
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                void ask(input);
              }
            }}
            placeholder="Ask anything about the system…"
            aria-label="Your question"
            rows={1}
            maxLength={4000}
            disabled={disabled}
          />
          <button type="submit" aria-label="Send" disabled={busy || disabled || !input.trim()}>
            {icons.send({})}
          </button>
        </form>
        <p className="ai-disclaimer">AI answers can be wrong. Check important steps.</p>
      </aside>
    </>
  );
}

/* ---------- Minimal, safe Markdown: paragraphs, lists, **bold**, `code`, [links](/path). ---------- */

function inline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /\*\*([^*]+)\*\*|`([^`]+)`|\[([^\]]+)\]\(([^)\s]+)\)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const key = out.length;
    if (m[1]) out.push(<strong key={key}>{m[1]}</strong>);
    else if (m[2]) out.push(<code key={key}>{m[2]}</code>);
    else if (m[4]!.startsWith('/') && !m[4]!.startsWith('//'))
      out.push(
        <Link key={key} to={m[4]!}>
          {m[3]}
        </Link>,
      );
    else out.push(m[3]); // external links are shown as plain text
    last = re.lastIndex;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

function Markdown({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  const flush = () => {
    if (!list) return;
    const items = list.items.map((it, i) => <li key={i}>{inline(it)}</li>);
    blocks.push(
      list.ordered ? <ol key={blocks.length}>{items}</ol> : <ul key={blocks.length}>{items}</ul>,
    );
    list = null;
  };
  for (const raw of text.split('\n')) {
    const line = raw.trimEnd();
    const ol = /^\s*[\d០-៩]+[.)]\s+(.*)$/.exec(line);
    const ul = /^\s*[-*•]\s+(.*)$/.exec(line);
    if (ol || ul) {
      const ordered = Boolean(ol);
      if (list && list.ordered !== ordered) flush();
      list ??= { ordered, items: [] };
      list.items.push((ol ?? ul)![1]!);
    } else if (!line.trim()) {
      flush();
    } else {
      flush();
      const h = /^#{1,6}\s+(.*)$/.exec(line);
      blocks.push(
        h ? (
          <p key={blocks.length}>
            <strong>{inline(h[1]!)}</strong>
          </p>
        ) : (
          <p key={blocks.length}>{inline(line)}</p>
        ),
      );
    }
  }
  flush();
  return <Fragment>{blocks}</Fragment>;
}
