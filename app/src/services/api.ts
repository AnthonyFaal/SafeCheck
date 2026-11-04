import * as SecureStore from "expo-secure-store";

const API_URL = process.env.EXPO_PUBLIC_API_URL?.replace(/\/$/, "");
const ACCESS_KEY = "safecheck.access-token";
const REFRESH_KEY = "safecheck.refresh-token";
const REQUEST_TIMEOUT_MS = 15_000;
let cachedAccessToken: string | null | undefined;
let refreshInFlight: Promise<boolean> | null = null;
export type Session = {
  accessToken: string;
  refreshToken: string;
  user: { id: string; email: string; username: string };
};
export type ScanResponse = {
  risk: "LOW" | "MEDIUM" | "HIGH";
  score: number;
  summary: string;
  redFlags: string[];
  recommendedAction: string;
};
export type Dashboard = {
  user: {
    id: string;
    email: string;
    username: string;
    safetyScore: number;
    xp: number;
    coins: number;
    profile: { displayName: string | null } | null;
    notificationPreferences: Preferences | null;
  };
  subscription: {
    plan: "FREE" | "PREMIUM";
    status: string;
    currentPeriodEndsAt: string | null;
  };
  streak: number;
  scans: ScanHistoryItem[];
};
export type Preferences = {
  dailyChallenge: boolean;
  threatAlerts: boolean;
  monthlyReport: boolean;
  preferredHour: number | null;
};
export const FREE_DAILY_SCAN_LIMIT = 50;
export const FREE_HISTORY_LIMIT = 5;
export const FREE_SCENARIO_LIMIT = 3;
export function isPremium(dashboard: Dashboard | null | undefined) {
  if (dashboard?.subscription.plan !== "PREMIUM") return false;
  if (!["ACTIVE", "CANCELED"].includes(dashboard.subscription.status))
    return false;
  return (
    !dashboard.subscription.currentPeriodEndsAt ||
    new Date(dashboard.subscription.currentPeriodEndsAt) > new Date()
  );
}
export type Scenario = {
  id: string;
  title: string;
  description: string;
  difficulty: number;
  category: { slug: string; name: string };
  content: unknown;
};
export type ScanHistoryItem = {
  id: string;
  type: string;
  risk: "LOW" | "MEDIUM" | "HIGH";
  score: number;
  summary: string;
  redFlags?: unknown;
  action?: string;
  createdAt: string;
};
async function token() {
  if (cachedAccessToken !== undefined) return cachedAccessToken;
  cachedAccessToken = await SecureStore.getItemAsync(ACCESS_KEY);
  return cachedAccessToken;
}
export async function hasStoredSession() {
  return Boolean(await token());
}
export async function saveSession(session: Session) {
  cachedAccessToken = session.accessToken;
  await Promise.all([
    SecureStore.setItemAsync(ACCESS_KEY, session.accessToken),
    SecureStore.setItemAsync(REFRESH_KEY, session.refreshToken),
  ]);
}
export async function clearSession() {
  cachedAccessToken = null;
  await Promise.all([
    SecureStore.deleteItemAsync(ACCESS_KEY),
    SecureStore.deleteItemAsync(REFRESH_KEY),
  ]);
}
export async function signIn(email: string, password: string) {
  const session = await request<Session>("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password, deviceName: "Expo mobile app" }),
    auth: false,
  });
  await saveSession(session);
  return session;
}
export async function signUp(
  email: string,
  username: string,
  password: string,
) {
  return request<{ verificationRequired: true; email: string }>(
    "/auth/register",
    {
      method: "POST",
      body: JSON.stringify({
        email,
        username,
        password,
        deviceName: "Expo mobile app",
      }),
      auth: false,
    },
  );
}
export async function verifyEmail(email: string, code: string) {
  const session = await request<Session>("/auth/verify-email", {
    method: "POST",
    body: JSON.stringify({ email, code, deviceName: "Expo mobile app" }),
    auth: false,
  });
  await saveSession(session);
  return session;
}
export async function resendVerification(email: string) {
  return request<{ sent: boolean }>("/auth/resend-verification", {
    method: "POST",
    body: JSON.stringify({ email }),
    auth: false,
  });
}
export async function scanMessage(
  content: string,
  type: "MESSAGE" | "URL" | "JOB_OFFER" = "MESSAGE",
) {
  return request<ScanResponse>("/safety/scans", {
    method: "POST",
    body: JSON.stringify({ content, type }),
  });
}
export type DailyChallenge = {
  id: string;
  completedAt: string | null;
  scenario: {
    id: string;
    title: string;
    description: string;
    difficulty: number;
    category: { slug: string; name: string };
    content: unknown;
  };
};
export type DailyAdvice = {
  id: string;
  title: string;
  body: string;
  action?: string | null;
};
export type LiveSession = {
  id: string;
  code: string;
  title: string;
  description?: string | null;
  status: "SCHEDULED" | "LOBBY" | "LIVE" | "FINISHED" | "CANCELED";
  scheduledFor?: string | null;
  timezone?: string | null;
  isHost: boolean;
  questionSeconds: number;
  playerCount: number;
  question: {
    id: string;
    position: number;
    total: number;
    prompt: string;
    choices: string[];
    remainingMs: number;
    phase: "ANSWERING" | "REVEAL";
    answeredCount: number;
    answer: { answer: string; correct: boolean; points: number } | null;
    correctAnswer?: string;
    explanation?: string;
  } | null;
  leaderboard: { rank: number; name: string; score: number; isYou: boolean }[];
};
export type LiveSessionEvent = {
  id: string;
  code: string;
  title: string;
  description: string | null;
  status: LiveSession["status"];
  scheduledFor: string | null;
  timezone: string | null;
  isHost: boolean;
  playerCount: number;
  questionCount: number;
  score: number;
  createdAt: string;
  finishedAt: string | null;
};
export async function getDailyChallenge() {
  return request<DailyChallenge>("/safety/daily-challenge");
}
export async function getDailyAdvice() {
  return request<DailyAdvice>("/product/daily-advice");
}
export async function createLiveSession(payload: {
  title: string;
  description?: string;
  scheduledFor?: string;
  timezone?: string;
  questionSeconds: number;
  questions: {
    prompt: string;
    choices: string[];
    correctAnswer: string;
    explanation?: string;
  }[];
}) {
  return request<{
    id: string;
    code: string;
    title: string;
    sessionToken: string;
  }>("/sessions", { method: "POST", body: JSON.stringify(payload) });
}
export async function joinLiveSession(code: string, displayName: string) {
  return request<{
    id: string;
    code: string;
    title: string;
    sessionToken: string;
  }>("/sessions/join", {
    method: "POST",
    body: JSON.stringify({ code, displayName }),
  });
}
export async function getMyLiveSessionEvents() {
  return request<LiveSessionEvent[]>("/sessions/me/events");
}
export async function getLiveSession(id: string, sessionToken: string) {
  return request<LiveSession>(`/sessions/${id}`, {
    headers: { "X-Session-Token": sessionToken },
    auth: false,
  });
}
export async function startLiveSession(id: string) {
  return request(`/sessions/${id}/start`, { method: "POST" });
}
export async function answerLiveSession(
  id: string,
  answer: string,
  sessionToken: string,
) {
  return request<{ correct: boolean; points: number }>(
    `/sessions/${id}/answer`,
    {
      method: "POST",
      body: JSON.stringify({ answer }),
      headers: { "X-Session-Token": sessionToken },
      auth: false,
    },
  );
}
export async function advanceLiveSession(id: string) {
  return request(`/sessions/${id}/advance`, { method: "POST" });
}
export async function endLiveSession(id: string) {
  return request(`/sessions/${id}/end`, { method: "POST" });
}
export async function cancelLiveSession(id: string) {
  return request(`/sessions/${id}/cancel`, { method: "POST" });
}
export async function rescheduleLiveSession(id: string, scheduledFor: string) {
  return request(`/sessions/${id}/schedule`, {
    method: "PATCH",
    body: JSON.stringify({ scheduledFor }),
  });
}
export async function completeDailyChallenge(
  scenarioId: string,
  answer: string,
  reactionMs: number,
) {
  return request<{ correct: boolean }>("/safety/daily-challenge/complete", {
    method: "POST",
    body: JSON.stringify({ scenarioId, answer, reactionMs }),
  });
}
export async function completeScenario(
  scenarioId: string,
  answer: string,
  reactionMs: number,
) {
  return request<{ correct: boolean; rewards: { xp: number; coins: number } }>(
    "/safety/scenario-attempts",
    {
      method: "POST",
      body: JSON.stringify({ scenarioId, answer, reactionMs }),
    },
  );
}
export async function getDashboard() {
  return request<Dashboard>("/product/dashboard");
}
export async function getScenarios() {
  return request<Scenario[]>("/product/scenarios");
}
export async function getScanHistory() {
  return request<ScanHistoryItem[]>("/product/scan-history");
}
export async function savePreferences(preferences: Partial<Preferences>) {
  return request<Preferences>("/product/preferences", {
    method: "POST",
    body: JSON.stringify(preferences),
  });
}
export async function saveProfile(profile: { displayName?: string }) {
  return request<{ displayName: string | null }>("/product/profile", {
    method: "POST",
    body: JSON.stringify(profile),
  });
}
export async function registerPushToken(
  token: string,
  platform: "ios" | "android",
) {
  return request("/product/push-token", {
    method: "POST",
    body: JSON.stringify({ token, platform }),
  });
}
export async function sendTestNotification() {
  return request<{ queued: boolean; reason?: string }>(
    "/product/notifications/test",
    { method: "POST" },
  );
}
export async function cancelSubscription() {
  return request("/product/subscription/cancel", { method: "POST" });
}
export async function signOut() {
  await request("/auth/logout", { method: "POST" });
  await clearSession();
}
export async function changePassword(
  currentPassword: string,
  newPassword: string,
) {
  return request<{ success: boolean }>("/auth/change-password", {
    method: "POST",
    body: JSON.stringify({ currentPassword, newPassword }),
  });
}
export async function deleteAccount(password: string) {
  await request("/auth/account", {
    method: "DELETE",
    body: JSON.stringify({ password }),
  });
  await clearSession();
}
export async function startPremiumCheckout(callbackUrl: string) {
  return request<{ authorizationUrl: string; reference: string }>(
    "/product/checkout",
    { method: "POST", body: JSON.stringify({ callbackUrl }) },
  );
}
export async function verifyPremiumCheckout(reference: string) {
  return request("/product/checkout/verify", {
    method: "POST",
    body: JSON.stringify({ reference }),
  });
}
async function fetchWithTimeout(input: RequestInfo, init: RequestInit) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError")
      throw new Error(
        "The request took too long. Check your connection and try again.",
      );
    throw new Error(
      "Unable to reach SafeCheck. Check your connection and try again.",
    );
  } finally {
    clearTimeout(timeout);
  }
}
async function refresh() {
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = (async () => {
    const refreshToken = await SecureStore.getItemAsync(REFRESH_KEY);
    if (!refreshToken || !API_URL) return false;
    const response = await fetchWithTimeout(`${API_URL}/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken }),
    }).catch(() => null);
    if (!response?.ok) {
      if (response) await clearSession();
      return false;
    }
    await saveSession((await response.json()) as Session);
    return true;
  })();
  try {
    return await refreshInFlight;
  } finally {
    refreshInFlight = null;
  }
}
async function request<T>(
  path: string,
  options: RequestInit & { auth?: boolean } = {},
): Promise<T> {
  if (!API_URL) throw new Error("EXPO_PUBLIC_API_URL is not configured");
  const execute = async () =>
    fetchWithTimeout(`${API_URL}${path}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...(options.auth === false
          ? {}
          : { Authorization: `Bearer ${(await token()) ?? ""}` }),
        ...options.headers,
      },
    });
  let response = await execute();
  if (response.status === 401 && options.auth !== false && (await refresh()))
    response = await execute();
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      message?: string;
    } | null;
    throw new Error(body?.message ?? "Unable to complete this request");
  }
  return response.json() as Promise<T>;
}
