import { createContext, useContext, useEffect, useRef, useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import DateTimePicker, {
  DateTimePickerEvent,
} from "@react-native-community/datetimepicker";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import * as SecureStore from "expo-secure-store";
import groupQuiz from "../../content/scenarios/group_quiz.json";
import {
  advanceLiveSession,
  answerLiveSession,
  cancelLiveSession,
  createLiveSession,
  endLiveSession,
  getLiveSession,
  getMyLiveSessionEvents,
  joinLiveSession,
  rescheduleLiveSession,
  startLiveSession,
  type LiveSession,
  type LiveSessionEvent,
} from "../../services/api";
import { AppDialog, type DialogButton } from "./AppDialog";

type Mode = "home" | "host" | "join" | "room";
type QuestionSource = "generated" | "custom" | "mixed";
type CustomQuestion = {
  prompt: string;
  choices: string[];
  correctAnswer: string;
  explanation?: string;
};
type Draft = {
  prompt: string;
  choices: string[];
  correct: number | null;
  explanation: string;
};
type QuizItem = {
  prompt: string;
  options: { value: string; label: string }[];
  correctAnswer: string;
  explanation: string;
};
type Props = {
  visible: boolean;
  onClose: () => void;
  signedIn: boolean;
  appearance?: "light" | "dark";
};
type SessionHubProps = {
  signedIn: boolean;
  activeSession: LiveSession | null;
  sessions: LiveSessionEvent[];
  loading: boolean;
  onCreate: () => void;
  onJoin: () => void;
  onContinue: () => void;
};
type HostSetupProps = {
  onCreate: () => void;
  onBack: () => void;
  busy: boolean;
  questions: CustomQuestion[];
  setQuestions: (questions: CustomQuestion[]) => void;
  roundCount: 5 | 10;
  setRoundCount: (roundCount: 5 | 10) => void;
  schedule: boolean;
  setSchedule: (schedule: boolean) => void;
  date: Date;
  setDate: (date: Date) => void;
  picker: "date" | "time" | null;
  setPicker: (picker: "date" | "time" | null) => void;
  title: string;
  setTitle: (title: string) => void;
  description: string;
  setDescription: (description: string) => void;
  questionSource: QuestionSource;
  setQuestionSource: (source: QuestionSource) => void;
};
type JoinGameProps = {
  name: string;
  setName: (name: string) => void;
  code: string;
  setCode: (code: string) => void;
  busy: boolean;
  onJoin: () => void;
  onBack: () => void;
};
type LobbyProps = {
  session: LiveSession;
  busy: boolean;
  onStart: () => void;
  onShare: () => void;
};
type LiveQuestionProps = {
  session: LiveSession;
  seconds: number;
  busy: boolean;
  onAnswer: (answer: string) => void;
  onNext: () => void;
};
type ScheduledRoomProps = {
  session: LiveSession;
  busy: boolean;
  onCancel: () => void;
  onShare: () => void;
  onReschedule: (date: Date) => void;
};
const AppearanceContext = createContext(false);
const QUIZ = groupQuiz as QuizItem[];
const KEY = "safecheck.live-session";
const shuffle = <T,>(items: T[]) => [...items].sort(() => Math.random() - 0.5);
const newDraft = (): Draft => ({
  prompt: "",
  choices: ["", ""],
  correct: null,
  explanation: "",
});

function Button({
  label,
  onPress,
  disabled = false,
  secondary = false,
  destructive = false,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  secondary?: boolean;
  destructive?: boolean;
}) {
  const light = useContext(AppearanceContext);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        s.button,
        light && s.lightButton,
        secondary && s.secondary,
        destructive && s.destructive,
        disabled && s.disabled,
        pressed && s.pressed,
      ]}
    >
      <Text
        style={[
          s.buttonText,
          light && s.lightButtonText,
          secondary && s.secondaryText,
          secondary && light && s.lightSecondaryText,
          destructive && s.destructiveText,
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

const sessionStatusLabel: Record<LiveSessionEvent["status"], string> = {
  SCHEDULED: "Scheduled",
  LOBBY: "Waiting for players",
  LIVE: "Live now",
  FINISHED: "Completed",
  CANCELED: "Canceled",
};

function SessionRow({ event }: { event: LiveSessionEvent }) {
  const date = event.scheduledFor ?? event.createdAt;
  const dateLabel = new Date(date).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  return (
    <View style={s.sessionRow}>
      <View style={s.sessionRowIcon}>
        <Ionicons
          name={event.status === "FINISHED" ? "checkmark" : "people-outline"}
          size={18}
          color="#62C8FF"
        />
      </View>
      <View style={s.flex}>
        <Text style={s.sessionTitle} numberOfLines={1}>
          {event.title}
        </Text>
        <Text style={s.muted}>
          {sessionStatusLabel[event.status]} · {dateLabel}
        </Text>
      </View>
      <Text style={s.sessionScore}>
        {event.status === "FINISHED"
          ? `${event.score} pts`
          : `${event.playerCount} joined`}
      </Text>
    </View>
  );
}

function SessionHub({
  signedIn,
  activeSession,
  sessions,
  loading,
  onCreate,
  onJoin,
  onContinue,
}: SessionHubProps) {
  const upcoming = sessions.filter((event) =>
    ["SCHEDULED", "LOBBY", "LIVE"].includes(event.status),
  );
  const completed = sessions.filter((event) =>
    ["FINISHED", "CANCELED"].includes(event.status),
  );

  return (
    <View style={s.stack}>
      <View style={s.hubIntro}>
        <Text style={s.eyebrow}>PLAY TOGETHER</Text>
        <Text style={s.heroTitle}>Live safety sessions</Text>
        <Text style={s.copy}>
          Start a new game, join someone else's room, or revisit a session.
        </Text>
      </View>

      <View style={s.actionRow}>
        {signedIn && <Button label="Create session" onPress={onCreate} />}
        <Button label="Join with code" secondary onPress={onJoin} />
      </View>

      {activeSession && (
        <View style={s.card}>
          <Text style={s.label}>Current session</Text>
          <Text style={s.sectionTitle}>{activeSession.title}</Text>
          <Text style={s.copy}>
            {activeSession.status === "SCHEDULED"
              ? "Scheduled and ready to manage."
              : activeSession.status === "FINISHED"
                ? "Completed session and final results."
                : "Your saved room is still available."}
          </Text>
          <Button label="Open current session" onPress={onContinue} />
        </View>
      )}

      {!signedIn ? (
        <View style={s.notice}>
          <Text style={s.noticeText}>
            Sign in to see your previous sessions. You can still join with a
            room code.
          </Text>
        </View>
      ) : loading ? (
        <Text style={s.muted}>Loading your sessions...</Text>
      ) : (
        <>
          <SessionSection
            title="Upcoming and live"
            events={upcoming}
            empty="No upcoming sessions."
          />
          <SessionSection
            title="Previous sessions"
            events={completed}
            empty="Completed sessions will appear here."
          />
        </>
      )}
    </View>
  );
}

function SessionSection({
  title,
  events,
  empty,
}: {
  title: string;
  events: LiveSessionEvent[];
  empty: string;
}) {
  return (
    <View style={s.sessionSection}>
      <Text style={s.sectionTitle}>{title}</Text>
      {events.length > 0 ? (
        events.map((event) => <SessionRow key={event.id} event={event} />)
      ) : (
        <Text style={s.muted}>{empty}</Text>
      )}
    </View>
  );
}
function Field({
  label,
  value,
  onChangeText,
  placeholder,
  multiline = false,
  maxLength,
  onSubmitEditing,
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  placeholder: string;
  multiline?: boolean;
  maxLength?: number;
  onSubmitEditing?: () => void;
}) {
  const light = useContext(AppearanceContext);
  return (
    <View style={s.field}>
      <Text style={[s.label, light && s.lightText]}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor="#8293A4"
        multiline={multiline}
        maxLength={maxLength}
        onSubmitEditing={onSubmitEditing}
        style={[s.input, light && s.lightInput, multiline && s.multiline]}
      />
    </View>
  );
}
function CustomQuestionBuilder({
  questions,
  onChange,
}: {
  questions: CustomQuestion[];
  onChange: (value: CustomQuestion[]) => void;
}) {
  const light = useContext(AppearanceContext);
  const [draft, setDraft] = useState<Draft>(newDraft);
  const [editing, setEditing] = useState<number | null>(null);
  const [error, setError] = useState("");
  const save = () => {
    const choices = draft.choices.map((choice) => choice.trim());
    const lower = choices.map((choice) => choice.toLowerCase());
    if (!draft.prompt.trim()) return setError("Add the question text.");
    if (choices.some((choice) => !choice))
      return setError("Complete every answer field.");
    if (choices.length < 2 || choices.length > 4)
      return setError("Use 2 to 4 answers.");
    if (new Set(lower).size !== choices.length)
      return setError("Each answer must be unique.");
    if (draft.correct === null || draft.correct >= choices.length)
      return setError("Select exactly one correct answer.");
    const item = {
      prompt: draft.prompt.trim(),
      choices,
      correctAnswer: choices[draft.correct],
      explanation: draft.explanation.trim() || undefined,
    };
    onChange(
      editing === null
        ? [...questions, item]
        : questions.map((old, index) => (index === editing ? item : old)),
    );
    setDraft(newDraft());
    setEditing(null);
    setError("");
  };
  return (
    <View style={[s.card, light && s.lightCard]}>
      <Text style={[s.sectionTitle, light && s.lightText]}>
        My questions <Text style={s.muted}>({questions.length})</Text>
      </Text>
      <Text style={[s.copy, light && s.lightText]}>
        Add questions to your chosen set. The starter pack is never silently
        replaced.
      </Text>
      <Field
        label="Question"
        value={draft.prompt}
        onChangeText={(prompt) => setDraft({ ...draft, prompt })}
        placeholder="What should a careful person do?"
        multiline
      />
      <Text style={s.label}>
        Answers <Text style={s.muted}>Tap one to mark it correct</Text>
      </Text>
      {draft.choices.map((choice, index) => (
        <View key={index} style={s.answerEditor}>
          <Pressable
            accessibilityRole="radio"
            accessibilityState={{ selected: draft.correct === index }}
            accessibilityLabel={`Mark answer ${index + 1} correct`}
            onPress={() => setDraft({ ...draft, correct: index })}
            style={[s.radio, draft.correct === index && s.radioSelected]}
          >
            <Text style={s.radioText}>
              {draft.correct === index ? "✓" : ""}
            </Text>
          </Pressable>
          <TextInput
            accessibilityLabel={`Answer ${index + 1}`}
            value={choice}
            onChangeText={(value) =>
              setDraft({
                ...draft,
                choices: draft.choices.map((old, choiceIndex) =>
                  choiceIndex === index ? value : old,
                ),
              })
            }
            placeholder={`Answer ${index + 1}`}
            placeholderTextColor="#8293A4"
            style={s.answerInput}
          />
          {draft.choices.length > 2 && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Remove answer ${index + 1}`}
              onPress={() =>
                setDraft({
                  ...draft,
                  choices: draft.choices.filter(
                    (_, choiceIndex) => choiceIndex !== index,
                  ),
                  correct:
                    draft.correct === index
                      ? null
                      : draft.correct !== null && draft.correct > index
                        ? draft.correct - 1
                        : draft.correct,
                })
              }
            >
              <Text style={s.remove}>Remove</Text>
            </Pressable>
          )}
        </View>
      ))}
      {draft.choices.length < 4 && (
        <Button
          label="+ Add answer"
          secondary
          onPress={() =>
            setDraft({ ...draft, choices: [...draft.choices, ""] })
          }
        />
      )}
      <Field
        label="Explanation (optional)"
        value={draft.explanation}
        onChangeText={(explanation) => setDraft({ ...draft, explanation })}
        placeholder="Explain the warning sign"
        multiline
      />
      {!!error && (
        <Text accessibilityRole="alert" style={s.error}>
          {error}
        </Text>
      )}
      <Button
        label={editing === null ? "Add question" : "Save changes"}
        onPress={save}
      />
      {questions.length > 0 && (
        <View style={s.questionList}>
          <Text style={s.label}>Added questions</Text>
          {questions.map((item, index) => (
            <View key={`${item.prompt}-${index}`} style={s.questionRow}>
              <Text style={s.questionNumber}>{index + 1}</Text>
              <Text style={s.questionRowText} numberOfLines={2}>
                {item.prompt}
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Edit question ${index + 1}`}
                onPress={() => {
                  setDraft({
                    prompt: item.prompt,
                    choices: item.choices,
                    correct: item.choices.indexOf(item.correctAnswer),
                    explanation: item.explanation ?? "",
                  });
                  setEditing(index);
                }}
              >
                <Text style={s.link}>Edit</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Remove question ${index + 1}`}
                onPress={() =>
                  onChange(
                    questions.filter((_, itemIndex) => itemIndex !== index),
                  )
                }
              >
                <Text style={s.remove}>Remove</Text>
              </Pressable>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}
function HostSetup({
  onCreate,
  onBack,
  busy,
  questions,
  setQuestions,
  roundCount,
  setRoundCount,
  schedule,
  setSchedule,
  date,
  setDate,
  picker,
  setPicker,
  title,
  setTitle,
  description,
  setDescription,
  questionSource,
  setQuestionSource,
}: HostSetupProps) {
  const light = useContext(AppearanceContext);
  const changed = (event: DateTimePickerEvent, value?: Date) => {
    if (Platform.OS === "android") setPicker(null);
    if (event.type !== "dismissed" && value) {
      setDate(value);
      if (Platform.OS === "ios" && picker === "date") setPicker("time");
    }
  };
  return (
    <View style={s.stack}>
      <Text style={[s.sectionTitle, light && s.lightText]}>
        Set up your game
      </Text>
      <Text style={[s.copy, light && s.lightText]}>
        Choose the pace, then invite your group. Add detail only when you need
        it.
      </Text>
      <Text style={[s.label, light && s.lightText]}>Number of rounds</Text>
      <View style={s.choiceRow}>
        {([5, 10] as const).map((count) => (
          <Pressable
            key={count}
            accessibilityRole="radio"
            accessibilityState={{ selected: roundCount === count }}
            onPress={() => setRoundCount(count)}
            style={[s.choice, roundCount === count && s.choiceSelected]}
          >
            <Text style={s.choiceNumber}>{count}</Text>
            <Text style={s.choiceText}>rounds</Text>
            <Text style={s.muted}>~{count / 2} min</Text>
          </Pressable>
        ))}
      </View>
      <View style={[s.card, light && s.lightCard]}>
        <View style={s.row}>
          <View style={s.flex}>
            <Text style={[s.label, light && s.lightText]}>Start</Text>
            <Text style={[s.copy, light && s.lightText]}>
              {schedule
                ? "Scheduled in your local time"
                : "Start when everyone is ready"}
            </Text>
          </View>
          <Pressable
            accessibilityRole="switch"
            accessibilityState={{ checked: schedule }}
            onPress={() => {
              setSchedule(!schedule);
              setPicker(null);
            }}
            style={[s.switchTrack, schedule && s.switchOn]}
          >
            <View style={[s.switchThumb, schedule && s.switchThumbOn]} />
          </Pressable>
        </View>
        {schedule && (
          <>
            <View style={s.choiceRow}>
              <Pressable style={s.dateChoice} onPress={() => setPicker("date")}>
                <Text style={s.muted}>DATE</Text>
                <Text style={s.dateText}>
                  {date.toLocaleDateString(undefined, {
                    month: "short",
                    day: "numeric",
                  })}
                </Text>
              </Pressable>
              <Pressable style={s.dateChoice} onPress={() => setPicker("time")}>
                <Text style={s.muted}>TIME</Text>
                <Text style={s.dateText}>
                  {date.toLocaleTimeString(undefined, {
                    hour: "numeric",
                    minute: "2-digit",
                  })}
                </Text>
              </Pressable>
            </View>
            <Text style={[s.muted, light && s.lightText]}>
              Timezone: {Intl.DateTimeFormat().resolvedOptions().timeZone}
            </Text>
            {picker && (
              <DateTimePicker
                value={date}
                mode={picker}
                display={Platform.OS === "ios" ? "spinner" : "default"}
                minimumDate={picker === "date" ? new Date() : undefined}
                onChange={changed}
              />
            )}
          </>
        )}
      </View>
      <View style={[s.card, light && s.lightCard]}>
        <Text style={[s.sectionTitle, light && s.lightText]}>
          Advanced options
        </Text>
        <Field
          label="Event title"
          value={title}
          onChangeText={setTitle}
          placeholder="Optional game title"
          maxLength={80}
        />
        <Field
          label="Description"
          value={description}
          onChangeText={setDescription}
          placeholder="Optional context for players"
          multiline
          maxLength={200}
        />
      </View>
      <View style={[s.card, light && s.lightCard]}>
        <Text style={[s.sectionTitle, light && s.lightText]}>
          Question source
        </Text>
        <Text style={[s.copy, light && s.lightText]}>
          Choose how this game gets its questions.
        </Text>
        {(
          [
            [
              "generated",
              "Generate from SafeCheck bank",
              "Use 100 curated scenarios.",
            ],
            ["custom", "Use my questions", "Play only questions you write."],
            ["mixed", "Mix both", "Combine your questions with the bank."],
          ] as const
        ).map(([value, label, hint]) => (
          <Pressable
            key={value}
            accessibilityRole="radio"
            accessibilityState={{ selected: questionSource === value }}
            onPress={() => setQuestionSource(value)}
            style={[
              s.sourceChoice,
              questionSource === value && s.sourceSelected,
            ]}
          >
            <View
              style={[s.radio, questionSource === value && s.radioSelected]}
            >
              <Text style={s.radioText}>
                {questionSource === value ? "✓" : ""}
              </Text>
            </View>
            <View style={s.flex}>
              <Text style={[s.sourceLabel, light && s.lightText]}>{label}</Text>
              <Text style={[s.muted, light && s.lightText]}>{hint}</Text>
            </View>
          </Pressable>
        ))}
      </View>
      {questionSource !== "generated" && (
        <CustomQuestionBuilder questions={questions} onChange={setQuestions} />
      )}
      <Text style={[s.copy, light && s.lightText]}>
        {questionSource === "generated"
          ? `SafeCheck question bank (${roundCount} questions)`
          : questionSource === "custom"
            ? `Your questions (${Math.min(questions.length, roundCount)} of ${roundCount})`
            : `Mixed set (${Math.min(questions.length, roundCount)} custom plus generated questions, ${roundCount} total)`}
      </Text>
      <Button
        label={
          busy
            ? schedule
              ? "Scheduling..."
              : "Creating..."
            : schedule
              ? "Schedule game"
              : "Create game"
        }
        onPress={onCreate}
        disabled={busy}
      />
      <Button label="Back" secondary onPress={onBack} disabled={busy} />
    </View>
  );
}
function JoinGame({
  name,
  setName,
  code,
  setCode,
  busy,
  onJoin,
  onBack,
}: JoinGameProps) {
  const light = useContext(AppearanceContext);
  const valid = name.trim().length >= 2 && code.length === 6;
  return (
    <View style={s.stack}>
      <Text style={[s.sectionTitle, light && s.lightText]}>Join a game</Text>
      <Text style={[s.copy, light && s.lightText]}>
        Use the name your group will recognise and the six-character code from
        the host.
      </Text>
      <Field
        label="Your name"
        value={name}
        onChangeText={setName}
        placeholder="e.g. Ama"
        maxLength={32}
      />
      <Field
        label="Room code"
        value={code}
        onChangeText={(value) =>
          setCode(value.replace(/[^a-z0-9]/gi, "").toUpperCase())
        }
        placeholder="ABC123"
        maxLength={6}
        onSubmitEditing={valid ? onJoin : undefined}
      />
      <Text style={[s.muted, light && s.lightText]}>
        Letters and numbers only. Paste is supported.
      </Text>
      <Button
        label={busy ? "Joining..." : "Join game"}
        onPress={onJoin}
        disabled={busy || !valid}
      />
      <Button label="Back" secondary onPress={onBack} disabled={busy} />
    </View>
  );
}
function RoomCode({ code, onShare }: { code: string; onShare: () => void }) {
  const light = useContext(AppearanceContext);
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await Clipboard.setStringAsync(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };
  return (
    <View style={s.codeBlock}>
      <Text style={s.eyebrow}>ROOM CODE</Text>
      <Text selectable style={[s.roomCode, light && s.lightText]}>
        {code}
      </Text>
      <View style={s.choiceRow}>
        <Button
          label={copied ? "Copied!" : "Copy code"}
          secondary
          onPress={() => void copy()}
        />
        <Button label="Share invite" secondary onPress={onShare} />
      </View>
    </View>
  );
}
function ScheduledRoom({
  session,
  busy,
  onCancel,
  onShare,
  onReschedule,
}: ScheduledRoomProps) {
  const [date, setDate] = useState(
    () => new Date(session.scheduledFor ?? Date.now()),
  );
  const [picker, setPicker] = useState<"date" | "time" | null>(null);
  const scheduledFor = session.scheduledFor
    ? new Date(session.scheduledFor)
    : null;

  return (
    <View style={s.stack}>
      <View style={s.card}>
        <Text style={s.eyebrow}>GAME SCHEDULED</Text>
        <Text style={s.sectionTitle}>Your room is ready</Text>
        <Text style={s.copy}>
          Share the code now. The host can start the game when the scheduled
          time arrives.
        </Text>
        {scheduledFor && (
          <Text style={s.dateText}>
            {scheduledFor.toLocaleString(undefined, {
              dateStyle: "medium",
              timeStyle: "short",
            })}
          </Text>
        )}
      </View>
      <RoomCode code={session.code} onShare={onShare} />
      {session.isHost && (
        <View style={s.card}>
          <Text style={s.sectionTitle}>Change start time</Text>
          <View style={s.choiceRow}>
            <Pressable style={s.dateChoice} onPress={() => setPicker("date")}>
              <Text style={s.muted}>DATE</Text>
              <Text style={s.dateText}>
                {date.toLocaleDateString(undefined, {
                  month: "short",
                  day: "numeric",
                })}
              </Text>
            </Pressable>
            <Pressable style={s.dateChoice} onPress={() => setPicker("time")}>
              <Text style={s.muted}>TIME</Text>
              <Text style={s.dateText}>
                {date.toLocaleTimeString(undefined, {
                  hour: "numeric",
                  minute: "2-digit",
                })}
              </Text>
            </Pressable>
          </View>
          {picker && (
            <DateTimePicker
              value={date}
              mode={picker}
              display={Platform.OS === "ios" ? "spinner" : "default"}
              minimumDate={picker === "date" ? new Date() : undefined}
              onChange={(event, value) => {
                if (Platform.OS === "android") setPicker(null);
                if (event.type !== "dismissed" && value) {
                  setDate(value);
                  if (Platform.OS === "ios" && picker === "date")
                    setPicker("time");
                }
              }}
            />
          )}
          <Button
            label="Save new time"
            onPress={() => onReschedule(date)}
            disabled={busy || date.getTime() <= Date.now()}
          />
        </View>
      )}
      {session.isHost && (
        <Button
          label="Cancel scheduled game"
          secondary
          destructive
          onPress={onCancel}
          disabled={busy}
        />
      )}
      {!session.isHost && (
        <Text style={s.copy}>The host controls this scheduled game.</Text>
      )}
    </View>
  );
}
function Lobby({ session, busy, onStart, onShare }: LobbyProps) {
  const light = useContext(AppearanceContext);
  const enough = session.playerCount >= 2;
  return (
    <View style={s.stack}>
      <RoomCode code={session.code} onShare={onShare} />
      <View style={[s.card, light && s.lightCard]}>
        <View style={s.row}>
          <View>
            <Text style={s.bigNumber}>{session.playerCount}</Text>
            <Text style={[s.muted, light && s.lightText]}>players joined</Text>
          </View>
          <Text style={[s.status, enough && s.ready]}>
            {enough ? "Ready to start" : "Waiting for players"}
          </Text>
        </View>
        {session.leaderboard.length > 0 && (
          <View style={s.playerList}>
            {session.leaderboard.map((player) => (
              <Text
                key={`${player.rank}-${player.name}`}
                style={[s.playerName, light && s.lightText]}
              >
                {player.isYou ? `${player.name} (You)` : player.name}
              </Text>
            ))}
          </View>
        )}
      </View>
      {!enough && (
        <View style={s.notice}>
          <Text style={s.noticeText}>
            You need at least 2 players to start.
          </Text>
          <Button label="Share invite" secondary onPress={onShare} />
        </View>
      )}
      {session.isHost ? (
        <Button
          label={
            busy
              ? "Starting..."
              : enough
                ? "Start game"
                : "Invite one more player"
          }
          onPress={onStart}
          disabled={busy || !enough}
        />
      ) : (
        <View accessibilityLiveRegion="polite" style={s.notice}>
          <Text style={s.noticeText}>
            You are in. The host controls when the game starts.
          </Text>
        </View>
      )}
    </View>
  );
}
function LiveQuestion({
  session,
  seconds,
  busy,
  onAnswer,
  onNext,
}: LiveQuestionProps) {
  const light = useContext(AppearanceContext);
  const onNextRef = useRef(onNext);
  const [advanceIn, setAdvanceIn] = useState(0);
  const q = session.question;
  useEffect(() => {
    onNextRef.current = onNext;
  }, [onNext]);
  useEffect(() => {
    if (!q || !session.isHost || q.phase !== "REVEAL") {
      setAdvanceIn(0);
      return;
    }

    setAdvanceIn(8);
    const interval = setInterval(() => {
      setAdvanceIn((current) => {
        if (current <= 1) {
          clearInterval(interval);
          onNextRef.current();
          return 0;
        }
        return current - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [q?.id, q?.phase, session.isHost]);
  if (!q) return null;
  const answered = Boolean(q.answer);
  const urgent = seconds <= 5 && q.phase === "ANSWERING";
  const progress = Math.max(
    0,
    Math.min(1, seconds / (session.questionSeconds || 30)),
  );
  return (
    <View style={s.stack}>
      <View style={s.row}>
        <Text style={s.round}>
          ROUND {q.position} OF {q.total}
        </Text>
        <Text
          accessibilityLiveRegion="polite"
          style={[s.timer, urgent && s.timerUrgent]}
        >
          {q.phase === "ANSWERING" ? `${seconds} seconds left` : "Time is up"}
        </Text>
      </View>
      <View
        accessible
        accessibilityLabel={`Round ${q.position} of ${q.total}, ${seconds} seconds remaining`}
        style={s.progress}
      >
        <View style={[s.progressFill, { width: `${progress * 100}%` }]} />
      </View>
      <View style={[s.questionCard, light && s.lightCard]}>
        <Text style={[s.question, light && s.lightText]}>{q.prompt}</Text>
      </View>
      <View accessibilityLiveRegion="polite" style={s.row}>
        <Text style={s.muted}>
          {q.answeredCount}/{session.playerCount} answered
        </Text>
        {answered && <Text style={s.submitted}>Answer submitted</Text>}
      </View>
      <View style={s.answers}>
        {q.choices.map((choice, index) => {
          const selected = q.answer?.answer === choice;
          const correct = q.phase === "REVEAL" && q.correctAnswer === choice;
          const wrong = q.phase === "REVEAL" && selected && !q.answer?.correct;
          return (
            <Pressable
              key={`${choice}-${index}`}
              accessibilityRole="radio"
              accessibilityState={{
                selected,
                disabled: answered || q.phase !== "ANSWERING" || busy,
              }}
              accessibilityLabel={`${String.fromCharCode(65 + index)}. ${choice}${correct ? ", correct answer" : wrong ? ", incorrect" : ""}`}
              disabled={answered || q.phase !== "ANSWERING" || busy}
              onPress={() => onAnswer(choice)}
              style={[
                s.answer,
                selected && s.answerSelected,
                correct && s.answerCorrect,
                wrong && s.answerWrong,
              ]}
            >
              <Text style={s.answerLetter}>
                {String.fromCharCode(65 + index)}
              </Text>
              <Text style={s.answerText}>{choice}</Text>
              {selected && (
                <Text style={s.answerState}>
                  {q.phase === "REVEAL"
                    ? q.answer?.correct
                      ? "Correct"
                      : "Your answer"
                    : "Selected"}
                </Text>
              )}
            </Pressable>
          );
        })}
      </View>
      {q.phase === "ANSWERING" && answered && (
        <Text style={s.copy}>
          Waiting for {Math.max(0, session.playerCount - q.answeredCount)} other
          players...
        </Text>
      )}
      {q.phase === "REVEAL" && (
        <View style={s.reveal}>
          <Text style={s.sectionTitle}>
            {q.answer?.correct
              ? `Correct! +${q.answer.points}`
              : q.answer
                ? "Not this time"
                : "Round complete"}
          </Text>
          <Text style={s.copy}>
            {q.explanation || "The correct answer is shown above."}
          </Text>
          {session.isHost ? (
            <Button
              label={
                q.position === q.total ? "Show final results" : "Next round"
              }
              onPress={onNext}
              disabled={busy}
            />
          ) : (
            <Text style={s.copy}>Next round starts automatically shortly.</Text>
          )}
          {advanceIn > 0 && (
            <Text accessibilityLiveRegion="polite" style={s.copy}>
              Next round in {advanceIn} seconds
            </Text>
          )}
        </View>
      )}
    </View>
  );
}
function Leaderboard({ session }: { session: LiveSession }) {
  const light = useContext(AppearanceContext);
  if (
    session.status !== "FINISHED" &&
    (!session.question || session.question.phase !== "REVEAL")
  )
    return null;
  const rows = session.leaderboard.slice(0, 5);
  const me = session.leaderboard.find((row) => row.isYou);
  return (
    <View style={[s.card, light && s.lightCard]}>
      <Text style={[s.sectionTitle, light && s.lightText]}>
        {session.status === "FINISHED"
          ? "Final leaderboard"
          : "Current leaderboard"}
      </Text>
      {rows.map((row) => (
        <Leader key={`${row.rank}-${row.name}`} row={row} />
      ))}
      {me && !rows.some((row) => row.isYou) && (
        <>
          <Text style={s.label}>Your result</Text>
          <Leader row={me} />
        </>
      )}
    </View>
  );
}
function Leader({ row }: { row: LiveSession["leaderboard"][number] }) {
  const light = useContext(AppearanceContext);
  return (
    <View style={[s.leaderRow, row.isYou && s.you]}>
      <Text style={s.rank}>{row.rank}.</Text>
      <Text style={[s.leaderName, light && s.lightText]}>
        {row.name}
        {row.isYou ? " - You" : ""}
      </Text>
      <Text style={s.score}>{row.score.toLocaleString()}</Text>
    </View>
  );
}

export function LiveSessionsPage({
  visible,
  onClose,
  signedIn,
  appearance = "dark",
}: Props) {
  const [mode, setMode] = useState<Mode>("home");
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [roundCount, setRoundCount] = useState<5 | 10>(5);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [schedule, setSchedule] = useState(false);
  const [date, setDate] = useState(() => {
    const value = new Date();
    value.setDate(value.getDate() + 1);
    value.setHours(18, 0, 0, 0);
    return value;
  });
  const [picker, setPicker] = useState<"date" | "time" | null>(null);
  const [questions, setQuestions] = useState<CustomQuestion[]>([]);
  const [questionSource, setQuestionSource] =
    useState<QuestionSource>("generated");
  const [session, setSession] = useState<LiveSession | null>(null);
  const [sessions, setSessions] = useState<LiveSessionEvent[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [dialog, setDialog] = useState<{
    title: string;
    message: string;
    icon?: string;
    variant?: "info" | "success" | "warning" | "danger";
    buttons?: DialogButton[];
  } | null>(null);
  const [restoring, setRestoring] = useState(false);
  const [now, setNow] = useState(Date.now());
  const refreshing = useRef(false);
  const restored = useRef(false);
  const deadline = useRef<number | null>(null);
  const previousQuestion = useRef<string | null>(null);
  const loadSessions = async () => {
    if (!signedIn) {
      setSessions([]);
      return;
    }

    setSessionsLoading(true);
    try {
      setSessions(await getMyLiveSessionEvents());
    } catch {
      setNotice("We couldn't load your session history. Try again shortly.");
    } finally {
      setSessionsLoading(false);
    }
  };
  const refresh = async () => {
    if (!session || !token || refreshing.current) return;
    refreshing.current = true;
    try {
      setSession(await getLiveSession(session.id, token));
      setNotice("");
    } catch {
      setNotice("Connection interrupted. Reconnecting...");
    } finally {
      refreshing.current = false;
    }
  };
  useEffect(() => {
    if (!visible || !session || !token) return;
    void refresh();
    const poll = setInterval(() => void refresh(), 2000);
    const clock = setInterval(() => setNow(Date.now()), 250);
    return () => {
      clearInterval(poll);
      clearInterval(clock);
    };
  }, [visible, session?.id, token]);
  useEffect(() => {
    if (!visible) {
      restored.current = false;
      return;
    }
    if (session || restored.current) return;
    restored.current = true;
    let active = true;
    void (async () => {
      setRestoring(true);
      try {
        const stored = await SecureStore.getItemAsync(KEY);
        if (!stored) return;
        const saved = JSON.parse(stored) as { id: string; token: string };
        const value = await getLiveSession(saved.id, saved.token);
        if (active) {
          setToken(saved.token);
          setSession(value);
          setMode("home");
        }
      } catch {
        await SecureStore.deleteItemAsync(KEY);
        if (active)
          setNotice(
            "Your previous room is unavailable. Join a new room to keep playing.",
          );
      } finally {
        if (active) setRestoring(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [visible, session]);

  useEffect(() => {
    if (visible && mode === "home") void loadSessions();
  }, [visible, mode, signedIn]);
  const q = session?.question;
  const qKey = q ? `${q.position}-${q.prompt}` : null;
  useEffect(() => {
    if (!q) {
      deadline.current = null;
      previousQuestion.current = null;
    } else if (q.phase === "ANSWERING" && qKey !== previousQuestion.current) {
      deadline.current = Date.now() + q.remainingMs;
      previousQuestion.current = qKey;
    }
  }, [qKey, q?.phase, q?.remainingMs]);
  const seconds =
    q?.phase === "ANSWERING" && deadline.current
      ? Math.max(0, Math.ceil((deadline.current - now) / 1000))
      : 0;
  useEffect(() => {
    if ([5, 3, 1].includes(seconds)) void Haptics.selectionAsync();
  }, [seconds]);
  const save = (id: string, value: string) =>
    SecureStore.setItemAsync(KEY, JSON.stringify({ id, token: value }));
  const fail = (error: unknown, fallback: string) =>
    setNotice(
      error instanceof Error ? `${fallback} ${error.message}` : fallback,
    );
  const run = async (action: () => Promise<unknown>, fallback: string) => {
    setBusy(true);
    setNotice("");
    try {
      await action();
      await refresh();
    } catch (error) {
      fail(error, fallback);
    } finally {
      setBusy(false);
    }
  };
  const host = () => {
    if (schedule && date.getTime() <= Date.now())
      return setNotice("Choose a future time for the scheduled game.");
    const library = shuffle(QUIZ)
      .slice(0, roundCount)
      .map((item) => ({
        prompt: item.prompt,
        explanation: item.explanation,
        choices: shuffle(item.options.map((option) => option.label)),
        correctAnswer:
          item.options.find((option) => option.value === item.correctAnswer)
            ?.label ?? item.correctAnswer,
      }));
    if (questionSource === "custom" && questions.length < roundCount)
      return setNotice(
        `Add ${roundCount - questions.length} more custom question${roundCount - questions.length === 1 ? "" : "s"}, or choose mixed questions.`,
      );
    const payload =
      questionSource === "custom"
        ? questions.slice(0, roundCount)
        : questionSource === "mixed"
          ? [
              ...library.slice(0, Math.max(0, roundCount - questions.length)),
              ...questions,
            ].slice(0, roundCount)
          : library;
    void run(async () => {
      const created = await createLiveSession({
        title: title.trim() || `${roundCount}-round Scam Spotter`,
        description: description.trim() || undefined,
        scheduledFor: schedule ? date.toISOString() : undefined,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        questionSeconds: 30,
        questions: payload,
      });
      await save(created.id, created.sessionToken);
      setToken(created.sessionToken);
      setSession(await getLiveSession(created.id, created.sessionToken));
      setMode("room");
    }, "Could not create the game.");
  };
  const join = () =>
    void run(async () => {
      const joined = await joinLiveSession(code, name.trim());
      await save(joined.id, joined.sessionToken);
      setToken(joined.sessionToken);
      setSession(await getLiveSession(joined.id, joined.sessionToken));
      setMode("room");
    }, "Could not join this room. Check the room code and try again.");
  const leave = async () => {
    await SecureStore.deleteItemAsync(KEY);
    setSession(null);
    setToken("");
    setCode("");
    setMode("home");
  };
  const share = async () => {
    if (session)
      await Share.share({
        message: `Join my SafeCheck Scam Spotter game.\n\nRoom code: ${session.code}`,
      });
  };
  const end = () => {
    if (!session) return;
    setDialog({
      title: "End this game?",
      message: "Everyone will see the session as finished.",
      icon: "!",
      variant: "danger",
      buttons: [
        { label: "Keep playing", variant: "secondary" },
        {
          label: "End game",
          variant: "danger",
          onPress: () =>
            void run(
              () => endLiveSession(session.id),
              "Could not end the game.",
            ),
        },
      ],
    });
  };
  const cancel = () => {
    if (!session) return;
    setDialog({
      title: "Cancel scheduled game?",
      message: "Players will no longer be able to join this scheduled room.",
      icon: "!",
      variant: "danger",
      buttons: [
        { label: "Keep scheduled", variant: "secondary" },
        {
          label: "Cancel game",
          variant: "danger",
          onPress: () =>
            void run(async () => {
              await cancelLiveSession(session.id);
              await leave();
            }, "Could not cancel the scheduled game."),
        },
      ],
    });
  };
  const reschedule = (value: Date) => {
    if (!session) return;
    void run(
      () => rescheduleLiveSession(session.id, value.toISOString()),
      "Could not update the scheduled time.",
    );
  };
  const close = () => {
    setMode("home");
    onClose();
  };
  if (!visible) return null;
  const room = session && (
    <View style={s.stack}>
      {session.status === "SCHEDULED" && (
        <ScheduledRoom
          session={session}
          busy={busy}
          onCancel={cancel}
          onShare={() => void share()}
          onReschedule={reschedule}
        />
      )}
      {session.status === "LOBBY" && (
        <Lobby
          session={session}
          busy={busy}
          onShare={() => void share()}
          onStart={() =>
            void run(
              () => startLiveSession(session.id),
              "Could not start the game.",
            )
          }
        />
      )}
      {session.status === "LIVE" && (
        <LiveQuestion
          session={session}
          seconds={seconds}
          busy={busy}
          onAnswer={(answer: string) =>
            void run(
              () => answerLiveSession(session.id, answer, token),
              "Could not submit your answer.",
            )
          }
          onNext={() =>
            void run(
              () => advanceLiveSession(session.id),
              "Could not advance the round.",
            )
          }
        />
      )}
      {session.status === "FINISHED" && (
        <View style={s.finish}>
          <Text style={s.eyebrow}>COMPLETE</Text>
          <Text style={s.heroTitle}>Game complete</Text>
          <Text style={s.copy}>Every careful pause is a scam avoided.</Text>
        </View>
      )}
      {session.status === "CANCELED" && (
        <View style={s.finish}>
          <Text style={s.eyebrow}>CANCELED</Text>
          <Text style={s.heroTitle}>This game was canceled</Text>
          <Text style={s.copy}>The room is no longer accepting players.</Text>
        </View>
      )}
      <Leaderboard session={session} />
      {notice && (
        <View accessibilityLiveRegion="polite" style={s.notice}>
          <Text style={s.noticeText}>{notice}</Text>
          <Button label="Retry now" secondary onPress={() => void refresh()} />
        </View>
      )}
      {session.isHost &&
        session.status !== "FINISHED" &&
        session.status !== "CANCELED" && (
          <Button label="Minimize room" secondary onPress={close} />
        )}
      <Button
        label={
          session.status === "FINISHED" || session.status === "CANCELED"
            ? "Play another game"
            : session.isHost
              ? "End game"
              : "Leave room"
        }
        secondary={
          !session.isHost ||
          session.status === "FINISHED" ||
          session.status === "CANCELED"
        }
        destructive={
          session.isHost &&
          session.status !== "FINISHED" &&
          session.status !== "CANCELED"
        }
        onPress={
          session.status === "FINISHED" || session.status === "CANCELED"
            ? () => void leave()
            : session.isHost
              ? end
              : () => void leave()
        }
        disabled={busy}
      />
    </View>
  );
  return (
    <SafeAreaView style={[s.page, appearance === "light" && s.light]}>
      <View style={s.header}>
        <View style={s.headerCopy}>
          <Text style={[s.pageTitle, appearance === "light" && s.lightText]}>
            {mode === "room" ? "Scam Spotter Live" : "Live sessions"}
          </Text>
          <Text style={[s.copy, appearance === "light" && s.lightText]}>
            {mode === "room"
              ? "Everyone sees the same questions and leaderboard."
              : "Create, join, and return to private safety events."}
          </Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close live sessions"
          onPress={close}
        >
          <Ionicons
            name="close-circle-outline"
            size={26}
            color={appearance === "light" ? "#15212B" : "#F7FBFF"}
          />
        </Pressable>
      </View>
      <AppearanceContext.Provider value={appearance === "light"}>
        <KeyboardAvoidingView
          style={s.flex}
          behavior={Platform.OS === "ios" ? "padding" : "height"}
        >
          <ScrollView
            contentContainerStyle={s.content}
            keyboardShouldPersistTaps="handled"
          >
            {mode === "home" && (
              <View style={s.stack}>
                <SessionHub
                  signedIn={signedIn}
                  activeSession={session}
                  sessions={sessions}
                  loading={sessionsLoading}
                  onCreate={() => setMode("host")}
                  onJoin={() => setMode("join")}
                  onContinue={() => setMode("room")}
                />
                {!signedIn && (
                  <View style={s.notice}>
                    <Text style={s.noticeText}>
                      Sign in to host. Guests can still join.
                    </Text>
                  </View>
                )}
                {restoring && (
                  <Text style={s.muted}>Restoring your previous room...</Text>
                )}
                {notice && (
                  <View style={s.notice}>
                    <Text style={s.noticeText}>{notice}</Text>
                  </View>
                )}
              </View>
            )}
            {mode === "host" && (
              <HostSetup
                busy={busy}
                onCreate={host}
                onBack={() => setMode("home")}
                questions={questions}
                setQuestions={setQuestions}
                roundCount={roundCount}
                setRoundCount={setRoundCount}
                schedule={schedule}
                setSchedule={setSchedule}
                date={date}
                setDate={setDate}
                picker={picker}
                setPicker={setPicker}
                title={title}
                setTitle={setTitle}
                description={description}
                setDescription={setDescription}
                questionSource={questionSource}
                setQuestionSource={setQuestionSource}
              />
            )}
            {mode === "join" && (
              <JoinGame
                name={name}
                setName={setName}
                code={code}
                setCode={setCode}
                busy={busy}
                onJoin={join}
                onBack={() => setMode("home")}
              />
            )}
            {mode === "room" && room}
          </ScrollView>
        </KeyboardAvoidingView>
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
      </AppearanceContext.Provider>
    </SafeAreaView>
  );
}
const s = StyleSheet.create({
  page: { flex: 1, backgroundColor: "#0B1016" },
  light: { backgroundColor: "#F5F7FA" },
  lightText: { color: "#15212B" },
  lightCard: { backgroundColor: "#FFFFFF", borderColor: "#D7E0E8" },
  lightInput: {
    color: "#15212B",
    backgroundColor: "#FFFFFF",
    borderColor: "#B7C7D3",
  },
  lightButton: { backgroundColor: "#0878C9" },
  lightButtonText: { color: "#FFFFFF" },
  lightSecondaryText: { color: "#15212B" },
  flex: { flex: 1 },
  content: { padding: 20, paddingBottom: 48 },
  stack: { gap: 14 },
  hubIntro: { gap: 6, paddingVertical: 4 },
  actionRow: { gap: 10 },
  sessionSection: { gap: 9, paddingTop: 6 },
  sessionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    minHeight: 64,
    padding: 11,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#294253",
    backgroundColor: "#111E27",
  },
  sessionRowIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#173A50",
  },
  sessionTitle: { color: "#E6F0F7", fontSize: 14, fontWeight: "800" },
  sessionScore: { color: "#8FBEDB", fontSize: 11, fontWeight: "800" },
  header: {
    padding: 20,
    paddingBottom: 14,
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: "#32495B",
  },
  headerCopy: { flex: 1, gap: 4 },
  pageTitle: { color: "#F7FBFF", fontSize: 22, fontWeight: "800" },
  close: { color: "#F7FBFF", fontSize: 28, paddingHorizontal: 8 },
  eyebrow: {
    color: "#62C8FF",
    fontWeight: "900",
    fontSize: 11,
    letterSpacing: 1.2,
  },
  heroTitle: {
    color: "#F7FBFF",
    fontWeight: "900",
    fontSize: 26,
    lineHeight: 32,
  },
  sectionTitle: { color: "#F7FBFF", fontWeight: "800", fontSize: 19 },
  copy: { color: "#B5C5D3", fontSize: 14, lineHeight: 20 },
  muted: { color: "#8293A4", fontSize: 12, lineHeight: 18 },
  label: { color: "#AFC0CD", fontSize: 12, fontWeight: "800", marginBottom: 6 },
  field: { gap: 5 },
  input: {
    color: "#F4F8FC",
    backgroundColor: "#121E28",
    borderColor: "#3C5365",
    borderWidth: 1,
    borderRadius: 12,
    minHeight: 52,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
  },
  multiline: { minHeight: 82, textAlignVertical: "top" },
  button: {
    minHeight: 52,
    borderRadius: 13,
    padding: 12,
    backgroundColor: "#1689CE",
    justifyContent: "center",
    alignItems: "center",
  },
  secondary: {
    backgroundColor: "transparent",
    borderWidth: 1,
    borderColor: "#3D5567",
  },
  destructive: { borderColor: "#B95C5C" },
  buttonText: { color: "#FFF", fontSize: 16, fontWeight: "800" },
  secondaryText: { color: "#E6F0F7" },
  destructiveText: { color: "#FF9A91" },
  disabled: { opacity: 0.45 },
  pressed: { opacity: 0.78 },
  card: {
    backgroundColor: "#142430",
    borderWidth: 1,
    borderColor: "#294253",
    borderRadius: 15,
    padding: 14,
    gap: 12,
  },
  choiceRow: { flexDirection: "row", gap: 10 },
  choice: {
    flex: 1,
    minHeight: 94,
    borderWidth: 1,
    borderColor: "#3C5365",
    borderRadius: 13,
    padding: 13,
    justifyContent: "center",
    gap: 2,
  },
  choiceSelected: { backgroundColor: "#12344A", borderColor: "#39B9FF" },
  sourceChoice: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderWidth: 1,
    borderColor: "#3C5365",
    borderRadius: 12,
    padding: 11,
  },
  sourceSelected: { backgroundColor: "#12344A", borderColor: "#39B9FF" },
  sourceLabel: { color: "#E3F6FF", fontSize: 14, fontWeight: "800" },
  choiceNumber: { color: "#74D3FF", fontSize: 27, fontWeight: "900" },
  choiceText: { color: "#E3F6FF", fontWeight: "700" },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 10,
  },
  switchTrack: {
    width: 48,
    height: 28,
    borderRadius: 20,
    backgroundColor: "#344957",
    padding: 3,
    justifyContent: "center",
  },
  switchOn: { backgroundColor: "#1689CE" },
  switchThumb: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: "#D7E2E9",
  },
  switchThumbOn: { alignSelf: "flex-end", backgroundColor: "#FFF" },
  dateChoice: {
    flex: 1,
    backgroundColor: "#101C25",
    borderWidth: 1,
    borderColor: "#3C5365",
    borderRadius: 12,
    padding: 12,
    gap: 4,
  },
  dateText: { color: "#F1F7FA", fontWeight: "800" },
  answerEditor: { flexDirection: "row", alignItems: "center", gap: 8 },
  radio: {
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 2,
    borderColor: "#718796",
    alignItems: "center",
    justifyContent: "center",
  },
  radioSelected: { borderColor: "#62C8FF", backgroundColor: "#1689CE" },
  radioText: { color: "#FFF", fontWeight: "900" },
  answerInput: {
    flex: 1,
    color: "#F4F8FC",
    backgroundColor: "#121E28",
    borderColor: "#3C5365",
    borderWidth: 1,
    borderRadius: 10,
    minHeight: 46,
    paddingHorizontal: 11,
    fontSize: 15,
  },
  error: { color: "#FF9A91", fontSize: 13 },
  remove: { color: "#FF837B", fontSize: 11, fontWeight: "800" },
  questionList: { gap: 8 },
  questionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "#182934",
    borderRadius: 10,
    padding: 10,
  },
  questionNumber: { color: "#8FD7F7", fontWeight: "900" },
  questionRowText: { flex: 1, color: "#D9E6EE", fontSize: 13 },
  link: { color: "#7BD5FF", fontWeight: "800", fontSize: 11 },
  codeBlock: { alignItems: "center", gap: 7, paddingVertical: 4 },
  roomCode: {
    color: "#F7FBFF",
    fontSize: 40,
    letterSpacing: 8,
    fontWeight: "900",
    marginLeft: 8,
  },
  bigNumber: { color: "#F3F8FC", fontSize: 26, fontWeight: "900" },
  status: { color: "#E9C97F", fontWeight: "800" },
  ready: { color: "#8AE2BA" },
  playerList: {
    borderTopWidth: 1,
    borderTopColor: "#294253",
    paddingTop: 10,
    gap: 7,
  },
  playerName: { color: "#DCEAF2", fontSize: 14, fontWeight: "700" },
  notice: {
    backgroundColor: "#2B291F",
    borderWidth: 1,
    borderColor: "#5B4C2D",
    borderRadius: 12,
    padding: 12,
    gap: 8,
  },
  noticeText: { color: "#FFD58A", fontSize: 13, lineHeight: 19 },
  round: { color: "#87A1B3", fontWeight: "800", fontSize: 12 },
  timer: { color: "#F9C360", fontWeight: "900", fontSize: 18 },
  timerUrgent: { color: "#FF736A" },
  progress: {
    height: 8,
    borderRadius: 8,
    overflow: "hidden",
    backgroundColor: "#293B49",
  },
  progressFill: { height: "100%", backgroundColor: "#2BAEEB" },
  questionCard: {
    backgroundColor: "#162530",
    borderRadius: 15,
    borderWidth: 1,
    borderColor: "#294454",
    padding: 16,
  },
  question: {
    color: "#F6FAFD",
    fontSize: 20,
    lineHeight: 28,
    fontWeight: "700",
  },
  answers: { gap: 9 },
  answer: {
    flexDirection: "row",
    alignItems: "center",
    gap: 11,
    minHeight: 54,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#395164",
  },
  answerSelected: { borderColor: "#62C8FF", backgroundColor: "#12344A" },
  answerCorrect: { borderColor: "#4ED49A", backgroundColor: "#16352B" },
  answerWrong: { borderColor: "#FF736A", backgroundColor: "#40262A" },
  answerLetter: { color: "#BDEBFF", fontWeight: "900", width: 24 },
  answerText: { flex: 1, color: "#F4F8FC", fontSize: 15, fontWeight: "700" },
  answerState: { color: "#FFF", fontSize: 11, fontWeight: "800" },
  submitted: { color: "#70CEF8", fontWeight: "800", fontSize: 12 },
  reveal: {
    gap: 10,
    backgroundColor: "#132D3B",
    borderRadius: 13,
    padding: 14,
  },
  leaderRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    minHeight: 38,
    paddingHorizontal: 8,
  },
  you: { backgroundColor: "#163A4D", borderRadius: 8 },
  rank: { color: "#8FBEDB", width: 25, fontWeight: "800" },
  leaderName: { flex: 1, color: "#DCEAF2", fontWeight: "700" },
  score: { color: "#F7FBFF", fontWeight: "900" },
  finish: { alignItems: "center", gap: 10, paddingVertical: 20 },
});
