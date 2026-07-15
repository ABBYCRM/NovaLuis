import { useState, useEffect, useCallback, useRef } from "react";
import { Link } from "wouter";
import { Bookmark, Plus, Trash2, ExternalLink, Loader2, ArrowLeft, Globe } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";

const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";

interface Favorite {
  id: number;
  url: string;
  title: string;
  description: string;
  favicon: string;
  tags: string;
  createdAt: string;
}

async function apiFetch(path: string, options?: RequestInit) {
  const res = await fetch(`${BASE}/api${path}`, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options?.headers ?? {}) },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(text || `HTTP ${res.status}`);
  }
  return res.json();
}

function FaviconImg({ src, alt }: { src: string; alt: string }) {
  const [err, setErr] = useState(false);
  if (!src || err) {
    return (
      <div className="w-5 h-5 rounded bg-gray-100 flex items-center justify-center flex-shrink-0">
        <Globe className="w-3 h-3 text-gray-400" />
      </div>
    );
  }
  return (
    <img
      src={src}
      alt={alt}
      className="w-5 h-5 rounded object-contain flex-shrink-0"
      onError={() => setErr(true)}
    />
  );
}

function FavoriteCard({
  fav,
  onDelete,
}: {
  fav: Favorite;
  onDelete: (id: number) => void;
}) {
  const [deleting, setDeleting] = useState(false);

  const handleDelete = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDeleting(true);
    try {
      await apiFetch(`/favorites/${fav.id}`, { method: "DELETE" });
      onDelete(fav.id);
    } catch {
      setDeleting(false);
    }
  };

  const displayTitle = fav.title || fav.url;
  const displayUrl = (() => {
    try {
      return new URL(fav.url).hostname;
    } catch {
      return fav.url;
    }
  })();

  return (
    <div className="group flex items-start gap-3 p-3 rounded-xl bg-white border border-gray-100 hover:border-indigo-200 hover:shadow-sm transition-all">
      <FaviconImg src={fav.favicon} alt={displayTitle} />
      <div className="flex-1 min-w-0">
        <a
          href={fav.url}
          target="_blank"
          rel="noopener noreferrer"
          className="block text-sm font-medium text-gray-900 truncate hover:text-indigo-600 transition-colors"
          title={displayTitle}
        >
          {displayTitle}
        </a>
        <span className="text-xs text-gray-400 truncate block">{displayUrl}</span>
        {fav.description && (
          <p className="text-xs text-gray-500 mt-0.5 line-clamp-2">{fav.description}</p>
        )}
      </div>
      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
        <a
          href={fav.url}
          target="_blank"
          rel="noopener noreferrer"
          className="p-1.5 rounded-lg hover:bg-indigo-50 text-gray-400 hover:text-indigo-600 transition-colors"
          title="Open"
        >
          <ExternalLink className="w-3.5 h-3.5" />
        </a>
        <button
          onClick={handleDelete}
          disabled={deleting}
          className="p-1.5 rounded-lg hover:bg-red-50 text-gray-400 hover:text-red-500 transition-colors disabled:opacity-40"
          title="Remove"
        >
          {deleting ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <Trash2 className="w-3.5 h-3.5" />
          )}
        </button>
      </div>
    </div>
  );
}

export default function Favorites() {
  const [favorites, setFavorites] = useState<Favorite[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [url, setUrl] = useState("");
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiFetch("/favorites");
      setFavorites(data.favorites ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    const raw = url.trim();
    if (!raw) return;

    // Prepend https:// if no scheme
    const fullUrl = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;

    setAdding(true);
    setAddError(null);

    try {
      // Auto-fetch metadata server-side
      let meta = { title: "", description: "", favicon: "" };
      try {
        const m = await apiFetch(
          `/favorites/metadata?url=${encodeURIComponent(fullUrl)}`,
        );
        meta = { title: m.title ?? "", description: m.description ?? "", favicon: m.favicon ?? "" };
      } catch {
        // metadata is optional — proceed without it
      }

      const data = await apiFetch("/favorites", {
        method: "POST",
        body: JSON.stringify({ url: fullUrl, ...meta }),
      });

      setFavorites((prev) => [data.favorite, ...prev]);
      setUrl("");
      inputRef.current?.focus();
    } catch (e) {
      setAddError(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setAdding(false);
    }
  };

  const handleDelete = useCallback((id: number) => {
    setFavorites((prev) => prev.filter((f) => f.id !== id));
  }, []);

  return (
    <div className="flex flex-col h-screen bg-gray-50">
      {/* Header */}
      <header className="flex items-center gap-3 px-4 py-3 bg-white border-b border-gray-100 shadow-sm flex-shrink-0">
        <Link href="/">
          <button className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-700 transition-colors">
            <ArrowLeft className="w-4 h-4" />
          </button>
        </Link>
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center">
            <Bookmark className="w-3.5 h-3.5 text-white" />
          </div>
          <span className="font-semibold text-gray-900 text-sm tracking-tight">Favorites</span>
        </div>
        {favorites.length > 0 && (
          <span className="ml-auto text-xs text-gray-400">{favorites.length} saved</span>
        )}
      </header>

      {/* Add URL form */}
      <div className="flex-shrink-0 bg-white border-b border-gray-100 px-4 py-3">
        <form onSubmit={handleAdd} className="max-w-2xl mx-auto flex gap-2">
          <Input
            ref={inputRef}
            value={url}
            onChange={(e) => {
              setUrl(e.target.value);
              setAddError(null);
            }}
            placeholder="Paste a URL to save (e.g. https://example.com)"
            className="flex-1 text-sm rounded-xl border-gray-200 focus-visible:ring-indigo-400"
            disabled={adding}
            autoFocus
          />
          <Button
            type="submit"
            disabled={!url.trim() || adding}
            size="sm"
            className="h-[38px] px-4 rounded-xl bg-indigo-600 hover:bg-indigo-700 flex-shrink-0"
          >
            {adding ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <>
                <Plus className="w-4 h-4 mr-1" />
                Save
              </>
            )}
          </Button>
        </form>
        {addError && (
          <p className="text-xs text-red-500 mt-1.5 max-w-2xl mx-auto">{addError}</p>
        )}
      </div>

      {/* List */}
      <ScrollArea className="flex-1 min-h-0">
        <div className="max-w-2xl mx-auto px-4 py-4 space-y-2">
          {loading ? (
            <div className="flex items-center justify-center py-16 text-gray-400">
              <Loader2 className="w-5 h-5 animate-spin mr-2" />
              <span className="text-sm">Loading…</span>
            </div>
          ) : error ? (
            <div className="text-center py-16">
              <p className="text-sm text-red-500 mb-3">{error}</p>
              <Button variant="outline" size="sm" onClick={load} className="rounded-xl">
                Retry
              </Button>
            </div>
          ) : favorites.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-center gap-3">
              <div className="w-12 h-12 rounded-2xl bg-gray-100 flex items-center justify-center">
                <Bookmark className="w-6 h-6 text-gray-300" />
              </div>
              <div>
                <p className="text-sm font-medium text-gray-500">No favorites yet</p>
                <p className="text-xs text-gray-400 mt-0.5">
                  Paste any URL above to save it
                </p>
              </div>
            </div>
          ) : (
            favorites.map((fav) => (
              <FavoriteCard key={fav.id} fav={fav} onDelete={handleDelete} />
            ))
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
