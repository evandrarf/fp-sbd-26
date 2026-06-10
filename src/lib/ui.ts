import { stdout } from "node:process";

type BoxTone = "pink" | "cyan" | "green" | "yellow" | "red" | "blue" | "muted";

const ANSI = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  pink: "\x1b[38;5;213m",
  cyan: "\x1b[38;5;117m",
  green: "\x1b[38;5;120m",
  yellow: "\x1b[38;5;222m",
  red: "\x1b[38;5;203m",
  blue: "\x1b[38;5;111m",
  muted: "\x1b[38;5;245m",
  border: "\x1b[38;5;225m",
} as const;

const TONE_MAP: Record<BoxTone, string> = {
  pink: ANSI.pink,
  cyan: ANSI.cyan,
  green: ANSI.green,
  yellow: ANSI.yellow,
  red: ANSI.red,
  blue: ANSI.blue,
  muted: ANSI.muted,
};

function stripAnsi(value: string) {
  return value.replace(/\x1b\[[0-9;]*m/g, "");
}

function pad(text: string, width: number) {
  const visibleLength = stripAnsi(text).length;
  const spaces = Math.max(0, width - visibleLength);
  return `${text}${" ".repeat(spaces)}`;
}

function center(text: string, width: number) {
  const visibleLength = stripAnsi(text).length;
  if (visibleLength >= width) {
    return text;
  }

  const left = Math.floor((width - visibleLength) / 2);
  const right = width - visibleLength - left;
  return `${" ".repeat(left)}${text}${" ".repeat(right)}`;
}

function terminalWidth() {
  const width = stdout.columns ?? 100;
  return Math.min(Math.max(width, 72), 108);
}

export function clearScreen() {
  stdout.write("\x1b[2J\x1b[H");
}

export function color(text: string, tone: BoxTone | "bold" | "dim" | "border") {
  const value = ANSI[tone] ?? TONE_MAP[tone as BoxTone];
  return `${value}${text}${ANSI.reset}`;
}

export function roleBadge(role: string) {
  const label = ` ${role} `;
  switch (role) {
    case "BUYER":
      return color(label, "cyan");
    case "SELLER":
      return color(label, "pink");
    case "COURIER":
      return color(label, "yellow");
    default:
      return color(label, "muted");
  }
}

export function divider(label = "") {
  const width = terminalWidth() - 4;
  const clean = label.trim();

  if (!clean) {
    return color("─".repeat(width), "muted");
  }

  const content = ` ${clean.toUpperCase()} `;
  const side = Math.max(0, Math.floor((width - content.length) / 2));
  return color(`${"─".repeat(side)}${content}${"─".repeat(width - content.length - side)}`, "muted");
}

export function box(
  lines: string[],
  options: {
    title?: string;
    tone?: BoxTone;
    width?: number;
    centered?: boolean;
  } = {},
) {
  const tone = TONE_MAP[options.tone ?? "cyan"];
  const innerWidth = Math.min(options.width ?? terminalWidth() - 4, terminalWidth() - 4);
  const title = options.title ? ` ${options.title} ` : "";
  const topLine = title
    ? `╭${"─".repeat(1)}${title}${"─".repeat(Math.max(0, innerWidth - title.length - 1))}╮`
    : `╭${"─".repeat(innerWidth)}╮`;
  const body = lines.map((line) => {
    const content = options.centered ? center(line, innerWidth) : pad(line, innerWidth);
    return `│${content}│`;
  });
  const bottomLine = `╰${"─".repeat(innerWidth)}╯`;
  return `${tone}${topLine}${ANSI.reset}\n${body.join("\n")}\n${tone}${bottomLine}${ANSI.reset}`;
}

export function hero() {
  return box(
    [
      color("✦ SELAMAT DATANG DI ✦", "bold"),
      color("JASTIP FEMBOY", "pink"),
      color("Belanja titip, listing cepat, kurir siap jalan.", "muted"),
    ],
    { tone: "pink", centered: true },
  );
}

export function menuOption(key: string, label: string, description: string, tone: BoxTone) {
  return `${color(`[${key}]`, tone)} ${color(label, "bold")} ${color(`- ${description}`, "muted")}`;
}

export function printScreen(sections: string[]) {
  clearScreen();
  stdout.write(`${sections.join("\n\n")}\n`);
}

export function statusBox(message: string, tone: BoxTone) {
  return box([message], { tone });
}
