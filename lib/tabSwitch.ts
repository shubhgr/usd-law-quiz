export const TAB_SWITCH_LIMIT = 5;

export type TabSwitchWarning = {
  title: string;
  body: string;
};

export function isTabBlocked(count: number | null | undefined): boolean {
  return (Number(count) || 0) >= TAB_SWITCH_LIMIT;
}

/** Progressive warnings for tab switches 1–4; 5th+ shows disqualification. */
export function tabSwitchWarning(count: number): TabSwitchWarning | null {
  if (count >= TAB_SWITCH_LIMIT) {
    return {
      title: "Disqualified",
      body: "You've left the challenge page 5 times. You have been disqualified from the AI Grand Prix and can no longer continue the challenge.",
    };
  }

  switch (count) {
    case 1:
      return {
        title: "Warning",
        body: "You've left the challenge page once. Please return immediately and remain on the challenge page until you submit. Any further violation may result in disqualification.",
      };
    case 2:
      return {
        title: "Serious violation",
        body: "You've left the challenge page 2 times. This is a serious violation of the challenge rules. Any further tab switching may result in disqualification.",
      };
    case 3:
      return {
        title: "Final warning",
        body: "You've left the challenge page 3 times. This is your final warning. Any further tab switching will result in disqualification.",
      };
    case 4:
      return {
        title: "Last chance",
        body: "You've left the challenge page 4 times. One more violation will result in disqualification from the AI Grand Prix.",
      };
    default:
      return null;
  }
}

export function tabDisqualificationMessage(): string {
  return "You've left the challenge page 5 times. You have been disqualified from the AI Grand Prix and can no longer continue the challenge.";
}

export function tabBlockMessage(_email?: string): string {
  return tabDisqualificationMessage();
}
