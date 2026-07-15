import { useState, useRef, useEffect, useCallback } from "react";
import { Link } from "wouter";
import { Send, Loader2, Zap, RotateCcw, Bookmark } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  streaming?: boolean;
}

const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

async function* streamChat(
  messages: { role: string; content: string }[],
  signal: AbortSignal,
): AsyncGenerator<string> {
  const res = await fetch(`${BASE}/api/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
    body: JSON.stringify({ model: "openclaw/default", messages, stream: true }),
    signal,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`Chat failed (${res.status}): ${text.slice(0, 200)}`);
  }

  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buf = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });

    const lines = buf.split("\n");
    buf = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const payload = trimmed.slice(5).trim();
      if (payload === "[DONE]") return;
      try {
        const chunk = JSON.parse(payload);
        const delta = chunk?.choices?.[0]?.delta?.content;
        if (typeof delta === "string" && delta) yield delta;
      } catch {
        // skip malformed chunks
      }
    }
  }
}

function UserBubble({ content }: { content: string }) {
  return (
    <div className="flex justify-end mb-4">
      <div className="max-w-[75%] bg-indigo-600 text-white rounded-2xl rounded-tr-sm px-4 py-3 text-sm leading-relaxed shadow-sm">
        {content}
      </div>
    </div>
  );
}

function AssistantBubble({ content, streaming }: { content: string; streaming?: boolean }) {
  return (
    <div className="flex justify-start mb-4 gap-3">
      <div className="flex-shrink-0 w-7 h-7 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center mt-0.5">
        <Zap className="w-3.5 h-3.5 text-white" />
      </div>
      <div className="max-w-[75%] bg-white border border-gray-100 rounded-2xl rounded-tl-sm px-4 py-3 text-sm leading-relaxed shadow-sm text-gray-800 whitespace-pre-wrap">
        {content || (streaming ? null : <span className="text-gray-400 italic">…</span>)}
        {streaming && (
          <span className="inline-block w-1 h-3.5 ml-0.5 bg-indigo-500 animate-pulse rounded-sm align-middle" />
        )}
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-5 pb-16 px-6 text-center">
      <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shadow-lg">
        <Zap className="w-7 h-7 text-white" />
      </div>
      <div>
        <h2 className="text-xl font-semibold text-gray-900 mb-1">Nova</h2>
        <p className="text-sm text-gray-500 max-w-xs">
          Autonomous AI assistant — search, scrape, code, email, and connect to 300+ apps.
        </p>
      </div>
      <div className="flex flex-wrap justify-center gap-2 max-w-sm">
        {[
          "Search the web for…",
          "Screenshot this URL",
          "Send an email to…",
          "Run Python code…",
          "What's in my Notion?",
        ].map((hint) => (
          <Badge key={hint} variant="outline" className="cursor-default text-xs text-gray-600 border-gray-200">
            {hint}
          </Badge>
        ))}
      </div>
    </div>
  );
}

export default function Home() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-scroll on new content
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const send = useCallback(async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || loading) return;

    setError(null);
    setInput("");
    textareaRef.current?.focus();

    const userMsg: Message = { id: uid(), role: "user", content: trimmed };
    const assistantId = uid();
    const assistantMsg: Message = { id: assistantId, role: "assistant", content: "", streaming: true };

    setMessages((prev) => [...prev, userMsg, assistantMsg]);
    setLoading(true);

    const history = [...messages, userMsg].map((m) => ({
      role: m.role,
      content: m.content,
    }));

    const ctrl = new AbortController();
    abortRef.current = ctrl;

    try {
      for await (const token of streamChat(history, ctrl.signal)) {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId ? { ...m, content: m.content + token } : m,
          ),
        );
      }
    } catch (err: unknown) {
      if ((err as Error)?.name === "AbortError") return;
      const msg = err instanceof Error ? err.message : "Something went wrong";
      setError(msg);
      setMessages((prev) => prev.filter((m) => m.id !== assistantId));
    } finally {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId ? { ...m, streaming: false } : m,
        ),
      );
      setLoading(false);
      abortRef.current = null;
    }
  }, [messages, loading]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send(input);
    }
  };

  const reset = () => {
    abortRef.current?.abort();
    setMessages([]);
    setInput("");
    setError(null);
    setLoading(false);
  };

  return (
    <div className="flex flex-col h-screen bg-gray-50">
      {/* Header */}
      <header className="flex items-center justify-between px-4 py-3 bg-white border-b border-gray-100 shadow-sm flex-shrink-0">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center">
            <Zap className="w-3.5 h-3.5 text-white" />
          </div>
          <span className="font-semibold text-gray-900 text-sm tracking-tight">Nova</span>
          <Badge variant="outline" className="text-[10px] text-indigo-600 border-indigo-200 bg-indigo-50 py-0">
            OpenClaw
          </Badge>
        </div>
        <div className="flex items-center gap-1 ml-auto">
          <Link href="/favorites">
            <button className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-indigo-600 transition-colors" title="Favorites">
              <Bookmark className="w-4 h-4" />
            </button>
          </Link>
          {messages.length > 0 && (
            <Button variant="ghost" size="sm" onClick={reset} className="text-gray-400 hover:text-gray-700 h-7 px-2">
              <RotateCcw className="w-3.5 h-3.5 mr-1" />
              <span className="text-xs">Clear</span>
            </Button>
          )}
        </div>
      </header>

      {/* Message list */}
      <ScrollArea className="flex-1 min-h-0">
        <div className="max-w-3xl mx-auto px-4 py-6">
          {messages.length === 0 ? (
            <EmptyState />
          ) : (
            messages.map((m) =>
              m.role === "user" ? (
                <UserBubble key={m.id} content={m.content} />
              ) : (
                <AssistantBubble key={m.id} content={m.content} streaming={m.streaming} />
              ),
            )
          )}
          {error && (
            <div className="flex justify-center mb-4">
              <div className="bg-red-50 border border-red-200 text-red-700 text-xs rounded-xl px-4 py-2.5 max-w-md text-center">
                {error}
              </div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>
      </ScrollArea>

      {/* Input */}
      <div className="flex-shrink-0 border-t border-gray-100 bg-white px-4 py-3">
        <div className="max-w-3xl mx-auto flex gap-2.5 items-end">
          <Textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Message Nova… (Enter to send, Shift+Enter for new line)"
            rows={1}
            className="flex-1 resize-none min-h-[42px] max-h-40 text-sm rounded-xl border-gray-200 focus-visible:ring-indigo-400 overflow-y-auto"
            style={{ height: "auto" }}
            onInput={(e) => {
              const el = e.currentTarget;
              el.style.height = "auto";
              el.style.height = Math.min(el.scrollHeight, 160) + "px";
            }}
            disabled={loading}
          />
          <Button
            onClick={() => loading ? abortRef.current?.abort() : send(input)}
            disabled={!loading && !input.trim()}
            size="sm"
            className={`h-[42px] w-[42px] p-0 rounded-xl flex-shrink-0 ${
              loading
                ? "bg-red-500 hover:bg-red-600"
                : "bg-indigo-600 hover:bg-indigo-700"
            }`}
          >
            {loading ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Send className="w-4 h-4" />
            )}
          </Button>
        </div>
        <p className="text-center text-[10px] text-gray-400 mt-2">
          Nova may use tools — search, code execution, email, and connected apps.
        </p>
      </div>
    </div>
  );
}
