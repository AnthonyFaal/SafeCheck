import { Platform } from "react-native";
import * as Notifications from "expo-notifications";
import * as Device from "expo-device";
import Constants from "expo-constants";

const DAILY_REMINDER_ID = "safecheck-daily-challenge";

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

export async function enableDailyReminder(hour = 9): Promise<boolean> {
  if (Platform.OS === "web") return false;
  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("daily-safety", {
      name: "Daily safety reminders",
      importance: Notifications.AndroidImportance.DEFAULT,
      sound: "notification.wav",
    });
  }
  const existing = await Notifications.getPermissionsAsync();
  const permission = existing.granted
    ? existing
    : await Notifications.requestPermissionsAsync();
  if (!permission.granted) return false;
  await Notifications.cancelScheduledNotificationAsync(DAILY_REMINDER_ID).catch(
    () => undefined,
  );
  await Notifications.scheduleNotificationAsync({
    identifier: DAILY_REMINDER_ID,
    content: {
      title: "Your safety check is ready",
      body: "Take today’s 45-second challenge and keep your streak going.",
      sound: "notification.wav",
      data: { destination: "Home" },
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DAILY,
      hour: Math.max(0, Math.min(23, hour)),
      minute: 0,
      channelId: "daily-safety",
    },
  });
  return true;
}

export async function disableDailyReminder() {
  if (Platform.OS !== "web")
    await Notifications.cancelScheduledNotificationAsync(
      DAILY_REMINDER_ID,
    ).catch(() => undefined);
}

export async function getPushToken(): Promise<{
  token: string;
  platform: "ios" | "android";
} | null> {
  if (Platform.OS === "web" || !Device.isDevice) return null;
  // Expo removed Android remote-push support from Expo Go in SDK 53. Local
  // reminders still work there; remote tokens require our development build.
  if (Constants.appOwnership === "expo") return null;
  const permission = await Notifications.getPermissionsAsync();
  if (!permission.granted) return null;
  const projectId = Constants.expoConfig?.extra?.eas?.projectId;
  if (!projectId) return null;
  const token = await Notifications.getExpoPushTokenAsync({ projectId });
  return {
    token: token.data,
    platform: Platform.OS === "ios" ? "ios" : "android",
  };
}

export function onForegroundNotification(
  listener: (title: string, body: string) => void,
) {
  return Notifications.addNotificationReceivedListener((notification) =>
    listener(
      notification.request.content.title ?? "SafeCheck",
      notification.request.content.body ?? "",
    ),
  );
}

export function onNotificationResponse(
  listener: (destination: string) => void,
) {
  return Notifications.addNotificationResponseReceivedListener((response) => {
    const destination = response.notification.request.content.data?.destination;

    if (typeof destination === "string") listener(destination);
  });
}
