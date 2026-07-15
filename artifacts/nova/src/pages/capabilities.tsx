import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";

interface Integration {
  id: string;
  name: string;
  category: string;
  description: string;
  tools: string[];
  status: "active" | "missing";
  envKey: string;
}

interface CapabilitiesResponse {
  active: number;
  total: number;
  integrations: Integration[];
  byCategory: Record<string, Integration[]>;
}

const CATEGORY_ICONS: Record<string, string> = {
  LLM: "🧠",
  Search: "🔍",
  Scraping: "🕷️",
  Screenshot: "📸",
  "Code Execution": "💻",
  Email: "📧",
  Memory: "🗄️",
  Integrations: "🔌",
  Observability: "📊",
};

async function fetchCapabilities(): Promise<CapabilitiesResponse> {
  const res = await fetch("/api/capabilities");
  if (!res.ok) throw new Error("Failed to load capabilities");
  return res.json();
}

function IntegrationCard({ integration }: { integration: Integration }) {
  const active = integration.status === "active";
  return (
    <Card
      className={`transition-all border ${
        active ? "border-green-200 bg-white" : "border-gray-200 bg-gray-50 opacity-60"
      }`}
    >
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-semibold text-gray-900">
            {integration.name}
          </CardTitle>
          <span
            className={`inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full ${
              active
                ? "bg-green-100 text-green-700"
                : "bg-gray-200 text-gray-500"
            }`}
          >
            <span
              className={`w-1.5 h-1.5 rounded-full ${active ? "bg-green-500" : "bg-gray-400"}`}
            />
            {active ? "Active" : "Missing key"}
          </span>
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        <p className="text-xs text-gray-500 leading-relaxed">{integration.description}</p>
        <div className="flex flex-wrap gap-1 pt-1">
          {integration.tools.map((tool) => (
            <Badge
              key={tool}
              variant="secondary"
              className="text-[10px] font-mono bg-blue-50 text-blue-700 border-0"
            >
              {tool}
            </Badge>
          ))}
        </div>
        {!active && (
          <p className="text-[10px] text-gray-400 font-mono pt-1">
            needs: {integration.envKey}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

export default function Capabilities() {
  const { data, isLoading, error } = useQuery<CapabilitiesResponse>({
    queryKey: ["capabilities"],
    queryFn: fetchCapabilities,
    refetchInterval: 30_000,
  });

  const categories = data ? Object.keys(data.byCategory) : [];

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b px-6 py-4">
        <div className="max-w-7xl mx-auto">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-xl font-bold text-gray-900 flex items-center gap-2">
                <span className="text-purple-600">⚡</span> Nova Capabilities
              </h1>
              <p className="text-xs text-gray-500 mt-0.5">
                {isLoading
                  ? "Loading integrations…"
                  : `${data?.active ?? 0} of ${data?.total ?? 0} integrations active`}
              </p>
            </div>
            {data && (
              <div className="flex items-center gap-3">
                <div className="text-right">
                  <div className="text-2xl font-bold text-green-600">
                    {data.active}
                  </div>
                  <div className="text-[10px] text-gray-400 uppercase tracking-wide">
                    Active
                  </div>
                </div>
                <div className="w-px h-8 bg-gray-200" />
                <div className="text-right">
                  <div className="text-2xl font-bold text-gray-400">
                    {data.total - data.active}
                  </div>
                  <div className="text-[10px] text-gray-400 uppercase tracking-wide">
                    Inactive
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Progress bar */}
          {data && (
            <div className="mt-3 h-1.5 bg-gray-100 rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-green-400 to-green-600 rounded-full transition-all duration-700"
                style={{ width: `${(data.active / data.total) * 100}%` }}
              />
            </div>
          )}
        </div>
      </div>

      {/* Body */}
      <div className="max-w-7xl mx-auto px-6 py-8 space-y-10">
        {error && (
          <Alert variant="destructive">
            <AlertDescription>
              Failed to load capabilities — is the API server running?
            </AlertDescription>
          </Alert>
        )}

        {isLoading &&
          Array.from({ length: 3 }).map((_, ci) => (
            <div key={ci}>
              <Skeleton className="h-5 w-40 mb-4" />
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {Array.from({ length: 3 }).map((_, i) => (
                  <Card key={i}>
                    <CardHeader className="pb-2">
                      <Skeleton className="h-4 w-28" />
                    </CardHeader>
                    <CardContent>
                      <Skeleton className="h-3 w-full" />
                      <Skeleton className="h-3 w-3/4 mt-1" />
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          ))}

        {!isLoading &&
          categories.map((category) => {
            const items = data!.byCategory[category];
            const activeCount = items.filter((i) => i.status === "active").length;
            return (
              <section key={category}>
                <div className="flex items-center gap-2 mb-4">
                  <span className="text-xl">{CATEGORY_ICONS[category] ?? "🔧"}</span>
                  <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">
                    {category}
                  </h2>
                  <span className="text-xs text-gray-400">
                    {activeCount}/{items.length} active
                  </span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {items.map((integration) => (
                    <IntegrationCard key={integration.id} integration={integration} />
                  ))}
                </div>
              </section>
            );
          })}
      </div>
    </div>
  );
}
