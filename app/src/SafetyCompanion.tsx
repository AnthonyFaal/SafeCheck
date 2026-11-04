import { useEffect, useMemo, useRef, useState } from "react";
import {
  AppState,
  BackHandler,
  Linking,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StatusBar,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import * as SecureStore from "expo-secure-store";

import {
  cancelSubscription,
  changePassword,
  completeDailyChallenge,
  completeScenario,
  deleteAccount,
  getDailyChallenge,
  getDailyAdvice,
  getDashboard,
  getScanHistory,
  getScenarios,
  hasStoredSession,
  isPremium,
  registerPushToken,
  savePreferences,
  saveProfile,
  scanMessage,
  signIn,
  signOut,
  signUp,
  verifyEmail,
  resendVerification,
  startPremiumCheckout,
  verifyPremiumCheckout,
  type DailyChallenge,
  type DailyAdvice,
  type Dashboard,
  type ScanHistoryItem,
  type Scenario,
} from "./services/api";

import {
  disableDailyReminder,
  enableDailyReminder,
  getPushToken,
  onNotificationResponse,
  onForegroundNotification,
} from "./services/notifications";

import { AppDialog } from "./ui/components/AppDialog";
import { AppBottomSheet } from "./ui/components/AppBottomSheet";
import { LiveSessionsPage } from "./ui/components/LiveSessionSheet";

type Tab = "Home" | "Protect" | "Learn" | "History" | "Profile";
type AccountView = "menu" | "password" | "delete";
type ScannerMode = "general" | "message" | "link";

type ScanReport = {
  risk: "Low" | "Medium" | "High";
  score: number;
  title: string;
  flags: string[];
  action: string;
  sourceText?: string;
  fromHistory?: boolean;
};

type Palette = {
  bg: string;
  surface: string;
  surface2: string;
  text: string;
  muted: string;
  line: string;
  blue: string;
  green: string;
  amber: string;
  red: string;
  white: string;
};

const palette: Palette = {
  bg: "#0B1016",
  surface: "#141C25",
  surface2: "#1B2632",
  text: "#DCE6EE",
  muted: "#AABAC7",
  line: "#273443",
  blue: "#52B6FF",
  green: "#42C59A",
  amber: "#FFBD59",
  red: "#F36F70",
  white: "#F5F8FB",
};

const lightPalette: Palette = {
  bg: "#F5F7FA",
  surface: "#FFFFFF",
  surface2: "#EAF0F5",
  text: "#15212B",
  muted: "#526473",
  line: "#D7E0E8",
  blue: "#0878C9",
  green: "#16845F",
  amber: "#A86100",
  red: "#C73A45",
  white: "#FFFFFF",
};

type Appearance = "light" | "dark";
const APPEARANCE_KEY = "safecheck.appearance";
const ACCOUNT_CACHE_KEY = "safecheck.dashboard.cache";

const tabs: Tab[] = ["Home", "Protect", "Learn", "History", "Profile"];

// A link check is deliberately stricter than message checking: users should
// get immediate feedback when they have pasted prose into the link tool.
// This accepts full URLs and normal browser-style addresses such as
// "example.com/path" without requiring a scheme.
const URL_INPUT_PATTERN =
  /^(?:(?:https?):\/\/)?(?:(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}|(?:\d{1,3}\.){3}\d{1,3})(?::\d{2,5})?(?:[/?#][^\s]*)?$/i;

function isWebsiteLink(value: string) {
  return URL_INPUT_PATTERN.test(value.trim());
}

const tabIcons: Record<Tab, keyof typeof Ionicons.glyphMap> = {
  Home: "home-outline",
  Protect: "shield-checkmark-outline",
  Learn: "school-outline",
  History: "time-outline",
  Profile: "person-circle-outline",
};

function scenarioChoices(content: unknown): string[] {
  if (!content || typeof content !== "object" || !("choices" in content)) {
    return [];
  }

  const choices = (content as { choices?: unknown }).choices;

  return Array.isArray(choices)
    ? choices.filter((choice): choice is string => typeof choice === "string")
    : [];
}

function scenarioPrompt(content: unknown, fallback: string): string {
  if (!content || typeof content !== "object" || !("prompt" in content)) {
    return fallback;
  }

  const prompt = (content as { prompt?: unknown }).prompt;

  return typeof prompt === "string" ? prompt : fallback;
}

function scenarioLesson(content: unknown): string {
  if (content && typeof content === "object" && "lesson" in content) {
    const lesson = (content as { lesson?: unknown }).lesson;

    if (typeof lesson === "string") {
      return lesson;
    }
  }

  return "Pause before acting. Verify the sender through an official, independent channel and never share codes, PINs, or passwords.";
}

function formatHour(hour: number): string {
  return new Date(2000, 0, 1, hour).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
}

function prettifyTechnicalError(message: string): string {
  const normalized = message.toLowerCase();

  if (
    normalized.includes("callback") ||
    normalized.includes("configuration") ||
    normalized.includes("configured")
  ) {
    return "Premium payments are temporarily unavailable. Please try again later.";
  }

  if (
    normalized.includes("unauthorized") ||
    normalized.includes("authentication") ||
    normalized.includes("sign in")
  ) {
    return "You need to sign in to continue.";
  }

  if (normalized.includes("network") || normalized.includes("connect")) {
    return "We couldn't connect to SafeCheck. Check your internet connection and try again.";
  }

  return message;
}

export default function SafetyCompanion({
  sharedText,
  onSharedTextHandled,
}: {
  sharedText?: string | null;
  onSharedTextHandled?: () => void;
}) {
  const [tab, setTab] = useState<Tab>("Home");
  const [appearance, setAppearance] = useState<Appearance>("dark");
  const activePalette = appearance === "light" ? lightPalette : palette;
  const s = useMemo(() => makeStyles(activePalette), [activePalette]);
  const notificationStyles = useMemo(
    () => makeNotificationStyles(activePalette),
    [activePalette],
  );

  const [score, setScore] = useState(0);
  const [streak, setStreak] = useState(0);

  const [challengeDone, setChallengeDone] = useState(false);
  const [challengeStarted, setChallengeStarted] = useState(false);

  const [scannerOpen, setScannerOpen] = useState(false);
  const [scannerMode, setScannerMode] = useState<ScannerMode>("general");
  const [scanText, setScanText] = useState("");
  const [report, setReport] = useState<ScanReport | null>(null);
  const [scanBusy, setScanBusy] = useState(false);

  const [authOpen, setAuthOpen] = useState(false);
  const [authMode, setAuthMode] = useState<"signin" | "signup" | "verify">(
    "signin",
  );

  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [verificationCode, setVerificationCode] = useState("");

  const [passwordVisible, setPasswordVisible] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [authBusy, setAuthBusy] = useState(false);

  const [resendBusy, setResendBusy] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);

  const [accountOpen, setAccountOpen] = useState(false);
  const [accountView, setAccountView] = useState<AccountView>("menu");

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [deletePassword, setDeletePassword] = useState("");

  const [currentPasswordVisible, setCurrentPasswordVisible] = useState(false);
  const [newPasswordVisible, setNewPasswordVisible] = useState(false);
  const [deletePasswordVisible, setDeletePasswordVisible] = useState(false);

  const [accountBusy, setAccountBusy] = useState(false);
  const [displayName, setDisplayName] = useState("");

  const [dailyChallenge, setDailyChallenge] = useState<DailyChallenge | null>(
    null,
  );

  const [dailyAdvice, setDailyAdvice] = useState<DailyAdvice | null>(null);

  const [dailyAdviceExpanded, setDailyAdviceExpanded] = useState(false);

  // Keep this unresolved until SecureStore has been read so returning users
  // never see a flash of onboarding during app startup.
  const [onboarding, setOnboarding] = useState<boolean | null>(null);
  const [onboardingStep, setOnboardingStep] = useState(0);

  const [liveSessionOpen, setLiveSessionOpen] = useState(false);

  const [dashboard, setDashboard] = useState<Dashboard | null>(null);

  const [accountState, setAccountState] = useState<
    "loading" | "ready" | "offline"
  >("loading");
  const [isBooting, setIsBooting] = useState(true);

  const [secondaryDataLoading, setSecondaryDataLoading] = useState(false);

  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [selectedScenario, setSelectedScenario] = useState<Scenario | null>(
    null,
  );
  const [scenarioBusy, setScenarioBusy] = useState(false);

  const [history, setHistory] = useState<ScanHistoryItem[]>([]);

  const [refreshing, setRefreshing] = useState(false);

  const [checkoutBusy, setCheckoutBusy] = useState(false);
  const [premiumModalOpen, setPremiumModalOpen] = useState(false);
  const [premiumFeatureHint, setPremiumFeatureHint] = useState<string | null>(
    null,
  );

  const [pendingCheckoutReference, setPendingCheckoutReference] = useState<
    string | null
  >(null);

  const [banner, setBanner] = useState<{
    title: string;
    body: string;
  } | null>(null);

  const [dialog, setDialog] = useState<{
    title: string;
    message: string;
    icon?: string;
    variant?: "info" | "success" | "warning" | "danger";
    buttons?: Array<{
      label: string;
      variant?: "primary" | "secondary" | "danger";
      onPress?: () => void;
    }>;
  } | null>(null);

  const premium = isPremium(dashboard);

  const scoreLabel = useMemo(() => {
    if (!dashboard) return "Not started";
    if (score >= 80) return "Strong habits";
    if (score >= 60) return "Building habits";
    return "Keep practising";
  }, [dashboard, score]);

  const displayedScenarios = premium ? scenarios : scenarios.slice(0, 3);

  const displayedHistory = premium ? history : history.slice(0, 5);

  const linkInputStatus = scanText.trim() ? isWebsiteLink(scanText) : null;

  const openScanner = (preset = "", mode: ScannerMode = "general") => {
    setScanText(preset);
    setScannerMode(mode);
    setReport(null);
    setScannerOpen(true);
  };

  const closeTransientUI = () => {
    if (dialog) {
      setDialog(null);
      return true;
    }

    if (scannerOpen) {
      setScannerOpen(false);
      return true;
    }

    if (selectedScenario) {
      setSelectedScenario(null);
      return true;
    }

    if (accountOpen) {
      setAccountOpen(false);
      return true;
    }

    if (authOpen) {
      setAuthOpen(false);
      return true;
    }

    if (premiumModalOpen) {
      setPremiumModalOpen(false);
      return true;
    }

    if (liveSessionOpen) {
      setLiveSessionOpen(false);
      return true;
    }

    return false;
  };

  const navigateToTab = (nextTab: Tab) => {
    setTab(nextTab);
    setScannerOpen(false);
    setSelectedScenario(null);
  };

  const loadSecondaryData = async (account: Dashboard | null) => {
    if (!account) {
      setDailyChallenge(null);
      setDailyAdvice(null);
      setScenarios([]);
      setHistory([]);
      return;
    }

    setSecondaryDataLoading(true);

    const results = await Promise.allSettled([
      getDailyChallenge(),
      getScenarios(),
      getScanHistory(),
      getDailyAdvice(),
    ]);

    const [challengeResult, scenariosResult, historyResult, adviceResult] =
      results;

    if (challengeResult.status === "fulfilled") {
      setDailyChallenge(challengeResult.value);
    }

    if (scenariosResult.status === "fulfilled") {
      setScenarios(scenariosResult.value);
    }

    if (historyResult.status === "fulfilled") {
      setHistory(historyResult.value);
    }

    if (adviceResult.status === "fulfilled") {
      setDailyAdvice(adviceResult.value);
    }

    setSecondaryDataLoading(false);
  };

  const loadAccount = async () => {
    if (!(await hasStoredSession())) {
      setDashboard(null);
      setScore(0);
      setStreak(0);
      setDailyChallenge(null);
      setDailyAdvice(null);
      setScenarios([]);
      setHistory([]);
      setSecondaryDataLoading(false);
      setAccountState("ready");
      return false;
    }

    setAccountState("loading");

    try {
      const account = await getDashboard();

      setDashboard(account);
      setScore(account.user.safetyScore);
      setStreak(account.streak);
      void SecureStore.setItemAsync(ACCOUNT_CACHE_KEY, JSON.stringify(account));
      await loadSecondaryData(account);
      setAccountState("ready");

      void getPushToken()
        .then((push) => {
          if (!push) return;
          return registerPushToken(push.token, push.platform);
        })
        .catch(() => undefined);

      return true;
    } catch {
      // Preserve the last successful dashboard during a transient outage.
      // If token refresh cleared the session, show the signed-out experience.
      if (!(await hasStoredSession())) {
        setDashboard(null);
        setScore(0);
        setStreak(0);
        setDailyChallenge(null);
        setDailyAdvice(null);
        setScenarios([]);
        setHistory([]);
        setAccountState("ready");
      } else {
        const cached = await SecureStore.getItemAsync(ACCOUNT_CACHE_KEY);

        if (cached) {
          try {
            const account = JSON.parse(cached) as Dashboard;
            setDashboard(account);
            setScore(account.user.safetyScore);
          } catch {
            await SecureStore.deleteItemAsync(ACCOUNT_CACHE_KEY);
          }
        }
        setAccountState("offline");
      }
      return false;
    }
  };

  const refreshAll = async () => {
    setRefreshing(true);

    try {
      await loadAccount();
    } finally {
      setRefreshing(false);
    }
  };

  useEffect(() => {
    let active = true;

    const boot = async () => {
      const [, onboardingComplete, savedAppearance] = await Promise.all([
        loadAccount(),
        SecureStore.getItemAsync("safecheck.onboarding.complete"),
        SecureStore.getItemAsync(APPEARANCE_KEY),
      ]);

      if (!active) return;

      setOnboarding(onboardingComplete !== "true");

      if (savedAppearance === "light" || savedAppearance === "dark") {
        setAppearance(savedAppearance);
      }

      setIsBooting(false);
    };

    void boot().catch(() => {
      if (!active) return;
      setOnboarding(false);
      setIsBooting(false);
    });

    return () => {
      active = false;
    };
  }, []);

  const setLightMode = (enabled: boolean) => {
    const next: Appearance = enabled ? "light" : "dark";
    setAppearance(next);
    void SecureStore.setItemAsync(APPEARANCE_KEY, next);
  };

  // The dashboard is shared state: refresh it when the app comes back to the
  // foreground, not only when a user manually pulls to refresh.
  const appState = useRef(AppState.currentState);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (nextState) => {
      const returnedToForeground =
        /inactive|background/.test(appState.current ?? "") &&
        nextState === "active";

      appState.current = nextState;

      if (returnedToForeground) {
        void loadAccount();
      }
    });

    return () => subscription.remove();
  }, []);

  useEffect(() => {
    const subscription = BackHandler.addEventListener(
      "hardwareBackPress",
      () => {
        if (closeTransientUI()) return true;

        if (tab !== "Home") {
          setTab("Home");
          return true;
        }

        return false;
      },
    );

    return () => subscription.remove();
  }, [
    accountOpen,
    authOpen,
    dialog,
    liveSessionOpen,
    premiumModalOpen,
    scannerOpen,
    selectedScenario,
    tab,
  ]);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state !== "active" || !pendingCheckoutReference || !dashboard) {
        return;
      }

      verifyPremiumCheckout(pendingCheckoutReference)
        .then(async () => {
          setPendingCheckoutReference(null);
          await loadAccount();

          setDialog({
            title: "Premium activated",
            message:
              "Your subscription is now active. You can now use unlimited scans and all Premium features.",
            icon: "✓",
            variant: "success",
          });
        })
        .catch(() => undefined);
    });

    return () => subscription.remove();
  }, [pendingCheckoutReference, dashboard]);

  useEffect(() => {
    const subscription = onForegroundNotification((title, body) =>
      setBanner({ title, body }),
    );

    return () => subscription.remove();
  }, []);

  useEffect(() => {
    const subscription = onNotificationResponse((destination) => {
      if (destination === "Home" || destination === "Protect") {
        setTab(destination);
      }
    });

    return () => subscription.remove();
  }, []);

  useEffect(() => {
    const preferences = dashboard?.user.notificationPreferences;

    if (!preferences) return;

    if (preferences.dailyChallenge) {
      enableDailyReminder(preferences.preferredHour ?? 9).then((enabled) => {
        if (!enabled) {
          setBanner({
            title: "Notifications are off",
            body: "Enable notifications in your device settings if you want daily safety reminders.",
          });
        }
      });
    } else {
      void disableDailyReminder();
    }
  }, [dashboard?.user.notificationPreferences]);

  useEffect(() => {
    if (resendCooldown <= 0) return;

    const timer = setInterval(() => {
      setResendCooldown((value) => (value > 0 ? value - 1 : 0));
    }, 1000);

    return () => clearInterval(timer);
  }, [resendCooldown]);

  useEffect(() => {
    if (!sharedText) return;

    setTab("Protect");
    openScanner(sharedText);
    onSharedTextHandled?.();
  }, [sharedText]);

  const completeChallenge = async (answer: string) => {
    if (!dailyChallenge || dailyChallenge.completedAt) {
      setAuthOpen(true);
      return;
    }

    try {
      const result = await completeDailyChallenge(
        dailyChallenge.scenario.id,
        answer,
        45000,
      );

      await loadAccount();

      if (!result.correct) {
        setDialog({
          title: "Here's the safer move",
          message: scenarioLesson(dailyChallenge.scenario.content),
          icon: "shield-checkmark-outline",
          variant: "warning",
        });
      } else {
        setDialog({
          title: "Great decision",
          message:
            "You identified the safer response and strengthened your protection progress.",
          icon: "checkmark-circle-outline",
          variant: "success",
        });
      }

      setChallengeDone(true);

      void Haptics.notificationAsync(
        Haptics.NotificationFeedbackType.Success,
      ).catch(() => undefined);
    } catch (error) {
      setDialog({
        title: "Challenge not saved",
        message:
          error instanceof Error
            ? prettifyTechnicalError(error.message)
            : "We couldn't save your result. Please try again.",
        icon: "alert-circle-outline",
        variant: "danger",
      });
    }
  };

  const runScan = async () => {
    const trimmed = scanText.trim();

    if (!trimmed) {
      setDialog({
        title: "Nothing to check yet",
        message:
          "Paste the suspicious message or link before starting the check.",
        icon: "search-outline",
        variant: "warning",
      });
      return;
    }

    const isLink = isWebsiteLink(trimmed);

    if (scannerMode === "link" && !isLink) {
      setDialog({
        title: "This doesn't look like a link",
        message:
          "Paste a website address such as example.com or https://example.com. If you want to check a message, use the message checker instead.",
        icon: "link-outline",
        variant: "warning",
        buttons: [
          { label: "Edit link", variant: "secondary" },
          {
            label: "Check as message",
            variant: "primary",
            onPress: () => {
              setDialog(null);
              setScannerMode("message");
            },
          },
        ],
      });
      return;
    }

    setScanBusy(true);

    try {
      const remote = await scanMessage(trimmed, isLink ? "URL" : "MESSAGE");

      setReport({
        risk:
          remote.risk === "LOW"
            ? "Low"
            : remote.risk === "MEDIUM"
              ? "Medium"
              : "High",
        score: remote.score,
        title:
          remote.risk === "HIGH"
            ? "Likely scam"
            : remote.risk === "MEDIUM"
              ? "Needs verification"
              : "No obvious warning signs",
        flags: Array.isArray(remote.redFlags) ? remote.redFlags : [],
        action:
          remote.recommendedAction ||
          "Verify unexpected requests independently before acting.",
        sourceText: trimmed,
        fromHistory: false,
      });

      if (dashboard) {
        try {
          setHistory(await getScanHistory());
        } catch {
          setBanner({
            title: "History is temporarily unavailable",
            body: "Your safety result is ready. We couldn't refresh your saved history.",
          });
        }
      }

      void Haptics.notificationAsync(
        Haptics.NotificationFeedbackType.Success,
      ).catch(() => undefined);
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "We couldn't complete the safety check.";

      const needsAuth =
        message.toLowerCase().includes("sign in") ||
        message.toLowerCase().includes("unauthorized") ||
        message.toLowerCase().includes("authentication");

      setDialog({
        title: needsAuth ? "Sign in to continue" : "Scan unavailable",
        message: needsAuth
          ? "Create or sign in to your SafeCheck account to save and complete your safety checks."
          : prettifyTechnicalError(message),
        icon: needsAuth ? "person-circle-outline" : "search-outline",
        variant: needsAuth ? "info" : "danger",
        buttons: needsAuth
          ? [
              {
                label: "Not now",
                variant: "secondary",
              },
              {
                label: "Sign in",
                variant: "primary",
                onPress: () => {
                  setDialog(null);
                  setScannerOpen(false);
                  setAuthOpen(true);
                },
              },
            ]
          : undefined,
      });
    } finally {
      setScanBusy(false);
    }

    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(
      () => undefined,
    );
  };

  const openHistoryReport = (item: ScanHistoryItem) => {
    setReport({
      risk:
        item.risk === "HIGH"
          ? "High"
          : item.risk === "MEDIUM"
            ? "Medium"
            : "Low",
      score: item.score,
      title: item.summary,
      flags: Array.isArray(item.redFlags)
        ? item.redFlags.filter(
            (flag): flag is string => typeof flag === "string",
          )
        : [],
      action:
        item.action ||
        "Verify unexpected requests independently before acting.",
      fromHistory: true,
    });

    setScannerOpen(true);
  };

  const authenticate = async () => {
    const normalizedEmail = email.trim().toLowerCase();

    if (!/^\S+@\S+\.\S+$/.test(normalizedEmail)) {
      setAuthError("Enter a valid email address.");
      return;
    }

    if (authMode === "verify" && !/^\d{6}$/.test(verificationCode)) {
      setAuthError("Enter the 6-digit code from your email.");
      return;
    }

    if (authMode === "signup" && !/^[a-zA-Z0-9_]{3,32}$/.test(username)) {
      setAuthError(
        "Use 3–32 letters, numbers, or underscores for your username.",
      );
      return;
    }

    if (authMode !== "verify" && password.length < 10) {
      setAuthError("Your password must contain at least 10 characters.");
      return;
    }

    setAuthError(null);
    setAuthBusy(true);

    try {
      if (authMode === "signup") {
        await signUp(normalizedEmail, username, password);

        setEmail(normalizedEmail);
        setAuthMode("verify");
        setAuthError(null);
        return;
      }

      if (authMode === "signin") {
        await signIn(normalizedEmail, password);
      } else {
        await verifyEmail(normalizedEmail, verificationCode);
      }

      await loadAccount();

      setAuthOpen(false);
      setVerificationCode("");
      setPassword("");

      setDialog({
        title: authMode === "verify" ? "Email verified" : "Welcome back",
        message:
          "Your SafeCheck account is connected and your progress will now be synced.",
        icon: "checkmark-circle-outline",
        variant: "success",
      });

      setTab("Home");
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "We couldn't complete authentication.";

      if (
        authMode === "signin" &&
        message.toLowerCase().includes("not verified")
      ) {
        setAuthMode("verify");
        setAuthError(
          "Your email still needs verification. Enter the code we sent to your inbox.",
        );
      } else {
        setAuthError(prettifyTechnicalError(message));
      }
    } finally {
      setAuthBusy(false);
    }
  };

  const handleResendCode = async () => {
    if (resendBusy || resendCooldown > 0) return;

    const normalizedEmail = email.trim().toLowerCase();

    if (!/^\S+@\S+\.\S+$/.test(normalizedEmail)) {
      setAuthError("Enter a valid email address before requesting a new code.");
      return;
    }

    setResendBusy(true);
    setAuthError(null);

    try {
      await resendVerification(normalizedEmail);

      setResendCooldown(30);

      setBanner({
        title: "New verification code sent",
        body: "Check your inbox and spam folder. The new code may take a moment to arrive.",
      });
    } catch (error) {
      setAuthError(
        error instanceof Error
          ? prettifyTechnicalError(error.message)
          : "We couldn't send a new code.",
      );
    } finally {
      setResendBusy(false);
    }
  };

  const answerScenario = async (answer: string) => {
    if (!selectedScenario) return;

    setScenarioBusy(true);

    try {
      const result = await completeScenario(selectedScenario.id, answer, 45000);

      await loadAccount();

      setSelectedScenario(null);

      setDialog({
        title: result.correct ? "Great decision" : "Here's the safer move",
        message: result.correct
          ? `You chose the safer response and earned ${result.rewards.xp} practice points. ${scenarioLesson(
              selectedScenario.content,
            )}`
          : scenarioLesson(selectedScenario.content),
        icon: result.correct
          ? "checkmark-circle-outline"
          : "shield-checkmark-outline",
        variant: result.correct ? "success" : "warning",
      });
    } catch (error) {
      setDialog({
        title: "Practice not saved",
        message:
          error instanceof Error
            ? prettifyTechnicalError(error.message)
            : "We couldn't save this practice result.",
        icon: "alert-circle-outline",
        variant: "danger",
      });
    } finally {
      setScenarioBusy(false);
    }
  };

  const openAccount = () => {
    if (!dashboard) {
      setAuthOpen(true);
      return;
    }

    setAccountView("menu");
    setDisplayName(dashboard.user.profile?.displayName ?? "");
    setCurrentPassword("");
    setNewPassword("");
    setDeletePassword("");
    setAccountOpen(true);
  };

  const handleSaveProfile = async () => {
    if (!dashboard) return;

    setAccountBusy(true);

    try {
      const profile = await saveProfile({
        displayName: displayName.trim() || undefined,
      });

      setDashboard({
        ...dashboard,
        user: {
          ...dashboard.user,
          profile,
        },
      });

      setBanner({
        title: "Profile updated",
        body: "Your display name has been saved.",
      });
    } catch (error) {
      setDialog({
        title: "Profile not updated",
        message:
          error instanceof Error
            ? prettifyTechnicalError(error.message)
            : "We couldn't save your profile.",
        icon: "alert-circle-outline",
        variant: "danger",
      });
    } finally {
      setAccountBusy(false);
    }
  };

  const handleSignOut = () => {
    setDialog({
      title: "Sign out?",
      message:
        "Your saved progress will remain on your account and can be restored when you sign in again.",
      icon: "log-out-outline",
      variant: "warning",
      buttons: [
        {
          label: "Cancel",
          variant: "secondary",
        },
        {
          label: "Sign out",
          variant: "danger",
          onPress: async () => {
            setAccountBusy(true);

            try {
              await signOut();
              await disableDailyReminder();
              await SecureStore.deleteItemAsync(ACCOUNT_CACHE_KEY);

              setDashboard(null);
              setDailyChallenge(null);
              setDailyAdvice(null);
              setScenarios([]);
              setHistory([]);
              setScore(0);
              setStreak(0);

              setAccountOpen(false);
              setAccountState("ready");

              setDialog({
                title: "Signed out",
                message: "Your local session has been cleared.",
                icon: "checkmark-circle-outline",
                variant: "success",
              });
            } catch (error) {
              setDialog({
                title: "Couldn't sign out",
                message:
                  error instanceof Error
                    ? prettifyTechnicalError(error.message)
                    : "Please try again.",
                icon: "alert-circle-outline",
                variant: "danger",
              });
            } finally {
              setAccountBusy(false);
            }
          },
        },
      ],
    });
  };

  const handleChangePassword = async () => {
    if (!currentPassword || newPassword.length < 10) {
      setDialog({
        title: "Check your password",
        message:
          "Enter your current password and a new password with at least 10 characters.",
        icon: "lock-closed-outline",
        variant: "warning",
      });
      return;
    }

    setAccountBusy(true);

    try {
      await changePassword(currentPassword, newPassword);

      await signOut();

      setDashboard(null);
      setAccountOpen(false);
      setAuthOpen(true);

      setDialog({
        title: "Password updated",
        message:
          "For your protection, you were signed out. Sign in again using your new password.",
        icon: "checkmark-circle-outline",
        variant: "success",
      });
    } catch (error) {
      setDialog({
        title: "Password not updated",
        message:
          error instanceof Error
            ? prettifyTechnicalError(error.message)
            : "We couldn't update your password.",
        icon: "alert-circle-outline",
        variant: "danger",
      });
    } finally {
      setAccountBusy(false);
    }
  };

  const handleDeleteAccount = async () => {
    if (!deletePassword) {
      setDialog({
        title: "Password required",
        message:
          "Enter your current password to permanently delete your account.",
        icon: "lock-closed-outline",
        variant: "warning",
      });
      return;
    }

    setDialog({
      title: "Delete account permanently?",
      message:
        "This permanently removes your account data, scan history and learning progress. This action cannot be undone.",
      icon: "trash-outline",
      variant: "danger",
      buttons: [
        {
          label: "Cancel",
          variant: "secondary",
        },
        {
          label: "Delete account",
          variant: "danger",
          onPress: async () => {
            setAccountBusy(true);

            try {
              await deleteAccount(deletePassword);
              await disableDailyReminder();
              await SecureStore.deleteItemAsync(ACCOUNT_CACHE_KEY);

              setDashboard(null);
              setDailyChallenge(null);
              setDailyAdvice(null);
              setScenarios([]);
              setHistory([]);
              setScore(0);
              setStreak(0);

              setAccountOpen(false);
              setAccountState("ready");

              setDialog({
                title: "Account deleted",
                message: "Your account and personal data have been removed.",
                icon: "checkmark-circle-outline",
                variant: "success",
              });
            } catch (error) {
              setDialog({
                title: "Couldn't delete account",
                message:
                  error instanceof Error
                    ? prettifyTechnicalError(error.message)
                    : "Please try again.",
                icon: "alert-circle-outline",
                variant: "danger",
              });
            } finally {
              setAccountBusy(false);
            }
          },
        },
      ],
    });
  };

  const setReminderHour = (hour: number) => {
    if (!dashboard) return;

    savePreferences({ preferredHour: hour })
      .then(async (preferences) => {
        setDashboard({
          ...dashboard,
          user: {
            ...dashboard.user,
            notificationPreferences: preferences,
          },
        });

        if (preferences.dailyChallenge) {
          await enableDailyReminder(hour);
        }

        setBanner({
          title: "Reminder updated",
          body: `We'll remind you at ${formatHour(hour)} each day.`,
        });
      })
      .catch(() =>
        setDialog({
          title: "Reminder not updated",
          message: "Check your connection and try again.",
          icon: "notifications-outline",
          variant: "warning",
        }),
      );
  };

  const toggleDailyReminder = async () => {
    if (!dashboard) return;

    const current = Boolean(
      dashboard.user.notificationPreferences?.dailyChallenge,
    );

    try {
      const next = await savePreferences({
        dailyChallenge: !current,
      });

      setDashboard({
        ...dashboard,
        user: {
          ...dashboard.user,
          notificationPreferences: next,
        },
      });

      if (next.dailyChallenge) {
        const hour = next.preferredHour ?? 9;
        const enabled = await enableDailyReminder(hour);

        if (!enabled) {
          setBanner({
            title: "Notifications are off",
            body: "Enable SafeCheck notifications in your device settings to receive the reminder.",
          });
        } else {
          setBanner({
            title: "Daily reminders on",
            body: `We'll remind you at ${formatHour(hour)} each day.`,
          });
        }
      } else {
        await disableDailyReminder();

        setBanner({
          title: "Daily reminders off",
          body: "You can turn them back on whenever you want.",
        });
      }
    } catch {
      setDialog({
        title: "Reminder not updated",
        message:
          "We couldn't save this preference. Check your connection and try again.",
        icon: "notifications-outline",
        variant: "warning",
      });
    }
  };

  const startCheckout = async () => {
    if (!dashboard) {
      setPremiumModalOpen(false);
      setAuthOpen(true);
      return;
    }

    setCheckoutBusy(true);

    try {
      const callback = process.env.EXPO_PUBLIC_CHECKOUT_CALLBACK_URL;

      if (!callback) {
        throw new Error("Premium payments are temporarily unavailable.");
      }

      const checkout = await startPremiumCheckout(callback);

      setPendingCheckoutReference(checkout.reference);

      setPremiumModalOpen(false);

      await Linking.openURL(checkout.authorizationUrl);

      setDialog({
        title: "Complete payment securely",
        message:
          "Finish the payment in your browser, then return to SafeCheck. Premium will activate automatically.",
        icon: "lock-closed-outline",
        variant: "info",
      });
    } catch (error) {
      setDialog({
        title: "Payment unavailable",
        message:
          error instanceof Error
            ? prettifyTechnicalError(error.message)
            : "We couldn't start Premium checkout.",
        icon: "alert-circle-outline",
        variant: "danger",
      });
    } finally {
      setCheckoutBusy(false);
    }
  };

  if (isBooting) {
    return (
      <SafeAreaView style={s.root}>
        <StatusBar
          barStyle={appearance === "light" ? "dark-content" : "light-content"}
        />
        <View style={s.boot}>
          <Ionicons
            name="shield-checkmark-outline"
            size={34}
            color={activePalette.blue}
          />
          <Text style={s.bootText}>Preparing SafeCheck…</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (liveSessionOpen) {
    return (
      <LiveSessionsPage
        appearance={appearance}
        visible
        onClose={() => setLiveSessionOpen(false)}
        signedIn={!!dashboard}
      />
    );
  }

  return (
    <SafeAreaView style={s.root}>
      <StatusBar
        barStyle={appearance === "light" ? "dark-content" : "light-content"}
      />

      <View style={s.top}>
        <View>
          <Text style={s.wordmark}>SafeCheck</Text>
          <Text style={s.tagline}>Your daily digital safety companion</Text>
        </View>

        <Pressable
          style={s.avatar}
          onPress={() => navigateToTab("Profile")}
          accessibilityRole="button"
          accessibilityLabel="Open your safety profile"
        >
          <Ionicons
            name={dashboard ? "person-outline" : "person-add-outline"}
            size={22}
            color={activePalette.text}
          />
        </Pressable>
      </View>

      {banner && (
        <Pressable
          accessibilityRole="alert"
          style={notificationStyles.banner}
          onPress={() => setBanner(null)}
        >
          <View style={s.flex}>
            <Text style={notificationStyles.title}>{banner.title}</Text>
            <Text style={notificationStyles.body}>{banner.body}</Text>
          </View>

          <Ionicons name="close" size={20} color={activePalette.muted} />
        </Pressable>
      )}

      <ScrollView
        contentContainerStyle={s.content}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={refreshAll}
            tintColor={activePalette.blue}
          />
        }
      >
        {accountState === "loading" && (
          <View style={s.statusCard} accessibilityLiveRegion="polite">
            <View style={s.statusRow}>
              <Ionicons
                name="shield-checkmark-outline"
                size={20}
                color={activePalette.blue}
              />
              <View style={s.flex}>
                <Text style={s.cardTitle}>Loading your safety space</Text>
                <Text style={s.cardBody}>
                  Checking your account and safety data.
                </Text>
              </View>
            </View>
          </View>
        )}

        {accountState === "offline" && (
          <View style={s.statusCard} accessibilityLiveRegion="assertive">
            <Text style={s.cardTitle}>
              We couldn't refresh your safety data
            </Text>
            <Text style={s.cardBody}>
              Check your connection, then try again. Your account has not been
              signed out.
            </Text>

            <Pressable
              style={s.secondary}
              onPress={loadAccount}
              accessibilityRole="button"
              accessibilityLabel="Retry loading your safety data"
            >
              <Text style={s.secondaryText}>Try again</Text>
            </Pressable>
          </View>
        )}

        {tab === "Home" && (
          <>
            <Pressable
              style={s.primaryAction}
              onPress={() => openScanner()}
              accessibilityRole="button"
              accessibilityLabel="Check a suspicious message or link"
            >
              <View style={s.primaryActionIcon}>
                <Ionicons
                  name="search-outline"
                  size={24}
                  color={activePalette.blue}
                />
              </View>
              <View style={s.flex}>
                <Text style={s.primaryActionTitle}>
                  Check a message or link
                </Text>
                <Text style={s.primaryActionBody}>
                  Get a clear next step before you act.
                </Text>
              </View>
              <Ionicons
                name="chevron-forward"
                size={20}
                color={activePalette.muted}
              />
            </Pressable>

            <View style={s.scoreCard}>
              <Text style={s.eyebrow}>YOUR PROTECTION PROGRESS</Text>

              {dashboard ? (
                <>
                  <View style={s.scoreRow}>
                    <Text style={s.score}>{score}</Text>

                    <View style={s.flex}>
                      <Text style={s.scoreState}>{scoreLabel}</Text>

                      <Text style={s.subtle}>
                        Based on your recent practice and safer decisions.
                      </Text>
                    </View>
                  </View>

                  <View style={s.track}>
                    <View
                      style={[
                        s.fill,
                        {
                          width: `${Math.max(0, Math.min(score, 100))}%`,
                        },
                      ]}
                    />
                  </View>

                  <Text style={s.scoreHint}>
                    Practice builds your safety score.
                  </Text>
                </>
              ) : (
                <>
                  <View style={s.scoreRow}>
                    <Text style={s.scoreMuted}>—</Text>

                    <View style={s.flex}>
                      <Text style={s.scoreState}>Not started</Text>

                      <Text style={s.subtle}>
                        Sign in later to save your safety progress and streak.
                      </Text>
                    </View>
                  </View>
                </>
              )}
            </View>

            <View style={s.sectionHeader}>
              <Text style={s.section}>Today</Text>
            </View>

            {dailyAdvice && dashboard && (
              <View style={s.note}>
                <Pressable
                  style={s.noteHeader}
                  onPress={() => setDailyAdviceExpanded((value) => !value)}
                  accessibilityRole="button"
                  accessibilityLabel={
                    dailyAdviceExpanded
                      ? "Collapse daily safety advice"
                      : "Expand daily safety advice"
                  }
                  accessibilityState={{
                    expanded: dailyAdviceExpanded,
                  }}
                >
                  <View style={s.noteIcon}>
                    <Ionicons
                      name="bulb-outline"
                      size={18}
                      color={activePalette.amber}
                    />
                  </View>

                  <View style={s.flex}>
                    <Text style={s.noteLabel}>DAILY SAFETY ADVICE</Text>

                    <Text style={s.noteTitle}>{dailyAdvice.title}</Text>
                  </View>

                  <Ionicons
                    name={dailyAdviceExpanded ? "chevron-up" : "chevron-down"}
                    size={19}
                    color={activePalette.muted}
                  />
                </Pressable>

                {dailyAdviceExpanded && (
                  <Text style={s.cardBody}>{dailyAdvice.body}</Text>
                )}
              </View>
            )}

            {dashboard ? (
              <View style={s.challengeCard}>
                <View style={s.row}>
                  <View style={s.iconBox}>
                    <Ionicons
                      name="shield-half-outline"
                      size={21}
                      color={activePalette.blue}
                    />
                  </View>

                  <View style={s.flex}>
                    <Text style={s.cardTitle}>
                      {challengeDone || dailyChallenge?.completedAt
                        ? "Today's challenge complete"
                        : challengeStarted
                          ? "What would you do?"
                          : (dailyChallenge?.scenario.title ??
                            "Today's safety challenge")}
                    </Text>

                    <Text style={s.cardBody}>
                      {challengeDone || dailyChallenge?.completedAt
                        ? "You completed today's practice. Come back tomorrow to continue your streak."
                        : challengeStarted && dailyChallenge
                          ? scenarioPrompt(
                              dailyChallenge.scenario.content,
                              dailyChallenge.scenario.description,
                            )
                          : (dailyChallenge?.scenario.description ??
                            "Take a short scenario and practice spotting common scam signals.")}
                    </Text>
                  </View>
                </View>

                <View style={s.meta}>
                  <View style={s.metaItem}>
                    <Ionicons
                      name="time-outline"
                      size={14}
                      color={activePalette.muted}
                    />
                    <Text style={s.muted}>~45 seconds</Text>
                  </View>

                  <View style={s.metaItem}>
                    <Ionicons
                      name="sparkles-outline"
                      size={14}
                      color={activePalette.green}
                    />
                    <Text style={s.xp}>+20 points</Text>
                  </View>
                </View>

                {challengeStarted && dailyChallenge ? (
                  <View>
                    {scenarioChoices(dailyChallenge.scenario.content).map(
                      (choice) => (
                        <Pressable
                          key={choice}
                          style={[
                            s.secondary,
                            scenarioBusy && s.disabledBorder,
                          ]}
                          onPress={() => completeChallenge(choice)}
                          disabled={scenarioBusy}
                          accessibilityRole="button"
                          accessibilityLabel={`Answer today's challenge: ${choice}`}
                        >
                          <Text style={s.secondaryText}>{choice}</Text>
                        </Pressable>
                      ),
                    )}
                  </View>
                ) : (
                  <Pressable
                    style={[
                      s.primary,
                      (challengeDone || !!dailyChallenge?.completedAt) &&
                        s.disabled,
                    ]}
                    onPress={() =>
                      dailyChallenge
                        ? setChallengeStarted(true)
                        : setDialog({
                            title: "Challenge unavailable",
                            message:
                              "We couldn't load today's challenge. Pull down to refresh and try again.",
                            icon: "refresh-outline",
                            variant: "warning",
                          })
                    }
                    disabled={
                      challengeDone ||
                      !!dailyChallenge?.completedAt ||
                      secondaryDataLoading
                    }
                  >
                    <Text style={s.primaryText}>
                      {challengeDone || dailyChallenge?.completedAt
                        ? "Completed today"
                        : secondaryDataLoading
                          ? "Loading challenge…"
                          : "Start today's challenge"}
                    </Text>
                  </Pressable>
                )}
              </View>
            ) : (
              <View style={s.challengeCard}>
                <View style={s.row}>
                  <View style={s.iconBox}>
                    <Ionicons
                      name="flash-outline"
                      size={21}
                      color={activePalette.blue}
                    />
                  </View>

                  <View style={s.flex}>
                    <Text style={s.cardTitle}>Try SafeCheck first</Text>

                    <Text style={s.cardBody}>
                      Get a clear next step before you act.
                    </Text>
                  </View>
                </View>

                <Pressable
                  onPress={() => {
                    setAuthOpen(true);
                    setAuthMode("signin");
                  }}
                >
                  <Text style={[s.link, { textAlign: "center" }]}>
                    Sign in to save your progress
                  </Text>
                </Pressable>
              </View>
            )}

            {history.length > 0 && dashboard && (
              <>
                <View style={s.sectionHeader}>
                  <Text style={s.section}>Latest protection activity</Text>

                  <Pressable onPress={() => navigateToTab("History")}>
                    <Text style={s.seeAll}>See all</Text>
                  </Pressable>
                </View>

                <Pressable
                  style={s.activity}
                  onPress={() => openHistoryReport(history[0])}
                >
                  <View
                    style={[
                      s.activityIconBox,
                      history[0].risk === "HIGH"
                        ? s.activityDanger
                        : history[0].risk === "MEDIUM"
                          ? s.activityWarning
                          : s.activitySafe,
                    ]}
                  >
                    <Ionicons
                      name={
                        history[0].risk === "HIGH"
                          ? "warning-outline"
                          : "shield-checkmark-outline"
                      }
                      size={19}
                      color={activePalette.text}
                    />
                  </View>

                  <View style={s.flex}>
                    <Text style={s.activityTitle} numberOfLines={2}>
                      {history[0].summary}
                    </Text>

                    <Text style={s.muted}>
                      {new Date(history[0].createdAt).toLocaleDateString()} ·{" "}
                      {history[0].risk.toLowerCase()} risk
                    </Text>
                  </View>

                  <Ionicons
                    name="chevron-forward"
                    size={18}
                    color={activePalette.muted}
                  />
                </Pressable>
              </>
            )}
          </>
        )}

        {tab === "Protect" && (
          <>
            <Text style={s.pageTitle}>Check before you act</Text>

            <Text style={s.pageIntro}>
              Paste anything suspicious before you reply, click, or pay.
            </Text>

            <Pressable
              style={s.primaryAction}
              onPress={() => openScanner("", "message")}
              accessibilityRole="button"
              accessibilityLabel="Check a suspicious message"
            >
              <View style={s.primaryActionIcon}>
                <Ionicons
                  name="chatbubble-ellipses-outline"
                  size={24}
                  color={activePalette.blue}
                />
              </View>

              <View style={s.flex}>
                <Text style={s.primaryActionTitle}>
                  Check a suspicious message
                </Text>

                <Text style={s.primaryActionBody}>
                  Paste an SMS, WhatsApp message, or email.
                </Text>
              </View>

              <Ionicons
                name="chevron-forward"
                size={20}
                color={activePalette.muted}
              />
            </Pressable>

            <Pressable
              style={s.action}
              onPress={() => openScanner("", "link")}
              accessibilityRole="button"
              accessibilityLabel="Check a suspicious link"
            >
              <View style={s.iconBox}>
                <Ionicons
                  name="link-outline"
                  size={21}
                  color={activePalette.blue}
                />
              </View>

              <View style={s.flex}>
                <Text style={s.cardTitle}>Check a link</Text>

                <Text style={s.cardBody}>
                  Paste a website address before opening it.
                </Text>
              </View>

              <Ionicons
                name="chevron-forward"
                size={19}
                color={activePalette.muted}
              />
            </Pressable>

            <View style={s.privacyCard}>
              <View style={s.privacyIcon}>
                <Ionicons
                  name="lock-closed-outline"
                  size={18}
                  color={activePalette.green}
                />
              </View>

              <View style={s.flex}>
                <Text style={s.noteTitle}>
                  Never paste passwords, PINs, or codes.
                </Text>
              </View>
            </View>

            {!dashboard && (
              <View style={s.authHintCard}>
                <Text style={s.authHintTitle}>Sign in when you're ready</Text>

                <Text style={s.cardBody}>
                  Your account saves your scan history, scan history and
                  learning progress.
                </Text>

                <Pressable
                  style={s.secondary}
                  onPress={() => setAuthOpen(true)}
                >
                  <Text style={s.secondaryText}>
                    Sign in or create an account
                  </Text>
                </Pressable>
              </View>
            )}
          </>
        )}

        {tab === "Learn" && (
          <>
            <Text style={s.pageTitle}>Build safer instincts</Text>

            <Text style={s.pageIntro}>
              Practice real scam patterns and learn why safer responses work.
            </Text>

            <View style={s.learningHero}>
              <View style={s.learningHeroIcon}>
                <Ionicons
                  name="school-outline"
                  size={24}
                  color={activePalette.blue}
                />
              </View>

              <View style={s.flex}>
                <Text style={s.cardTitle}>Short, practical lessons</Text>

                <Text style={s.cardBody}>
                  Each scenario takes about a minute and teaches one useful
                  pattern.
                </Text>
              </View>
            </View>

            <View style={s.sectionHeader}>
              <Text style={s.section}>Scenario library</Text>
            </View>

            {!dashboard ? (
              <View style={s.emptyCard}>
                <Ionicons
                  name="lock-open-outline"
                  size={26}
                  color={activePalette.blue}
                />

                <Text style={s.emptyTitle}>Connect your account</Text>

                <Text style={s.emptyBody}>
                  Sign in to access your learning progress and scenario library.
                </Text>

                <Pressable style={s.primary} onPress={() => setAuthOpen(true)}>
                  <Text style={s.primaryText}>Connect account</Text>
                </Pressable>
              </View>
            ) : secondaryDataLoading && scenarios.length === 0 ? (
              <View style={s.emptyCard}>
                <Text style={s.cardTitle}>Loading scenarios…</Text>
                <Text style={s.cardBody}>Preparing your learning library.</Text>
              </View>
            ) : (
              <>
                {displayedScenarios.map((scenario) => (
                  <Pressable
                    key={scenario.id}
                    style={s.listItem}
                    onPress={() => setSelectedScenario(scenario)}
                    accessibilityRole="button"
                    accessibilityLabel={`Practice scenario: ${scenario.title}`}
                  >
                    <View style={s.listLeadingIcon}>
                      <Ionicons
                        name="shield-outline"
                        size={18}
                        color={activePalette.blue}
                      />
                    </View>

                    <View style={s.flex}>
                      <Text style={s.cardTitle} numberOfLines={2}>
                        {scenario.title}
                      </Text>

                      <Text style={s.muted}>
                        {scenario.category.name} · Level {scenario.difficulty}
                      </Text>
                    </View>

                    <Text style={s.practiceText}>Practice</Text>
                  </Pressable>
                ))}

                {!premium && scenarios.length > 3 && (
                  <Pressable
                    style={s.lockedCard}
                    onPress={() => {
                      setPremiumFeatureHint("the full learning library");
                      setPremiumModalOpen(true);
                    }}
                  >
                    <View style={s.listLeadingIcon}>
                      <Ionicons
                        name="lock-closed-outline"
                        size={18}
                        color={activePalette.amber}
                      />
                    </View>

                    <View style={s.flex}>
                      <Text style={s.cardTitle}>More scenarios are locked</Text>

                      <Text style={s.cardBody}>
                        Upgrade to Premium to unlock the full learning library.
                      </Text>
                    </View>

                    <Ionicons
                      name="chevron-forward"
                      size={18}
                      color={activePalette.muted}
                    />
                  </Pressable>
                )}

                <View style={s.liveSessionCard}>
                  <View style={s.liveIcon}>
                    <Ionicons
                      name="people-outline"
                      size={21}
                      color={activePalette.blue}
                    />
                  </View>

                  <View style={s.flex}>
                    <Text style={s.cardTitle}>Learn together</Text>

                    <Text style={s.cardBody}>
                      Join a live safety session with a group code.
                    </Text>
                  </View>

                  <Pressable onPress={() => setLiveSessionOpen(true)}>
                    <Text style={s.seeAll}>Open</Text>
                  </Pressable>
                </View>
              </>
            )}
          </>
        )}

        {tab === "History" && (
          <>
            <Text style={s.pageTitle}>Safety checks</Text>

            <Text style={s.pageIntro}>
              Review previous checks and the risks SafeCheck identified.
            </Text>

            {!dashboard ? (
              <View style={s.emptyCard}>
                <Ionicons
                  name="time-outline"
                  size={28}
                  color={activePalette.blue}
                />

                <Text style={s.emptyTitle}>Your history is private</Text>

                <Text style={s.emptyBody}>
                  Sign in to save and review your previous safety checks.
                </Text>

                <Pressable style={s.primary} onPress={() => setAuthOpen(true)}>
                  <Text style={s.primaryText}>Sign in</Text>
                </Pressable>
              </View>
            ) : secondaryDataLoading && history.length === 0 ? (
              <View style={s.emptyCard}>
                <Text style={s.cardTitle}>Loading your history…</Text>
                <Text style={s.cardBody}>
                  Retrieving your saved safety checks.
                </Text>
              </View>
            ) : displayedHistory.length > 0 ? (
              <>
                {displayedHistory.map((item) => (
                  <Pressable
                    key={item.id}
                    style={s.listItem}
                    onPress={() => openHistoryReport(item)}
                  >
                    <View
                      style={[
                        s.riskMini,
                        item.risk === "HIGH"
                          ? s.activityDanger
                          : item.risk === "MEDIUM"
                            ? s.activityWarning
                            : s.activitySafe,
                      ]}
                    >
                      <Ionicons
                        name={
                          item.risk === "HIGH"
                            ? "warning-outline"
                            : "shield-checkmark-outline"
                        }
                        size={18}
                        color={activePalette.text}
                      />
                    </View>

                    <View style={s.flex}>
                      <Text style={s.cardTitle} numberOfLines={2}>
                        {item.summary}
                      </Text>

                      <Text style={s.muted}>
                        {new Date(item.createdAt).toLocaleDateString()} ·{" "}
                        {item.score}/100
                      </Text>
                    </View>

                    <Ionicons
                      name="chevron-forward"
                      size={18}
                      color={activePalette.muted}
                    />
                  </Pressable>
                ))}

                {!premium && history.length > 5 && (
                  <Pressable
                    style={s.lockedCard}
                    onPress={() => {
                      setPremiumFeatureHint("your full scan history");
                      setPremiumModalOpen(true);
                    }}
                  >
                    <Ionicons
                      name="lock-closed-outline"
                      size={19}
                      color={activePalette.amber}
                    />

                    <View style={s.flex}>
                      <Text style={s.cardTitle}>Older checks are locked</Text>

                      <Text style={s.cardBody}>
                        Premium keeps your complete safety history.
                      </Text>
                    </View>

                    <Ionicons
                      name="chevron-forward"
                      size={18}
                      color={activePalette.muted}
                    />
                  </Pressable>
                )}
              </>
            ) : (
              <View style={s.emptyCard}>
                <Ionicons
                  name="scan-outline"
                  size={28}
                  color={activePalette.blue}
                />

                <Text style={s.emptyTitle}>No safety checks yet</Text>

                <Text style={s.emptyBody}>
                  When you check a message or link, the result will appear here.
                </Text>

                <Pressable style={s.primary} onPress={() => openScanner()}>
                  <Text style={s.primaryText}>Check something</Text>
                </Pressable>
              </View>
            )}
          </>
        )}

        {tab === "Profile" && (
          <>
            <Text style={s.pageTitle}>Your safety profile</Text>

            <View style={s.profileHero}>
              <View style={s.largeAvatar}>
                <Ionicons
                  name="person-outline"
                  size={24}
                  color={activePalette.text}
                />
              </View>

              <View style={s.flex}>
                <Text style={s.cardTitle}>
                  {dashboard?.user.profile?.displayName ??
                    dashboard?.user.username ??
                    "Your SafeCheck profile"}
                </Text>

                <Text style={s.muted}>
                  {dashboard
                    ? "Your personal safety progress"
                    : "Sign in to sync your progress"}
                </Text>
              </View>

              <Pressable onPress={openAccount}>
                <Text style={s.linkNoMargin}>
                  {dashboard ? "Account" : "Connect"}
                </Text>
              </Pressable>
            </View>

            <Text style={s.section}>Appearance</Text>

            <View style={s.preferenceCard}>
              <View style={s.settingsIcon}>
                <Ionicons
                  name={
                    appearance === "light" ? "sunny-outline" : "moon-outline"
                  }
                  size={18}
                  color={activePalette.blue}
                />
              </View>

              <View style={s.flex}>
                <Text style={s.cardTitle}>Light mode</Text>
                <Text style={s.muted}>Use a brighter app appearance.</Text>
              </View>

              <Switch
                value={appearance === "light"}
                onValueChange={setLightMode}
                trackColor={{
                  false: activePalette.line,
                  true: activePalette.blue,
                }}
                thumbColor={activePalette.surface}
                accessibilityLabel="Toggle light mode"
              />
            </View>

            {dashboard ? (
              <>
                <View style={s.stats}>
                  <Stat
                    value={`${dashboard.user.xp}`}
                    label="Practice points"
                    styles={s}
                  />
                  <Stat value={`${streak}`} label="Day streak" styles={s} />
                  <Stat
                    value={`${history.length}`}
                    label="Safety checks"
                    styles={s}
                  />
                </View>

                <Text style={s.section}>Account</Text>

                <Pressable style={s.listItem} onPress={openAccount}>
                  <View style={s.settingsIcon}>
                    <Ionicons
                      name="person-outline"
                      size={18}
                      color={activePalette.blue}
                    />
                  </View>

                  <View style={s.flex}>
                    <Text style={s.cardTitle}>Account settings</Text>

                    <Text style={s.muted}>{dashboard.user.email}</Text>
                  </View>

                  <Ionicons
                    name="chevron-forward"
                    size={18}
                    color={activePalette.muted}
                  />
                </Pressable>

                <Text style={s.section}>Premium</Text>

                <Pressable
                  style={s.listItem}
                  onPress={() => {
                    if (premium) return;

                    setPremiumFeatureHint(null);
                    setPremiumModalOpen(true);
                  }}
                  disabled={checkoutBusy || premium}
                >
                  <View style={s.settingsIcon}>
                    <Ionicons
                      name="sparkles-outline"
                      size={18}
                      color={premium ? activePalette.green : activePalette.blue}
                    />
                  </View>

                  <View style={s.flex}>
                    <Text style={s.cardTitle}>
                      {premium ? "Premium active" : "Upgrade to Premium"}
                    </Text>

                    <Text style={s.muted}>
                      {checkoutBusy
                        ? "Opening payment…"
                        : premium
                          ? dashboard.subscription.currentPeriodEndsAt
                            ? dashboard.subscription.status === "CANCELED"
                              ? `Ends ${new Date(
                                  dashboard.subscription.currentPeriodEndsAt,
                                ).toLocaleDateString()}`
                              : `Renews ${new Date(
                                  dashboard.subscription.currentPeriodEndsAt,
                                ).toLocaleDateString()}`
                            : "Active"
                          : "Unlimited scans and the full learning library"}
                    </Text>
                  </View>

                  {!premium && (
                    <Ionicons
                      name="chevron-forward"
                      size={18}
                      color={activePalette.muted}
                    />
                  )}
                </Pressable>

                {premium && (
                  <Pressable
                    style={s.listItem}
                    onPress={() =>
                      setDialog({
                        title: "Cancel Premium?",
                        message:
                          "You'll keep Premium access until the end of your current billing period.",
                        icon: "calendar-outline",
                        variant: "warning",
                        buttons: [
                          {
                            label: "Keep Premium",
                            variant: "secondary",
                          },
                          {
                            label: "Cancel subscription",
                            variant: "danger",
                            onPress: async () => {
                              try {
                                await cancelSubscription();
                                await loadAccount();

                                setDialog({
                                  title: "Subscription canceled",
                                  message:
                                    "Premium will remain active until the end of your current billing period.",
                                  icon: "checkmark-circle-outline",
                                  variant: "success",
                                });
                              } catch (error) {
                                setDialog({
                                  title: "Couldn't cancel",
                                  message:
                                    error instanceof Error
                                      ? prettifyTechnicalError(error.message)
                                      : "Please try again.",
                                  icon: "alert-circle-outline",
                                  variant: "danger",
                                });
                              }
                            },
                          },
                        ],
                      })
                    }
                  >
                    <View style={s.settingsIcon}>
                      <Ionicons
                        name="close-circle-outline"
                        size={18}
                        color={activePalette.red}
                      />
                    </View>

                    <View style={s.flex}>
                      <Text style={s.cardTitle}>Cancel subscription</Text>

                      <Text style={s.muted}>
                        Premium stays active until your billing period ends.
                      </Text>
                    </View>

                    <Ionicons
                      name="chevron-forward"
                      size={18}
                      color={activePalette.muted}
                    />
                  </Pressable>
                )}

                <Text style={s.section}>Notifications</Text>

                <View style={s.preferenceCard}>
                  <View style={s.settingsIcon}>
                    <Ionicons
                      name="notifications-outline"
                      size={18}
                      color={activePalette.blue}
                    />
                  </View>

                  <View style={s.flex}>
                    <Text style={s.cardTitle}>Daily challenge reminder</Text>

                    <Text style={s.muted}>Get one reminder each day.</Text>
                  </View>

                  <Switch
                    value={Boolean(
                      dashboard.user.notificationPreferences?.dailyChallenge,
                    )}
                    onValueChange={toggleDailyReminder}
                    trackColor={{
                      false: activePalette.line,
                      true: activePalette.green,
                    }}
                    thumbColor={
                      dashboard.user.notificationPreferences?.dailyChallenge
                        ? activePalette.green
                        : activePalette.surface
                    }
                    accessibilityLabel="Daily challenge reminder"
                  />
                </View>

                {dashboard.user.notificationPreferences?.dailyChallenge && (
                  <Pressable
                    style={s.listItem}
                    onPress={() =>
                      setDialog({
                        title: "Daily reminder time",
                        message: "Choose a time that fits your routine.",
                        icon: "time-outline",
                        variant: "info",
                        buttons: [
                          {
                            label: "9:00 AM",
                            variant: "secondary",
                            onPress: () => setReminderHour(9),
                          },
                          {
                            label: "12:00 PM",
                            variant: "secondary",
                            onPress: () => setReminderHour(12),
                          },
                          {
                            label: "6:00 PM",
                            variant: "secondary",
                            onPress: () => setReminderHour(18),
                          },
                          {
                            label: "Cancel",
                            variant: "primary",
                          },
                        ],
                      })
                    }
                  >
                    <View style={s.settingsIcon}>
                      <Ionicons
                        name="time-outline"
                        size={18}
                        color={activePalette.blue}
                      />
                    </View>

                    <View style={s.flex}>
                      <Text style={s.cardTitle}>Reminder time</Text>

                      <Text style={s.muted}>
                        {formatHour(
                          dashboard.user.notificationPreferences
                            .preferredHour ?? 9,
                        )}
                      </Text>
                    </View>

                    <Ionicons
                      name="chevron-forward"
                      size={18}
                      color={activePalette.muted}
                    />
                  </Pressable>
                )}
              </>
            ) : (
              <View style={s.connectProfileCard}>
                <Ionicons
                  name="person-circle-outline"
                  size={34}
                  color={activePalette.blue}
                />

                <Text style={s.emptyTitle}>Save your progress</Text>

                <Text style={s.emptyBody}>
                  Create a free account to keep your challenge streak, scan
                  history, and learning progress.
                </Text>

                <Pressable style={s.primary} onPress={() => setAuthOpen(true)}>
                  <Text style={s.primaryText}>Create account</Text>
                </Pressable>

                <Pressable
                  onPress={() => {
                    setAuthMode("signin");
                    setAuthOpen(true);
                  }}
                >
                  <Text style={[s.link, { textAlign: "center" }]}>
                    Already have an account? Sign in
                  </Text>
                </Pressable>
              </View>
            )}
          </>
        )}
      </ScrollView>

      <View style={s.nav}>
        {tabs.map((item) => {
          const active = tab === item;

          return (
            <Pressable
              key={item}
              style={[s.navItem, active && s.navItemActive]}
              onPress={() => navigateToTab(item)}
              accessibilityRole="tab"
              accessibilityLabel={`${item} tab`}
              accessibilityState={{
                selected: active,
              }}
            >
              <Ionicons
                name={tabIcons[item]}
                size={21}
                color={active ? activePalette.blue : activePalette.muted}
              />

              <Text style={[s.navLabel, active && s.navActive]}>{item}</Text>
            </Pressable>
          );
        })}
      </View>

      <AppBottomSheet
        appearance={appearance}
        visible={!!selectedScenario}
        title={selectedScenario?.title ?? "Practice scenario"}
        subtitle="Choose the safest next step."
        onClose={() => setSelectedScenario(null)}
      >
        <Text style={s.cardBody}>
          {selectedScenario
            ? scenarioPrompt(
                selectedScenario.content,
                selectedScenario.description,
              )
            : ""}
        </Text>

        <Text style={s.reportHeader}>What is the safest next step?</Text>

        <Text style={s.muted}>
          Choose one answer. We'll explain why it is safer.
        </Text>

        {scenarioChoices(selectedScenario?.content).map((choice) => (
          <Pressable
            key={choice}
            style={[s.secondary, scenarioBusy && s.disabledBorder]}
            onPress={() => answerScenario(choice)}
            disabled={scenarioBusy}
            accessibilityRole="button"
            accessibilityLabel={`Answer scenario: ${choice}`}
            accessibilityState={{
              disabled: scenarioBusy,
            }}
          >
            <Text style={s.secondaryText}>{choice}</Text>
          </Pressable>
        ))}
      </AppBottomSheet>

      <AppBottomSheet
        appearance={appearance}
        visible={scannerOpen}
        title={
          report?.fromHistory
            ? "Previous safety check"
            : scannerMode === "link"
              ? "Check a link"
              : scannerMode === "message"
                ? "Check a message"
                : "Check a message or link"
        }
        subtitle={
          report?.fromHistory
            ? "Review the result from an earlier check."
            : scannerMode === "link"
              ? "Paste a website address before you open it."
              : scannerMode === "message"
                ? "Paste a message you are unsure about."
                : "Paste a message or website address to check it."
        }
        onClose={() => setScannerOpen(false)}
      >
        {report ? (
          <>
            <View
              style={[
                s.risk,
                report.risk === "High"
                  ? s.riskHigh
                  : report.risk === "Medium"
                    ? s.riskMedium
                    : s.riskLow,
              ]}
            >
              <View style={s.riskTopRow}>
                <Text style={s.eyebrow}>SAFETY ASSESSMENT</Text>

                <Text style={s.riskScore}>{report.risk} risk</Text>
              </View>

              <Text style={s.riskTitle}>{report.title}</Text>
            </View>

            {report.risk === "Low" && (
              <Text style={s.resultDisclaimerText}>
                Low risk is not a guarantee—verify unexpected requests
                independently.
              </Text>
            )}

            <Text style={s.reportHeader}>
              {report.risk === "Low" ? "What we found" : "Why we flagged it"}
            </Text>

            {report.flags.length > 0 ? (
              report.flags.map((flag) => (
                <View key={flag} style={s.flagRow}>
                  <Ionicons
                    name="alert-circle-outline"
                    size={17}
                    color={
                      report.risk === "High"
                        ? activePalette.red
                        : report.risk === "Medium"
                          ? activePalette.amber
                          : activePalette.blue
                    }
                  />

                  <Text style={s.flag}>{flag}</Text>
                </View>
              ))
            ) : (
              <Text style={s.cardBody}>
                {report.risk === "High"
                  ? "This was rated high risk, but detailed warning signs were unavailable. Do not act until you verify it independently."
                  : report.risk === "Medium"
                    ? "This needs independent verification before you act."
                    : "No common scam patterns were found in this content."}
              </Text>
            )}

            <View style={s.actionBox}>
              <Text style={s.actionLabel}>SAFEST NEXT STEP</Text>

              <Text style={s.cardBody}>{report.action}</Text>
            </View>

            <Text style={s.resultDisclaimerText}>
              This is guidance, not proof. Verify unexpected requests
              independently.
            </Text>

            <Pressable
              style={s.secondary}
              onPress={() => {
                setReport(null);
                setScanText("");
              }}
            >
              <Text style={s.secondaryText}>Check another message</Text>
            </Pressable>
          </>
        ) : (
          <>
            <View style={s.scannerIntro}>
              <Ionicons
                name="shield-checkmark-outline"
                size={24}
                color={activePalette.blue}
              />

              <Text style={s.cardBody}>
                {scannerMode === "link"
                  ? "Paste only the web address. We will tell you if it is a valid link before checking it."
                  : "Paste the suspicious part—there is no need for the full conversation."}
              </Text>
            </View>

            <TextInput
              value={scanText}
              onChangeText={setScanText}
              multiline
              autoFocus
              placeholder={
                scannerMode === "link"
                  ? "example.com or https://example.com"
                  : scannerMode === "message"
                    ? "Paste a suspicious message"
                    : "Paste a suspicious message or link"
              }
              placeholderTextColor={activePalette.muted}
              style={s.input}
              maxLength={5000}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType={scannerMode === "link" ? "url" : "default"}
              accessibilityLabel={
                scannerMode === "link"
                  ? "Website address to check"
                  : "Suspicious message or link"
              }
            />

            {scannerMode === "link" && linkInputStatus !== null && (
              <View
                style={[
                  s.linkInputStatus,
                  linkInputStatus
                    ? s.linkInputStatusValid
                    : s.linkInputStatusInvalid,
                ]}
              >
                <Ionicons
                  name={
                    linkInputStatus
                      ? "checkmark-circle-outline"
                      : "information-circle-outline"
                  }
                  size={17}
                  color={
                    linkInputStatus ? activePalette.green : activePalette.amber
                  }
                />
                <Text style={s.linkInputStatusText}>
                  {linkInputStatus
                    ? "Website address recognised. Ready to check."
                    : "This looks like text, not one website address."}
                </Text>
              </View>
            )}

            <View style={s.inputMeta}>
              <Text style={s.muted}>
                Do not include passwords, PINs, or codes.
              </Text>

              <Text style={s.muted}>{scanText.length}/5000</Text>
            </View>

            <Pressable
              style={[s.primary, scanBusy && s.disabled]}
              onPress={runScan}
              disabled={scanBusy}
            >
              <Text style={s.primaryText}>
                {scanBusy
                  ? "Checking safely…"
                  : scannerMode === "link"
                    ? "Check this link"
                    : "Check for scams"}
              </Text>
            </Pressable>
          </>
        )}
      </AppBottomSheet>

      <AppBottomSheet
        appearance={appearance}
        visible={accountOpen}
        title={
          accountView === "menu"
            ? "Account settings"
            : accountView === "password"
              ? "Change password"
              : "Delete account"
        }
        subtitle={
          accountView === "menu"
            ? "Manage your profile and saved account."
            : undefined
        }
        onClose={() => setAccountOpen(false)}
      >
        {accountView === "menu" ? (
          <>
            <View style={s.accountEmailCard}>
              <Ionicons
                name="mail-outline"
                size={18}
                color={activePalette.blue}
              />

              <View style={s.flex}>
                <Text style={s.muted}>Account email</Text>

                <Text style={s.cardTitle}>{dashboard?.user.email}</Text>
              </View>
            </View>

            <TextInput
              value={displayName}
              onChangeText={setDisplayName}
              placeholder="Display name"
              placeholderTextColor={activePalette.muted}
              style={s.authInput}
              maxLength={80}
              accessibilityLabel="Display name"
            />

            <Pressable
              style={[s.secondary, accountBusy && s.disabledBorder]}
              onPress={handleSaveProfile}
              disabled={accountBusy}
            >
              <Text style={s.secondaryText}>
                {accountBusy ? "Saving…" : "Save display name"}
              </Text>
            </Pressable>

            <Pressable
              style={s.listItem}
              onPress={() => setAccountView("password")}
            >
              <View style={s.settingsIcon}>
                <Ionicons
                  name="lock-closed-outline"
                  size={18}
                  color={activePalette.blue}
                />
              </View>

              <Text style={[s.flex, s.cardTitle]}>Change password</Text>

              <Ionicons
                name="chevron-forward"
                size={18}
                color={activePalette.muted}
              />
            </Pressable>

            <Pressable
              style={s.listItem}
              onPress={handleSignOut}
              disabled={accountBusy}
            >
              <View style={s.settingsIcon}>
                <Ionicons
                  name="log-out-outline"
                  size={18}
                  color={activePalette.blue}
                />
              </View>

              <Text style={[s.flex, s.cardTitle]}>Sign out</Text>

              <Ionicons
                name="chevron-forward"
                size={18}
                color={activePalette.muted}
              />
            </Pressable>

            <Pressable
              style={s.dangerItem}
              onPress={() => setAccountView("delete")}
              disabled={accountBusy}
            >
              <Ionicons
                name="trash-outline"
                size={18}
                color={activePalette.red}
              />

              <Text style={s.dangerText}>Delete account</Text>
            </Pressable>
          </>
        ) : accountView === "password" ? (
          <>
            <Text style={s.cardBody}>
              Changing your password signs you out so your account stays
              protected.
            </Text>

            <PasswordField
              value={currentPassword}
              onChangeText={setCurrentPassword}
              placeholder="Current password"
              visible={currentPasswordVisible}
              onToggle={() => setCurrentPasswordVisible((value) => !value)}
              styles={s}
              colors={activePalette}
            />

            <PasswordField
              value={newPassword}
              onChangeText={setNewPassword}
              placeholder="New password (10+ characters)"
              visible={newPasswordVisible}
              onToggle={() => setNewPasswordVisible((value) => !value)}
              styles={s}
              colors={activePalette}
            />

            <Text style={s.passwordHint}>Use at least 10 characters.</Text>

            <Pressable
              style={[s.primary, accountBusy && s.disabled]}
              onPress={handleChangePassword}
              disabled={accountBusy}
            >
              <Text style={s.primaryText}>
                {accountBusy ? "Updating…" : "Update password"}
              </Text>
            </Pressable>

            <Pressable onPress={() => setAccountView("menu")}>
              <Text style={s.link}>Back to account settings</Text>
            </Pressable>
          </>
        ) : (
          <>
            <View style={s.deleteWarning}>
              <Ionicons
                name="warning-outline"
                size={21}
                color={activePalette.red}
              />

              <Text style={s.cardBody}>
                This permanently removes your account data, scan history, and
                learning progress. It cannot be undone.
              </Text>
            </View>

            <PasswordField
              value={deletePassword}
              onChangeText={setDeletePassword}
              placeholder="Current password"
              visible={deletePasswordVisible}
              onToggle={() => setDeletePasswordVisible((value) => !value)}
              styles={s}
              colors={activePalette}
            />

            <Pressable
              style={[s.dangerButton, accountBusy && s.disabled]}
              onPress={handleDeleteAccount}
              disabled={accountBusy}
            >
              <Text style={s.dangerButtonText}>
                {accountBusy ? "Deleting…" : "Delete account"}
              </Text>
            </Pressable>

            <Pressable onPress={() => setAccountView("menu")}>
              <Text style={s.link}>Back to account settings</Text>
            </Pressable>
          </>
        )}
      </AppBottomSheet>

      <AppBottomSheet
        appearance={appearance}
        visible={premiumModalOpen}
        title="Upgrade to Premium"
        subtitle="More protection tools when you need them."
        onClose={() => setPremiumModalOpen(false)}
      >
        {premiumFeatureHint ? (
          <View style={s.premiumHintCard}>
            <Ionicons
              name="sparkles-outline"
              size={18}
              color={activePalette.blue}
            />

            <Text style={s.premiumHint}>
              This unlocks {premiumFeatureHint}.
            </Text>
          </View>
        ) : null}

        <View style={s.premiumCard}>
          <Text style={s.premiumFeatureTitle}>Premium includes</Text>

          {[
            "Unlimited message and link checks",
            "Full learning library",
            "Complete scan history",
          ].map((feature) => (
            <View key={feature} style={s.premiumFeatureRow}>
              <Ionicons
                name="checkmark-circle"
                size={17}
                color={activePalette.green}
              />

              <Text style={s.premiumFeatureText}>{feature}</Text>
            </View>
          ))}
        </View>

        <View style={s.planCard}>
          <Text style={s.planBadge}>MONTHLY</Text>

          <Text style={s.planPrice}>GHS 20 / month</Text>

          <Text style={s.planMeta}>Cancel anytime</Text>
        </View>

        <Pressable
          style={[s.primary, checkoutBusy && s.disabled]}
          onPress={startCheckout}
          disabled={checkoutBusy}
        >
          <Text style={s.primaryText}>
            {checkoutBusy ? "Preparing payment…" : "Continue to secure payment"}
          </Text>
        </Pressable>

        <Pressable onPress={() => setPremiumModalOpen(false)}>
          <Text
            style={[
              s.link,
              {
                textAlign: "center",
                marginTop: 12,
              },
            ]}
          >
            Maybe later
          </Text>
        </Pressable>
      </AppBottomSheet>

      <AppBottomSheet
        appearance={appearance}
        visible={authOpen}
        title={
          authMode === "signin"
            ? "Sign in to SafeCheck"
            : authMode === "signup"
              ? "Create your free account"
              : "Verify your email"
        }
        subtitle={
          authMode === "verify"
            ? "Enter the code we sent to your email."
            : "Save your history, learning progress, and challenge streak."
        }
        onClose={() => setAuthOpen(false)}
      >
        {authError && (
          <View style={s.authErrorCard}>
            <Ionicons
              name="alert-circle-outline"
              size={18}
              color={activePalette.red}
            />

            <Text style={s.formError} accessibilityLiveRegion="assertive">
              {authError}
            </Text>
          </View>
        )}

        {authMode === "signup" && (
          <>
            <TextInput
              value={username}
              onChangeText={setUsername}
              placeholder="Username"
              placeholderTextColor={activePalette.muted}
              style={s.authInput}
              autoCapitalize="none"
              accessibilityLabel="Username"
            />

            <Text style={s.fieldHint}>
              3–32 letters, numbers, or underscores.
            </Text>
          </>
        )}

        {authMode === "verify" ? (
          <>
            <View style={s.verificationEmail}>
              <Ionicons
                name="mail-outline"
                size={18}
                color={activePalette.blue}
              />

              <View style={s.flex}>
                <Text style={s.verificationLabel}>
                  Verification code sent to
                </Text>

                <Text style={s.verificationAddress}>{email}</Text>
              </View>
            </View>

            <Pressable
              onPress={() => {
                setAuthMode("signup");
                setAuthError(null);
              }}
            >
              <Text style={s.link}>Change email</Text>
            </Pressable>
          </>
        ) : (
          <TextInput
            value={email}
            onChangeText={setEmail}
            placeholder="Email address"
            placeholderTextColor={activePalette.muted}
            style={s.authInput}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            accessibilityLabel="Email address"
          />
        )}

        {authMode !== "verify" && (
          <>
            <PasswordField
              value={password}
              onChangeText={setPassword}
              placeholder="Password (10+ characters)"
              visible={passwordVisible}
              onToggle={() => setPasswordVisible((value) => !value)}
              styles={s}
              colors={activePalette}
            />

            <Text style={s.fieldHint}>Use at least 10 characters.</Text>
          </>
        )}

        {authMode === "verify" && (
          <>
            <TextInput
              value={verificationCode}
              onChangeText={setVerificationCode}
              placeholder="6-digit verification code"
              placeholderTextColor={activePalette.muted}
              style={s.authInput}
              keyboardType="number-pad"
              maxLength={6}
              accessibilityLabel="Email verification code"
            />

            <Pressable
              onPress={handleResendCode}
              disabled={resendBusy || resendCooldown > 0}
            >
              <Text
                style={[
                  s.link,
                  (resendBusy || resendCooldown > 0) && s.linkDisabled,
                ]}
              >
                {resendBusy
                  ? "Sending…"
                  : resendCooldown > 0
                    ? `Resend code in ${resendCooldown}s`
                    : "Didn't receive the code? Resend"}
              </Text>
            </Pressable>
          </>
        )}

        <Pressable
          style={[s.primary, authBusy && s.disabled]}
          onPress={authenticate}
          disabled={authBusy}
        >
          <Text style={s.primaryText}>
            {authBusy
              ? authMode === "verify"
                ? "Verifying…"
                : "Connecting…"
              : authMode === "signin"
                ? "Sign in"
                : authMode === "signup"
                  ? "Create account"
                  : "Verify email"}
          </Text>
        </Pressable>

        {authMode !== "verify" && (
          <Pressable
            onPress={() => {
              setAuthMode(authMode === "signin" ? "signup" : "signin");
              setAuthError(null);
            }}
          >
            <Text
              style={[
                s.link,
                {
                  textAlign: "center",
                  marginTop: 16,
                },
              ]}
            >
              {authMode === "signin"
                ? "New here? Create a free account"
                : "Already have an account? Sign in"}
            </Text>
          </Pressable>
        )}
      </AppBottomSheet>

      <AppDialog
        appearance={appearance}
        visible={!!dialog}
        title={dialog?.title ?? ""}
        message={dialog?.message ?? ""}
        icon={dialog?.icon}
        variant={dialog?.variant}
        buttons={dialog?.buttons}
        onDismiss={() => setDialog(null)}
      />

      <Modal
        visible={onboarding === true}
        animationType="fade"
        onRequestClose={() => undefined}
      >
        <SafeAreaView style={s.onboarding}>
          <View style={s.onboardingTop}>
            <Text style={s.wordmark}>SafeCheck</Text>

            <Pressable
              onPress={() => {
                void SecureStore.setItemAsync(
                  "safecheck.onboarding.complete",
                  "true",
                );

                setOnboarding(false);
              }}
            >
              <Text style={s.onboardingSkip}>Skip</Text>
            </Pressable>
          </View>

          <View style={s.onboardingMain}>
            <View style={s.onboardingIcon}>
              <Ionicons
                name={
                  onboardingStep === 0
                    ? "search-outline"
                    : onboardingStep === 1
                      ? "warning-outline"
                      : "shield-checkmark-outline"
                }
                size={52}
                color={activePalette.blue}
              />
            </View>

            <Text style={s.onboardingTitle}>
              {
                [
                  "Check before you act",
                  "Spot the pressure",
                  "Stay in control",
                ][onboardingStep]
              }
            </Text>

            <Text style={s.onboardingBody}>
              {
                [
                  "Paste or share a suspicious message and get clear warning signs before you respond.",
                  "Urgency, unexpected payment requests, and suspicious links deserve a pause.",
                  "Your safety comes first. Never share passwords, PINs, or one-time codes.",
                ][onboardingStep]
              }
            </Text>
          </View>

          <View style={s.onboardingBottom}>
            <View style={s.onboardingDots}>
              {[0, 1, 2].map((step) => (
                <View
                  key={step}
                  style={[
                    s.onboardingDot,
                    step === onboardingStep && s.onboardingDotActive,
                  ]}
                />
              ))}
            </View>

            <Pressable
              style={s.onboardingButton}
              onPress={() => {
                if (onboardingStep < 2) {
                  setOnboardingStep(onboardingStep + 1);
                  return;
                }

                void SecureStore.setItemAsync(
                  "safecheck.onboarding.complete",
                  "true",
                );

                setOnboarding(false);
                setTab("Protect");
                openScanner();
              }}
            >
              <Text style={s.onboardingButtonText}>
                {onboardingStep < 2 ? "Continue" : "Check a message"}
              </Text>

              <Ionicons
                name="arrow-forward"
                size={20}
                color={activePalette.bg}
              />
            </Pressable>
          </View>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

function PasswordField({
  value,
  onChangeText,
  placeholder,
  visible,
  onToggle,
  styles,
  colors,
}: {
  value: string;
  onChangeText: (value: string) => void;
  placeholder: string;
  visible: boolean;
  onToggle: () => void;
  styles: ReturnType<typeof makeStyles>;
  colors: Palette;
}) {
  return (
    <View style={styles.passwordField}>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.muted}
        style={styles.passwordInput}
        secureTextEntry={!visible}
        accessibilityLabel={placeholder}
        autoCapitalize="none"
      />

      <Pressable
        style={styles.passwordVisibility}
        onPress={onToggle}
        accessibilityRole="button"
        accessibilityLabel={
          visible ? `Hide ${placeholder}` : `Show ${placeholder}`
        }
      >
        <Ionicons
          name={visible ? "eye-off-outline" : "eye-outline"}
          size={19}
          color={colors.blue}
        />
      </Pressable>
    </View>
  );
}

const Stat = ({
  value,
  label,
  styles,
}: {
  value: string;
  label: string;
  styles: ReturnType<typeof makeStyles>;
}) => (
  <View style={styles.stat}>
    <Text style={styles.statValue}>{value}</Text>
    <Text style={styles.muted}>{label}</Text>
  </View>
);

const makeNotificationStyles = (colors: Palette) =>
  StyleSheet.create({
    banner: {
      marginHorizontal: 20,
      marginBottom: 4,
      backgroundColor: palette.surface2,
      borderColor: palette.line,
      borderWidth: 1,
      borderRadius: 14,
      padding: 13,
      flexDirection: "row",
      gap: 12,
      alignItems: "center",
    },

    title: {
      color: colors.text,
      fontWeight: "800",
      fontSize: 13,
    },

    body: {
      color: palette.text,
      fontSize: 12,
      lineHeight: 17,
      marginTop: 2,
    },
  });

const makeStyles = (palette: Palette) =>
  StyleSheet.create({
    root: {
      flex: 1,
      backgroundColor: palette.bg,
    },

    boot: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      gap: 12,
    },

    bootText: {
      color: palette.muted,
      fontSize: 14,
      fontWeight: "700",
    },

    onboarding: {
      flex: 1,
      backgroundColor: palette.bg,
      paddingHorizontal: 24,
    },

    onboardingTop: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      paddingTop: 12,
    },

    onboardingSkip: {
      color: palette.muted,
      fontSize: 15,
      fontWeight: "700",
      padding: 8,
    },

    onboardingMain: {
      flex: 1,
      justifyContent: "center",
      alignItems: "center",
      paddingBottom: 36,
    },

    onboardingIcon: {
      height: 126,
      width: 126,
      borderRadius: 63,
      backgroundColor: palette.surface2,
      borderWidth: 1,
      borderColor: "#285A79",
      justifyContent: "center",
      alignItems: "center",
      marginBottom: 34,
    },

    onboardingTitle: {
      color: palette.text,
      fontSize: 30,
      fontWeight: "800",
      textAlign: "center",
      letterSpacing: -0.6,
    },

    onboardingBody: {
      color: palette.muted,
      fontSize: 16,
      lineHeight: 24,
      textAlign: "center",
      marginTop: 14,
      maxWidth: 310,
    },

    onboardingBottom: {
      paddingBottom: 20,
      gap: 24,
    },

    onboardingDots: {
      flexDirection: "row",
      justifyContent: "center",
      gap: 7,
    },

    onboardingDot: {
      width: 7,
      height: 7,
      borderRadius: 4,
      backgroundColor: palette.line,
    },

    onboardingDotActive: {
      width: 24,
      backgroundColor: palette.blue,
    },

    onboardingButton: {
      backgroundColor: palette.blue,
      minHeight: 56,
      borderRadius: 16,
      paddingHorizontal: 20,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 10,
    },

    onboardingButtonText: {
      color: palette.bg,
      fontSize: 16,
      fontWeight: "800",
    },

    top: {
      paddingHorizontal: 20,
      paddingTop: 8,
      paddingBottom: 14,
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
    },

    wordmark: {
      color: palette.text,
      fontSize: 23,
      fontWeight: "800",
      letterSpacing: -0.5,
    },

    tagline: {
      color: palette.muted,
      fontSize: 12,
      marginTop: 3,
    },

    avatar: {
      height: 44,
      width: 44,
      borderRadius: 22,
      backgroundColor: palette.surface2,
      alignItems: "center",
      justifyContent: "center",
    },

    content: {
      paddingHorizontal: 20,
      paddingTop: 4,
      paddingBottom: 110,
    },

    flex: {
      flex: 1,
    },

    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
    },

    statusRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
    },

    scoreCard: {
      backgroundColor: palette.surface2,
      borderRadius: 20,
      padding: 20,
      borderWidth: 1,
      borderColor: palette.line,
    },

    eyebrow: {
      color: palette.blue,
      fontSize: 10,
      fontWeight: "800",
      letterSpacing: 1.1,
    },

    scoreRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 14,
      marginTop: 8,
    },

    score: {
      fontSize: 50,
      color: palette.text,
      fontWeight: "800",
      letterSpacing: -2,
    },

    scoreMuted: {
      fontSize: 50,
      color: palette.muted,
      fontWeight: "800",
      letterSpacing: -2,
    },

    scoreState: {
      color: palette.text,
      fontSize: 16,
      fontWeight: "700",
    },

    subtle: {
      color: palette.muted,
      fontSize: 12,
      marginTop: 3,
      lineHeight: 17,
    },

    track: {
      height: 7,
      backgroundColor: palette.surface2,
      borderRadius: 10,
      marginTop: 16,
      overflow: "hidden",
    },

    fill: {
      height: "100%",
      backgroundColor: palette.blue,
      borderRadius: 10,
    },

    scoreHint: {
      color: palette.muted,
      fontSize: 12,
      marginTop: 11,
    },

    sectionHeader: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
    },

    section: {
      color: palette.text,
      fontSize: 17,
      fontWeight: "800",
      marginTop: 24,
      marginBottom: 10,
    },

    seeAll: {
      color: palette.blue,
      fontSize: 12,
      fontWeight: "800",
    },

    card: {
      backgroundColor: palette.surface,
      borderRadius: 16,
      padding: 16,
      borderWidth: 1,
      borderColor: palette.line,
    },

    statusCard: {
      backgroundColor: palette.surface2,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: palette.line,
      padding: 16,
      marginBottom: 8,
    },

    challengeCard: {
      backgroundColor: palette.surface,
      borderRadius: 17,
      padding: 16,
      borderWidth: 1,
      borderColor: palette.line,
      marginBottom: 2,
    },

    iconBox: {
      backgroundColor: palette.surface2,
      height: 42,
      width: 42,
      borderRadius: 12,
      alignItems: "center",
      justifyContent: "center",
    },

    cardTitle: {
      color: palette.text,
      fontWeight: "700",
      fontSize: 15,
    },

    cardBody: {
      color: palette.muted,
      fontSize: 13,
      lineHeight: 19,
      marginTop: 4,
    },

    meta: {
      flexDirection: "row",
      justifyContent: "space-between",
      marginTop: 15,
    },

    metaItem: {
      flexDirection: "row",
      gap: 5,
      alignItems: "center",
    },

    muted: {
      color: palette.muted,
      fontSize: 12,
    },

    xp: {
      color: palette.green,
      fontWeight: "700",
      fontSize: 12,
    },

    primary: {
      backgroundColor: palette.blue,
      borderRadius: 12,
      alignItems: "center",
      paddingVertical: 14,
      marginTop: 16,
      minHeight: 48,
      justifyContent: "center",
    },

    disabled: {
      backgroundColor: palette.surface2,
    },

    disabledBorder: {
      opacity: 0.55,
    },

    primaryText: {
      color: palette.bg,
      fontWeight: "800",
      fontSize: 14,
    },

    primaryAction: {
      backgroundColor: palette.surface2,
      borderColor: "#28536B",
      borderWidth: 1,
      borderRadius: 17,
      padding: 16,
      flexDirection: "row",
      alignItems: "center",
      gap: 13,
      marginBottom: 10,
    },

    primaryActionIcon: {
      width: 46,
      height: 46,
      borderRadius: 14,
      backgroundColor: palette.surface2,
      alignItems: "center",
      justifyContent: "center",
    },

    primaryActionTitle: {
      color: palette.text,
      fontWeight: "800",
      fontSize: 15,
    },

    primaryActionBody: {
      color: palette.muted,
      fontSize: 13,
      marginTop: 3,
      lineHeight: 18,
    },

    action: {
      backgroundColor: palette.surface,
      borderRadius: 16,
      padding: 15,
      flexDirection: "row",
      alignItems: "center",
      gap: 13,
      borderWidth: 1,
      borderColor: palette.line,
      marginBottom: 10,
    },

    note: {
      marginTop: 2,
      marginBottom: 18,
      backgroundColor: palette.surface2,
      padding: 14,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: palette.line,
    },

    noteHeader: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
    },

    noteIcon: {
      width: 32,
      height: 32,
      borderRadius: 10,
      backgroundColor: "#2B271D",
      alignItems: "center",
      justifyContent: "center",
    },

    noteLabel: {
      color: palette.muted,
      fontSize: 9,
      fontWeight: "800",
      letterSpacing: 1,
      marginBottom: 2,
    },

    noteTitle: {
      color: palette.text,
      fontWeight: "700",
      fontSize: 13,
    },

    privacyCard: {
      marginTop: 10,
      backgroundColor: "#13271F",
      borderWidth: 1,
      borderColor: "#26513F",
      borderRadius: 14,
      padding: 14,
      flexDirection: "row",
      gap: 11,
    },

    privacyIcon: {
      width: 32,
      height: 32,
      borderRadius: 10,
      backgroundColor: "#183B2E",
      alignItems: "center",
      justifyContent: "center",
    },

    authHintCard: {
      backgroundColor: palette.surface2,
      borderWidth: 1,
      borderColor: palette.line,
      borderRadius: 14,
      padding: 15,
      marginTop: 12,
    },

    authHintTitle: {
      color: palette.text,
      fontSize: 14,
      fontWeight: "800",
    },

    activity: {
      backgroundColor: palette.surface,
      borderRadius: 14,
      padding: 14,
      flexDirection: "row",
      gap: 12,
      alignItems: "center",
    },

    activityIconBox: {
      width: 38,
      height: 38,
      borderRadius: 12,
      alignItems: "center",
      justifyContent: "center",
    },

    activityDanger: {
      backgroundColor: "#5A2E34",
    },

    activityWarning: {
      backgroundColor: "#4C3C22",
    },

    activitySafe: {
      backgroundColor: "#1D4A3B",
    },

    activityTitle: {
      color: palette.text,
      fontSize: 13,
      fontWeight: "600",
    },

    pageTitle: {
      color: palette.text,
      fontSize: 28,
      fontWeight: "800",
      letterSpacing: -0.8,
    },

    pageIntro: {
      color: palette.muted,
      fontSize: 14,
      lineHeight: 20,
      marginTop: 7,
      marginBottom: 18,
    },

    learningHero: {
      backgroundColor: palette.surface2,
      borderWidth: 1,
      borderColor: "#28536B",
      borderRadius: 16,
      padding: 15,
      flexDirection: "row",
      gap: 12,
    },

    learningHeroIcon: {
      width: 42,
      height: 42,
      borderRadius: 12,
      backgroundColor: palette.surface2,
      alignItems: "center",
      justifyContent: "center",
    },

    listItem: {
      minHeight: 62,
      backgroundColor: palette.surface,
      borderRadius: 13,
      paddingHorizontal: 13,
      paddingVertical: 11,
      marginBottom: 8,
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
    },

    listLeadingIcon: {
      width: 34,
      height: 34,
      borderRadius: 10,
      backgroundColor: palette.surface2,
      alignItems: "center",
      justifyContent: "center",
    },

    practiceText: {
      color: palette.blue,
      fontSize: 11,
      fontWeight: "800",
    },

    lockedCard: {
      backgroundColor: "#1C261F",
      borderWidth: 1,
      borderColor: "#4A4B2B",
      borderRadius: 13,
      paddingHorizontal: 13,
      paddingVertical: 12,
      marginTop: 2,
      marginBottom: 12,
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
    },

    liveSessionCard: {
      marginTop: 4,
      backgroundColor: palette.surface2,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: palette.line,
      padding: 14,
      flexDirection: "row",
      alignItems: "center",
      gap: 11,
    },

    liveIcon: {
      width: 40,
      height: 40,
      borderRadius: 11,
      backgroundColor: palette.surface2,
      alignItems: "center",
      justifyContent: "center",
    },

    emptyCard: {
      backgroundColor: palette.surface,
      borderWidth: 1,
      borderColor: palette.line,
      borderRadius: 16,
      padding: 18,
      alignItems: "center",
    },

    emptyTitle: {
      color: palette.text,
      fontSize: 16,
      fontWeight: "800",
      marginTop: 10,
      textAlign: "center",
    },

    emptyBody: {
      color: palette.muted,
      fontSize: 13,
      lineHeight: 19,
      textAlign: "center",
      marginTop: 5,
      maxWidth: 290,
    },

    profileHero: {
      backgroundColor: palette.surface,
      borderRadius: 16,
      padding: 16,
      flexDirection: "row",
      gap: 14,
      alignItems: "center",
      marginTop: 16,
    },

    largeAvatar: {
      height: 54,
      width: 54,
      borderRadius: 27,
      backgroundColor: palette.surface2,
      alignItems: "center",
      justifyContent: "center",
    },

    stats: {
      flexDirection: "row",
      marginTop: 10,
      gap: 8,
    },

    stat: {
      flex: 1,
      backgroundColor: palette.surface2,
      borderRadius: 13,
      padding: 12,
    },

    statValue: {
      color: palette.text,
      fontSize: 18,
      fontWeight: "800",
    },

    settingsIcon: {
      width: 34,
      height: 34,
      borderRadius: 10,
      backgroundColor: palette.surface2,
      alignItems: "center",
      justifyContent: "center",
    },

    preferenceCard: {
      minHeight: 62,
      backgroundColor: palette.surface,
      borderRadius: 13,
      paddingHorizontal: 13,
      marginBottom: 8,
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
    },

    connectProfileCard: {
      marginTop: 16,
      backgroundColor: palette.surface2,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: palette.line,
      padding: 20,
      alignItems: "center",
    },

    nav: {
      position: "absolute",
      bottom: 0,
      left: 0,
      right: 0,
      height: 78,
      backgroundColor: palette.bg,
      borderTopColor: palette.line,
      borderTopWidth: 1,
      flexDirection: "row",
      paddingTop: 8,
      paddingBottom: 5,
    },

    navItem: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      gap: 4,
      borderRadius: 12,
      marginHorizontal: 3,
    },

    navItemActive: {
      backgroundColor: palette.surface2,
    },

    navLabel: {
      color: "#AABAC7",
      fontSize: 10,
      fontWeight: "700",
    },

    navActive: {
      color: palette.blue,
    },

    input: {
      color: palette.text,
      minHeight: 140,
      maxHeight: 240,
      borderWidth: 1,
      borderColor: palette.line,
      borderRadius: 12,
      padding: 13,
      textAlignVertical: "top",
      marginTop: 18,
      fontSize: 14,
      backgroundColor: palette.surface,
    },

    inputMeta: {
      flexDirection: "row",
      justifyContent: "space-between",
      gap: 10,
      marginTop: 7,
    },

    linkInputStatus: {
      borderWidth: 1,
      borderRadius: 10,
      paddingHorizontal: 11,
      paddingVertical: 9,
      marginTop: 8,
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
    },

    linkInputStatusValid: {
      backgroundColor: "#132C23",
      borderColor: "#286047",
    },

    linkInputStatusInvalid: {
      backgroundColor: "#332A1B",
      borderColor: "#705A2D",
    },

    linkInputStatusText: {
      flex: 1,
      color: palette.text,
      fontSize: 12,
      lineHeight: 17,
    },

    scannerIntro: {
      flexDirection: "row",
      gap: 10,
      alignItems: "flex-start",
    },

    authInput: {
      color: palette.text,
      height: 48,
      borderWidth: 1,
      borderColor: palette.line,
      borderRadius: 12,
      paddingHorizontal: 13,
      marginTop: 12,
      fontSize: 14,
      backgroundColor: palette.surface,
    },

    passwordField: {
      position: "relative",
      marginTop: 12,
    },

    passwordInput: {
      color: palette.text,
      height: 48,
      borderWidth: 1,
      borderColor: palette.line,
      borderRadius: 12,
      paddingLeft: 13,
      paddingRight: 48,
      fontSize: 14,
      backgroundColor: palette.surface,
    },

    passwordVisibility: {
      position: "absolute",
      right: 4,
      top: 4,
      minWidth: 42,
      height: 40,
      alignItems: "center",
      justifyContent: "center",
    },

    passwordHint: {
      color: palette.muted,
      fontSize: 11,
      marginTop: 6,
    },

    fieldHint: {
      color: palette.muted,
      fontSize: 11,
      marginTop: 6,
    },

    verificationEmail: {
      marginTop: 16,
      backgroundColor: palette.surface2,
      borderColor: palette.line,
      borderWidth: 1,
      borderRadius: 12,
      paddingHorizontal: 13,
      paddingVertical: 12,
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
    },

    verificationLabel: {
      color: palette.muted,
      fontSize: 11,
    },

    verificationAddress: {
      color: palette.text,
      fontSize: 14,
      fontWeight: "700",
      marginTop: 3,
    },

    authErrorCard: {
      marginTop: 10,
      backgroundColor: "#3A2427",
      borderWidth: 1,
      borderColor: "#63353A",
      borderRadius: 12,
      padding: 12,
      flexDirection: "row",
      gap: 8,
      alignItems: "flex-start",
    },

    formError: {
      flex: 1,
      color: palette.red,
      fontSize: 13,
      lineHeight: 18,
    },

    link: {
      color: palette.blue,
      fontSize: 13,
      fontWeight: "700",
      marginTop: 12,
    },

    linkNoMargin: {
      color: palette.blue,
      fontSize: 13,
      fontWeight: "700",
    },

    linkDisabled: {
      opacity: 0.45,
    },

    risk: {
      borderRadius: 14,
      padding: 15,
      marginTop: 18,
    },

    riskHigh: {
      backgroundColor: "#402225",
    },

    riskMedium: {
      backgroundColor: "#3D301B",
    },

    riskLow: {
      backgroundColor: "#18352D",
    },

    riskTopRow: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
    },

    riskScore: {
      color: palette.text,
      fontSize: 12,
      fontWeight: "800",
    },

    riskTitle: {
      color: palette.text,
      fontWeight: "800",
      fontSize: 21,
      marginTop: 5,
    },

    resultDisclaimer: {
      backgroundColor: palette.surface2,
      borderWidth: 1,
      borderColor: palette.line,
      borderRadius: 12,
      padding: 12,
      marginTop: 12,
      flexDirection: "row",
      gap: 8,
      alignItems: "flex-start",
    },

    resultDisclaimerText: {
      flex: 1,
      color: palette.text,
      fontSize: 12,
      lineHeight: 18,
    },

    sourcePreview: {
      backgroundColor: palette.surface,
      borderRadius: 12,
      padding: 12,
      marginTop: 14,
      borderWidth: 1,
      borderColor: palette.line,
    },

    sourceLabel: {
      color: palette.muted,
      fontSize: 9,
      fontWeight: "800",
      letterSpacing: 1,
    },

    sourceText: {
      color: palette.text,
      fontSize: 12,
      lineHeight: 18,
      marginTop: 6,
    },

    reportHeader: {
      color: palette.text,
      fontWeight: "700",
      marginTop: 20,
      marginBottom: 8,
    },

    flagRow: {
      flexDirection: "row",
      gap: 8,
      alignItems: "flex-start",
      marginBottom: 8,
    },

    flag: {
      flex: 1,
      color: palette.text,
      fontSize: 13,
      lineHeight: 20,
    },

    actionBox: {
      backgroundColor: palette.surface2,
      borderRadius: 12,
      padding: 13,
      marginTop: 12,
    },

    actionLabel: {
      color: palette.blue,
      fontSize: 10,
      fontWeight: "800",
      letterSpacing: 1,
    },

    riskMini: {
      width: 38,
      height: 38,
      borderRadius: 12,
      alignItems: "center",
      justifyContent: "center",
    },

    accountEmailCard: {
      marginTop: 2,
      backgroundColor: palette.surface2,
      borderWidth: 1,
      borderColor: palette.line,
      borderRadius: 13,
      padding: 12,
      flexDirection: "row",
      gap: 10,
      alignItems: "center",
    },

    dangerItem: {
      minHeight: 52,
      borderWidth: 1,
      borderColor: "#6A3840",
      borderRadius: 12,
      paddingHorizontal: 14,
      justifyContent: "center",
      marginTop: 8,
      flexDirection: "row",
      alignItems: "center",
      gap: 9,
    },

    dangerText: {
      color: palette.red,
      fontSize: 14,
      fontWeight: "700",
    },

    dangerButton: {
      backgroundColor: "#B6444B",
      borderRadius: 12,
      alignItems: "center",
      paddingVertical: 14,
      marginTop: 16,
      minHeight: 48,
      justifyContent: "center",
    },

    dangerButtonText: {
      color: palette.white,
      fontWeight: "800",
      fontSize: 14,
    },

    deleteWarning: {
      marginTop: 2,
      backgroundColor: "#351F22",
      borderWidth: 1,
      borderColor: "#61363B",
      borderRadius: 13,
      padding: 13,
      flexDirection: "row",
      gap: 9,
      alignItems: "flex-start",
    },

    premiumHintCard: {
      backgroundColor: palette.surface2,
      borderWidth: 1,
      borderColor: palette.line,
      borderRadius: 12,
      padding: 12,
      marginBottom: 12,
      flexDirection: "row",
      gap: 8,
      alignItems: "center",
    },

    premiumHint: {
      flex: 1,
      color: palette.blue,
      fontSize: 13,
      fontWeight: "700",
    },

    premiumCard: {
      backgroundColor: palette.surface2,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: palette.line,
      padding: 14,
      marginBottom: 14,
    },

    premiumFeatureTitle: {
      color: palette.text,
      fontSize: 15,
      fontWeight: "800",
      marginBottom: 11,
    },

    premiumFeatureRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      marginBottom: 9,
    },

    premiumFeatureText: {
      color: palette.text,
      fontSize: 13,
      fontWeight: "600",
    },

    planCard: {
      backgroundColor: palette.surface,
      borderColor: palette.line,
      borderWidth: 1,
      borderRadius: 16,
      padding: 16,
      marginBottom: 16,
      alignItems: "center",
    },

    planBadge: {
      color: palette.blue,
      fontSize: 10,
      fontWeight: "800",
      letterSpacing: 1.2,
    },

    planPrice: {
      color: palette.text,
      fontSize: 24,
      fontWeight: "800",
      marginTop: 6,
    },
    secondary: {
      borderWidth: 1,
      borderColor: palette.line,
      borderRadius: 11,
      alignItems: "center",
      justifyContent: "center",
      paddingVertical: 12,
      paddingHorizontal: 14,
      marginTop: 15,
      minHeight: 46,
    },

    secondaryText: {
      color: palette.blue,
      fontWeight: "700",
      fontSize: 13,
    },

    planMeta: {
      color: palette.muted,
      fontSize: 12,
      marginTop: 4,
    },
  });
