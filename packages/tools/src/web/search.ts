import { z } from "zod";
import { readResponseTextWithinLimit } from "@orbit-build/shared";
import type { OrbitTool, ToolContext, ToolResult } from "../types.js";

const SEARCH_JSON_RESPONSE_MAX_BYTES = 1024 * 1024;
const SEARCH_PAGE_RESPONSE_MAX_BYTES = 4 * 1024 * 1024;

export const WebSearchInputSchema = z.object({
  query: z
    .string()
    .trim()
    .min(1)
    .max(2048)
    .describe(
      "Search query. Resolve relative dates using the Runtime Context current date before adding date terms; do not add stale years from model memory.",
    ),
  maxResults: z
    .number()
    .int()
    .min(1)
    .max(20)
    .describe("Maximum number of search results to return, from 1 to 20.")
    .optional(),
});

export type WebSearchInput = z.infer<typeof WebSearchInputSchema>;

const SearchApiEnvelopeSchema = z.object({
  results: z.array(z.unknown()).max(1000).catch([]),
});

const SearxngResultSchema = z.object({
  title: z.string(),
  url: z.string().optional(),
  link: z.string().optional(),
  content: z.string().optional(),
  snippet: z.string().optional(),
});

const TavilyResultSchema = z.object({
  title: z.string(),
  url: z.string(),
  content: z.string().optional(),
  snippet: z.string().optional(),
});

const WeatherScalarSchema = z.union([z.string(), z.number(), z.null()]);

const OpenMeteoLocationSchema = z.object({
  name: z.string().optional(),
  country: z.string().optional(),
  admin1: z.string().optional(),
  latitude: z.number().optional(),
  longitude: z.number().optional(),
  timezone: z.string().optional(),
});

const OpenMeteoGeocodingResponseSchema = z.object({
  results: z.array(OpenMeteoLocationSchema).max(1000).optional(),
});

const OpenMeteoForecastResponseSchema = z.object({
  current: z.record(WeatherScalarSchema).optional(),
  current_units: z.record(z.string()).optional(),
  daily: z.record(z.array(WeatherScalarSchema).max(1000)).optional(),
  daily_units: z.record(z.string()).optional(),
  timezone: z.string().optional(),
});

interface SearchResult {
  title: string;
  link: string;
  snippet: string;
  publishedAt?: string;
}

interface SearchStrategy {
  name: string;
  url: string;
  priority: number;
  method?: "GET" | "POST";
  userAgent?: string;
  headers?: Record<string, string>;
  body?: string;
  parser: (body: string) => SearchResult[];
  timeoutMs: number;
}

interface SearchQuality {
  score: number;
  label: "high" | "medium" | "low";
  matchedTerms: number;
  queryTerms: number;
  withSnippets: number;
  freshResults: number;
}

type OpenMeteoLocation = z.infer<typeof OpenMeteoLocationSchema>;
type OpenMeteoGeocodingResponse = z.infer<
  typeof OpenMeteoGeocodingResponseSchema
>;
type OpenMeteoForecastResponse = z.infer<
  typeof OpenMeteoForecastResponseSchema
>;

export class WebSearchTool implements OrbitTool<WebSearchInput, string> {
  name = "web_search";
  description =
    "Search the live web for current documentation, API usage, technical references, weather, or news. Resolve today/tomorrow/yesterday/latest against the Runtime Context date before forming the query. Weather queries use a direct no-key Open-Meteo data source first, then configured SearXNG/Tavily/Bing/DuckDuckGo backends as fallback.";
  inputSchema = WebSearchInputSchema;
  risk = "network" as const;

  private normalizeBaseUrl(url: string): string {
    return url.replace(/\/+$/, "");
  }

  private envList(...names: string[]): string[] {
    return names
      .flatMap((name) => (process.env[name] || "").split(","))
      .map((value) => value.trim())
      .filter(Boolean);
  }

  private readPositiveInteger(value: unknown): number | undefined {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
    return Math.trunc(parsed);
  }

  private resolveMaxResults(input: WebSearchInput, ctx: ToolContext): number {
    const config = ctx.config?.tools?.webSearch;
    const configured =
      this.readPositiveInteger(input.maxResults) ??
      this.readPositiveInteger(process.env.ORBIT_WEB_SEARCH_MAX_RESULTS) ??
      this.readPositiveInteger(config?.maxResults) ??
      5;
    return Math.max(1, Math.min(20, configured));
  }

  private resolveTimeoutMs(ctx: ToolContext): number {
    const config = ctx.config?.tools?.webSearch;
    const configured =
      this.readPositiveInteger(process.env.ORBIT_WEB_SEARCH_TIMEOUT_MS) ??
      this.readPositiveInteger(config?.timeoutMs) ??
      8000;
    return Math.max(1000, Math.min(30000, configured));
  }

  private limitResults(results: SearchResult[], maxResults: number) {
    const seen = new Set<string>();
    const deduped: SearchResult[] = [];
    for (const result of results) {
      if (!result.link || seen.has(result.link)) continue;
      seen.add(result.link);
      deduped.push(result);
      if (deduped.length >= maxResults) break;
    }
    return deduped;
  }

