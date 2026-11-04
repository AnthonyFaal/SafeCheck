# UI/UX Fix Plan

## Issues to Fix (excluding #1 Auto-scroll and #2 Loading states)

### 🔴 Critical
| # | Issue | Files | Fix |
|---|-------|-------|-----|
| 3 | No Android back button handling | AppShell.tsx | Add `BackHandler` listener to navigate routes instead of exiting app |
| 4 | No exit confirmation during scenario | AppShell.tsx | Show Alert.alert("Leave scenario?") before `resetScenario()` |

### 🟠 High
| # | Issue | Files | Fix |
|---|-------|-------|-----|
| 5 | Message reveal has no skip/accelerate | AppShell.tsx | Add "Tap to skip" Pressable overlay that reveals all messages instantly |
| 6 | Choice area blank during reveal | AppShell.tsx | Show "Reading messages..." text while `isRevealing` |
| 7 | No progress indicator in Group Quiz | AppShell.tsx | Add "Question {i+1}/{total}" badge per question |
| 8 | Group Quiz no retry/review | AppShell.tsx | Add "Retry Quiz" button after completion |
| 9 | No route transition animations | AppShell.tsx | Wrap route sections with Animated.View (fade/slide) |
| 10 | XP progress bar too small | AppShell.tsx | Increase from 6px to 12px height, add gradient effect |

### 🟡 Medium
| # | Issue | Files | Fix |
|---|-------|-------|-----|
| 11 | No loading skeleton for chat | AppShell.tsx | Show placeholder bubbles while `pending` is true |
| 12 | No message timestamps | ChatBubble.tsx | Add time string (e.g. "12:30 PM") below each bubble |
| 13 | No read receipts | ChatBubble.tsx | Add "✓✓" read indicator on player messages |
| 14 | No detailed learning in results | AppShell.tsx | Show "What you should have done" section explaining the safe choice |
| 15 | "Next scenario" skips home | AppShell.tsx | Navigate home first, then auto-start scenario |
| 16 | Replay mode notice too subtle | AppShell.tsx | Increase fontSize from 11 to 14, add warning color |
| 17 | No accessibility labels | AppShell.tsx, ChatBubble.tsx | Add `accessibilityLabel` and `accessibilityRole` to all Pressables |
| 18 | No haptic on choice selection | AppShell.tsx → ChoiceButtons.tsx | Add light haptic impact when user taps a choice |
| 19 | No pull-to-refresh | AppShell.tsx | Add `RefreshControl` to ScrollView on home route |
| 20 | "Level" badge unclear | PlatformChatHeader.tsx | Change to "Difficulty: Level X" |

### 🎯 User-Reported Issues
| # | Issue | Files | Fix |
|---|-------|-------|-----|
| A | **User vs sender not visually distinct** | ChatBubble.tsx | Make player bubbles more distinct: add bold colored border on player side, larger avatar, different bubble shape, "You" label more prominent |
| B | **Dark mode: card/chat backgrounds stay white** | AppShell.tsx, platformTheme.ts, theme.ts | Add dark mode variants for platform `chatBg` colors; use theme-aware backgrounds |

## Implementation Order

### Phase 1: Core Navigation & Safety (Issues 3, 4)
- Android BackHandler support
- Exit confirmation dialog

### Phase 2: Chat UX & Message Flow (Issues 5, 6, A, B)
- Tap-to-skip message reveal
- Placeholder during reveal
- Better user/sender differentiation (borders, colors, "You" badge)
- Dark mode platform backgrounds

### Phase 3: Group Quiz (Issues 7, 8)
- Progress indicator per question
- Retry button after completion

### Phase 4: Visual Polish (Issues 9, 10, 11)
- Route transitions (Animated fade)
- Larger XP bar
- Loading skeleton for chat

### Phase 5: Chat Details (Issues 12, 13, 14)
- Timestamps on bubbles
- Read receipts
- Better results with "what you should have done"

### Phase 6: Micro-interactions (Issues 15, 16, 17, 18, 19, 20)
- Home-first navigation for "Next scenario"
- Bigger replay notice
- Accessibility labels
- Haptic on choice tap
- Pull-to-refresh
- Clearer difficulty badge

