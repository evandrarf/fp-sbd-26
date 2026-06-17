import { emitKeypressEvents } from "node:readline";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";

export const rl = createInterface({
  input: stdin,
  output: stdout,
});

export async function prompt(text: string) {
  return rl.question(text);
}

export async function promptWithTimeout(text: string, timeoutMs: number) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await rl.question(text, { signal: controller.signal });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      stdout.write("\n");
      return null;
    }

    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export async function waitForKeypress(timeoutMs: number) {
  if (!stdin.isTTY) {
    await new Promise((resolve) => setTimeout(resolve, timeoutMs));
    return null;
  }

  emitKeypressEvents(stdin);

  return new Promise<string | null>((resolve) => {
    const previousRawMode = stdin.isRaw;
    const timer = setTimeout(() => {
      cleanup();
      resolve(null);
    }, timeoutMs);

    const onKeypress = (value: string) => {
      cleanup();
      stdout.write("\n");
      resolve(value);
    };

    const cleanup = () => {
      clearTimeout(timer);
      stdin.off("keypress", onKeypress);
      stdin.setRawMode(previousRawMode ?? false);
      stdin.pause();
    };

    stdin.setRawMode(true);
    stdin.resume();
    stdin.on("keypress", onKeypress);
  });
}

export async function promptRequired(text: string, errorMessage: string) {
  while (true) {
    const answer = (await prompt(text)).trim();
    if (answer) {
      return answer;
    }

    stdout.write(`${errorMessage}\n`);
  }
}

export async function promptPassword(label: string) {
  return prompt(label);
}

export async function pause(label = "Tekan Enter untuk lanjut...") {
  await prompt(label);
}

export function closeInput() {
  rl.close();
}