  private queryTerms(query: string): string[] {
    const stop = new Set([
      "the",
      "and",
      "for",
      "with",
      "today",
      "tomorrow",
      "weather",
      "news",
      "headline",
      "headlines",
      "breaking",
      "latest",
      "what",
      "happened",
      "happening",
      "any",
      "search",
      "query",
      "请",
      "帮我",
      "查询",
      "搜索",
      "一下",
      "今天",
      "今日",
      "最新",
      "实时",
      "新闻",
      "热点",
      "头条",
      "有啥",
      "有什么",
      "有哪些",
      "发生了什么",
      "最近",
      "明天",
      "天气",
    ]);
    const normalized = query
      .toLowerCase()
      .replace(
        /\b\d{4}\s*[-/.年]\s*\d{1,2}\s*(?:[-/.月]\s*)\d{1,2}\s*(?:日|号)?\b/g,
        " ",
      )
      .replace(
        /(?:今天|今日|最新|实时|新闻|热点|头条|国内新闻|国际新闻)/g,
        " ",
      );
    return Array.from(
      new Set(
        normalized
          .replace(/[^\p{L}\p{N}\s-]/gu, " ")
          .split(/\s+/)
          .map((term) => term.trim())
          .filter((term) => term.length >= 2 && !stop.has(term)),
      ),
    ).slice(0, 8);
  }

  private scoreSearchQuality(
    query: string,
    results: SearchResult[],
  ): SearchQuality {
    const terms = this.queryTerms(query);
    const withSnippets = results.filter(
      (result) => result.snippet.length > 20,
    ).length;
    const matched = new Set<string>();
    for (const result of results) {
      const haystack =
        `${result.title} ${result.snippet} ${result.link}`.toLowerCase();
      for (const term of terms) {
        if (haystack.includes(term)) {
          matched.add(term);
        }
      }
    }

    const snippetScore =
      results.length > 0 ? Math.min(1, withSnippets / results.length) : 0;
    const termScore =
      terms.length > 0 ? Math.min(1, matched.size / terms.length) : 0.5;
    const requiresFreshNews = this.requiresFreshNews(query);
    const freshResults = requiresFreshNews
      ? results.filter((result) => this.isFreshNewsResult(result)).length
      : 0;
    const freshnessScore =
      results.length > 0 ? Math.min(1, freshResults / results.length) : 0;
    const score = Math.max(
      0,
      Math.min(
        1,
        requiresFreshNews
          ? termScore * 0.45 + snippetScore * 0.2 + freshnessScore * 0.35
          : termScore * 0.65 + snippetScore * 0.35,
      ),
    );
    const label = score >= 0.7 ? "high" : score >= 0.4 ? "medium" : "low";
    return {
      score,
      label,
      matchedTerms: matched.size,
      queryTerms: terms.length,
      withSnippets,
      freshResults,
    };
  }

  private isAcceptableSearchQuality(
    query: string,
    quality: SearchQuality,
  ): boolean {
    if (quality.label === "low") return false;
    if (quality.queryTerms > 0 && quality.matchedTerms === 0) return false;
    return !this.requiresFreshNews(query) || quality.freshResults > 0;
  }

  private isNewsQuery(query: string): boolean {
    return /(?:新闻|热点|头条|\bnews\b|\bheadline|\bbreaking\b)/i.test(query);
  }

  private requiresFreshNews(query: string): boolean {
    if (!this.isNewsQuery(query)) return false;
    if (
      /\b(?:19|20)\d{2}\s*[-/.年]\s*\d{1,2}(?:\s*[-/.月]\s*\d{1,2})?/i.test(
        query,
      )
    ) {
      return false;
    }
    const requestedYear = /\b((?:19|20)\d{2})\b/.exec(query)?.[1];
    return !requestedYear || Number(requestedYear) >= new Date().getFullYear();
  }

  private isFreshNewsResult(result: SearchResult): boolean {
    if (!result.publishedAt) return false;
    const publishedAt = Date.parse(result.publishedAt);
    if (!Number.isFinite(publishedAt)) return false;
    const ageMs = Date.now() - publishedAt;
    return ageMs >= -6 * 60 * 60 * 1000 && ageMs <= 72 * 60 * 60 * 1000;
  }

  private isWeatherQuery(query: string): boolean {
    return /(?:天气|气温|温度|预报|降雨|下雨|小雨|中雨|大雨|weather|forecast|temperature|rain|precipitation)/i.test(
      query,
    );
  }

  private extractWeatherLocation(query: string): string {
    const cleaned = query
      .replace(/site:\S+/gi, " ")
      .replace(/https?:\/\/\S+/gi, " ")
      .replace(
        /\b\d{4}\s*[-/.年]\s*\d{1,2}\s*(?:[-/.月]\s*)\d{1,2}\s*(?:日|号)?\b/g,
        " ",
      )
      .replace(
        /\b(?:today|tomorrow|yesterday|now|current|weather|forecast|temperature|temp|rain|raining|precipitation|in|for|on|the|please|check|search|query)\b/gi,
        " ",
      )
      .replace(
        /(?:今天|今日|明天|后天|昨天|现在|当前|实时|天气|气温|温度|预报|降雨|下雨|小雨|中雨|大雨|暴雨|查询|查查|看看|帮我|一下|的|多少|怎么样|如何)/g,
        " ",
      )
      .replace(/[?？,，。.;；:：()[\]{}"'“”‘’]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    const tokens = cleaned
      .split(/\s+/)
      .map((token) => token.trim())
      .filter((token) => token.length > 0 && !/^\d+$/.test(token));
    return tokens.slice(0, 3).join(" ") || query.trim();
  }

  private formatDate(date: Date, timeZone?: string): string {
    if (timeZone) {
      try {
        const parts = new Intl.DateTimeFormat("en-US", {
          timeZone,
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
        }).formatToParts(date);
        const values = new Map(parts.map((part) => [part.type, part.value]));
        const year = values.get("year");
        const month = values.get("month");
        const day = values.get("day");
        if (year && month && day) return `${year}-${month}-${day}`;
      } catch {
        // Invalid or unavailable time zones safely fall back to local time.
      }
    }
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  private addDays(date: Date, days: number): Date {
    const next = new Date(date);
    next.setDate(next.getDate() + days);
    return next;
  }

  private extractRequestedDate(
    query: string,
    timeZone?: string,
  ): string | null {
    const normalized = query
      .replace(/[年月]/g, "-")
      .replace(/[日号]/g, "")
      .replace(/\//g, "-");
    const explicit = /(\d{4})\s*[-.]\s*(\d{1,2})\s*[-.]\s*(\d{1,2})/.exec(
      normalized,
    );
    if (explicit) {
      const [, year, month, day] = explicit;
      return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
    }

    const now = new Date();
    if (/(?:今天|今日|\btoday\b|\bnow\b|\bcurrent\b)/i.test(query)) {
      return this.formatDate(now, timeZone);
    }
    if (/(?:明天|\btomorrow\b)/i.test(query)) {
      return this.formatDate(this.addDays(now, 1), timeZone);
    }
    if (/(?:后天)/i.test(query)) {
      return this.formatDate(this.addDays(now, 2), timeZone);
    }
    if (/(?:昨天|\byesterday\b)/i.test(query)) {
      return this.formatDate(this.addDays(now, -1), timeZone);
    }
    return null;
  }

  private daysBetween(baseDate: string, targetDate: string): number {
    const base = Date.parse(`${baseDate}T00:00:00Z`);
    const target = Date.parse(`${targetDate}T00:00:00Z`);
    if (!Number.isFinite(base) || !Number.isFinite(target)) return 0;
    return Math.round((target - base) / 86400000);
  }

  private numericValue(
    value: string | number | null | undefined,
  ): number | null {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value !== "string") return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  private metric(
    value: string | number | null | undefined,
    unit: string | undefined,
    digits = 1,
  ): string {
    const numeric = this.numericValue(value);
    if (numeric === null) return "n/a";
    return `${numeric.toFixed(digits)}${unit ? ` ${unit}` : ""}`;
  }

  private weatherCodeLabel(code: number | null): string {
    if (code === null) return "unknown";
    const labels: Record<number, string> = {
      0: "晴",
      1: "大部晴朗",
      2: "局部多云",
      3: "阴",
      45: "雾",
      48: "霜雾",
      51: "小毛毛雨",
      53: "中等毛毛雨",
      55: "强毛毛雨",
      56: "小冻毛毛雨",
      57: "强冻毛毛雨",
      61: "小雨",
      63: "中雨",
      65: "大雨",
      66: "小冻雨",
      67: "强冻雨",
      71: "小雪",
      73: "中雪",
      75: "大雪",
      77: "雪粒",
      80: "小阵雨",
      81: "中阵雨",
      82: "强阵雨",
      85: "小阵雪",
      86: "强阵雪",
      95: "雷暴",
      96: "雷暴伴小冰雹",
      99: "雷暴伴强冰雹",
    };
    return labels[code] || `天气代码 ${code}`;
  }

  private locationLabel(location: OpenMeteoLocation): string {
    const parts = [location.name, location.admin1, location.country]
      .map((part) => (part || "").trim())
      .filter(Boolean);
    return parts.join(", ") || "unknown location";
  }

  private async fetchJson<T>(
    url: URL,
    ctx: ToolContext,
    timeoutMs: number,
    schema: z.ZodType<T>,
  ): Promise<T> {
    const timeout = this.makeTimeoutSignal(ctx.abortSignal, timeoutMs);
    try {
      const response = await fetch(url.toString(), {
        headers: {
          "User-Agent": "Orbit/0.1 (+https://github.com/orbit-build/orbit)",
        },
        signal: timeout.signal,
      });
      if (response.status !== 200) {
        await response.body?.cancel().catch(() => undefined);
        throw new Error(`status ${response.status}: ${response.statusText}`);
      }
      return schema.parse(
        JSON.parse(
          await readResponseTextWithinLimit(
            response,
            SEARCH_JSON_RESPONSE_MAX_BYTES,
            "Search API response",
          ),
        ),
      );
    } finally {
      timeout.cleanup();
    }
  }

  private formatWeatherData(
    location: OpenMeteoLocation,
    forecast: OpenMeteoForecastResponse,
    requestedDate: string | null,
    maxResults: number,
  ): string | null {
    const label = this.locationLabel(location);
    const lines = [
      "Source: Open-Meteo weather API",
      `Location: ${label} (${this.metric(location.latitude, undefined, 4)}, ${this.metric(location.longitude, undefined, 4)})`,
      `Timezone: ${forecast.timezone || location.timezone || "auto"}`,
    ];

    const current = forecast.current;
    const currentTime = String(current?.time || "");
    if (
      current &&
      (!requestedDate || currentTime.startsWith(`${requestedDate}T`))
    ) {
      const currentUnits = forecast.current_units || {};
      const code = this.numericValue(current.weather_code);
      lines.push(
        `Current: ${String(current.time || "unknown")}; ${this.weatherCodeLabel(code)}; temperature ${this.metric(current.temperature_2m, currentUnits.temperature_2m)}; feels like ${this.metric(current.apparent_temperature, currentUnits.apparent_temperature)}; humidity ${this.metric(current.relative_humidity_2m, currentUnits.relative_humidity_2m, 0)}; wind ${this.metric(current.wind_speed_10m, currentUnits.wind_speed_10m)}; precipitation ${this.metric(current.precipitation, currentUnits.precipitation, 2)}; rain ${this.metric(current.rain, currentUnits.rain, 2)}`,
      );
    }

    const daily = forecast.daily;
    const dates = daily?.time || [];
    if (daily && dates.length > 0) {
      const dailyUnits = forecast.daily_units || {};
      const dateLimit = requestedDate
        ? dates.length
        : Math.min(dates.length, Math.max(1, Math.min(7, maxResults)));
      lines.push(requestedDate ? "Daily weather:" : "Daily forecast:");
      for (let i = 0; i < dateLimit; i++) {
        const date = String(dates[i] || "");
        if (requestedDate && date !== requestedDate) continue;
        const code = this.numericValue(daily.weather_code?.[i]);
        lines.push(
          `- ${date}: ${this.weatherCodeLabel(code)}; high ${this.metric(daily.temperature_2m_max?.[i], dailyUnits.temperature_2m_max)}; low ${this.metric(daily.temperature_2m_min?.[i], dailyUnits.temperature_2m_min)}; precipitation ${this.metric(daily.precipitation_sum?.[i], dailyUnits.precipitation_sum, 2)}`,
        );
      }
    }

    return lines.length > 3 ? lines.join("\n") : null;
  }

  private async tryOpenMeteoWeather(
    input: WebSearchInput,
    ctx: ToolContext,
    maxResults: number,
  ): Promise<ToolResult<string> | null> {
    if (
      process.env.ORBIT_DISABLE_OPEN_METEO === "1" ||
      !this.isWeatherQuery(input.query)
    ) {
      return null;
    }

    const locationQuery = this.extractWeatherLocation(input.query);
    if (!locationQuery) return null;

    try {
      const timeoutMs = Math.min(this.resolveTimeoutMs(ctx), 10000);
      const geocodeUrl = new URL(
        "https://geocoding-api.open-meteo.com/v1/search",
      );
      geocodeUrl.searchParams.set("name", locationQuery);
      geocodeUrl.searchParams.set("count", "1");
      geocodeUrl.searchParams.set("language", "zh");
      geocodeUrl.searchParams.set("format", "json");
      const geocode = await this.fetchJson<OpenMeteoGeocodingResponse>(
        geocodeUrl,
        ctx,
        timeoutMs,
        OpenMeteoGeocodingResponseSchema,
      );
      const location = geocode.results?.find(
        (item) =>
          typeof item.latitude === "number" &&
          typeof item.longitude === "number",
      );
      if (
        !location ||
        location.latitude === undefined ||
        location.longitude === undefined
      ) {
        return null;
      }

      const requestedDate = this.extractRequestedDate(
        input.query,
        location.timezone,
      );
      const today = this.formatDate(new Date(), location.timezone);
      const requestedOffset = requestedDate
        ? this.daysBetween(today, requestedDate)
        : 0;
      const useArchive = requestedDate !== null && requestedOffset < -7;
      const forecastUrl = new URL(
        useArchive
          ? "https://archive-api.open-meteo.com/v1/archive"
          : "https://api.open-meteo.com/v1/forecast",
      );
      forecastUrl.searchParams.set("latitude", String(location.latitude));
      forecastUrl.searchParams.set("longitude", String(location.longitude));
      forecastUrl.searchParams.set(
        "daily",
        "weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum",
      );
      forecastUrl.searchParams.set("timezone", location.timezone || "auto");
      const includeCurrent = !requestedDate || requestedDate === today;
      if (requestedDate) {
        forecastUrl.searchParams.set("start_date", requestedDate);
        forecastUrl.searchParams.set("end_date", requestedDate);
      }
      if (includeCurrent) {
        forecastUrl.searchParams.set(
          "current",
          "temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,rain,weather_code,wind_speed_10m",
        );
      }
      if (!requestedDate) {
        forecastUrl.searchParams.set(
          "forecast_days",
          String(Math.min(7, Math.max(1, Math.min(3, maxResults)))),
        );
      }

      const forecast = await this.fetchJson<OpenMeteoForecastResponse>(
        forecastUrl,
        ctx,
        timeoutMs,
        OpenMeteoForecastResponseSchema,
      );
      const formatted = this.formatWeatherData(
        location,
        forecast,
        requestedDate,
        maxResults,
      );
      if (!formatted) return null;

      const dateSuffix = requestedDate ? ` for ${requestedDate}` : "";
      return {
        ok: true,
        data: formatted,
        display: `Weather data returned for ${this.locationLabel(location)}${dateSuffix} via Open-Meteo.`,
      };
    } catch {
      return null;
    }
  }

  private decodeBingRedirectUrl(link: string): string {
    const cleaned = link.replace(/&amp;/g, "&");
    try {
      const url = new URL(cleaned);
      const encodedTarget = url.searchParams.get("u");
      if (!encodedTarget) return cleaned;
      const payload = encodedTarget.startsWith("a1")
        ? encodedTarget.slice(2)
        : encodedTarget;
      const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
      const decoded = Buffer.from(normalized, "base64").toString("utf8");
      return decoded.startsWith("http") ? decoded : cleaned;
    } catch {
      return cleaned;
    }
  }

  private cleanText(str: string): string {
    return str
      .replace(/<!\[CDATA\[|\]\]>/g, "")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">")
      .replace(/&quot;/gi, '"')
      .replace(/&#x27;|&#39;/gi, "'")
      .replace(/<[^>]*>/g, " ")
      .replace(/&nbsp;|&#160;/gi, " ")
      .replace(/&amp;/g, "&")
      .replace(/\s+/g, " ")
      .trim();
  }

  private parseHtmlResults(html: string): SearchResult[] {
    const results: SearchResult[] = [];
    const resultBlockRegex =
      /<div class="[^"]*result__body[^"]*">([\s\S]*?)<div class="clear"><\/div>/g;

    let match;
    while ((match = resultBlockRegex.exec(html)) !== null) {
      const block = match[1];

      const anchorRegex =
        /<a\s+[^>]*class="[^"]*result__a[^"]*"[^>]*>([\s\S]*?)<\/a>/gi;
      const anchorMatch = anchorRegex.exec(block);
      if (!anchorMatch) continue;

      const anchorTag = anchorMatch[0];
      const titleText = anchorMatch[1];

      const hrefMatch = /href="([^"]+)"/i.exec(anchorTag);
      if (!hrefMatch) continue;

      let link = hrefMatch[1];
      if (link.startsWith("//")) {
        link = "https:" + link;
      }
      if (link.includes("uddg=")) {
        const parts = link.split("uddg=");
        if (parts[1]) {
          link = decodeURIComponent(parts[1].split("&")[0]);
        }
      }

      const title = this.cleanText(titleText);

      const snippetRegex =
        /<(?:a|span|div)\s+[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/(?:a|span|div)>/gi;
      const snippetMatch = snippetRegex.exec(block);
      const snippet = snippetMatch ? this.cleanText(snippetMatch[1]) : "";

      if (
        link.includes("y.js") ||
        link.includes("/y.js") ||
        link.includes("ad_provider=")
      ) {
        continue;
      }

      results.push({ title, link, snippet });
    }

    if (results.length === 0) {
      const fallbackRegex =
        /<a\s+[^>]*class="[^"]*result__a[^"]*"[^>]*>([\s\S]*?)<\/a>/gi;
      while ((match = fallbackRegex.exec(html)) !== null) {
        const anchorTag = match[0];
        const titleText = match[1];
        const hrefMatch = /href="([^"]+)"/i.exec(anchorTag);
        if (!hrefMatch) continue;

        let link = hrefMatch[1];
        if (link.startsWith("//")) {
          link = "https:" + link;
        }
        if (link.includes("uddg=")) {
          const parts = link.split("uddg=");
          if (parts[1]) {
            link = decodeURIComponent(parts[1].split("&")[0]);
          }
        }
        const title = this.cleanText(titleText);

        if (
          link.includes("y.js") ||
          link.includes("/y.js") ||
          link.includes("ad_provider=")
        ) {
          continue;
        }

        results.push({ title, link, snippet: "" });
      }
    }

    return results;
  }

  private parseLiteResults(html: string): SearchResult[] {
    const results: SearchResult[] = [];
    const regex =
      /(\d+)\.&nbsp;\s*<\/td>\s*<td>\s*(<a\s+[^>]*class=['"]result-link['"][^>]*>([\s\S]*?)<\/a>)/gi;

    let match;
    while ((match = regex.exec(html)) !== null) {
      const anchorTag = match[2];
      const titleText = match[3];

      const hrefMatch =
        /href="([^"]+)"/i.exec(anchorTag) || /href='([^']+)'/i.exec(anchorTag);
      if (!hrefMatch) continue;

      let link = hrefMatch[1];
      if (link.startsWith("//")) {
        link = "https:" + link;
      }
      if (link.includes("uddg=")) {
        const parts = link.split("uddg=");
        if (parts[1]) {
          link = decodeURIComponent(parts[1].split("&")[0]);
        }
      }

      const title = this.cleanText(titleText);

      const subHtml = html.substring(match.index, match.index + 2000);
      const snippetMatch =
        /<td\s+[^>]*class=['"]result-snippet['"][^>]*>([\s\S]*?)<\/td>/i.exec(
          subHtml,
        );
      const snippet = snippetMatch ? this.cleanText(snippetMatch[1]) : "";

      if (
        link.includes("y.js") ||
        link.includes("/y.js") ||
        link.includes("ad_provider=")
      ) {
        continue;
      }

      results.push({ title, link, snippet });
    }

    return results;
  }

  private parseBingResults(html: string): SearchResult[] {
    const results: SearchResult[] = [];
    const blockRegex = /<li\s+class="b_algo"[\s\S]*?<\/li>/gi;
    let match;
    while ((match = blockRegex.exec(html)) !== null) {
      const block = match[0];
      const anchorMatch =
        /<h2[^>]*>\s*<a\s+[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>\s*<\/h2>/i.exec(
          block,
        );
      if (!anchorMatch) continue;
      const snippetMatch = /<p[^>]*>([\s\S]*?)<\/p>/i.exec(block);
      const link = this.decodeBingRedirectUrl(anchorMatch[1]);
      if (!link.startsWith("http")) continue;
      results.push({
        title: this.cleanText(anchorMatch[2]),
        link,
        snippet: snippetMatch ? this.cleanText(snippetMatch[1]) : "",
      });
    }
    return results;
  }

  private parseNewsRssResults(xml: string): SearchResult[] {
    const results: SearchResult[] = [];
    const itemRegex = /<item\b[^>]*>([\s\S]*?)<\/item>/gi;
    let itemMatch: RegExpExecArray | null;
    while ((itemMatch = itemRegex.exec(xml)) !== null) {
      const item = itemMatch[1];
      const title = this.cleanText(
        /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(item)?.[1] || "",
      );
      const link = this.cleanText(
        /<link\b[^>]*>([\s\S]*?)<\/link>/i.exec(item)?.[1] || "",
      );
      const snippet = this.cleanText(
        /<description\b[^>]*>([\s\S]*?)<\/description>/i.exec(item)?.[1] || "",
      );
      const publishedAt = this.cleanText(
        /<pubDate\b[^>]*>([\s\S]*?)<\/pubDate>/i.exec(item)?.[1] || "",
      );
      if (!title || !link.startsWith("http")) continue;
      results.push({
        title,
        link,
        snippet,
        ...(publishedAt ? { publishedAt } : {}),
      });
    }
    return results;
  }

  private parseSearxngResults(body: string): SearchResult[] {
    const rawResults = SearchApiEnvelopeSchema.parse(JSON.parse(body)).results;
    return rawResults
      .map((result) => SearxngResultSchema.safeParse(result))
      .filter((result) => result.success)
      .map(({ data: result }) => ({
        title: this.cleanText(result.title),
        link: result.url || result.link || "",
        snippet: this.cleanText(result.content || result.snippet || ""),
      }))
      .filter((result: SearchResult) => result.title && result.link);
  }

  private parseTavilyResults(body: string): SearchResult[] {
    const rawResults = SearchApiEnvelopeSchema.parse(JSON.parse(body)).results;
    return rawResults
      .map((result) => TavilyResultSchema.safeParse(result))
      .filter((result) => result.success)
      .map(({ data: result }) => ({
        title: this.cleanText(result.title),
        link: result.url,
        snippet: this.cleanText(result.content || result.snippet || ""),
      }))
      .filter((result: SearchResult) => result.title && result.link);
  }

  private makeTimeoutSignal(
    parentSignal: AbortSignal | undefined,
    timeoutMs: number,
  ): { signal: AbortSignal; cleanup: () => void } {
    const controller = new AbortController();
    const abort = () => controller.abort();
    const timeoutId = setTimeout(abort, timeoutMs);
    // Search is awaited tool work; the timeout must keep short-lived CLI
    // processes alive until the request completes or is aborted.
    if (parentSignal) {
      if (parentSignal.aborted) {
        controller.abort();
      } else {
        parentSignal.addEventListener("abort", abort, { once: true });
      }
    }
    return {
      signal: controller.signal,
      cleanup: () => {
        clearTimeout(timeoutId);
        parentSignal?.removeEventListener("abort", abort);
      },
    };
  }

  private buildStrategies(
    input: WebSearchInput,
    ctx: ToolContext,
  ): SearchStrategy[] {
    const query = input.query;
    const config = ctx.config?.tools?.webSearch;
    const provider =
      process.env.ORBIT_WEB_SEARCH_PROVIDER || config?.provider || "auto";
    const timeoutMs = this.resolveTimeoutMs(ctx);
    const maxResults = this.resolveMaxResults(input, ctx);
    const strategies: SearchStrategy[] = [];

    const configuredSearxngUrls = [
      ...(config?.searxngUrls || []),
      ...this.envList("ORBIT_SEARXNG_URL", "SEARXNG_URL"),
    ];
    const localSearxngUrls =
      process.env.ORBIT_DISABLE_LOCAL_SEARXNG === "1"
        ? []
        : ["http://127.0.0.1:8888", "http://localhost:8888"];
    const searxngUrls = [...configuredSearxngUrls, ...localSearxngUrls];

    if (
      (provider === "auto" || provider === "bing") &&
      this.isNewsQuery(query)
    ) {
      const hasChinese = /[\u3400-\u9fff]/u.test(query);
      const isGenericNewsQuery =
        this.requiresFreshNews(query) && this.queryTerms(query).length === 0;
      const googleNewsUrl = new URL(
        isGenericNewsQuery
          ? "https://news.google.com/rss"
          : "https://news.google.com/rss/search",
      );
      if (!isGenericNewsQuery) {
        googleNewsUrl.searchParams.set("q", query);
      }
      googleNewsUrl.searchParams.set("hl", hasChinese ? "zh-CN" : "en-US");
      googleNewsUrl.searchParams.set("gl", hasChinese ? "CN" : "US");
      googleNewsUrl.searchParams.set(
        "ceid",
        hasChinese ? "CN:zh-Hans" : "US:en",
      );
      strategies.push({
        name: isGenericNewsQuery
          ? "Google News Top Stories"
          : "Google News RSS",
        url: googleNewsUrl.toString(),
        priority: 0,
        userAgent:
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36",
        headers: {
          Accept: "application/rss+xml, application/xml, text/xml",
        },
        parser: (body) =>
          this.limitResults(this.parseNewsRssResults(body), maxResults),
        timeoutMs: Math.min(timeoutMs, 10000),
      });
    }

    if (provider === "auto" || provider === "searxng") {
      for (const baseUrl of searxngUrls) {
        const normalized = this.normalizeBaseUrl(baseUrl);
        const isLocal =
          normalized.includes("127.0.0.1") || normalized.includes("localhost");
        strategies.push({
          name: `SearXNG (${normalized})`,
          url: `${normalized}/search?q=${encodeURIComponent(query)}&format=json&language=auto&safesearch=0`,
          priority: isLocal && configuredSearxngUrls.length === 0 ? 1 : 0,
          userAgent: "Orbit/0.1 (+https://github.com/orbit-build/orbit)",
          parser: (body) =>
            this.limitResults(this.parseSearxngResults(body), maxResults),
          timeoutMs: isLocal
            ? Math.min(timeoutMs, 1200)
            : Math.min(timeoutMs, 5000),
        });
      }
    }

    const tavilyApiKeyEnv = config?.tavilyApiKeyEnv || "TAVILY_API_KEY";
    const tavilyApiKey =
      process.env.ORBIT_TAVILY_API_KEY || process.env[tavilyApiKeyEnv];
    const tavilyBaseUrl =
      process.env.ORBIT_TAVILY_API_URL ||
      config?.tavilyBaseUrl ||
      "https://api.tavily.com/search";
    if ((provider === "auto" || provider === "tavily") && tavilyApiKey) {
      strategies.push({
        name: "Tavily",
        url: tavilyBaseUrl,
        priority: 0,
        method: "POST",
        headers: {
          Authorization: `Bearer ${tavilyApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          query,
          max_results: maxResults,
          search_depth: "basic",
          include_answer: false,
          include_raw_content: false,
        }),
        parser: (body) =>
          this.limitResults(this.parseTavilyResults(body), maxResults),
        timeoutMs,
      });
    }

    if (provider === "auto" || provider === "bing") {
      const bingBase =
        process.env.ORBIT_BING_SEARCH_URL || "https://www.bing.com/search";
      strategies.push({
        name: "Bing HTML",
        url: `${bingBase}?q=${encodeURIComponent(query)}&setlang=zh-CN`,
        priority: provider === "auto" ? 1 : 0,
        userAgent:
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        parser: (body) =>
          this.limitResults(this.parseBingResults(body), maxResults),
        timeoutMs,
      });
    }

    if (provider === "auto" || provider === "duckduckgo") {
      const duckHtmlBase =
        process.env.ORBIT_DUCKDUCKGO_HTML_URL ||
        "https://html.duckduckgo.com/html/";
      const duckLiteBase =
        process.env.ORBIT_DUCKDUCKGO_LITE_URL ||
        "https://lite.duckduckgo.com/lite/";
      strategies.push(
        {
          name: "DuckDuckGo HTML",
          url: `${duckHtmlBase}?q=${encodeURIComponent(query)}`,
          priority: provider === "auto" ? 1 : 0,
          userAgent:
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:115.0) Gecko/20100101 Firefox/115.0",
          parser: (body) =>
            this.limitResults(this.parseHtmlResults(body), maxResults),
          timeoutMs,
        },
        {
          name: "DuckDuckGo Lite",
          url: `${duckLiteBase}?q=${encodeURIComponent(query)}`,
          priority: provider === "auto" ? 1 : 0,
          userAgent:
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          parser: (body) =>
            this.limitResults(this.parseLiteResults(body), maxResults),
          timeoutMs,
        },
      );
    }

    return strategies;
  }

  private async runSearchStrategy(
    strategy: SearchStrategy,
    ctx: ToolContext,
    groupSignal?: AbortSignal,
  ): Promise<
    | { ok: true; strategy: SearchStrategy; results: SearchResult[] }
    | { ok: false; error: string }
  > {
    const parentSignal =
      ctx.abortSignal && groupSignal
        ? AbortSignal.any([ctx.abortSignal, groupSignal])
        : (ctx.abortSignal ?? groupSignal);
    const timeout = this.makeTimeoutSignal(parentSignal, strategy.timeoutMs);
    try {
      const response = await fetch(strategy.url, {
        method: strategy.method || "GET",
        headers: {
          ...(strategy.userAgent ? { "User-Agent": strategy.userAgent } : {}),
          ...(strategy.headers || {}),
        },
        body: strategy.body,
        signal: timeout.signal,
      });

      if (response.status !== 200) {
        await response.body?.cancel().catch(() => undefined);
        return {
          ok: false,
          error: `${strategy.name} status ${response.status}: ${response.statusText}`,
        };
      }

      const body = await readResponseTextWithinLimit(
        response,
        SEARCH_PAGE_RESPONSE_MAX_BYTES,
        `${strategy.name} response`,
      );
      const results = strategy.parser(body);
      if (results.length === 0) {
        return { ok: false, error: `${strategy.name} returned 0 results` };
      }
      return { ok: true, strategy, results };
    } catch (error: unknown) {
      return {
        ok: false,
        error: `${strategy.name} error: ${error instanceof Error ? error.message : String(error)}`,
      };
    } finally {
      timeout.cleanup();
    }
  }

  async execute(
    input: WebSearchInput,
    _ctx: ToolContext,
  ): Promise<ToolResult<string>> {
    const maxResults = this.resolveMaxResults(input, _ctx);
    const weatherResult = await this.tryOpenMeteoWeather(
      input,
      _ctx,
      maxResults,
    );
    if (weatherResult) return weatherResult;

    const strategies = this.buildStrategies(input, _ctx);

    const errors: string[] = [];
    if (strategies.length === 0) {
      return {
        ok: false,
        error:
          "No web search backend is available. Configure tools.webSearch.searxngUrls, ORBIT_SEARXNG_URL, TAVILY_API_KEY, or set provider to duckduckgo.",
      };
    }

    const priorities = Array.from(
      new Set(strategies.map((strategy) => strategy.priority)),
    ).sort((a, b) => a - b);

    for (const priority of priorities) {
      const group = strategies.filter(
        (strategy) => strategy.priority === priority,
      );
      const groupController = new AbortController();
      try {
        const candidate = await Promise.any(
          group.map(async (strategy) => {
            const outcome = await this.runSearchStrategy(
              strategy,
              _ctx,
              groupController.signal,
            );
            if (!outcome.ok) throw new Error(outcome.error);
            const quality = this.scoreSearchQuality(
              input.query,
              outcome.results,
            );
            if (!this.isAcceptableSearchQuality(input.query, quality)) {
              throw new Error(
                `${strategy.name} returned low-confidence results (quality=${quality.label}, score=${quality.score.toFixed(2)}, matchedTerms=${quality.matchedTerms}/${quality.queryTerms}, freshResults=${quality.freshResults})`,
              );
            }
            return { ...outcome, quality };
          }),
        );
        groupController.abort();
        const { strategy, results, quality } = candidate;
        const formatted = results
          .map(
            (result, index) =>
              `[${index + 1}] Title: ${result.title}\n    Link: ${result.link}${
                result.publishedAt
                  ? `\n    Published: ${result.publishedAt}`
                  : ""
              }\n    Summary: ${result.snippet}`,
          )
          .join("\n\n");

        return {
          ok: true,
          data: formatted,
          display: `Web search returned ${results.length} results via ${strategy.name} (quality: ${quality.label}, score=${quality.score.toFixed(2)}, matchedTerms=${quality.matchedTerms}/${quality.queryTerms}, snippets=${quality.withSnippets}, freshResults=${quality.freshResults}).`,
        };
      } catch (error: unknown) {
        groupController.abort();
        if (error instanceof AggregateError) {
          for (const reason of error.errors) {
            errors.push(
              reason instanceof Error ? reason.message : String(reason),
            );
          }
        } else {
          errors.push(error instanceof Error ? error.message : String(error));
        }
      }
    }

    return {
      ok: false,
      error:
        "Web search could not verify sufficiently relevant, current results. Check the configured search backend or retry with a more specific query." +
        `\nDiagnostics:\n- ${errors.join("\n- ")}`,
    };
  }
}
